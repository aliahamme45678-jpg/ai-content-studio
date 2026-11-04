# -*- coding: utf-8 -*-
"""探针：看抖音 detail 接口的 statistics 里到底有没有 play_count。

背景：用户要求"播放量 > 10000 才蒸馏"。抖音前台一般不公开播放量，
所以先确认接口给不给这个字段，避免写个永远筛不出东西的过滤器。
"""
import asyncio, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")
from playwright.async_api import async_playwright
import collector as C

LINK = "https://www.douyin.com/video/7694973676780883238"   # 10-23 那批第 1 条，播放量必然 >1w


async def main():
    async with async_playwright() as p:
        browser, ctx = await C.open_browser(p, headless=True)
        page = await ctx.new_page()

        captured = []

        async def on_resp(r):
            if "aweme/detail" in r.url:
                try:
                    body = await r.json()
                except Exception:
                    return
                captured.append((r.status, len(json.dumps(body)), body))

        page.on("response", lambda r: asyncio.create_task(on_resp(r)))

        await page.goto(LINK, wait_until="domcontentloaded", timeout=60000)
        for _ in range(50):                      # 最多等 25 秒（detail 要 13 秒才来真数据）
            await asyncio.sleep(0.5)
            if any(sz > 10000 for _, sz, _ in captured):
                break

        print(f"捕获 detail 响应 {len(captured)} 个:")
        for st, sz, _ in captured:
            print(f"  status={st} body={sz}")

        aweme = None
        for _, sz, body in captured:
            if sz < 10000:
                continue
            for a in C.iter_awemes(body):
                aweme = a
                break
            if aweme:
                break

        if not aweme:
            print("❌ 没解析出 aweme")
            await browser.close()
            return

        print()
        print("=== aweme 顶层 key ===")
        print(sorted(aweme.keys()))
        print()
        print("=== statistics 全部字段（关键）===")
        stats = aweme.get("statistics") or {}
        for k, v in stats.items():
            print(f"  {k}: {v}")
        print()
        print("=== video 相关字段里有没有播放量 ===")
        video = aweme.get("video") or {}
        for k in ("play_count", "play_addr", "duration", "ratio", "cdn_url_expired"):
            if k in video:
                v = video[k]
                print(f"  video.{k}: {str(v)[:120]}")
        print()
        print("=== 结论 ===")
        pc = stats.get("play_count")
        print(f"  statistics.play_count = {pc!r}")
        print(f"  是否可用: {'✅ 有真实值，可以按播放量筛' if isinstance(pc, int) and pc > 0 else '❌ 为空/为0，前台拿不到播放量'}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

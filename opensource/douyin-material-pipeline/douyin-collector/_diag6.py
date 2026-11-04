# -*- coding: utf-8 -*-
"""精确复现 collector 的 fetch_one，打印每一步，定位数据在哪丢。"""
import asyncio, sys, os
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["DOUYIN_NO_STATE"] = "1"
os.environ["DOUYIN_BROWSER"] = "chromium"

import collector as C
from playwright.async_api import async_playwright

LINK = "https://www.douyin.com/video/7683512213889469759"
DETAIL = "/aweme/v1/web/aweme/detail/"


async def main():
    print("NO_STATE =", C.NO_STATE)
    print("UA      =", C.UA)
    print()
    async with async_playwright() as p:
        browser, ctx = await C.open_browser(p, headless=True)
        page = await ctx.new_page()
        store = []

        # 自己记一份，带 body 长度
        bodies = []

        async def spy(r):
            if DETAIL in r.url:
                try:
                    bodies.append((r.status, len(await r.text()), r.url[:110]))
                except Exception as e:
                    bodies.append((r.status, -1, f"<{type(e).__name__}>"))

        page.on("response", C.collect_responses(store))
        page.on("response", lambda r: asyncio.ensure_future(spy(r)))

        print("打开:", LINK)
        try:
            await page.goto(LINK, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            print("  异常:", e)
        await page.wait_for_timeout(13000)

        print("落地 URL:", page.url)
        print()
        print("=== detail 响应（我自己 spy 的）===")
        if bodies:
            for st, n, u in bodies:
                print(f"  [{st}] body={n}  {u}")
        else:
            print("  （无）")
        print()
        print("=== store 里的对象数 ===", len(store))
        for r in store:
            try:
                print("   ", r.status, r.url[:110])
            except Exception:
                pass
        print()
        print("=== drain 解析结果 ===")
        items = await C.drain(store)
        print("  items 数:", len(items))
        for it in items[:3]:
            print("   aweme_id =", it.get("aweme_id"))
        print()
        if items:
            one = C.parse_aweme(items[0])
            print("=== parse_aweme 结果 ===")
            for k in ("aweme_id", "author_name", "follower_count", "title",
                      "digg_count", "comment_count", "collect_count", "share_count"):
                print(f"  {k} = {str(one.get(k))[:70]}")
            print("  play_url 前 90:", str(one.get("play_url"))[:90])

        await browser.close()


asyncio.run(main())

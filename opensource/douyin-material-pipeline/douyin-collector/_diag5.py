# -*- coding: utf-8 -*-
"""矩阵对照：{Chromium, Edge} × {带登录态, 游客}，看哪种组合能拿到 detail。"""
import asyncio, sys
sys.stdout.reconfigure(encoding="utf-8")
from playwright.async_api import async_playwright

AID = "7696496901717265691"
URL = f"https://www.douyin.com/video/{AID}"
DETAIL = "/aweme/v1/web/aweme/detail/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


async def run(p, channel, no_state):
    label = f"{channel or 'chromium':<9} {'游客' if no_state else '登录'}"
    launch = {"headless": True, "args": ["--start-maximized"]}
    if channel:
        launch["channel"] = channel
    try:
        browser = await p.chromium.launch(**launch)
    except Exception as e:
        print(f"[{label}] 启动失败: {type(e).__name__}")
        return
    kw = {"user_agent": UA, "viewport": {"width": 1280, "height": 800}}
    if not no_state:
        kw["storage_state"] = "douyin_state.json"
    ctx = await browser.new_context(**kw)
    page = await ctx.new_page()
    lens = []

    async def on_resp(r):
        if DETAIL in r.url:
            try:
                lens.append(len(await r.text()))
            except Exception:
                lens.append(-1)

    page.on("response", on_resp)
    try:
        await page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    except Exception as e:
        print(f"[{label}] 打开异常: {type(e).__name__}")
    await page.wait_for_timeout(12000)
    land = page.url.replace("https://www.douyin.com", "")[:46]
    ok = "✓ 有数据" if any(n > 1000 for n in lens) else "✗ 空"
    print(f"[{label}] 落地={land:<48} detail={lens or '无'}  {ok}")
    await ctx.close()
    await browser.close()


async def main():
    async with async_playwright() as p:
        for ch in (None, "msedge"):
            for ns in (False, True):
                await run(p, ch, ns)


asyncio.run(main())

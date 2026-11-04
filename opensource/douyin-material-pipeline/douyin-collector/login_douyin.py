# -*- coding: utf-8 -*-
"""单独登录抖音，把登录态存进 douyin_state.json，之后采集就不用再扫了。

为什么需要这个：collector.py 撞到验证码时用的是 input() 等回车，
在后台/非交互环境里 stdin 直接 EOF，根本等不到人操作，于是只采到未登录能看的那一小撮。

本脚本改成**轮询 cookie**判断登录成功，不用按任何键。

用法（有头模式，会弹出浏览器窗口）：
    python login_douyin.py
然后在浏览器里扫码登录，脚本检测到就自动保存并退出（最多等 6 分钟）。
"""

import asyncio
import sys

from playwright.async_api import async_playwright

from collector import open_browser, save_state, log

LOGIN_COOKIES = ("sessionid", "sessionid_ss", "sid_tt", "sid_tt_ss")
TIMEOUT_ROUNDS = 120      # 120 × 3s = 6 分钟
POLL_INTERVAL = 3


async def is_logged_in(context):
    try:
        cookies = await context.cookies()
    except Exception:
        return False
    for c in cookies:
        if c.get("name") in LOGIN_COOKIES and c.get("value"):
            return True
    return False


async def main():
    async with async_playwright() as p:
        browser, context = await open_browser(p, headless=False)
        page = await context.new_page()
        try:
            await page.goto("https://www.douyin.com/", wait_until="domcontentloaded")
        except Exception as e:
            log(f"打开页面失败（不影响扫码）: {e}")

        log("=" * 58)
        log(" 请在弹出的浏览器里扫码登录抖音")
        log(" 不用按回车 —— 登录成功脚本会自动检测并保存")
        log(f" 最多等 {TIMEOUT_ROUNDS * POLL_INTERVAL // 60} 分钟")
        log("=" * 58)

        for i in range(TIMEOUT_ROUNDS):
            await asyncio.sleep(POLL_INTERVAL)
            if await is_logged_in(context):
                await save_state(context)
                log("\n登录成功，登录态已写入 douyin_state.json")
                await browser.close()
                return 0
            if i % 10 == 0 and i:
                log(f"  等待中… 已等 {i * POLL_INTERVAL}s")

        log("\n超时：没检测到登录。")
        log("如果已经扫了码还是没反应，可能是 cookie 名变了，")
        log("把浏览器里 douyin.com 的 cookie 名发我，我加进 LOGIN_COOKIES。")
        await browser.close()
        return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

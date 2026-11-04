"""User-started headed login; credentials remain in a local Playwright state file."""
import asyncio
import os
import sys
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('python-runtime.py')))['ensure_runtime'](sys.argv)
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
upstream = Path(__file__).resolve().parents[2] / 'opensource/douyin-material-pipeline/douyin-collector'
sys.path.insert(0, str(upstream))
os.environ['DOUYIN_NO_STATE'] = '1'
os.environ['DOUYIN_BROWSER'] = 'chromium'
import collector

async def main():
    async with collector.async_playwright() as playwright:
        browser, context = await collector.open_browser(playwright, headless=False)
        try:
            page = await context.new_page()
            print('请在打开的抖音窗口中点击登录，用手机扫码；最多等待 6 分钟。', flush=True)
            await page.goto('https://www.douyin.com/', wait_until='domcontentloaded', timeout=60000)
            for _ in range(120):
                await asyncio.sleep(3)
                cookies = await context.cookies()
                if any(c.get('name') in ('sessionid','sessionid_ss','sid_tt','sid_tt_ss') and c.get('value') and (c.get('domain','').lstrip('.') == 'douyin.com' or c.get('domain','').endswith('.douyin.com')) for c in cookies):
                    await context.storage_state(path=sys.argv[1])
                    print('登录成功，已保存本机登录状态。', flush=True)
                    return
            raise RuntimeError('login_timeout')
        finally:
            await browser.close()

asyncio.run(main())

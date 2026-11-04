# -*- coding: utf-8 -*-
"""探测抖音网页端实际会发出哪些接口、每个接口能拿到什么字段。

做法：用登录态打开一个视频页，**拦截页面自己发出的所有 XHR**，
把 URL 和响应结构记下来；再针对评论接口 dump 一条完整样本。
"""
import asyncio
import json
import os
import sys

from playwright.async_api import async_playwright

BASE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(BASE, "douyin_state.json")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

LINK = sys.argv[1] if len(sys.argv) > 1 else "https://v.douyin.com/xtmbdqxkJwM/"
AWEME_ID = sys.argv[2] if len(sys.argv) > 2 else "7665730690894077361"

captured = {}   # endpoint -> [payload, ...]


def endpoint(u):
    """把 URL 归一化成接口名，便于聚合"""
    try:
        path = u.split("?")[0]
        for k in ("/aweme/v1/web/", "/aweme/v1/", "/aweme/v2/"):
            if k in path:
                return path[path.index(k):]
        return path[:120]
    except Exception:
        return u[:120]


async def main():
    async with async_playwright() as p:
        try:
            b = await p.chromium.launch(channel="msedge", headless=True,
                                        args=["--mute-audio"])
        except Exception:
            b = await p.chromium.launch(headless=True, args=["--mute-audio"])
        ctx = await b.new_context(storage_state=STATE, user_agent=UA,
                                  viewport={"width": 1400, "height": 900})
        page = await ctx.new_page()

        async def on_resp(r):
            u = r.url
            if "/aweme/" not in u and "/comment/" not in u and "/search/" not in u:
                return
            ep = endpoint(u)
            if ep in captured:
                return
            try:
                ct = (r.headers or {}).get("content-type", "")
                if "json" not in ct:
                    return
                d = await r.json()
            except Exception:
                return
            captured[ep] = d

        page.on("response", lambda r: asyncio.ensure_future(on_resp(r)))

        print(f"打开视频页: {LINK}")
        await page.goto(LINK, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(6000)

        # 滚到评论区，逼页面去拉评论接口
        for i in range(4):
            await page.mouse.wheel(0, 1200)
            await page.wait_for_timeout(2500)
        print(f"抓到 {len(captured)} 个不同接口")
        await b.close()

    # ---------- 汇总 ----------
    summary = {}
    for ep, d in captured.items():
        if isinstance(d, dict):
            summary[ep] = {"顶层键": list(d.keys())[:30],
                           "状态码字段": d.get("status_code")}
        else:
            summary[ep] = {"类型": type(d).__name__}
    print("\n" + "=" * 70)
    print("一、页面实际调用的接口")
    print("=" * 70)
    for ep in sorted(summary):
        print(f"\n▸ {ep}")
        print(f"  {json.dumps(summary[ep], ensure_ascii=False)[:600]}")

    json.dump(captured, open("_probe_endpoints.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("\n原始响应已存 _probe_endpoints.json")


asyncio.run(main())

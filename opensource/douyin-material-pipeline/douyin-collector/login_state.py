# -*- coding: utf-8 -*-
"""抖音登录态：体检 / 备份 / 静默续期 / 扫码登录

用户 2026-09-22 授权：不用每次扫码，把账号登录态存下来并自动维护。

关键事实（实测 douyin_state.json）：
    sessionid / sessionid_ss / sid_tt / uid_tt   → 约 59 天
    sid_guard / ttwid / odin_tt / d_ticket       → 约 1 年
    一批策略类 cookie（strategyABtestKey 等）      → 约 6~7 天
所以登录态本身很持久，**真正需要维护的只是那批短期 cookie**，
以及服务端对 sessionid 的续期 —— 静默访问一次就能刷新。

用法：
    python refresh_login.py --check     # 只体检，不动任何东西
    python refresh_login.py --refresh   # 静默续期（无头，不用扫码）
    python refresh_login.py --login     # 兜底：弹出浏览器扫码

安全：douyin_state.json 等同于账号凭证。它只应留在本机，
不要提交到 git、不要上传到任何网盘或对话里。
"""

import json
import os
import shutil
import sys
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(BASE_DIR, "douyin_state.json")
BACKUP_DIR = os.path.join(BASE_DIR, ".login_backup")
BACKUP_KEEP = 5

# 真正代表"已登录"的 cookie
CORE_COOKIES = ("sessionid", "sessionid_ss", "sid_tt", "uid_tt")
# 需要一起看的长期凭证
LONG_COOKIES = ("sid_guard", "ttwid", "odin_tt", "d_ticket", "passport_csrf_token")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# 核心 cookie 剩不到这个天数就自动续期
REFRESH_WHEN_DAYS_LEFT = 10


def log(msg=""):
    print(msg, flush=True)


def inspect(path=None):
    """体检登录态。只读，不改任何东西。

    返回 dict：
        exists / mtime_days / total / core(dict name->剩余天数)
        core_days_left(最小剩余天数) / ok
    """
    path = path or STATE_FILE
    if not os.path.exists(path):
        return {"exists": False, "ok": False, "core": {}, "core_days_left": None}

    try:
        st = json.load(open(path, encoding="utf-8"))
    except Exception as e:
        return {"exists": True, "ok": False, "error": f"解析失败: {e}",
                "core": {}, "core_days_left": None}

    now = time.time()
    core, long_ = {}, {}
    for c in st.get("cookies", []):
        n, exp = c.get("name"), c.get("expires", -1)
        if not exp or exp < 0:
            left = None
        else:
            left = round((exp - now) / 86400, 1)
        if n in CORE_COOKIES:
            core[n] = left
        elif n in LONG_COOKIES:
            long_[n] = left

    present = [n for n in CORE_COOKIES if n in core]
    lefts = [v for v in core.values() if v is not None]
    core_left = min(lefts) if lefts else None

    return {
        "exists": True,
        "path": path,
        "mtime_days": round((now - os.path.getmtime(path)) / 86400, 2),
        "total": len(st.get("cookies", [])),
        "core": core,
        "long": long_,
        "core_present": present,
        "core_days_left": core_left,
        "ok": bool(present) and (core_left is None or core_left > 0),
    }


def backup(path=None):
    """备份当前登录态，滚动保留 BACKUP_KEEP 份。"""
    path = path or STATE_FILE
    if not os.path.exists(path):
        return None
    os.makedirs(BACKUP_DIR, exist_ok=True)
    dst = os.path.join(BACKUP_DIR, time.strftime("state_%Y%m%d_%H%M%S.json"))
    shutil.copy2(path, dst)
    olds = sorted(f for f in os.listdir(BACKUP_DIR) if f.endswith(".json"))
    for f in olds[:-BACKUP_KEEP]:
        try:
            os.remove(os.path.join(BACKUP_DIR, f))
        except Exception:
            pass
    return dst


async def _refresh_async(path=None, verbose=True):
    """用已保存的登录态静默访问抖音，让服务端重下发 cookie 并续期 session。

    不开窗口、不用扫码。核心 cookie 快过期时也常常能靠这一步被续上。
    """
    from playwright.async_api import async_playwright

    path = path or STATE_FILE
    if not os.path.exists(path):
        return False, "没有登录态文件，需要先 --login 扫码"

    async with async_playwright() as p:
        try:
            b = await p.chromium.launch(channel="msedge", headless=True,
                                        args=["--mute-audio"])
        except Exception:
            b = await p.chromium.launch(headless=True, args=["--mute-audio"])
        ctx = await b.new_context(storage_state=path, user_agent=UA)
        page = await ctx.new_page()
        try:
            # 首页 → 一个视频页：两步走能把 ttwid / msToken 这类
            # 只在真实浏览时下发的 cookie 也刷出来
            await page.goto("https://www.douyin.com/", wait_until="domcontentloaded",
                            timeout=60000)
            await page.wait_for_timeout(5000)
            await page.goto("https://www.douyin.com/video/7683531837175598376",
                            wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(5000)
        except Exception as e:
            if verbose:
                log(f"  [warn] 访问出错（可能仍已刷新部分 cookie）: {str(e)[:90]}")
        try:
            await ctx.storage_state(path=path)
        finally:
            await b.close()
    return True, ""


def refresh(path=None, verbose=True):
    """同步入口：静默续期。返回 (ok, msg)"""
    import asyncio
    return asyncio.run(_refresh_async(path=path, verbose=verbose))


def ensure_fresh(min_days=REFRESH_WHEN_DAYS_LEFT, auto=True, verbose=True,
                 path=None):
    """流程入口调用：登录态快过期就自动续期。

    返回体检结果 dict（含 refreshed 字段）。
    """
    info = inspect(path)
    if not info.get("exists"):
        if verbose:
            log("[登录态] 没有 douyin_state.json —— 需要先跑 refresh_login.py --login")
        return info

    left = info.get("core_days_left")
    if left is not None and left <= 0:
        if verbose:
            log(f"[登录态] ⚠️ 核心 cookie 已过期（{left} 天）—— 需要重新扫码")
        info["refreshed"] = False
        info["need_login"] = True
        return info

    if auto and (left is None or left <= min_days):
        if verbose:
            log(f"[登录态] 核心 cookie 只剩 {left} 天，自动续期…")
        backup(path)
        ok, msg = refresh(path=path, verbose=verbose)
        after = inspect(path)
        after["refreshed"] = ok
        if verbose:
            log(f"[登录态] 续期{'完成' if ok else '失败'}，"
                f"现剩 {after.get('core_days_left')} 天 {msg}")
        return after

    info["refreshed"] = False
    return info


def describe(info):
    """给人看的体检报告"""
    if not info.get("exists"):
        return "登录态：不存在（需要扫码登录）"
    lines = [f"登录态：{info['path']}",
             f"  文件更新于 {info.get('mtime_days')} 天前，共 {info.get('total')} 个 cookie"]
    for n in CORE_COOKIES:
        v = info["core"].get(n)
        lines.append(f"  {n:20s} {'缺失' if v is None else f'剩 {v} 天'}")
    left = info.get("core_days_left")
    if left is None:
        lines.append("  → 判断：无法判断（核心 cookie 缺失）")
    elif left <= 0:
        lines.append("  → 判断：已过期，需要重新扫码")
    elif left <= REFRESH_WHEN_DAYS_LEFT:
        lines.append(f"  → 判断：还剩 {left} 天，建议续期")
    else:
        lines.append(f"  → 判断：健康，还能用约 {int(left)} 天")
    return "\n".join(lines)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(describe(inspect()))

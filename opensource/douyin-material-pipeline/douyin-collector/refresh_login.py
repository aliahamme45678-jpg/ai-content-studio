# -*- coding: utf-8 -*-
"""登录态维护 CLI —— 平时不用扫码，登录态自己续。

用法：
    python refresh_login.py --check     # 体检（只读，推荐日常用这个）
    python refresh_login.py --refresh   # 静默续期（无头，不用扫码）
    python refresh_login.py --login     # 兜底：弹出浏览器扫码（只在真过期时才需要）
    python refresh_login.py --backup    # 手动备份一份登录态

日常完全不需要扫码：核心 cookie 有效期约 59 天，
而且本脚本会在剩不到 10 天时自动静默续期。
"""

import argparse
import sys

import login_state as ls


def main():
    ap = argparse.ArgumentParser(description="抖音登录态维护")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--check", action="store_true", help="只体检，不动任何东西")
    g.add_argument("--refresh", action="store_true", help="静默续期（无头）")
    g.add_argument("--login", action="store_true", help="弹出浏览器扫码登录（兜底）")
    g.add_argument("--backup", action="store_true", help="备份登录态")
    ap.add_argument("--force", action="store_true",
                    help="忽略健康判断，强制续期")
    args = ap.parse_args()

    if args.backup:
        p = ls.backup()
        print(f"已备份: {p}" if p else "没有登录态文件，无需备份")
        return 0

    if args.login:
        # 复用已有的扫码脚本（轮询 cookie，不用按回车）
        # 2026-10-17 修：login_douyin.main() 是 async 协程，原来直接 return 没 await，
        # 结果浏览器根本没起来、脚本立刻退出（只打了句"即将弹出浏览器"）。
        import asyncio
        import login_douyin
        print("即将弹出浏览器，请在窗口里扫码登录…")
        return asyncio.run(login_douyin.main())

    if args.refresh or args.force:
        before = ls.inspect()
        print(ls.describe(before))
        if before.get("core_days_left") is not None and before["core_days_left"] <= 0:
            print("\n核心 cookie 已过期，静默续期无效，请跑 --login 扫码。")
            return 2
        print("\n备份当前登录态…")
        print("  备份:", ls.backup())
        print("静默续期中（不开窗口）…")
        ok, msg = ls.refresh(verbose=True)
        after = ls.inspect()
        print("\n" + ls.describe(after))
        if not ok:
            print("续期失败:", msg)
            return 1
        print("\n续期完成。")
        return 0

    # 默认 = --check
    info = ls.inspect()
    print(ls.describe(info))
    if info.get("exists") and info.get("core_days_left") is not None \
            and info["core_days_left"] <= ls.REFRESH_WHEN_DAYS_LEFT:
        print("\n提示：跑 `python refresh_login.py --refresh` 可以静默续期，不用扫码。")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())

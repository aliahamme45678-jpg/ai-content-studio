# -*- coding: utf-8 -*-
"""把归并后的「需求主题」推进飞书【评论库】（聚合版）。

一行 = 一个需求主题，不是一条评论。
选题价值按样本数推导：>=10 高 / >=5 中 / 其余低。

用法：
    python push_themes.py --table-id tblXXXX
    python push_themes.py --table-id tblXXXX --dry-run
"""

import argparse
import json
import os
import subprocess
import sys
import time

BASE = os.path.dirname(os.path.abspath(__file__))
BASE_TOKEN = "IjbBblKh0amzztsiExVc1PqInfd"
THEMES = os.path.join(BASE, "comments_themes.ndjson")
sys.stdout.reconfigure(encoding="utf-8")

BATCH = 200


def cli(args, timeout=600):
    r = subprocess.run(["lark-cli.cmd"] + args, cwd=BASE, capture_output=True,
                       text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return r.stdout


def value_of(n):
    n = int(n or 0)
    if n >= 10:
        return "高"
    if n >= 5:
        return "中"
    return "低"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--themes", default=THEMES)
    ap.add_argument("--table-id", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rows = [json.loads(l) for l in open(args.themes, encoding="utf-8") if l.strip()]
    print(f"需求主题 {len(rows)} 条（对比：逐条评论 9879 行 → 压缩 {9879/len(rows):.0f}:1）")

    now_ms = int(time.time() * 1000)
    recs = []
    for r in rows:
        rec = {
            "需求名称": r.get("需求名称") or "",
            "作者账号": r.get("作者账号") or "",
            "核心需求/痛点": r.get("核心需求/痛点") or "",
            "可延伸选题": r.get("可延伸选题") or "",
            "评论类型": [r.get("评论类型") or "其他"],
            "样本数": int(r.get("样本数") or 0),
            "代表评论": r.get("代表评论") or "",
            "总点赞数": int(r.get("总点赞数") or 0),
            "选题价值": [value_of(r.get("样本数"))],
            "采集时间": now_ms,
        }
        recs.append(rec)

    if args.dry_run:
        print("\n[dry-run] 前 3 条：")
        for x in recs[:3]:
            print(json.dumps(x, ensure_ascii=False, indent=1))
        return

    ok = 0
    for i in range(0, len(recs), BATCH):
        chunk = recs[i:i + BATCH]
        p = os.path.join(BASE, "_push_themes_payload.json")
        json.dump({"create_records": chunk}, open(p, "w", encoding="utf-8"),
                  ensure_ascii=False)
        out = cli(["base", "+record-batch-create", "--base-token", BASE_TOKEN,
                   "--table-id", args.table_id, "--json", "@" + p, "--as", "user"])
        try:
            good = bool(json.loads(out).get("ok"))
        except Exception:
            good = '"ok":true' in out.replace(" ", "")
        if good:
            ok += len(chunk)
            print(f"  批 {i//BATCH + 1}: +{len(chunk)} 条 (累计 {ok})")
        else:
            print(f"  批 {i//BATCH + 1} 失败: {out[:300]}")
        time.sleep(0.4)

    print(f"\n推送完成 {ok}/{len(recs)} 条")
    print(f"表: https://hcngrs2jw5fb.feishu.cn/base/{BASE_TOKEN}?table={args.table_id}")


if __name__ == "__main__":
    main()

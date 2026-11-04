# -*- coding: utf-8 -*-
"""把蒸馏后的评论推进飞书【评论库】表。

目标：Base IjbBblKh0amzztsiExVc1PqInfd / Table tbla7Ldxozt391gP（评论库）
去重：按「评论ID」比对表里已有记录，重跑不会产生重复行。
分批：飞书单批上限 200 条，超了自动切批串行。

用法：
    python push_comments.py --dry-run          # 只看要推什么
    python push_comments.py                    # 全推
    python push_comments.py --only-valuable    # 只推 高/中 价值
"""

import argparse
import json
import os
import subprocess
import sys
import time

BASE = os.path.dirname(os.path.abspath(__file__))
BASE_TOKEN = "IjbBblKh0amzztsiExVc1PqInfd"
TABLE_ID = "tbla7Ldxozt391gP"
DISTILLED = os.path.join(BASE, "comments_distilled.ndjson")
sys.stdout.reconfigure(encoding="utf-8")

BATCH = 200


def cli(args, timeout=600):
    r = subprocess.run(["lark-cli.cmd"] + args, cwd=BASE, capture_output=True,
                       text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return r.stdout


def existing_ids():
    """拉表里已有的「评论ID」，用于去重。表空就直接返回。"""
    ids, offset = set(), 0
    while True:
        out = cli(["base", "+record-list", "--base-token", BASE_TOKEN,
                   "--table-id", TABLE_ID, "--field-id", "评论ID",
                   "--format", "json", "--limit", "2000", "--offset", str(offset),
                   "--as", "user"])
        try:
            d = json.loads(out)
        except Exception:
            break
        recs = (d.get("data") or {}).get("records") or []
        for r in recs:
            v = r.get("评论ID")
            if isinstance(v, list):
                v = "".join(str(x.get("text", x)) if isinstance(x, dict) else str(x)
                            for x in v)
            if v:
                ids.add(str(v).strip())
        if len(recs) < 2000:
            break
        offset += 2000
        if offset > 60000:
            break
    return ids


def to_record(r, now_ms):
    """蒸馏结果 → 飞书行。字段名必须和表里完全一致。"""
    ts = r.get("时间") or 0
    rec = {
        "评论内容": r.get("评论") or "",
        "作者账号": r.get("作者") or "",
        "原视频标题/文案": r.get("视频标题") or "",
        "原视频链接": r.get("视频链接") or "",
        "评论点赞数": int(r.get("点赞") or 0),
        "评论类型": [r.get("评论类型") or "其他"],
        "核心需求/痛点": r.get("核心需求/痛点") or "",
        "可延伸选题": r.get("可延伸选题") or "",
        "选题价值": [r.get("选题价值") or "低"],
        "采集时间": now_ms,
        "评论者昵称": r.get("昵称") or "",
        "IP属地": r.get("IP属地") or "",
        "是否热评": bool(r.get("是否热评")),
        "评论ID": r.get("cid") or "",
    }
    if ts:
        rec["评论时间"] = int(ts) * 1000
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--distilled", default=DISTILLED)
    ap.add_argument("--only-valuable", action="store_true",
                    help="只推 高/中 价值（默认全推）")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rows = [json.loads(l) for l in open(args.distilled, encoding="utf-8") if l.strip()]
    print(f"蒸馏结果 {len(rows)} 条")

    if args.only_valuable:
        rows = [r for r in rows if r.get("选题价值") in ("高", "中")]
        print(f"只推高/中价值：{len(rows)} 条")

    # 同一次输入里可能有重复 cid，先去重
    seen, uniq = set(), []
    for r in rows:
        k = r.get("cid") or ""
        if k and k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    rows = uniq

    have = existing_ids()
    print(f"表里已有 {len(have)} 条，本次跳过重复")
    rows = [r for r in rows if (r.get("cid") or "") not in have]
    print(f"待推 {len(rows)} 条")
    if not rows:
        return

    now_ms = int(time.time() * 1000)
    recs = [to_record(r, now_ms) for r in rows]

    if args.dry_run:
        print("\n[dry-run] 第一条：")
        print(json.dumps(recs[0], ensure_ascii=False, indent=1))
        return

    ok = 0
    for i in range(0, len(recs), BATCH):
        chunk = recs[i:i + BATCH]
        p = os.path.join(BASE, "_push_comments_payload.json")
        json.dump({"create_records": chunk}, open(p, "w", encoding="utf-8"),
                  ensure_ascii=False)
        out = cli(["base", "+record-batch-create", "--base-token", BASE_TOKEN,
                   "--table-id", TABLE_ID, "--json", "@" + p, "--as", "user"])
        # ⚠️ 别用 `'"ok": true' in out.replace(" ", "")` —— 去掉空格后变成 "ok":true，
        #    匹配带空格的模式永远是 False，会把成功全报成失败（2026-09-22 踩过）。
        try:
            good = bool(json.loads(out).get("ok"))
        except Exception:
            good = '"ok":true' in out.replace(" ", "")
        if good:
            ok += len(chunk)
            print(f"  批 {i//BATCH + 1}: +{len(chunk)} 条  (累计 {ok})")
        else:
            print(f"  批 {i//BATCH + 1} 失败: {out[:300]}")
        time.sleep(0.4)

    print(f"\n推送完成 {ok}/{len(recs)} 条")
    print(f"表: https://hcngrs2jw5fb.feishu.cn/base/{BASE_TOKEN}?table={TABLE_ID}")


if __name__ == "__main__":
    main()

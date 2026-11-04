# -*- coding: utf-8 -*-
"""修飞书「原文 / 文案」字段：把并发串线写错的文案换成正确的。

背景（2026-10-26 事故）：
`aliyun_asr.transcribe_video` 用毫秒时间戳命名临时文件，`_asr_backfill` 开 4 并发，
同一毫秒启动的任务撞同一文件名 → 互相覆盖 → 68 条里 6 条转出同一段文案，
而且这批脏数据已经推进飞书了。aliyun_asr 已修为 `时间戳-uuid`，本文案重转后
用本脚本把飞书里的旧文案覆盖掉。

只动「原文 / 文案」一个字段，不碰拆解字段（那些是人工/模型写的，跟文案无关）。
"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding="utf-8")
from update_distill import BASE, BASE_TOKEN, TABLE_ID, pull, norm

SRC = os.path.join(BASE, "douyin_filtered.json")
FIELD = "原文 / 文案"


def main():
    recs = json.load(open(SRC, encoding="utf-8"))
    print(f"本地 {len(recs)} 条")

    rows = pull(TABLE_ID, os.path.join(BASE, "_fix_snapshot.ndjson"))
    rec = {norm(r.get("来源链接")): r["record_id"] for r in rows if r.get("来源链接")}
    print(f"飞书快照 {len(rows)} 行 / 可匹配 {len(rec)} 个链接")

    updates, miss, empty = {}, 0, 0
    for r in recs:
        url = (r.get("source_url") or r.get("url") or "").strip()
        txt = (r.get("content") or "").strip()
        if not txt:
            empty += 1
            continue
        rid = rec.get(norm(url))
        if not rid:
            miss += 1
            continue
        updates[rid] = {FIELD: txt}

    print(f"待更新 {len(updates)} 条（无文案跳过 {empty} / 飞书找不到 {miss}）")
    if not updates:
        return

    p = os.path.join(BASE, "_fix_payload.json")
    json.dump({"update_records": updates}, open(p, "w", encoding="utf-8"),
              ensure_ascii=False)

    # 单批上限 200，这里最多 68 条，一次就够
    r = subprocess.run(["lark-cli.cmd", "base", "+record-batch-update",
                        "--base-token", BASE_TOKEN, "--table-id", TABLE_ID,
                        "--json", "@" + p], cwd=BASE, capture_output=True)
    out = (r.stdout or b"").decode("utf-8", "replace")
    try:
        good = bool(json.loads(out).get("ok"))
    except Exception:
        good = '"ok":true' in out.replace(" ", "")
    print("ok" if good else out[:500])


if __name__ == "__main__":
    main()

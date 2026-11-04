# -*- coding: utf-8 -*-
r"""拆解前的自动填充：把能机器生成的字段先填好，我只写剩下的。

能自动的：
  - 话题     ← 从原视频标题里抠 #标签（人工再删噪音）
  - 黄金开头 ← 截取转写文案开头，切到第一个句末标点
  - 字数/时长 ← 本来就是自动的

不能自动、必须我写的：标题、行业类型、选题切口、Hook机制、内容结构、
核心观点、论证方式、表达方式、可复用机制（9 个）

这样每条少写约 70 字，10 条少 700 字，拆解耗时降约 12%。

用法：
    python auto_fill.py --data cache_x.json --asr D:\douyin_audio\x\asr_result.json \
                        -o analysis_x.json
    python auto_fill.py --data cache_x.json --asr ... -o analysis_x.json --force  # 覆盖已有
"""

import argparse
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

BLANK = ["标题", "行业类型", "选题切口", "Hook机制", "内容结构",
         "核心观点", "论证方式", "表达方式", "可复用机制"]


def pick_topic(title):
    """从标题里抠 #标签，去重保序；没有就留空让我自己写。"""
    tags = re.findall(r"#([^\s#]+)", title or "")
    seen, out = set(), []
    for t in tags:
        t = t.strip()
        if t and t not in seen:
            seen.add(t)
            out.append("#" + t)
    return " ".join(out[:8])


def pick_open(text, limit=80):
    """取文案开头，切到第一个句末标点；太长就硬截。"""
    t = (text or "").strip()
    if not t:
        return ""
    m = re.search(r"[。！？!?]", t[:limit])
    end = m.end() if m else min(len(t), limit)
    return t[:end].strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--asr")
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("--force", action="store_true", help="覆盖已存在的字段值")
    args = ap.parse_args()

    data = json.load(open(args.data, encoding="utf-8"))
    items = data.get("items") if isinstance(data, dict) else data

    asr = {}
    if args.asr and os.path.exists(args.asr):
        a = json.load(open(args.asr, encoding="utf-8"))
        for it in (a.get("items") if isinstance(a, dict) else a):
            ok = it.get("status") == "ok"
            u = str(it.get("source_url") or "").rstrip("/")
            if u and (ok or u not in asr):
                asr[u] = it
            aid = str(it.get("aweme_id") or "")
            if aid and (ok or aid not in asr):
                asr[aid] = it

    # 已存在的草稿：接着填，不覆盖
    draft = {}
    if os.path.exists(args.output) and not args.force:
        try:
            draft = json.load(open(args.output, encoding="utf-8"))
        except Exception:
            draft = {}

    seen, n_topic, n_open = set(), 0, 0
    for r in items:
        u = str(r.get("source_url") or "").rstrip("/")
        key = u or str(r.get("aweme_id"))
        if not key or key in seen:
            continue
        seen.add(key)
        rec = draft.setdefault(key, {})
        title = r.get("title") or ""
        if not rec.get("话题"):
            t = pick_topic(title)
            if t:
                rec["话题"] = t
                n_topic += 1
        if not rec.get("黄金开头"):
            a = asr.get(u) or asr.get(str(r.get("aweme_id") or "")) or {}
            o = pick_open(a.get("text"))
            if o:
                rec["黄金开头"] = o
                n_open += 1
        for f in BLANK:
            rec.setdefault(f, "")

    json.dump(draft, open(args.output, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"草稿: {args.output}")
    print(f"  话题自动填 {n_topic} 条，黄金开头自动填 {n_open} 条，共 {len(draft)} 条")
    print(f"  待我填的字段（每条 9 个）: {' / '.join(BLANK)}")


if __name__ == "__main__":
    main()

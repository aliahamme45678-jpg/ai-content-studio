# -*- coding: utf-8 -*-
"""
最后一公里：把三方产出拼成一张总表

  互动数据（我这边抓的 cache_*.json 或 douyin_result.json）
+ 音频提取（A 流输出的 audio_manifest.json）
+ 阿里云转写（B 流输出的 asr_result.json）
= 一张总表 xlsx（数据 + 音频信息 + 转写文案）

用法：
    python merge_all.py --data cache_xxx.json --audio audio_manifest.json --asr asr_result.json -o 总表.xlsx
    python merge_all.py --audio audio_manifest.json --asr asr_result.json -o 总表.xlsx   # 没有互动数据也能合
    python merge_all.py --data cache_xxx.json --asr asr_result.json -o 总表.xlsx         # 只有文案也行

关联顺序：aweme_id > source_url > audio_path，哪个有就用哪个。
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from analyze import export_xlsx, parse_blocks, field, content_text  # noqa: E402


def load_json(path):
    if not path:
        return []
    if not os.path.exists(path):
        raise SystemExit(f"文件不存在: {path}")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    # 允许 {"items":[...]} 或直接 [...]
    if isinstance(data, dict):
        data = data.get("items") or data.get("results") or []
    return data


def build_index(items, keys):
    """按多个候选字段建索引。

    同一个 key 命中多条时**优先保留 status=ok 的那条**：同一视频可能有好几条
    短链，转写结果里会出现一条 ok + 一条 failed，若按"先到先得"取到 failed，
    文案就会变成空。这里不能依赖 items 的排列顺序。
    """
    idx = {}
    for it in items:
        ok = it.get("status") == "ok"
        for k in keys:
            v = it.get(k)
            if not v:
                continue
            k2 = str(v).strip()
            cur = idx.get(k2)
            if cur is None or (ok and cur.get("status") != "ok"):
                idx[k2] = it
    return idx


def pick(idx_url, idx_id, idx_path, url=None, aid=None, path=None):
    for key, idx in ((url, idx_url), (aid, idx_id), (path, idx_path)):
        if key and idx:
            hit = idx.get(str(key).strip())
            if hit:
                return hit
    return None


def main():
    ap = argparse.ArgumentParser(description="合并互动数据 + 音频 + 转写文案")
    ap.add_argument("--data", help="互动数据 json（我这边抓的）")
    ap.add_argument("--audio", help="音频提取产出的 audio_manifest.json")
    ap.add_argument("--asr", help="阿里云转写产出的 asr_result.json")
    ap.add_argument("--source", help="原始 txt，用来补标题/话题/已有文案")
    ap.add_argument("-o", "--output", default="总表.xlsx", help="输出 xlsx")
    args = ap.parse_args()

    stats = load_json(args.data)
    audios = load_json(args.audio)
    asrs = load_json(args.asr)

    a_url = build_index(audios, ["source_url"])
    a_id = build_index(audios, ["aweme_id", "video_id"])
    a_path = build_index(audios, ["audio_path", "path"])
    s_url = build_index(asrs, ["source_url"])
    s_id = build_index(asrs, ["aweme_id", "video_id"])
    s_path = build_index(asrs, ["audio_path", "path"])

    # 标题/话题/已有文案：优先从原始 txt 拿
    meta = {}
    if args.source and os.path.exists(args.source):
        with open(args.source, "r", encoding="utf-8") as f:
            text = f.read()
        for i, blk in enumerate(parse_blocks(text), 1):
            body = blk["body"]
            from collector import extract_links
            links = extract_links(body)
            if links:
                meta[links[0]] = {
                    "title": field(body, "标题"),
                    "topic": field(body, "话题"),
                    "content": content_text(body),
                }

    # 以互动数据为主干；没有数据就用音频清单当主干
    trunk = stats if stats else audios
    rows = []
    for i, base in enumerate(trunk, 1):
        url = base.get("source_url") or base.get("url") or ""
        aid = base.get("aweme_id") or ""
        audio = pick(a_url, a_id, a_path, url=url, aid=aid)
        path = (audio or {}).get("audio_path") or (audio or {}).get("path") or ""
        asr = pick(s_url, s_id, s_path, url=url, aid=aid, path=path)

        text = (asr or {}).get("text") or ""
        m = meta.get(url, {})
        if not text:
            text = m.get("content", "")

        digg = int(base.get("digg_count") or 0)
        rows.append({
            "idx": i,
            "no": str(i),
            "title": m.get("title") or base.get("title") or "",
            "topic": m.get("topic") or "",
            "author": base.get("author_name") or "",
            "publish": base.get("publish_time") or "",
            "digg": digg,
            "comment": int(base.get("comment_count") or 0),
            "collect": int(base.get("collect_count") or 0),
            "share": int(base.get("share_count") or 0),
            "r_collect": (base.get("collect_count") or 0) / digg if digg else 0,
            "r_comment": (base.get("comment_count") or 0) / digg if digg else 0,
            "r_share": (base.get("share_count") or 0) / digg if digg else 0,
            "chars": len(text.replace("\n", "")),
            "content": text,
            "url": url,
            "audio_duration": (audio or {}).get("duration_sec") or (asr or {}).get("duration_sec") or "",
            "audio_path": path,
            "asr_status": (asr or {}).get("status") or ("无" if not asr else ""),
        })

    extra = []
    if any(r["audio_path"] for r in rows):
        extra += [("音频时长(秒)", "audio_duration", 12), ("音频路径", "audio_path", 46)]
    if any(r["asr_status"] for r in rows):
        extra += [("转写状态", "asr_status", 10)]

    export_xlsx(rows, args.output, extra_cols=extra or None)
    print(f"合并 {len(rows)} 条")
    print(f"  有互动数据: {sum(1 for r in rows if r['digg'])}")
    print(f"  有音频    : {sum(1 for r in rows if r['audio_path'])}")
    print(f"  有转写文案: {sum(1 for r in rows if r['content'])}")
    print(f"输出: {args.output}")


if __name__ == "__main__":
    main()

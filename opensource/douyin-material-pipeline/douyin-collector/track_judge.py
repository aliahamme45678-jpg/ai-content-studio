# -*- coding: utf-8 -*-
"""作者赛道判定：AI / 跨境 / 其他。

采集评论前先过这一关 —— 只采 AI 赛道和跨境赛道作者的评论，
其他赛道（赚钱思维、人生感悟、英语学习、社会话题、纯自媒体运营…）不采。

**判的是「主赛道」，不是「有没有提过 AI」。**
自媒体运营号偶尔提一句 AI，仍算其他 —— 所以不能用关键词判：
墨鱼 163 条里只有 6 条提到 AI（3.7%），关键词会把它误判成 AI 赛道。
交给 qwen-plus 看标题语义更稳。

用法：
    python track_judge.py                  # 判定蒸馏表里全部作者
    python track_judge.py --sample 12      # 每个作者最多看 12 条标题

输出：
    track_map.json   {"作者": "AI|跨境|其他", ...}
"""

import argparse
import concurrent.futures as cf
import json
import os
import sys
import time

import requests

BASE = os.path.dirname(os.path.abspath(__file__))
sys.stdout.reconfigure(encoding="utf-8")

API = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
DISTILL = os.path.join(BASE, "_distill_all.ndjson")
OUT = os.path.join(BASE, "track_map.json")

TRACKS = ("AI", "跨境", "其他")
BATCH = 8  # 每批送几个作者给模型

SYSTEM = """你是内容赛道分类器。用户给你一批抖音博主的视频标题，判断每个博主的**主赛道**。

赛道只有三个：

- **AI**：AI 工具 / AI 应用 / AI 编程 / 提示词 / Agent / 大模型 / 知识库 / 用 AI 做内容
- **跨境**：跨境电商 / 出海 / TikTok / 亚马逊 / 独立站 / 外贸 / 选品
- **其他**：以上都不是 —— 赚钱思维、人生感悟、英语学习、社会话题、纯自媒体运营拆解等

**判主赛道，不判单条内容。** 一个博主偶尔提一次 AI，但主要讲自媒体运营，
算「其他」。名字里带 AI 不代表就是 AI 赛道，要看实际在讲什么。

只返回 JSON，不要解释：{"博主名": "赛道"}
"""


def api_key():
    p = os.path.join(BASE, ".env")
    if os.path.exists(p):
        for l in open(p, encoding="utf-8"):
            if l.strip().startswith("DASHSCOPE_API_KEY"):
                return l.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("DASHSCOPE_API_KEY", "")


def s(v):
    if isinstance(v, list):
        return " ".join(str(x) for x in v)
    return str(v) if v is not None else ""


def load_authors(sample):
    """从蒸馏表导出里按作者收集标题样本。"""
    rows = [json.loads(l) for l in open(DISTILL, encoding="utf-8") if l.strip()]
    by = {}
    for r in rows:
        a = r.get("作者")
        if not a:
            continue
        by.setdefault(a, [])
        t = s(r.get("标题")).strip()
        if t and len(by[a]) < sample:
            by[a].append(t[:60])
    return by


def call(k, payload, tries=4):
    for i in range(tries):
        try:
            r = requests.post(
                API,
                headers={"Authorization": "Bearer " + k,
                         "Content-Type": "application/json"},
                json=payload, timeout=180)
            if r.status_code == 200:
                return r.json()["choices"][0]["message"]["content"]
            print(f"    HTTP {r.status_code}: {r.text[:120]}")
            time.sleep(2 ** i)
        except Exception as e:
            print(f"    重试 {i+1}: {type(e).__name__}")
            time.sleep(2 ** i)
    return ""


def judge(k, chunk):
    body = "\n\n".join(
        "【" + a + "】\n" + "\n".join("- " + t for t in ts)
        for a, ts in chunk.items())
    out = call(k, {
        "model": "qwen-plus",
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": body}],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    })
    try:
        m = json.loads(out)
    except Exception:
        return {}
    got = {}
    for a, v in m.items():
        key = str(a).strip()
        # 模型经常把 key 原样套上【】返回，先剥一层再匹配。
        # ⚠️ 不能用 strip("【】") —— 作者名自己可能以】结尾
        #（"辛说说说【硅基拍档】"），会被误剥掉尾字符而永远匹配不上（踩过）
        for l, r in (("【", "】"), ("[", "]"), ("「", "」")):
            if key.startswith(l) and key.endswith(r):
                key = key[len(l):-len(r)].strip()
                break
        if key not in chunk:
            hits = [c for c in chunk if c in key or key in c]
            if len(hits) == 1:
                key = hits[0]
        if key in chunk:
            got[key] = v if v in TRACKS else "其他"
    return got


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=12,
                    help="每个作者最多看几条标题")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    k = api_key()
    if not k:
        raise SystemExit("没有 DASHSCOPE_API_KEY")

    by = load_authors(args.sample)
    print(f"待判作者 {len(by)} 个，每个最多看 {args.sample} 条标题\n")

    items = list(by.items())
    chunks = [dict(items[i:i + BATCH]) for i in range(0, len(items), BATCH)]

    res = {}
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(judge, k, c) for c in chunks]
        for f in cf.as_completed(futs):
            res.update(f.result())

    miss = [a for a in by if a not in res]
    if miss:
        print(f"\n首轮缺 {len(miss)} 个，逐个补判…")
        for a in miss:
            res.update(judge(k, {a: by[a]}))
        miss = [a for a in by if a not in res]
    for a in miss:
        res[a] = "其他"

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)

    print(f"\n{'作者':<24}{'赛道':<6}  标题样本")
    print("-" * 72)
    for a, v in sorted(res.items(), key=lambda x: (x[1], x[0])):
        print(f"{a:<24}{v:<6}  {by[a][0][:40] if by[a] else ''}")

    print("\n" + "=" * 40)
    for t in TRACKS:
        n = [a for a, v in res.items() if v == t]
        print(f"{t}: {len(n)} 个作者")
    if miss:
        print(f"\n⚠️ 模型没返回、兜底成「其他」的: {miss}")
    print(f"\n耗时 {time.time()-t0:.0f}s → {OUT}")


if __name__ == "__main__":
    main()

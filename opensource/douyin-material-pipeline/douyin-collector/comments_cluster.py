# -*- coding: utf-8 -*-
"""把逐条评论**归并成「用户需求主题」** —— 评论库的正确形态。

用户原话：
  「评论不是拿来全部保存，而是把评论区变成一个持续更新的【用户需求库 + 选题库】」
  「AI 需要对每条有效评论进行简单蒸馏……不要只是保存原评论」

所以这里做的事：9620 条评论 → 按作者归并成 N 个需求主题 →
每个作者 10~25 行，全表几百行，而不是几千行。

用法：
    python comments_cluster.py --workers 4
    python comments_cluster.py --only 跨境出海运营站    # 只跑一个作者看效果
"""

import argparse
import collections
import concurrent.futures as cf
import json
import os
import re
import sys
import time

import requests

BASE = os.path.dirname(os.path.abspath(__file__))
sys.stdout.reconfigure(encoding="utf-8")

API = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
DISTILLED = os.path.join(BASE, "comments_distilled.ndjson")
OUT_PATH = os.path.join(BASE, "comments_themes.ndjson")

TYPES = ["问题", "痛点", "需求", "争议", "反对观点",
         "经验分享", "案例", "情绪反馈", "其他"]

# 只归并这几类 —— 情绪反馈/其他 本身没有需求信息，不进聚类
CLUSTER_TYPES = ("问题", "痛点", "需求", "争议", "反对观点", "经验分享", "案例")

MAX_PER_AUTHOR = 150   # 单作者最多送多少条给模型
REP_LEN = 50           # 代表评论截断长度

SYSTEM = """你是短视频选题分析师。用户会给你某个抖音作者视频下的评论数据（每条已带 AI 初判的需求和类型）。

你的任务：**把这些评论归并成若干「用户需求主题」**，让作者一眼看清"我的观众到底在要什么"。

规则：
1. **同一个需求只出现一次。** 措辞不同但意思相同的评论必须合并成一条主题。
2. 主题数量由你判断，通常 8~20 个。**不要为了减少数量把不同需求硬合并**，
   也不要因为措辞差异把同一个需求拆成好几条。
3. 每个主题给出：
   - 需求名称：10 字以内，一眼能看懂
   - 核心需求/痛点：一句话说清观众到底在意什么，20~40 字
   - 可延伸选题：1~3 个能直接当短视频标题用的选题，用「 / 」分隔
   - 评论类型：从 问题/痛点/需求/争议/反对观点/经验分享/案例/情绪反馈/其他 里选**一个**主导类型
   - 样本数：支持这个主题的评论条数
   - 代表评论：挑 2~3 条最能代表这个主题的**评论原话**，每条不超过 50 字，**保留原话不要改写**
   - 总点赞数：这个主题下评论的点赞合计（估算）
4. 按样本数从多到少排序。
5. 和视频主题完全无关的（闲聊、广告、纯情绪）归到「其他」主题，样本数照实写，不要丢掉。

只输出 JSON，不要任何解释文字：
{"themes":[{"需求名称":"...","核心需求/痛点":"...","可延伸选题":"...","评论类型":"问题","样本数":12,"代表评论":["...","..."],"总点赞数":45}]}"""


def load_key():
    p = os.path.join(BASE, ".env")
    if os.path.exists(p):
        for l in open(p, encoding="utf-8"):
            if l.strip().startswith("DASHSCOPE_API_KEY"):
                return l.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("DASHSCOPE_API_KEY", "")


def parse_json(txt):
    t = (txt or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    try:
        return json.loads(t)
    except Exception:
        m = re.search(r"\{.*\}", t, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return None
    return None


def cluster_author(author, rows, key, model, retries=4, verbose=False):
    """一个作者的全部评论 → 需求主题列表。"""
    # 按「价值分 + 点赞」排序，取头部 —— 长尾评论信息密度低，全送反而稀释聚类质量
    rows = sorted(rows, key=lambda r: (-(r.get("价值分") or 0), -(r.get("点赞") or 0)))
    picked = rows[:MAX_PER_AUTHOR]
    items = []
    for i, r in enumerate(picked, 1):
        items.append({
            "i": i,
            "评论": (r.get("评论") or "")[:120],
            "类型": r.get("评论类型") or "其他",
            "需求": (r.get("核心需求/痛点") or "")[:60],
            "赞": r.get("点赞") or 0,
        })
    user = (f"作者：{author}\n"
            f"评论总数 {len(rows)} 条，下面按价值排序给出前 {len(items)} 条：\n"
            + json.dumps(items, ensure_ascii=False))
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": user}],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }
    for att in range(retries):
        try:
            r = requests.post(API, headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json"},
                json=payload, timeout=300)
            if r.status_code == 200:
                obj = parse_json(r.json()["choices"][0]["message"]["content"])
                if obj and obj.get("themes"):
                    return obj["themes"]
                raise ValueError("themes 为空")
            if verbose:
                print(f"    {author[:12]} HTTP {r.status_code}: {r.text[:120]}")
            time.sleep(2 * (att + 1))
        except Exception as e:
            if verbose:
                print(f"    {author[:12]} 第{att+1}次失败 {type(e).__name__}: {str(e)[:90]}")
            time.sleep(2 * (att + 1))
    return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--distilled", default=DISTILLED)
    ap.add_argument("--out", default=OUT_PATH)
    ap.add_argument("--model", default="qwen-plus")   # 聚类比逐条蒸馏难，用 plus
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--only", default="", help="只跑指定作者")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    key = load_key()
    if not key:
        raise SystemExit("没有 DASHSCOPE_API_KEY")

    rows = [json.loads(l) for l in open(args.distilled, encoding="utf-8") if l.strip()]
    print(f"蒸馏评论 {len(rows)} 条")

    # 按作者分组，只留能提炼出需求的类型
    groups = collections.defaultdict(list)
    for r in rows:
        if r.get("评论类型") in CLUSTER_TYPES:
            groups[r.get("作者") or "(未知)"].append(r)
    if args.only:
        groups = {k: v for k, v in groups.items() if args.only in k}
    print(f"参与归并 {len(groups)} 个作者 / {sum(len(v) for v in groups.values())} 条评论")
    for a, v in sorted(groups.items(), key=lambda x: -len(x[1])):
        print(f"    {a[:24]:<26} {len(v)}")

    t0 = time.time()
    results = {}
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(cluster_author, a, v, key, args.model,
                          4, args.verbose): a for a, v in groups.items()}
        for k, fut in enumerate(cf.as_completed(futs), 1):
            a = futs[fut]
            themes = fut.result()
            results[a] = themes
            print(f"  [{k}/{len(groups)}] {a[:20]:<22} → {len(themes)} 个需求主题"
                  f"  ({time.time()-t0:.0f}s)")

    # 落盘
    n = 0
    with open(args.out, "w", encoding="utf-8") as f:
        for a, themes in results.items():
            for t in themes:
                reps = t.get("代表评论") or []
                if isinstance(reps, str):
                    reps = [reps]
                rec = {
                    "作者账号": a,
                    "需求名称": str(t.get("需求名称") or "")[:30],
                    "核心需求/痛点": str(t.get("核心需求/痛点") or ""),
                    "可延伸选题": str(t.get("可延伸选题") or ""),
                    "评论类型": (t.get("评论类型") if t.get("评论类型") in TYPES else "其他"),
                    "样本数": int(t.get("样本数") or 0),
                    "代表评论": "\n".join(str(x)[:REP_LEN] for x in reps[:3]),
                    "总点赞数": int(t.get("总点赞数") or 0),
                }
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                n += 1

    print(f"\n完成 {time.time()-t0:.0f}s | {len(groups)} 个作者 → {n} 条需求主题")
    print(f"→ {args.out}")
    print(f"（对比：原来逐条 {len(rows)} 行，压缩到 {n} 行，"
          f"压缩比 {len(rows)/n:.0f}:1）" if n else "")


if __name__ == "__main__":
    main()

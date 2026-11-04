# -*- coding: utf-8 -*-
"""从评论区挖「观众到底在集中要什么」。

三个角度：
  1. 被规则判为「重复」的评论 —— **重复次数本身就是需求强度**
     （同一条视频下几十上百人发同样的话，说明这个诉求非常集中）
  2. 「求 X」「怎么 X」这类显式需求模式 —— 最直白的表达
  3. 按作者分组，看每个作者的观众各自要什么

不依赖分词库，用模式提取 + 规范化文本频次。
"""

import collections
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, BASE)
import comments_filter as F

ALL_PATH = os.path.join(BASE, "comments_all.ndjson")

# 显式需求模式
PATTERNS = [
    ("求X", re.compile(r"求\s*([\u4e00-\u9fa5A-Za-z0-9]{1,10})")),
    ("蹲X", re.compile(r"蹲\s*([\u4e00-\u9fa5A-Za-z0-9]{1,10})")),
    ("想要X", re.compile(r"(?:想要|想要个|想要一份)\s*([\u4e00-\u9fa5A-Za-z0-9]{1,10})")),
    ("有没有X", re.compile(r"有没有\s*([\u4e00-\u9fa5A-Za-z0-9]{1,10})")),
    ("怎么X", re.compile(r"怎么\s*([\u4e00-\u9fa5A-Za-z0-9]{1,10})")),
    ("在哪X", re.compile(r"在哪\s*([\u4e00-\u9fa5A-Za-z0-9]{1,10})")),
    ("出个X", re.compile(r"出个\s*([\u4e00-\u9fa5A-Za-z0-9]{1,10})")),
]

# 这些抓出来没意义（语气词 / 太泛）
STOP = {"了", "个", "我", "你", "他", "的", "这", "那", "什么", "一下", "一点",
        "吗", "呢", "吧", "啊", "呀", "求", "个吧", "人", "事", "做", "用",
        "个教程", "个链接", "个方法", "个视频", "个文档", "个模板"}


def load(path):
    return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]


def clean_text(t):
    t = F.URL_RE.sub(" ", str(t or ""))
    t = F.EMOJI_RE.sub(" ", t)
    t = F.AT_RE.sub(" ", t)
    t = F.HASH_RE.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


rows = load(ALL_PATH)
print(f"全量评论 {len(rows)} 条\n")

# ---------------------------------------------------------------- 角度 1
print("=" * 74)
print("一、被规则判为「重复」的评论 —— 重复次数 = 需求集中度")
print("=" * 74)
dups = [r for r in rows if r["过滤原因"] == "dup"]
g = collections.Counter()
author_of = {}
for r in dups:
    k = (r["视频key"], clean_text(r["评论"])[:80])
    g[k] += 1
    author_of[k] = r["作者"]

print(f"判重复 {len(dups)} 条，去重后 {len(g)} 种不同文本\n")
print("重复次数 >= 5 的（这些是观众在集中索要同一份东西）：")
n = 0
for (k, t), c in g.most_common(60):
    if c < 5:
        break
    a = author_of[(k, t)]
    print(f"  x{c:<4} [{a[:12]:<14}] {t[:64]}")
    n += 1
print(f"  ...共 {sum(1 for v in g.values() if v >= 5)} 种文本重复 >= 5 次")

# ---------------------------------------------------------------- 角度 2
print()
print("=" * 74)
print("二、显式需求模式（求 X / 怎么 X / 有没有 X …）")
print("=" * 74)
hit = collections.defaultdict(collections.Counter)
for r in rows:
    t = clean_text(r["评论"])
    if not t:
        continue
    for label, pat in PATTERNS:
        for m in pat.findall(t):
            m = m.strip()
            if not m or m in STOP or len(m) < 2:
                continue
            hit[label][m] += 1

for label, _ in PATTERNS:
    c = hit.get(label)
    if not c:
        continue
    total = sum(c.values())
    print(f"\n【{label}】共 {total} 次，top15：")
    for w, n in c.most_common(15):
        print(f"    {n:>4}  {w}")

# ---------------------------------------------------------------- 角度 3
print()
print("=" * 74)
print("三、按作者看：他的观众各自在要什么")
print("=" * 74)
by_author = collections.defaultdict(collections.Counter)
for r in rows:
    t = clean_text(r["评论"])
    if not t:
        continue
    for label, pat in PATTERNS:
        for m in pat.findall(t):
            m = m.strip()
            if not m or m in STOP or len(m) < 2:
                continue
            by_author[r["作者"]][m] += 1

for a, c in sorted(by_author.items(), key=lambda x: -sum(x[1].values()))[:12]:
    top = "、".join(f"{w}({n})" for w, n in c.most_common(6))
    print(f"\n  {a[:18]}（共 {sum(c.values())} 次需求表达）")
    print(f"    {top}")

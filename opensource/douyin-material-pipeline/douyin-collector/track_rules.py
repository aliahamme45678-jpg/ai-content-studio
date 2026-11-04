# -*- coding: utf-8 -*-
"""赛道白名单：判断一个作者是不是 AI / 跨境赛道。

**规则：只采 AI 或者跨境的评论，其他的不采。** 用在两处：

1. 采集前 —— `_comments_plan.py` 拉「有链接的视频清单」时按作者过滤，
   非本赛道作者的视频根本不进采集队列
2. 清理时 —— 把已经进库的非本赛道作者的主题删掉

判定来源两个，合并后 override 优先：

- `track_map.json`      —— `track_judge.py` 用 qwen-plus 判的，可重跑覆盖
- `track_override.json` —— 人工裁定，模型对小样本作者判不准时用

用法：
    from track_rules import track_of, is_kept, KEEP
    track_of("跨境出海运营站")   # -> "跨境"
    is_kept("墨鱼")              # -> False
"""

import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
MAP = os.path.join(BASE, "track_map.json")
OVERRIDE = os.path.join(BASE, "track_override.json")

KEEP = ("AI", "跨境")
OTHER = "其他"

_cache = None


def _load(p):
    if not os.path.exists(p):
        return {}
    try:
        d = json.load(open(p, encoding="utf-8"))
    except Exception:
        return {}
    return {k: v for k, v in d.items() if not k.startswith("_")}


def table():
    global _cache
    if _cache is None:
        t = _load(MAP)
        t.update(_load(OVERRIDE))  # 人工裁定覆盖模型
        _cache = t
    return _cache


def track_of(author):
    """没判过的作者默认「其他」—— 宁可漏采，也别把无关赛道的评论放进来。"""
    return table().get(author, OTHER)


def is_kept(author):
    return track_of(author) in KEEP


def kept_authors(authors):
    return [a for a in authors if is_kept(a)]

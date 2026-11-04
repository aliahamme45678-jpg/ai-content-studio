# -*- coding: utf-8 -*-
"""摸清蒸馏库里有多少条有链接，产出待采集评论的视频清单。

只读，不改任何飞书数据。
产出：_comments_todo.json（待采集清单）+ 控制台统计
"""
import collections
import json
import os
import re
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
BASE_TOKEN = "IjbBblKh0amzztsiExVc1PqInfd"
TABLE_ID = "tbljaR1tbDTzyl0s"
sys.stdout.reconfigure(encoding="utf-8")

sys.path.insert(0, BASE)
from track_rules import is_kept, track_of  # noqa: E402  只采 AI / 跨境赛道


def norm(u):
    """URL 归一化：剥掉飞书 text 字段的 [url](url) 壳。"""
    u = str(u or "")
    if u.startswith("[") and "](" in u:
        u = u[u.index("](") + 2:].rstrip(")")
    m = re.search(r"/(?:video|note)/(\d+)", u)
    return m.group(1) if m else u.split("?")[0].rstrip("/")


def pull():
    """全量拉取，--limit 200 是硬上限必须翻页。"""
    rows, offset = [], 0
    out = os.path.join(BASE, "_distill_fresh.ndjson")
    while True:
        part = out if offset == 0 else out.replace(".ndjson", f"_{offset}.ndjson")
        subprocess.run(["lark-cli.cmd", "base", "+record-list", "--base-token", BASE_TOKEN,
                        "--table-id", TABLE_ID, "--format", "ndjson", "--output", part,
                        "--limit", "200", "--offset", str(offset), "--as", "user"],
                       cwd=BASE, capture_output=True)
        if not os.path.exists(part):
            break
        got = [json.loads(l) for l in open(part, encoding="utf-8") if l.strip()]
        rows += got
        if len(got) < 200:
            break
        offset += 200
        if offset > 5000:
            break
    return rows


rows = pull()
print(f"蒸馏库全量：{len(rows)} 行")

withlink = [r for r in rows if (r.get("来源链接") or "").strip()]
print(f"有链接：{len(withlink)} 行")

# 按归一化链接去重（同一视频可能多条记录）
by_link = {}
for r in withlink:
    k = norm(r.get("来源链接"))
    if not k:
        continue
    if k not in by_link:
        by_link[k] = r
print(f"去重后视频数：{len(by_link)}")

# 赛道过滤：只采 AI 赛道和跨境赛道的作者，其他赛道（赚钱思维、人生感悟、
# 英语学习、纯自媒体运营…）不进采集队列。规则见 track_rules.py
cut = {k: r for k, r in by_link.items() if not is_kept(r.get("作者") or "")}
by_link = {k: r for k, r in by_link.items() if is_kept(r.get("作者") or "")}
print(f"赛道过滤后：{len(by_link)} 条（剔掉 {len(cut)} 条非 AI/跨境）")
if cut:
    cc = collections.Counter((r.get("作者") or "(空)") for r in cut.values())
    for a, n in cc.most_common():
        print(f"  ✗ {a:<24} {n} 条  [{track_of(a)}]")

print("\n按作者分布：")
cnt = collections.Counter((r.get("作者") or "(空)") for r in by_link.values())
for a, n in cnt.most_common():
    print(f"  {a:<24} {n}")

todo = []
for k, r in by_link.items():
    todo.append({
        "key": k,
        "link": str(r.get("来源链接") or ""),
        "作者": r.get("作者") or "",
        "标题": r.get("标题") or "",
        "点赞数": r.get("点赞数") or 0,
        "评论数": r.get("评论数") or 0,
        "record_id": r.get("record_id") or "",
    })
json.dump(todo, open(os.path.join(BASE, "_comments_todo.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print(f"\n待采集清单已写 _comments_todo.json（{len(todo)} 条）")

# 评论数合计，估算工作量
tot = sum(int(t["评论数"] or 0) for t in todo)
print(f"这些视频的评论总数（表里记录的）：{tot}")

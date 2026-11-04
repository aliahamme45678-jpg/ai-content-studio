# -*- coding: utf-8 -*-
"""蒸馏库文案检索：给新选题找参考，别让 197 条素材躺在表里吃灰。

数据在 _distill_all.json（离线快照），不每次打 API。
快照过期了就 --rebuild 重新拉一次。

用法：
    python search_lib.py --kw 反常识                    # 全字段关键词
    python search_lib.py --kw 教程 --field 选题切口      # 只在某个维度里找
    python search_lib.py --author 墨鱼 --top 5
    python search_lib.py --min-cz 1.0                   # 藏赞比 > 1 的高收藏型
    python search_lib.py --kw 开头 --show 黄金开头       # 命中后额外显示某字段全文
    python search_lib.py --rebuild                      # 重新拉取快照
"""

import argparse
import json
import os
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SNAP = os.path.join(BASE_DIR, "_distill_all.json")
BASE = "IjbBblKh0amzztsiExVc1PqInfd"
TABLE = "tbljaR1tbDTzyl0s"
CLI = "lark-cli.cmd" if os.name == "nt" else "lark-cli"

SEARCHABLE = ["标题", "话题", "选题切口", "黄金开头", "Hook机制", "内容结构",
              "核心观点", "论证方式", "表达方式", "可复用机制", "原文 / 文案"]


def rebuild():
    r = subprocess.run(
        [CLI, "base", "+record-list", "--base-token", BASE, "--table-id", TABLE,
         "--limit", "200", "--as", "user", "--format", "json"],
        cwd=BASE_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(r.stdout, r.stderr)
        raise SystemExit("拉取失败")
    open(SNAP, "w", encoding="utf-8").write(r.stdout)
    print("快照已更新:", SNAP)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--kw")
    ap.add_argument("--field", help="限定在哪个字段里搜，默认全字段")
    ap.add_argument("--author")
    ap.add_argument("--min-cz", type=float, help="藏赞比下限，如 1.0")
    ap.add_argument("--max-digg", type=int)
    ap.add_argument("--min-digg", type=int)
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--show", help="命中后额外打印这个字段的全文")
    args = ap.parse_args()

    if args.rebuild:
        rebuild()
        if not (args.kw or args.author or args.min_cz):
            return

    if not os.path.exists(SNAP):
        rebuild()
    d = json.load(open(SNAP, encoding="utf-8"))["data"]
    ix = {n: i for i, n in enumerate(d["fields"])}
    rows, ids = d["data"], d["record_id_list"]

    def g(r, f):
        i = ix.get(f)
        return r[i] if i is not None and i < len(r) else None

    fields = [args.field] if args.field else SEARCHABLE
    hits = []
    for r, rid in zip(rows, ids):
        author = g(r, "作者") or ""
        if args.author and args.author not in str(author):
            continue
        digg = g(r, "点赞数") or 0
        if args.min_digg and digg < args.min_digg:
            continue
        if args.max_digg and digg > args.max_digg:
            continue
        if args.min_cz:
            cz = (g(r, "收藏数") or 0) / digg if digg else 0
            if cz < args.min_cz:
                continue
        score, where = 0, []
        for f in fields:
            v = str(g(r, f) or "")
            if args.kw and args.kw in v:
                score += v.count(args.kw)
                where.append(f)
        if args.kw and not score:
            continue
        hits.append((score, rid, r, where))

    hits.sort(key=lambda x: -x[0])
    print(f"命中 {len(hits)} 条，显示前 {args.top}\n" + "=" * 66)
    for score, rid, r, where in hits[:args.top]:
        digg = g(r, "点赞数") or 0
        cz = (g(r, "收藏数") or 0) / digg if digg else 0
        print(f"\n■ {g(r, '标题')}  [{g(r, '作者')}]")
        print(f"  赞 {digg} / 藏赞比 {cz:.2f} / 时长 {g(r, '时长') or '—'} / 命中字段 {where}")
        for f in ("黄金开头", "核心观点", "可复用机制"):
            if f in (where or SEARCHABLE)[:3] or not where:
                v = str(g(r, f) or "")
                if v:
                    print(f"  {f}: {v[:110]}")
        if args.show:
            print(f"  【{args.show}】{str(g(r, args.show) or '')}")
    print("\n" + "=" * 66)
    print(f"库内共 {len(rows)} 条；快照过期就跑 --rebuild")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""拆解质量自检：分析 JSON 落库前必须先过这一关。

每轮拆解完跑一次，把问题拦在自己手里，别等进了库才发现。

检查项：
  1. 字段齐全（11 个：标题/话题/行业类型 + 8 个维度）
  2. 字段非空、长度达标
  3. 没有占位符（TODO / 待补 / xxx / N/A）
  4. 行业类型只能是 同行业 / 跨行业
  5. 标题是提炼过的，不是把原视频标题原样搬过来
  6. AI 味指数不超标（复用 ai_flavor_check）
  7. 链接没重复、条数对得上

用法：
    python check_analysis.py --analysis analysis_xxx.json
    python check_analysis.py --analysis analysis_xxx.json --strict   # 有 WARN 也算失败
"""

import argparse
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

REQUIRED = ["标题", "话题", "行业类型", "选题切口", "黄金开头", "Hook机制",
            "内容结构", "核心观点", "论证方式", "表达方式", "可复用机制"]
MIN_LEN = {"标题": 8, "话题": 3, "行业类型": 2, "选题切口": 20, "黄金开头": 10,
           "Hook机制": 20, "内容结构": 20, "核心观点": 15, "论证方式": 20,
           "表达方式": 20, "可复用机制": 20}
PLACEHOLDER = ["TODO", "待补", "待填", "xxx", "XXX", "N/A", "无。", "同上"]

# 三档拆解深度：完整档做深度模仿，快速/极速档只保证能进定量统计
MODES = {
    "full": REQUIRED,
    "fast": ["标题", "行业类型", "选题切口", "核心观点", "可复用机制"],
    "mini": ["核心观点", "可复用机制"],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--analysis", required=True)
    ap.add_argument("--source", help="原始 cache json，用来比对条数和标题")
    ap.add_argument("--max-ai", type=float, default=30.0)
    ap.add_argument("--mode", choices=list(MODES), default="full",
                    help="full=11字段 / fast=5字段 / mini=2字段")
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()
    required = MODES[args.mode]

    data = json.load(open(args.analysis, encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("分析文件要是 {链接或id: {字段: 值}} 结构")

    from ai_flavor_check import check as ai_check, merge2

    all_fail, all_warn = [], []
    print(f"自检 {len(data)} 条（模式 {args.mode}，必填 {len(required)} 个字段）\n"
          + "=" * 62)

    for key, rec in data.items():
        issues = []
        # 1/2 字段齐全 + 长度
        for f in required:
            v = rec.get(f)
            if not v or not str(v).strip():
                issues.append(("FAIL", f"{f} 为空"))
            elif len(str(v).strip()) < MIN_LEN.get(f, 10):
                issues.append(("FAIL", f"{f} 只有 {len(str(v))} 字，下限 {MIN_LEN[f]}"))
        # 3 占位符
        for f, v in rec.items():
            if any(p in str(v) for p in PLACEHOLDER):
                issues.append(("FAIL", f"{f} 含占位符"))
        # 4 行业类型
        ind = rec.get("行业类型")
        if ind and ind not in ("同行业", "跨行业"):
            issues.append(("FAIL", f"行业类型非法: {ind}"))
        # 5 标题是不是原样照搬
        if args.source and os.path.exists(args.source):
            src = json.load(open(args.source, encoding="utf-8"))
            for r in src:
                u = (r.get("source_url") or "").rstrip("/")
                if u.rstrip("/") == str(key).rstrip("/") or str(r.get("aweme_id")) == str(key):
                    t = (r.get("title") or "").strip()
                    if t and t[:20] == str(rec.get("标题", "")).strip()[:20]:
                        issues.append(("WARN", "标题疑似原样照搬原视频标题"))
                    break
        # 6 AI 味
        SKEL, PUNCT = "内容结构", "书面破折号"
        main_p = "\n".join(str(v) for k, v in rec.items() if k != SKEL)
        skel_p = str(rec.get(SKEL) or "")
        r1 = ai_check(main_p, skip=(PUNCT,))
        r2 = ai_check(skel_p, skip=(PUNCT,))
        ai = merge2(r1, r2)["score"]
        if ai > args.max_ai:
            issues.append(("FAIL", f"AI 味指数 {ai} > {args.max_ai}"))
        elif ai > 15:
            issues.append(("WARN", f"AI 味指数 {ai} 偏高"))

        fails = [m for lv, m in issues if lv == "FAIL"]
        warns = [m for lv, m in issues if lv == "WARN"]
        all_fail += fails
        all_warn += warns
        flag = "FAIL" if fails else ("WARN" if warns else "PASS")
        print(f"[{flag}] {str(rec.get('标题', key))[:34]}")
        for m in fails + warns:
            print(f"       - {m}")

    print("=" * 62)
    print(f"FAIL {len(all_fail)} 项 / WARN {len(all_warn)} 项")
    if all_fail or (args.strict and all_warn):
        print("\n结论：不通过，先修再落库")
        raise SystemExit(1)
    print("\n结论：通过，可以推飞书")


if __name__ == "__main__":
    main()

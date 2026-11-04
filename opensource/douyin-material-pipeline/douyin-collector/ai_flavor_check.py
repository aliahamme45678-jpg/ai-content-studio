# -*- coding: utf-8 -*-
"""AI 味检测器。

背景：这套流水线产出的分析文本（8 维度拆解）是模型写的，容易带模板腔。
本脚本用**本库 197 条真人抖音口播文案**做对照基准，反过来检测"哪里不像人话"。

两类信号：
  - AI 味（扣分）：连接词堆砌、空洞动词、书面腔、泛指主语、破折号/括号腔
  - 真人味（加分）：口语填充、第二人称"你"、具体数字、自问自答、短句

用法：
    python ai_flavor_check.py --file 分析.md              # 检测一个文件
    python ai_flavor_check.py --json analysis_xxx.json    # 检测分析 JSON（逐条）
    python ai_flavor_check.py --text "一段话"              # 检测一段话
    python ai_flavor_check.py --calibrate                 # 用蒸馏库真人语料校准真人基准
"""

import argparse
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ---- AI 味词表：写得越具体越能定位到句子 ----
AI_PATTERNS = {
    "顺序腔（首先/其次/最后）": [
        r"首先", r"其次", r"再次", r"最后[，,。]", r"第一[，,、]", r"第二[，,、]", r"第三[，,、]"],
    "连接腔（此外/然而/因此）": [
        r"此外", r"另外[，,]", r"然而", r"因此", r"故而", r"与此同时", r"值得一提", r"值得一提",
        r"值得注意的是", r"总而言之", r"综上所述", r"总的来说", r"一方面.*?另一方面"],
    "空洞动词（赋能/助力/打造）": [
        r"赋能", r"助力", r"加持", r"打造[一一个]", r"构建", r"推进", r"促进[了了]",
        r"全方位", r"一站式", r"精细化", r"系统性[地地]?", r"高质量[的地地]?"],
    "空洞形容（显著/极大地/深度）": [
        r"显著[的地地]?", r"极大[的地地]?", r"大幅", r"深度[的地地]?", r"全面[的地地]?",
        r"进一步", r" effectively", r"本质上[，,]"],
    "泛指主语（人们/大家/我们）": [
        r"人们", r"大家[都都]", r"每个人都", r"有些人", r"我们[应该需要可以]"],
    "书面腔（诸如/譬如/鉴于）": [
        r"诸如", r"譬如", r"鉴于", r"换言之", r"从根本上", r"换言之"],
    # 只保留破折号：中文里 —— 确实偏书面腔。
    # 括注和冒号列表一律不判 —— 实测在这类文本里几乎全是"举例"和"流程骨架"，
    # 属功能性写法，判成 AI 味会大量误报（第一轮自检踩过）。
    "书面破折号": [r"——"],
    "套话（不是…而是…）": [
        r"不是.{1,12}?而是", r"不仅仅是?.{1,12}?更是", r"与其.{1,10}?不如"],
}

# ---- 真人味词表：命中越多越像人话 ----
HUMAN_PATTERNS = {
    "口语填充": [r"呃", r"啊", r"吧[。？?]", r"呢[。？?]", r"呀", r"哦", r"嗯",
                 r"对吧", r"ok", r"就是", r"然后", r"结果", r"其实", r"真的"],
    "第二人称": [r"你[的们]?", r"你们"],
    "具体数字": [r"\d+[个条块分秒年月份千万元]"],
    "自问自答": [r"为什么", r"怎么[办做]", r"吗？", r"呢？", r"凭什么"],
}


def split_sentences(text):
    return [s.strip() for s in re.split(r"[。！？!?\n]", text) if len(s.strip()) > 1]


def check(text, label="", skip=()):
    """skip: 要跳过的类别名。骨架字段（内容结构）里的括号是流程标记，
    不是 AI 腔，检测时要跳过标点腔，否则会严重误报。"""
    n = max(len(text), 1)
    hits, detail = {}, []
    for cat, pats in AI_PATTERNS.items():
        if cat in skip:
            continue
        cnt = 0
        for p in pats:
            for m in re.finditer(p, text):
                cnt += 1
                s = max(0, m.start() - 18)
                detail.append((cat, m.group(0), text[s:m.end() + 18].replace("\n", " ")))
        if cnt:
            hits[cat] = cnt
    human = {}
    for cat, pats in HUMAN_PATTERNS.items():
        cnt = sum(len(re.findall(p, text)) for p in pats)
        if cnt:
            human[cat] = cnt

    sents = split_sentences(text)
    avg_len = sum(len(s) for s in sents) / max(len(sents), 1)

    ai_n = sum(hits.values())
    hu_n = sum(human.values())
    # 每千字 AI 味命中数，再减去真人味的对冲
    score = max(0, min(100, (ai_n / n * 1000) * 6 - (hu_n / n * 1000) * 1.2))
    return {
        "label": label,
        "chars": len(text),
        "ai_hits": hits,
        "ai_total": ai_n,
        "human_hits": human,
        "human_total": hu_n,
        "avg_sent_len": round(avg_len, 1),
        "score": round(score, 1),
        "detail": detail[:12],
    }


def merge2(a, b):
    """把"叙述字段"和"骨架字段"两次检测合并成一条结果。"""
    n = a["chars"] + b["chars"]
    hits = dict(a["ai_hits"])
    for k, v in b["ai_hits"].items():
        hits[k] = hits.get(k, 0) + v
    hu = dict(a["human_hits"])
    for k, v in b["human_hits"].items():
        hu[k] = hu.get(k, 0) + v
    ai_n, hu_n = a["ai_total"] + b["ai_total"], a["human_total"] + b["human_total"]
    score = max(0, min(100, (ai_n / max(n, 1) * 1000) * 6 - (hu_n / max(n, 1) * 1000) * 1.2))
    return {"label": a["label"], "chars": n, "ai_hits": hits, "ai_total": ai_n,
            "human_hits": hu, "human_total": hu_n, "avg_sent_len": a["avg_sent_len"],
            "score": round(score, 1), "detail": (a["detail"] + b["detail"])[:12]}


def grade(score):
    if score < 15:
        return "真人感强"
    if score < 30:
        return "轻微模板腔"
    if score < 50:
        return "AI 味明显，建议改"
    return "AI 味重，必须改"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file")
    ap.add_argument("--json")
    ap.add_argument("--text")
    ap.add_argument("--calibrate", action="store_true")
    args = ap.parse_args()

    if args.calibrate:
        calibrate()
        return

    if args.json:
        data = json.load(open(args.json, encoding="utf-8"))
        results = []
        SKEL, PUNCT = "内容结构", "标点腔（破折号/括注/冒号列表）"
        for k, v in (data.items() if isinstance(data, dict) else enumerate(data)):
            if isinstance(v, dict):
                label = (v.get("标题") or k)[:28]
                main_parts = [str(x) for kk, x in v.items() if kk != SKEL]
                skel_parts = [str(v.get(SKEL) or "")]
            else:
                label, main_parts, skel_parts = str(k)[:28], [str(v)], [""]
            r1 = check("\n".join(main_parts), label)
            r2 = check("\n".join(skel_parts), label, skip=(PUNCT,))
            results.append(merge2(r1, r2))
        results.sort(key=lambda x: -x["score"])
        print(f"检测 {len(results)} 条（按 AI 味从重到轻排）\n")
        for r in results:
            print(f"  {r['score']:>5.1f}  {grade(r['score']):<12} {r['label']}")
            if r["ai_hits"]:
                print(f"        命中: {r['ai_hits']}")
        worst = results[0]
        print(f"\n最重的一条：{worst['label']}")
        for cat, w, ctx in worst["detail"][:6]:
            print(f"  [{cat}] 「{w}」 …{ctx}…")
        return

    if args.file:
        text = open(args.file, encoding="utf-8").read()
        label = os.path.basename(args.file)
    elif args.text:
        text, label = args.text, "输入文本"
    else:
        raise SystemExit("给 --file / --json / --text 之一")

    r = check(text, label)
    print(f"{label}  {len(text)} 字")
    print(f"AI 味指数 {r['score']} / 100  →  {grade(r['score'])}")
    print(f"平均句长 {r['avg_sent_len']} 字（真人口播通常 12~25）")
    print(f"\nAI 味命中 {r['ai_total']} 处: {r['ai_hits']}")
    print(f"真人味命中 {r['human_total']} 处: {r['human_hits']}")
    if r["detail"]:
        print("\n具体问题（前 12 处）:")
        for cat, w, ctx in r["detail"]:
            print(f"  [{cat}] 「{w}」 …{ctx}…")


def calibrate():
    """用蒸馏库里的真人抖音文案统计真人基准，看看真人到底长什么样。"""
    p = os.path.join(BASE_DIR, "_distill_all.json")
    if not os.path.exists(p):
        raise SystemExit("缺 _distill_all.json，先跑一次 record-list")
    d = json.load(open(p, encoding="utf-8"))["data"]
    ix = {n: i for i, n in enumerate(d["fields"])}
    texts = [r[ix["原文 / 文案"]] for r in d["data"]
             if ix.get("原文 / 文案") is not None and r[ix["原文 / 文案"]]]
    texts = [t for t in texts if len(t) > 200]
    print(f"真人语料 {len(texts)} 条，共 {sum(len(t) for t in texts)} 字\n")
    agg = {}
    lens = []
    for t in texts:
        r = check(t)
        lens.append(r["avg_sent_len"])
        for k, v in r["human_hits"].items():
            agg[k] = agg.get(k, 0) + v
    print("真人语料里的真人味特征命中总数:")
    for k, v in sorted(agg.items(), key=lambda x: -x[1]):
        print(f"  {k:<10} {v}")
    print(f"\n真人平均句长: {sum(lens)/len(lens):.1f} 字")
    scores = [check(t)["score"] for t in texts[:60]]
    print(f"真人文案的 AI 味指数: 中位 {sorted(scores)[len(scores)//2]:.1f} "
          f"（分析文本高于这个数就说明比真人还像机器）")


if __name__ == "__main__":
    main()

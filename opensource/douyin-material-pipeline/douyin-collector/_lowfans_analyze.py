# -*- coding: utf-8 -*-
"""
低粉爆款筛选：算 点赞粉丝比 / 互动密度 / 是否低粉爆款，出排序报告

判定规则（用户 2026-09-22 给定）：
    点赞粉丝比 = 点赞 ÷ 账号粉丝
        >10   → 潜力低粉爆款
        3~10  → 备选素材，谨慎翻拍
        <3    → 老粉流量，直接放弃
    互动密度 = (评论+收藏+转发) ÷ 点赞
        >=0.15 → 优质
        0.08~0.15 → 普通
        <0.08  → 浅层点赞，不要选
    综合：点赞粉丝比>10 且 互动密度>=0.08 → 低粉爆款候选

人工校验：时长 15-30s 可靠性高；>60s 翻车概率上升，优先短内容

用法：python _lowfans_analyze.py
"""
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))

MAIN = os.path.join(BASE, "cache_素材_AI选题_42条.json")
EXTRA = [
    os.path.join(BASE, "cache__retry1.json"),
    os.path.join(BASE, "cache__retry3.json"),
]
SRC = os.path.join(BASE, "素材_AI选题_42条.txt")


def load(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def norm(u):
    return (u or "").strip().rstrip("/")


def merge():
    by_url = {}
    order = []
    for r in load(MAIN):
        k = norm(r.get("source_url"))
        by_url[k] = r
        order.append(k)
    for p in EXTRA:
        for r in load(p):
            k = norm(r.get("source_url"))
            old = by_url.get(k)
            # 已有完整数据就不覆盖；否则用重试结果补上
            if old and old.get("aweme_id") and old.get("duration_ms"):
                continue
            by_url[k] = r
            if k not in order:
                order.append(k)
    # 按原始链接文件顺序输出
    with open(SRC, encoding="utf-8") as f:
        src = [norm(x) for x in f if x.strip()]
    out = []
    for k in src:
        if k in by_url:
            out.append(by_url[k])
    for k in order:
        if k not in src and k in by_url:
            out.append(by_url[k])
    return out


def judge(digg, follower, inter):
    """返回 (标签, 理由)"""
    if follower <= 0:
        return "数据不足", "粉丝数缺失，无法判定"
    if digg <= 0:
        return "数据不足", "点赞数缺失"
    ratio = digg / follower
    if ratio > 10 and inter >= 0.08:
        return "低粉爆款候选", "比值>10 且 互动密度≥0.08"
    if ratio >= 3 and inter >= 0.08:
        return "备选素材", "比值3~10，谨慎翻拍"
    if ratio < 3:
        return "放弃", "点赞粉丝比<3，老粉流量"
    if inter < 0.08:
        return "放弃", "互动密度<0.08，浅层点赞"
    return "放弃", "未同时满足两条"


def dur_hint(sec):
    if not sec:
        return "时长缺失"
    if sec <= 30:
        return "✅ 15-30s 区间，可靠性高"
    if sec <= 60:
        return "○ 30-60s，可接受"
    return "⚠️ >60s，翻车概率上升"


def main():
    rows = merge()
    out = []
    for r in rows:
        digg = r.get("digg_count") or 0
        cm = r.get("comment_count") or 0
        co = r.get("collect_count") or 0
        sh = r.get("share_count") or 0
        fo = r.get("follower_count") or 0
        dms = r.get("duration_ms") or 0
        sec = round(dms / 1000, 1) if dms else 0
        ratio = round(digg / fo, 2) if fo else 0
        inter = round((cm + co + sh) / digg, 4) if digg else 0
        label, why = judge(digg, fo, inter)
        out.append({
            "作者": r.get("author_name") or "",
            "标题": (r.get("title") or "").replace("\n", " ")[:60],
            "粉丝数": fo,
            "点赞": digg,
            "评论": cm,
            "收藏": co,
            "转发": sh,
            "时长秒": sec,
            "点赞粉丝比": ratio,
            "互动密度": inter,
            "是否低粉爆款": label,
            "判定理由": why,
            "时长提示": dur_hint(sec),
            "藏赞比": round(co / digg, 2) if digg else 0,
            "url": r.get("source_url") or "",
            "aweme_id": r.get("aweme_id") or "",
            "发布": r.get("publish_time") or "",
        })
    out.sort(key=lambda x: -x["点赞粉丝比"])

    # 控制台表
    print(f"\n{'作者':<22}{'粉丝':>7}{'点赞':>8}{'比':>7}{'密度':>8}{'时长':>7}  {'判定'}")
    print("-" * 84)
    for x in out:
        print(f"{x['作者'][:20]:<22}{x['粉丝数']:>7}{x['点赞']:>8}"
              f"{x['点赞粉丝比']:>7}{x['互动密度']:>8}{x['时长秒']:>7}  {x['是否低粉爆款']}")

    from collections import Counter
    c = Counter(x["是否低粉爆款"] for x in out)
    print("\n分布：", dict(c))

    with open(os.path.join(BASE, "低粉爆款_AI选题_42条.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("已写 低粉爆款_AI选题_42条.json")
    return out


if __name__ == "__main__":
    main()

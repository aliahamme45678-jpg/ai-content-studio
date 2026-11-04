# -*- coding: utf-8 -*-
"""蒸馏库存量行（有来源链接）按低粉爆款口径全量排序 + 出 xlsx/md

口径（用户 2026-09-22 拍板）：
    点赞粉丝比 = 点赞 / 作者粉丝数
    互动密度   = (评论+收藏+转发) / 点赞
    比值>=3 且 密度>=0.08 → 低粉爆款
"""
import json
from collections import Counter

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

SRC = ("_distill_v3.ndjson", "_distill_v3b.ndjson")
RATIO_MIN, INTER_MIN = 3.0, 0.08
NEAR_MIN = 2.0          # 接近阈值下界（备选池）

YELLOW = PatternFill("solid", fgColor="FFF2CC")
GREEN = PatternFill("solid", fgColor="D9EAD3")
GREY = PatternFill("solid", fgColor="F3F3F3")


def num(v):
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def load():
    rows = []
    for f in SRC:
        rows += [json.loads(l) for l in open(f, encoding="utf-8") if l.strip()]
    out = []
    seen = set()
    for r in rows:
        if not (r.get("来源链接") or ""):
            continue
        if r.get("record_id") in seen:
            continue
        seen.add(r.get("record_id"))
        dg, fo = num(r.get("点赞数")), num(r.get("作者粉丝数"))
        cm, co, sh = num(r.get("评论数")), num(r.get("收藏数")), num(r.get("转发数"))
        if not (dg and fo):
            continue
        ratio = dg / fo
        inter = (cm + co + sh) / dg if dg else 0
        cz = co / dg if dg else 0
        if ratio >= RATIO_MIN and inter >= INTER_MIN:
            tier, verdict = "低粉爆款", "低粉爆款"
        elif ratio >= NEAR_MIN and inter >= INTER_MIN:
            tier, verdict = "接近阈值", "备选池"
        elif inter < INTER_MIN:
            tier, verdict = "密度不达标", "放弃"
        else:
            tier, verdict = "老粉流量", "放弃"
        # 收藏型豁免提示（只是标注，不改判定）
        exempt = cz > 1 and inter >= 0.5
        out.append({
            "作者": r.get("作者") or "",
            "标题": (r.get("标题") or "")[:70],
            "点赞粉丝比": round(ratio, 2),
            "互动密度": round(inter, 3),
            "藏赞比": round(cz, 3),
            "作者粉丝数": int(fo),
            "点赞数": int(dg),
            "评论数": int(cm),
            "收藏数": int(co),
            "转发数": int(sh),
            "时长": r.get("时长") or "",
            "字数": r.get("字数") or 0,
            "档位": tier,
            "判定": verdict,
            "现爆款类型": (r.get("爆款类型") or [""])[0] if isinstance(r.get("爆款类型"), list) else (r.get("爆款类型") or ""),
            "收藏型豁免提示": "是" if exempt else "",
            "record_id": r.get("record_id") or "",
            "来源链接": str(r.get("来源链接") or "")[:120],
        })
    out.sort(key=lambda x: (-x["点赞粉丝比"], -x["互动密度"]))
    return out


def main():
    rows = load()
    print("有链接且指标完整:", len(rows))
    print(Counter(r["档位"] for r in rows))

    # ---------- xlsx ----------
    wb = Workbook()
    ws = wb.active
    ws.title = "低粉爆款筛选"
    cols = ["排名", "作者", "标题", "点赞粉丝比", "互动密度", "藏赞比",
            "作者粉丝数", "点赞数", "评论数", "收藏数", "转发数",
            "时长", "字数", "档位", "判定", "现爆款类型", "收藏型豁免提示",
            "record_id", "来源链接"]
    ws.append(cols)
    for c in range(1, len(cols) + 1):
        ws.cell(1, c).font = Font(bold=True)
        ws.cell(1, c).alignment = Alignment(horizontal="center")
    for n, r in enumerate(rows, 1):
        ws.append([n] + [r[k] for k in cols[1:]])
        row = n + 1
        fill = GREEN if r["档位"] == "低粉爆款" else (YELLOW if r["档位"] == "接近阈值" else None)
        if fill:
            for c in range(1, len(cols) + 1):
                ws.cell(row, c).fill = fill
        if r["收藏型豁免提示"]:
            ws.cell(row, cols.index("收藏型豁免提示") + 1).fill = GREY
    widths = [5, 16, 46, 11, 10, 9, 11, 9, 9, 9, 9, 10, 7, 10, 9, 11, 14, 16, 40]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = "A1:{}{}".format(get_column_letter(len(cols)), len(rows) + 1)
    xlsx = "蒸馏库_低粉爆款筛选_126条.xlsx"
    wb.save(xlsx)
    print("xlsx:", xlsx)

    # ---------- md ----------
    buckets = Counter(r["档位"] for r in rows)
    L = ["# 内容蒸馏库 · 低粉爆款筛选（有来源链接的 {} 条）".format(len(rows)), ""]
    L.append("口径：点赞粉丝比 >= 3 且 互动密度 >= 0.08 → 低粉爆款（用户 2026-09-22 拍板）")
    L.append("")
    L.append("| 档位 | 条数 | 占比 |")
    L.append("|---|---|---|")
    for k in ("低粉爆款", "接近阈值", "老粉流量", "密度不达标"):
        n = buckets.get(k, 0)
        L.append("| {} | {} | {:.1f}% |".format(k, n, n * 100.0 / max(len(rows), 1)))
    L.append("")
    L.append("## 一、低粉爆款（{} 条）".format(buckets.get("低粉爆款", 0)))
    L.append("")
    L.append("| # | 作者 | 比值 | 密度 | 粉丝 | 点赞 | 时长 | 标题 |")
    L.append("|---|---|---|---|---|---|---|---|")
    for n, r in enumerate([x for x in rows if x["档位"] == "低粉爆款"], 1):
        L.append("| {} | {} | {} | {} | {} | {} | {} | {} |".format(
            n, r["作者"], r["点赞粉丝比"], r["互动密度"], r["作者粉丝数"],
            r["点赞数"], r["时长"], r["标题"][:34]))
    L.append("")
    L.append("## 二、接近阈值 · 备选池（比值 2~3 且密度达标，{} 条）".format(buckets.get("接近阈值", 0)))
    L.append("")
    L.append("| # | 作者 | 比值 | 密度 | 粉丝 | 点赞 | 时长 | 标题 |")
    L.append("|---|---|---|---|---|---|---|---|")
    for n, r in enumerate([x for x in rows if x["档位"] == "接近阈值"], 1):
        L.append("| {} | {} | {} | {} | {} | {} | {} | {} |".format(
            n, r["作者"], r["点赞粉丝比"], r["互动密度"], r["作者粉丝数"],
            r["点赞数"], r["时长"], r["标题"][:34]))
    L.append("")
    ex = [x for x in rows if x["收藏型豁免提示"]]
    L.append("## 三、收藏型内容（藏赞比>1 且 密度>=0.5，{} 条）".format(len(ex)))
    L.append("")
    L.append("这批会被点赞粉丝比系统性淘汰 —— 收藏多说明有用，但破圈弱。要不要另开一档，看用户决定。")
    L.append("")
    L.append("| # | 作者 | 比值 | 密度 | 藏赞比 | 粉丝 | 收藏 | 标题 |")
    L.append("|---|---|---|---|---|---|---|---|")
    for n, r in enumerate(ex[:40], 1):
        L.append("| {} | {} | {} | {} | {} | {} | {} | {} |".format(
            n, r["作者"], r["点赞粉丝比"], r["互动密度"], r["藏赞比"],
            r["作者粉丝数"], r["收藏数"], r["标题"][:30]))
    L.append("")
    md = "蒸馏库_低粉爆款筛选_20260922.md"
    open(md, "w", encoding="utf-8").write("\n".join(L))
    print("md:", md)
    print("收藏型:", len(ex))


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""
给素材库做数据分析：算互动率 + 排序

在 fill_stats.py 抓完数据之后跑这个，输出：
  1. 一份排行榜 txt（按点赞排序 + 按收藏率排序）
  2. 一份 Excel（含藏赞比 / 评赞比 / 转赞比，按点赞降序）

互动率怎么看：
  藏赞比 = 收藏/点赞  越高说明内容越"值得存"，干货感强
  评赞比 = 评论/点赞  越高说明争议性或讨论欲强
  转赞比 = 转发/点赞  越高说明用户愿意替你传播

用法：
    python analyze.py -i "原文.txt" -d douyin_result.json
    python analyze.py -i "原文.txt" -d douyin_result.json -o "报告.txt"
"""

import argparse
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from collector import BASE_DIR, extract_links  # noqa: E402


def parse_blocks(text):
    """按 '# 视频 N' 切成一段一段"""
    parts = re.split(r"(?m)^#\s*视频\s*(\d+)\s*$", text)
    blocks = []
    for i in range(1, len(parts), 2):
        num, body = parts[i], parts[i + 1]
        blocks.append({"no": num.strip(), "body": body})
    return blocks


def field(body, name):
    m = re.search(rf"(?m)^{name}：(.*)$", body)
    return m.group(1).strip() if m else ""


def content_text(body):
    """取出 '文案：' 之后的全部正文"""
    m = re.search(r"(?m)^文案：(.*)$", body)
    if not m:
        return ""
    return body[m.start(1):].strip()


def content_len(body):
    raw = content_text(body)
    if not raw:
        return 0, 0
    text_only = re.sub(r"\s+", "", raw)
    return len(text_only), len([x for x in raw.split("\n") if x.strip()])


def ratio(a, b):
    """安全除法，分母为 0 返回 0"""
    try:
        return a / b if b else 0.0
    except (TypeError, ZeroDivisionError):
        return 0.0


def build_rows(text, results):
    blocks = parse_blocks(text)
    rows = []
    for i, blk in enumerate(blocks):
        body = blk["body"]
        links = extract_links(body)
        r = results[i] if i < len(results) else {}
        digg = int(r.get("digg_count") or 0)
        comment = int(r.get("comment_count") or 0)
        collect = int(r.get("collect_count") or 0)
        share = int(r.get("share_count") or 0)
        chars, paras = content_len(body)
        rows.append({
            "idx": i + 1,      # 文件内的顺序，唯一
            "no": blk["no"],   # 原文写的 "# 视频 N"，可能重复

            "title": field(body, "标题"),
            "topic": field(body, "话题"),
            "url": links[0] if links else (r.get("url") or ""),
            "author": r.get("author_name") or "-",
            "publish": r.get("publish_time") or "-",
            "digg": digg,
            "comment": comment,
            "collect": collect,
            "share": share,
            "r_collect": ratio(collect, digg),
            "r_comment": ratio(comment, digg),
            "r_share": ratio(share, digg),
            "chars": chars,
            "paras": paras,
            "content": content_text(body),
        })
    return rows


def fmt_pct(x):
    return f"{x * 100:.1f}%"


def render_txt(rows):
    out = []
    out.append("抖音素材数据分析")
    out.append(f"共 {len(rows)} 条视频")
    out.append("")
    out.append("互动率说明：藏赞比=收藏/点赞（干货感） 评赞比=评论/点赞（讨论度） 转赞比=转发/点赞（传播力）")
    out.append("=" * 70)

    out.append("")
    out.append("【按点赞排序】")
    out.append("")
    for i, r in enumerate(sorted(rows, key=lambda x: -x["digg"]), 1):
        out.append(f"{i:2d}. [第{r['idx']}条] {r['title']}")
        out.append(f"     赞 {r['digg']} | 评 {r['comment']} | 藏 {r['collect']} | 转 {r['share']}")
        out.append(f"     藏赞比 {fmt_pct(r['r_collect'])} | 评赞比 {fmt_pct(r['r_comment'])} | "
                   f"转赞比 {fmt_pct(r['r_share'])}")
        out.append(f"     原文#{r['no']} | {r['author']} | {r['publish']} | 文案 {r['chars']} 字")
        out.append(f"     {r['url']}")
        out.append("")

    out.append("=" * 70)
    out.append("")
    out.append("【按藏赞比排序 —— 最值得收藏的干货】")
    out.append("")
    for i, r in enumerate(sorted(rows, key=lambda x: -x["r_collect"]), 1):
        out.append(f"{i:2d}. 藏赞比 {fmt_pct(r['r_collect'])}  赞 {r['digg']} 藏 {r['collect']}")
        out.append(f"     [第{r['idx']}条] {r['title']}")
        out.append("")

    out.append("=" * 70)
    out.append("")
    out.append("【按转赞比排序 —— 传播力最强】")
    out.append("")
    for i, r in enumerate(sorted(rows, key=lambda x: -x["r_share"]), 1):
        out.append(f"{i:2d}. 转赞比 {fmt_pct(r['r_share'])}  赞 {r['digg']} 转 {r['share']}")
        out.append(f"     [第{r['idx']}条] {r['title']}")
        out.append("")

    diggs = [r["digg"] for r in rows if r["digg"]]
    if diggs:
        out.append("=" * 70)
        out.append("")
        out.append("【整体】")
        out.append(f"点赞 中位 {sorted(diggs)[len(diggs) // 2]}  最高 {max(diggs)}  最低 {min(diggs)}")
        avg_c = sum(r["r_collect"] for r in rows) / len(rows)
        avg_s = sum(r["r_share"] for r in rows) / len(rows)
        out.append(f"平均藏赞比 {fmt_pct(avg_c)}   平均转赞比 {fmt_pct(avg_s)}")
        out.append("")
        out.append("高于平均藏赞比的（干货属性突出）：")
        for r in rows:
            if r["r_collect"] > avg_c:
                out.append(f"  - [第{r['idx']}条] {r['title']}  {fmt_pct(r['r_collect'])}")
    return "\n".join(out)


def export_xlsx(rows, path, extra_cols=None):
    """extra_cols: [(列名, row里的key, 列宽)]，用来加音频时长、音频路径这类附加列"""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = Workbook()
    ws = wb.active
    ws.title = "数据分析"

    # 没有文案（比如只给了链接）时，不摆空的字数列和全文列
    cols = [("排名", None, 6), ("条序", "idx", 6), ("原文编号", "no", 10),
            ("标题", "title", 42), ("话题", "topic", 22), ("作者", "author", 20),
            ("点赞", "digg", 10), ("评论", "comment", 10), ("收藏", "collect", 10),
            ("转发", "share", 10), ("藏赞比", "r_collect", 10), ("评赞比", "r_comment", 10),
            ("转赞比", "r_share", 10), ("发布时间", "publish", 18), ("链接", "url", 46)]
    if any(r.get("content") for r in rows):
        cols.insert(13, ("文案字数", "chars", 10))
        cols.append(("文案全文", "content", 90))
    if extra_cols:
        cols.extend(extra_cols)

    head_fill = PatternFill("solid", fgColor="667eea")
    for c, (name, _, width) in enumerate(cols, 1):
        cell = ws.cell(row=1, column=c, value=name)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = head_fill
        cell.alignment = Alignment(horizontal="center")
        ws.column_dimensions[cell.column_letter].width = width

    for i, r in enumerate(sorted(rows, key=lambda x: -x["digg"]), 2):
        ws.cell(row=i, column=1, value=i - 1)
        for c, (_, key, _) in enumerate(cols, 1):
            if key is None:
                continue
            cell = ws.cell(row=i, column=c, value=r.get(key))
            if key in ("r_collect", "r_comment", "r_share"):
                cell.number_format = "0.0%"
            elif key == "content":
                cell.alignment = Alignment(wrap_text=True, vertical="top")

    ws.freeze_panes = "A2"
    wb.save(path)
    return path


def main():
    ap = argparse.ArgumentParser(description="素材库数据分析：互动率 + 排序")
    ap.add_argument("-i", "--input", required=True, help="原始 txt（含标题/话题/文案）")
    ap.add_argument("-d", "--data", help="抓取结果 json（默认按输入文件名自动找缓存）")
    ap.add_argument("-o", "--output", help="报告 txt 路径")
    args = ap.parse_args()

    src = os.path.abspath(args.input)
    with open(src, "r", encoding="utf-8") as f:
        text = f.read()

    if args.data:
        data_path = args.data if os.path.isabs(args.data) else os.path.join(BASE_DIR, args.data)
    else:
        safe = re.sub(r'[\\/:*?"<>|\s]+', "_", os.path.splitext(os.path.basename(src))[0])
        data_path = os.path.join(BASE_DIR, f"cache_{safe}.json")
        if not os.path.exists(data_path):
            cands = sorted(glob.glob(os.path.join(BASE_DIR, "cache_*.json")),
                           key=os.path.getmtime, reverse=True)
            data_path = cands[0] if cands else os.path.join(BASE_DIR, "douyin_result.json")
    print(f"数据: {os.path.basename(data_path)}")
    with open(data_path, "r", encoding="utf-8") as f:
        results = json.load(f)

    rows = build_rows(text, results)
    if not rows:
        raise SystemExit("没解析出任何视频块，检查一下 txt 是不是 '# 视频 N' 这种格式")

    txt_path = args.output or os.path.join(
        os.path.dirname(src), os.path.splitext(os.path.basename(src))[0] + "_分析报告.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(render_txt(rows))

    xlsx_path = os.path.splitext(txt_path)[0] + ".xlsx"
    export_xlsx(rows, xlsx_path)

    print(f"解析到 {len(rows)} 条视频")
    print(f"报告: {txt_path}")
    print(f"表格: {xlsx_path}")


if __name__ == "__main__":
    main()

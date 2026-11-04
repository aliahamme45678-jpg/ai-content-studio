# -*- coding: utf-8 -*-
"""
给已有文案补数据

场景：你手上已经有一个 txt，里面是提取好的文案 + 视频链接，
      这个脚本只负责访问链接把互动数据（点赞/评论/收藏/转发/作者/发布时间）抓出来，
      按原顺序追加到每行链接下面，输出一份新 txt。不会重新提取文案，也不调用文案 API。

用法：
    python fill_stats.py -i "C:/path/to/你的文件.txt"
    python fill_stats.py -i input.txt -o output.txt
    python fill_stats.py -i input.txt --xlsx        # 顺带再导出一份 Excel
    python fill_stats.py -i input.txt --headless    # 不弹浏览器窗口

输出：默认在同目录生成 原文件名_with_data.txt
"""

import argparse
import asyncio
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from collector import (BASE_DIR, LinkCollector, extract_aweme_id,  # noqa: E402
                       extract_links, export_to_excel, log)


def read_text(path):
    for enc in ("utf-8", "utf-8-sig", "gbk", "utf-16"):
        try:
            with open(path, "r", encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
        except Exception as e:
            raise SystemExit(f"读取失败: {e}")
    raise SystemExit("读取失败：试了 utf-8 / gbk / utf-16 都解不开这个文件")


def save_results(results, path):
    """存一份完整有序的结果，下次 --resume 靠它断点续跑"""
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def fill_text(text, results):
    """按链接把数据插回原文：链接所在行的下一行补一行数据"""
    # 结果里的 url 是跳转后的长链，原文里是短链，所以三种方式依次兜底
    mapping = {}
    for r in results:
        for key in (r.get("source_url"), r.get("url")):
            if key:
                mapping.setdefault(key, r)
    by_id = {r.get("aweme_id"): r for r in results if r.get("aweme_id")}

    lines = text.splitlines()
    # 链接在文中出现的序号 —— 抓取顺序与之一致，作为最后兜底
    seq, n = {}, 0
    for line in lines:
        for url in extract_links(line):
            seq.setdefault(url, n)
            n += 1

    out, ok_count, fail_count = [], 0, 0
    for line in lines:
        out.append(line)
        for url in extract_links(line):
            r = mapping.get(url) or by_id.get(extract_aweme_id(url))
            if r is None and seq.get(url, -1) < len(results) and url in seq:
                r = results[seq[url]]
            if r and (r.get("digg_count") or r.get("author_name")):
                out.append(
                    f"    [数据] 赞 {r['digg_count']} | 评 {r['comment_count']} | "
                    f"藏 {r['collect_count']} | 转 {r['share_count']} | "
                    f"作者 {r['author_name'] or '-'} | 发布 {r['publish_time'] or '-'}"
                )
                ok_count += 1
            else:
                out.append("    [数据] 未获取到")
                fail_count += 1
    return "\n".join(out), ok_count, fail_count


def main():
    ap = argparse.ArgumentParser(description="给已有文案 txt 补抖音互动数据")
    ap.add_argument("-i", "--input", required=True, help="输入 txt 路径")
    ap.add_argument("-o", "--output", help="输出 txt 路径（默认 原名_with_data.txt）")
    ap.add_argument("--xlsx", action="store_true", help="同时导出一份 Excel")
    ap.add_argument("--headless", action="store_true", help="无头模式，不弹浏览器")
    ap.add_argument("--reuse", help="复用上次抓取的结果 json，不重新访问链接")
    ap.add_argument("--resume", action="store_true", help="断点续跑：跳过已抓过的链接")
    args = ap.parse_args()

    src = os.path.abspath(args.input)
    if not os.path.exists(src):
        raise SystemExit(f"文件不存在: {src}")

    text = read_text(src)
    all_links = extract_links(text)
    if not all_links:
        raise SystemExit("这个文件里没找到任何链接")

    log(f"文件: {src}")
    log(f"识别到 {len(all_links)} 条链接")

    # 缓存按输入文件名隔离，避免不同素材文件互相串数据
    safe = re.sub(r'[\\/:*?"<>|\s]+', "_", os.path.splitext(os.path.basename(src))[0])
    cache_path = args.reuse or os.path.join(BASE_DIR, f"cache_{safe}.json")
    existing = []
    if args.resume and os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            existing = json.load(f)
        done = {r.get("source_url") for r in existing if r.get("source_url")}
        todo = [l for l in all_links if l not in done]
        log(f"断点续跑：已有 {len(existing)} 条，还需抓 {len(todo)} 条")
    else:
        todo = all_links

    if args.reuse:
        with open(args.reuse, "r", encoding="utf-8") as f:
            results = json.load(f)
        log(f"复用已有结果 {args.reuse}（{len(results)} 条），跳过抓取\n")
    else:
        if todo:
            log(f"开始抓取数据（不提取文案）  缓存: {os.path.basename(cache_path)}\n")
            collector = LinkCollector(todo, with_content=False, headless=args.headless,
                                      cache_file=os.path.basename(cache_path))
            existing += asyncio.run(collector.run())
        else:
            log("全部抓过了，直接出结果\n")
        # 按原文链接顺序重组，保证和 txt 里一一对应
        by_src = {r.get("source_url"): r for r in existing}
        results = [by_src[l] for l in all_links if l in by_src]
        save_results(results, cache_path)

    filled, ok_count, fail_count = fill_text(text, results)

    out_path = args.output or os.path.join(
        os.path.dirname(src),
        os.path.splitext(os.path.basename(src))[0] + "_with_data.txt",
    )
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(filled)

    log("\n" + "=" * 50)
    log(f"成功补数据: {ok_count} 条")
    log(f"未获取到  : {fail_count} 条")
    log(f"输出文件  : {out_path}")

    if args.xlsx:
        # 原文里已经有标题和文案了，回填进表格，别浪费
        try:
            from analyze import build_rows
            rows = build_rows(text, results)
            if len(rows) == len(results):
                for src_row, dst in zip(rows, results):
                    if src_row.get("title"):
                        dst["title"] = src_row["title"]
                    if src_row.get("content"):
                        dst["content"] = src_row["content"]
                log("已把原文中的标题和文案回填进表格")
            else:
                log(f"（原文 {len(rows)} 块 vs 数据 {len(results)} 条，数量对不上，跳过文案回填）")
        except Exception as e:
            log(f"（文案回填跳过: {e}）")
        xlsx_name = os.path.splitext(os.path.basename(src))[0] + "_数据汇总.xlsx"
        export_to_excel(results, xlsx_name, dirpath=os.path.dirname(src))


if __name__ == "__main__":
    main()

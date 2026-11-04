# -*- coding: utf-8 -*-
"""
一键流水线：链接 -> 数据 + 音频 + 转写文案 -> 总表

内部依次调用 fill_stats.py（抓数据）→ audio_step.py（提音频，复用官方
douyin-url-to-16k-wav，串行）→ asr_batch.py（阿里云转写，可并发）
→ merge_all.py（合并出表）。

用法：
    python pipeline.py -i "素材.txt" -o "总表.xlsx"
    python pipeline.py -i "素材.txt" --workers 6
    python pipeline.py -l "https://v.douyin.com/xxx/" "https://v.douyin.com/yyy/"
    python pipeline.py -i "素材.txt" --no-audio        # 只要数据，不提音频不转写
    python pipeline.py -i "素材.txt" --no-asr          # 提音频但不转写

产出（都在 AUDIO_ROOT/<素材文件名>/ 下，按批次隔离不会串）：
    audio_manifest.json / asr_result.json / 一堆 wav
总表写到 -o 指定的路径。
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
AUDIO_ROOT = r"D:\douyin_audio"


def log(msg=""):
    print(msg, flush=True)


def safe_name(path):
    return re.sub(r'[\\/:*?"<>|\s]+', "_", os.path.splitext(os.path.basename(path))[0])


def run(cmd, desc):
    log("\n" + "=" * 60)
    log(f"【{desc}】")
    log("=" * 60)
    r = subprocess.run(cmd, cwd=BASE_DIR)
    if r.returncode != 0:
        log(f"\n警告：{desc} 退出码 {r.returncode}，继续下一步（失败的条会标出来）")
        return False
    return True


def main():
    ap = argparse.ArgumentParser(description="抖音素材一键流水线")
    ap.add_argument("-i", "--input", help="素材 txt（含链接，可带文案）")
    ap.add_argument("-l", "--links", nargs="*", help="直接跟链接，可多条")
    ap.add_argument("-o", "--output", default="总表.xlsx", help="总表输出路径")
    ap.add_argument("--workers", type=int, default=4, help="仅转写并发数（音频强制串行）")
    ap.add_argument("--no-audio", action="store_true", help="跳过音频和转写")
    ap.add_argument("--no-asr", action="store_true", help="提音频但不转写")
    ap.add_argument("--headless", action="store_true", help="抓数据时用无头浏览器")
    args = ap.parse_args()

    # 确定输入文件：给了裸链接就临时存成一个 txt
    src = args.input
    if not src:
        if not args.links:
            raise SystemExit("给 -i 一个 txt，或用 -l 直接跟链接")
        src = os.path.join(BASE_DIR, "_pipeline_input.txt")
        with open(src, "w", encoding="utf-8") as f:
            f.write("\n".join(args.links))
        log(f"链接已写入 {src}")
    src = os.path.abspath(src)
    if not os.path.exists(src):
        raise SystemExit(f"文件不存在: {src}")

    name = safe_name(src)
    cache = os.path.join(BASE_DIR, f"cache_{name}.json")
    audio_dir = os.path.join(AUDIO_ROOT, name)
    manifest = os.path.join(audio_dir, "audio_manifest.json")
    asr_json = os.path.join(audio_dir, "asr_result.json")

    t_all = time.time()
    log(f"素材: {src}")
    log(f"批次: {name}   转写并发: {args.workers}（音频固定串行）")

    # ① 抓互动数据
    cmd = [PY, "fill_stats.py", "-i", src]
    if args.headless:
        cmd.append("--headless")
    run(cmd, "① 抓取互动数据")

    # ①-b 去重：同一个视频可能有多条短链，抓完才知道 aweme_id。
    # 不在这里去重的话，音频和转写会为同一个视频白跑一遍，还多出一条 failed 记录。
    if os.path.exists(cache):
        try:
            with open(cache, encoding="utf-8") as f:
                data = json.load(f)
            seen, uniq = set(), []
            for r in data:
                k = str(r.get("aweme_id") or r.get("source_url") or id(r))
                if k in seen:
                    continue
                seen.add(k)
                uniq.append(r)
            if len(uniq) != len(data):
                with open(cache, "w", encoding="utf-8") as f:
                    json.dump(uniq, f, ensure_ascii=False, indent=1)
                log(f"①-b 去重：{len(data)} 条链接 -> {len(uniq)} 个视频")
        except Exception as e:
            log(f"（去重跳过: {e}）")

    if args.no_audio:
        log("\n（--no-audio：跳过音频和转写）")
        out = args.output
        run([PY, "merge_all.py", "--data", cache, "--source", src, "-o", out],
            "④ 合并出表")
        return

    # ② 提音频（复用官方 douyin-url-to-16k-wav，串行，含质检）
    run([PY, "audio_step.py", "--cache", cache, "--out", audio_dir],
        "② 提取音频 + 质检（官方脚本，串行）")

    # ③ 转写
    if args.no_asr:
        log("\n（--no-asr：跳过转写）")
        asr_json = None
    else:
        ok = run([PY, "asr_batch.py", "--audio", manifest, "--out", asr_json,
                  "--workers", str(args.workers)], "③ 阿里云转写")
        if not ok and not os.path.exists(asr_json):
            asr_json = None

    # ④ 合并
    cmd = [PY, "merge_all.py", "--data", cache, "--audio", manifest,
           "--source", src, "-o", args.output]
    if asr_json:
        cmd += ["--asr", asr_json]
    run(cmd, "④ 合并出表")

    log("\n" + "=" * 60)
    log(f"全部完成，总耗时 {time.time()-t_all:.1f}s")
    log(f"总表: {os.path.abspath(args.output)}")
    log(f"音频: {audio_dir}")


if __name__ == "__main__":
    main()

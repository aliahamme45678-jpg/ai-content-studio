#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
批量：抖音采集结果 JSON → 逐个提取 16kHz/mono WAV + 汇总报告

用法：
    python batch_extract.py <result.json> [-o 输出目录] [--state 登录态.json] [--limit N]

输入 JSON 是 douyin_collector 的采集结果（list，每项含 aweme_id / title / url 等）。
输出：输出目录下每条约 <aweme_id>.wav，外加 summary.json 和 summary.csv。
"""
import argparse
import csv
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from douyin_audio import Resolver, extract_audio_from_douyin

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("result_json")
    ap.add_argument("-o", "--out", default="audio_out")
    ap.add_argument("--state", default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--duration", type=float, default=None)
    ap.add_argument("--workers", type=int, default=1,
                    help="并发数，每个并发独用一个浏览器实例（默认 1 = 串行）")
    ap.add_argument("--retry", type=int, default=2,
                    help="单条失败后的重试次数（并发冷启动偶尔抓不到直链，默认 2）")
    args = ap.parse_args()

    if args.state:
        os.environ["DOUYIN_STATE"] = args.state

    items = json.load(open(args.result_json, encoding="utf-8"))
    if isinstance(items, dict):
        items = items.get("data") or items.get("list") or []
    if args.limit:
        items = items[:args.limit]

    os.makedirs(args.out, exist_ok=True)
    t_all = time.perf_counter()

    # 每个工作线程持有一个浏览器实例并复用（每条重启浏览器要多花 3~5 秒）
    _local = threading.local()
    _lock = threading.Lock()
    resolvers = []

    def get_resolver():
        if not hasattr(_local, "resolver"):
            _local.resolver = Resolver(state_path=args.state, verbose=False)
            with _lock:
                resolvers.append(_local.resolver)
        return _local.resolver

    def process(job, fixed_resolver=None):
        i, it = job
        aid = str(it.get("aweme_id") or i)
        title = (it.get("title") or "")[:60]
        page_url = it.get("url") or f"https://www.douyin.com/video/{aid}"
        out_wav = os.path.join(args.out, f"{aid}.wav")
        verbose = args.workers == 1

        print(f"\n[{i}/{len(items)}] {aid} | {title}", flush=True)
        if os.path.exists(out_wav) and os.path.getsize(out_wav) > 44:
            print("  已存在，跳过", flush=True)
            return {"aweme_id": aid, "title": title, "status": "skipped"}

        t0 = time.perf_counter()
        r = {}
        for attempt in range(args.retry + 1):
            try:
                if os.path.exists(out_wav) and os.path.getsize(out_wav) <= 44:
                    os.remove(out_wav)  # 清掉上一轮的空壳文件
                r = extract_audio_from_douyin(page_url, out=out_wav,
                                              duration=args.duration,
                                              state_path=args.state, verbose=verbose,
                                              resolver=fixed_resolver or get_resolver())
            except Exception as e:
                r = {"success": False, "error": f"{type(e).__name__}: {e}"}
            if r.get("success"):
                break
            if attempt < args.retry:
                print(f"  重试 {attempt + 1}/{args.retry} ...", flush=True)
        el = time.perf_counter() - t0

        si = r.get("stream_info", {})
        wav = r.get("wav", {})
        row = {
            "aweme_id": aid,
            "author": it.get("author_name", ""),
            "title": title,
            "status": "ok" if r.get("success") else "fail",
            "mode": r.get("mode", ""),
            "track": r.get("url_kind", ""),
            "audio_duration_s": si.get("duration_s") or wav.get("duration_s") or 0,
            "wav_duration_s": wav.get("duration_s", 0),
            "wav_mb": wav.get("size_mb", 0),
            "total_elapsed_s": round(el, 2),
            "ffmpeg_elapsed_s": (r.get("extract") or {}).get("elapsed_s", 0),
            "error": r.get("error", ""),
            "wav_path": out_wav if r.get("success") else "",
        }
        print(f"  → {row['status']} | 音频 {row['audio_duration_s']}s | "
              f"WAV {row['wav_mb']}MB | 耗时 {row['total_elapsed_s']}s"
              + (f" | ERR {row['error'][:60]}" if row["error"] else ""), flush=True)
        return row

    jobs = list(enumerate(items, 1))
    if args.workers > 1:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            rows = list(ex.map(process, jobs))
    else:
        rows = [process(j) for j in jobs]

    # 并发偶发抓不到直链（浏览器冷启动撞一起），失败项再串行补一轮：既快又稳
    failed_idx = [n for n, r in enumerate(rows) if r.get("status") != "ok"]
    if failed_idx and args.workers > 1:
        print(f"\n[补跑] {len(failed_idx)} 条失败项转串行重试 ...", flush=True)
        with Resolver(state_path=args.state, verbose=False) as rr:
            for n in failed_idx:
                rows[n] = process(jobs[n], fixed_resolver=rr)

    # 收尾关浏览器：Resolver 是在**子线程**里创建的，主线程调 close() 会抛
    # greenlet.error: cannot switch to a different thread（Playwright sync API 的线程归属限制）。
    # 以前这个异常会直接把脚本炸掉，导致 summary.json 根本写不出来 —— 看上去像"并发全失败"，
    # 其实 wav 全都生成好了（2026-09-22 实测 6/6 成功，只是收尾崩）。
    # 这里吞掉即可：进程退出时浏览器实例自然回收。
    for r in resolvers:
        try:
            r.close()
        except Exception as e:
            print(f"  [warn] 关闭浏览器实例失败（不影响结果）: {type(e).__name__}", flush=True)
    total_el = time.perf_counter() - t_all
    ok = [r for r in rows if r["status"] == "ok"]
    summary = {
        "total": len(rows),
        "ok": len(ok),
        "fail": len([r for r in rows if r["status"] == "fail"]),
        "skipped": len([r for r in rows if r["status"] == "skipped"]),
        "total_audio_seconds": round(sum(r.get("audio_duration_s") or 0 for r in ok), 1),
        "total_wav_mb": round(sum(r.get("wav_mb") or 0 for r in ok), 2),
        "wall_clock_s": round(total_el, 1),
        "avg_seconds_per_item": round(total_el / max(len(rows), 1), 2),
        "rows": rows,
    }

    with open(os.path.join(args.out, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    with open(os.path.join(args.out, "summary.csv"), "w", encoding="utf-8-sig",
              newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else ["aweme_id"])
        w.writeheader()
        w.writerows(rows)

    print("\n" + "=" * 60)
    print(f"完成 {summary['ok']}/{summary['total']} 成功，"
          f"失败 {summary['fail']}，跳过 {summary['skipped']}")
    print(f"音频总时长 {summary['total_audio_seconds']}s，WAV 总计 {summary['total_wav_mb']}MB")
    print(f"总墙钟耗时 {summary['wall_clock_s']}s，"
          f"平均每条 {summary['avg_seconds_per_item']}s")
    print(f"报告: {os.path.join(args.out, 'summary.json')} / summary.csv")


if __name__ == "__main__":
    main()

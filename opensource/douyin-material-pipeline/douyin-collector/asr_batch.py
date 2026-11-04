# -*- coding: utf-8 -*-
"""
批量把音频转成文字（复用 aliyun_asr.py 的百炼 Paraformer 通道）

输入：audio_manifest.json（extract_audio.py 产出）
输出：asr_result.json（对接契约格式），包含 source_url / aweme_id / text 等

用法：
    python asr_batch.py                       # 默认 4 并发
    python asr_batch.py --limit 1             # 先跑 1 条试试
    python asr_batch.py --workers 2           # 保守一点
    python asr_batch.py --audio D:\douyin_audio\audio_manifest.json
"""

import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

# 长音频（8 分钟）转写可能超过默认的 180 秒，放宽
os.environ.setdefault("ASR_MAX_WAIT", "600")

import aliyun_asr  # noqa: E402

DEFAULT_AUDIO = r"D:\douyin_audio\audio_manifest.json"
_print_lock = threading.Lock()


def log(msg):
    with _print_lock:
        print(msg, flush=True)


def process(index, total, item):
    path = item.get("audio_path") or ""
    url = item.get("source_url") or ""
    aid = item.get("aweme_id") or ""

    if not path or not os.path.exists(path):
        log(f"[{index}/{total}] 跳过（没音频文件）{url}")
        return index, {**_base(item), "status": "failed", "error": "没有音频文件"}

    t0 = time.time()
    status, err, text = "ok", "", ""
    for attempt in (1, 2):
        try:
            oss = aliyun_asr.upload_file(path)
            text = aliyun_asr.transcribe_file_url(oss)
            break
        except Exception as e:
            err = str(e)[-300:]
            if attempt == 2:
                status = "failed"
                text = ""
            else:
                time.sleep(3)

    el = time.time() - t0
    if status == "ok":
        log(f"[{index}/{total}] {len(text)} 字  用时 {el:.1f}s  {url}")
    else:
        log(f"[{index}/{total}] 失败 {err[:120]}  {url}")

    return index, {**_base(item), "text": text,
                   "char_count": len(text), "status": status, "error": err}


def _base(item):
    return {
        "source_url": item.get("source_url") or "",
        "aweme_id": item.get("aweme_id") or "",
        "audio_path": item.get("audio_path") or "",
        "duration_sec": item.get("duration_sec") or 0,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", default=DEFAULT_AUDIO, help="audio_manifest.json 路径")
    ap.add_argument("--out", help="asr_result.json 输出路径")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()

    if not aliyun_asr.is_ready():
        raise SystemExit("DASHSCOPE_API_KEY 没配好，检查 .env")
    if aliyun_asr.key_masked():
        log("警告：key 里带 *，多半被脱敏了，会报 InvalidApiKey")

    manifest = json.load(open(args.audio, encoding="utf-8"))
    items = manifest.get("items") or manifest
    if args.limit:
        items = items[:args.limit]
    log(f"待转写 {len(items)} 条，并发 {args.workers}\n")

    t_all = time.time()
    collected = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = [ex.submit(process, i + 1, len(items), it)
                   for i, it in enumerate(items)]
        for f in as_completed(futures):
            collected.append(f.result())
    collected.sort(key=lambda x: x[0])
    results = [c[1] for c in collected]

    out = args.out or os.path.join(os.path.dirname(os.path.abspath(args.audio)),
                                   "asr_result.json")
    json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
               "engine": "aliyun-paraformer-v2", "items": results},
              open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    ok_n = sum(1 for r in results if r.get("status") == "ok")
    chars = sum(r.get("char_count") or 0 for r in results)
    log("\n" + "=" * 56)
    log(f"成功 {ok_n}/{len(results)}   总字数 {chars}")
    log(f"总耗时 {time.time()-t_all:.1f}s")
    log(f"结果: {out}")


if __name__ == "__main__":
    main()

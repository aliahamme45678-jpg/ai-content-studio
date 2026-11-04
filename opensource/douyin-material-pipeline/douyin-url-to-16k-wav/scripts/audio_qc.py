#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
WAV 内容质检：送 ASR 之前先确认音频里真的有东西。

检查项：时长、平均音量、峰值、静音占比、是否疑似空音频。
静音占比过高 / 平均音量过低 → 大概率是空壳或纯噪音，别浪费 ASR 的钱。

用法：
    python audio_qc.py audio_out2                      # 扫整个目录
    python audio_qc.py audio_out2 -o qc.csv             # 顺便出 CSV
    python audio_qc.py audio_out2 --noise -40 --min-silence 0.5
"""
import argparse
import csv
import json
import os
import re
import subprocess
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN", "ffprobe")


def probe_duration(path):
    p = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", path],
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=120)
    try:
        return float((p.stdout or "0").strip())
    except Exception:
        return 0.0


def volumedetect(path):
    p = subprocess.run([FFMPEG, "-v", "info", "-i", path, "-af", "volumedetect",
                        "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=600)
    out = p.stderr or ""
    def grab(key):
        m = re.search(rf"{key}:\s*(-?[\d.]+)\s*dB", out)
        return float(m.group(1)) if m else None
    return {"mean_volume": grab("mean_volume"), "max_volume": grab("max_volume")}


def silencedetect(path, noise, min_silence):
    p = subprocess.run([FFMPEG, "-v", "info", "-i", path,
                        "-af", f"silencedetect=noise={noise}dB:d={min_silence}",
                        "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=600)
    out = p.stderr or ""
    total = 0.0
    starts = [float(x) for x in re.findall(r"silence_start:\s*([\d.]+)", out)]
    ends = [float(x) for x in re.findall(r"silence_end:\s*([\d.]+)", out)]
    for s, e in zip(starts, ends):
        total += max(0.0, e - s)
    # 结尾处可能只有 start 没有 end，补到总时长
    if len(starts) > len(ends):
        total += 0.0
    return {"silence_seconds": round(total, 2), "silence_segments": len(starts),
            "trailing_open_silence": len(starts) > len(ends)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir_or_file")
    ap.add_argument("-o", "--csv-out", default=None)
    ap.add_argument("--noise", type=float, default=-40.0,
                    help="静音判定阈值 dB（默认 -40）")
    ap.add_argument("--min-silence", type=float, default=0.5,
                    help="最短静音段秒数（默认 0.5）")
    args = ap.parse_args()

    if os.path.isfile(args.dir_or_file):
        files = [args.dir_or_file]
    else:
        files = sorted(os.path.join(args.dir_or_file, f)
                       for f in os.listdir(args.dir_or_file)
                       if f.lower().endswith(".wav"))

    rows = []
    for i, path in enumerate(files, 1):
        name = os.path.basename(path)
        dur = probe_duration(path)
        vol = volumedetect(path)
        sil = silencedetect(path, args.noise, args.min_silence)
        sil_pct = round(sil["silence_seconds"] / dur * 100, 1) if dur else 100.0
        mean = vol.get("mean_volume")

        # 判定：静音超 90% 或平均音量低于 -50dB → 疑似空音频
        if dur < 0.2:
            verdict = "EMPTY"
        elif sil_pct >= 90 or (mean is not None and mean < -50):
            verdict = "SUSPECT"
        elif sil_pct >= 60:
            verdict = "LOW"
        else:
            verdict = "OK"
        rows.append({"file": name, "duration_s": round(dur, 1),
                     "mean_volume_db": mean, "max_volume_db": vol.get("max_volume"),
                     "silence_s": sil["silence_seconds"],
                     "silence_pct": sil_pct,
                     "silence_segments": sil["silence_segments"],
                     "verdict": verdict})
        print(f"[{i}/{len(files)}] {name[:22]:22s} {dur:7.1f}s  "
              f"mean={mean}dB  静音{sil_pct:5.1f}%  -> {verdict}", flush=True)

    ok = sum(1 for r in rows if r["verdict"] == "OK")
    print("\n" + "=" * 62)
    print(f"共 {len(rows)} 个文件：OK {ok}，LOW {sum(1 for r in rows if r['verdict']=='LOW')}，"
          f"SUSPECT {sum(1 for r in rows if r['verdict']=='SUSPECT')}，"
          f"EMPTY {sum(1 for r in rows if r['verdict']=='EMPTY')}")
    print(f"静音阈值 {args.noise}dB / 最短 {args.min_silence}s")

    out_csv = args.csv_out or os.path.join(
        args.dir_or_file if os.path.isdir(args.dir_or_file) else ".", "qc.csv")
    if not rows:
        # 一个 wav 都没有（上游提取全失败）时不要崩，写个空表头就好
        print("没有可质检的 wav 文件，跳过写报告")
        return
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"报告: {out_csv}")


if __name__ == "__main__":
    main()

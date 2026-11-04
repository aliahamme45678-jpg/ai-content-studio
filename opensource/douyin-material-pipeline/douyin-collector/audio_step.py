# -*- coding: utf-8 -*-
"""
音频环节：复用本机已有的 douyin-url-to-16k-wav，不自己重写提取逻辑

内部依次调用官方脚本：
  1. batch_extract.py  批量提取（默认串行；并发会让部分条目抓不到直链）
  2. audio_qc.py       内容质检，送 ASR 前先跑，避免为空音频白花钱
  3. 把官方 summary.json 转成我们的 audio_manifest.json 契约格式（补上 source_url）

用法：
    python audio_step.py --cache cache_素材.json --out D:\douyin_audio\素材
    python audio_step.py --cache cache_x.json --limit 2        # 先跑 2 条试试
    python audio_step.py --cache cache_x.json --skip-qc        # 跳过质检
"""

import argparse
import csv
import json
import os
import subprocess
import sys
import time

# 依赖 douyin-url-to-16k-wav 技能包（音频提取 + 质检），它随本仓库一起分发。
# 查找顺序：环境变量 → 同仓库的兄弟目录 → 仓库内子目录 → 本机技能目录。
# 2026-10-17 改：原来是硬编码的本机技能路径，换机器必挂。
_HERE = os.path.dirname(os.path.abspath(__file__))
_CANDIDATES = [
    os.path.join(_HERE, "..", "douyin-url-to-16k-wav", "scripts"),   # 仓库同级
    os.path.join(_HERE, "douyin-url-to-16k-wav", "scripts"),         # 仓库内子目录
    os.path.join(os.path.expanduser("~"), ".workbuddy-ai", "skills",
                 "douyin-url-to-16k-wav", "scripts"),                # 技能目录
]
SCRIPTS = os.environ.get("DOUYIN_WAV_SCRIPTS") or next(
    (p for p in _CANDIDATES if os.path.isdir(p)), _CANDIDATES[0])
PY = sys.executable


def log(msg=""):
    print(msg, flush=True)


def run(cmd, desc, cwd=SCRIPTS):
    log("\n" + "-" * 56)
    log(f"{desc}")
    log("-" * 56)
    r = subprocess.run(cmd, cwd=cwd)
    if r.returncode != 0:
        log(f"（{desc} 退出码 {r.returncode}）")
        return False
    return True


def load_cache(cache_path, limit=None):
    """读采集结果，返回 list[dict]"""
    data = json.load(open(cache_path, encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("items") or data.get("results") or []
    if limit:
        data = data[:limit]
    return data


def build_input(rows, tmp_path):
    """把采集结果转成 batch_extract 要的格式，url 用原始短链"""
    items = [{
        "aweme_id": r.get("aweme_id", ""),
        "title": r.get("title", ""),
        "author_name": r.get("author_name", ""),
        "url": r.get("source_url") or r.get("url") or "",
    } for r in rows]
    json.dump(items, open(tmp_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return len(items)


def extract_direct(rows, out_dir, duration=None):
    """直链直通：采集阶段已经拿到 video.play_addr，直接 ffmpeg，**不启浏览器**。

    2026-09-22 新增。原来是"采集一遍 + 为拿音频再开一遍浏览器"（11.2s/条），
    现在 detail 接口里的 play_addr 直接可用，这一档能压到 ~2s/条。
    直链 token 实测几小时后才过期，同一次跑内用完全够。

    返回行结构与 batch_extract 的 summary rows 对齐，方便合并。
    """
    if SCRIPTS not in sys.path:
        sys.path.insert(0, SCRIPTS)
    from douyin_audio import extract_audio_from_url

    out_rows = []
    for i, r in enumerate(rows, 1):
        aid = str(r.get("aweme_id") or i)
        url = r.get("play_url") or ""
        out_wav = os.path.join(out_dir, f"{aid}.wav")
        title = (r.get("title") or "")[:50]
        log(f"[直通 {i}/{len(rows)}] {aid} | {title}")
        t0 = time.perf_counter()
        if os.path.exists(out_wav) and os.path.getsize(out_wav) > 44:
            log("  已存在，跳过")
            out_rows.append({"aweme_id": aid, "status": "ok",
                             "wav_path": out_wav, "wav_duration_s": 0,
                             "error": "", "total_elapsed_s": 0})
            continue
        try:
            res = extract_audio_from_url(url, out=out_wav, duration=duration,
                                         verbose=False)
        except Exception as e:
            res = {"success": False, "error": f"{type(e).__name__}: {e}"}
        el = round(time.perf_counter() - t0, 2)
        ok = bool(res.get("success"))
        wav = res.get("wav") or {}
        log(f"  → {'ok' if ok else 'fail'} | {wav.get('duration_s', 0)}s | "
            f"耗时 {el}s" + (f" | ERR {str(res.get('error'))[:60]}" if not ok else ""))
        out_rows.append({
            "aweme_id": aid,
            "status": "ok" if ok else "fail",
            "wav_path": out_wav if ok else "",
            "wav_duration_s": wav.get("duration_s", 0),
            "audio_duration_s": wav.get("duration_s", 0),
            "error": "" if ok else str(res.get("error") or "直链提取失败"),
            "total_elapsed_s": el,
        })
    return out_rows


def read_qc(out_dir):
    """读质检结论：文件名 -> 判定"""
    qc_path = os.path.join(out_dir, "qc.csv")
    if not os.path.exists(qc_path):
        return {}
    with open(qc_path, encoding="utf-8-sig") as f:
        return {row["file"]: row.get("verdict", "")
                for row in csv.DictReader(f)}


def to_manifest(out_dir, cache_rows, qc, extra_rows=None):
    """官方 summary.json（+ 直通行）-> 我们的 audio_manifest.json"""
    summary_path = os.path.join(out_dir, "summary.json")
    rows = []
    if os.path.exists(summary_path):
        rows = json.load(open(summary_path, encoding="utf-8")).get("rows", [])
    rows = list(rows) + list(extra_rows or [])
    by_id = {str(r.get("aweme_id")): r for r in cache_rows}

    items = []
    for row in rows:
        aid = str(row.get("aweme_id") or "")
        src = by_id.get(aid, {})
        ok = row.get("status") == "ok"
        path = row.get("wav_path") or ""
        verdict = qc.get(os.path.basename(path), "") if path else ""
        size = 0
        if path and os.path.exists(path):
            size = os.path.getsize(path)
        items.append({
            "source_url": src.get("source_url", ""),
            "aweme_id": aid,
            "audio_path": path,
            "sample_rate": 16000,
            "channels": 1,
            "duration_sec": row.get("wav_duration_s") or row.get("audio_duration_s") or 0,
            "file_size": size,
            "status": "ok" if ok else "failed",
            "error": "" if ok else (row.get("error") or "提取失败"),
            "qc": verdict,
        })

    manifest = {"generated_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%S+08:00"),
                "items": items}
    path = os.path.join(out_dir, "audio_manifest.json")
    json.dump(manifest, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    ok_n = sum(1 for x in items if x["status"] == "ok")
    log(f"\n音频清单: {path}")
    log(f"成功 {ok_n}/{len(items)}   总时长 "
        f"{sum(x['duration_sec'] for x in items)/60:.1f} 分钟")
    bad = [x for x in items if x.get("qc") in ("SUSPECT", "EMPTY")]
    if bad:
        log(f"质检有问题的 {len(bad)} 条（建议别送 ASR）:")
        for x in bad:
            log(f"  - {x['aweme_id']}  {x['qc']}")
    return path


def main():
    ap = argparse.ArgumentParser(description="音频环节：复用官方脚本提取 + 质检")
    ap.add_argument("--cache", required=True, help="采集结果 json")
    ap.add_argument("--out", required=True, help="音频输出目录")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--workers", type=int, default=4,
                    help="并发数，默认 4。实测可用（失败项会自动转串行补跑），"
                         "6 条约 32.6s vs 串行 67s")
    ap.add_argument("--duration", type=float, help="只取前 N 秒")
    ap.add_argument("--retry", type=int, default=2)
    ap.add_argument("--skip-qc", action="store_true")
    ap.add_argument("--state", help="登录态 json（默认用项目里的 douyin_state.json）")
    args = ap.parse_args()

    # 没显式传就默认用项目里的登录态：不传的话官方脚本会以"无登录态"跑，
    # 短链会被重定向到 iesdouyin 分享页，一条直链都抓不到（2026-09-22 踩过）。
    if not args.state:
        cand = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "douyin_state.json")
        if os.path.exists(cand):
            args.state = cand

    os.makedirs(args.out, exist_ok=True)
    tmp = os.path.join(args.out, "_batch_input.json")
    cache_rows = load_cache(args.cache, args.limit)
    log(f"待提取 {len(cache_rows)} 条 -> {args.out}")

    # 登录态：体检 + 快过期自动静默续期（用户 2026-09-22 授权持久化，不用每次扫码）
    try:
        import login_state
        info = login_state.ensure_fresh(verbose=True)
        if info.get("need_login"):
            log("  [登录态] 已过期 —— 跑 `python refresh_login.py --login` 扫码一次即可，"
                "之后约 59 天都不用再扫")
    except Exception as e:
        log(f"  [登录态] 体检跳过（不影响提取）: {type(e).__name__}: {e}")

    # ---- 分流：有 play_url 的直链直通，没有的才开浏览器 ----
    direct_rows = [r for r in cache_rows if (r.get("play_url") or "").strip()]
    browser_rows = [r for r in cache_rows if not (r.get("play_url") or "").strip()]
    log(f"直链直通 {len(direct_rows)} 条 / 需浏览器解析 {len(browser_rows)} 条")

    direct_results = []
    if direct_rows:
        direct_results = extract_direct(direct_rows, args.out, args.duration)

    if browser_rows:
        # 2026-09-22 实测：并发**是可行的**，官方"并发会抓不到直链"的说法已过时。
        # 之前之所以看着全失败，是 batch_extract.py 收尾时跨线程 close() 抛
        # greenlet.error 把脚本炸了，summary.json 写不出来（wav 其实都生成好了）。
        # 已修 batch_extract.py 的 close；实测 6 条 / workers=4 用 32.6s（串行 67s，约 2 倍）。
        build_input(browser_rows, tmp)
        if args.workers > 1:
            log(f"并发 {args.workers}（失败项会自动转串行补跑）")
        cmd = [PY, "batch_extract.py", tmp, "-o", args.out,
               "--workers", str(args.workers), "--retry", str(args.retry)]
        if args.duration:
            cmd += ["--duration", str(args.duration)]
        if args.state:
            # 必须转绝对路径：官方脚本会在自己的 scripts 目录下执行，
            # 相对路径在那里不存在，会被静默降级成「无登录态」→ 页面跳 iesdouyin
            # 分享页 → 一条直链都抓不到（2026-09-22 踩过，5/5 全失败）。
            state_abs = os.path.abspath(args.state)
            if not os.path.exists(state_abs):
                raise SystemExit(f"登录态文件不存在: {state_abs}（先跑 login_douyin.py）")
            log(f"登录态: {state_abs}")
            cmd += ["--state", state_abs]
        run(cmd, "提取音频（官方 batch_extract.py）")

    qc = {}
    if not args.skip_qc:
        run([PY, "audio_qc.py", args.out], "音频质检（官方 audio_qc.py）")
        qc = read_qc(args.out)

    if not browser_rows and not direct_results:
        raise SystemExit("没有任何可提取的条目")
    if browser_rows and not os.path.exists(os.path.join(args.out, "summary.json")):
        raise SystemExit("没找到 summary.json，提取环节可能失败了")
    to_manifest(args.out, cache_rows, qc, extra_rows=direct_results)


if __name__ == "__main__":
    main()

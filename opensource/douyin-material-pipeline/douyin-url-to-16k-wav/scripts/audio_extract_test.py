#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
远程视频 URL -> 16kHz/mono/PCM WAV 音频提取链路验证程序（最小可运行版）

只做一件事：验证 "远程视频 URL 不落盘完整 MP4，直接交给 FFmpeg 提取音频" 是否可行。

三种提取模式：
  1) direct : ffmpeg -i "URL" ...                 （FFmpeg 自己发 HTTP，可 seek）
  2) pipe   : HTTP stream -> ffmpeg -i pipe:0      （我们拉流喂给 FFmpeg，备用方案）
  3) proxy  : 本地计量代理 + ffmpeg 直连           （仅用于精确测量 FFmpeg 实际读了多少字节）

不做：UI / 数据库 / ASR / 任何其他功能。
"""
import argparse
import json
import os
import subprocess
import sys
import threading
import time
import urllib.parse

import requests
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
DEFAULT_REFERERS = ["https://www.douyin.com/", "https://www.iesdouyin.com/"]

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"


# ----------------------------------------------------------------------------
# HTTP 层：探测、重定向、Header 组合
# ----------------------------------------------------------------------------
def http_head(url, headers, timeout=25):
    """返回 (status, headers_dict, redirect_chain, err)"""
    chain = []
    try:
        r = requests.get(url, headers=headers, stream=True, timeout=timeout,
                         allow_redirects=True)
        for h in r.history:
            chain.append({"from": h.url[:120], "status": h.status_code,
                          "to": h.headers.get("Location", "")[:120]})
        status, hd = r.status_code, dict(r.headers)
        r.close()  # 关键：不读 body，立刻断开
        return status, hd, chain, ""
    except Exception as e:
        return 0, {}, chain, f"{type(e).__name__}: {e}"


def http_range_support(url, headers, timeout=25):
    """测试远程是否支持 Range / 分片读取"""
    h = dict(headers)
    h["Range"] = "bytes=0-1023"
    try:
        r = requests.get(url, headers=h, timeout=timeout, stream=True)
        code = r.status_code
        cr = r.headers.get("Content-Range", "")
        n = len(r.raw.read(1024)) if code in (200, 206) else 0
        r.close()
        return {"status": code, "content_range": cr, "got_bytes": n,
                "range_supported": code == 206}
    except Exception as e:
        return {"status": 0, "err": f"{type(e).__name__}: {e}", "range_supported": False}


def build_header_profiles(url, cookie=None):
    """按复杂度递增的 Header 组合，逐个尝试，记录每层失败原因"""
    origin = "{uri.scheme}://{uri.netloc}/".format(uri=urllib.parse.urlsplit(url))
    profiles = [
        ("L0_none", {}),
        ("L1_ua", {"User-Agent": UA}),
        ("L2_ua_referer_origin", {"User-Agent": UA, "Referer": origin}),
    ]
    for i, ref in enumerate(DEFAULT_REFERERS):
        profiles.append((f"L3_ua_referer_known{i}", {"User-Agent": UA, "Referer": ref}))
    if cookie:
        h = {"User-Agent": UA, "Referer": DEFAULT_REFERERS[0], "Cookie": cookie}
        profiles.append(("L4_ua_referer_cookie", h))
    return profiles


def ffmpeg_header_args(hd):
    """把 Python dict 转成 ffmpeg 的 -user_agent / -headers 参数"""
    args = []
    if "User-Agent" in hd:
        args += ["-user_agent", hd["User-Agent"]]
    others = {k: v for k, v in hd.items() if k != "User-Agent"}
    if others:
        args += ["-headers", "".join(f"{k}: {v}\r\n" for k, v in others.items())]
    return args


# ----------------------------------------------------------------------------
# FFprobe / FFmpeg
# ----------------------------------------------------------------------------
def ffprobe_remote(url, headers, timeout=60):
    """分级尝试探测远程流，返回 (info, used_profile, attempts)"""
    attempts = []
    for name, hd in build_header_profiles(url):
        cmd = [FFPROBE, "-v", "error", "-show_entries",
               "format=duration,size,bit_rate,format_name:stream=codec_type,codec_name,"
               "channels,sample_rate,bit_rate,duration",
               "-of", "json"] + ffmpeg_header_args(hd) + [url]
        t0 = time.perf_counter()
        try:
            p = subprocess.run(cmd, capture_output=True, text=True,
                               timeout=timeout, encoding="utf-8", errors="replace")
            el = time.perf_counter() - t0
            ok = p.returncode == 0
            err = "" if ok else (p.stderr or "").strip().splitlines()[-1][:300]
        except subprocess.TimeoutExpired:
            el, ok, err = time.perf_counter() - t0, False, f"ffprobe timeout {timeout}s"
        attempts.append({"profile": name, "ok": ok, "elapsed_s": round(el, 2), "error": err})
        if ok:
            try:
                data = json.loads(p.stdout or "{}")
            except Exception:
                data = {}
            fmt = data.get("format", {}) or {}
            streams = data.get("streams", []) or []
            audios = [s for s in streams if s.get("codec_type") == "audio"]
            videos = [s for s in streams if s.get("codec_type") == "video"]
            a = audios[0] if audios else {}
            info = {
                "container": fmt.get("format_name", ""),
                "duration_s": float(fmt.get("duration") or 0),
                "bit_rate": int(fmt.get("bit_rate") or 0),
                "declared_size_bytes": int(fmt.get("size") or 0),
                "has_audio_stream": bool(audios),
                "has_video_stream": bool(videos),
                "audio_codec": a.get("codec_name", ""),
                "audio_channels": a.get("channels"),
                "audio_sample_rate": a.get("sample_rate"),
                "audio_bit_rate": a.get("bit_rate"),
                "audio_duration_s": float(a.get("duration") or 0),
                "stream_count": len(streams),
            }
            return info, name, attempts
    return {"has_audio_stream": False}, "", attempts


def run_ffmpeg(args, timeout=900, stdin_pipe=False):
    p = subprocess.run(args, capture_output=True, timeout=timeout,
                       stdin=subprocess.PIPE if stdin_pipe else None)
    return p.returncode, (p.stderr or b"").decode("utf-8", "replace")


def ffmpeg_direct(url, out, headers, duration=None, timeout=900):
    """模式 1：FFmpeg 直连远程 URL"""
    cmd = [FFMPEG, "-y", "-nostdin", "-hide_banner", "-loglevel", "error"]
    cmd += ffmpeg_header_args(headers)
    cmd += ["-i", url, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"]
    if duration:
        cmd += ["-t", str(duration)]
    cmd += ["-f", "wav", out]
    t0 = time.perf_counter()
    try:
        rc, err = run_ffmpeg(cmd, timeout=timeout)
        el = time.perf_counter() - t0
        return {"ok": rc == 0 and os.path.exists(out) and os.path.getsize(out) > 44,
                "elapsed_s": round(el, 2), "rc": rc,
                "error": "" if rc == 0 else (err.strip().splitlines() or [""])[-1][:300],
                "cmd": " ".join(cmd[:6]) + " ... -i <URL> -vn -ac 1 -ar 16000 -c:a pcm_s16le -f wav"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "elapsed_s": round(time.perf_counter() - t0, 2),
                "rc": -1, "error": f"timeout {timeout}s", "cmd": ""}


def ffmpeg_pipe(url, out, headers, duration=None, timeout=900, chunk=65536):
    """模式 2：HTTP 流式请求 -> pipe -> ffmpeg -i pipe:0"""
    cmd = [FFMPEG, "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
           "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"]
    if duration:
        cmd += ["-t", str(duration)]
    cmd += ["-f", "wav", out]

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    t0 = time.perf_counter()
    sent = 0
    resp_err = ""
    first_byte_at = None
    try:
        with requests.get(url, headers=headers, stream=True, timeout=(15, 120)) as r:
            if r.status_code >= 400:
                resp_err = f"HTTP {r.status_code}"
            else:
                for c in r.iter_content(chunk_size=chunk):
                    if not c:
                        break
                    if first_byte_at is None:
                        first_byte_at = time.perf_counter() - t0
                    try:
                        proc.stdin.write(c)
                    except (BrokenPipeError, OSError):
                        break  # ffmpeg 提前够了 / 退出了
                    sent += len(c)
        try:
            proc.stdin.close()
        except Exception:
            pass
    except Exception as e:
        resp_err = f"{type(e).__name__}: {e}"
        try:
            proc.stdin.close()
        except Exception:
            pass

    err = (proc.stderr.read() or b"").decode("utf-8", "replace")
    rc = proc.wait(timeout=timeout)
    el = time.perf_counter() - t0
    return {"ok": rc == 0 and os.path.exists(out) and os.path.getsize(out) > 44,
            "elapsed_s": round(el, 2), "rc": rc, "bytes_pushed": sent,
            "first_byte_s": round(first_byte_at, 2) if first_byte_at else None,
            "error": resp_err if resp_err else
                     ("" if rc == 0 else (err.strip().splitlines() or [""])[-1][:300]),
            "cmd": "HTTP stream -> ffmpeg -i pipe:0 -vn -ac 1 -ar 16000 -c:a pcm_s16le -f wav"}


# ----------------------------------------------------------------------------
# 计量代理：精确测 FFmpeg 到底从远程读了多少字节 / 有没有 seek
# ----------------------------------------------------------------------------
class MeasureProxy:
    def __init__(self, remote_url, headers):
        self.remote = remote_url
        self.headers = headers
        self.bytes_served = 0
        self.requests = []
        self.srv = None
        self.port = None
        self.thread = None

    def _make_handler(self):
        outer = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def do_GET(self):
                rng = self.headers.get("Range")
                h = dict(outer.headers)
                if rng:
                    h["Range"] = rng
                try:
                    r = requests.get(outer.remote, headers=h, stream=True,
                                     timeout=(15, 120))
                except Exception as e:
                    self.send_error(502, str(e))
                    return
                self.send_response(r.status_code)
                for k in ("Content-Type", "Content-Range", "Accept-Ranges",
                          "Content-Length", "ETag", "Last-Modified"):
                    if k in r.headers:
                        self.send_header(k, r.headers[k])
                self.end_headers()
                n = 0
                try:
                    for c in r.iter_content(chunk_size=65536):
                        if not c:
                            break
                        try:
                            self.wfile.write(c)
                        except (BrokenPipeError, ConnectionResetError):
                            break
                        n += len(c)
                        outer.bytes_served += len(c)
                finally:
                    r.close()
                outer.requests.append({"range": rng, "status": r.status_code,
                                       "bytes": n})

            def do_HEAD(self):
                h = dict(outer.headers)
                try:
                    r = requests.head(outer.remote, headers=h, timeout=20,
                                      allow_redirects=True)
                    self.send_response(r.status_code)
                    for k in ("Content-Type", "Accept-Ranges", "Content-Length"):
                        if k in r.headers:
                            self.send_header(k, r.headers[k])
                    self.end_headers()
                except Exception as e:
                    self.send_error(502, str(e))

        return H

    def start(self):
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), self._make_handler())
        self.port = self.srv.server_address[1]
        self.thread = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.thread.start()
        return f"http://127.0.0.1:{self.port}/stream"

    def stop(self):
        if self.srv:
            self.srv.shutdown()
            self.srv.server_close()


def ffmpeg_via_proxy(url, out, headers, duration=None, timeout=900):
    """模式 3：通过计量代理，精确统计 FFmpeg 实际下载字节数"""
    px = MeasureProxy(url, headers)
    local = px.start()
    try:
        cmd = [FFMPEG, "-y", "-nostdin", "-hide_banner", "-loglevel", "error"]
        cmd += ["-i", local, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"]
        if duration:
            cmd += ["-t", str(duration)]
        cmd += ["-f", "wav", out]
        t0 = time.perf_counter()
        try:
            rc, err = run_ffmpeg(cmd, timeout=timeout)
            el = time.perf_counter() - t0
            ok = rc == 0 and os.path.exists(out) and os.path.getsize(out) > 44
            e = "" if rc == 0 else (err.strip().splitlines() or [""])[-1][:300]
        except subprocess.TimeoutExpired:
            el, ok, e = time.perf_counter() - t0, False, f"timeout {timeout}s"
    finally:
        px.stop()
    total_sequential = sum(r["bytes"] for r in px.requests
                           if not r["range"] or r["range"].strip().endswith("-")
                           and r["range"].startswith("bytes=0-"))
    return {"ok": ok, "elapsed_s": round(el, 2), "bytes_downloaded": px.bytes_served,
            "http_requests": len(px.requests),
            "request_detail": px.requests,
            "sequential_read_bytes": total_sequential,
            "error": e,
            "cmd": "ffmpeg -i <local-measure-proxy> -vn -ac 1 -ar 16000 -c:a pcm_s16le -f wav"}


# ----------------------------------------------------------------------------
# 校验输出 WAV
# ----------------------------------------------------------------------------
def verify_wav(path):
    if not os.path.exists(path):
        return {"ok": False, "error": "file not found"}
    cmd = [FFPROBE, "-v", "error", "-show_entries",
           "stream=codec_name,sample_rate,channels,bits_per_sample,duration:format=duration,size",
           "-of", "json", path]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=60)
    try:
        d = json.loads(p.stdout or "{}")
    except Exception:
        return {"ok": False, "error": "ffprobe parse failed"}
    s = (d.get("streams") or [{}])[0]
    f = d.get("format") or {}
    size = os.path.getsize(path)
    dur = float(s.get("duration") or f.get("duration") or 0)
    fmt_ok = (s.get("codec_name") == "pcm_s16le" and int(s.get("sample_rate") or 0) == 16000
              and int(s.get("channels") or 0) == 1)
    # 注意：只判 size>44 会把"解出几毫秒空音频"误判为成功（pipe 模式遇非 faststart 文件时会这样）
    ok = fmt_ok and size > 44 and dur >= 0.2
    return {"ok": ok, "codec": s.get("codec_name"), "sample_rate": s.get("sample_rate"),
            "channels": s.get("channels"), "bits_per_sample": s.get("bits_per_sample"),
            "duration_s": round(float(s.get("duration") or f.get("duration") or 0), 3),
            "size_bytes": size,
            "size_mb": round(size / 1024 / 1024, 3)}


def net_download_benchmark(url, headers, timeout=300):
    """纯网络耗时基准：完整拉一遍流到 /dev/null，不落盘"""
    t0 = time.perf_counter()
    n = 0
    try:
        with requests.get(url, headers=headers, stream=True, timeout=(15, timeout)) as r:
            for c in r.iter_content(chunk_size=262144):
                n += len(c)
        return {"ok": True, "bytes": n, "elapsed_s": round(time.perf_counter() - t0, 2),
                "mbps": round(n * 8 / (time.perf_counter() - t0) / 1e6, 2)}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}",
                "bytes": n, "elapsed_s": round(time.perf_counter() - t0, 2)}


def local_cpu_benchmark(src_wav, out, timeout=300):
    """纯 CPU 基准：本地 WAV -> 16k/mono（模拟无网络的处理耗时）"""
    cmd = [FFMPEG, "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
           "-i", src_wav, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
           "-f", "wav", out]
    t0 = time.perf_counter()
    rc, err = run_ffmpeg(cmd, timeout=timeout)
    return {"ok": rc == 0, "elapsed_s": round(time.perf_counter() - t0, 2),
            "error": "" if rc == 0 else err[-200:]}


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="远程视频URL -> 16k/mono WAV 链路验证")
    ap.add_argument("video_url", help="远程视频直链 URL")
    ap.add_argument("-o", "--out", default="output.wav")
    ap.add_argument("-t", "--duration", type=float, default=None,
                    help="只提取前 N 秒（验证是否可以提前终止、不必读完整文件）")
    ap.add_argument("--cookie", default=None)
    ap.add_argument("--force-pipe", action="store_true",
                    help="强制走 pipe fallback 路径（验证备用链路可用）")
    ap.add_argument("--no-measure", action="store_true", help="跳过计量代理测量")
    ap.add_argument("--no-benchmark", action="store_true", help="跳过网络/CPU 基准")
    ap.add_argument("--json-out", default=None, help="把报告 JSON 写到文件")
    args = ap.parse_args()

    url = args.video_url
    out = args.out
    report = {"video_url": url[:200] + ("..." if len(url) > 200 else ""),
              "requested_duration_s": args.duration}

    # ---- 1. HTTP 探测：裸请求 + 分级 Header ----
    print("[1/5] HTTP 探测 + Header 组合尝试 ...")
    profiles = build_header_profiles(url, args.cookie)
    http_attempts = []
    good_headers = {"User-Agent": UA}
    good_profile = ""
    content_length = 0
    redirects = []
    for name, hd in profiles:
        st, hd_resp, chain, err = http_head(url, hd)
        cl = int(hd_resp.get("Content-Length") or 0)
        rec = {"profile": name, "status": st, "content_length": cl,
               "content_type": hd_resp.get("Content-Type", ""),
               "redirects": chain, "error": err}
        http_attempts.append(rec)
        if st == 200 or st == 206:
            good_headers, good_profile, content_length = hd, name, cl
            redirects = chain
            rec["note"] = "OK"
            break
        rec["note"] = "403/失败：需要补充 Header" if st in (401, 403) else "失败"
    report["http_probe"] = {"working_profile": good_profile,
                            "working_headers": {k: (v[:60] + "..." if len(v) > 60 else v)
                                                for k, v in good_headers.items()},
                            "content_length_bytes": content_length,
                            "redirect_chain": redirects,
                            "attempts": http_attempts}

    if not good_profile:
        report["success"] = False
        report["error"] = "所有 Header 组合均无法访问该 URL"
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return report

    # Range 支持
    rng = http_range_support(url, good_headers)
    report["range_support"] = rng
    print(f"    可用 Header 组合: {good_profile}, Content-Length={content_length}, "
          f"Range={'支持' if rng.get('range_supported') else '不支持'}")

    # ---- 2. ffprobe 识别容器和音频流 ----
    print("[2/5] ffprobe 识别容器 / 音频流 ...")
    info, used, pattempts = ffprobe_remote(url, good_headers)
    report["stream_info"] = info
    report["ffprobe_attempts"] = pattempts
    report["ffprobe_profile_used"] = used
    print(f"    容器={info.get('container')} 时长={info.get('duration_s')}s "
          f"音轨={'有' if info.get('has_audio_stream') else '无'} "
          f"编码={info.get('audio_codec')}")

    if not info.get("has_audio_stream"):
        report["success"] = False
        report["error"] = ("该 URL 没有音频流（可能是抖音纯视频轨 media-video-avc1），"
                           "必须改用对应的音频轨 URL")
        report["hint"] = "抖音新版音视频分离，需取 media-audio-und-mp4a 那条流"
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return report

    # ---- 3. FFmpeg 直连提取（主链路） ----
    if args.force_pipe:
        print("[3/5] (--force-pipe) 跳过直连，直接测 pipe fallback ...")
        d1 = {"ok": False, "elapsed_s": 0, "rc": -1, "error": "forced pipe mode",
              "cmd": "skipped"}
    else:
        print("[3/5] FFmpeg 直连远程 URL 提取音频 ...")
        d1 = ffmpeg_direct(url, out, good_headers, duration=args.duration)
    report["ffmpeg_direct"] = d1
    report["wav"] = verify_wav(out) if d1["ok"] else {"ok": False}
    print(f"    direct: ok={d1['ok']} 耗时={d1['elapsed_s']}s err={d1['error'][:80]}")

    # ---- 4. 计量代理：FFmpeg 到底读了多少字节 ----
    if not args.no_measure:
        print("[4/5] 计量代理：统计 FFmpeg 实际读取字节数 ...")
        out_m = out.replace(".wav", "_measure.wav")
        d3 = ffmpeg_via_proxy(url, out_m, good_headers, duration=args.duration)
        d3["wav"] = verify_wav(out_m) if d3["ok"] else {"ok": False}
        if content_length:
            d3["pct_of_full_file"] = round(d3["bytes_downloaded"] / content_length * 100, 1)
            d3["full_file_bytes"] = content_length
        report["ffmpeg_measured"] = d3
        print(f"    实际读取 {d3['bytes_downloaded']} / {content_length} 字节 "
              f"({d3.get('pct_of_full_file')}%), HTTP 请求 {d3['http_requests']} 次")

    # ---- 5. 失败则 fallback：pipe 模式 ----
    if not d1["ok"]:
        print("[5/5] 直连失败 -> 启用 pipe fallback ...")
        out_p = out.replace(".wav", "_pipe.wav")
        d2 = ffmpeg_pipe(url, out_p, good_headers, duration=args.duration)
        d2["wav"] = verify_wav(out_p) if d2["ok"] else {"ok": False}
        if content_length and d2.get("bytes_pushed"):
            d2["pct_of_full_file"] = round(d2["bytes_pushed"] / content_length * 100, 1)
        report["ffmpeg_pipe_fallback"] = d2
        report["used_fallback"] = True
    else:
        report["used_fallback"] = False

    # ---- 6. 基准：网络 vs CPU ----
    if not args.no_benchmark:
        print("[+] 基准测量（网络 / CPU 拆分）...")
        report["bench_net_full_stream"] = net_download_benchmark(url, good_headers)
        if d1["ok"]:
            report["bench_cpu_local_wav"] = local_cpu_benchmark(
                out, out.replace(".wav", "_cpu.wav"))
        if args.duration:
            report["bench_net_first_n"] = net_download_benchmark(
                url, good_headers, timeout=120)

    # ---- 7. 一致性校验：不同模式产出的 PCM 是否逐字节相同 ----
    cands = []
    for tag, path in (("direct", out),
                      ("pipe", out.replace(".wav", "_pipe.wav")),
                      ("measured", out.replace(".wav", "_measure.wav"))):
        if os.path.exists(path) and os.path.getsize(path) > 44:
            cands.append((tag, path))
    if len(cands) >= 2:
        sigs = {}
        for tag, path in cands:
            p = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-f", "md5", "-"],
                               capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=300)
            sigs[tag] = (p.stdout or "").strip()
        uniq = set(v for v in sigs.values() if v)
        report["consistency_check"] = {"md5": sigs, "identical": len(uniq) == 1}

    # success 必须以「WAV 内容校验」为准，不能只看 ffmpeg 返回码
    # （pipe 模式遇非 faststart 文件时 rc=0 但只产出几毫秒空音频）
    direct_ok = bool(d1["ok"] and report["wav"].get("ok"))
    pipe_ok = bool(report.get("ffmpeg_pipe_fallback", {}).get("wav", {}).get("ok"))
    report["success"] = bool(direct_ok or pipe_ok)
    report["mode_used"] = ("direct" if direct_ok else ("pipe" if pipe_ok else "none"))
    report["required_full_download"] = _judge_full_download(report, content_length)

    print("\n" + "=" * 70)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"\n报告已写入: {args.json_out}")
    return report


def _judge_full_download(report, content_length):
    m = report.get("ffmpeg_measured")
    if not m or not m.get("ok") or not content_length:
        return "unknown"
    pct = m.get("pct_of_full_file", 100)
    if pct >= 99:
        return f"是（读取了 {pct}% 的完整文件）—— 该流必须完整读取"
    return f"否（只读取了 {pct}% 即完成，未完整下载）"


if __name__ == "__main__":
    main()

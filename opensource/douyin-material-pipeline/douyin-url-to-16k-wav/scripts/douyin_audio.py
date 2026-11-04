#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
抖音 / 远程视频 → 16kHz mono PCM WAV 提取库 + CLI

链路：
  抖音链接（短链 / 分享页 / 视频页）
    ↓ playwright 抓真实 CDN 直链（可无登录态）
    ↓ 优先挑 media-audio-und-mp4a（纯音频轨，省 10 倍流量）
    ↓ Header 分级探测（抖音 CDN 强制校验 Referer）
    ↓ FFmpeg 直连远程 URL（不落盘完整 MP4）
    ↓ -vn -ac 1 -ar 16000 -c:a pcm_s16le
    ↓ 16kHz / mono / PCM WAV

作为库用：
    from douyin_audio import extract_audio_from_douyin, extract_audio_from_url
    r = extract_audio_from_douyin("https://v.douyin.com/xxx/", out="a.wav")
    r = extract_audio_from_url("https://.../x.mp4", out="b.wav", duration=60)

作为命令用：
    python douyin_audio.py "https://v.douyin.com/xxx/" -o out.wav
    python douyin_audio.py "https://v.douyin.com/xxx/" -o out.wav -t 60

依赖：ffmpeg / ffprobe（需在 PATH）、Python 3.9+、requests、playwright（仅解析抖音链接时需要）
"""
import argparse
import json
import os
import sys
import time

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
DEFAULT_REFERERS = ["https://www.douyin.com/", "https://www.iesdouyin.com/"]

FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BIN", "ffprobe")

# 登录态 storage_state（可选）。没有也能跑，只是个别需要登录的视频抓不到直链。
STATE = os.environ.get("DOUYIN_STATE", "")


# ---------------------------------------------------------------------------
# Header 组合
# ---------------------------------------------------------------------------
def build_header_profiles(url, cookie=None):
    import urllib.parse
    origin = "{uri.scheme}://{uri.netloc}/".format(uri=urllib.parse.urlsplit(url))
    profiles = [
        ("L0_none", {}),
        ("L1_ua", {"User-Agent": UA}),
        ("L2_ua_referer_origin", {"User-Agent": UA, "Referer": origin}),
    ]
    for i, ref in enumerate(DEFAULT_REFERERS):
        profiles.append((f"L3_ua_referer_known{i}", {"User-Agent": UA, "Referer": ref}))
    if cookie:
        profiles.append(("L4_ua_referer_cookie",
                         {"User-Agent": UA, "Referer": DEFAULT_REFERERS[0], "Cookie": cookie}))
    return profiles


def ffmpeg_header_args(hd):
    args = []
    if "User-Agent" in hd:
        args += ["-user_agent", hd["User-Agent"]]
    others = {k: v for k, v in hd.items() if k != "User-Agent"}
    if others:
        args += ["-headers", "".join(f"{k}: {v}\r\n" for k, v in others.items())]
    return args


def http_head(url, headers, timeout=25):
    chain = []
    try:
        r = requests.get(url, headers=headers, stream=True, timeout=timeout,
                         allow_redirects=True)
        for h in r.history:
            chain.append({"from": h.url[:120], "status": h.status_code,
                          "to": h.headers.get("Location", "")[:120]})
        status, hd = r.status_code, dict(r.headers)
        r.close()
        return status, hd, chain, ""
    except Exception as e:
        return 0, {}, chain, f"{type(e).__name__}: {e}"


# ---------------------------------------------------------------------------
# FFprobe / FFmpeg
# ---------------------------------------------------------------------------
def ffprobe_remote(url, headers, timeout=60):
    """返回 (info, used_profile, attempts)"""
    import subprocess
    attempts = []
    for name, hd in build_header_profiles(url):
        cmd = [FFPROBE, "-v", "error", "-show_entries",
               "format=duration,size,bit_rate,format_name:stream=codec_type,codec_name,"
               "channels,sample_rate,bit_rate,duration",
               "-of", "json"] + ffmpeg_header_args(hd) + [url]
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                               encoding="utf-8", errors="replace")
            ok = p.returncode == 0
            err = "" if ok else (p.stderr or "").strip().splitlines()[-1][:300]
        except subprocess.TimeoutExpired:
            ok, err = False, f"ffprobe timeout {timeout}s"
        attempts.append({"profile": name, "ok": ok, "error": err})
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
            return {
                "container": fmt.get("format_name", ""),
                "duration_s": float(fmt.get("duration") or 0),
                "declared_size_bytes": int(fmt.get("size") or 0),
                "has_audio_stream": bool(audios),
                "has_video_stream": bool(videos),
                "audio_codec": a.get("codec_name", ""),
                "audio_channels": a.get("channels"),
                "audio_sample_rate": a.get("sample_rate"),
                "audio_duration_s": float(a.get("duration") or 0),
                "stream_count": len(streams),
            }, name, attempts
    return {"has_audio_stream": False}, "", attempts


def verify_wav(path):
    """必须查内容，不能只看 ffmpeg 返回码（pipe 空音频是 rc=0 的）"""
    import subprocess
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
    ok = fmt_ok and size > 44 and dur >= 0.2
    return {"ok": ok, "codec": s.get("codec_name"), "sample_rate": s.get("sample_rate"),
            "channels": s.get("channels"), "bits_per_sample": s.get("bits_per_sample"),
            "duration_s": round(dur, 3), "size_bytes": size,
            "size_mb": round(size / 1024 / 1024, 3)}


def ffmpeg_direct(url, out, headers, duration=None, timeout=900):
    """主链路：FFmpeg 自己发 HTTP 请求，支持 seek，不落盘 MP4"""
    import subprocess
    cmd = [FFMPEG, "-y", "-nostdin", "-hide_banner", "-loglevel", "error"]
    cmd += ffmpeg_header_args(headers)
    cmd += ["-i", url, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"]
    if duration:
        cmd += ["-t", str(duration)]
    cmd += ["-f", "wav", out]
    t0 = time.perf_counter()
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout)
        el = time.perf_counter() - t0
        err = (p.stderr or b"").decode("utf-8", "replace")
        return {"ok": p.returncode == 0, "elapsed_s": round(el, 2), "rc": p.returncode,
                "error": "" if p.returncode == 0 else (err.strip().splitlines() or [""])[-1][:300]}
    except subprocess.TimeoutExpired:
        return {"ok": False, "elapsed_s": round(time.perf_counter() - t0, 2),
                "rc": -1, "error": f"timeout {timeout}s"}


def ffmpeg_pipe(url, out, headers, duration=None, timeout=900, chunk=65536):
    """备用链路：HTTP 流 → pipe:0。仅在 moov 在头部（faststart / fMP4）时有效"""
    import subprocess
    cmd = [FFMPEG, "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
           "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"]
    if duration:
        cmd += ["-t", str(duration)]
    cmd += ["-f", "wav", out]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    t0 = time.perf_counter()
    sent, resp_err = 0, ""
    try:
        with requests.get(url, headers=headers, stream=True, timeout=(15, 120)) as r:
            if r.status_code >= 400:
                resp_err = f"HTTP {r.status_code}"
            else:
                for c in r.iter_content(chunk_size=chunk):
                    if not c:
                        break
                    try:
                        proc.stdin.write(c)
                    except (BrokenPipeError, OSError):
                        break
                    sent += len(c)
    except Exception as e:
        resp_err = f"{type(e).__name__}: {e}"
    try:
        proc.stdin.close()
    except Exception:
        pass
    err = (proc.stderr.read() or b"").decode("utf-8", "replace")
    rc = proc.wait(timeout=timeout)
    return {"ok": rc == 0, "elapsed_s": round(time.perf_counter() - t0, 2), "rc": rc,
            "bytes_pushed": sent,
            "error": resp_err if resp_err else
                     ("" if rc == 0 else (err.strip().splitlines() or [""])[-1][:300])}


# ---------------------------------------------------------------------------
# 抖音直链解析
# ---------------------------------------------------------------------------
def resolve_douyin_urls(page_url, wait=8, state_path=None, verbose=False):
    """用 playwright 打开抖音链接抓真实 CDN 直链。无登录态也能跑。"""
    from playwright.sync_api import sync_playwright
    sp = (state_path or STATE or "").strip() or None
    if sp and not os.path.exists(sp):
        if verbose:
            print(f"  [info] 登录态文件不存在，改用无登录态模式: {sp}")
        sp = None
    hits = []
    with sync_playwright() as p:
        # 注意：本机 playwright 可能缺 chromium headless shell，msedge 更稳
        try:
            b = p.chromium.launch(channel="msedge", headless=True, args=["--mute-audio"])
        except Exception:
            b = p.chromium.launch(headless=True, args=["--mute-audio"])
        ctx = b.new_context(storage_state=sp, user_agent=UA)
        page = ctx.new_page()

        def on_resp(r):
            u = r.url
            try:
                ct = r.headers.get("content-type", "")
            except Exception:
                ct = ""
            if "video" in ct or "douyinvod" in u:
                hits.append({"url": u, "status": r.status, "ct": ct})

        page.on("response", on_resp)
        try:
            page.goto(page_url, timeout=60000, wait_until="domcontentloaded")
        except Exception as e:
            if verbose:
                print(f"  [warn] goto: {str(e)[:100]}")
        # 抓到直链就走，不必死等满 wait（实测这一项能把单条耗时砍掉一半以上）
        deadline = time.time() + wait
        while time.time() < deadline:
            if any("media-audio-und-mp4a" in h["url"] for h in hits):
                break
            if len(hits) >= 2 and any("douyinvod" in h["url"] for h in hits):
                break
            time.sleep(0.4)
        final = page.url
        try:
            title = (page.title() or "")[:150]
        except Exception:
            title = ""
        b.close()
    uniq, seen = [], set()
    for h in hits:
        k = h["url"][:150]
        if k not in seen:
            seen.add(k)
            uniq.append(h)
    return {"final_url": final, "title": title, "candidates": uniq}


class Resolver:
    """可复用的抖音直链解析器。

    批量场景一定要复用：每重启一次浏览器约多花 3~5 秒，
    11 条视频就能省下近 1 分钟。
    """

    def __init__(self, state_path=None, verbose=False):
        from playwright.sync_api import sync_playwright
        sp = (state_path or STATE or "").strip() or None
        if sp and not os.path.exists(sp):
            if verbose:
                print(f"  [info] 登录态文件不存在，改用无登录态模式: {sp}")
            sp = None
        self._pw = sync_playwright().start()
        try:
            self.browser = self._pw.chromium.launch(channel="msedge", headless=True,
                                                    args=["--mute-audio"])
        except Exception:
            self.browser = self._pw.chromium.launch(headless=True, args=["--mute-audio"])
        self.ctx = self.browser.new_context(storage_state=sp, user_agent=UA)
        self.verbose = verbose

    def resolve(self, page_url, wait=8):
        hits = []
        page = self.ctx.new_page()

        # 注意：不要拦 image/font/stylesheet 试图加速。实测那样会导致
        # 页面根本不触发视频加载，直链一个都抓不到（11/11 全失败）。

        def on_resp(r):
            u = r.url
            try:
                ct = r.headers.get("content-type", "")
            except Exception:
                ct = ""
            if "video" in ct or "douyinvod" in u:
                hits.append({"url": u, "status": r.status, "ct": ct})

        page.on("response", on_resp)
        try:
            page.goto(page_url, timeout=60000, wait_until="domcontentloaded")
        except Exception as e:
            if self.verbose:
                print(f"  [warn] goto: {str(e)[:100]}")
        deadline = time.time() + wait
        while time.time() < deadline:
            if any("media-audio-und-mp4a" in h["url"] for h in hits):
                break
            if len(hits) >= 2 and any("douyinvod" in h["url"] for h in hits):
                break
            time.sleep(0.4)
        final = page.url
        try:
            title = (page.title() or "")[:150]
        except Exception:
            title = ""
        page.close()
        uniq, seen = [], set()
        for h in hits:
            k = h["url"][:150]
            if k not in seen:
                seen.add(k)
                uniq.append(h)
        return {"final_url": final, "title": title, "candidates": uniq}

    def close(self):
        try:
            self.browser.close()
        finally:
            self._pw.stop()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


def pick_best(candidates):
    """优先纯音频轨 > 混合流 > 纯视频流"""
    audio_only = [c for c in candidates if "media-audio-und-mp4a" in c["url"]]
    video_only = [c for c in candidates if "media-video-avc1" in c["url"]]
    mixed = [c for c in candidates
             if "media-audio" not in c["url"] and "media-video-avc1" not in c["url"]
             and "douyinvod" in c["url"]]
    if audio_only:
        return audio_only[0], "audio_only"
    if mixed:
        return mixed[0], "mixed"
    if video_only:
        return video_only[0], "video_only(no audio!)"
    return (candidates[0] if candidates else None), "unknown"


# ---------------------------------------------------------------------------
# 对外主接口
# ---------------------------------------------------------------------------
def extract_audio_from_url(url, out="output.wav", duration=None,
                           cookie=None, force_pipe=False, verbose=True):
    """已有直链 → WAV"""
    def log(*a):
        if verbose:
            print(*a)

    result = {"url": url[:120], "out": out}
    log("  探测可用 Header ...")
    headers, profile = {"User-Agent": UA}, ""
    for name, hd in build_header_profiles(url, cookie):
        st, _, _, _ = http_head(url, hd)
        log(f"    {name}: HTTP {st}")
        if st in (200, 206):
            headers, profile = hd, name
            break
    if not profile:
        result.update(success=False, error="所有 Header 组合均无法访问该 URL（403？）")
        return result
    result["header_profile"] = profile

    log("  ffprobe 检查音频流 ...")
    info, used, _ = ffprobe_remote(url, headers)
    result["stream_info"] = info
    log(f"    容器={info.get('container')} 时长={info.get('duration_s')}s "
        f"音轨={'有' if info.get('has_audio_stream') else '无'} "
        f"编码={info.get('audio_codec')}")
    if not info.get("has_audio_stream"):
        result.update(success=False, error="该 URL 没有音频流",
                      hint="抖音请取 media-audio-und-mp4a 那条流")
        return result

    log("  FFmpeg 提取音频 ...")
    if force_pipe:
        d, mode = ffmpeg_pipe(url, out, headers, duration=duration), "pipe"
    else:
        d, mode = ffmpeg_direct(url, out, headers, duration=duration), "direct"
        if not d["ok"]:
            log("    直连失败，启用 pipe fallback ...")
            d2 = ffmpeg_pipe(url, out, headers, duration=duration)
            if d2["ok"]:
                d, mode = d2, "pipe(fallback)"
    wav = verify_wav(out) if d["ok"] else {"ok": False}
    result.update(success=bool(d["ok"] and wav.get("ok")), mode=mode,
                  extract=d, wav=wav)
    return result


def extract_audio_from_douyin(page_url, out="douyin_audio.wav", duration=None,
                              cookie=None, force_pipe=False, state_path=None,
                              wait=8, verbose=True, resolver=None):
    """抖音链接（短链/分享页/视频页）→ WAV

    resolver: 传入 Resolver 实例可复用浏览器，批量时显著提速。
    """
    def log(*a):
        if verbose:
            print(*a)

    log(f"解析抖音链接: {page_url}")
    if resolver is not None:
        r = resolver.resolve(page_url, wait=wait)
    else:
        r = resolve_douyin_urls(page_url, wait=wait, state_path=state_path, verbose=verbose)
    log(f"  最终页: {r['final_url']}")
    log(f"  抓到 {len(r['candidates'])} 个视频流候选")
    best, kind = pick_best(r["candidates"])
    if not best:
        return {"success": False, "error": "未抓到视频流直链（可能需登录态或页面未加载视频）",
                "resolved": r}
    log(f"  选用: {kind}")
    if kind.startswith("video_only"):
        log("  [WARN] 只抓到纯视频轨，无音轨")
    res = extract_audio_from_url(best["url"], out=out, duration=duration,
                                 cookie=cookie, force_pipe=force_pipe, verbose=verbose)
    res.update(url_kind=kind, final_page=r["final_url"], title=r["title"])
    return res


def main():
    ap = argparse.ArgumentParser(description="抖音/远程视频 → 16kHz mono WAV")
    ap.add_argument("url")
    ap.add_argument("-o", "--out", default="douyin_audio.wav")
    ap.add_argument("-t", "--duration", type=float, default=None)
    ap.add_argument("--cookie", default=None)
    ap.add_argument("--state", default=None, help="playwright storage_state 登录态文件路径")
    ap.add_argument("--force-pipe", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    if args.state:
        global STATE
        STATE = args.state

    v = not args.quiet
    looks_douyin = any(k in args.url for k in ("douyin.com", "iesdouyin.com"))
    if looks_douyin:
        r = extract_audio_from_douyin(args.url, out=args.out, duration=args.duration,
                                      cookie=args.cookie, force_pipe=args.force_pipe,
                                      state_path=args.state, verbose=v)
    else:
        r = extract_audio_from_url(args.url, out=args.out, duration=args.duration,
                                   cookie=args.cookie, force_pipe=args.force_pipe,
                                   verbose=v)
    print(json.dumps(r, ensure_ascii=False, indent=2))
    sys.exit(0 if r.get("success") else 1)


if __name__ == "__main__":
    main()

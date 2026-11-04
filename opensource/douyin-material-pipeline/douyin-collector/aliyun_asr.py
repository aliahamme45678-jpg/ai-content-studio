# -*- coding: utf-8 -*-
"""
阿里云百炼 · Paraformer 语音识别（把抖音视频转成口播文案）

流程：
  抖音视频直链 -> 下载本地 -> ffmpeg 抽 16k 单声道 mp3
  -> 上传到 DashScope 临时 OSS（拿到 oss:// 地址）
  -> 提交 paraformer-v2 异步转写任务 -> 轮询 -> 下载识别结果取 text

API Key 配置（二选一）：
  1. 环境变量 DASHSCOPE_API_KEY
  2. 同目录 .env 文件里写 DASHSCOPE_API_KEY=sk-xxx
"""

import json
import os
import subprocess
import time
import uuid
from urllib import request

import requests

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(BASE_DIR, ".env")

# ============ 配置 ============
def load_env(path=ENV_FILE):
    """极简 .env 加载：不覆盖已存在的环境变量"""
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                if k and k not in os.environ:
                    os.environ[k] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass


load_env()

DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "").strip()
ASR_MODEL = os.environ.get("ASR_MODEL", "paraformer-v2").strip()
FFMPEG = os.environ.get("FFMPEG_PATH", "ffmpeg").strip()
ASR_MAX_WAIT = int(os.environ.get("ASR_MAX_WAIT", "180"))

# 是否开启阿里云 ASR（关掉就走原来的酷虎云兜底）
ASR_ENABLED = os.environ.get("ASR_ENABLED", "1").strip() not in ("0", "false", "no")

SUBMIT_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription"
TASK_URL = "https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")


def log(msg=""):
    print(msg, flush=True)


def is_ready():
    """能不能用阿里云 ASR"""
    return bool(ASR_ENABLED and DASHSCOPE_API_KEY)


def key_masked():
    """key 里带 * 基本就是复制时被脱敏了，服务端会直接回 InvalidApiKey"""
    return "*" in DASHSCOPE_API_KEY


# ============ 1. 下载视频 ============
def download_video(url, dest, timeout=120):
    """下载抖音视频直链到本地"""
    headers = {"User-Agent": UA, "Referer": "https://www.douyin.com/"}
    with requests.get(url, headers=headers, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1024 * 256):
                if chunk:
                    f.write(chunk)
    return dest


# ============ 2. ffmpeg 抽音频 ============
def extract_audio(video_path, audio_path):
    """视频 -> 16k 单声道 mp3（Paraformer 吃得最舒服的格式）"""
    cmd = [FFMPEG, "-y", "-i", video_path, "-vn",
           "-ac", "1", "-ar", "16000", "-b:a", "48k", audio_path]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0 or not os.path.exists(audio_path):
        err = p.stderr.decode("utf-8", "ignore")[-300:]
        raise RuntimeError(f"ffmpeg 抽音频失败: {err}")
    return audio_path


# ============ 3. 上传到 DashScope 临时 OSS ============
def upload_file(local_path):
    """上传本地音频，返回 oss:// 地址（RESTful API 可直接用）"""
    from dashscope.utils.oss_utils import OssUtils

    oss_url, _ = OssUtils.upload(ASR_MODEL, local_path, api_key=DASHSCOPE_API_KEY)
    return oss_url


# ============ 4. 提交 / 轮询转写任务 ============
def _headers():
    return {
        "Authorization": "Bearer " + DASHSCOPE_API_KEY,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
        # oss:// 地址需要服务端解析成真实下载地址
        "X-DashScope-OssResourceResolve": "enable",
    }


def transcribe_file_url(file_url, poll_interval=3, max_wait=ASR_MAX_WAIT):
    """把一条音频（oss:// 或 http://）丢给 Paraformer，返回识别文本"""
    body = {
        "model": ASR_MODEL,
        "input": {"file_urls": [file_url]},
        "parameters": {
            "channel_id": [0],
            "language_hints": ["zh", "en"],
        },
    }
    r = requests.post(SUBMIT_URL, headers=_headers(),
                      data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                      timeout=60)
    r.raise_for_status()
    out = (r.json().get("output") or {})
    task_id = out.get("task_id")
    if not task_id:
        raise RuntimeError(f"提交转写任务失败: {r.text[:300]}")

    waited = 0
    while waited < max_wait:
        time.sleep(poll_interval)
        waited += poll_interval
        q = requests.get(TASK_URL.format(task_id=task_id),
                         headers={"Authorization": "Bearer " + DASHSCOPE_API_KEY},
                         timeout=60)
        q.raise_for_status()
        out = (q.json().get("output") or {})
        status = out.get("task_status")
        if status == "SUCCEEDED":
            results = out.get("results") or []
            if not results or not results[0].get("transcription_url"):
                raise RuntimeError("转写成功但没有结果地址")
            raw = request.urlopen(results[0]["transcription_url"], timeout=60).read()
            data = json.loads(raw.decode("utf-8"))
            transcripts = data.get("transcripts") or []
            text = "\n".join(t.get("text", "") for t in transcripts).strip()
            return text
        if status == "FAILED":
            raise RuntimeError("转写任务失败")

    raise RuntimeError(f"转写超时（等待 {max_wait}s）")


# ============ 5. 对外的主入口 ============
def transcribe_video(video_url, workdir=None, keep=False):
    """给一条抖音视频直链（或本地视频路径），返回口播文案文本"""
    if not video_url:
        return ""
    tmpdir = workdir or os.path.join(BASE_DIR, "_asr_tmp")
    os.makedirs(tmpdir, exist_ok=True)
    # ⚠️ 2026-10-26 修：原来只用毫秒时间戳命名，多线程并发时（_asr_backfill 用
    # ThreadPoolExecutor(max_workers=4)）同一毫秒启动的任务会**撞同一个文件名**，
    # 后下载的视频覆盖前一个 → 两条视频转出**同一段文案**（68 条里串了 6 条）。
    # 加 uuid 保证唯一：时间戳保留可读性，uuid 负责防撞。
    stamp = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
    video_path = os.path.join(tmpdir, f"{stamp}.mp4")
    audio_path = os.path.join(tmpdir, f"{stamp}.mp3")

    try:
        if video_url.startswith("http"):
            download_video(video_url, video_path)
        else:
            video_path = video_url  # 本地文件直接用

        size_mb = os.path.getsize(video_path) / 1024 / 1024
        log(f"    下载完成 {size_mb:.1f}MB，正在抽音频...")
        extract_audio(video_path, audio_path)
        log(f"    音频 {os.path.getsize(audio_path) / 1024 / 1024:.1f}MB，上传中...")
        oss_url = upload_file(audio_path)
        log("    已上传，转写中...")
        text = transcribe_file_url(oss_url)
        log(f"    转写完成（{len(text)} 字）")
        return text
    finally:
        if not keep:
            for p in (video_path, audio_path):
                try:
                    if os.path.exists(p):
                        os.remove(p)
                except Exception:
                    pass


async def _grab_play_url(page_url, headless=False, wait=15):
    """打开抖音视频页，从详情接口里抠出视频直链（复用 douyin_state.json 登录态）"""
    from playwright.async_api import async_playwright

    state_file = os.path.join(BASE_DIR, "douyin_state.json")
    detail_keys = ("/aweme/v1/web/aweme/detail/", "/aweme/v1/web/aweme/post/")

    async def pick(data):
        if not isinstance(data, dict):
            return ""
        for key in ("aweme_detail", "aweme"):
            node = data.get(key)
            if isinstance(node, dict):
                u = get_play_url(node)
                if u:
                    return u
        for key in ("aweme_list", "items", "data"):
            node = data.get(key)
            if isinstance(node, list):
                for x in node:
                    if isinstance(x, dict):
                        u = get_play_url(x)
                        if u:
                            return u
        return ""

    play = ""
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=headless)
        kwargs = {"user_agent": UA}
        if os.path.exists(state_file):
            kwargs["storage_state"] = state_file
        context = await browser.new_context(**kwargs)
        page = await context.new_page()
        try:
            await page.goto(page_url, wait_until="domcontentloaded", timeout=60000)
            try:
                resp = await page.wait_for_event(
                    "response",
                    predicate=lambda r: any(k in r.url for k in detail_keys),
                    timeout=wait * 1000,
                )
                play = await pick(await resp.json())
            except Exception:
                pass

            if not play:  # 兜底：页面里的 video 标签
                try:
                    src = await page.evaluate(
                        "() => {const v=document.querySelector('video'); return v?v.src:''}")
                    if src and not src.startswith("blob:"):
                        play = src
                except Exception:
                    pass
        finally:
            await context.close()
            await browser.close()
    return play


def transcribe_douyin(page_url, headless=False):
    """给一条抖音分享链接 / 视频页链接，直接返回口播文案"""
    import asyncio

    log("    正在打开视频页取直链...")
    play = asyncio.run(_grab_play_url(page_url, headless=headless))
    if not play:
        raise RuntimeError("没拿到视频直链（页面可能要过验证码，用有头模式重试）")
    log(f"    直链: {play[:70]}...")
    return transcribe_video(play)


def get_play_url(aweme):
    """从抖音详情接口的数据里抠出视频直链（无水印优先）"""
    video = aweme.get("video") or {}
    for key in ("play_addr", "download_addr", "play_addr_h264", "download_suffix_logo_addr"):
        addr = video.get(key) or {}
        for u in (addr.get("url_list") or []):
            if u:
                return u
    for key in ("play_addr", "download_addr"):
        addr = video.get(key) or {}
        if addr.get("uri"):
            return f"https://api.douyin.com/aweme/v1/play/?video_id={addr['uri']}"
    return ""


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="阿里云百炼 ASR 独立用法")
    ap.add_argument("target", nargs="?", help="抖音链接 / 视频直链 / 本地音视频文件")
    ap.add_argument("--demo", action="store_true", help="用官方示例音频跑通链路")
    ap.add_argument("--douyin", action="store_true", help="target 是抖音分享链接，自动取直链")
    ap.add_argument("--headless", action="store_true", help="取直链时用无头浏览器")
    args = ap.parse_args()

    if not is_ready():
        log("DASHSCOPE_API_KEY 没配好，去 .env 里填上")
        raise SystemExit(1)
    if key_masked():
        log("注意：key 里带 *，多半是复制时被脱敏了，会报 InvalidApiKey")

    if args.demo or not args.target:
        url = ("https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/"
               "paraformer/hello_world.wav")
        log("用官方示例音频测试：" + url)
        text = transcribe_file_url(url)
    elif args.douyin:
        log("抖音链接：" + args.target)
        text = transcribe_douyin(args.target, headless=args.headless)
    else:
        t = args.target
        if t.endswith((".mp3", ".wav", ".m4a", ".mp4")) and not t.startswith("http"):
            log("本地文件：" + t)
            text = transcribe_file_url(upload_file(t))
        else:
            log("视频：" + t)
            text = transcribe_video(t)

    out = os.path.join(BASE_DIR, "asr_result.txt")
    with open(out, "w", encoding="utf-8") as f:
        f.write(text or "")
    log(f"\n共 {len(text)} 字，完整结果已写入：{out}")
    log("前 120 字：" + (text or "")[:120])

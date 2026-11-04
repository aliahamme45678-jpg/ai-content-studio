---
name: douyin-url-to-16k-wav
description: 把抖音链接或任意远程视频 URL 直接转成 16kHz/mono/PCM WAV，不落盘完整 MP4。用于 ASR（阿里云语音转文字等）前的音频提取。触发词：抖音视频提取音频、视频URL转WAV、口播文案提取、远程视频不下载提取音频、ASR 前置音频。
agent_created: true
---

# 远程视频 URL → 16kHz/mono WAV

FFmpeg 直接读远程 URL 提取音频，**不在磁盘保存完整 MP4**。输出 `pcm_s16le / 16000Hz / mono / WAV`，
正好是阿里云等 ASR 的标准输入格式。

## 快速使用

脚本在 `scripts/` 下。Python 用 `C:\Python311\python.exe`（已装 requests / playwright）。

```bash
# 一键：丢抖音链接（短链/分享页/视频页皆可）直接出 WAV
python scripts/douyin_audio.py "https://v.douyin.com/xxxxx/" -o out.wav

# 已有直链：验证 + 提取（含 Header 探测、容器识别、流量计量、耗时拆分）
python scripts/audio_extract_test.py "<VIDEO_URL>" -o out.wav

# 只取前 N 秒 / 强制 pipe / 带 Cookie
python scripts/audio_extract_test.py "<URL>" -o out.wav -t 60
python scripts/audio_extract_test.py "<URL>" -o out.wav --force-pipe
python scripts/audio_extract_test.py "<URL>" -o out.wav --cookie "..."
```

`douyin_audio.py` 里的 `STATE` 指向抖音登录态 storage_state，可按需改；文件不存在会自动跳过登录态。

## 核心命令

```bash
ffmpeg -y -nostdin -hide_banner -loglevel error \
  -user_agent "<浏览器UA>" -headers "Referer: https://www.douyin.com/\r\n" \
  -i "<URL>" -vn -ac 1 -ar 16000 -c:a pcm_s16le -f wav out.wav
```

## 四个必须记住的坑（都实测过）

1. **抖音 CDN 强制校验 `Referer`，缺了直接 403。** User-Agent 不是必须的，但建议一起带。
   程序按 裸 → UA → UA+Referer(origin) → UA+Referer(www.douyin.com) → +Cookie 分级重试并记录每层原因。

2. **抖音新版音视频分离。** `media-video-avc1` 是纯视频、**没有音轨**；
   必须取 `media-audio-und-mp4a`（aac / 44.1kHz / stereo / ~189kbps）。
   用纯音频轨流量省 10 倍以上：1 分钟约 1.4 MB。

3. **pipe fallback 只在 moov 在头部时可用。** `HTTP stream → ffmpeg -i pipe:0` 能按需推送
   （抖音流实测只推 21.7% 就拿到 60 秒音频，MD5 与直连一致），
   但 **moov 在尾部的普通 MP4 走 pipe 会把文件推完 100% 却只吐出几毫秒空音频**。
   抖音是 fMP4（moov 在头部）所以可用；别把它当通用兜底。

4. **验收必须用内容校验，不能只看 FFmpeg 返回码。** pipe 模式的空音频是 `rc=0` 的。
   判据：`codec==pcm_s16le && sample_rate==16000 && channels==1 && duration>=0.2s`。
   只看 `size > 44` 会把 196 字节空音频误判为成功（踩过）。

## 其他实测结论

- **FFmpeg 跟随 302 后完整保留 `-user_agent` 和 `-headers`（含 Referer）**，短链跳转不会丢头。
- 抖音直链带 `dy_q`/`l` 时间戳，至少 10 分钟内有效 → **拿到即用，不要跨小时缓存**。
- 直连模式会 over-read：受 TCP 缓冲和 FFmpeg 预读影响，实测读取 88%~180%
  （moov 在尾部时会 seek 回尾部重读）。仍然不落盘，只是流量略多。
- 耗时瓶颈 100% 在网络：FFmpeg 解码+重采样 1 分钟音频约 **0.18 s**。
  抖音音频轨 286 s 直连 **0.54 s**；跨洋 12.8 Mbps 下 52 s 混合流 4.4 s。
  网络占比 67%（快网）~95%（慢网）。
- 批量实测 4/4 成功（201 s / 286 s / 478 s / 497 s），全部自动命中纯音频轨。

## 环境备忘

- 本机 ffmpeg 7.x（`N-122378`，含 whisper），ffprobe 同版本。
- **playwright 缺 chromium_headless_shell，必须 `p.chromium.launch(channel="msedge")`**，
  否则报 `Executable doesn't exist`。

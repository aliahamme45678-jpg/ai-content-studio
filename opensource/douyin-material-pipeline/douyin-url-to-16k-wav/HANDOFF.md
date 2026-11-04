# 交接说明（同一台机器）

同一台机器不用传 zip，直接把下面这段发给新会话即可。脚本已装好，开箱即用。

---

## 发给新会话的原文（直接复制）

```
本机已有一套「抖音链接 → 16kHz/mono WAV」的工具，直接复用，不要重写。

脚本目录（4 个文件，可独立运行）：
C:\Users\Administrator\.workbuddy-ai\skills\douyin-url-to-16k-wav\scripts\

- douyin_audio.py        主脚本，库 + CLI 双用
- batch_extract.py       批量，吃采集 JSON 出 WAV + summary.csv
- audio_qc.py            内容质检，送 ASR 前先跑
- audio_extract_test.py  诊断测量，日常不必需

用法：
cd C:\Users\Administrator\.workbuddy-ai\skills\douyin-url-to-16k-wav\scripts
python douyin_audio.py "https://v.douyin.com/xxxxx/" -o out.wav
python batch_extract.py <采集结果.json> -o 输出目录 --state <登录态.json>

Python 用 C:\Python311\python.exe（依赖已装：requests / playwright）。

四条硬约束，别踩：
1. 抖音 CDN 强制校验 Referer，缺了 403（脚本已自动分级重试，别删这段逻辑）
2. 抖音新版音视频分离，必须取 media-audio-und-mp4a 纯音频轨；
   media-video-avc1 是纯视频没有音轨
3. pipe 模式只在 moov 在头部时可用，别当通用兜底
4. 验收必须查内容（codec/sample_rate/channels/duration），
   不能只看 FFmpeg 返回码——空音频是 rc=0 的

已知不要做的事：
- 别用并发批量（--workers>1），会让部分条目抓不到直链，默认串行
- 别拦截页面 image/font/stylesheet 试图加速，会导致抓不到直链

已有产物（11 条视频的 WAV，已质检 11/11 通过）：
C:\Users\Administrator\WorkBuddy AI\2026-09-21-01-12-15\audio_out2\
```

---

## 两个路径的区别

| 路径 | 性质 | 用途 |
|---|---|---|
| `C:\Users\Administrator\.workbuddy-ai\skills\douyin-url-to-16k-wav\` | **持久**（用户级 skill 目录） | 长期用，新会话直接指这里 |
| `C:\Users\Administrator\WorkBuddy AI\2026-09-21-01-12-15\` | 会话工作区，带时间戳 | 临时产物，**可能被清理** |

产物 `audio_out2/`（87 MB）目前还在工作区里。如果要长期保留或给别的会话用，
建议先挪到稳定位置，例如：

```bash
mkdir -p "C:/Users/Administrator/douyin_audio_out"
mv "C:/Users/Administrator/WorkBuddy AI/2026-09-21-01-12-15/audio_out2"/* "C:/Users/Administrator/douyin_audio_out/"
```

---

## 跨机器才用 zip

`douyin-audio-extract.zip`（23.7 KB，6 个文件）在：
`C:\Users\Administrator\WorkBuddy AI\2026-09-21-01-12-15\douyin-audio-extract.zip`

对方需要自己装 ffmpeg / Python 依赖，且 ffmpeg 必须在 PATH。

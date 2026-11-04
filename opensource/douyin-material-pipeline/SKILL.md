---
name: douyin-material-pipeline
description: 抖音素材库批量处理流水线：丢链接 → 抓互动数据（赞评藏转/标题/话题/作者/发布时间/作者粉丝数/时长）→ 提取 16k WAV 音频 → 阿里云百炼 Paraformer 转文字 → 合并成总表 → 互动率分析排序 → 低粉爆款筛选（点赞粉丝比 + 互动密度）。触发词：抖音素材采集、抖音链接提取文案、抖音批量采集、口播文案提取、素材总表、抖音数据分析、藏赞比、低粉爆款、点赞粉丝比、互动密度、可翻拍素材。
agent_created: true
---

# 抖音素材库流水线

工作目录：`C:\Users\Administrator\DoubaoWork\chats\2026-09-20\new-chat\douyin_collector`
Python：`C:\Python311\python.exe`（playwright / flask / openpyxl / requests / dashscope 都装好了）

## 一键跑完（日常就这两条）

```bash
# 整号采集（主页 URL）→ 直接进两张飞书表，不用管中间产物
python home2table.py "https://www.douyin.com/user/MS4wLjABAAAA..."

# 零散链接 → 本地总表
python pipeline.py -i "素材.txt" -o "总表.xlsx"
python pipeline.py -l "https://v.douyin.com/xxx/" "https://v.douyin.com/yyy/"   # 直接跟链接
python pipeline.py -i "素材.txt" --no-audio        # 只要数据，不提音频
python pipeline.py -i "素材.txt" --workers 6       # 调并发
```

## 主页批量采集（一次拿整个号）

**推荐走接口版 `_home_api.py`**（解析 DOM 卡片那条路上限就是 55，见下面坑 1）：

```bash
python _home_api.py [sec_user_id]        # 输出 _home_raw.json + 素材_主页全量.txt
python pipeline.py -i 素材_主页全量.txt -o _主页全量.xlsx --workers 4
```

`_home_api.py` 在浏览器里拦截 `/aweme/v1/web/aweme/post` 响应，拿到的 aweme 对象
自带 `share_url` / `statistics` / `duration`，比 DOM 解析干净，且能看到 `has_more`
判断是否到底。实测（2026-09-21，某 TK 跨境号）：5 页接口，74 条，`has_more=0`。

原 `collector.py -u` 也能跑，但上限低：

```bash
python collector.py -u "https://www.douyin.com/user/MS4wLjABAAAA..." \
    --min-digg 0 --min-comment 0 --min-collect 0 -o 主页全量.xlsx
```

**五个坑，都踩过：**

1. **⭐ 滚动必须滚真正的容器，滚 window 等于没滚**（2026-09-21 定位，最坑的一个）。
   抖音主页 `window` 的 `scrollHeight == clientHeight == 720`——**完全不可滚**；
   作品列表在一个内部 div 里（`.route-scroll-container`，实测
   `scrollHeight 3402 / clientHeight 720`）。`window.scrollTo(0, document.body.scrollHeight)`
   每次都在滚一个滚不动的东西，于是接口永远只加载首屏那 3 页 —— **73 个作品只采到 55 个**，
   还被"连续 5 轮无新增"误判成"没有更多视频"。
   修法：自动挑 `overflow-y:auto|scroll` 且可滚距离最大的元素滚到底：
   ```js
   const cands=[...document.querySelectorAll('div,section,main,ul')].filter(el=>{
     const cs=getComputedStyle(el);
     return /auto|scroll/.test(cs.overflowY)&&(el.scrollHeight-el.clientHeight)>20;});
   cands.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight));
   cands[0].scrollTop=cands[0].scrollHeight;
   ```
   `collector.py` 里已封装成 `smart_scroll(page)`。
2. **验证码检测不能碰页面文字**。最早用 `document.body.innerText` 匹配
   `验证|滑块`，结果在该主页疯狂误判——feed 页会把几十条视频标题渲染进 DOM，
   标题里本来就有"验证""滑块"这类词。误判一次等 2 分钟，50 轮能干等两小时。
   现在只认**尺寸可见**（宽>60 高>20）的验证码容器 DOM / iframe，不再匹配正文。
3. **默认阈值会砍掉大部分视频**：`DEFAULT_MIN_DIGG=3000` / `MIN_COMMENT=50` /
   `MIN_COLLECT=1000`。实测 21 条只过了 4 条 —— **要全量必须三个阈值都显式传 0**。
4. **`-o` 不管后缀写什么，导出的都是 xlsx**（写成 `.json` 也是 Excel 内容，
   openpyxl 还会因后缀拒绝打开）。**真数据在同目录的 `douyin_filtered.json`**
   （含 aweme_id / title / url / 赞藏评转 / content），直接用它，别读 `-o` 那个文件。
   注意这个文件每次跑都会被覆盖，要留就先 `cp` 一份。
5. **`--no-content` 在 `-u` 主页模式下无效**（main 里没把它传进 run），照样会跑提取。

**走不通的路（别再试）**：
- `https://www.iesdouyin.com/web/api/v2/aweme/post/` —— 已废弃，返回空（200 + 0 字节）。
- 捕获签名 URL 后改 `max_cursor` 用 `fetch` 重放 —— 返回的是 HTML（被挡），
  a_bogus 绑定整个 query，改参数即失效。

登录态：`python login_douyin.py`（轮询 cookie，不用按回车，39s 出 `douyin_state.json`）。
采集时若撞登录墙，`check_login()` 会弹系统 MessageBox 叫人扫码并轮询等待。

## ⑤ 推进飞书（可选）

```bash
python push_to_feishu.py --preset collect --data cache_x.json --audio ... --asr ...
python push_to_feishu.py --preset distill --data cache_x.json --audio ... --asr ... --analysis analysis_x.json
```

两个目标，别搞混：

| preset | 表 | 用途 | 字段 |
|---|---|---|---|
| `collect` | 新建文本文档(3)_数据汇总（日常默认） | 采集原始数据堆着 | 9 列：链接/标题/作者/发布时间/文案/赞评藏转 |
| `distill` | 内容蒸馏库 | 只放**拆解过**的 | 25 列，含 8 个分析维度 |

- 采集 → `collect`；要拆解 → 我写完分析再进 `distill`
- 脚本会先读表头，**只写表里已有的字段**（音频路径之类表里没有的自动丢弃）
- `create_records` 里直接放字段 map，**不能套 `{"fields":...}`**，否则报 800010701
- 藏赞比/评赞比/转赞比是百分比样式 → 存小数（0.596 = 59.6%）
- 内容蒸馏库的 `行业类型`：看**对标账号**做什么——AI/电商 → 同行业，其他（心理/汽车/职场/创业认知）→ 跨行业

## 分开跑

| 环节 | 命令 | 产出 |
|---|---|---|
| 抓数据 | `python fill_stats.py -i "素材.txt" --xlsx` | `cache_<名>.json` + 表格 |
| 提音频 | `python audio_step.py --cache cache_x.json --out D:\douyin_audio\<名>` | wav + `audio_manifest.json` |
| 转文字 | `python asr_batch.py --workers 4` | `asr_result.json` |
| 合并 | `python merge_all.py --data ... --audio ... --asr ... --source ... -o 总表.xlsx` | 20 列总表 |
| 分析 | `python analyze.py -i "素材.txt"` | 互动率报告 txt + xlsx |

常用开关：
- `fill_stats.py --resume` 断点续跑，跳过已抓链接
- `fill_stats.py --reuse cache_x.json` 复用已有结果，不重新抓取
- `audio_step.py --limit 3` 只跑前 3 条

## 实测速度

### ⚠️ 下面的旧数据已被 2026-09-22 的优化推翻，看「优化后」那张表

| 环节 | 8 条耗时（旧） |
|---|---|
| 抓数据 | 19.4 s（2.4 s/条） |
| 提音频 | 86.2 s（10.8 s/条，~~必须串行~~ **错，见下**） |
| 转文字 | 28.8 s（13915 字，4 并发安全） |
| **合计** | **约 2.5 分钟** |

### 优化后（2026-09-22 实测，42 条口径）

| 环节 | 优化前 | 优化后 | 关键改动 |
|---|---|---|---|
| 采集互动数据 | 10 min（14 s/条） | 10 min | 未动（可并发，待验证） |
| **音频提取** | **8.0 min（11.2 s/条）** | **~1 min（1.3 s/条）** | **直链直通** ⭐ |
| ASR 转写 | 1.5 min | 1.5 min | 已够快 |
| 8 维度拆解 | 15 min | ~10 min | 5→8 路并行 |
| 回填飞书 | 1 min | 1 min | — |
| **合计** | **~38 min** | **~26 min**（采集并行则 ~19） | |

**音频环节现在是全链路最便宜的一环，不再是瓶颈。** 采集和拆解才是剩下的大头。

### ⭐ 直链直通：音频 11.2 s/条 → 1.3 s/条（8.6 倍）

**详情接口 `/aweme/v1/web/aweme/detail/` 的响应里本来就带 `video.play_addr.url_list`**
（3 个 CDN 直链，还有 `play_addr_h264` / `play_addr_265` / 21 档 `bit_rate`）。
以前是"采集时已经拿到直链，却为了拿音频再开一次浏览器解析一遍"——那 11.2 s 里有 10 s 是重复劳动。

- `collector.py` `parse_aweme()` 新增 `play_url`（优先 `play_addr_h264` → `play_addr` → `play_addr_265`）
- `audio_step.py` 自动分流：有 `play_url` 走 `extract_direct()`（纯 ffmpeg，不启浏览器）；
  没有的才落到 `batch_extract.py` 浏览器路径。**两条路径可混跑**，manifest 自动合并。

**直链有效期**：URL 里的 token 是 16 进制时间戳，实测**几小时后**才过期
（`6ab26192` → 当天 19:08，`6ab388e2` → 次日 16:08）。
**同一次跑内用绰绰有余**，不用担心"采完就失效"。跨天用就重新采一遍。

实测：2 条直通 4.7 s（含质检），单条 1.06~1.57 s。

### ⚠️ 音频**可以并发**：官方"并发会抓不到直链"的说法是错的

skill 里原来写着"必须串行"，`audio_step.py` 也据此把 `--workers > 1` 强制降成 1。
**2026-09-22 实测推翻：6 条 / `--workers 4` → 6/6 成功，32.6 s（串行 67 s，2 倍）。**

之前"并发全失败"的真实原因是个**收尾 bug**：

```
greenlet.error: cannot switch to a different thread (which happens to have exited)
  at batch_extract.py  for r in resolvers: r.close()
```

`Resolver`（内含 Playwright **sync** 实例）在**子线程**里创建，主线程调 `close()`
触发线程归属错误 → 脚本在写 `summary.json` **之前**就崩 → 看着像"全部失败"，
**但 wav 其实全都生成好了**（实测 6 个 wav 都在）。

修法：`batch_extract.py` 的 close 加 try/except（进程退出自然回收）。
`audio_step.py` 默认 `--workers 4`。

**排查口诀：并发跑完没有 `summary.json`、但目录里有 wav → 就是踩到这个 close bug。**

100 条估算：音频约 2~3 分钟（原来要 18 分钟）。

## 登录态持久化：用户已授权，平时不用扫码（2026-09-22）

**实测有效期**（`douyin_state.json`，73 个 cookie）：

| cookie | 有效期 |
|---|---|
| `sessionid` / `sessionid_ss` / `sid_tt` / `uid_tt` | **约 59 天** |
| `sid_guard` / `ttwid` / `odin_tt` / `d_ticket` | 约 1 年 |
| `strategyABtestKey` 等策略类 | 约 6~7 天（每次访问自动重下发，无需管） |

**所以登录态本身很持久，绝大多数"采集失败"都不是过期，而是没加载上**
（今天那 5 条音频全失败就是相对路径被 cwd 吃掉 → 静默降级成无登录态，见坑 21）。

### 三个命令

```bash
python refresh_login.py --check     # 体检（只读，日常看这个）
python refresh_login.py --refresh   # 静默续期（无头，不用扫码）
python refresh_login.py --login     # 兜底：弹窗扫码（只在真过期时）
```

`login_state.py` 提供 `inspect()` / `backup()` / `refresh()` / `ensure_fresh()`。

### 已接进流程（不用手动管）

- `collector.py` 的 `open_browser()` → 每次采集先跑一次 `check_login_once()`，报剩余天数
- `audio_step.py` → 开跑前 `login_state.ensure_fresh()`，**剩不到 10 天自动静默续期**
- `audio_step.py` 的 `--state` **不传就默认用项目里的 `douyin_state.json`**
  （以前不传 = 无登录态跑 = 一条直链都抓不到）
- 已建月度保活自动化（每月 1 号 10:00 跑 `--refresh`）

### 备份与安全

- 每次续期前自动备份到 `.login_backup/`，滚动保留 5 份
- **`douyin_state.json` 等同账号凭证**：只留本机，不要提交 git、不要上传网盘或粘进对话
- 排查日志里**只打印剩余天数，不打印 cookie 值**

## 必须记住的坑（都踩过）

1. **playwright 异步 API 的 `response.json()` 是协程方法。** 不能在同步的
   `on_response` 回调里直接调用（拿到的是协程对象，不是数据）。
   回调里只存 response 对象，主流程里 `await resp.json()`。

2. **短链会跳转换成长链。** 原文是 `v.douyin.com/xxx/`，抓完 `url` 变成
   `iesdouyin.com/share/video/...`，按 url 直接匹配必然全落空。
   解法：给每条结果记 `source_url`（原始输入链接），并按
   `source_url → aweme_id → 出现顺序` 三级兜底配对。

3. **页面里混着推荐流视频。** 详情接口一次返回多条，必须按 `aweme_id` 挑目标那条，
   不然会抓错成旁边推荐视频。

4. **音频提取绝对不能并发**（`--workers>1` 会让部分条目抓不到抖音直链）。
   实测串行 86.2 s / 8 条（10.8 s/条）。官方 `batch_extract.py` 默认就是 1，别改。
   ASR 转写反而可以并发（4 路安全），因为那是纯 API 调用。
   另外别拦截页面 image/font/stylesheet 试图加速，会导致抓不到直链。

5. **用户已有文案时别重复提取。** 走 ASR 每条要 1~2 分钟，是全流程最慢的一环。
   素材 txt 里若已有文案，用 `--no-audio` 或让 merge 优先保留原文。

6. **验收音频要看内容，不看返回码。** pipe 模式的空音频返回码也是 0。
   判据：`codec==pcm_s16le && sample_rate==16000 && channels==1 && duration>=0.2s`。

7. **缓存要按输入文件名隔离**（`cache_<名>.json`、音频按批次分目录），
   否则跑第二批会把第一批的数据串进来。

8. **本地 whisper 别用。** tiny 模型中文质量极差（"纳瓦尔"→"大网人"），
   small 模型下载还会中途失败。直接用阿里云百炼 Paraformer-v2，质量好且快。

## 网页端到底能抓到什么（2026-09-22 实测探测）

用 `_probe_endpoints.py` 拦截视频页全部 XHR，**共 39 个接口**；`_probe_fields.py` 展开字段树。
结论：**网页端能拿到的远多于现在流水线在用的那 10 列**。

### 已经在抓（10 列）
点赞 / 评论 / 收藏 / 转发数、作者粉丝数、视频时长、ASR 文案、发布时间、
互动率（藏赞比 / 评赞比 / 转赞比）、8 维度拆解。

### 能补抓，且对内容分析有用

| 数据 | 来源 | 价值 |
|---|---|---|
| **评论内容** | `/aweme/v1/web/comment/list/` | 观众原话，可直接做"需求挖掘" |
| 评论 IP 属地 | 同上 `ip_label` | 看内容的地域穿透力 |
| 评论点赞 / 是否热评 | 同上 `digg_count` / `is_hot` | 挑出"观众最认同的观点" |
| 内嵌回复 | 同上 `reply_comment` | 看争议点在哪 |
| **作者签名** | `detail.author.signature` | **直接暴露账号定位和人设** |
| **话题标签** | `detail.text_extra[].hashtag_name` | 选题标签策略 |
| 是否原声 | `detail.music.is_original_sound` | 判断内容形态 |
| **相关推荐 10 条** | `/aweme/v1/web/aweme/related/` | 一条链接带出 10 条同类视频，**找爆款不用一条条搜** |
| **全站热搜榜 51 条** | `/aweme/v1/web/hot/search/list/` | 含 `hot_value` 热度值，选题趋势 |
| 发布状态 | `detail.status.in_reviewing` / `is_prohibited` | 判断是否被审核 / 限流 |
| 更多统计 | `detail.statistics` | `recommend_count`(推荐) / `collect_count` / `play_count`（实测恒为 0） |
| 弹幕 | `/aweme/v1/web/danmaku/get_v2/` | 实测该条 0 条，非通用 |

### 抓不到（仅作者后台可见）
完播率、观众画像、粉丝画像、转化归因。

### 评论翻页怎么抓（实测 34 条仅 1.2 s）
复用页面上下文 `fetch()`，只改 `cursor`，**不用重开浏览器**：
```python
base_u = comment_url["u"].split("&cursor=")[0]
url = f"{base_u}&cursor={cursor}&count=20"
txt = await page.evaluate(
    "async (u) => await (await fetch(u, {credentials:'include'})).text()", url)
```
每页 20 条，`has_more` 判结束。脚本见 `_probe_comments.py`。

### 实测样本（瑞克商业咨询，1292 粉 / 5313 赞）
- `statistics`：赞 5313 / 评论 47 / 收藏 4958 / 转发 1996 / 推荐 29
  → **藏赞比 0.93**，典型"工具型干货"，收藏几乎等于点赞
- `author.signature`：`前大厂牛马/ ENTJ / 去过十几国谈业务 / 职场·创业·人性·搞钱干货`
- `text_extra`：`#ai #gpt #codex #赚钱思维 #生意`（5 个标签全在正文开头）
- 评论 IP 分布：上海 5 / 广东 5 / 山东 4 / 浙江 4 / 安徽 3（还有坦桑尼亚 1）

## 评论库：把评论区变成需求库 + 选题库（2026-09-22 落地）

用户原话：**"评论不是拿来全部保存，而是把评论区变成一个持续更新的【用户需求库 + 选题库】。"**

### 三层结构（别搞混）

| 层 | 表 | 装什么 |
|---|---|---|
| 原始视频层 | 内容蒸馏 `tbljaR1tbDTzyl0s` | 作者讲了什么（326 行） |
| **需求主题层** | **评论库 `tblDo6Uw4VmHoCi1`** | **按作者归并的需求主题（495 行）** |
| 聚合层 | 用户需求库 `tblqLdSGXWUnIklx` / 选题库 `tblly0ZkoOM5aCVT` | 聚类出的母需求、母选题 |

**逐条评论不落飞书表。** 第一版建过一张「评论原始层」（9620 行），
2026-09-22 用户确认**已删**。逐条数据只留本地 ndjson，
飞书上只放归并后的需求主题 —— 用户要的是"看结论"，不是"翻日志"。

**⚠️ 关键教训：评论库不能是「每条评论一行」。**
第一版按逐条评论建了 9620 行，用户原话：

> 「这样总结行数太多了飞书都不够用了 不应该这样总结」

正确形态是**按需求归并** —— 495 行，压缩 19:1。
观众反复问的同一件事只占一行，样本数记在字段里。

### 一条链路跑完

```bash
# 1) 从蒸馏库拉有链接的视频清单（已按赛道过滤，只留 AI/跨境）
python _comments_plan.py                 # → _comments_todo.json

# 2) 抓评论 + 无效过滤（并发 3，161 条约 10 分钟）
python comments_step.py --todo _comments_todo.json --workers 3 --resume

# 3) AI 逐条蒸馏（并发 8，约 9 分钟）—— 中间产物，不是终点
python comments_distill.py --workers 8 --resume

# 4) ★ 归并成需求主题（并发 4，约 10 分钟）—— 这一步才产出「需求库」
python comments_cluster.py --workers 4

# 5) 推进飞书【评论库】（聚合版，一行一个需求主题）
python push_themes.py --table-id tblDo6Uw4VmHoCi1
```

`push_comments.py` 是往「逐条评论表」推的，那张表 2026-09-22 已删。
需要重建的话：先按 `_create_comment_table.py` 的字段定义建回一张表，再跑它。
日常不需要，跑完 1~5 就够。

### 实测（2026-09-22）

| 环节 | 数字 |
|---|---|
| 视频 | 161 条（有链接且评论数 >0） |
| 抓到评论 | 21279 条 |
| 过滤后有效 | 9879 条（**保留 46.4%**） |
| 采集耗时 | 590.7 s（并发 3，**0 失败**） |
| 逐条蒸馏 | 548.8 s（并发 8，qwen-turbo） |
| **归并** | **574 s（并发 4，qwen-plus）→ 528 个需求主题** |
| 入库 | 评论库 **495 条**（赛道过滤后；逐条评论不落表，只留本地 ndjson） |

丢弃分布：重复 22.7% / 无意义短词 11.4% / 纯表情 6.9% / 纯数字 6.1% /
广告引流 2.9% / @他人 2.6% / 空 0.9% / 灌水 0.2%

**⚠️ 归并必须用 qwen-plus，不能图便宜用 turbo。** 聚类比逐条蒸馏难得多
（要判断"这两条算不算同一个需求"），turbo 会把不同需求硬合并成一条。

**⚠️ 归并输入要截断。** 单作者最多送 150 条（按价值分 + 点赞排序取头部）。
全送会把长尾噪音一起喂进去，反而稀释聚类质量。跨境出海运营站 1023 条评论
实际只送了头部 150 条，归出 15 个主题，质量没问题。

### 过滤规则（`comments_filter.py`）

两级，**全部可解释**（丢的时候给原因码，方便回头调规则和抽查误杀）：

1. `classify_invalid()` 硬过滤 → `empty / emoji_only / number_only / meaningless /
   ad / at_only / follow_trade / spam / dup`
2. `value_score()` 打分排序 → 长度 + 信号词 + 点赞 + 热评 + 回复数 + 有没有问号

**⚠️ 坑：`@` 判定会无限递归。** `@` 后面跟空格或标点时 `AT_RE` 不匹配，
`stripped` 就等于 `raw`，直接递归必然 `RecursionError`。必须判 `stripped != raw`。

**⚠️ `@他人` 的边界要拿捏**：整条只有 `@某人`（或 @ 之后剩下的本身是灌水）才过滤；
`@豆包 总结国内电商参考视频怎么找机会` 这种 **@ 后面带实质需求**的要留。

**⚠️ @AI助手 一律保留**（2026-09-22 用户指出）。`@豆包 总结` `@豆包 转文字`
这类去掉 @ 之后只剩两个字，很容易被判 `at_only` 丢掉，但它表达的正是
「想让 AI 把这个视频摘要出来」这个真实需求。`AI_AT_RE` 专门放行。

**⚠️ 纯夸赞要挡掉**（用户点名：「老天鹅怎么帅成这样了」「[尬笑]居然很帅」
「醍醐灌顶[比心]」）。用 `is_pure_praise()`：剥掉语气词/程度词后，
如果剩下的**全是夸奖词**就算纯夸赞。`PRAISE_WORDS` 和 `PRAISE_FILLER`
**必须按长度降序** —— 否则"醍醐灌顶"里的"顶"会先被剥掉，剩"醍醐灌"判不出来。

### AI 蒸馏（`comments_distill.py`）

- 百炼 OpenAI 兼容接口，一次 12 条一批，带 4 次退避重试
- **模型：`--model qwen-flash`（2026-10-26 起推荐）**。原来默认 `qwen-turbo`，
  但 turbo 的额度很容易被打满、满额后**整批全失败且日志只说"失败"**，
  要加 `--verbose` 才看得到 `HTTP 429`。flash 实测 3606 条 505s、0 失败。
  并发建议 `--workers 4`（8 并发容易触发限流）。详见坑 36。
- 输出：`评论类型`（9 选 1）/ `核心需求/痛点` / `可延伸选题` / `选题价值`（高中低）
- **prompt 里的价值标准必须写死**，否则模型判太松 —— 第一版把
  "产品化，首先要有一个产品"（接梗）、"带我一起搞"（社交意愿）都判成「高」。
  补上"陈述句/反问接梗/调侃不算问题""求带/加我一个价值判低"之后才正常。
- 实测分布（2026-10-26 森桢那批，qwen-flash）：高 71.5% / 低 26.5% / 中 2.0%

### 一个反直觉的发现

**重复率最高的词，恰恰是最强的需求信号。** 判为「重复」的 4827 条里：

- `大数据请给我推，1.央视新闻…` × 589（刷屏模板，真无效）
- **`求文档` × 215 / `求提示词` × 132 / `咨询雷达` × 127 / `第二大脑` × 123**

后一类是观众在**集中索要同一份东西**。虽然按规则被过滤掉了，
但这个"集中度"本身值得单独看 —— 是选题和产品的强信号。

### 采集已自动带评论

`collector.py` 加了 `--no-comments`（默认**抓**）。采集完主数据后自动调
`comments_step.collect_for(results, track_only=not args.all_tracks)`，
评论直接追加进 `comments_all.ndjson`。
评论抓失败**不会**把主采集流程带崩（`collect_for` 内部吞异常）。

**默认只抓 AI / 跨境赛道作者的评论**（见上面「赛道规则」），想全抓加 `--all-tracks`。

### ⭐ 赛道规则：只采 AI 和跨境（2026-09-22 用户要求）

用户原话：**"只采集 AI 或者跨境的评论 其他的删除"**。

判定的是**作者的主赛道**，不是"这条评论有没有提到 AI"。
自媒体运营号偶尔提一句 AI，仍算其他 —— 所以**不能用关键词判**：
墨鱼 163 条里只有 6 条提到 AI（3.7%），关键词会把它误判成 AI 赛道。

两个信号源，`track_override.json` 优先级更高：

| 文件 | 来源 |
|---|---|
| `track_map.json` | `track_judge.py` 用 qwen-plus 判的，可重跑覆盖 |
| `track_override.json` | 人工裁定 —— 模型对只有 1~2 条视频的作者判不准 |

统一入口是 `track_rules.py` 的 `is_kept(作者)` / `track_of(作者)`。
**没判定过的作者默认「其他」**（宁可漏采），但会被打印出来 ——
看到陌生名字就去跑 `track_judge.py`，或直接加进 `track_override.json`。

```bash
python track_judge.py              # 判定蒸馏表里全部作者 → track_map.json
python track_judge.py --sample 12  # 每个作者最多看 12 条标题
```

接在两个地方：

1. `_comments_plan.py` 拉清单时过滤 —— 非本赛道作者的视频不进采集队列
2. `collector.py` 默认 `track_only=True`，想全抓加 `--all-tracks`

**⚠️ 坑：模型返回的 key 会带方括号。** 返回的是 `{"【墨鱼】": "其他"}`，
直接 `if a in chunk` 整批匹配不上，会**静默**全兜底成「其他」（踩过，24 个作者白判）。
剥一层再匹配，但**不能用 `strip("【】")`** —— 作者名自己可能以 `】` 结尾
（"辛说说说【硅基拍档】"），会被误剥掉尾字符，永远匹配不上。

2026-09-22 清理结果：528 → **495 条**。剔掉 3 个作者：
dontbesilent 聊赚钱（15）/ 姜胡说（13）/ 黄小寒（5）。
50 个作者里 44 个 AI、1 个跨境（跨境出海运营站）、5 个其他（含无链接的墨鱼）。
被删的 33 条归档在 `comments_themes_dropped.ndjson`，原件在 `comments_themes_raw528.ndjson`，都能恢复。

### 下游怎么用

`baokuan-rewrite` 和 `account-distill` 都已改成**同时读两张表**：
内容表学作者怎么写，评论库定选题方向、找原视频没答到的点。

按作者筛评论库：
```bash
lark-cli base +record-list --base-token IjbBblKh0amzztsiExVc1PqInfd \
  --table-id tblDo6Uw4VmHoCi1 \
  --filter-json '{"logic":"and","conditions":[["作者账号","intersects","<作者>"]]}' \
  --format ndjson --output ./comments-author.ndjson --as user
```

## 转写通道

用 `aliyun_asr.py`（别的产品流写的，别改）：阿里云百炼 DashScope **Paraformer-v2**，
不是 NLS。凭据在 `.env` 的 `DASHSCOPE_API_KEY`。
流程：本地音频 → 上传 DashScope 临时 OSS → 提交异步转写 → 轮询 → 取 text。
`asr_batch.py` 是在它上面加的批量 + 并发 + 契约格式层。

## 数据契约（三边对齐靠它）

`audio_manifest.json`：
```json
{"items":[{"source_url","aweme_id","audio_path","sample_rate","channels",
           "duration_sec","file_size","status","error"}]}
```
`asr_result.json`：
```json
{"items":[{"source_url","aweme_id","audio_path","duration_sec",
           "text","char_count","status","error"}]}
```
- `source_url` 必须原样透传，这是关联主键
- 失败的条也要写进来（status="failed" + error），便于定位重跑
- 音频规格 16kHz / mono / PCM WAV

## 互动率怎么看

- 藏赞比 = 收藏/点赞，高说明干货感强（知识类号常见 50%+）
- 评赞比 = 评论/点赞，高说明争议性或讨论欲强
- 转赞比 = 转发/点赞，高说明用户愿意替你传播

典型画像：点赞高但藏赞比低 = 情绪型内容，看完就走；
点赞低但转赞比高 = 争议型内容，不爱点赞但忍不住转给别人。

**破圈稀释效应（2026-09-21，34 条定量样本）**：`log(点赞)` 与藏赞比
r = −0.283、与转赞比 r = −0.445。<5 千赞藏赞比中位 0.78，>2 万赞降到 0.44。
→ **点赞越高越破圈，收藏/转发比例越低**。"点赞高"不等于"内容有用"，
用点赞单一指标挑对标会系统性偏向情绪型内容。

## 拆解环节才是瓶颈（2026-09-21 实测）

跑 11 条的墙钟账：

| 环节 | 耗时 | 能不能压 |
|---|---|---|
| 机器流水线（抓数据+音频+转写+合并） | 191.9 s | 能，优化后 ~175 s |
| **写 8 维度拆解（10 条 ≈ 5000 字）** | **约 20 分钟** | **压不掉，token 生成硬成本** |
| 工具往返（读全文/校验/推送） | 约 5 分钟 | 能压到约 2 分钟 |

所以"半小时"里机器只占 3 分钟，**大头是写分析**。
别指望改脚本能把半小时压到 5 分钟——那是 token 成本，不是代码问题。

**要提速只能砍拆解深度**，三档（用户指定档位，默认 full）：

| 档位 | 填哪些 | 11 条约 | 适合 |
|---|---|---|---|
| `full` 完整 | 11 个字段 | 20 分钟 | 深度模仿、做方法论 |
| `fast` 快速 | 标题/行业类型/选题切口/核心观点/可复用机制（5 个） | 约 10 分钟 | 定量统计（统计主要靠选题切口+核心观点） |
| `mini` 极速 | 核心观点 + 可复用机制（2 个） | 约 5 分钟 | 只要结论、只要能搜 |

自检要跟着降档，否则空字段会 FAIL：
`python check_analysis.py --analysis x.json --mode fast`
（push 时没填的字段自然不会写进表里，不会留下空列）

### ⚡ 大批量拆解用「并行子代理」，42 条从 80 分钟压到 ~15 分钟（2026-09-22 走通）

上面那张表说"token 成本压不掉"——**单线程确实压不掉，但可以并行**。
42 条 × 8 维度用单线程写要 1 小时以上；拆给 5 个并行子代理，实际约 15 分钟。

固化脚本 `_split_batches.py`（按正文长度做**均衡分配**，长的少给几条）：

```bash
python _split_batches.py 5        # 出 _decon_batches/batch1..5.json
```

然后**在同一条消息里发 5 个 Agent 调用**（并行），每个的 prompt 必须自带：
1. 输入文件绝对路径、输出文件绝对路径（`out1.json` …）
2. **严格的输出 schema**：`{source_url: {8 个字段}}`，key 必须照抄 `source_url` 原值
3. **8 个字段的写法样例**（直接抄墨鱼那条当 few-shot），说明每字段 30–150 字
4. 硬约束：不许编造正文外信息（别脑补画面/BGM）；ASR 同音错字顺手改但不润色
5. "每一条都必须出现在输出里，一条不能漏"
6. "输出必须是合法 JSON，不要包 markdown 代码块"

合并校验（**必须做，子代理会漏条**）：

```python
merged = {}
for f in glob.glob("_decon_batches/out*.json"):
    merged.update(json.load(open(f, encoding="utf-8")))
assert not (want - set(merged))          # 缺失 key
assert not (set(merged) - want)          # 多余 key
assert all(all(v.get(k) for k in KEYS) for v in merged.values())   # 字段不全
```

2026-09-22 实测：5 批 8/8/8/9/9 条，合并 42/42，缺失 0、多余 0、字段不全 0。

## 拆解前：先跑 auto_fill 省掉 12%

```bash
python auto_fill.py --data cache_x.json --asr D:\douyin_audio\x\asr_result.json \
                    -o analysis_x.json
```

自动填好 **话题**（从标题抠 #标签）和 **黄金开头**（截文案首句，实测与人工写的
**逐字一致**），并把标题/行业类型/其余 7 个维度留空等我写。
每条少写约 70 字 → 10 条约省 700 字 → 拆解耗时降约 12%。
自动版话题会带噪音标签（如 #创作者扶持计划），我扫一眼删掉即可，比从头写快。

重复跑不会覆盖已填内容（要覆盖加 `--force`）。

## 拆解完必跑的三件事

```bash
# 1) 质量自检：字段齐不齐、字数够不够、有无占位符、AI 味超不超标
python check_analysis.py --analysis analysis_x.json --source cache_x.json

# 2) AI 味检测：拿本库 197 条真人语料当基准（真人 AI 味指数中位 2.0）
python ai_flavor_check.py --json analysis_x.json
python ai_flavor_check.py --calibrate        # 重算真人基准

# 3) 检索复用
python search_lib.py --kw 反常识 --top 5     # 关键词检索
python search_lib.py --min-cz 1.0            # 高收藏型（教程类）
python search_lib.py --rebuild               # 快照过期时重拉
```

**自检不过不许推飞书**（check_analysis.py 有 FAIL 就 exit 1）。
AI 味指数 >30 判 FAIL，>15 判 WARN。实测修完的分析在 0~8.2，真人基准 2.0。

## 新增的坑

9. **同一视频的多条短链会让转写结果互相覆盖。** aweme_id 相同时，
   `asr_result.json` 里两条记录的 `source_url` 会被写成同一个，failed 那条盖掉 ok 那条，
   文案变空。所有索引（merge_all / push_to_feishu / dump）都必须 **status=ok 优先**，
   不能靠 items 的排列顺序碰运气。pipeline 已在 ① 之后加 ①-b 去重。

10. **飞书 text 字段读回来是 `[url](url)` markdown 格式**——这是 API 的返回表示，
    **不是数据被写坏**。判据：`[http` 出现 1 次（双重包装会是 2 次）。
    别去"清洗"，写入纯 URL 即可；按 URL 抠 aweme_id 的正则照样命中。

11. **`asr_batch.py` 统计字数要用 `r.get("char_count") or 0`**，
    被跳过的条没这个键，直接取会 KeyError 崩掉（已修）。

12. **时长格式化别用 `f"{dur/60:.0f}分{dur%60:.0f}秒"`**，会算出"2分60秒"。
    用 `f"{int(dur)//60}分{int(dur)%60:02d}秒"`。

13. **dump 长文案要分段**（每 400 字换行），否则整行超长会被读取截断，
    逼着你反复 Read 局部——这在拆解环节白烧了好几分钟。

## ⑤ 推飞书：**两张表都要推**（2026-09-21 踩过）

```bash
python push_to_feishu.py --preset collect --data cache_x.json --audio ... --asr ...
python push_to_feishu.py --preset distill --data cache_x.json --audio ... --asr ... \
                         --analysis analysis_x.json
```

**只推 collect 用户会说"我没看到数据"**——他平时看的是 `distill`。
视图不是原因（4 个视图都无筛选），是**推错表**。

- 采集汇总表 `WTBVbWH98a4KNgskZ6BcXjgUnCe` / `tbl65u3jTdpZ4zDw`（14 列）
- 内容蒸馏库 `IjbBblKh0amzztsiExVc1PqInfd` / `tbljaR1tbDTzyl0s`（25 列）

蒸馏库 25 列：标题 评赞比 平台(select) Hook机制 来源链接 可复用机制 表达方式
转赞比 核心观点 字数 选题切口 评论数 点赞数 行业类型(select) 论证方式 作者 时长
话题 内容结构 收藏数 黄金开头 原文/文案 爆款类型(select) 藏赞比 转发数
→ 自动可填 14 个；`发布时间` 会被丢弃（表里没这列）。
→ 分析类 8 个留空：选题切口 / Hook机制 / 内容结构 / 核心观点 / 论证方式 /
  表达方式 / 可复用机制 / 爆款类型。

拆解前先 `python auto_fill.py --data cache_x.json --asr ... -o analysis_x.json`
（自动填 话题 + 黄金开头），再补 `行业类型`（dict 结构，key 是 source_url）。

### 飞书读数的坑：`--limit 200` 会读不全
表 >200 行时 `+record-list --limit 200` 只回 200 条且 `has_more=True`，
统计会严重失真（曾误判"只推进去 3 条"）。**必须用 ndjson 拉全量**：
```bash
lark-cli base +record-list --base-token X --table-id Y \
    --format ndjson --output ./all.ndjson     # 默认上限 2000
```

## 一条命令跑完主页 → 两张表（2026-09-21 固化）

上面 9 条坑全部封进 `home2table.py`，日常只跑这一条：

```bash
python home2table.py "https://www.douyin.com/user/MS4wLjABAAAA..." [--name 巧掌柜]
python home2table.py <url> --no-analysis    # 只采集+推 collect，不预填拆解
python home2table.py <url> --dry-run        # 只采集，不推飞书（先验数据）
```

顺序：⓪备份上一批 → ①`_home_api.py` 接口采集 → ②造 cache（跳 fill_stats）
→ ③`audio_step.py` 串行提音频 → ④`asr_batch.py` 并发转写 → ⑤`auto_fill.py`
预填 → ⑥两张表都推。**备份必须在采集之前**（否则备份的是刚覆盖的新数据）。

命名规则（新批次独立文件，不覆盖上一批）：
- 链接清单 `素材_{name}_{N}条.txt`
- cache `cache_素材_{name}_{N}条.json`
- 音频 `D:\douyin_audio\素材_{name}_{N}条\`
- 拆解草稿 `analysis_{name}_{N}条.json`
- 上一批备份 `_{上批作者}_备份_home_raw.json`

### 拆解字段回填：`update_distill.py`（更新，不新建）

```bash
python update_distill.py --analysis analysis_主页2_15条.json
python update_distill.py --analysis xxx.json --all     # 连没拆的一起更新（一般不用）
```

**必须用 update，不能用 push**——push 会新建记录，同一视频在蒸馏库里出现两条。
默认只更新填了「核心观点」的条，避免把空壳写进去。

三个必踩的坑：

1. **依赖 ndjson 快照的时效性**。推完新数据后快照就过期了，再跑会报
   「待更新 0 条」（曾误判成链接对不上）。修法：脚本**每次都重新拉**，
   不读历史 `_fs_d_all.ndjson`。
2. **URL 匹配必须归一化**。飞书 text 字段读回来是 `[url](url)`，而且带 `?` 参数。
   `norm()` 两步：剥 `[url](url)` 壳 → 正则 `/(?:video|note)/(\d+)` 只留 id。
3. **`+record-batch-update` 的参数是 `--json`（不是 `--data`）**，且大 JSON
   必须写文件后传 `--json "@文件"`，直接塞命令行会被 cmd 解析炸掉
   （报"文件名、目录名或卷标语法不正确"）。`select` 字段（行业类型）必须传数组
   `["同行业"]`。

### 本轮新增的坑

14. **备份/清理类操作一律放在破坏性动作之前**。`home2table.py` 第一版把备份写在
    采集之后，等于备份了刚被覆盖的新数据（幸好有 `if not os.path.exists(dst)`
    兜着才没丢上一批）。凡"先覆盖再备份"都是假的。

15. **`subprocess` 不要用 `text=True`**。中文 Windows 下会抛
    `UnicodeDecodeError: 'utf-8' codec can't decode byte 0xc3`。
    用 `capture_output=True` 再 `.decode("utf-8","replace")`。

16. **图文笔记（`/note/`）没有音轨，物理上提不出文案**。实测只有 2.6s 空音频。
    这类条只能靠标题+图片，别浪费时间去重试音频链路。

17. **别用文件时间戳倒推用户意图**。mtime 只能证明文件什么时候写的。

## 定量分析必须控制"发布天数"这个混淆变量

踩过的错误结论：**"视频越短越好"**——因为时长与发布天数 r = −0.338（近期作品
恰好更长），不控制时间就会得出"短的更爆"。

控制后（>150 天的同期对比）：2.5–4 min 中位 1612 赞 > 1.5–2.5 min 的 1271 赞。
→ **时长不是决定因素，选题才是**。

同时确认账号确实在衰退：>200 天中位 1222 赞，<30 天中位 140 赞。

**藏赞比是跨账号最强的分类信号**（单账号内部很稳，跨内容类型差异极大）：
- 巧掌柜（AI 工具清单）中位 **1.26**（收藏 > 点赞）→ 收藏型选题
- TK跨境（操作教程）中位 **0.82**
- 判据：藏赞比 > 1 基本可判为"收藏型/工具型选题"

参考 `_home_review2.py`（含 `pear()` 相关性 + 分档对比的写法）。

---

## 低粉爆款筛选（2026-09-22 新增）

**触发**：用户给一批链接 + 要求"挑低粉爆款 / 找可翻拍素材"。

### 判定公式（用户口径，别自己改）

```
点赞粉丝比 = 点赞 ÷ 账号粉丝
    >10   → 潜力低粉爆款
    3~10  → 备选素材，谨慎翻拍
    <3    → 老粉流量，直接放弃

互动密度 = (评论+收藏+转发) ÷ 点赞
    >=0.15    → 优质
    0.08~0.15 → 普通
    <0.08     → 浅层点赞，不要选

综合：点赞粉丝比>10 且 互动密度>=0.08 → 低粉爆款候选
```

**最终落地口径（用户 2026-09-22 拍板，代码按这个写）**：

```
点赞粉丝比 >= 3  且  互动密度 >= 0.08   → 低粉爆款
```
用户原话："红鸡 1602 11680 7.29 1.006 60.9s … 像这种我已经觉得是低粉爆款了"。
即 **3~10 这一档不再叫"备选素材"，直接算低粉爆款**。

**结果写到哪**：不要新建「是否低粉爆款」字段 —— 用户明确说
**"爆款类型里面就有选项 正常爆款、低粉爆款、起号爆款 的选项 放这里就好"**。
写进已有的 `爆款类型` select，值传数组 `["低粉爆款"]`。
（建了又删的 `是否低粉爆款` = `fldcAzi5F1`，别再建回来。）

人工校验（补完播率的缺口）：**15–30s 可靠性高；>60s 翻车概率上升，优先短内容。**

### 跑法

```bash
python fill_stats.py -i "素材_xxx_N条.txt"     # 采数据（含粉丝数/时长）
python _lowfans_analyze.py                     # 算三件套 + 排序，出 json
python _lowfans_report.py                      # 出 xlsx + 分析报告 md
```

`_lowfans_analyze.py` 会自己合并 `cache__retry1.json` / `cache__retry3.json` 等重试缓存，
所以重试过的条不会丢。

### 选中的低粉爆款要"插进内容蒸馏库"时（2026-09-22 走通）

用户要的是**插入**（这些爆款通常不在蒸馏库里），不是更新：

```bash
# 1) 音频：登录态一定要绝对路径（见坑 21）
python audio_step.py --cache "cache_素材_低粉爆款_5条.json" \
    --out "D:\douyin_audio\低粉爆款_5条" --state "C:\...\douyin_state.json"
# 2) ASR：长视频放宽等待（682s 那条用默认 180s 会超时）
ASR_MAX_WAIT=900 python asr_batch.py --audio "D:\douyin_audio\低粉爆款_5条\audio_manifest.json" --workers 4
# 3) 插蒸馏库
python push_to_feishu.py --preset distill --data "cache_素材_低粉爆款_5条.json" \
    --audio "D:\douyin_audio\低粉爆款_5条\audio_manifest.json" \
    --asr   "D:\douyin_audio\低粉爆款_5条\asr_result.json"
```

实测：音频 58.6s（5/5）→ ASR 23.0s（5/5，7166 字）→ 插入 5 条。
`push_to_feishu.py` 只写表里真实存在的表头，`发布时间` 在蒸馏库没有会被自动丢掉，属正常。

### 字段已扩到 18 列

`collector.py` 的 `parse_aweme()` 现在多返回两个键（**不用改飞书、不用音频就能拿到**）：

| 键 | 来源 | 说明 |
|---|---|---|
| `follower_count` | `author.follower_count` | 作者粉丝数。兼容 `follower_count_str` 的 "1.2w" 写法 |
| `duration_ms` | `video.duration`（毫秒） | 视频时长。**不用提音频也有时长**，之前 `时长` 只能从音频实测拿 |

采集汇总表新增 4 个字段（已建）：
`作者粉丝数`(number) / `点赞粉丝比`(number,2位) / `互动密度`(number,3位)
（**没有** `是否低粉爆款`，判定写进已有的 `爆款类型`）

`push_to_feishu.py` 的 collect 分支已会算这三件套；`时长` 优先用音频实测，没有就回落到 `duration_ms`。

### ⚠️ 指标盲区：点赞粉丝比会系统性淘汰收藏型内容（2026-09-22 实测 42 条）

实测结果：**42 条里 0 条破 10（最高 7.29）**，而 **25 条（60%）藏赞比 >1**（收藏 > 点赞）——
这是 AI 工具类内容的标准特征，但它们**全部被判"放弃"**。

根因：**"点赞粉丝比"量的是破圈，"收藏"量的是实用。两个指标方向相反——
内容越值得收藏，点赞粉丝比往往越低。**

| 例子 | 收藏 | 点赞 | 藏赞比 | 点赞粉丝比 | 判定 |
|---|---|---|---|---|---|
| Lulu的AI野路子 | 14651 | 12307 | 1.19 | 2.07 | 放弃 |
| AI大魔头 | 8949 | 5570 | 1.44 | 0.66 | 放弃 |
| 10倍生产力 | 14560 | 14560 | 1.28 | 0.11 | 放弃 |

→ **交付时必须把这条告诉用户，并给两个口径让他选**：
- 要"能破圈的选题" → 用原判
- 要"可翻拍的工具类选题" → 加豁免：**藏赞比>1 且 互动密度≥0.5 → 升为备选**（实测会从 5 条变 29 条）
- **两种口径选出来的素材几乎不重叠**，这是必须让用户拍板的事，不能替他决定。

另外两个观察：
- **互动密度在工具类样本上几乎没区分度**（实测 42/42 全 ≥0.15，最低 0.58 = 阈值的 7 倍）
- **大号天然不可能有高比值**（13 万粉的号比值 0.11）。用户按"主题"搜来的链接里混大号，
  整体比值会被拉低 —— 要提醒他按粉丝数先筛一遍再算。

### 新增坑

18. **链接采集会偶发单条失败**（"未捕获到详情接口"）。实测 42 条一轮跑完剩 3 条，
    单独重试就成功。**必须写重试回路**：跑完扫 `aweme_id`/`digg_count` 为空的，
    单独出一批重跑，再合并回主 cache。别把失败条当"数据就是 0"。
19. **`+field-create` 的语法**：`--json "@文件"` 传数组，一次建多个；
    `{"name":"X","type":"number","style":{...}}`、select 用
    `{"name":"X","type":"select","multiple":false,"options":[{"name":"A"}]}`。
    `+field-list` 返回的是 `.data.fields[]`，键名是 **`name`**（不是 `field_name`）。
20. **`爆款类型` 是 select 字段**，推送时必须传**数组** `["低粉爆款"]`；
    `push_to_feishu.py` 已有的 select 过滤逻辑会自动处理，值不在选项里会被丢掉（别写错选项名）。
    表里已有的 197 条是 `正常爆款`，别整表覆盖 —— **只写命中的那几条**。

21. **⚠️ 音频提取必须给绝对路径的登录态，否则静默降级**（2026-09-22 卡了半天的坑）：
    `audio_step.py` 内部 `run(..., cwd=SCRIPTS)` 会把工作目录切到 skill 的 `scripts/`，
    所以 `--state douyin_state.json` 这种相对路径在那里**不存在** →
    `Resolver` 判断 `os.path.exists(sp)` 失败 → **静默退回无登录态** →
    短链被重定向到 `www.iesdouyin.com/share/video/...`（手机分享页，不加载视频流）→
    5/5 全报 `未抓到视频流直链（可能需登录态或页面未加载视频）`。

    排查口诀：**看到 `final_url` 是 `iesdouyin.com/share/` 就是登录态没生效**，
    正常应该是 `www.douyin.com/video/<id>`。

    ```bash
    # 对：绝对路径
    python audio_step.py --cache cache_x.json --out D:\douyin_audio\x --state "C:\...\douyin_state.json"
    # 错：相对路径（会被 cwd 吃掉）
    python audio_step.py --cache cache_x.json --out D:\douyin_audio\x --state "douyin_state.json"
    ```
    带上登录态后：5 条 58.6s 跑完，5/5 成功，平均 11.7s/条。

22. **`audio_qc.py` 在 0 个 wav 时会崩**（`IndexError: list index out of range`，
    `rows[0].keys()`）。上游全失败时这是必然发生的 —— 已加空表守卫，
    但如果又看到这个报错，说明**上游一条都没提取成功**，先查坑 21。

23. **读飞书表要认两种结构 + 分页**：
    - `+record-list --format ndjson` 出来是**扁平**的，字段名直接在行对象顶层
      （`r["来源链接"]`），**不是** `r["fields"]["来源链接"]`。
    - `--limit 200` 是硬上限，`has_more` 时用 manifest 里的 `next_offset`
      接 `--offset 200` 拉下一页。**新插入的记录永远在最后一页**，
      只拉第一页会误判成"插入失败"。

24. **`--state` 之外的提速点**：粉丝数按**作者**去重再抓。
    121 条链接只有 20 个唯一作者 —— 全量抓 11 分 46 秒还没完，
    去重后约 2 分钟。用户原话："同一个作者的粉丝只取1次就够了"。

25. **⚠️ 拿「内容蒸馏库」存量行做低粉爆款筛选，结果会近乎为空 —— 这是结构性的，不是脚本错**
    （2026-09-22 实测 126 条有链接的行）：

    | 比值区间 | 条数 |
    |---|---|
    | >=3 | 6（其中 5 条是当天新插入的） |
    | 2~3 | 1 |
    | 1~2 | 4 |
    | 0.5~1 | 7 |
    | **<0.5** | **108（86%）** |

    根因：蒸馏库是按**大号**建的（跨境出海运营站 31270 粉、巧掌柜笔记 10564 粉、
    dontbesilent 聊赚钱 497570 粉…），大号天然不可能有高比值。
    **低粉爆款只能从"新采的链接"里筛，别指望在存量蒸馏库里捞。**
    交付时要讲清楚，否则用户会以为是脚本没算对。

    跑法：`python _distill_lowfans_rank.py`（读 `_distill_v3*.ndjson` 两页 → 出 xlsx + md，
    含「接近阈值备选池」和「收藏型豁免提示」两档标注）。

26. **⚠️ 用户说"我要的都是插入在这里"时，指的是全量，不是只挑爆款**（2026-09-22 犯过）：
    用户给了 42 条采集任务 + 蒸馏库链接，说"我要的都是插入在这里"。
    我理解成"采集结果推采集汇总表"，**只把筛出来的 5 条低粉爆款插进了蒸馏库**，
    另外 37 条推到了采集汇总表 → 用户问"你录进去了吗"才补。
    **目标表和 `--preset` 默认值冲突时，默认值必须让位，不要替用户缩小范围。**

27. **⚠️ 核验"是否插入成功"必须匹配 `来源链接` 里的短链，不要匹配 `aweme_id`**：
    蒸馏库**不存 aweme_id**（`来源链接` 存的是 `v.douyin.com/xxx` 短链或 iesdouyin 长链）。
    拿 aweme_id 去匹配会得到 **0/42**，看着像全军覆没，实际数据都在。
    正确写法：
    ```python
    m = re.search(r"v\.douyin\.com/([A-Za-z0-9_-]+)", r["source_url"])
    ok = m and m.group(1) in blob
    ```

28. **`是否低粉爆款` 这个字段在两张表里都不要再建**：
    2026-09-22 先在采集汇总表建了（`fldyGMmcmA`）、又在蒸馏库建过（`fldcAzi5F1`），
    **两次都被用户否掉**。统一用 `爆款类型` select
    （选项：`正常爆款` / `低粉爆款` / `起号爆款`）。
    采集汇总表的已删并新建 `爆款类型`（`fldb7GWZ5r`）；蒸馏库的用原有 `爆款类型`。

29. **`update_distill.py` 原来只拉第一页（`--limit 200`），必须翻页**（2026-09-22 修）：
    只拉第一页时新插入的记录全在最后一页，表现为「待更新 0 条」——
    看着像匹配失败，其实是快照不全。`pull()` 已改成按 `--offset` 循环翻页。
    另外它的 `FIELDS` 原来只有 7 个（漏了 Hook机制/内容结构/论证方式/表达方式），
    **回填时那 4 个维度会被静默丢掉**，已补齐到 11 个（2026-10-14 又补了 `爆款类型`，
    它和 `行业类型` 一样是 select，**必须传数组**）。

30. **⚠️⚠️ `lark-cli ... --output <file>` 默认不覆盖，会静默让你读到旧文件**
    （2026-10-14 踩了半天，是「待更新 0 条」的真正元凶）：
    - lark-cli 除了写 `<file>`，还会写一个 `<file>.manifest.json` 伴随文件。
      只要 manifest 已存在，命令就报 `output file already exists: xxx.manifest.json`
      （`failed_precondition`，rc=2）**并退出，ndjson 根本不生成**。
      如果代码没查 returncode（老 `pull()` 就是），就会**继续读上一天留下来的旧
      ndjson**，快照里没有新记录 → 匹配 0 条，看着像「链接对不上」。
    - 正确做法：**取数前先删 `<file>` 和 `<file>.manifest.json`**，并且加 `--overwrite`；
      同时**必须检查 returncode / 文件是否生成**，别信「命令跑了没报错」。
    - 顺带：`--output` 只认**相对路径**（绝对路径也失败），子进程用 `cwd=BASE` +
      相对文件名最稳。
    ```python
    for f in (part, part.replace(".ndjson", ".manifest.json")):
        if os.path.exists(f):
            os.remove(f)
    subprocess.run(["lark-cli.cmd","base","+record-list","--base-token",BT,
                    "--table-id",TID,"--format","ndjson","--output",part,
                    "--limit","200","--offset",str(off),"--overwrite","--as","user"],
                   cwd=BASE, capture_output=True)
    assert os.path.exists(part), "拉取失败"
    ```
    - 同类坑：`+table-list` 等**不需要 --output** 的命令没这个问题；
      但只要用 `--output` 重复写同一个文件，就要删文件或加 `--overwrite`。

31. **`update_distill.py --analysis` 的匹配键 = 视频 id 或去 query 短链**
    （`norm()`：先剥飞书 text 的 `[url](url)` 壳，再抠 `/video/<id>`）。
    分析文件的 key 直接用采集出的 `source_url`（iesdouyin 长链）就行，
    归一化后能对上。**`--all` 才更新「核心观点为空」的行，默认只更新有核心观点的。**
    跑法：`python update_distill.py --analysis analysis_持续增长派_25条.json`

32. **链接模式的 25 条链接模式蒸馏**（2026-10-14）：
    `python collector.py -f links_20261014.txt -o out.xlsx` 走「链接采集」，
    输出是 **`douyin_result.json`**（不是主页模式的 `douyin_filtered.json`，
    两者别搞混，`_prep_push.py` 已参数化成 `python _prep_push.py <data>`）。
    单条视频链接不抓评论（链接模式不调 `collect_for`）。

33. **⚠️⚠️ 2026-10-17 抖音风控：所有视频"未抓到详情接口"时的排查顺序**
    （症状：`@- | 赞 0 评 0 藏 0 转 0`、`下载完成 0.0MB`、`ffmpeg 抽音频失败`）

    **两个独立的原因，会同时出现，必须一起修：**

    **原因 A：登录态被风控降权。** 带 `douyin_state.json` 反而被 302 重定向到
    `/jingxuan`，`aweme/detail` 返回 **200 但 body 为空**。不带 cookie（游客）
    反而能拿到完整数据（10 万+ 字节）。
    → 实测矩阵（同一视频、同一时刻）：

    | 浏览器 | 身份 | 结果 |
    |---|---|---|
    | Chromium | 登录 | ✗ 302 `/jingxuan`，detail 空 |
    | **Chromium** | **游客** | **✓ 106 KB** |
    | Edge | 登录 | ✗ 空 |
    | Edge | 游客 | ✗ 空 |

    **只有「内置 Chromium + 游客」这个组合行。** Edge 两条路都不行。
    → 开关：`DOUYIN_NO_STATE=1`（不加载 state）+ `DOUYIN_BROWSER=chromium`
    （强制内置 Chromium，不用 msedge）。**两个必须一起用。**
    → 游客模式下 `save_state()` 已加了保护，**不会**回写覆盖你的真实登录态。

    **原因 B：detail 请求被发两次，第一个是空的。** 抖音现在先发一个
    `www.douyin.com/aweme/v1/web/aweme/detail/`（**秒回，body=0**），
    13 秒后才发真数据
    `www-hj.douyin.com/aweme/v1/web/aweme/detail/`（10 万+ 字节）。
    原代码用 `page.wait_for_event("response", predicate=...)` 等响应，它会在
    **第一个空响应**到达时就返回 → `resp.json()` 失败 → 永远解析不到数据。
    → 修法：`_poll_resolve()` 每 0.5 秒 `drain()` 一次，直到解析出 aweme，
    上限 25 秒（实测 13 秒左右到）。**别用 `wait_for_event` 等 detail。**

    **诊断口诀**（下次照这个顺序查，别瞎猜）：
    1. 先看落地 URL —— 是不是 `/jingxuan`？是 → 原因 A
    2. `page.on("response")` 打印 detail 的 **body 长度** —— 是不是 `[0, 103015]` 这种？
       是 → 原因 B
    3. 对照矩阵换「Chromium + 游客」再试一次

    **排查脚本**留了一份：`_diag6.py`（复现 `fetch_one` 并打印每一步），
    矩阵对照是 `_diag5.py`。都比人肉猜快。

    **代价**：游客模式下主页采集会受限（未登录只能翻到 21 个作品 vs 登录 55 个），
    单视频链接采集不受影响。**长期解法是重新扫码登录**换一个新 session
    （`python refresh_login.py --login`），把被风控的会话换掉。

34. **⚠️⚠️ 抖音前台拿不到播放量：`statistics.play_count` 恒为 0**（2026-10-26）
    用户说「把播放量 > 10000 的才蒸馏」时，**别直接写筛选器，先探一次**。
    detail 接口返回 127 KB 完整数据，`statistics` 里确实**有** `play_count` 这个 key，
    但值永远是 `0` —— 抖音不公开播放量，只有作者后台能看。探针：`_probe_play.py`。

    **替代口径 = 用点赞反推播放量**。抖音点赞率通常 1%~5%，取中值 **3%**：
    `播放 1 万 ≈ 点赞 300`。2026-10-26 实测「森桢出海电商」146 条：

    | 点赞门槛 | 条数 | 约等于播放 |
    |---|---|---|
    | ≥100 | 108 | 0.3 万 |
    | ≥200 | 83 | 0.7 万 |
    | **≥300** | **68** | **1.0 万** |
    | ≥500 | 46 | 1.7 万 |
    | ≥1000 | 22 | 3.3 万 |

    **做法**：先 `--min-digg 1 --min-comment 0 --min-collect 0 --no-content --no-comments`
    全量拿一遍（含 `play_url`），本地按门槛筛，再写回 `douyin_filtered.json` 转写。
    这样换门槛不用重采。全量记得另存一份备份。

    **跟用户沟通要说清这是折算**，别把点赞当播放量报。

35. **⚠️⚠️⚠️ 转写临时文件必须带 uuid，否则并发撞名 → 多条视频转出同一段文案**
    （2026-10-26 血案，数据已经推进飞书才发现）

    **症状**：一批里好几条的 `content` **完全相同**，但标题完全不同。
    2026-10-26 那批 68 条里串了 6 条（第 1~4 条 + 26~27 条）。

    **根因**：`aliyun_asr.transcribe_video` 原来用
    `stamp = str(int(time.time()*1000))` 命名 `_asr_tmp/<stamp>.mp4`，
    而 `_asr_backfill.py` 用 `ThreadPoolExecutor(max_workers=4)` 并发 →
    **同一毫秒启动的任务撞同一文件名，后下载的视频覆盖前一个**。
    转写本身不报错（下载成功、抽音频成功、转写成功），**静默污染**。

    **修法**（已改）：
    ```python
    stamp = f"{int(time.time()*1000)}-{uuid.uuid4().hex[:8]}"
    ```

    **排查手法**：按 `content[:80]` 分组，同组 > 1 条即为串线。
    **但隐性串线（只有 1 条错位、没有成组重复）查不出来** →
    **并发相关的改动之后必须全量重跑，不能只补可疑的那几条。**

    **脏数据已经入库的修法**：`_fix_content.py` —— 只覆盖飞书「原文 / 文案」
    一个字段（不碰拆解字段，那些人工/模型写的跟文案无关），
    key 用 `source_url` 走 `update_distill.pull/norm` 那套匹配。

36. **qwen-turbo 会限流（HTTP 429），逐条蒸馏改用 qwen-flash**
    （2026-10-26）`comments_distill.py` 默认 `--model qwen-turbo`，
    8 并发跑 301 批**全批失败**，日志只说「失败」看不出原因 ——
    **必须加 `--verbose` 才能看到 `HTTP 429: You have exceeded your current request limit`**。

    ```bash
    # 排查：小样本 + verbose + 单并发
    python comments_distill.py --limit 12 --workers 1 --verbose
    # 实测 qwen-turbo 满额时 qwen-plus / qwen-flash 仍可用
    python comments_distill.py --kept X.ndjson --out Y.ndjson \
        --model qwen-flash --workers 4        # 3606 条 505s，0 失败
    ```
    归并（`comments_cluster.py`）本来就用 `qwen-plus`，不受影响。

    **另**：归并输出的「样本数」是模型估计值，合计会远小于参与归并的评论数
    （2026-10-26：2548 条参与 → 15 个主题，样本数合计仅 86）。
    这是既有口径、不是 bug，看主题相对排序够用，别拿它当真值报。

37. **主页采集落 `douyin_filtered.json`，链接采集落 `douyin_result.json`**
    两个文件名不一样，别读错（2026-10-26 又读错一次）。
    主页模式 → `douyin_filtered.json`；`-f links.txt` 链接模式 → `douyin_result.json`。


30. **`update_distill.py` 的 `norm()` 走的是短链分支**：蒸馏库 `来源链接` 存
    `v.douyin.com/xxx` 短链，没有 `/video/<id>`，所以 `norm()` 返回去 query 的短链。
    **analysis JSON 的 key 必须用 `source_url` 原值**（短链），不能用 aweme_id。

31. **⚠️ 别为同一份数据抓两遍**（2026-09-22，本轮最大的性能教训）：
    详情接口已经把 `video.play_addr.url_list` 给我们了，却还要开一次浏览器去"解析"音频。
    凡是"下游要的数据上游响应里已经有"的情况，先去把响应打出来看一眼，再决定要不要另开一条链路。
    → 已实现 `play_url` 直通，音频 11.2 s/条 → 1.3 s/条。

32. **Playwright sync API 不能跨线程 close**：子线程创建的 `Resolver` 被主线程
    `close()` 会抛 `greenlet.error`。`batch_extract.py` 已加 try/except。
    这个 bug 的表现极有误导性——**wav 全部生成成功，只是 summary.json 没写出来**，
    看起来像"并发全失败"。**并发跑完没有 summary.json 但有 wav，就是它。**

33. **改判定口径时，阈值现在散在 3 个文件里**，改一处必漏两处：
    `push_to_feishu.py`（collect 分支）/ `_backfill_fans.py`（`RATIO_MIN` `INTER_MIN`）
    / `_lowfans_analyze.py`（`judge()`）。
    **待重构**：抽 `lowfans_rules.py` 单点定义。

## 待做的优化（按收益排序，2026-09-22 审查结论）

1. **采集环节并行**（14 s/条 × N，目前最大瓶颈）：`collector.py` 单 page 串行，
   同 context 开 3~4 tab 理论 2~3 倍。**风险是风控/验证码，先拿 6 条测 `concurrency=3`。**
2. **作者级粉丝数持久缓存**：粉丝数是账号级属性，落盘 `author_fans_cache.json`
   （作者→粉丝数+日期），7 天内不重抓。同一账号做多轮选题时这一项永久归零。
3. **采集内置失败重试回路**：现在靠手动出 `_retry1.txt` / `_retry3.txt` 补跑。
4. **判定阈值单点化**（见坑 33）。
5. **拆解并行度 5 → 8**：`_split_batches.py 8`，15 min → ~10 min。
6. **项目目录治理**：根目录混了 30+ 个 `_` 前缀一次性脚本和 20+ 个临时 json，
   建议分 `tools/` `archive/` `_tmp/`。
7. **`collector.py` 加单条耗时日志**：现在没有 per-item 计时，慢的时候定位不到是哪一条。

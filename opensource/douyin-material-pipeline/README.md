# 抖音素材库流水线（douyin-material-pipeline）

把竞品抖音号的爆款视频批量扒下来 —— 互动数据、口播文案、评论需求 ——
再送进飞书多维表，作为选题和二次创作的素材库。

**含代码**，不只是文档。clone 下来配好环境就能跑。

## 仓库结构

```
douyin-collector/            ★ 主代码（40 个脚本）
  collector.py               采集器 v3.0：链接模式 + 主页模式
  app.py                     Web 版界面（Flask，可选）
  pipeline.py                一键流水线：链接 → 数据 + 音频 + 文案 → 总表
  home2table.py              主页采集 → 直接进飞书两张表
  aliyun_asr.py              阿里云百炼 Paraformer 转写
  audio_step.py              音频提取环节（调用下面那个技能包）
  asr_batch.py               批量转写
  push_to_feishu.py          推送内容蒸馏库
  update_distill.py          回填拆解字段
  upgrade_collect_table.py   给采集表加列
  merge_all.py / analyze.py  总表合并 / 互动率分析
  search_lib.py              蒸馏库文案检索
  check_analysis.py          拆解质量自检
  auto_fill.py               拆解字段自动填充
  fill_stats.py              补数据
  fill_distill_rows.py       回填指定行
  _prep_push.py              推送前整理
  comments_step.py           评论采集
  comments_filter.py         评论过滤规则
  comments_distill.py        评论 AI 蒸馏
  comments_cluster.py        归并成需求主题
  push_themes.py             推送评论库
  push_comments.py           推送逐条评论（表已删，留作重建）
  _comments_plan.py          出待采集评论的视频清单
  _highfreq_needs.py         高频需求分析
  track_judge.py             作者赛道判定（AI / 跨境 / 其他）
  track_rules.py             赛道白名单规则
  track_map.json             模型判定结果（数据）
  track_override.json        人工裁定（优先级更高）
  login_state.py             登录态体检 / 续期
  refresh_login.py           登录态维护 CLI
  login_douyin.py            扫码登录
  _lowfans_analyze.py        低粉爆款筛选
  _distill_lowfans_rank.py   存量行低粉爆款排序
  _lowfans_report.py         出交付物
  _diag5.py / _diag6.py      风控排查工具（见坑 33）
  _probe_play.py             播放量探针（验证 play_count 恒为 0，见坑 34）
  _probe_endpoints.py        抖音接口探测
  _fix_content.py            修飞书「原文/文案」字段（文案串线用，见坑 35）
  _asr_backfill.py           给已采数据批量补文案（keep=True + 逐条回写 + 断点续跑）
  ai_flavor_check.py         AI 味检测
  requirements.txt
  .env.example

douyin-url-to-16k-wav/       依赖的音频提取技能包（76 KB，随仓库分发）
  scripts/douyin_audio.py    extract_audio_from_url
  scripts/batch_extract.py   批量提取
  scripts/audio_qc.py        音频质检
  SKILL.md / HANDOFF.md

SKILL.md                     ★ 技能本体：完整命令、字段口径、踩坑记录（精华在这）
```

## 快速开始

```bash
# 1. 依赖
pip install -r douyin-collector/requirements.txt
playwright install chromium

# 2. 配置
cp douyin-collector/.env.example douyin-collector/.env
#    填 DASHSCOPE_API_KEY（阿里云百炼）

# 3. 采集（⚠️ 必须带这两个环境变量，见下面风控那节）
cd douyin-collector
DOUYIN_NO_STATE=1 DOUYIN_BROWSER=chromium \
  python collector.py -f links.txt -o out.xlsx --headless
```

## 能干什么

一条链，四个阶段：

| 阶段 | 做什么 | 产出 |
|---|---|---|
| 1. 采集 | 主页 URL 或零散视频链接 → 抓赞/评/藏/转、标题、话题、作者、粉丝数、时长 | `douyin_result.json` / `douyin_filtered.json` |
| 2. 转写 | 视频 → 16k WAV → 阿里云百炼 Paraformer（异步） | 口播文案 |
| 3. 沉淀 | 合并总表 → 互动率排序 → 低粉爆款筛选 → 推送飞书 | 内容蒸馏库 / 采集汇总表 |
| 4. 评论 | 抓评论 → 过滤无效 → AI 逐条蒸馏 → 归并成需求主题 | 评论库（需求主题层） |

## ⚠️ 拿不到播放量，只能用点赞折算

抖音**不公开播放量**：detail 接口的 `statistics.play_count` 永远返回 `0`
（探针见 `douyin-collector/_probe_play.py`）。只有作者本人在创作者后台能看到。

所以要按「播放量 > N」筛选时，**只能拿点赞反推**。抖音点赞率通常 1%~5%，
取中值 3%：`播放 1 万 ≈ 点赞 300`。

推荐做法（这样换门槛不用重采）：

```bash
# 1) 全量拿一遍数据和直链，不转写、不抓评论
python collector.py -u <主页URL> --no-content --no-comments \
    --min-digg 1 --min-comment 0 --min-collect 0 -o all.xlsx

# 2) 本地按门槛筛（示例：点赞 >= 300 ≈ 播放 1 万），写回 douyin_filtered.json
#    —— 脚本见 SKILL.md 坑 34

# 3) 转写
python _asr_backfill.py
```

各门槛实测（某 146 条账号）：≥100→108 条 / ≥300→68 条 / ≥500→46 条 / ≥1000→22 条。

**跟需求方沟通时要说清这是折算值**，别把点赞量当播放量报。


低粉爆款判定口径：`点赞粉丝比 >= 3` 且 `互动密度 >= 0.08`
（互动密度 = (评论+收藏+转发) / 点赞）。

评论过滤是两级设计：硬过滤（纯表情/纯数字/广告/@他人/重复/纯夸赞…）+ 价值打分排序，
再按作者归并成需求主题，压缩比约 19:1。

## ⚠️ 跑采集前必读：抖音风控绕过（2026-10-17 发现）

抖音在 2026-10 改了行为，**登录态会被风控降权**。
症状：`未抓到详情接口`、`赞 0 评 0 藏 0 转 0`、`下载完成 0.0MB`。

### 首选解法：重新扫码（根治）

**风控绑在「会话」上，不是账号或 IP** —— 换一个新 session 就干净了。

```bash
DOUYIN_FRESH_LOGIN=1 DOUYIN_BROWSER=chromium python refresh_login.py --login
# 弹出浏览器 → 扫码 → 自动保存
```

实测：换完新会话后，**正常模式**直接就能跑，不需要任何绕过参数。

> **为什么必须加 `DOUYIN_FRESH_LOGIN=1`**：不加的话 `open_browser()` 会加载旧的
> `douyin_state.json`，浏览器一开就是「已登录」状态 → 脚本 3 秒内判定登录成功 →
> 直接把那个有问题的旧会话存回去，**你根本没机会扫码**。

### 应急解法：游客模式（旧会话还能用但被拒时）

```bash
DOUYIN_NO_STATE=1 DOUYIN_BROWSER=chromium python collector.py -f links.txt -o out.xlsx --headless
```

**两个开关必须一起用**：只有「内置 Chromium + 游客」能拿到数据，
Edge（原默认 `channel="msedge"`）两条路都不行。代价是主页采集受限
（未登录只能翻到 21 个作品 / 登录后 55 个）。

### 三个开关的语义

| 开关 | 加载旧 state | 允许保存 | 用途 |
|---|---|---|---|
| 都不设 | ✓ | ✓ | 正常采集 |
| `DOUYIN_NO_STATE=1` | ✗ | ✗ | 游客应急 |
| `DOUYIN_FRESH_LOGIN=1` | ✗ | ✓ | 重新扫码 |

### 另一个独立原因：detail 请求被发两次

抖音先把 detail 请求发两次 —— 先一个空响应（秒回），**约 13 秒后**才发真数据。
用 `page.wait_for_event` 等响应会在第一个空响应就返回，永远解析不到。
已改成 `_poll_resolve()` 轮询（每 0.5 秒 `drain()` 一次，上限 25 秒）。

排查细节、实测矩阵表和诊断口诀见 `SKILL.md` 的**坑 33**；
排查工具是 `_diag5.py`（矩阵对照）和 `_diag6.py`（复现采集流程逐步打印）。

## ⚠️ 换环境要改的地方

代码里有些路径来自原作者本机环境，换机器前按需调整：

| 文件 | 行 | 是什么 | 怎么改 |
|---|---|---|---|
| `douyin-collector/audio_step.py` | 24 起 | 音频技能包位置 | **已改成自动查找**（环境变量 → 仓库同级 → 仓库内 → 技能目录），一般不用动 |
| `douyin-collector/pipeline.py` | 31 | `AUDIO_ROOT = r"D:\douyin_audio"` | 想换音频输出目录就改 |
| `douyin-collector/home2table.py` | 32 | `AUDIO_ROOT = r"D:\douyin_audio"` | 同上 |
| `douyin-collector/asr_batch.py` | 31 | `DEFAULT_AUDIO` 默认音频清单路径 | 同上 |
| `douyin-collector/upgrade_collect_table.py` | 25-27 | 候选音频清单列表 | 同上 |
| 多个文件 | — | 飞书 Base token（`IjbBblKh…`） | 换成你自己的多维表 |

**飞书相关**：脚本里硬编码了作者的多维表 token（8 个文件）。
那是**资源标识不是凭证**（单靠它取不到数据，还要 lark-cli 的登录态），
但仍然属于内部信息 —— **这也是仓库必须保持私有的原因之一**。
换成自己的表：搜 `BASE_TOKEN` 改掉。

## 依赖

- Python 3.11（`playwright` / `requests` / `openpyxl` / `dashscope` / `flask`）
- **ffmpeg**（音频抽取，需在 PATH 里）
- 阿里云百炼 DashScope API Key → `douyin-collector/.env`
- 飞书多维表 + `lark-cli`
- 抖音登录态（playwright storage state，但见上面风控那节）

## 安全说明

- **无任何硬编码密钥**。曾经 `collector.py` 里有一份酷虎云 key（当时是唯一来源），
  2026-10-17 已清除，现在只从环境变量读。
- `.gitignore` 挡住了：`douyin_state.json`（真实 cookie）、`.env`、
  `*.xlsx` / `*.ndjson`（产物）、`_archive/`、`_asr_tmp/`。
- 代码里出现「`Authorization: Bearer <token>`」这类是**构造请求头的逻辑**，
  值来自运行时，仓库里没有真 token。

## 说明

`SKILL.md` 是本项目的**权威文档**，命令、字段口径、踩坑记录都在里面
（踩坑部分是最有价值的部分，含 33 条）。代码可移植，路径需按自己环境微调。

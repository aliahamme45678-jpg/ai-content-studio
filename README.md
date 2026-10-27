# AI Content Studio

个人私有内容生产基地，按 `AI_Content_Studio_PRD_v1.1` 从 P0 原型开始搭建。

## 当前结构

- `app/`：Node.js 私有工作台，原生 HTTP API + 静态前端，数据默认保存到 `app/data/studio.json`。
- `opensource/AIHOT/`：AI 情报引擎，保持独立运行，不把私有稿件写入其公开出口。
- `opensource/douyin-material-pipeline/`：抖音素材采集与转写，作为导入适配器使用。
- `opensource/Chzhinan/`：蒸馏与参考改写源码，作为本地方法资产使用。
- `opensource/dbskill/`：审核 Skill 源码；许可证为 CC BY-NC 4.0，商业使用前必须取得授权或替换为自研审核规范。

## P0 当前能力

抖音流水线现有独立可视化页面（侧栏“抖音流水线”）：素材搜索、转写全文、导入批次预检/确认、从素材创建内容、按体裁配置并保存 dbskill 组合。网页采集任务、自动转写、飞书推送和 dbskill 执行器尚未接通，页面会明确显示状态。

推荐组合：抖音数据/转写 → `dbs-content-value` 选题诊断 → 用户模板写稿 → 视频稿按需 `dbs-script-flow`、`dbs-ai-check`、`dbs-resonate`、`dbs-content-risk-check` → 人工修订 → 发布后按实际表现 `dbs-spread`。标题/封面/开头单独使用 `dbs-title-cover-intro`，X 短帖不默认调用视频类 Skill。dbskill 当前仅保存编排方案，不宣称已运行；CC BY-NC 4.0 商业授权尚未记录。

- AIHOT 情报演示适配：直接写 X、生成 3 个选题角度、收藏/取消收藏。
- 私有素材粘贴导入：预检、SHA-256 去重、确认入库和原文保存。
- 写作模板不可变版本：修改时创建新版本，历史模板记录保留。
- 内容任务：AIHOT 新闻、选题角度和手动想法共用一个任务链路。
- 审核：结构化问题、逐条忽略、局部替换和再次验证状态。
- 定稿、发布链接与时间记录、曝光/互动指标手动回填。
- 支持设置 `STUDIO_TOKEN` 保护所有 `/api/*` 私有接口；未设置时仅绑定本机回环地址。
- 已提供视频口播基础编辑：标题、目标时长、开头/钩子、分段口播稿和拍摄状态；不会把 X 短帖自动硬扩成长视频。
- Hermes 适配器已接入 Studio 创作室，但需要在“来源与连接”配置 `HERMES_API_URL`、`HERMES_API_KEY`、`HERMES_MODEL`、`MEMORY_ROOT` 和 `MATERIAL_PATH`；缺任一项时页面显示未就绪，不会保存提示词或 draft 伪装成正文。
- AIHOT 真实情报适配器：在“来源与连接”页面填写 AIHOT 地址后，可测试连接并通过只读 `/api/v1/items` 拉取精选情报；同步失败会显示错误，不会用演示数据伪装成功。

数据当前以本机 JSON 文件保存，不适合作为多用户或并发生产数据库。AIHOT 真情报服务尚未连接；当前种子情报明确只是演示数据。完成真接入需要先在本机准备 Docker/PostgreSQL，并单独配置 AIHOT 私人服务凭证。

AIHOT 本身仍需按 `opensource/AIHOT/docs/deploy.md` 启动；随后在工作台左侧“设置 → 来源与连接”填写服务地址并点“测试连接并同步”。本工作台只读取它的公开 API，不读取 AIHOT 数据库，也不会向 AIHOT 写入私有稿件。

## 本机已安装运行环境

当前 Windows 本机已使用项目目录内的便携运行时完成启动，不需要 Docker、WSL 或管理员权限：

- PostgreSQL 17.4：`127.0.0.1:5432`，数据库 `aihot`，数据位于 `app/.runtime-data/postgres`。
- AIHOT API：<http://127.0.0.1:3001>
- AIHOT 网页：<http://127.0.0.1:3000>
- AI Content Studio：<http://127.0.0.1:4310>

当前本机已接入 Gemini 兼容模型网关，模型名为网关实际提供的 `gemini-3-flash`。AIHOT 已完成真实采集和评判：本次状态为 120 篇采集、105 篇正文就绪、112 篇已公开、27 篇精选；工作台已同步 84 条公开动态。剩余 2 篇自然重试、6 个结果未知回执、3 篇 blocked。失败记录保留在 AIHOT 的回执和文章状态中，不自动无限重试。

当前开关：公开信源采集与模型调用已开启；飞书推送、内部飞书、IndexNow 和自动发布仍关闭。Worker 分析并发已降为 1，以适配 Gemini 网关并发限制。工作台同步读取 AIHOT 的公开 API，不读取 AIHOT 数据库正文。

剩余失败类型：少量文章缺少 Jina 正文服务、少量 Gemini 返回了不合规 JSON、少量请求曾触发网关并发限制。它们应通过 AIHOT 后台的原生 requeue/rerun 按组处理，不能无条件批量重跑。

其中 `receipt outcome unknown` 表示请求可能已经被模型网关计费，必须在 AIHOT 后台核对账单后再释放，工作台不会绕过 AIHOT 的回执保护自动重发。当前公开 API 已验证：全部动态 82 条、精选 14 条；工作台同步缓存 81 条。

## 启动工作台

```powershell
cd app
npm.cmd run dev
```

打开 <http://localhost:4310>。当前不需要 API Key、PostgreSQL、Docker 或外部发布权限；生成内容是本地演示数据。若端口已占用，说明工作台已经在运行，不要重复启动。

项目内置 Node 24.22.1，AIHOT 和本工作台应使用以下路径运行：

```powershell
$env:PATH = "$pwd\.runtime\node-v24.22.1-win-x64;$env:PATH"
```

## 已准备的开源依赖

- AIHOT npm 依赖已安装；使用 Node.js `24.22.1` 已通过 `npm run typecheck` 和 `npm run build -w @aihot/web`。其完整部署仍需要 Docker 和 PostgreSQL。
- 抖音流水线 Python 依赖已安装，Playwright 浏览器和真实采集登录态尚未启用。
- dbskill 已通过 Skills CLI 安装到本机 OpenClaw Skills 目录。

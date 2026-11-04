# Hermes · 爆款文案引擎

本地运行的中文短视频文案工作台，包含生成文案、话题生文、素材管理、灵魂系统和提示词管理。前端使用原生 HTML/CSS/JavaScript，后端使用 Node.js 原生 HTTP 服务，数据存储在 JSON/TXT 文件中。

本仓库是 **2026-10-27 已恢复运行版本的代码快照**。前后端代码、页面字段、当前 Prompt 内容及生成流程均保持原样；没有进行 UI 重构或业务重写。

## 已有功能

| 页面 | 现有能力 |
| --- | --- |
| 生成文案 | 输入原始文案，改写或裂变；对开头、正文、结尾分别重构；结果评价、纠错与沉淀 |
| 话题生文 | 按话题、条件、字数、文案风格、黄金三秒类型、文案类型、灵魂风格和引流参数生成口播文案 |
| 素材管理 | 添加、查看、编辑、删除素材，按行业、评级和类型管理 |
| 灵魂系统 | 人物风格与个人灵魂设置，风格提取及改写 |
| 提示词 | 查看和维护各环节的 Prompt，包括素材检索、正文生成及输出修复 |

后端还保留了原有 TikTok Shop 店铺分析及报告接口；相关功能需要独立的开放平台凭据，不是浏览文案工作台的前置条件。

## 运行环境

- Node.js **18 或以上**。本次恢复使用 v24.14.1。
- npm 随 Node.js 安装。
- 应用运行只依赖 Node.js 内置模块，不需要前端编译、数据库或另外启动前端开发服务器。
- 实际生成文案需要可用的 OpenAI-compatible Chat Completions 接口与对应模型、API Key。
- 完整的检索和改写依赖本机外部素材库及记忆文件，详见下面的路径配置。

## 启动

```powershell
git clone https://github.com/aliahamme45678-jpg/hermes-copywriting-engine.git
Set-Location hermes-copywriting-engine
Copy-Item .env.example .env
```

编辑 `.env`，填写 API 配置并检查素材、记忆路径，然后运行：

```powershell
npm start
```

浏览器打开 [http://127.0.0.1:8787/](http://127.0.0.1:8787/)。终端显示 `TK rewrite dashboard running at http://localhost:8787` 即表示服务已启动。当前没有运行依赖，因此可以直接启动；无需执行构建。

关闭该 Node.js 进程会停止网站；在启动终端按 `Ctrl+C` 即可停止。

## 必要配置

`.env.example` 只提供空密钥模板，真实 `.env` 不提交。

| 变量 | 用途 |
| --- | --- |
| `PORT` | 网站端口，默认 `8787` |
| `HERMES_API_URL` | 完整的 Chat Completions 地址，如 `https://你的服务域名/v1/chat/completions` |
| `HERMES_API_KEY` | 上述服务的 API Key；只有该服务确实不要求认证时才可为空 |
| `HERMES_MODEL` | 服务支持的准确模型 ID |
| `MEMORY_ROOT` | 本地记忆目录，直接包含 `rewrite-memory.md` 和 `prompt-patches/` |
| `MATERIAL_PATH` | UTF-8 TXT 爆款文案素材库的绝对路径 |
| `FORBIDDEN_WORDS_PATH` | 可选的本地禁用词 CSV 路径 |
| `APPROVED_MATERIAL_PATH` | 可选的已认可文案库；留空时使用 `data/approved-materials.txt` |

项目沿用 `HERMES_*` 变量命名，但可以连接 OpenAI-compatible 服务，不要求单独安装 Hermes Agent。恢复时本机使用的模型与地址记录在 `docs/RECOVERY.md`，不代表其他服务支持相同模型。

代码中还保留了原有本机备用模型端口逻辑；本仓库没有改动该逻辑。页面显示“Hermes 已接入”只表示配置了地址，不能代替实际生成测试。

### 记忆库与素材文件

原电脑使用以下路径：

```text
C:\Users\Administrator\.openclaw\workspace\lobsters\rewrite-shrimp\memory
D:\360MoveData\Users\Administrator\Desktop\爆款文案合集\爆款文案素材库_合并版.txt
```

`MEMORY_ROOT` 下需要保留以下文件：

```text
memory/
├─ rewrite-memory.md
└─ prompt-patches/
   ├─ core-prompt.md
   ├─ patches.md
   ├─ user-corrections.md
   ├─ self-corrections.md
   └─ memory-write-format.md
```

这些外部记忆文件和 TXT 素材库没有随代码上传。换电脑时需要自行复制已有文件，并把 `.env` 中的绝对路径改为新位置。仅克隆代码可以启动页面，但不能凭空恢复原素材、历史数据或完整生成上下文。

### 可选接口

DeepSeek 报告相关变量为 `DEEPSEEK_API_URL`、`DEEPSEEK_API_KEY`、`DEEPSEEK_REPORT_MODEL`、`DEEPSEEK_THINKING`、`DEEPSEEK_REASONING_EFFORT`、`DEEPSEEK_REPORT_TIMEOUT_MS`、`DEEPSEEK_REPORT_MAX_TOKENS`。

TikTok Shop 接口使用 `TTS_APP_KEY`、`TTS_APP_SECRET`、`TTS_ACCESS_TOKEN`、`TTS_REFRESH_TOKEN`、`TTS_AUTH_CODE`、`TTS_SHOP_CIPHER` 等变量。外部研究接口使用 `TTS_RESEARCH_API_URL`、`TTS_RESEARCH_API_KEY`、`TTS_RESEARCH_MODEL` 和 `TTS_RESEARCH_TOOLS_JSON`。不使用这些接口时可留空。

## 文件结构

```text
server.js                 Node.js HTTP 服务、接口与原有生成逻辑
public/
  index.html              页面结构及业务字段
  app.js                  页面交互及 API 调用
  soul-system.js          灵魂系统交互与风格设置
  styles.css              原有样式
  fonts/                  页面实际使用的三份字体
  personas/               原有人物图片
  logo.jpg                原有标识
data/
  prompts.json            当前完整 Prompt 配置（原样保留）
  system-prompt.txt        原有兼容 Prompt
docs/
  RECOVERY.md             恢复过程、验证结果与边界
  source-manifest.json    原文件来源、体积及 SHA-256 校验清单
.env.example              不含真实密钥的配置模板
.gitignore                凭据、运行记录及本地数据排除规则
```

首次启动会按原有逻辑在 `data/` 自动创建所需 JSON/TXT 运行文件。新的历史、评级、报告、额度、已认可素材等保存在本地，不默认提交 Git。

`data/prompts.json` 与 `data/system-prompt.txt` 是当前生成行为的配置，已经纳入版本管理。修改提示词页面可能改变这些文件，提交前应自行检查差异。

## 检查与排错

语法检查：

```powershell
npm run check
```

启动后可读取配置接口：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/config
```

| 情况 | 检查方法 |
| --- | --- |
| `EADDRINUSE` | 端口已被占用；确认旧服务是否仍在运行，或修改 `.env` 的 `PORT` |
| 页面可打开但无法生成 | 检查模型接口、Key、模型 ID、网络，以及服务商返回的错误 |
| 找不到记忆或素材 | 检查 `.env` 中路径是否存在、文件编码及读取权限 |
| 素材为空或与原电脑不同 | 仓库没有附带原始素材和历史；复制已有外部素材，并核对 `MATERIAL_PATH` |
| 修改配置后无变化 | 停止旧进程并重新执行 `npm start` |

## 上传范围与验证边界

保留了运行所需的前后端、字体、图片和当前 Prompt。排除了 `.env`、访问令牌、用户生成历史、原始素材库、外部记忆、日志、截图、`node_modules`、字体源文件压缩包，以及混放在原目录中的其他项目和浏览器自动化工具。导出包的 `package.json` 只保留应用启动与语法检查，不包含那些无关工具的脚本或开发依赖。

原项目目录未被改写；完整业务文件可以通过 `docs/source-manifest.json` 与原文件逐一核对。

恢复时验证了首页、静态资源、配置、素材、提示词和历史读取接口，以及三个主要页面切换。原电脑读取到 302 条素材、89 条生成历史；这些运行数据不随仓库发布。没有提交新的模型生成请求，因此不承诺外部模型当前可用或输出质量。

本应用保持原有本地工具形态。私人 GitHub 仓库不会让运行中的 HTTP 服务自动获得登录认证；如需远程部署，应另行设计访问控制。


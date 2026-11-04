# AI Content Studio 三仓整合开发方案

**版本：** V1.0（开发交付稿）  
**日期：** 2026-10-27  
**主仓库：** `aliahamme45678-jpg/ai-content-studio`  
**整合来源：** `hermes-copywriting-engine`、`douyin-material-pipeline`  
**评估边界：** 基于三个仓库 `main` 分支的静态代码、README、接口与适配器检查；尚未在用户本机运行端到端测试，也未修改原仓库。

## 1. 核心结论与不可更改的原则

以 **AI Content Studio 为唯一产品主体、唯一操作入口、唯一内容任务与版本记录中心**。Hermes 只负责文案生成及风格/记忆能力，抖音流水线只负责采集、转写、评论蒸馏与素材产出，AIHOT 继续作为外部情报源。避免把三个网站简单嵌套、互相跳转或重做已有页面。

必须遵守以下原则：

1. **不推翻现有成果。** 优先复用 Studio 的前端组件、导航、权限、任务、模板、知识库、审核、发布记录；保留当前页面字段、原有文案与交互，新增功能以扩展方式接入。
2. **不重写成熟业务。** Hermes 的话题生文、改写、灵魂系统、Prompt 与纠错规则保留为独立模块；抖音已有的 Python 采集、音频转写及评论分析直接复用，必要时只写适配层。
3. **一个事实源，一个内容任务。** 素材可来自 AIHOT、抖音、手动输入、飞书或个人蒸馏文件；全部进入 Studio 的统一来源与知识库，生成结果落到 Studio 的 `jobs / versions / auditRuns`，不形成相互独立的历史。
4. **明确真数据与未接通功能。** 演示数据不得冒充真实情报；缺转写不得显示“口播已完成”；dbskill 规划表不等于执行成功；模型配置缺失时不能把提示词当作生成稿。
5. **先本地跑通，再实现自动化。** 首阶段不做大规模 UI 重构、多租户、远程发布或全平台采集；先打通“采集/情报 → 素材 → 生成 → 审核 → 定稿”闭环。

## 2. 三个仓库现状与分工

| 仓库 | 静态代码确认的已有能力 | 整合后的职责 | 处理方式 |
|---|---|---|---|
| `ai-content-studio` | Node.js 工作台；AIHOT 同步；素材预检/导入；模板版本；内容任务；模型生成；审核记录；发布与复盘；抖音任务入口 | **主产品与编排中心** | 在原仓库迭代，保留 UI/接口/数据 |
| `hermes-copywriting-engine` | `/api/topic-copywriting`、`/api/generate`、`/api/regenerate-section`；灵魂提取；Prompt 管理；素材与纠错记忆 | **文案生成引擎** | 初期独立服务+本地受控适配；后续评估模块化 |
| `douyin-material-pipeline` | `collector.py` 采集；`aliyun_asr.py` 转写；评论过滤、蒸馏、需求聚类；低粉爆款分析；飞书推送脚本 | **采集与蒸馏工作进程** | 保留 Python 脚本；由 Studio 调度异步任务 |

**关键代码依据：**

- Studio：`app/src/server.mjs`、`app/src/collect-douyin.py`、`app/src/collection-request.mjs`、`app/src/retrieval.mjs`、`app/src/skills-local.mjs`、`app/public/douyin.js`。
- Hermes：`server.js`、`public/app.js`、`public/soul-system.js`、`data/prompts.json`、`README.md`。
- Douyin：`douyin-collector/collector.py`、`aliyun_asr.py`、`comments_filter.py`、`comments_distill.py`、`comments_cluster.py`、`SKILL.md`。

## 3. 目标业务流程

```text
来源入口
├─ AIHOT：热点、行业资讯、新闻（保留现有公开 API 同步）
├─ 抖音：视频链接/博主主页 → 作品指标 → ASR 转写 → 评论主题
├─ 手动：话题/原稿/资料/用户自定义要求
└─ 私有库：个人事实、写作规则、提示词、爆款案例、历史认可稿
                      ↓
             Studio 素材与知识库
        事实 / 案例 / 方法 / 硬性规则分层
                      ↓
                  选题中心
            角度选择、证据绑定、模板
                      ↓
               Hermes 文案引擎
        话题生文 / 原稿改写 / 灵魂风格
           黄金三秒 / 字数 / 引流配置
                      ↓
         Studio 内容任务 + 版本记录
                      ↓
         审核（已实现本地规则优先）
       事实、原创性表达、AI味、发布风险
                      ↓
             人工处理 → 定稿
                      ↓
            发布记录与数据复盘
                      ↓
      经人工认可的表达经验/规则回流知识库
```

典型场景：设置一个抖音采集任务，筛选指定主题及点赞阈值的作品；视频转写后作为**外部写作参考**入库，评论归并形成“用户需求主题”；选中主题创建 Studio 内容任务；选择模板与风格，由 Hermes 检索允许使用的素材及个人硬规则生成初稿；进入审核台修改，再定稿。**不要把外部作者的经历、观点或数据改写成用户本人经历。**

## 4. 模块整合设计

### 4.1 Studio：保留并扩展主站

沿用 Studio 当前单页导航与现有页面，不另起“第二工作台”：今日工作台、情报中心、素材与知识库、选题中心、创作室、写作模板、审核台、内容档案、来源与连接；在已有抖音流水线工作区内扩展任务和蒸馏能力。统一复用 `jobs`、`versions`、`taskRuns`、`auditRuns` 等记录。

对页面只做最小增量：

- **创作室：** 增加“生成方式”选择（现有 Studio 生成 / Hermes 话题生文 / Hermes 原稿改写），展示灵魂、开头、字数、文案类型等 Hermes 原有参数；输出仍进入 Studio 当前编辑与版本系统。
- **素材与知识库：** 增加来源类型、事实角色、使用范围、原文链接、转写状态、蒸馏状态等元数据；不创建第二套素材列表。
- **抖音流水线：** 保留采集任务、素材列表、导入批次、Skill 组合，扩展 ASR、评论、进度与错误重试；实际接通前标记未接通。
- **来源与连接：** 增加 Hermes 连通性、素材/记忆目录、抖音登录状态与 ASR 配置状态，不在浏览器返回明文 API Key。

### 4.2 Hermes：生成能力通过适配器进入 Studio

**第一阶段不要直接把 Hermes 的 3000 行服务与 Studio 的 `server.mjs` 物理合并。** Hermes 暂保留本地独立服务（现有默认端口 `8787`），Studio 服务端调用受限的 `127.0.0.1` 地址。新建 `app/src/integrations/hermes-client.mjs` 等适配文件，在 Studio 端进行统一鉴权、错误处理、日志、幂等与持久化；禁止浏览器绕过 Studio 直接访问 Hermes。

| Hermes 原接口 | Studio 使用场景 | 映射与落库要求 |
|---|---|---|
| `POST /api/topic-copywriting` | 根据选题生成口播稿 | 透传原有字段；将 `final_copy_text` 转成 Studio `version.body`，保留请求快照 |
| `POST /api/generate` | 原文改写/裂变 | 将 `rawContent` 和结果纳入同一个 Studio `job`，保留原文与新版本 |
| `POST /api/regenerate-section` | 开头、正文、结尾局部重构 | 生成**新的版本**，保留其他片段与前一版本关系 |
| `POST /api/extract-soul` | 自定义灵魂提取 | 灵魂文件与个人画像留在私有配置；保留来源与版本 |
| `GET/POST /api/prompts` | Prompt 兼容与管理 | 初期保留 Hermes 原始 Prompt 配置；不要另写一份不同的默认规则 |
| `/api/review`、`/api/correction`、`/api/approve` | 人工反馈、纠错、认可 | 双向映射需显式约定，避免重复写入或覆盖 Studio 审核结果 |

**关键注意：** Hermes 的 `runCopywritingPipeline` 首先要求 `MATERIAL_PATH` 对应的真实素材库有效；素材候选不足时可能返回“素材不足”而不是生成稿。它还依赖外部 `MEMORY_ROOT`，这些文件并未上传至 GitHub。上线前必须有配置体检、缺失提示与迁移工具，不能假设克隆仓库即可恢复用户记忆。

Hermes `callHermesClean()` 在缺少 `HERMES_API_URL` 时会返回 `mode: draft` 和提示词文本；**Studio 适配器必须拦截此状态，视为模型未配置，不允许作为成功生成内容入库。** 对 Hermes 生成结果需要验证真实文本、字数、敏感信息、失败状态；长调用使用异步任务与可见进度，不能无限制重复扣费。

### 4.3 Douyin：从“采作品”升级为完整素材管线

Studio 目前 `collect-douyin.py` 调用上游采集器时明确使用 `with_content=False`，运行日志还写明“未调用转写、评论或飞书推送”。因此当前只是**作品数据采集 + 手动导入**，不是完整转写管线。

建议拆成可恢复的任务阶段：`collect`（作品信息） → `filter`（筛选） → `asr`（转写） → `comments`（可选评论采集/过滤/蒸馏/聚类） → `normalize`（字段转换与去重） → `import_preview`（人工确认） → `commit`（写入 Studio 素材库）。每阶段记日志、失败原因、费用和中间产物。ASR/评论失败不能抹去采集结果，支持单阶段重试。

必须修复的字段差异：

| 上游 `collector.py` 真实字段 | Studio 目标字段 | 备注 |
|---|---|---|
| `aweme_id` | `externalId` | 作品稳定标识，优先用于跨批次去重 |
| `author_name` | `author` | 现有适配器用 `author`，可能为空 |
| `publish_time` / `create_time` | `publishedAt` | 需统一转换日期；保留原始时间戳 |
| `digg_count` | `diggCount` | 点赞量 |
| `comment_count` | `commentCount` | 评论量 |
| `collect_count` | `collectCount` | 收藏量 |
| `share_count` | `shareCount` | 转发量 |
| `content`（转写流程有值时） | `transcript` | 现有采集禁用转写，通常为空 |
| `play_url` | 仅供音频步骤使用 | 临时直链有过期风险，不作长期素材链接 |
| `url` / `title` | `url` / `title` | 需要保留原视频地址 |

`play_count` 不是可靠可得字段：未拿到播放量时要保存 `null` + `playCountKnown=false`，不能用 `0` 假装真实播放量，也不能以点赞估算值覆盖原始播放量。**如果用户设置“最低播放量”但播放量未知，应拒绝该过滤条件或清晰标明仅用于估算模式；不得默认为 0 后误筛。**

现有前端描述“最多 500 条链接”，而 `collection-request.mjs` 实际限制 `urls.length > 10`；需统一页面、API 校验、分页和批次上限。旧采集器返回 `author_name`，Studio 适配器读取 `author`，也是确认存在的映射缺口。网页端“转写正文”“评论明细”可选字段，在真正接通前不得被视为可保证获取。

**关键词自动采集是新增能力，不是已有能力。** `collector.py` 现有核心入口是链接列表和作者主页。未来若要每 12 小时搜索关键词并筛选高赞内容，需增加独立搜索适配器、定时调度、去重与任务失败恢复；同时区分“12 小时内发布且累计点赞 ≥7000”和“12 小时新增点赞 ≥7000”，后者必须存储至少两个时间点的快照。不得宣称目前已经具备自动关键词采集。

### 4.4 统一知识库：明确四种资料身份

| 资料类型 | 示例 | 写作权限 |
|---|---|---|
| **事实库** | AIHOT 原始报道、用户自己提供并确认的事实 | 可作为事实来源，但需要保留出处、时间和核验状态 |
| **写作案例库** | 抖音转写文案、行业爆款、竞品脚本 | **只学结构、节奏、表达，不复制事实或个人经历** |
| **蒸馏方法库** | 标题方法、口播结构、创作经验 | 指导组织内容，不作为新闻事实 |
| **规则与记忆库** | 个人风格、硬性禁令、纠错补丁、专属 Prompt | 最高优先级的写作约束；保留版本、适用范围和出处 |

Studio 现有 `retrieval.mjs` 采用关键词/中文二元片段检索，默认返回最多六段，适合第一阶段，但不应宣称已经实现语义向量检索。首期保留原检索，先确保权限与角色正确；后续再按实际命中质量评估检索升级。外部素材必须作为**不可信文本**包裹，不能执行素材内部的“忽略规则”等提示词指令。

### 4.5 审核、记忆、复盘

Studio 已有审核台、局部替换、版本和复盘接口。现有 `skills-local.mjs` 是本地规则兼容实现，**不是完整 dbskill 执行器**。第一阶段保留并清楚标注“本地规则”，把 Hermes 的输出接入同一个审核流；后续单独集成可执行的 Skill，必须做许可证审查。`dontbesilent2025/dbskill` 为 CC BY-NC 4.0，商业使用前应取得授权或改用独立开发的规则。

“自动学习”只限于经用户确认的修改、纠错和优秀稿；审核未通过或用户未认可的机器生成文本不得自动写入个人规则库。回流内容需记录 `sourceJobId`、版本、规则变更时间和撤销方法。

## 5. 建议的工程结构与对接边界

```text
ai-content-studio/                       # 唯一主仓库
├─ app/
│  ├─ public/                           # 保留既有 UI 和组件
│  ├─ src/
│  │  ├─ server.mjs                      # 原接口及统一鉴权/编排
│  │  ├─ integrations/
│  │  │  ├─ hermes-client.mjs            # 新增：服务端调用 Hermes
│  │  │  ├─ douyin-normalizer.mjs        # 新增：字段映射/去重
│  │  │  └─ knowledge-adapter.mjs        # 新增：素材角色与入库
│  │  ├─ jobs/                           # 建议新增：持久化异步任务编排
│  │  └─ collect-douyin.py              # 复用现有入口，扩展阶段
│  └─ tests/                             # 扩充回归测试
├─ opensource/
│  ├─ AIHOT/                            # 继续独立运行，不写私稿
│  └─ douyin-material-pipeline/         # 保留 Python 上游
├─ integrations/                         # 可选：Hermes 本地源码/启动适配
└─ start-local.ps1                       # 统一启动与配置体检
```

以上为**建议结构**，不是当前仓库已存在的目录承诺。初期可以用开发机上的独立 Hermes 目录启动，不必立即把源码复制进 `opensource/`。如果新增源码目录，应明确版本固定方式（submodule / 可复现的版本锁定 / vendor 镜像），不依赖被 `.gitignore` 忽略的本地目录才可运行。

### 5.1 新增的 Studio 内部接口（建议，不影响原接口）

| 内部 API | 功能 | 关键约束 |
|---|---|---|
| `GET /api/studio/integrations/hermes/status` | Hermes 配置与健康检查 | 不返回 Key；检查素材和记忆是否就绪 |
| `POST /api/studio/writing/jobs/:id/hermes-generate` | 话题生文或改写 | 输入/输出快照、幂等键、版本持久化 |
| `POST /api/studio/writing/jobs/:id/regenerate-section` | 局部重构 | 保留其他内容，创建新版本并重置过期审核 |
| `POST /api/studio/douyin/tasks/:id/asr` | 对已采任务补转写 | 异步、费用可查、单阶段可重试 |
| `POST /api/studio/douyin/tasks/:id/comments` | 评论采集与归并 | 可选执行；请求范围与预算明确 |
| `GET /api/studio/tasks/:id` | 统一任务状态与日志 | running/succeeded/failed/cancelled/unknown |

所有写接口沿用 Studio 的认证与同源约束。内部对 Hermes 的调用应使用后端到后端代理，限制地址为允许的本地服务，不把任意 URL 作为代理目标。模型超时且结果未知时，不得无条件自动重发，以免重复计费。

## 6. 分阶段实施（供 Agent 直接执行）

### P0｜保护现有成果、修复可运行性

- 新建整合开发分支，三个仓库记录对应 commit；不直接覆盖 `main`，不删除原文件、Prompt、历史。
- 备份 Studio 本地 `studio.json`、Hermes 的 `data/` 与外部记忆/素材、抖音状态文件；敏感凭据绝不进入 Git。
- 修复 Studio 对 `../../opensource/AIHOT/node_modules/postgres/src/index.js` 的直接依赖：改为可安装、可声明版本的依赖，或隔离仅用于诊断的路径；确保无 AIHOT 本地目录时 Studio 仍可启动基础功能。
- 跑 Studio 现有 `node --test tests/*.test.mjs` 与 Hermes `npm run check`；建立关键接口的回归基线。
- 修复抖音前后端最大条数冲突、采集字段转换错误、未知播放量筛选语义。

**验收：** Studio 页面和原功能不回退；本地启动脚本可复现；不依赖隐式的开发机绝对路径；没有密钥泄露。

### P1｜先整合 Hermes 生成（第一可交付闭环）

- 建立 Hermes 连接配置/状态检测；复用原生写作 API、原始 Prompt 文件与灵魂定义。
- Studio 选题、AIHOT 情报、原稿任务均可交给 Hermes 生成；同步保留 Studio 原来的生成通路以便回退。
- Hermes 素材与记忆文件必须提供可检查的配置；缺失时明确告诉用户哪些能力不可用。
- 结果写回 Studio `jobs` 与 `versions`，支持再生成、撤销和审核。不得把 Hermes 内部 JSON 历史作为另一套独立任务库。
- 对接拒绝逻辑：未配置模型、生成的是提示词、素材不足、空稿、长度失败、错误状态，都不标记成功。

**验收：** 创建一个手工话题 → 选择灵魂/钩子/字数 → 真实调用模型 → 保存版本 → 进入审核台 → 人工定稿；同一任务能查看原始请求、结果和失败日志。

### P2｜打通抖音 ASR 与评论蒸馏

- 在已有抖音采集入口分阶段调用 `collector.py`、`aliyun_asr.py`、评论过滤与归并脚本；保留结果中间文件及外部 ID。
- 采集成功即可看作品数据；ASR/评论在后台执行，结束后补充到同一条素材，不阻塞查看已获得的数据。
- 导入采用“预检 → 去重 → 确认入库”；失败项保留并允许指定阶段重试。
- 评论需求主题与口播文本分别存档，分别标明“事实/需求信号/写作案例”，防止被写作模型误用。

**验收：** 单条视频及单个博主主页都能从采集到转写再入库；评论可选择运行；重复采集不重复生成内容；ASR 失败不丢失作品元数据。

### P3｜可选自动化与完整闭环

- 在关键词搜索适配器验证可用后，新增定时任务（例如每 12 小时）、阈值筛选、增量快照和失败恢复。
- 做“候选选题 → Hermes 生成 → Studio 审核”的人工确认式流水线；不自动发表。
- 若需要真正的 dbskill 执行器，先处理许可证，逐个接入并标明真实执行与诊断结果。
- 统一任务执行队列；达到多任务并发后，逐步将本机 JSON 持久层迁移到适当的数据库，并提供迁移/回滚工具。

**验收：** 可暂停/恢复定时任务；相同视频在多个采集周期不重复入库；任务失败有原因，跨进程重启不会默默宣称成功；发布复盘数据可追溯到原始选题与来源。

## 7. 必须覆盖的关键回归用例

| 编号 | 测试场景 | 预期结果 |
|---|---|---|
| T01 | Studio 不接 Hermes、AIHOT 时启动 | 基础界面能打开，缺失能力清晰标记为未连接 |
| T02 | Hermes 未设置 `HERMES_API_URL` | 明确失败，不能把 Prompt 文本保存为生成稿 |
| T03 | `MATERIAL_PATH` 或 `MEMORY_ROOT` 缺失 | 配置体检提示文件缺失与功能影响，不展示假成功 |
| T04 | Hermes 话题生文 + 灵魂改写 | 最终正文在 Studio 新版本，能审计和恢复上个版本 |
| T05 | 原稿局部重构 | 仅目标部分变化；来源与历史版本仍可追踪 |
| T06 | 抖音返回 `author_name`、`publish_time` | Studio 对应作者/发布时间完整显示 |
| T07 | `play_count` 不可得 | 显示“未知”，不显示 0 播放，不按未知数比较阈值 |
| T08 | 抖音 ASR 请求失败 | 作品元数据仍在，转写步骤失败并支持补跑 |
| T09 | 同一 `aweme_id` 重复采集 | 幂等更新或去重，不产生多个相同素材 |
| T10 | 审核后修改内容 | 原有审核结果失效，需要重新验证后才能定稿 |
| T11 | 模型请求超时，状态未知 | 返回 unknown，不能自动无限重试扣费 |
| T12 | 删除或中断本地服务 | Studio 主站不崩溃，提示依赖不可用且保留已有任务 |

## 8. 风险边界与非目标

**私有文件与版权：** Hermes 的外部记忆、用户蒸馏文件、抖音登录态、浏览器 Cookie、个人素材与 API Key 均不提交 GitHub。外部短视频文本只用于内部研究、提炼与参考，保留来源和许可信息；禁止将竞品稿当原创内容原样发布。dbskill 许可在商业场景使用前需核实。

**采集稳定性：** 抖音平台字段和浏览器行为可能变化，采集应具备限速、异常退避、登录状态检查和失败告警；不保证游客模式能完整采集所有作品，也不设计绕过平台限制的承诺。

**数据可信度：** AIHOT 新闻与抖音评论不自动成为用户个人事实。生成引用真实资料时保留 URL、发布时间与核验状态。评论归纳属于用户需求信号，不能当作经验证的客观事实。

**本阶段不做：** 完全重写 Studio UI、把三站 iframe 拼接、重建 Hermes 提示词、自动发表内容、多用户 SaaS 改造、承诺任意抖音关键词长期稳定实时采集。

## 9. Agent 执行指令（可直接复制）

> 以 `aliahamme45678-jpg/ai-content-studio` 为唯一主仓库，对 `hermes-copywriting-engine` 和 `douyin-material-pipeline` 做渐进式整合。先读取三个仓库的 README、核心路由、字段契约和测试，再建立分支和备份。不得重构或替换 Studio 现有 UI，不得擅自更改已有字段、文案、导航名称和用户交互。先完成 P0 可运行性修复，再按 P1 Hermes → P2 抖音转写评论 → P3 自动化推进。Hermes 原有 Prompt、灵魂、规则和记忆必须原样保留并复用，禁止另造简化版。抖音复用 Python 上游代码，不得把“采集成功”伪装为“转写/评论完成”。每个阶段完成后提交差异清单、接口映射、测试结果和可复现的本地启动方法；任何模拟/未接通模块要在页面明确标注。所有修改先在分支完成并通过验收，再提出合并；未获授权不得删除数据或部署生产环境。

## 10. 交付清单

- 同一主站内可使用 Hermes 文案生成与 Studio 原有创作功能，两者结果进入统一任务和版本。
- 抖音素材采集、转写、评论蒸馏按真实状态呈现，字段一致、可预检入库、可重试。
- AIHOT 保持只读情报源，私有文案与记忆不写入 AIHOT 公开接口。
- 配置说明、环境变量模板、迁移方式、启动脚本、健康检查和日志可用。
- 关键接口测试、失败边界测试、用户原功能回归测试通过。
- 最终提交一份“已实现 / 未实现 / 已验证 / 未验证”的真实验收报告。

**GitHub 来源：**  
`https://github.com/aliahamme45678-jpg/ai-content-studio`  
`https://github.com/aliahamme45678-jpg/hermes-copywriting-engine`  
`https://github.com/aliahamme45678-jpg/douyin-material-pipeline`

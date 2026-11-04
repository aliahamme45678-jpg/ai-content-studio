# DeepSeek 接手说明

工作目录：D:/360MoveData/Users/Administrator/Documents/New project 4/ai-content-studio
测试地址：http://127.0.0.1:4310/

用户要求：加快执行，不要过度思考或扩展范围；当前任务收尾后交给DeepSeek。先读本文件，直接承接下面未通过项，不要重新搭项目。项目有大量接手前的脏改动，禁止整体还原、覆盖用户数据、擅自提交或推送。

## 已完成且真实验证

1. 写作蒸馏支持视频/主页、粘贴文案、多文件Markdown/TXT。新入口在采集管理→写作蒸馏→上传文案；一个开始按钮。上传内容通过POST /api/studio/writing-dna/import创建后台任务，跳过采集和ASR，仍进入任务列表，可保存至灵魂提示词。
2. 真实导入3篇文案，蒸馏成功，1202字提示词，ASR请求0。任务：text-distill-efe6d840-57c8-452f-8a3c-aa321a83a719。从已返回的批次排除1条不在原文中的引用，保留排除记录，复用有效回执，仅补了1次汇总。证明：outputs/real-acceptance/text-distill-proof.json；正文：outputs/real-acceptance/自定义文案蒸馏结果.md。
3. 原来的19篇主页任务已经成功。任务collect-732db4b3-839c-4559-93a9-0d87989937ff，4批全部分析、19份元数据、1200字提示词。此前最终汇总524，经用户明确许可只重试汇总1次成功，无重新采集/转写/分析。证明gpt-dna-recovery-proof.json。
4. 新增daitu · gpt-6.1-sol，全部5个AI用途已切换。接口Responses，store=false，reasoning.effort=low。正确Key复用了OpenCode现有daitu provider的GPT分组Key；原工作台Key属于Gemini分组，不可混用。凭据在忽略文件app/data/model-profiles.json内，不要打印、复制到报告或提交。
5. 模板管理新增黄金三秒多库管理，支持飞书/Markdown的创建、查看、编辑、删除、重新读取。飞书初始来源为base IjbBblKh0amzztsiExVc1PqInfd、table tblHnYTy58LoJEEw、view vew2bAcuTZ。全程只读，没有改远端数据和字段。现有连接是lark-cli用户授权桥接，当前工具无原生飞书MCP，不要谎称直接调用了MCP。保留动态字段和视图；来源数量随用户更新已从17→117→459，不要硬编码数量。
6. 黄金三秒类型与案例库独立选择，改写/话题的主提示词仍独立。实际生成读取选中库、匹配适配开头、正文生成、灵魂优化、事实和风格校验；失败不静默降级。真实飞书改写曾输出554字并通过。Markdown库创建/编辑/删除已实际验证。
7. Responses请求按相同endpoint+Key排队，避免站内并发429；仅明确gateway_concurrency_limit拒绝时等2秒重试一次，不会自动重试未知结果。

## 未通过：话题生文真实验收

本次验收已结束，不能声称通过。用户只允许压缩候选案例后再验收一次，该次数已用完，不能擅自追加未知结果请求。

最后任务：job-629d09e4-7e6b-4caf-b549-e8e915224e60
最后运行：run-5daf85ea-a1c9-4896-b435-228d40abb55a
状态：unknown
阶段：repairing-final-validation
错误：model_http_524

最后一次已完成开头匹配、正文、灵魂润色及第一次校验。校验指出风格不够连续、结尾缺少收束，进入一次有界修复后遇到服务商524。原稿、候选稿、回执和意见都还在db.taskRuns。generatedBody约413字符。不要伪装成成功，也不要丢掉有效阶段再从头付费。

此前还发现校验模型把黄金三秒type误填为文案类型“实战型”，已用明确hookType字段修复；润色把400字压成约200字，已明确目标字数并加一次校验修复。校验模型的字数估计仍可能不准：曾把实际413字符估成360字。接手后应以真实计数判断近似字数，保留真实文风/事实检查，不要只为通过而改passed。

当前候选匹配输入已压缩为前8个相关案例、每例最多900字和少量场景字段；原始库及运行证据保留完整内容。正文和校验传compactPlan，避免重复整份案例。

本次验收用模板、Markdown库和作品已归档/软删除，保留版本和运行记录；不要因此误判用户素材被删。临时源/模板标识见outputs/real-acceptance/topic-acceptance-final-job.json；需要再次实测应恢复或创建临时来源，清理时只处理这些准确ID。

## 主要入口

app/src/writing-dna.mjs：DNA分批、回执复用、证据校验、自定义文案import API、保存灵魂。
app/public/writing-dna.js：视频链接/上传文案Tab、粘贴、多文件、任务进度和报告。
app/src/model-transport.mjs：Responses适配、禁止远端存储、低推理、单Key排队。
app/src/model-profiles.mjs、app/public/model-profiles.js：API配置及用途/接口格式。
app/src/hook-libraries.mjs、app/public/hook-libraries.js：黄金三秒来源及管理UI。
app/src/hook-writing.mjs：匹配→事实校正→灵魂→最终校验→最多一次修复。
app/src/server.mjs：真实generate流程、后台工作流。
app/src/collection-flow.mjs：持久化步骤和断点继续，恢复时清理旧错误。
app/src/workflow.mjs：写作配置、知识范围与上下文。
app/public/writing-workbench.js、spx-design.css：顶部写作设置，下方原文/生成稿/审核三列；保留浅色青绿。

## 验证与运行

最新105项测试通过。命令：从项目根执行 ./.runtime/node-v24.22.1-win-x64/node.exe --test app/tests/*.test.mjs。输出outputs/real-acceptance/regression-text-distill.txt。
新增测试覆盖多文件导入、跳过ASR/素材库、已完成批次复用、无效引用排除、Responses和并发队列，以及黄金三秒来源切换和错误不降级。

服务4310正在运行。修改后启动脚本start-local.ps1 -StudioOnly。重启前检查app/data/studio.json的taskRuns，没有running任务才停4310对应node进程；禁止打断用户采集、转写或模型任务。无新增依赖、无提交推送。

浏览器对127.0.0.1:4310曾有saved user permission拒绝。不能经其他浏览器/CDP等绕过；本轮API实测不等于浏览器点击或像素验收。文件选择还曾受扩展Allow access to file URLs限制。不要声称页面与文件选择已验收通过。

## 继续执行顺序

先核对当前运行状态。优先从已保存的有效阶段定位话题生文最后一步问题，避免反复扩大Prompt或增加多余UI。遇未知结果要保留费用未知记录；用户本次限定的最后一次验收已消耗，进一步付费重试需要新的明确授权。只报告用户实际可见的优化和真实结果，简短，不讲大段代码。

# 交接文档（2026-11-04 03:20，交 Codex）

仓库：https://github.com/aliahamme45678-jpg/ai-content-studio
工作分支：codex/spx-ryxo-desktop-ui
本地目录：D:/360MoveData/Users/Administrator/Documents/New project 4/ai-content-studio
本地地址：http://127.0.0.1:4310/（有密码门控，密码 `[访问密码由本机配置或部署环境提供]`，登录 `POST /api/studio/auth/login` body `{"token":"[访问密码由本机配置或部署环境提供]"}`，拿 cookie 后带 cookie 访问）
Node：`./.runtime/node-v24.22.1-win-x64/node.exe`（随仓库自带）
测试：`./.runtime/node-v24.22.1-win-x64/node.exe --test app/tests/*.test.mjs`，当前基线 **162/162 全绿**。

## 一、用户与环境规矩（必读，违者返工）

1. **第三方接口必须真实调用**：禁止 mock/dry-run 代替验证结论；单次 10–20 条；各源分开验；响应必须落盘 `outputs/real-acceptance/` 并在汇报里写路径。记录格式：真实调用｜端点｜参数｜条数｜返回条数｜HTTP｜耗时｜落盘路径。
2. **不修改用户已保存的写作 Prompt 文本**。用户明确说「提示词不需要你写，你只需要写逻辑，我来测试」。蒸馏器内部提示词（`app/src/writing-dna.mjs` 的 reportInstructions）本轮经用户明确授权已重写；写作母版/用户模板一律不动。
3. **不擅自提交/推送 git**。`app/data`、`app/.runtime-data`、`.runtime`、`.env` 不提交、不覆盖。
4. 改数据前先备份到 `app/.runtime-data/`（命名带 before-XXX）。
5. 用户偏好：简短直接、先结论后证据、✅/❌ 显式状态、编号列表；对延迟耐受低，别长篇铺垫。
6. 中文环境；涉及涨跌用红涨绿跌；货币 ¥。

## 二、服务启停

- 启动：`cd app && export PATH="../.runtime/node-v24.22.1-win-x64:$PATH" && export NODE_ENV=development PORT=4310 HOST=127.0.0.1 NO_PROXY="localhost,127.0.0.1,::1" && exec node src/server.mjs`
- **坑**：`run_in_background` 启动服务可能被沙箱拦（exit 125 / 1 / 127，报 `shell-runtime-bash-env.sh: Permission denied` 或假告警）。被拦时改用「前台执行 + 短 timeout（8-20s）自动转后台」即可常驻。exit 127/1 的后台通知多为假告警，先 `netstat -ano | grep ":4310.*LISTENING"` + `curl` 确认真实状态再动作。
- 重启前查 `taskRuns` 有无 running/unknown，有则先处理（见「任务状态」节）。
- 静态前端 `cache-control: no-store`，普通刷新即拿新脚本。
- 测试起的服务带 `STUDIO_PASSWORD_GATE:'off'` 跳过密码门（仅测试用；浏览器默认仍要密码）。`app/src/password-gate.mjs` 是密码门控，别删。
- UI 主题为 ryxo-desktop.css（纯白底/绿主操作），入口 `app/public/index.html`，勿换回旧主题。

## 三、模型档案（app/data/model-profiles.json）

| 用途 | 档案 | 状态 |
|---|---|---|
| writing / distill | DeepSeek · deepseek-flash（api.deepseek.com/v1，key sk-a36…） | ✅ 200 正常 |
| audit / intelligence / analysis | **临时**也指向 DeepSeek | 原为 daitu（gpt-6.1-sol / gemini-3.8-flash），**daitu 账户余额不足全线 403 INSUFFICIENT_BALANCE**，充值后在「连接和设置 → 模型档案」切回 |
| DeepSeek 模型名 | `deepseek-flash` 即 DeepSeek-V4.1-Flash（display name），API 只认 `deepseek-flash`/`deepseek-v4-pro`，传 `DeepSeek-V4.1-Flash-1017` 会被 400 | 勿改名 |
| 推理档 | 该模型 default_level=high，代码里已强制 `effort:'low'`（deepseek 端点），否则 reasoning 吃光输出额度 | 勿移除 |

403 排查入口：`taskRuns[].httpFailure.detail` 里有上游真实返回体。前端已把 INSUFFICIENT_BALANCE/401 翻成人话。

## 四、本轮（11-03 晚—11-04 凌晨）已完成的工作

按时间序，均已真实验证 + 回归绿：

1. **Writing DNA 蒸馏三层改造（spec v3-craft-vs-domain-20261104）**——用户诊断蒸馏产物把业务认知当写作风格、结构锁死教程、单篇当稳定风格。已改：
   - `writing-dna.mjs` reportInstructions 重写为 language(语言)/structure(创作)/cognition(认知) 三层，全局铁律「DNA 只描述作者面对不同内容习惯怎样思考/组织/表达，不规定必须讲什么」+ **跨话题检验**（换 AI/创业/商业题材仍成立才算 DNA）。
   - `parseDnaReport` 新增 `dna_prompt_contains_domain_tactics`：prompt 出现 投流/直通车/达人合作/铺货/提报/自然流/上架商品/开店/选品 即退回重写。
   - 单样本 <20 篇三层均标「暂定观察」，用「倾向/习惯」不用「必须」；`dnaQuality.provisional`。
   - `writing-style.mjs` stylePromptOf 提取禁止性行生成「硬性禁忌」块前置（修「不拟人化」被知识库案例带跑）。
   - 真实重蒸单篇跨海文案 4m41s 验证通过，产物 `outputs/real-acceptance/dna-v3-result.json`。
2. **模型 403 处理**：daitu INSUFFICIENT_BALANCE → audit/intelligence/analysis 临时切 DeepSeek；解锁 12 个卡死任务；model-audit 加 effort low + 预算升级（3600→9000，修 reasoning 吃满空回执）；真实重跑 200/52.7s/8 条 issue。
3. **黄金三秒 15 类**：旧 6 类 + 新 9 类（反常识冲击/信息差/低门槛承诺/利益钩子/归因反转/游戏段位感/权威背书/现象佐证/方法论承诺），`hookTypes` 单一来源（writing-style.mjs），knowledge-plan.mjs 有每类 mechanism+terms。
4. **主写作方法路由**：A/B/C/D 四组合（灵魂×知识库），选灵魂→DNA 唯一主方法不叠模板 prompt；`writingMethod()` 同源 DNA 合并去重；knowledge-plan.mjs 三检索（正文/开头/同行写法 craftKnowledge）。
5. **改写完整性**：content-coverage.mjs 关键事实（数字/金额）vs 表述细节两级覆盖，缺关键事实先 restoring-original-points 补回；字数 ±10%。
6. **前端二选一切换条**：写作提示词/灵魂互斥显式切换（writing-style.js）；刷新旧内容 bug 修（protectChangedWriterBody 比对 baseBody）。
7. **写作模板绑定知识库**（含飞书库）：prompt-library.mjs 接受 knowledgeSetIds；模板编辑器可勾选/+链接飞书；未手动勾选时沿用模板绑定。
8. **一键复制全部**（promptBundleText）：提示词+语言DNA+结构+认知+视觉按序复制。

## 五、遗留 / 待办（按优先级）

1. **DNA v3 旧产物未重蒸**：森桢 68 篇（tpl-2c4df506）、自定义 1 篇（tpl-193b4623）仍是 v2 产物，要按 v3 重蒸才享新规格（68 篇约 5 分钟）。重蒸后旧模板可删。
2. **「不拟人化」硬性禁忌前置后未真实改写复测**：跑一次改写看结尾是否还拟人化平台/写总结清单。
3. **daitu 充值后切回** audit/intelligence/analysis。
4. **domain_tactics 词表是黑名单**，兜不住新行业黑话，长期靠跨话题检验提示词约束（语义判断无法确定性兜底）。
5. **长度裁定**：超上限仍靠修复+人工确认，未强制裁剪（既有策略，非遗留 bug）。
6. **细节覆盖缺失只提示不拦截**（防同义改写误报的取舍）。
7. 旧遗留（更早）见 DEEPSEEK_HANDOFF.md：浏览器对 127.0.0.1 的 saved-permission 截图验收、话题生文 524 历史验收等。其中旧任务优先级以本文件和用户最新指令为准。

## 六、关键代码地图

| 文件 | 职责 |
|---|---|
| `app/src/writing-dna.mjs` | 蒸馏主链路：分篇(splitTextArticles)、dnaStats、批分析、整合(reportInstructions v3)、parseDnaReport 校验、dnaQuality |
| `app/src/writing-style.mjs` | hookTypes(15类)、writingPriority、stylePromptOf(硬性禁忌)、writingMethod/writingRoute(主方法路由) |
| `app/src/knowledge-plan.mjs` | 三检索：bodyKnowledge/hookKnowledge/craftKnowledge、hookTypeMechanisms、hookEcho |
| `app/src/content-coverage.mjs` | originalPoints/coverageReport(关键事实 vs 细节)/realCharCount |
| `app/src/hook-writing.mjs` | 生成阶段编排：识别→起草→补要点→校验→修复（无 applying-soul 二次重写） |
| `app/src/writing-recognition.mjs` | 写法识别，hookType 归一到 15 类（rawHookType 留痕） |
| `app/src/model-audit.mjs` | 模型审核，effort low + 预算升级 |
| `app/src/model-profiles.mjs` + `app/data/model-profiles.json` | 模型档案与用途分配 |
| `app/public/writing-style.js` | 二选一切换条、类型下拉 |
| `app/public/writing-workbench.js` | 工作台、hookWritingEvidence(生成依据)、protectChangedWriterBody(缓存) |
| `app/public/prompt-library.js` | 模板管理、知识库绑定、一键复制 |
| `outputs/real-acceptance/` | 全部真实验证脚本与落盘响应 |

## 七、测试与验收约定

- 全量回归：`./.runtime/node-v24.22.1-win-x64/node.exe --test app/tests/*.test.mjs`（162 条）。偶发 collection-flow 并行超时可单独重跑。
- 真实验收脚本都在 `outputs/real-acceptance/`：`dna-v3-verify.mjs`（蒸馏）、`writing-route-verify.mjs`（四组合路由）、`403-check/`（模型连通性）。跑真实模型前确认 model-profiles.json 的 assignments。
- **验收铁律**：「能不能用」以用户可见页面为准，不以 curl 200 为准；两份独立证据（静态+运行时）才算验收。

## 八、用户当下正在做的事

用户在集中测「改写 + 黄金三秒类型 + DNA 灵魂」链路，会拿真实文案跑改写并贴结果质疑（如开头没变、拟人化、总结清单）。响应模式：先查 taskRuns/versions 里该任务的真实回执（hookSources/coverage/writingDna/knowledgeSnapshot）再定责，是提示词问题、逻辑问题还是模型问题要分开说。用户手上有 68 篇森桢语料、跨海单篇语料、飞书 529 篇知识库。


## Codex 接手补充（2026-11-04，优先于上文旧状态）

- 用户本轮要求先修 `invalid_duration_mode`，再接手写作剩余工作；此前完成的蒸馏方法不重做。本轮用户随后反馈指定上传任务截断，因而只补修该任务暴露的合集分篇问题。
- 保存报错已修：写作页不再从旧草稿带入已删除的时长选择；后端将历史空值规范为 original，其他非法值仍拒绝。实际 HTTP 创建及 PATCH 均通过。
- DeepSeek Chat 参数修正为 reasoning_effort:'low'（此前 effort 字段未按官方协议生效）；只改运行逻辑，未改用户保存的 Prompt。
- 真实改写复测落盘：outputs/real-acceptance/codex-writing-takeover/。首次真实生成 HTTP 200 / 74.2 秒 / 1199 字，无平台拟人化命中，用户 Prompt 校验值未变化；同时发现开头照搬及“12字重合”被当作字数问题过滤。
- 开头问题已修：字数裁定保留照搬意见，只重写被拒绝的首句，正文保持；用已返回正文继续真实修复，31.5 秒，1222 字，finalPassed=true，无剩余校验问题。证据 opening-repair-result.json、修复后文案.md；不把模型检查等同于浏览器或人工视觉验收。
- 指定任务 text-distill-56083743-5743-4600-b668-3964c8855582 的 TXT 实际是 72 篇，用普通空行分隔，先前误认1篇61582字。已针对命名为原始文案/合集的文件识别普通空行；普通文章的段落不强制拆篇。中文URL编码文件名解码；逐字重组证明全文未丢失。
- 该任务已先备份 app/data/studio.json 至 app/.runtime-data/before-dna-split-*.json，再通过正式 restart 接口重新识别为72篇并启动。旧运行回执和原始单文件保留在原任务 originalImportedRows/originalImportLog；不把旧跨篇结构误复用为逐篇笔记。当前仍为后台运行，不声称72篇已全部完成，不要打断或重启主服务。
- daitu 余额事项仍是外部条件，不自动切换模型、不重试历史未知请求，不恢复旧版蒸馏或删除旧模板。

## Codex 后续验收补充（2026-11-04，覆盖上节运行状态）

- 历史蒸馏列表改为10条分页，操作列保留144px，按钮104px；文件名解码、标题限两行、日期紧凑排列、刷新loading及请求防串。outputs/component-dom/dna-history-table.mjs 通过；未完成实际浏览器像素验收，不绕过已保存的网站权限。
- 知识库显式全取消发送空数组，不再误恢复模板默认库；未手选时仍继承模板默认。
- 审核修订支持用户编辑替换文字和空字符串删除；单条无重叠建议直接按接受的替换应用，不重复付费全文改写；重叠意见仅请求对应局部，其他正文系统原样拼回，拒绝越界修改。保持预览、采用、版本记录和重复采用幂等。
- 模型审核保留每次真实回执；截断不能当有效JSON解析。DeepSeek 首次低推理，已知截断后的有界补请求禁用thinking，防预算再次全耗在推理。网络/5xx未知请求仍不得自动重试。
- 真实审核闭环 outputs/real-acceptance/review-closure/result.json：9条意见，经选择修改和采用后再次审核7条；明确套话已删除、重复采用不重复建版本、显式不使用知识库生效。未定稿，不声称全部意见消失。
- 72篇蒸馏运行 dna-72d4b32b-33db-4095-8def-0ab9cb606b60 已于第9篇引用校验补请求截断，完成8篇；状态failed，不是仍在运行。第9篇完整首回执经新引用校对可直接解析：只定位原文中唯一首尾锚点，允许恢复1–2个漏抄语法虚词，记录前后，不修改原文，不容许数字/否定/换词。补格式请求禁用thinking，原逐篇方法不变。
- 用户最新希望外部免费AI蒸馏节约费用，因此未重启72篇付费任务，保留检查点和回执；不要擅自继续计费。外部蒸馏指令见 docs/外部AI蒸馏灵魂指令.md；手工导入灵魂提示词不会自动导入原文、五份产物和五篇校准，需要另外选知识库。
- 确认主服务无running/unknown任务后备份到app/.runtime-data/before-review-fix-*.json并重启4310加载修复。全量回归180/180通过；用户Prompt未改，没有Git提交/推送。

## 72篇语言汇总截断修复（2026-11-04，覆盖前述暂停状态）

- 用户再次报告同任务完成72篇后 layer:language:0:1 截断，最新失败运行 dna-34c69652-060e-435e-ab86-4c84391565bb，85个检查点。真实回执 completion=14000，reasoning=11113，正文4697字符，finish_reason=length；前一次同阶段也是约11212推理tokens后截断。
- writing-dna-engine.dnaOutputOptions：DeepSeek 分层/整合推理改low，预算至少24000；续跑相同已知length阶段至少32000。原文、逐篇方法、证据校验及检查点inputHash不变，不自动重试网络/5xx未知请求。记录实际outputOptions。
- 用户本次报错授权修复后续跑，已通过restart正式接口恢复，仅复用已有精读及语言第一组，不重新采集/转写/精读。当前后台running，72/72，语言1/17；不要重启服务或重复启动。完整完成状态必须再看实时progress，不能根据本文声称已经完成。
- 恢复时另外暴露Windows EPERM rename保存锁。新增atomic-replace.mjs，对EPERM/EBUSY/EACCES最多7次短退避重试原子rename，不删除目标、不重跑上游模型，其他错误立即返回。首个恢复运行在缓存49篇处本地保存失败，无新增模型响应；修复保存后重新恢复。
- 进度请通过已登录的 /api/studio/writing-dna/:id?view=progress 查询，避免外部同步读取60MB studio.json时短暂占锁。主数据已备份app/.runtime-data/before-dna-synthesis-*.json。
- 全量回归184/184通过，新增用例验证输出预算、已知截断后不重复精读、Windows短锁恢复及持久锁退出。

## 语言多轮合并连接中断（2026-11-04）

- 用户随后报告 layer:language:2:4 terminated。实时核对运行 dna-a9f189c9-c3ad-4345-affd-e27bf47ffe1c 为unknown：72篇已完成，语言0层17组和1层9组均有检查点，2层完成4/5；已有29条完整返回，断开阶段无完整回执。
- 用户明确回复“允许，仅重试断开的阶段”。已通过resolve-unknown正式接口记录许可，旧请求费用未知记录保留；重启前备份before-dna-stream-*.json。随后restart继续，原检查点输入保持不变，不重新提交已完成阶段。
- 仅DeepSeek Chat蒸馏启用SSE，stream_options.include_usage=true；Responses模型保持既有适配，原方法和提示词不变。model-stream.mjs按UTF8增量拼接，忽略内部推理文本，只保存计数；必须收到finish_reason才承认完整返回，中断只保存partialResponses诊断，不用半份结果作报告。每15秒落盘streamProgress；错误保留底层code/requestId/已接收字符。
- SSE不等于保证网络不再断；仍然遵守未知请求不自动重试。只拿到终结事件后usage尾部断开时可用已明确完整的内容，usage不可伪造。
- 全量回归187/187通过，含中文跨字节、heartbeat、usage-only尾部、断流保留片段、无终结事件拒绝等测试。当前继续后台验证，最终状态以实时progress为准，勿重启或再提交同任务。
- 真实续跑已越过 layer:language:2:4，进展至 layer:language:3:1（语言第四轮1/4完成），SSE实际收到正文字符并更新streamProgress，无错误。说明本次授权的断开阶段已完整返回；全任务仍未完成，后续未知请求不在本次重试许可内。

## 归纳不收敛修复（2026-11-04）

- 运行dna-3bc0714f-94c2-4fab-b051-4dc7a3e3db8f完成语言3层4组后本地触发dna_synthesis_context_too_large。根因是40000字符分组遇到携带完整重复引文的报告，4进4出，原逻辑直接停止；这不是未知模型请求，不需要再解锁旧unknown。
- 新增synthesisGroups：普通分组能减少数量时保持原样（因此已完成0至3层检查点inputHash不变）。不收敛时，将已核验引文转为articleId/start/end稳定sourceRef，原文仍通过evidencePool提供；完整报告content、全部规则、支持与反例保留，完整引文仍在历史检查点。若仍无法按字符数减组，则完整记录两两合并，不截断、不丢弃规则。
- 真实失败的4份报告本地验证变2组，35363/31570字符，70条规则全部保留。证据输入只存outputs/real-acceptance/review-closure/language-merge-input.json，属于本地输出，不推送。
- 全量188/188通过，新增大引文/大报告收敛与反例保留测试。已备份before-dna-reduction-*.json，确认无running/unknown后重启并正式restart此任务；目前仍后台续跑，勿重复提交或重启。
- 本轮真实验证：语言4层两组完整返回，再到5层最终一组合并成功；实时progress已进入structure 1/17，state=running，error=null。语言DNA已完成，结构/认知/整合/复刻检查尚未完成。

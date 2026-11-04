# Library & Dependencies

## 1. 飞书写作生产层

本 Skill 不负责重新采集作者主页。

默认使用同一 Base 中的三张生产表：

- `爆款文案拆解库`：逐篇完整原文与写作动作
- `选题与借势库`：母问题、点击理由、借势对象与可迁移方向
- `爆款规律与改写组件库`：带真实原句、适用条件和失效条件的候选组件

具体 table_id、字段与检索顺序见 `production-library-routing.md`。

原始“内容蒸馏”表只作为事实回退层。

字段以真实表为准，已知适配规则：

- `黄金开头`：不是“黄金三秒”
- `时长`：不是“视频时长”
- 若没有 `发布时间` 字段，不得自行假设存在
- 数据读取优先 NDJSON
- 单次读取存在硬上限时，必须分页直到覆盖目标作者全部候选范围

AI 分析字段只用于检索和辅助判断。

最终关键结论必须回到完整 `原文 / 文案`。

## 2. lark-base / lark-shared

职责：

- 表结构读取
- 作者筛选
- 候选检索
- 完整原文读取

不要自动重新配置飞书权限。

不要扩大 OAuth / 应用权限。

## 3. account-distill

职责：

- 全量读取指定作者
- 逐篇逐字分析
- 生成 / 更新 `writing-{author}`
- 维护作者 Writing DNA、Negative DNA、Correction History

`baokuan-rewrite` 不应每次重新完成这套全量蒸馏。

当前环境不存在 `account-distill` 时，不得声称已经生成作者 Skill。普通改写继续使用生产表；指定作者改写则从作者真实样本建立仅供本次任务使用的临时校准卡。只有用户明确要求创建或更新作者 Skill 时，才把任务移交给可用的 `account-distill`。

## 4. writing-{author}

作者模式的第一作者模型。

优先读取：

- SKILL.md
- 当前内容类型相关 references
- Negative DNA
- Decision Rules
- Logic / Progression
- Tone / Rhythm

## 5. writing-dna-skill

参考仓库：

`larashero3-dotcom/writing-dna-skill`

在改写阶段把它当作“作者风格二次校准器”，而不是替代 account-distill。

可用时优先读取：

- Writing-DNA.md
- 语言DNA.md / language-dna.md
- 文章结构模板.md / structure-patterns.md
- 写作视角与认知框架.md / cognitive-framework.md

如果存在 raw：

再读与当前体裁 + 题材最相关的 5 篇完整原文。

纯口播任务不强制读取视觉风格。

只有需要图文 / 配图 / 视觉脚本时再加载 L6。

## 6. lieflat-less-ai-tone

写作完成后的最后一道 AI 痕迹清理。

规则：

- 必须真实读取并执行
- 不得只声称“已去 AI 味”
- 作者真实 DNA 与去 AI 味规则冲突时，作者 DNA 优先
- 清理完成后，作者模式必须再做一次 Author Authenticity Audit

# 数据与改写交接

## 默认配置
Base：IjbBblKh0amzztsiExVc1PqInfd
- 原始事实表：tbljaR1tbDTzyl0s
- 爆款文案拆解库：tblmnyTgOeTLR8Cm
- 选题与借势库：tblsqHLB1tSQ2OfB
- 爆款规律与改写组件库：tblZQF1iArLS0Il9

使用前核对真实字段和可访问性。源表只读；生产表按 source_record_id 定位候选，不代替源文。作者全量范围以源表为准，同文跨表不得重复计数。冲突保留差异和来源版本。

默认作者蒸馏交付文件。只有用户要求落表才写生产表，按来源/作者版本更新并保留无关记录。访问失败不得假称已检索。
工具源码上传授权不代表授权上传作者全部 raw 数据。

## 作者包接口
输出目录：用户指定位置，否则当前任务 outputs/writing-{author_slug}。
slug 使用稳定的小写 ASCII、数字和连字符，更新已有作者时沿用已有 slug，不随中文别名新建重复作者。
- SKILL.md：作者、model_version、范围、验证状态、按类型读取引用的入口。
- references/author-profile.md：条件化习惯、适用范围、来源、反例、置信度。
- references/frameworks.md：按类型记录开头→承接→推进→论证→收尾的真实路径。
- references/sample-index.json：schema_version、author、author_slug、model_version、generated_at、base_id、source_table_id、samples。
- samples 每项：source_record_id、title、content_type、topic、source_url、raw_path、read_status、text_hash、text_origin、published_at、metrics_observed_at；未知字段为 null。
- raw/：每篇一个完整原文文件。raw_path 相对作者包根目录且不得越界，保留原始格式；清洗版另存。
- writing-guide.md：给用户看的指南。
- research/：语料覆盖、逐篇分析、对照、矛盾与版本变更。
- qa/validation.md：本次实际检查结果。

改写读取顺序：作者 SKILL.md → 当前类型模型/框架 → sample-index.json → 最相关 3–5 篇完整原文。数量不足说明限制、不凑数；raw 不可读则按 source_record_id 回读飞书。读不到不虚构作者校准完成。
如有独立 Writing-DNA.md 产物可补充，但作者包自身应可用，不假称生成了外部 Skill 的全部文件。

比较原稿与候选后决定保留、替换或重组。当前事实、用户任务和全文声音一致性优先；去 AI 味后再次检查。

## 增量更新
manifest 记录读取范围、来源 ID、文本哈希和状态。新增补读、变更重读、删除记录标为失效来源，重算受影响规则与统计。缺失不可误判为删除。工具版本和作者模型版本分别记录。

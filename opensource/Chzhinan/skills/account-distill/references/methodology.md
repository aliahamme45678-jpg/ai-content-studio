# Methodology · 全量读取与单篇分析协议

## 1. 读取顺序

1. 先拉取作者全部索引记录。
2. 去重并标记疑似重复。
3. 对每条有效记录读取完整原文。
4. 长文分页读取直到末尾。
5. 完成后标记 `READ_COMPLETE`。
6. 只有 `READ_COMPLETE` 样本可进入强结论。

## 2. 单篇 Content Card

每篇至少记录：

- record_id
- 标题
- 字符数
- 视频时长（如有）
- 字/分钟（如有）
- 内容类型
- 主题
- 具体切口
- 用户处境
- 表面问题
- 作者如何重新定义问题
- 第一行 / 黄金三秒
- Hook sequence
- 开头承诺
- Logic Grammar
- Content Archetype
- Progression Grammar
- 关键追问
- Transition Triggers
- Contrast Patterns
- Decision Rules
- 证据类型
- 案例位置
- 动作颗粒度
- 判断标准 / 边界 / 阈值
- Tone
- Rhythm
- Ending
- Business Integration
- 不可迁移事实

## 3. 不允许的捷径

- 不能用摘要代替原文。
- 不能用 AI 标签代替阅读。
- 不能把同一系列内容当成多个独立证据。
- 不能把行业通用词当成作者指纹。
- 不能把一次偶然表达当成稳定特征。

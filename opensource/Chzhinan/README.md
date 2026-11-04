# 改写文案Skill

本仓库同时维护改写与账号蒸馏工具。根目录为 baokuan-rewrite，`skills/account-distill/` 为 account-distill v2；生成的作者包使用 `writing-{author}` 名称单独保存。作者原始素材不会因上传工具而自动上传。

蒸馏入口：读取 `skills/account-distill/SKILL.md`，然后输入“蒸馏作者：跨海”。它生成中文写作指南及可供改写调用的作者样本包。嵌套目录不保证自动注册为独立 Skill，可先按路径调用；需要自动发现时再把该目录安装或链接到 Agent 的 Skill 目录。

仓库更新是源码同步，运行仍由 Agent 完成。已经从 Git 克隆的使用端执行下方 pull 即可；旧 ZIP 安装的目录需先迁移为 Git 管理，不能直接 pull。

## 它能干嘛

给它一篇参考文案，它会：

- 普通模式：先从选题与借势库理解母问题，再从爆款文案拆解库精读相关完整原文，只有存在明确缺口时才使用 0–2 个改写组件
- 作者模式：加载 `writing-{author}`，并在可用时叠加 `writing-dna-skill` 的 Writing DNA + 真实原文，按目标作者的真实写作习惯重写

新增能力：

1. 接入三张飞书写作生产表，并明确各自职责
2. 先理解母问题，再精读原文，最后按需选择组件
3. 自动判断轻改 / 中改 / 重构
4. 事实白名单，防止移植他人经历或编造数据
5. 作者 Skill 缺失时使用临时作者校准卡，不再虚假声称已完成作者蒸馏
6. 去 AI 味后再做 Author Authenticity Audit

## 最低输入

一篇原始文案。

例如：

`用 baokuan-rewrite 改这篇：……`

指定作者：

`按跨海的写法改：……`

可选补充：

- 受众
- 平台
- 时长
- 产品
- 转化目的
- 必留事实

## 默认输出

- 推荐标题
- 完整口播文案
- 2 个备选标题
- 3–5 个话题
- 一行素材依据

说“只要文案”时，只输出正文。

## 云端安装与更新

首次安装到 Codex：

```powershell
git clone https://github.com/aliahamme45678-jpg/Chzhinan.git "$env:USERPROFILE\.codex\skills\baokuan-rewrite"
```

以后更新不再下载安装包，直接执行：

```powershell
git -C "$env:USERPROFILE\.codex\skills\baokuan-rewrite" pull --ff-only
```

仓库为私有仓库，首次克隆时需要使用有访问权限的 GitHub 账号完成认证。

## Skill 链路

参考文案
→ 选题与借势库
→ 爆款文案拆解库
→ 按需调用改写组件
→ writing-{author} / 临时作者校准卡（指定作者时）
→ writing-dna-skill（存在时）
→ lieflat-less-ai-tone
→ Author Authenticity Audit
→ 最终文案

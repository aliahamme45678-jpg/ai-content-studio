# CodeGraph 接入与使用

完成日期：2026-11-04（北京时间）。

## 安装与兼容性

- 软件：@colbymchenry/codegraph 1.6.2，npm 全局安装。
- 平台：Windows x64；现有 Node v24.14.1、Codex CLI 0.166.0-alpha.5.1。
- 实际 MCP 使用安装包自带 Node v24.16.0 和 node:sqlite，不依赖系统 Python、Docker 或 Rust 编译器。
- 遥测已关闭：全局 CodeGraph 偏好与 MCP 环境 CODEGRAPH_TELEMETRY=0 双重设置。

## 配置保护

Codex 配置：C:/Users/Administrator/.codex/config.toml。
原配置备份：C:/Users/Administrator/.codex/backups/config.before-codegraph-20261104-013531.toml。

原文件全部字节作为前缀保留，仅追加 mcp_servers.codegraph 及其 env 表；原 node_repl、skillpx 和其他模型/插件设置逐项比对一致。验收临时会话自动写入的项目信任记录已清理，不额外留下永久权限配置。未运行面向所有 Agent 的自动安装器，未改其他 Agent 配置或业务源码。

MCP 使用绝对路径启动包内 Node，不依赖 Codex 进程的 PATH；默认项目为当前 SPX 仓库。已启用 explore、search、node、callers、callees、impact、files、status 八个工具，启动超时60秒、单次工具超时120秒。

## 索引范围

项目：D:/360MoveData/Users/Administrator/Documents/New project 4/ai-content-studio。
索引：.codegraph/codegraph.db。
当前快照：117 个文件、1258 个节点、5342 条关系，JavaScript 和 Python；pendingRefs=0、无待同步变化。

遵循项目 .gitignore，排除依赖、运行数据、输出证据和 opensource 等已忽略目录；不是整个 New project 4 的多仓索引。索引数据库通过 .git/info/exclude 本地排除，不改原有 .gitignore。

新增 codegraph.json 仅排除两条已从磁盘删除、Git 暂存区仍记录的旧路径：app/public/hook-libraries.js、app/tests/hook-libraries.test.mjs。若将来恢复这两个文件，移除相应 exclude 后重新 sync/index。

## 实际验收

以真实 Codex app-server 创建临时验收会话，MCP runtimeStatus=connected。未发起模型 turn，不消耗真实模型推理请求。

| 验收 | 结果 |
| --- | --- |
| codegraph_search 搜索 syncIntelligence | 通过：定位 app/src/intelligence-sync.mjs |
| codegraph_callers 上游调用者 | 通过：refreshIntelligenceCache、handle |
| codegraph_callees 下游调用 | 通过：readCollectedIntelligence、applyChineseIntelligence |
| codegraph_node 文件依赖 | 通过：返回 server.mjs 等依赖者 |
| codegraph_explore 综合追踪 | 通过：返回源码及相关调用链 |
| codegraph_impact 影响范围 | 通过：覆盖 server.mjs 等受影响文件 |
| codegraph_status 索引状态 | 通过 |
| 文件新增自动索引 | 通过：无手动 sync，MCP 搜索发现临时函数 |
| 文件删除自动索引 | 通过：删除后搜索不再返回临时函数 |

临时测试源码已删除；重新全量索引无扫描警告。初始警告已归档 outputs/codegraph-acceptance/initial-errors.log。完整证据及复验脚本在 outputs/codegraph-acceptance/，仅本地保留。

## 日常使用

当前对话不会自动注入新工具。重开一个 Codex 会话（必要时重启 Codex 客户端），即可从新增 MCP 配置加载。可直接说：

- “用 CodeGraph 找到 syncIntelligence 的实现和调用者。”
- “追踪 refreshIntelligenceCache 到 applyChineseIntelligence 的调用链。”
- “查看 intelligence-sync.mjs 的依赖和修改影响范围。”

MCP 已连接时自动监听保存、增删变化。离线修改后可手动同步：

```powershell
cd 'D:\360MoveData\Users\Administrator\Documents\New project 4\ai-content-studio'
codegraph sync
codegraph status --json
codegraph explore "syncIntelligence"
codegraph callers syncIntelligence
codegraph callees syncIntelligence
codegraph node --file app/src/intelligence-sync.mjs --symbols-only
```

其他项目：在其根目录运行 codegraph init --yes .；之后调用 MCP 时传入该项目绝对路径 projectPath。当前全局 MCP 的默认项目仍为 SPX，不会自动索引整个硬盘。

CodeGraph 是静态分析，动态字符串导入、反射、运行时网络依赖不保证完全还原；需要结合源码和运行记录判断。

## 参考

- [官方仓库](https://github.com/colbymchenry/codegraph)
- [Codex 官方 MCP 配置说明](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

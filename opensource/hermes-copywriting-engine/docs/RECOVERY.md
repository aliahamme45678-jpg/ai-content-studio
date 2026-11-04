# 2026-10-27 本地恢复记录

实际网站目录：`D:\360MoveData\Users\Administrator\Documents\New project`。

用户提供的 `C:\Users\Administrator\.openclaw\workspace\lobsters\rewrite-shrimp` 保存记忆、Prompt 补丁和素材整理文件；它不是网页源码目录。通过服务端的 `MEMORY_ROOT`、`MATERIAL_PATH` 引用确认该目录与网站的关联。

网站项目名为 `tk-rewrite-dashboard`，前端为原生 HTML/CSS/JavaScript，后端为 Node.js 原生 HTTP。原启动脚本为 `npm start`，实际执行 `node server.js`。

恢复前，`http://127.0.0.1:8787/` 连接被拒绝；执行原启动入口后即正常响应。没有修改原目录的业务逻辑、页面字段、模型配置和 Prompt。

验证结果：

- server.js、app.js、soul-system.js 语法检查通过。
- 首页、CSS、JavaScript、Logo、配置、素材、提示词与生成历史接口返回 HTTP 200。
- 原电脑素材读取 302 条，生成历史读取 89 条。
- 在浏览器实际切换“生成文案”“话题生文”“素材管理”，页面可显示，素材计数正常。
- 记忆库六个必需文件与 TXT 素材库均存在。

恢复时原配置使用 `https://api.vectorengine.cn/v1/chat/completions` 与模型 `gemini-3.1-flash-lite-preview`。真实 API Key 不在仓库中。未提交新的生成请求，外部模型可用性和内容质量未验证。

GitHub 导出包复制了运行所需文件并保持字节一致，校验值见 `source-manifest.json`。只整理了包元数据、凭据排除规则与文档；没有把原目录里混放的其他工具一起上传。

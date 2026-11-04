# SPX 内置依赖源码

以下项目以普通文件目录随 SPX 主仓库保存。克隆本仓库即可取得源码，不需要额外克隆或初始化 Git submodule。

| 目录 | 用途 |
| --- | --- |
| AIHOT | 情报采集、数据库和情报服务 |
| douyin-material-pipeline | 抖音采集、语音转写及素材处理 |
| hermes-copywriting-engine | Hermes 写作引擎与提示词来源 |
| dbskill | dont 审核方法文档及其公开依赖资料 |
| Chzhinan | 作者分析及写作提炼方法 |

来源地址、导入版本和本机修改记录见 [SOURCES.json](SOURCES.json)。每个目录保留其上游许可证、NOTICE 和说明；SPX 的集成不改变它们的许可条件。AIHOT 的本地 content.ts 修改随当前源码一起保存。

不会随仓库保存各项目的 Git 历史、node_modules、Python 环境、数据库、Cookie、运行产物和私有配置。依赖安装仍需按照各项目 package.json/requirements 文件进行；SPX 的 Windows 启动入口为根目录 start-local.ps1。

用户明确允许随仓库保存的 ASR Key 单独位于 config/asr.env。SPX 优先使用环境变量与本机 app/data/douyin.env，再读取此后备配置。该文件不含写作模型 Key、飞书凭据或抖音登录态。

# 小小生开发工作台

版本：`1.0.0.0`

本地优先的程序员开发工作台。它把多产品状态、构建测试、环境检查、多模型调用、团队 Agent 协作、风险审批和执行审计放进同一个应用。

核心领域模型：

```text
产品
├─ 环境集合（开发、测试、预发布、生产……）
├─ 代码仓库集合（前端、后端、Agent、脚本……）
└─ 部署映射（环境 × 代码仓库 → 分支/版本/部署状态）
```

环境和代码仓库是产品下的并列维度，通过独立的部署映射关联，不存在上下级关系。

日常研发流程以版本为交付单位：

```text
版本号（例如 v1.2.0）
└─ 多个需求
   └─ 需求 → 计划 → 结构化任务 → 编码 → 部署 → 测试 → 发布
      └─ 每项任务指定已配置匹配 Agent 的负责人，可选用该 Agent 执行
```

产品、代码仓库、环境和部署映射属于基础配置；版本与需求属于日常研发流程。

当前版本具备：

- 项目注册与技术栈自动识别
- Git 状态批量检查
- 只执行项目中预先登记的构建、测试、检查命令
- `read`、`write`、`deploy` 三级风险与交互式审批
- OpenAI Responses API、DeepSeek/Kimi 等 OpenAI-compatible Chat Completions 接入
- 自然语言任务通过工具调用查询项目、查看 Git 状态、运行已登记命令
- API Key 环境变量引用，不把密钥写入配置
- SQLite 运行审计，不记录完整提示词
- Node、Git、npm、Docker 和项目配置诊断
- 本地 Web 管理台：版本化研发工作流、配置中心、命令执行、Agent 对话、环境诊断和审计记录
- 人员与 Agent：人员承担责任，每人最多配置一个绑定 Provider、Skills、Tools、仓库和环境范围的 Agent
- 团队群聊：管理员默认参与所有群聊，可通过 `@员工名` 请求对应员工 Agent 回答；员工可发送开始处理、完成任务、需要确认和普通消息，并把开始/完成动态同步到任务状态
- 当前本地登录人默认为独立的系统管理员，拥有全部管理权限；管理员不进入员工列表，也不参与研发任务分配
- 浅色/深色双主题，浏览器本地记忆用户选择

## 快速开始

```powershell
npm install
npm run build
node dist/src/cli.js init
node dist/src/cli.js doctor
npm run web
```

管理台默认地址为 `http://127.0.0.1:4317`。服务只监听本机地址，不会向浏览器返回 API Key。可用 `DEV_AGENT_PORT` 修改端口。当前会话默认显示“小小生 / 本地管理员”；如需修改显示名称，可设置 `DEV_AGENT_USER_NAME`，其管理员角色和权限保持不变。

## Linux 安装包

构建 Linux x64 发行包：

```powershell
npm run package:linux
```

产物位于 `release/xxs_workbench-1.0.0.0-linux-x64.tar.gz`。发行包内置经过 SHA-256 校验的 Node.js 24 LTS 和 Python 3.12 便携运行时，不要求服务器预装 Node/Python；发行包不包含 `.dev-agent`、SQLite 数据库或 API Key。解压后执行 `./install.sh` 完成离线安装，再运行安装目录中的 `start.sh`，详细说明见包内 `README-LINUX.md`。

代码仓库从配置中心维护：进入“配置 → 配置产品”，选择本地仓库目录并点击“添加并关联”。同一个本地仓库可被多个产品关联，底层会按仓库 ID 去重。

配置中心分为“人员配置”和“产品配置”两个二级菜单。人员支持新建、编辑和受保护删除；如果人员或名下 Agent 仍被研发任务引用，删除会被拒绝。任务始终由已配置角色匹配 Agent 的人员负责，可以选择该 Agent 执行。Skills 只描述工作方法，Tools 决定可调用的本地能力，仓库和环境范围限制作用域；服务端会再次校验这些权限。通用 Agent 预设均包含“群聊协作”Skill，已有 Agent 会在服务启动时自动补齐该 Skill。管理员在群聊中输入 `@员工名` 后，系统会使用该员工 Agent 的 Provider 和群聊上下文生成回答；未配置 Agent 的员工只能查看消息，不会自动回答。产品配置、人员与 Agent、研发流程、群聊消息和运行审计统一保存在 `.dev-agent/dev-work-agent.sqlite`。

首次启动 SQLite 版本时，会自动把现有的 `config.json`、`people.json`、`milestones.json`、`workflows.json`、`group-chats.json` 和 `runs.jsonl` 导入数据库。导入标记写入数据库，迁移只执行一次；原文件不会删除，可作为迁移前备份。

注册项目并运行命令：

```powershell
node dist/src/cli.js project add demo D:\workspace\demo
node dist/src/cli.js project list
node dist/src/cli.js status --all
node dist/src/cli.js run demo test
node dist/src/cli.js task "检查 demo 的 Git 状态并运行测试" --project demo
```

## 通过文件配置 API Key

创建本地密钥文件：

```powershell
node dist/src/cli.js secrets init
node dist/src/cli.js secrets path
```

编辑 `.dev-agent/secrets.env`：

```dotenv
OPENAI_API_KEY=你的Key
DEEPSEEK_API_KEY=你的Key
KIMI_API_KEY=你的Key
```

CLI 启动时会自动加载该文件。已经存在的系统环境变量优先于文件值。可以用下面的命令检查配置状态，它不会显示 Key：

```powershell
node dist/src/cli.js secrets check
```

`.dev-agent/` 已被 Git 忽略。也可通过 `DEV_AGENT_ENV_FILE` 指向其他密钥文件。

## 调用模型

```powershell
node dist/src/cli.js ask "分析这段构建日志" --provider openai

node dist/src/cli.js ask "给出排查思路" --provider deepseek

node dist/src/cli.js ask "总结发布风险" --provider kimi --model <可用模型名>
```

执行 `init` 后，配置位于 `.dev-agent/dev-work-agent.sqlite`。模型名称可能随供应商更新，业务逻辑不会依赖具体名称。API Key 仍保存在独立的 `secrets.env`，不会进入数据库。

## 安全模型

- `status` 和标记为 `read` 的命令可直接运行。
- `write`、`deploy` 命令默认询问确认；自动化中必须显式传入 `--yes`。
- CLI 不能执行任意命令，只能按名称调用项目配置中已经登记的命令。
- 模型只能提出工具调用；本地策略层负责校验项目范围、命令白名单和审批。
- API Key 只读取配置指定的环境变量。
- SQLite 的 `audit_events` 表保存开始时间、结束时间、退出码和参数摘要。

配置示例：

```json
{
  "id": "order-service",
  "name": "order-service",
  "path": "D:/workspace/order-service",
  "stack": "java-maven",
  "commands": {
    "test": {
      "command": "mvnw.cmd test",
      "risk": "read",
      "description": "Run tests"
    },
    "release": {
      "command": "mvnw.cmd deploy",
      "risk": "deploy",
      "description": "Publish artifacts"
    }
  }
}
```

## 开发

```powershell
npm test
```

通过 `DEV_AGENT_HOME` 可以把配置和审计记录放到隔离目录，测试也使用这一机制。

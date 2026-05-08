# Code Semantic Sync

`codetalk` 是一个基于语义图工作的 AI coding CLI。

它维护项目内的 `CODEMAP.md`，让 AI agent 在改代码前先读取语义契约，基于该契约理解、规划和修改代码，并在代码变化后把真实行为同步回语义图。它不是单纯的文档生成器，文档不是终点，而是下一次代码修改的语义基础。

## 安装

```bash
npm install -D code-semantic-sync
```

推荐始终使用 `codetalk xxx` 的命令形态：

```bash
npx codetalk help
```

## 首次使用

1. 初始化语义图：

```bash
npx codetalk init
```

2. 手动输入 API URL、API key 和模型：

```bash
npx codetalk config
```

也可以非交互配置：

```bash
npx codetalk config set --api-url https://api.openai.com/v1 --api-key sk-xxx --model gpt-4.1
```

默认配置路径：

```text
~/.codetalker/config.json
```

也支持环境变量：

```bash
CODETALKER_API_URL=https://api.openai.com/v1
CODETALKER_API_KEY=sk-xxx
CODETALKER_MODEL=gpt-4.1
```

## 用户使用方法表

| 用户意图 | 命令 | 输出 |
| --- | --- | --- |
| 查看帮助 | `codetalk help` | 命令和使用表 |
| 初始化仓库 | `codetalk init` | `CODEMAP.md` |
| 配置 API | `codetalk config` | 本地 API URL、API key 和模型配置 |
| 非交互配置 API | `codetalk config set --api-url URL --api-key KEY --model MODEL` | 本地 API 配置 |
| 查看配置 | `codetalk config show` | 脱敏后的配置摘要 |
| 本地扫描仓库 | `codetalk scan` | 源码、命令面、配置、语义图、CI、模块角色 |
| 输出扫描 JSON | `codetalk scan --json` | 结构化仓库扫描结果 |
| LLM 架构扫描 | `codetalk scan --llm` | 基于文件证据生成完整语义图文本 |
| 架构落盘 | `codetalk scan --llm --write` | 将 LLM 生成的完整语义图写入 `CODEMAP.md` |
| 并行架构扫描 | `codetalk scan --llm --write --parallel 8` | 使用 8 个并行 reviewer 分片检视文件后合并落盘 |
| 生成基础语义图 | `codetalk map` | 基于仓库结构生成基础 `CODEMAP.md` |
| 提问代码库 | `codetalk ask "How does auth work?"` | 基于语义图和仓库结构回答 |
| 流式提问 | `codetalk ask "How does auth work?" --stream` | 增量输出回答 |
| 规划修改 | `codetalk plan "Add magic-link login"` | 实施计划、风险、验证步骤 |
| 流式规划 | `codetalk plan "Add magic-link login" --stream` | 增量输出计划 |
| 计划落盘 | `codetalk plan "Add magic-link login" --write` | 写入默认 `CODEPLAN.md` |
| 指定计划路径 | `codetalk plan "Add magic-link login" --write --out plans/auth.md` | 写入指定 Markdown 文件 |
| 本地同步语义图 | `codetalk sync` | 更新 `CODEMAP.md` 的 Change Sync 段 |
| 流式同步进度 | `codetalk sync --stream` | 输出本地同步进度 |
| LLM 语义同步 | `codetalk sync --llm --stream` | 基于变更文件更新完整语义图并显示进度 |
| CI 新鲜度检查 | `codetalk check` | 语义图缺失或比源码旧时返回非零 |

## 推荐工作流

```text
codetalk init
codetalk config
codetalk scan --llm --write
codetalk ask "How does this repo work?"
codetalk plan "Add a new feature safely" --stream
codetalk plan "Add a new feature safely" --write --out plans/next.md
codetalk sync --llm --stream
codetalk check
```

`codetalk scan` 默认不调用模型，适合快速本地结构检查。`codetalk scan --llm --write` 会先列出全部源码文件，再让 coordinator agent 制定检查计划，然后按 `--parallel` 分片创建多个 reviewer agent 并行检视文件，最后由 merger agent 合并为可落盘的完整 `CODEMAP.md`。`--parallel` 默认为 4，小于 1 时按 1 处理。

`codetalk sync` 默认只刷新变更清单。`codetalk sync --llm` 会基于 git 变更文件和现有语义图，让模型返回完整更新版语义图，适合代码行为已经变化后的语义同步。

非流式 LLM 任务不会静默等待。`ask`、`plan`、`scan --llm`、`sync --llm` 在不使用 `--stream` 时会向 stderr 输出开始、等待和完成提示；stdout 保留给结果文本或写入确认，便于脚本继续消费。

`sync` 不执行 `plan`。当前边界是：`plan` 负责生成和落盘可审阅计划，未来的 `apply` 才负责按计划改代码，`sync` 只在代码已经变化后把真实行为同步回语义图。

## API 兼容性

`codetalk ask`、`codetalk plan`、`codetalk scan --llm` 和 `codetalk sync --llm` 使用 OpenAI-compatible `/chat/completions`：

```text
POST {apiUrl}/chat/completions
Authorization: Bearer {apiKey}
```

用户手动配置 API URL 和 API key，因此可以使用 OpenAI 或兼容服务。

## 仓库结构

```text
code-semantic-sync/
  src/index.ts                         CLI 源码
  dist/index.js                        构建后的 CLI 入口
  scripts/test-cli.mjs                 CLI smoke test
  SKILL.md                             Codex skill 工作流
  agents/openai.yaml                   skill 元数据
  references/repo-semantic-map.md      本仓库语义图
  references/semantic-map-template.md  可复用语义图模板
```

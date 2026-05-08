<h2 align="center">codetalk</h2>

<p align="center">
  <strong>为 AI agent 代码修改维护一份活着的语义地图。</strong><br>
  AI coding agent 在修改前读取它，在修改后同步真实行为。
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README_CN.md">中文</a>
</p>

---

Codetalk 是一个维护项目本地 `CODEMAP.md` 的 CLI 工具 — 一份给 AI coding agent 使用的活语义契约。Agent 读取语义图理解架构，基于它规划修改，在改完代码后将真实行为同步回语义图。

这不是一个文档生成器。文档不是终点，而是下一次修改的语义基础。

## 安装

```bash
npm install -D codetalk
```

无其他依赖。要求 Node.js 18+。

## 快速开始

```bash
# 初始化语义图
npx codetalk init

# 配置 LLM API
npx codetalk config set --api-url https://api.openai.com/v1 --api-key sk-xxx --model gpt-4.1

# 用并行 LLM 审查器扫描代码库
npx codetalk scan --write

# 向代码库提问
npx codetalk ask "认证怎么工作的？" --stream

# 生成修改计划
npx codetalk plan "给 API 加上限流" --stream

# 执行计划（并行应用文件修改）
npx codetalk exec --parallel 4

# 修改后刷新语义图
npx codetalk sync
```

配置存储于 `~/.codetalker/config.json`，也支持环境变量：

```bash
CODETALKER_API_URL=https://api.openai.com/v1
CODETALKER_API_KEY=sk-xxx
CODETALKER_MODEL=gpt-4.1
```

## 命令参考

| 命令 | 说明 |
|------|------|
| `init` | 创建 `CODEMAP.md` 模板 |
| `config` | 输入或查看 API 配置 |
| `scan [--write] [--json] [--stream] [--parallel N]` | 运行并行 LLM 审查器生成架构语义 |
| `map` | 从仓库结构生成基础语义图 |
| `ask "问题" [--stream]` | 使用 LLM 解答代码库问题 |
| `plan "需求" [--stream] [--out FILE]` | 生成实施计划并写入磁盘 |
| `exec [--plan FILE] [--parallel N] [--stream]` | 执行计划：通过 LLM 并行应用文件修改 |
| `sync [--stream]` | 通过 LLM 将变更同步进语义图 |
| `check` | 语义图缺失或过期时返回非零 |
| `version` | 打印版本号 |

## 许可证

MIT

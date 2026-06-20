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

codetalk 是一个维护项目本地 `CODEMAP.md` 的 CLI 工具 — 一份给 AI coding agent 使用的活语义契约。Agent 读取语义图理解架构，基于它规划修改，在改完代码后将真实行为同步回语义图。

这不是一个文档生成器。文档不是终点，而是下一次修改的语义基础。

## 安装

```bash
npm install -g codetalk-cli
```

或不安装直接使用：

```bash
npx codetalk-cli init
```

要求 Node.js 18+。

## 快速开始

```bash
# 1. 初始化语义图
codetalk init

# 2. 配置 LLM API（交互菜单或直接设置）
codetalk config
# 或:
codetalk config set --api-url https://api.openai.com/v1 --api-key sk-xxx --model gpt-4.1

# 3. AST 提取 + LLM 合成语义图
codetalk scan

# 4. 通过工具探索代码库（grep/read 等）
codetalk ask "认证怎么工作的？"

# 5. 生成修改计划
codetalk plan "给 API 加上限流"

# 6. 执行计划 — 备份、diff 应用、验证、自动同步语义图
codetalk exec
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
| `config` | 交互式 Provider/API 配置菜单 |
| `scan [--depth low|medium|high|full]` | AST 提取 + LLM 合成 CODEMAP.md，并跳过 `.gitignore` 排除的路径 |
| `map` | 从仓库结构生成基础语义图 |
| `ask "问题"` | 使用工具探索 + LLM 回答代码库问题 |
| `plan "需求" [--out FILE]` | 生成实施计划并写入磁盘 |
| `exec [--plan FILE] [--parallel N] [--timeout MS]` | 执行计划：备份 → diff 应用 → 验证 → 自动同步 |
| `check` | 语义图缺失或过期时返回非零 |
| `rollback [--list | <id>]` | 恢复 exec 备份的文件 |
| `version` | 打印版本号 |

## 许可证

MIT

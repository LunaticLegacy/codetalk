<div align="center">

# 🗺️ 码语者.SKILL

> *先读懂代码，再把理解同步回去。*

[![Skill](https://img.shields.io/badge/🤖%20Codex-Skill-8b5cf6?style=flat-square)](SKILL.md)
[![Docs](https://img.shields.io/badge/📝%20Docs-Markdown-3b82f6?style=flat-square)](references/repo-semantic-map.md)
[![Template](https://img.shields.io/badge/📋%20Template-Semantic%20Map-10b981?style=flat-square)](references/semantic-map-template.md)
[![License](https://img.shields.io/badge/License-MIT-f59e0b?style=flat-square)]()

<br>

当你接手一个陌生仓库、改完一段逻辑，或者需要给团队补一份长期可维护的代码地图时，<br>
**`码语者.SKILL`** 会帮你把"理解代码"和"记录理解"合并成一套工作流。

<br>

[它能做什么](#-它能做什么) · [适用人群](#-适用人群) · [工作流](#-工作流) · [安装](#-安装) · [使用方法](#-使用方法) · [注意事项](#-注意事项)

</div>

---

## 🎯 它能做什么

`码语者.SKILL`（`code.semantic.sync`）是一个以 Markdown 为核心的 Skill，用于构建并维护一份**实时更新的代码语义地图**。

简单来说，它能帮你：

| 场景 | 能力 |
|------|------|
| 🧭 **理解仓库** | 编辑前快速建立代码上下文 |
| 🔍 **捕获语义** | 记录函数和方法的实际行为（输入、输出、副作用） |
| 🔄 **同步文档** | 代码变更后，在同一轮对话中更新语义地图 |
| 🛡️ **拒绝过时** | 避免笔记与代码渐行渐远 |

用一个心智模型来概括：

> 把 *"我觉得这段代码是这样工作的"* 变成 *"这就是当前代码的实际运行地图"。*

---

## 👤 适用人群

- 👋 正在陌生仓库里开始工作的人
- ✏️ 做了修改，希望文档保持诚实的人
- 🔧 维护着大量变动模块的人
- 🤖 希望 Codex 用可持续的方式解释代码的人

如果你的第一个问题是 *"这个函数到底在做什么？"* 或者 *"这次修改改变了什么？"*，这个 Skill 就是为你准备的。

---

## 📦 你能得到什么

典型的输出包括：

- 一份简短的**架构总览**
- 一份**逐函数的语义地图**
- 一份**副作用**、**数据流**和**依赖关系**的清单
- 编辑后**同步更新**的语义地图

**输出示例：**

```md
## 架构
- 主入口：src/index.ts
- 核心模块：parser, resolver, emitter

## 函数
- `parseConfig(input)`:
  - 输入：`string | Buffer`
  - 输出：`ConfigTree`
  - 副作用：无
  - 异常：语法无效时抛出 `ParseError`
```

---

## 🔄 工作流

### 1️⃣ 先阅读

> *不打无准备之仗。*

- 定位相关的源文件
- 尽可能**并行**读取文件级上下文
- 在动手修改之前，先检查主要模块和类型

### 2️⃣ 再映射

> *先见森林，再见树木。*

- 先总结**整体架构**
- 记录每个函数或方法的**目的**、**输入**、**输出**、**副作用**和**失败模式**
- 描述**实际观察到的行为**，而非仅凭意图推测

### 3️⃣ 编辑后同步

> *改完代码，同步理解。*

- **重读**你修改过的文件
- 在同一轮对话中**更新**语义地图
- 反映**签名变更**、**副作用变化**和**兼容性影响**

---

## 📂 输出物

本仓库围绕三个核心制品展开：

| 文件 | 用途 |
|------|------|
| [`SKILL.md`](SKILL.md) | Codex 使用的操作入口 |
| [`agents/openai.yaml`](agents/openai.yaml) | Skill 列表与标签的 UI 元数据 |
| [`references/semantic-map-template.md`](references/semantic-map-template.md) | 语义地图的默认 Markdown 结构模板 |

此外，仓库自身也包含一份规范的语义地图：

- [`references/repo-semantic-map.md`](references/repo-semantic-map.md) — 本仓库的自描述语义地图

---

## ⚡ 安装

### 安装到 Codex

将此 Skill 文件夹复制到你的 Codex skills 目录：

```bash
# 克隆或复制到 skills 目录
git clone <你的仓库地址> ~/.codex/skills/code-semantic-sync
```

如果该文件夹已位于你正在工作的仓库内，可直接使用。

---

## 🚀 使用方法

当你想要在编辑前**理解代码**，或在修改后**更新语义地图**时，触发此 Skill：

```text
使用 $code-semantic-sync 检查相关源文件，总结架构，并在编辑后同步语义地图。
```

> 💡 **提示：** 编辑完成后，建议要求重新读取修改过的文件，以确保语义地图保持最新。

---

## 🗂️ 项目结构

```
code-semantic-sync/
├── SKILL.md                          # Skill 操作入口
├── README.md                         # 本文件（中文）
├── README_EN.md                      # 英文版说明
├── agents/
│   └── openai.yaml                   # UI 元数据与标签配置
└── references/
    ├── repo-semantic-map.md          # 本仓库的规范语义地图
    └── semantic-map-template.md      # 可复用的语义地图模板
```

---

## 📝 注意事项

- Markdown 便于浏览和版本管理
- 模板刻意保持**轻量**和**可复用**
- 本仓库**有意保持精简**：文档、元数据和规范语义地图
- 与一次性笔记不同，此 Skill 旨在**每次代码变更时都能复用**
- 目标不是写*更多*文档，而是让**一份可靠的地图始终与代码同步**

---

<div align="center">

### *为那些需要地图，而不仅仅是记忆的代码库而造。*

<br>

<sub>为 <a href="https://openai.com/codex">Codex</a> 而创 · 作为 Skill 包维护 · 码语者.SKILL</sub>

</div>

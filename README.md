<div align="center">

# <img src="https://img.shields.io/badge/🔗-code--semantic--sync-6366f1?style=flat-square&logo=markdown&logoColor=white" alt="code-semantic-sync" height="28"> 

> *把代码读懂，再把理解写回去。*

[![Skill](https://img.shields.io/badge/🤖%20Codex-Skill-8b5cf6?style=flat-square)](SKILL.md)
[![Docs](https://img.shields.io/badge/📝%20Docs-Markdown-3b82f6?style=flat-square)](references/repo-semantic-map.md)
[![Template](https://img.shields.io/badge/📋%20Template-Semantic%20Map-10b981?style=flat-square)](references/semantic-map-template.md)
[![License](https://img.shields.io/badge/License-MIT-f59e0b?style=flat-square)]()

<br>

当你接手一个陌生仓库、改完一段逻辑、或者需要给团队补一份可持续维护的代码地图时，<br>
**`code-semantic-sync`** 会帮助你把"理解代码"与"同步语义"合并成同一套工作流。

<br>

[✨ 特性](#-特性) · [📖 工作流](#-工作流) · [📦 输出物](#-输出物) · [🚀 快速开始](#-快速开始) · [📂 项目结构](#-项目结构)

</div>

---

## ✨ 特性

| 特性 | 说明 |
|------|------|
| 🔄 **并行阅读** | 启动代码工作时并行读取源文件，快速建立上下文 |
| 🗺️ **语义地图** | 将代码结构、函数语义、数据流整理为 Markdown 语义地图 |
| ⚡ **即时同步** | 代码修改后，在同一轮对话中更新语义文档，避免文档过时 |
| 📋 **标准模板** | 提供可复用的语义地图模板，适用于任意仓库 |
| 🤖 **Codex 原生** | 作为 Skill 设计，可直接在 Codex / Kimi Code CLI 中调用 |

---

## 📖 工作流

### 1️⃣ 先阅读

- 🔍 定位相关的源文件
- 📄 尽可能并行读取文件级上下文
- 🎯 深入检查主要模块和类型

### 2️⃣ 再映射

- 🏗️ 先总结整体架构，再深入函数细节
- 📝 记录每个函数或方法的目的、输入、输出、副作用和失败模式
- ✅ 保持文档精确描述**实际行为**，而非仅描述意图

### 3️⃣ 编辑后同步

- 🔄 重新阅读修改过的文件
- ✏️ 在同一轮中更新语义地图
- 📢 反映签名变更、副作用变化和兼容性影响

---

## 📦 输出物

本仓库围绕三个核心制品组织 Skill：

| 文件 | 用途 |
|------|------|
| [`SKILL.md`](SKILL.md) | 操作入口，Codex 调用时的核心指令 |
| [`agents/openai.yaml`](agents/openai.yaml) | UI 元数据，用于 Skill 列表和标签展示 |
| [`references/semantic-map-template.md`](references/semantic-map-template.md) | 语义地图的默认 Markdown 结构模板 |

此外，仓库自身也包含一份规范语义地图：
- [`references/repo-semantic-map.md`](references/repo-semantic-map.md) — 本仓库的自描述语义地图

---

## 🚀 快速开始

### 安装到 Codex

将本 Skill 目录放入你的 Codex skills 位置：

```bash
# 克隆或复制到 skills 目录
git clone <your-repo-url> ~/.codex/skills/code-semantic-sync
```

如果你已经在包含此文件夹的仓库中工作，Skill 可直接从该位置使用。

### 使用示例

在需要理解代码或更新文档时，触发 Skill：

```text
使用 $code-semantic-sync 检查相关源文件，总结架构，并在编辑后同步语义地图。
```

> 💡 **提示**：在改完代码后，建议主动要求 Codex 重新读取修改的文件并更新语义地图，保持文档与代码同步。

---

## 📂 项目结构

```
code-semantic-sync/
├── SKILL.md                          # Skill 操作入口
├── README.md                         # 本文件
├── agents/
│   └── openai.yaml                   # UI 元数据与标签配置
└── references/
    ├── repo-semantic-map.md          # 本仓库的规范语义地图
    └── semantic-map-template.md      # 可复用的语义地图模板
```

---

## 📝 设计原则

- **Markdown 优先** — 保持可读性，便于人工审阅和版本控制
- **模板轻量** — 足够通用，可跨仓库复用
- **仓库即文档** — 本仓库自身保持轻量：文档、元数据和规范语义地图

---

<div align="center">

**Made for codebases that need a map, not just a memory.**

<sub>Created for [Codex](https://openai.com/codex) · Maintained as a skill package</sub>

</div>

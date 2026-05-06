<div align="center">

# 🗺️ CODETALKER.SKILL

> *Read the code first. Then sync the understanding back.*

[![Skill](https://img.shields.io/badge/🤖%20Codex-Skill-8b5cf6?style=flat-square)](SKILL.md)
[![Docs](https://img.shields.io/badge/📝%20Docs-Markdown-3b82f6?style=flat-square)](references/repo-semantic-map.md)
[![Template](https://img.shields.io/badge/📋%20Template-Semantic%20Map-10b981?style=flat-square)](references/semantic-map-template.md)
[![License](https://img.shields.io/badge/License-MIT-f59e0b?style=flat-square)]()

<br>

When you inherit an unfamiliar repo, finish a logic change, or need to give your team a long-term maintainable code map,<br>
**`CODETALKER.SKILL`** merges "understanding code" and "documenting understanding" into a single workflow.

<br>

[What It Does](#-what-it-does) · [Who It Is For](#-who-it-is-for) · [Workflow](#-workflow) · [Install](#-install) · [Usage](#-usage) · [Notes](#-notes)

</div>

---

## 🎯 What It Does

`CODETALKER.SKILL` (`code.semantic.sync`) is a markdown-first skill for building and maintaining a **living semantic map** of a codebase.

In plain terms, it helps you:

| Scenario | Capability |
|----------|------------|
| 🧭 **Understand a repo** | Quickly build code context before editing |
| 🔍 **Capture semantics** | Record actual behavior of functions and methods (inputs, outputs, side effects) |
| 🔄 **Sync docs** | Update the semantic map in the same turn after code changes |
| 🛡️ **Reject staleness** | Prevent notes from drifting away from the code |

If you want a quick mental model:

> Turn *"I think this code works like X"* into *"here is the current map of how it works."*

---

## 👤 Who It Is For

- 👋 People starting work in an unfamiliar repository
- ✏️ People who made a change and want the docs to stay honest
- 🔧 People maintaining a codebase with lots of moving parts
- 🤖 People who want Codex to explain code in a sustainable way

If your first question is *"what does this function really do?"* or *"what changed after this edit?"*, this skill is for you.

---

## 📦 What You Get

Typical outputs include:

- a short **architecture summary**
- a **function-by-function semantic map**
- a list of **side effects**, **data flow**, and **dependencies**
- **updates** to the semantic map after edits

**Example result shape:**

```md
## Architecture
- Main entry: src/index.ts
- Core modules: parser, resolver, emitter

## Functions
- `parseConfig(input)`:
  - input: `string | Buffer`
  - output: `ConfigTree`
  - side effects: none
  - throws: `ParseError` on invalid syntax
```

---

## 🔄 Workflow

### 1️⃣ Read First

> *Never fight unprepared.*

- locate the relevant source files
- read file-level context **in parallel** when possible
- inspect the main modules and types **before changing anything**

### 2️⃣ Map Semantics

> *See the forest before the trees.*

- summarize the **architecture** first
- record each function or method's **purpose**, **inputs**, **outputs**, **side effects**, and **failure modes**
- describe **observed behavior**, not just intention

### 3️⃣ Sync After Edits

> *After the code changes, sync the understanding.*

- **reread** the files you changed
- **update** the semantic map in the same turn
- reflect **signature changes**, **side effects**, and **compatibility impact**

---

## 📂 Outputs

This repository revolves around three core artifacts:

| File | Purpose |
|------|---------|
| [`SKILL.md`](SKILL.md) | operational entrypoint used by Codex |
| [`agents/openai.yaml`](agents/openai.yaml) | UI metadata for skill lists and labels |
| [`references/semantic-map-template.md`](references/semantic-map-template.md) | default markdown structure for semantic maps |

The repository also includes its own canonical semantic map:

- [`references/repo-semantic-map.md`](references/repo-semantic-map.md) — the self-describing map for this repo

---

## ⚡ Install

### Install for Codex

Copy this skill folder into your Codex skills location:

```bash
# clone or copy into your skills directory
git clone <your-repo-url> ~/.codex/skills/code-semantic-sync
```

If the folder is already inside the repo you are working on, you can use it immediately.

---

## 🚀 Usage

Use the skill when you want to **understand code before editing it**, or when you want the **semantic map updated after a change**:

```text
Use $code-semantic-sync to inspect the relevant source files, summarize the architecture, and keep the semantic map synchronized after edits.
```

> 💡 **Tip:** after edits, ask for a reread of the modified files so the map stays current.

---

## 🗂️ Project Structure

```
code-semantic-sync/
├── SKILL.md                          # Skill operational entrypoint
├── README.md                         # This file (Chinese)
├── README_EN.md                      # This file (English)
├── agents/
│   └── openai.yaml                   # UI metadata and label config
└── references/
    ├── repo-semantic-map.md          # Canonical semantic map for this repo
    └── semantic-map-template.md      # Reusable semantic map template
```

---

## 📝 Notes

- Markdown stays easy to scan and version
- The template is intentionally **lightweight** and **reusable**
- The repository stays **small on purpose**: docs, metadata, and the canonical semantic map
- Unlike a one-off note, this skill is meant to be **reused every time the code changes**
- The goal is not to write *more* documentation, but to keep **one reliable map current**

---

<div align="center">

### *Made for codebases that need a map, not just a memory.*

<br>

<sub>Created for <a href="https://openai.com/codex">Codex</a> · Maintained as a skill package · CODETALKER.SKILL</sub>

</div>

# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| **构建入口（跨包）** → [Build & Deploy](../../picsur-backend/backend/build-and-deploy.md) | Angular 构建、`custom-webpack.config.cjs`、Node 版本约束 | ✅ 已填（10-13-handover-baseline） |
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | To fill |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Local state, global state, server state | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Type Safety](./type-safety.md) | Type patterns, validation | To fill |

---

## Pre-Development Checklist（frontend）

- [ ] 构建必须在 **Node 20** 下跑（宿主 Node 22 装不了依赖，`frontend/custom-webpack.config.cjs` 这个
      改动就是被 Node ≥20.19 的 `require(esm)` 行为逼出来的，**不要改回 `.js` + ESM**）。
- [ ] 前端产物由 backend 托管（`PICSUR_STATIC_FRONTEND_ROOT`），构建产物路径必须是 `frontend/dist`。
- [ ] 调 API 时路径看 [Image API Contracts](../../picsur-backend/backend/image-api-contracts.md)：
      `POST` 一律返回 **201**，图片直链必须带扩展名。

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.

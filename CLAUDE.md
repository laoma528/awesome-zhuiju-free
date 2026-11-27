# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个面向中文用户的免费影视资源导航列表（awesome-list 风格）。核心数据存储在 `resources/resources.json`，README.md 由脚本从数据自动生成，不应手动编辑 README 中的精选资源区块。

## 常用命令

所有脚本均为原生 Node.js ESM 模块，**无需 `npm install`**，直接运行：

```bash
# 验证所有 JSON 数据格式合法性
node scripts/validate-data.mjs

# 将 resources.json 中的精选资源同步到 README.md（重建表格）
node scripts/sync-readme.mjs

# 检测所有精选资源的 URL 可访问性，更新 reports/availability.json 和 README
node scripts/check-availability.mjs

# 更新 open_source 类型资源的 GitHub star 数和最近推送时间
GITHUB_TOKEN=<token> node scripts/update-open-source-stats.mjs
```

CI 使用 Node.js 24；本地需 Node.js 18+（使用了原生 `fetch` 和顶层 `await`）。

## 架构与数据流

### 单一数据源

`resources/resources.json` 是所有资源的唯一数据源。README 中 `<!-- featured-resources:start -->` 和 `<!-- featured-resources:end -->` 之间的全部内容，以及 `<!-- resource-count:start/end -->` 徽章，**均由 `scripts/sync-readme.mjs` 自动覆盖**，手动编辑这些区块会在下次 CI 运行时被还原。

### 脚本职责

| 脚本 | 输入 | 输出 |
|---|---|---|
| `sync-readme.mjs` | `resources/resources.json`，`reports/availability.json` | `README.md`（精选区块） |
| `check-availability.mjs` | `resources/resources.json`，`README.md` | `reports/availability.json`，`README.md`（状态标记） |
| `validate-data.mjs` | 全部 JSON 文件 | 仅 stdout 错误报告 |
| `update-open-source-stats.mjs` | `resources/resources.json`（GitHub API） | `resources/resources.json` |

### 自动化流程

- **每日 09:00 (北京时间)**：`check-availability.yml` 依次执行 sync-readme → check-availability → validate-data，提交结果
- **PR / push to main**：`validate-data.yml` 校验数据格式
- **Issue 审核**：维护者在资源推荐 Issue 下评论 `ok` 触发 `issue-to-resource-pr.yml`，自动将资源写入 resources.json 并发布

## resources.json 数据约束

新增或修改资源时必须满足以下规则（`validate-data.mjs` 会检测）：

- `id`：小写字母和数字，以 `-` 分隔，模式 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，全局唯一
- `url`：必须是 HTTPS，`tvbox_config` 类型例外可用 HTTP
- `category`：必须是枚举值之一：`online_video` / `video_app` / `cloud_search` / `magnet_search` / `subtitles` / `player` / `subscription` / `tvbox_config` / `open_source` / `other`
- `scores.*`：`more` / `speed` / `clean` / `stable` / `ease` 均为 1.0–5.0，最多一位小数
- `risks.*`：`copyright` / `safety` / `privacy` / `payment` 枚举值：`low` / `medium` / `high` / `unknown`
- `verification.status`：`pending` / `verified` / `recommended` / `caution` / `temporarily_unavailable` / `removed`
- `featured: true` 的资源必须提供 `summary_short`（40 个字符以内）
- `category: "open_source"` 的资源必须包含 `github.full_name`（`owner/repo` 格式）、`github.stars`（非负整数）、`github.pushed_at`（ISO 时间戳）
- 日期字段格式：`YYYY-MM-DD`

修改 resources.json 后，手动运行 `node scripts/sync-readme.mjs` 可在本地预览 README 变化。

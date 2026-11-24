# dsh-redmark

> 在长对话中为关键轮次添加书签与自定义备注，并从专用面板一键跳回。
> 这是一个 [the agent runtime (DSH)](https://github.com/deepseek-ai/deepseek-harness) 的 **Cordis Web 插件包（bundle）**，不是独立的 Python / Web 服务。

[English](README.md) · [中文](README.zh-CN.md)

[![CI](https://github.com/namei2001/dsh-redmark/actions/workflows/ci.yml/badge.svg)](https://github.com/namei2001/dsh-redmark/actions)
![Version](https://img.shields.io/badge/version-4.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-DSH%20Web%20Bundle-orange)

## 目录

- [它解决什么问题](#它解决什么问题)
- [功能一览](#功能一览)
- [安装与启用](#安装与启用)
- [快速上手](#快速上手)
- [项目结构](#项目结构)
- [跳回与跟随守卫：优化历程](#跳回与跟随守卫优化历程)
- [数据与隐私](#数据与隐私)
- [诊断与排障](#诊断与排障)
- [开发命令](#开发命令)
- [常见问题](#常见问题)
- [安全](#安全)
- [许可证](#许可证)

## 它解决什么问题

长对话滚动成百上千行后，想回到之前某一轮：手动翻找既慢又容易丢失位置。dsh-redmark 让你：

1. 给任意助手回复或选中文本打上书签 + 备注；
2. 从侧栏面板、右栏标签或会话头部的按钮，随时跳回那一轮；
3. 用 `Ctrl/Cmd+F` 在当前会话内查找，并复用同一套精准定位机制跳转。

同时，它修复了一个长期困扰的跟随问题：**流式回复时视图悄悄停止跟随尾部、滑回自己上一条消息**——这背后是 DSH 滚动锚点与书签触发器的布局耦合，详见[优化历程](#跳回与跟随守卫优化历程)。

## 功能一览

| 功能 | 说明 |
| --- | --- |
| 轮次书签 | 在消息工具栏（order 40）为助手回复打点，记录 `turn` / `seq` / 备注 |
| 文本区间书签 | 基于 CSS Custom Highlight API 高亮选区，保存 quote、偏移、前后文 |
| 专用书签面板 | `sidebar.panellist` + 主面板 + 右栏标签，多入口打开 |
| 精准跳回 | 复用 DSH 自身滚动锚点（Plan C）与 TurnNavigator 导航轨，不写伪造滚动事件 |
| 会话内查找 | `Ctrl/Cmd+F` 捕获阶段快捷键，不抢占输入框，支持高亮与逐步导航 |
| 跟随守卫 | 窄条件修复“无意图掉跟随”，尊重读者主动滚动，带 200 次修复上限 |
| 尽力持久化 | `localStorage` 为主，Host `/dsh-redmark` 端点做可选 JSON 镜像 |
| 结构化诊断 | 跳转/守卫指标写入 `dsh-redmark-trace.log`，1 MiB 自动轮转 |

## 安装与启用

本仓库是 DSH 的本地 Cordis bundle，零 npm 依赖。`package.json` 关键字段：

```json
{
  "name": "@local/dsh-redmark",
  "version": "4.0.0",
  "type": "module",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-conversation"]
    }
  }
}
```

- `cordis.patch.yml` 向 DSH 插入 `id: dsh-redmark` / `name: '@local/dsh-redmark'`。
- `immediately: true` 表示 Web 端在会话界面加载时立即注入。
- `client.js` 通过 `window.__ModuleLoader__.load({ id, factory })` 装载；React / React-DOM 由宿主提供。

**本地开发安装（目录联接 / junction）**：把仓库放在工作区后，在 profile 中建立一个指向它的目录联接，DSH 重载即可生效，无需复制安装。开发机上已配置好的联接为：

```text
C:\Users\EDY\.dsh\profiles\desktop\node_modules\@local\dsh-redmark
  → C:\Users\EDY\Documents\deepseek-harness\default-workspace\dsh-redmark
```

如需在另一台机器上重建（把路径替换为你的实际仓库位置，以管理员权限打开 PowerShell）：

```powershell
$repo = "C:\Users\EDY\Documents\deepseek-harness\default-workspace\dsh-redmark"
$link = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\@local\dsh-redmark"
New-Item -ItemType Directory -Force (Split-Path $link)
cmd /c mklink /J "$link" "$repo"
```

随后在 DSH 中重新加载该 bundle（或重启 DSH）即可。

## 快速上手

1. **打点**：在长对话中悬停某条助手消息，点击工具栏的书签按钮（或选中文本后用选区菜单），填写备注并保存（备注 ≤ 2000 字，每会话最多 500 条）。
2. **查看**：点击会话头部的书签按钮、侧栏面板列表中的书签项，或右栏的 `dsh-redmark` 标签打开面板。
3. **跳回**：点击任一条书签，引擎会复用 DSH 的导航轨和滚动锚点，必要时自动加载更早的历史并精确定位到目标轮次。
4. **查找**：聚焦对话后按 `Ctrl/Cmd+F` 打开查找栏，命中的轮次会被高亮，可逐步导航。
5. **导出/恢复**：书签主副本在浏览器 `localStorage`；若 Host 端点可用，还会镜像到 `%USERPROFILE%\.dsh\dsh-redmark.json`（或 `<DSH_HOME>`）。

## 项目结构

本项目是 **JS ESM 的 DSH bundle**，因此 Python 专属条目按 DSH 生态做了等价适配（`pyproject.toml` → `package.json`，`src/your_package/` → 根目录的 `index.js` / `client.js`）：

| 模板条目 | 本项目 | 说明 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | ✅ `.github/workflows/ci.yml` | checkout@v4 + setup-node@20，跑结构检查与测试 |
| `docs/` | ✅ `docs/architecture.md`、`docs/usage.md` | 架构（含跳回机制）与使用/排障文档 |
| `scripts/` | ✅ `scripts/check-bundle.js` | 零依赖清单校验器：文件齐全、manifest 正确、JS 可解析 |
| `src/your_package/` | ✅ `index.js` + `client.js` | Host 半 / Web 半两个入口（DSH bundle 布局） |
| `tests/` | ✅ `test/bundle.test.js`、`test/README.md` | 7 个 `node:test` 用例，守护 bundle 结构契约 |
| `.env.example` | ✅ `.env.example` | 仅列 `DSH_HOME` 等目录变量，**无密钥** |
| `.gitignore` | ✅ `.gitignore` | 忽略运行时 JSON/日志、`.env`、`client.js.bak*` 等 |
| `CHANGELOG.md` | ✅ `CHANGELOG.md` | Keep a Changelog + SemVer，记录优化轮次 |
| `CONTRIBUTING.md` | ✅ `CONTRIBUTING.md` | 开发、守卫修改准则、提交卫生 |
| `LICENSE` | ✅ `LICENSE` | MIT |
| `README.md` | ✅ 英文入口；`README.zh-CN.md` 为中文版 | 项目门面 |
| `pyproject.toml` | ♻️ `package.json` | DSH bundle 清单（name/version/exports/files/dsh） |
| `Dockerfile` | ⭕ 不适用 | 插件运行于 DSH 桌面进程内，无独立容器 |

附加的 bundle 运行文件：`cordis.patch.yml`、`icon.svg`、`locale/en.json`、`locale/zh.json`。

唯一与 Python 模板**不同**的是：本项目的“源码”不在 `src/` 子目录，而是按 Cordis 约定放在根目录（Host 与 Web 两个入口），并且没有 `Dockerfile`（插件不独立部署）。

## 跳回与跟随守卫：优化历程

这部分是本项目经历多轮优化的核心，诊断证据保存在
`%USERPROFILE%\.dsh\dsh-redmark-trace.log`（另有 `.bak-*` 轮转备份）。

**问题一：视图悄悄停止跟随尾部。** 流式回复时 `scrollHeight` 增长，而书签触发器挂载时的布局变化被 DSH 判定为“读者滚动”，于是 `followingTail` 被丢弃，视图滑回用户上一条消息。

- 实测：书签按钮若以 slot 盒挂载进滚动流，每次挂载增加 32–96 px，超过 DSH 的 24 px 跟随容差。修复：把触发器放进工具栏**已预留的 28 px 行**，作为 flex item，不再撑高对话。
- 修复：`startFollowGuard()` 仅在**窄条件全满足**时才重新固定：锚点曾开后关、700 ms 内无读者意图、接近尾部（`gap<600`）、冷却 >1.2 s、且无跳转进行中（`jumpInFlight=false`）。读者主动滚动（`intentless=false`）一律不修复。
- 刻意不做的：不按 gap 修复（空闲固定视图因输入区折叠本就有 ~240 px gap）；不要求 streaming（掉跟随常在挂载后 0.62 s 出现）；修复上限 200 次，超出后不再干预直至重载。

**问题二：跨轮跳转不准 / 抖动。**

- `railTurnOf` 改为读取 `aria-label` 的**末尾数字**——本地化标签里可能含别的数字，整体匹配会让所有跨轮跳转失效。
- 通过 React fiber 找到 `TurnNavigator` 的 `onNavigate(item)` 直接调用，不再点击/滚动导航轨（两个写入源导致抖动）；`jumpViaRail` 全程占用 `jumpInFlight`，避免并发 re-pin 取消 DSH 的待处理跳转。
- `jumpToTurn` 优先 DSH 自身滚动锚点（Plan C，`save(null)` 回到底部、`save(position)` 固定），仅在无 rail 句柄时回退旧分页器；必要时分页加载最多 240 页，再以 48 探针二分滚动视口精准落位。

**诊断样例**（摘自真实 trace，说明机制已生效）：

```
guard: arm growth=0 bm=4 spots=4,-715 rows=431 pinned=true   ← 挂载不撑高
guard drop: gap=300 intentless=true nearTail=true ...        ← 无意图掉跟随
guard: re-pin after intentless drop (gap=300 restore#1)      ← 窄条件修复
reveal align ok=true turn=63 before=... after=...            ← 跳转对齐正确
```

完整机制与判据见 [docs/architecture.md](docs/architecture.md)。

## 数据与隐私

| 数据 | 位置 | 性质 |
| --- | --- | --- |
| 书签主副本 | 浏览器 `localStorage`：`dsh.dsh-redmark.<sessionId>` | 按会话隔离，权威数据 |
| 持久化镜像 | `%USERPROFILE%\.dsh\dsh-redmark.json`（或 `$DSH_HOME`） | 尽力而为，16 MiB 上限；端点不可用也能用 |
| 诊断日志 | `%USERPROFILE%\.dsh\dsh-redmark-trace.log` | 仅结构化指标，1 MiB 轮转 |
| 恢复备份 | `.erased-*`、`*.corrupt`、`*.bak-*` | 擦除/损坏时保护数据 |

- 插件**不读取任何 API Key**，数据只发往同源的 `/dsh-redmark` 路由。
- 宿主端点严格 best-effort：`apply()` 时若 `webServer` 不可用，记录 `dsh-redmark: webServer unavailable, durability mirror disabled` 并继续以 `localStorage` 工作。
- 写入采用临时文件 + `rename` 原子持久化；解析失败改名为 `*.corrupt`，不静默清空。

## 诊断与排障

查看最近日志（完整命令，可直接复制）：

```powershell
Get-Content "$env:USERPROFILE\.dsh\dsh-redmark-trace.log" -Tail 120
```

| 现象 | 看 trace 里的关键字段 | 处理 |
| --- | --- | --- |
| 跳转不准 | `reveal align ok=false` / `no-landing` | 确认 rail 句柄存在、未切换会话 |
| 又出现滑动回退 | `guard drop` 中 `intentless=false` | 属读者主动滚动，守卫正确放行，无需处理 |
| 反复重固定 | 出现 `guard: repair cap reached (200)` | 已自动停止干预，重载 DSH 复位 |
| 镜像未生效 | 日志无 route / `durable=false` | 仅影响跨浏览器恢复，`localStorage` 仍可用 |

详见 [docs/usage.md](docs/usage.md) 的“读取诊断日志”。

## 开发命令

本环境 Node 不一定在 `PATH`，使用内置 Node（v24.x）。以下命令均可直接复制粘贴（路径按开发机实际值）：

```powershell
$node = "C:\Users\EDY\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
$proj = "C:\Users\EDY\Documents\deepseek-harness\default-workspace\dsh-redmark"

& $node --check "$proj\client.js"
& $node --check "$proj\index.js"
& $node "$proj\scripts\check-bundle.js"
& $node --test --experimental-test-isolation=none "$proj\test\bundle.test.js"
```

预期输出：

```
Bundle check OK: @local/dsh-redmark@4.0.0
# 7 tests passed
```

> `--experimental-test-isolation=none` 仅 DSH 沙箱需要：默认测试隔离的子进程 spawn 会被沙箱以 `Error: spawn EPERM` 拒绝。普通 CI（`node --test test/*.test.js`）不需要该参数。

CI（GitHub Actions, Node 20）在推送/PR 时自动执行 `scripts/check-bundle.js` 与 `node --test test/*.test.js`。

## 常见问题

**Q：为什么没有 `pyproject.toml` / `src/` / `Dockerfile`？**
A：这是 DSH Cordis **JS bundle**，不是 Python 服务。等价物是 `package.json`、根目录 `index.js`/`client.js`；插件运行在 DSH 桌面进程内，不需要容器。

**Q：删了 trace 日志会丢书签吗？**
A：不会。书签在 `localStorage`（+ 可选 JSON 镜像），日志只用于诊断。

**Q：换浏览器后书签还在吗？**
A：`localStorage` 不跨浏览器；若 Host 端点可用，镜像 JSON 可辅助恢复。不要把 JSON 当作唯一副本。

## 安全

- `.env.example` 只含目录变量，禁止填入任何密钥。
- 路由做同源校验（`sec-fetch-site` / `origin`）；记录服务端清洗，备注/文本有长度上限。
- 诊断 swallow 所有失败，绝不因日志中断功能；日志不含对话正文或密钥。
- 不要在仓库提交 `dsh-redmark.json`、trace 日志、`.env` 或 `client.js.bak*`。

## 许可证

MIT — 见 [LICENSE](LICENSE)。

# Changelog

本仓库是上游 [dsh-startup-screen](https://github.com/6shenhonghong9/dsh-startup-screen)
（作者：沈宏宏，MIT）的 **DSH Desktop 适配版**。以下记录本仓库的变更；
上游 1.1.x 的 web / 桌面基础适配不再重复记录。

## 1.2.0 — 2026-10-19

首个对外开源版本（DSH Desktop 适配）。相对上游 1.1.1 的改动：

### 修复

- **桌面端首屏黑屏**：渲染器子资源（`splash.js` / `splash.css` / `*.mp3`）会被
  `connection.requestRejection()` 的 401 拦掉。现在带
  `x-dsh-desktop-renderer` 令牌的请求直接放行（第一道 `DesktopWebServer.permits()`
  已经校验过令牌，不构成绕过）。
- **安装器 `--uninstall` 崩溃**：`desktop/install-desktop.mjs` 的 `uninstall()`
  引用了已删除的 `rmrf`，改为容错删除 + 回退清理。

### 新增

- `interactionTimeout` 交互等待上限（秒，默认 `20`，`0` = 无限等待）：第 1、2 步
  没人点按钮时自动继续，桌面端冷启动不会永远停在黑幕；超时/清理均安全。
- 素材路由改为 `ETag` + `Cache-Control: no-cache`，命中 `If-None-Match` 返回 `304`，
  换素材后渲染进程不再缓存一整天。
- `desktop/install-desktop.mjs`：零依赖自包含安装器，支持 `--check` / `--uninstall` /
  `--profile` / `--bridge`；校验 8 个音频素材的 git blob 哈希；只追加
  `dsh.profile.bundles`，**不改 profile `dependencies`**（避免触发 pnpm 依赖迁移）；
  读取 profile JSON 时容错 UTF-8 BOM（Windows 记事本 / PowerShell 写出的文件常见）。
- `desktop/audit-desktop.mjs`：隔离兼容性审计（真实 cordis `Context` + 真实 `WebServer`，
  临时端口，不影响运行中的 DSH），共 58 项断言，含设置页分区契约与仓库隐私清洁度；
  DSH 内核模块路径自动探测（可用环境变量 `DSH_APP_MODULES` 覆盖）。
- 文档：`DESKTOP-ADAPT.md`（宿主机制 / 改动原理 / 安装 / 审计 / 排错）、
  `DESKTOP.md`（安装速查）。

### 变更

- 动画左栏文案 `REV 0.1.0 · WEB PROFILE` → `REV 0.1.0 · DESKTOP PROFILE`。
- 渲染器半侧自举：新增 `isDesktopRenderer()` 判定；同源请求带 `credentials: 'same-origin'`；
  桌面端取不到配置时立即放弃自举，不再空等 9 秒兜底。
- 配置默认值补充 `interactionTimeout: 20`（范围 0 – 300 秒）。
- 安装目录不进入 profile `dependencies`，桌面端启动时 `desktopBundleList()` 会保留
  手动追加的第三方 bundle，不会被清掉。

## 1.1.1 — 上游版本（基线）

上游完成的基础桌面端适配：`lib/index.js` 在取不到 webServer 时只告警、跳过路由注册；
`lib/client.js` 支持渲染器半侧自举；index 注入携带 `__DSH_STARTUP_BOOT__` 标记。
本仓库在此基础上继续做上述桌面端强化。

## 1.0.0 — 上游版本

首个 web profile 发布。

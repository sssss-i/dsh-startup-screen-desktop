# 桌面端（DSH Desktop）适配说明

> 上游 `dsh-startup-screen` 是面向 **web profile** 写的：靠 `dsh plugin --profile web add` 安装、
> 靠 webServer 的 `tapIndex` 注入、靠浏览器 cookie 过 `connection` 鉴权。
> 本文档记录把它改造成 **DSH Desktop 2.0.17（内核 `@deepseek-ai/dsh` 0.2.0-rc.2）** 插件时，
> 「网页版专属」的部分都换成了什么，以及为什么这么换。

## 1. 桌面端宿主机制（改造依据）

桌面端不是另一个宿主，而是「Electron 壳 + 完整 dsh host + `DesktopWebServer`」：

- `DesktopWebServer extends WebServer`（`dsh-plugin-desktop/webserver`），**保留 `tapIndex` 与 `register`**，
  所以宿主半侧照常往 `index.html` 注入首屏，路由也照常注册；
- 但 `DesktopWebServer` 在 `register/registerFallback/registerUpgrade` 外面包了一层 **`permits(request)`**：
  只认渲染进程带的 `x-dsh-desktop-renderer` 令牌（32 字节 base64url，形如 `/^[A-Za-z0-9_-]{43}$/`），
  否则 403。这是**第一道栅栏**；
- 插件路由的 handler 里还会被 `connection.requestRejection(request)` 检查一次：
  跨站 403、未认证 401。这是**第二道栅栏**（web 版靠浏览器 cookie 过，桌面渲染进程不一定带 cookie）；
- `dsh.client.platform` 必须保持字符串 `"web"`（`dsh-client-modules/lib/index.js:714`：
  `if (decl === void 0 || decl.platform !== "web") return null`），桌面端与 web 端共用该字段，
  **不能改成 `"desktop"`**；
- 设置面板的 `settings.section` **list 槽**由 `@deepseek-ai/dsh-client-ui-settings-general`
  声明（`lib/client.js` 里 `"settings.section": { kind: "list", scope: "root" }`；分区列表来自
  `slots.entries('settings.section')` 按 `order` 排序，标题经 `resolveSlotLabel()` 解析）。
  本插件 `lib/client.js` 用标准写法注册分区 `{ id: 'startup-screen', order: 26, label: '启动动画' }`，
  所以**桌面端设置页里的「启动动画」分区一直保留**，动画与设置界面都不依赖 profile 补丁；
- 注意：`%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml` 里 `ui-settings` 的
  `config: { enabled: false }` **不是设置面板开关**，它只是「开发者工具」偏好
  （`dsh-client-ui-settings/lib/index.js:10`：`const Config = z.object({ enabled: DeveloperToolsSettingsFields['enabled'].volatile() })`）。
  设成 `false` 既不会隐藏设置页，也不影响启动动画。

## 2. 与上游 web 版的差异（本次改造）

### 2.1 渲染器令牌放行第二道栅栏（`lib/index.js`）

桌面端渲染进程的 CSS / JS / MP3 子资源请求即使过了 `permits`（第一道栅栏），
仍可能在 `connection.requestRejection`（第二道）被 401——结果是首屏注入成功、子资源 404/401，
**画面直接黑屏**。

改法：`rejected()` 开头判断请求头

```js
const RENDERER_HEADER = 'x-dsh-desktop-renderer'
function isRendererRequest(req) {
  const v = req.headers && req.headers[RENDERER_HEADER]
  return typeof v === 'string' && v.length > 0
}
```

带该头直接返回 `false`（放行）。**安全性**：handler 能被执行说明 `DesktopWebServer.register`
外层的 `permits()` 已经校验过该令牌，这里放行不会绕过第一道栅栏；
不带该头的请求（普通浏览器）仍走原来的 403/401 逻辑。

### 2.2 素材缓存策略：ETag + no-cache（`lib/index.js`）

上游给 `/dsh-startup/asset/*` 发 `Cache-Control: public, max-age=86400`。
桌面端渲染进程会缓存 24 小时，**改了素材/换装后短时间看不到效果**，也很难判断是不是插件没生效。

改法：改为 `Cache-Control: no-cache` + 内容 `ETag`（由字节数与 mtime 组成），
命中 `If-None-Match` 返回 `304`。既省流量又保证「文件一变就刷新」。

### 2.3 交互超时兜底 `interactionTimeout`（`lib/index.js` + `lib/splash.js`）

上游 `waitAction()`（第 1、2 步等用户点确认）是**无限等待**。web 上刷新即可，
桌面端冷启动时用户看到的是「黑幕 + 一个等待确认」，不点时永远不结束。

改法：新增配置 `interactionTimeout`（秒，默认 `20`，`0` = 无限等待）：

```js
var limit = typeof C.interactionTimeout === 'number' ? C.interactionTimeout : 20
if (limit > 0) {
  timer = setTimeout(function () { timer = 0; fin() }, limit * 1000)
  timers.push(timer)
}
```

超时自动继续下一步；cleanup 时清掉定时器，不会误触发后续步骤。

### 2.4 客户端自举的桌面端判定（`lib/client.js`）

桌面端正常情况下走 `index` 注入（`__DSH_STARTUP_BOOT__ === 'index'`），
但 Electron 有 `file://` + IPC 的加载方式，兜底自举仍需保留。改动：

- 新增 `isDesktopRenderer()`（`process.versions.electron` 或 UA 含 `Electron/`）；
- 自举取配置改为 `fetch(API, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })`；
- `if (!r.ok) throw` —— 桌面端取不到配置时**直接放弃自举**，不再空等 9 秒兜底；
  浏览器端仍回落到默认配置。

### 2.5 同源素材请求带凭据（`lib/splash.js`）

`fetchAssetBytes()` 对同源 URL（以 `/` 开头）加 `{ credentials: 'same-origin' }`，
跨域 CDN（jsDelivr）不带凭据。桌面端第二道栅栏需要凭据时才不会被 401 拦掉。

### 2.6 文案改为桌面端（`lib/splash.js`）

左栏小字由 `REV 0.1.0 · WEB PROFILE` 改为 `REV 0.1.0 · DESKTOP PROFILE`。

### 2.7 音频素材三级回退（`lib/index.js`，沿用上一版适配）

1. `lib/assets/<name>.mp3`（随包安装，最快）；
2. `lib/assets/<name>.mp3.b64`（或分片 `<name>.mp3.b64.1` / `.2` …，去 `\n` 后 base64 解码）；
3. 惰性镜像下载（jsDelivr 的 cdn / fastly / gcore 三个节点 + gh-proxy，5 秒超时、校验
   `ID3` / `0xFFEx` 魔数），缓存到 `%USERPROFILE%\.dsh\dsh-startup-assets\<name>`，下次直接命中。
   镜像指向的是**上游仓库** `6shenhonghong9/dsh-startup-screen` 的 `lib/assets/`（素材随上游 MIT 发布）。

三级都拿不到返回 404，前端再兜一层 CDN 直连；仍失败才回落系统 TTS / 现场合成音效，
**不影响动画播放**。宿主 `apply()` 后 1.5 秒会预热缺失素材，离线时静默失败。

### 2.8 设置页 / 配置文件

- 插件自带配置接口 `/dsh-startup/config`（GET 读、POST 写、`action:'reset'` 重置）；
- 落盘位置：`%USERPROFILE%\.dsh\dsh-startup.json`（独立于 dsh-settings）；
- 每次请求现读配置，改完 json 刷新页面即生效，**不需要重启**；
- 设置页由 `@deepseek-ai/dsh-client-ui-settings-general` 提供；本插件在其中注册
  「启动动画」分区（`id: startup-screen`、`order: 26`），打开 **设置 → 启动动画** 即可实时改；
  不方便开设置页时，也可以直接改 json 或调 `POST /dsh-startup/config`。

## 3. 安装（Windows / 无网络环境）

### 一键安装（推荐）

```bash
node desktop/install-desktop.mjs
```

脚本做三件事：

1. **自包含**地把 `lib/`、`package.json`、`cordis.patch.yml`、`LICENSE`、`README.md`、`DESKTOP-ADAPT.md`
   复制进 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-startup-screen\`（20 个文件，含 8 个 mp3）；
2. 校验 8 个 mp3 的 git blob 哈希与上游一致；
3. 把 `"dsh-startup-screen"` 追加进 profile `package.json` 的 `dsh.profile.bundles`
   （先备份为 `package.json.before-dsh-startup-screen`；**不动 `dependencies`**，避免触发 pnpm 依赖迁移）。

参数：`--profile <目录>` 指定 profile；`--check` 只体检；`--uninstall` 卸载。

**装完必须完全退出 DSH Desktop（含托盘进程）再重新打开**——宿主半侧在启动时加载。

### 手工安装

1. 完全退出 DSH Desktop；
2. 把 `lib/`、`package.json`、`cordis.patch.yml`、`LICENSE`、`README.md`、`DESKTOP-ADAPT.md`
   复制到 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-startup-screen\`；
3. 在 `%USERPROFILE%\.dsh\profiles\desktop\package.json` 的 `dsh.profile.bundles` 末尾追加 `"dsh-startup-screen"`；
4. 重新打开 DSH Desktop。

> 桌面端启动时 `desktopBundleList()` 会重算 bundles：`[...内置必备项, ...其余第三方项]`，
> 手动追加的第三方项会被保留，不会被清掉。

### 卸载

```bash
node desktop/install-desktop.mjs --uninstall
```

或手工：从 `dsh.profile.bundles` 删掉该项，再删除 `node_modules\dsh-startup-screen\`。

## 4. 验证

安装位置可用隔离审计脚本验证（真实 cordis `Context` + 真实 `WebServer`，不碰运行中的 DSH）：

```bash
node desktop/audit-desktop.mjs
# 或审计已安装副本：
node desktop/audit-desktop.mjs "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-startup-screen"
```

**58/58 PASS**，覆盖：

- 插件以 cordis 插件形式装载不炸，只新增 4 条路由 + 1 个 index tap，未抢 fallback、未注册 upgrade；
- index 注入 8 项（黑幕容器位置、critical CSS、splash.css/js、BOOT 标记、配置对象、`#root` 保留）；
- 文案下发为 `DESKTOP PROFILE`（且不含旧的 `WEB PROFILE`）；
- 素材 200 / `audio/mpeg` / 41317 字节 / `ID3` 魔数，5 种路径穿越名全部 404；
- **渲染器令牌请求绕过 connection 栅栏（200）**、无令牌被拦（401）；
- asset 返回 `ETag` + `no-cache`，`If-None-Match` 命中 `304`；
- `defaults.interactionTimeout === 20`，`splash.js` 含超时兜底代码；
- **设置页「启动动画」分区契约**：`dsh.client.platform === 'web'`、inject 含 ui-settings、
  注册 `settings.section`（`id: startup-screen` / `order: 26` / `label: '启动动画'`），
  且桌面端 `ui-settings-general` 确实以 list 槽收集并渲染该分区；
- 仓库隐私清洁度：无本机绝对路径、无调试日志、README 注明上游来源与许可；
- `fiber.dispose()` 后路由 / tap 全部移除并回落到宿主 fallback。

手工探测：`http://127.0.0.1:<port>/dsh-startup/splash.js`
—— 浏览器直接打开返回 `401/403` 属**正常**（没带渲染器令牌，两道栅栏都该拦）；
`404` 才是没装成。真正的判定看桌面端窗口是否出现开机动画。

## 5. 已知坑

| 现象 | 原因 / 处理 |
| --- | --- |
| 桌面端起不来 / 白屏 | profile `dsh.profile.bundles` 里列了包但 `node_modules` 下找不到可解析入口，`loadRecoveryFilteredProfile` 会抛错。删掉该 bundle 项再启动。 |
| 有动画但没声音 | 素材 404（查 `lib/assets/*.mp3`）或自动播放策略需一次交互；前端已回落 TTS。 |
| 改了素材却没变化 | 确认 `Cache-Control: no-cache` + ETag 还在（旧版 `max-age=86400` 会让渲染进程缓存一天）。 |
| 首屏黑屏、Console 里子资源 401 | `isRendererRequest()` 放行逻辑被删了，或第一道栅栏没放行；检查 `x-dsh-desktop-renderer` 处理。 |
| 黑幕停在第一步不动 | `requireInteraction: true` 且 `interactionTimeout: 0`；点确认或把超时调成 ≥8。 |
| 设置页没有「启动动画」 | ① 装完没重启；② profile `dsh.profile.bundles` 里没有本插件（`node desktop/install-desktop.mjs --check`）；③ 渲染进程 Console 有 `[dsh-startup-screen]` 报错。`ui-settings` 的 `config.enabled: false` 与此无关（那只是开发者工具偏好）。 |
| 装了却不播 | `%USERPROFILE%\.dsh\dsh-startup.json` 里 `enabled: false`，或 `mode` 为 `session`/`day` 且本轮已播过（清 `sessionStorage` / `localStorage` 的 `dsh-startup-screen:*`）。 |
| 后来用插件管理 UI 装了别的插件，本插件消失 | 本包不在 profile `dependencies` 里（刻意如此，避免触发 pnpm 依赖迁移），某次 `pnpm install` 可能当 extraneous 清掉。重跑 `node desktop/install-desktop.mjs`。 |

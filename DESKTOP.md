# 桌面端（DSH Desktop）安装速查

更完整的改造说明、机制与排错见 [DESKTOP-ADAPT.md](./DESKTOP-ADAPT.md)。

## 安装

```bash
node desktop/install-desktop.mjs            # 装到默认 desktop profile
node desktop/install-desktop.mjs --check    # 只体检
node desktop/install-desktop.mjs --uninstall
```

装完**完全退出 DSH Desktop（含托盘进程）再重新打开**，启动动画即生效。

## 自检

```bash
node desktop/audit-desktop.mjs            # 隔离审计（真实 cordis Context + WebServer，58 项）
node desktop/install-desktop.mjs --check  # 体检已安装副本（文件 / 素材哈希 / bundles）
```

审计脚本会自动探测本机 DSH Desktop 内核模块目录；自定义安装路径时用环境变量
`DSH_APP_MODULES` 指向 `<DSH 安装目录>\resources\app\node_modules\@deepseek-ai`。

`install-desktop.mjs` 不依赖 git / pnpm / 外网：它把 `lib/`、`package.json`、
`cordis.patch.yml`、`LICENSE`、`README.md`、`DESKTOP-ADAPT.md` 整体复制进
`%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-startup-screen\`，
再把 `"dsh-startup-screen"` 追加进该 profile `package.json` 的 `dsh.profile.bundles`。

> 上游文档里的 `dsh plugin --profile desktop add …` 在受限网络下会失败（要 `git ls-remote` + pnpm），
> 本仓库改用纯文件安装，效果等价。

## 生效判定

- 打开桌面端应看到六幕开机动画（访问许可 → 身份确认 → … → 欢迎访问）；
- DevTools Console：`window.__DSH_STARTUP_BOOT__ === "index"` 表示宿主已注入首屏；
- 手工请求 `http://127.0.0.1:<port>/dsh-startup/splash.js`：返回 `401/403` 是**正常的**
  （普通浏览器没有渲染器令牌，两道栅栏都该拦），`404` 才是没装成。

## 与 web profile 的关系

同一份代码，`dsh.client.platform` 保持 `"web"`（桌面端与 web 端共用该取值）；
桌面端额外做了渲染器令牌放行、素材 ETag/no-cache、交互超时兜底等改动，
详见 [DESKTOP-ADAPT.md](./DESKTOP-ADAPT.md)。

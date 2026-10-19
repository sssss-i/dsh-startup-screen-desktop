# dsh-startup-screen · DSH Desktop 启动动画

<p align="center">
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Platform" src="https://img.shields.io/badge/DSH%20Desktop-2.0.17%2B-ff7500">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-339933">
  <img alt="Dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen">
</p>

DSH Desktop（DeepSeek Harness 桌面端）的启动界面插件：冷启动时先播一段可交互的「开机动画」——
黑幕 DeepSeek 标识 → 过曝洗白 → 暖白「技术档案」底板 → 五步访问授权 → 色散故障揭幕。

> 本仓库是社区维护的 **DSH Desktop 适配版**，基于上游
> [6shenhonghong9/dsh-startup-screen](https://github.com/6shenhonghong9/dsh-startup-screen)（MIT）改造。
> 桌面端专属改动、宿主机制与排错见 [DESKTOP-ADAPT.md](./DESKTOP-ADAPT.md)，
> 安装速查见 [DESKTOP.md](./DESKTOP.md)，版本变更见 [CHANGELOG.md](./CHANGELOG.md)。

```bash
node desktop/install-desktop.mjs   # 一条命令装进桌面端 profile，零依赖、无需外网
```

---

## 播放序列

| # | 中文主字 | 英文副标题 | 需要操作 |
|---|---|---|---|
| 1 | 需要访问许可 | `ACCESS PERMISSION REQUIRED` | 点按钮 / 按 Enter / 空格 |
| 2 | 身份资料确认 | `IDENTITY VERIFICATION` | 点按钮 / 按 Enter / 空格 |
| 3 | 接收访问需求 | `ACCESS REQUEST RECEIVED` | 自动 |
| 4 | 开始读取权限 | `PERMISSION READ STARTED` | 自动 |
| 5 | 读取完毕 · 核验通过 | `READ COMPLETE · VERIFIED` | 自动 |
| 6 | 欢迎「身份名称」访问 | `WELCOME, NAME` | 自动 |

中央一圈环形准星缓慢自转，缺口留在正下方，不挡底部文字。

## 功能

**可交互，不是播片**　第一、二步要点击按钮或按 Enter 才会继续（可在设置里关掉）；
右上角有跳过按钮，Esc 也能跳。

**中文主字 + 英文等宽副标题**　英文副标题逐字打出，像终端在接收数据。

**真声素材 + 界面音效**　台词与终幕欢迎语为真声素材，界面「哒」声取自同一段录音；
也可切换系统 TTS 与现场合成音效。

**语音没播完不会推进**　每一步停留多久由实际音频时长决定，点得快也不会把语音掐断。

**三十余项实时设置**　身份名称、编号、权限等级、主题、速度、音色、语速、开口留白、
每处文案……都能在 **DSH 设置页 →「启动动画」** 里改，改完立即生效。

**桌面端可用性兜底**　交互等待默认 20 秒超时（`0` = 无限等待），冷启动不会卡在黑幕；
音频缺失时按「包内素材 → base64 分片 → 镜像下载 → 系统 TTS / 合成音效」逐级回退。

---

## 安装

### 桌面端（推荐）

```bash
node desktop/install-desktop.mjs
```

脚本把插件**自包含**地安装到当前用户的桌面端 profile
（`%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-startup-screen\`），
并把 `dsh-startup-screen` 追加进该 profile `package.json` 的 `dsh.profile.bundles`。
不依赖 git / pnpm / 外网，不改 DSH 内核文件。

| 参数 | 作用 |
|---|---|
| （无） | 自包含安装（默认 desktop profile） |
| `--profile <目录>` | 安装到指定 profile |
| `--check` | 只体检，不写任何文件 |
| `--uninstall` | 卸载（移出 bundles + 清掉包目录） |

**装完完全退出 DSH Desktop（含托盘进程）再重新打开**，启动动画即生效。

<details>
<summary>手工安装（无法运行脚本时）</summary>

1. 完全退出 DSH Desktop（含托盘进程）；
2. 把本仓库的 `lib/`、`package.json`、`cordis.patch.yml`、`LICENSE`、`README.md`、
   `DESKTOP-ADAPT.md`、`DESKTOP.md` 复制到
   `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-startup-screen\`；
3. 在 `%USERPROFILE%\.dsh\profiles\desktop\package.json` 的 `dsh.profile.bundles`
   数组末尾追加 `"dsh-startup-screen"`；
4. 重新打开 DSH Desktop。

</details>

### 环境要求

| 项 | 要求 |
|---|---|
| 平台 | DSH **Desktop** 2.0.17+（内核 `@deepseek-ai/dsh` 0.2.0-rc.2）；web profile 亦可 |
| 系统 | Windows 10/11（已在 Windows 实测；macOS / Linux 未验证） |
| Node | **>= 20**（仅 `desktop/*.mjs` 安装与审计脚本需要） |
| 依赖 | 无（不需要 `npm install`） |

### 升级 / 卸载

```bash
node desktop/install-desktop.mjs            # 覆盖升级（保留 profile 其余配置）
node desktop/install-desktop.mjs --uninstall
```

### web profile（可选）

同一份代码也适用于 `dsh web`（上游原本的目标平台）：

```bash
dsh plugin --profile web add ./dsh-startup-screen-1.2.0.tgz   # 先 npm pack 打包
dsh plugin --profile web remove dsh-startup-screen
```

装完重启 `dsh web`；设置页里同样会出现「启动动画」。

---

## 上传到 GitHub

本仓库已按开源项目整理好（`README` / `LICENSE` / `CHANGELOG` / `.gitignore` /
`.gitattributes` / 自检脚本），可直接建仓推送：

```bash
git init -b main
git add .
git commit -m "feat: DSH Desktop 启动动画插件（桌面端适配版 1.2.0）"
git remote add origin https://github.com/<你的用户名>/dsh-startup-screen-desktop.git
git push -u origin main
```

需要注意：

- **仓库名可以随便取**（例如 `dsh-startup-screen-desktop`）；插件包名固定为
  `dsh-startup-screen`，安装脚本按包名工作，与仓库名无关。
- 上传后建议回填 `package.json` 的 `repository` / `homepage` / `bugs` 字段
  （本仓库刻意留空，避免写出错误仓库或死链）。
- `node_modules/`、`*.log`、`*.tgz`、`.install-mode.json` 已被 `.gitignore` 排除，
  不会误提交；音频素材是上游仓库的 MIT 素材，已在上文「来源与致谢」注明。
- 推送前可跑一遍自检：`node desktop/audit-desktop.mjs`（58 项，全部通过再发布）。

---

## 设置选项

装好后进入 **DSH 设置页 →「启动动画」**。

> 设置页由 `@deepseek-ai/dsh-client-ui-settings-general` 提供，本插件在其中注册
> 「启动动画」分区（`id: startup-screen`、`order: 26`）。它与 profile 补丁里的
> `ui-settings` `config.enabled` 无关（那只是「开发者工具」偏好）。
> 若没看到分区：确认已重启、profile `dsh.profile.bundles` 含本插件
> （`node desktop/install-desktop.mjs --check`）。
> 不想开设置页时，可直接改 `%USERPROFILE%\.dsh\dsh-startup.json`
> （每次请求现读，刷新即生效），或对 `GET/POST http://127.0.0.1:<port>/dsh-startup/config`
> 读写同一份配置。

### 播放

| 选项 | 默认 | 作用 |
|---|---|---|
| 启用 | 开 | 总开关，关掉就完全不播 |
| 显示模式 | 每次会话 | `每次会话` 一个会话播一次 / `总是` 每次刷新都播 / `每天` 一天一次 |
| 主题 | 暖白 | `暖白` 参考片原色 / `暗色` 暗底板 |
| 速度 | 1× | 整段动画的快慢，0.35 – 3 倍 |
| 要求确认 | 开 | 第 1、2 步是否等你点按钮才继续 |
| 交互等待上限 | 20 s | 第 1、2 步最多等多久；超时自动继续，`0` = 无限等待 |
| 允许跳过 | 开 | 是否显示右上角跳过按钮、是否响应 Esc |

### 身份资料

| 选项 | 默认 | 作用 |
|---|---|---|
| 身份名称 | `JOYCE MOORE` | 终幕「欢迎 xxx 访问」里的名字 |
| 身份编号 | `0087` | 第二步身份卡上的编号，建议填数字 |
| 权限等级 | `3` | 第二步身份卡上的权限等级 |

### 语音

| 选项 | 默认 | 作用 |
|---|---|---|
| 语音播报 | 开 | 是否念台词 |
| 语音来源 | 真声素材 | `真声素材` 用内置录音 / `系统 TTS` 用浏览器合成音 |
| 音色 | 自动 | 只在用系统 TTS 时有效。留空 = 自动挑一个女声 |
| 语速 | 0.88 | 只在用系统 TTS 时有效。越慢越有旁白感 |
| 音调 | 0.85 | 只在用系统 TTS 时有效。调低更沉稳，1.0 以上会像客服播报 |
| 音量 | 0.9 | 台词音量 |
| 播报前提示音 | 开 | 念台词前先响两声轻提示，更像系统播报 |
| 开口前留白 | 240 ms | 提示音响过之后停多久再开口，0 – 1200 ms |

### 界面音效

| 选项 | 默认 | 作用 |
|---|---|---|
| 界面音效 | 开 | 文字出现、阶段推进、按钮确认的「哒」声 |
| 音效音量 | 0.5 | 界面音效音量（不影响台词） |
| 音效来源 | 内置素材 | `内置素材` 用录音 / `现场合成` 用代码合成 |

### 视觉

| 选项 | 默认 | 作用 |
|---|---|---|
| 强调色 | `#ff7500` | 阶段条、进度条、准星的橙 |
| 故障色 A / B | `#ff3b30` / `#2971b8` | 揭幕那下色散故障的红与蓝 |

### 文案

| 选项 | 默认 | 作用 |
|---|---|---|
| 品牌三行 | `DEEPSEEK` / `SYNTHESIZE INTELLIGENCE` / `HARNESS OS` | 左上角品牌块 |
| 黑幕三行 | `深度求索` / `DEEPSEEK` / `DEEPSEEK HARNESS` | 开场黑幕上的字 |
| 终幕方框 | `DEEPSEEK HARNESS` | 揭幕后中央的黑底白字框 |
| 页脚 | `POWERED BY DEEPSEEK` | 右下角页脚 |

---

## 工作原理（简述）

- **Host 半侧**（`lib/index.js`）：以 cordis 插件形式挂载，往宿主 `index.html` 注入
  黑幕容器 / 关键 CSS / bootstrap 脚本，并注册 4 条路由：`/dsh-startup/splash.js`、
  `/dsh-startup/splash.css`、`/dsh-startup/asset/*`、`/dsh-startup/config`；
- **两道栅栏**：桌面端 `DesktopWebServer.permits()` 只认渲染进程令牌（`x-dsh-desktop-renderer`），
  过了它还有 `connection.requestRejection()` 的 403/401 检查——插件对带令牌的渲染器请求直接放行，
  避免子资源被 401 拦成黑屏（细节见 `DESKTOP-ADAPT.md`）；
- **渲染器半侧**（`lib/client.js`）：注册设置页分区；宿主注入不生效时自建容器自举播放；
- **配置**：独立于 `dsh-settings`，落盘 `%USERPROFILE%\.dsh\dsh-startup.json`，接口每次现读；
- **素材**：随包 `lib/assets/*.mp3` 优先，其次 `*.b64` 分片，再次 jsDelivr / gh-proxy 镜像下载
  （缓存到 `%USERPROFILE%\.dsh\dsh-startup-assets\`），最后回退 TTS / 合成音效。

## 目录结构

```
dsh-startup-screen/
├── lib/
│   ├── index.js          # Host 半侧：路由、index 注入、配置 API、素材下发
│   ├── client.js         # 渲染器半侧：自举 + 设置页「启动动画」分区
│   ├── splash.js         # 动画引擎（六幕、打字机、音频、交互）
│   ├── splash.css        # 动画样式
│   └── assets/           # 8 个真声素材（6 句台词 + 2 个界面音效）
├── desktop/
│   ├── install-desktop.mjs   # 自包含安装器（零依赖，支持 --check / --uninstall）
│   └── audit-desktop.mjs     # 隔离兼容性审计（真实 cordis Context + WebServer）
├── cordis.patch.yml      # bundle patch：把 Host 半侧挂进 profile 配置树
├── package.json
├── README.md / DESKTOP-ADAPT.md / DESKTOP.md / CHANGELOG.md / LICENSE
```

## 自检 / 开发

不需要 `npm install`。仓库自带隔离审计脚本：**真实 cordis `Context` + 真实 `WebServer`**，
在临时端口上以 profile bundle 的方式装载插件，不触碰正在运行的 DSH：

```bash
node desktop/audit-desktop.mjs            # 审计本仓库，58 项断言
node desktop/audit-desktop.mjs "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-startup-screen"
node desktop/install-desktop.mjs --check  # 体检已安装副本（文件、素材哈希、bundles）
```

`audit-desktop.mjs` 会自动探测本机 DSH Desktop 的内核模块目录；自定义安装路径时用
`DSH_APP_MODULES` 指定，例如：

```powershell
$env:DSH_APP_MODULES = "D:\Apps\DSH Desktop\resources\app\node_modules\@deepseek-ai"
```

审计覆盖：插件装载不炸、只新增自己的 4 条路由 + 1 个 index tap、index 注入 8 项、
文案与素材、路径穿越拒绝、渲染器令牌穿过两道栅栏、ETag/304、`interactionTimeout` 兜底、
设置页分区契约、卸载后完全回退，以及仓库隐私清洁度（无本机绝对路径、无调试日志）。

## 兼容性

| 项 | 值 |
|---|---|
| DSH Desktop | 2.0.17（内核 `@deepseek-ai/dsh` 0.2.0-rc.2）实测通过 |
| 客户端模块声明 | `dsh.client.platform` 必须保持 `"web"`（桌面端与 Web 共用，不能改 `"desktop"`） |
| 安装方式 | 纯文件自包含，不改内核、不动 profile `dependencies`（避开 pnpm 依赖迁移） |
| 卸载 | `--uninstall` 或手工移出 bundles + 删除包目录，宿主不受影响 |

## 已知限制

- **素材版权**：动画视觉风格与音频素材参照/取自第三方作品，权利归原权利人；仅供学习交流，
  详见下方免责声明。
- **镜像回退依赖上游仓库**：jsDelivr / gh-proxy 镜像指向的是上游仓库的 `lib/assets/`，
  上游若变更或删除，镜像回退会失效（包内素材与本地缓存不受影响）。
- **插件管理 UI 可能清理本包**：本仓库刻意不写入 profile `dependencies`（避免触发 pnpm
  依赖迁移），某些插件管理操作可能把它当 extra 清掉，重跑安装脚本即可恢复。
- **macOS / Linux 未实测**：host 半侧取不到 webServer 时会跳过路由并交由渲染器半侧自举，
  逻辑上通用，但未在非 Windows 环境验证。

## 来源与致谢

- 上游项目：[6shenhonghong9/dsh-startup-screen](https://github.com/6shenhonghong9/dsh-startup-screen)，
  作者 **沈宏宏**，MIT License；
- 本仓库的桌面端适配改动：渲染器令牌放行、素材 ETag/no-cache、`interactionTimeout` 兜底、
  渲染器半侧自举判定、`DESKTOP PROFILE` 文案、自包含安装器与隔离审计等，详见
  [CHANGELOG.md](./CHANGELOG.md) 与 [DESKTOP-ADAPT.md](./DESKTOP-ADAPT.md)。

## 免责声明

**一、仅供学习交流。** 本项目为个人学习与娱乐性质的开源插件，不用于任何商业目的。

**二、第三方素材权利。** 本项目的视觉风格参考自动画作品，音频素材（人声与音效）
取自第三方视频，相关权利均归原权利人所有。本项目不对上述风格与素材主张任何权利，
亦未获得任何形式的授权或背书。

**三、二次创作风险自担。** 任何人基于本项目进行修改、改编、翻译、再分发等二次创作，
由此产生的侵权、纠纷或任何法律责任，均由该行为人自行承担，与本项目作者无关。

**四、商业使用风险自担。** 本项目**未授权任何商业用途**。若将本项目或其衍生作品
用于商业行为（包括但不限于售卖、付费分发、商业产品集成、商业宣传、商业演示），
由此引发的知识产权纠纷与全部法律责任，由使用者自行承担，作者不承担任何责任。

**五、许可范围。** 本项目的开源许可仅覆盖作者原创的代码与文案，
**不覆盖**上述第三方风格与素材。使用者在再利用第三方内容时，应自行取得相应授权。

**六、权利主张。** 若权利人认为本项目侵犯了其合法权益，请联系作者，
作者将在核实后立即移除相关内容。

## License

MIT © 沈宏宏（原版作者）  
桌面端适配改动 © dsh-startup-screen desktop fork contributors，同样以 MIT 发布。

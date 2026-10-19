/* ============================================================================
 * dsh-startup-screen — Host 半侧（Desktop 版）
 * ----------------------------------------------------------------------------
 * 做三件事：
 *   1) 在 index.html 里注入「启动界面」：首屏兜底黑幕 + 关键 CSS + 配置 + 运行时
 *   2) 提供 /dsh-startup/splash.css · splash.js · asset/*.mp3 · config 四个路由
 *   3) 把配置持久化到 ~/.dsh/dsh-startup.json（设置页经 /dsh-startup/config 读写）
 *
 * 运行载体：DeepSeek Harness Desktop（Electron 渲染器 + 本地 127.0.0.1 服务）。
 * 桌面端的 HTTP 载体是 `dsh-plugin-desktop/webserver` 的 `DesktopWebServer`
 * （extends `WebServer`），它在 `register`/`registerFallback`/`registerUpgrade`
 * 外面各包了一层 `permits(request)` 令牌校验，只有带 `x-dsh-desktop-renderer`
 * 头的 Electron 渲染器才放行；普通浏览器请求一律 403。因此：
 *   · 本插件的静态资源必须能被**渲染器**取到（走 `permits` 的第一分支）；
 *   · 不需要、也不能假设存在“可被任意网页访问”的公开端口。
 *
 * 双通道容错：桌面端若改用 `file://` + IPC 下发前端，就没有 `webServer`
 * 可注册路由，此时 Host 半侧静默跳过，交给 `lib/client.js` 自举。
 *
 * 说明：配置刻意不走 settings 命名空间，而是自带一份 JSON + 自带设置面板
 * （与 dsh-meme 同款做法），这样不受 dsh-settings 版本变更影响。
 * ========================================================================== */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_FILE = path.join(DSH_HOME, 'dsh-startup.json')

const NS = 'dsh-startup-screen'
const ROUTE_BASE = '/dsh-startup'

/** 插件版本：读自己的 package.json，避免源码与版本号两处各写一份。
    读不到就退回占位符（设置页会显示它，不会显示 undefined）。 */
const PLUGIN_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    const v = String(pkg.version || '').trim()
    return v || '0.0.0'
  } catch (err) {
    return '0.0.0'
  }
})()

/** 默认配置：字段与 lib/splash.js 的 DEFAULTS 一一对应。 */
const DEFAULTS = {
  enabled: true,
  mode: 'session',            // always | session | daily
  theme: 'light',             // light | dark
  speed: 1,
  requireInteraction: true,
  interactionTimeout: 20,     // 交互等待上限（秒）；0 = 无限等待
  allowSkip: true,
  sound: true,                // 界面音效（WebAudio 合成，无音频文件）
  soundVolume: 0.5,
  voice: true,                // 女声播报（Web Speech API）
  voiceLang: 'en',            // en | zh | both
  voiceName: '',              // '' = 自动挑（按分数优先神经网络女声）
  voiceRate: 0.88,            // 电影旁白档：比朗读慢，字与字之间才有重量
  voicePitch: 0.85,           // 压低音调，深沉的 AI 女声
  voiceVolume: 0.9,
  voiceCue: true,             // 念台词前的一声轻提示
  sfx: 'audio',               // 音效来源：audio=lib/assets 里的真素材 / synth=现场合成
  voiceSource: 'asset',       // 语音来源：asset=优先用真声素材（拿不到自动回落 TTS）/ tts=全 TTS
  voiceLead: 240,             // 提示音之后留一小段空白再开口
  identity: 'JOYCE MOORE',    // ← 设置页里可改的「身份名称」
  identityId: '0087',
  accessLevel: '3',
  brand1: 'DEEPSEEK',
  brand2: 'SYNTHESIZE INTELLIGENCE',
  brand3a: 'HARNESS',
  brand3b: 'OS',
  orgZh: '深度求索',
  orgEn: 'DEEPSEEK',
  orgSub: 'DEEPSEEK HARNESS',
  welcomeBox: 'DEEPSEEK HARNESS',
  footer: 'POWERED BY DEEPSEEK',
  accent: '#ff7500',
  glitchA: '#ff3b30',
  glitchB: '#2971b8'
}

const TEXT_KEYS = [
  'identity', 'identityId', 'accessLevel',
  'brand1', 'brand2', 'brand3a', 'brand3b',
  'orgZh', 'orgEn', 'orgSub', 'welcomeBox', 'footer', 'voiceName'
]
const COLOR_KEYS = ['accent', 'glitchA', 'glitchB']
const ENUMS = {
  mode: ['always', 'session', 'daily'],
  theme: ['light', 'dark'],
  voiceLang: ['en', 'zh', 'both'],
  sfx: ['audio', 'synth'],
  voiceSource: ['asset', 'tts']
}
const BOOL_KEYS = ['enabled', 'requireInteraction', 'allowSkip', 'sound', 'voice', 'voiceCue']
/** 数值字段的合法区间（越界即夹取）。 */
const RANGES = {
  speed: [0.35, 3],
  interactionTimeout: [0, 300],
  soundVolume: [0, 1],
  voiceRate: [0.5, 2],
  voiceLead: [0, 1200],
  voicePitch: [0, 2],
  voiceVolume: [0, 1]
}

function normalize(input) {
  const out = { ...DEFAULTS }
  const src = input && typeof input === 'object' ? input : {}
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in src) || src[key] === undefined || src[key] === null) continue
    const value = src[key]
    if (BOOL_KEYS.includes(key)) {
      out[key] = value === true || value === 'true' || value === 1 || value === '1'
    } else if (ENUMS[key]) {
      out[key] = ENUMS[key].includes(value) ? value : DEFAULTS[key]
    } else if (key === 'speed' || RANGES[key]) {
      const [lo, hi] = RANGES[key] || RANGES.speed
      const n = Number(value)
      out[key] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : DEFAULTS[key]
    } else if (COLOR_KEYS.includes(key)) {
      const s = String(value).trim()
      out[key] = /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : DEFAULTS[key]
    } else if (TEXT_KEYS.includes(key)) {
      out[key] = String(value).slice(0, 64)
    } else {
      out[key] = value
    }
  }
  if (!String(out.identity).trim()) out.identity = DEFAULTS.identity
  if (!String(out.identityId).trim()) {
    out.identityId = String(out.identity).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  }
  if (!String(out.identityId).trim()) out.identityId = 'OPERATOR'
  return out
}

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
    return normalize(JSON.parse(raw))
  } catch (err) {
    return { ...DEFAULTS }
  }
}

function writeConfig(next) {
  const cfg = normalize(next)
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  const tmp = CONFIG_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8')
  fs.renameSync(tmp, CONFIG_FILE)
  return cfg
}

/** 静态文件按 mtime 缓存，改完插件刷新页面即生效。 */
function makeReader(rel) {
  let cache = null
  return function read() {
    const file = path.join(PACKAGE_ROOT, rel)
    try {
      const st = fs.statSync(file)
      if (!cache || cache.mtimeMs !== st.mtimeMs) {
        cache = { mtimeMs: st.mtimeMs, text: fs.readFileSync(file, 'utf8') }
      }
      return cache.text
    } catch (err) {
      return ''
    }
  }
}

const readSplashCss = makeReader('lib/splash.css')
const readSplashJs = makeReader('lib/splash.js')

/** 内联脚本里绝对不能出现 `</script>`。 */
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '')
}

/** 首屏兜底：在应用挂载前先把窗口盖住，避免闪出界面本体。 */
const CRITICAL_CSS = [
  'html.dsu-lock,html.dsu-lock body{overflow:hidden!important}',
  '#dsh-startup-root.dsu-boot{position:fixed;inset:0;z-index:2147483000;background:#000}'
].join('')

const BOOTSTRAP_JS = `(function(){try{
var c=window.__DSH_STARTUP__||{};
var root=document.getElementById('dsh-startup-root');
var off=!c.enabled;
if(!off&&c.mode==='session'&&sessionStorage.getItem('dsh-startup-screen:shown')==='1')off=true;
if(!off&&c.mode==='daily'&&localStorage.getItem('dsh-startup-screen:day')===new Date().toISOString().slice(0,10))off=true;
if(off){window.__DSH_STARTUP_SKIP__=true;if(root&&root.parentNode)root.parentNode.removeChild(root);}
else{document.documentElement.classList.add('dsu-lock');/* 兜底：连 splash.js 都没跑起来（404/被拦/语法错）时，9 秒后无条件放行，绝不锁黑屏 */setTimeout(function(){try{var r=document.getElementById('dsh-startup-root');if(r&&r.className&&r.className.indexOf('dsu-boot')!==-1){if(r.parentNode)r.parentNode.removeChild(r);document.documentElement.classList.remove('dsu-lock');if(document.body)document.body.style.overflow='';window.__DSH_STARTUP_FAILED__=true;}}catch(e){}},9000);}
}catch(e){} })()`

const name = NS

/**
 * 只对 `webServer` 是硬依赖：没有它就注册不了路由，插件应当安静地不生效。
 *
 * `connection`（桌面端 = `@deepseek-ai/dsh-client-connection`）刻意**不**放进
 * inject —— 它在 `rejected()` 里本身就是可选的：取不到就当“无栅栏”放行。
 * 写进 inject 会把它变成硬门槛，一旦某个 profile 没有 `connection`（精简组合、
 * 纯 IPC 下发前端、服务名被替换等），cordis 会静默挂起整颗 fiber：路由与首屏
 * 注入全部消失，看起来“装了却没反应”，且没有任何报错。
 *
 * 桌面端确实提供 `connection`（`requestRejection()` → Host/Origin 栅栏 +
 * 浏览器认证，未认证返回 401），所以取得到就照常过一遍；但它是**第二道**
 * 栅栏 —— 第一道是 `DesktopWebServer.permits()` 的渲染器令牌，在
 * `register()` 内部就已经执行。两道都过才真正回内容。
 */
const inject = ['webServer']

/**
 * 取得 HTTP 载体服务。
 *
 * 桌面端挂的是 `dsh-plugin-desktop/webserver` → `DesktopWebServer extends WebServer`，
 * 有 `register`/`tapIndex`，与 web profile 行为一致，只是多了 `permits()` 令牌校验。
 * 若哪天 Electron 改成 `file://` + IPC 直接下发前端（`dsh-host-webserver` 的注释
 * 就写着 "Electron uses file:// plus IPC instead"），这里取不到 webServer，
 * 本插件不该把一颗 fiber 炸掉 —— 交给 `lib/client.js` 的 selfBoot。
 */
function resolveWebServer(ctx) {
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    if (viaGet) return viaGet
  } catch (err) { /* 取不到就当没有 */ }
  return ctx.webServer
}

function hasRoutes(server) {
  return !!server && typeof server.register === 'function' && typeof server.tapIndex === 'function'
}

function apply(ctx) {
  const disposers = []
  const webServer = resolveWebServer(ctx)

  /** 没有可注册路由的 HTTP 载体：桌面端若走 IPC 下发前端就是这种形态。
      什么都不注册（plugin 仍然 APPLIED，不报错），页面由客户端半侧自举。 */
  if (!hasRoutes(webServer)) {
    try {
      ctx.logger?.warn?.(
        '[' + NS + '] 当前 profile 没有可用的 webServer（桌面端可能用 file:// + IPC 下发前端）；' +
        'Host 半侧跳过路由与首屏注入，改由渲染器半侧自举启动界面。'
      )
    } catch (err) { /* 日志失败不影响加载 */ }
    return
  }

  /**
   * 渲染器令牌判定（桌面端专用）。
   *
   * `DesktopWebServer.permits()` 已经在校验 `x-dsh-desktop-renderer`，且它的
   * `register()` 会在调我们的 handler **之前**就把非法请求 403 掉，所以正常
   * 路径下走到这里一定是合法渲染器。但有两种情况需要我们自己认一遍：
   *   1) 宿主换成别的 WebServer 实现（无 `permits`），此时没有第一道栅栏；
   *   2) 桌面端把 `ordinaryBrowserEnabled` 打开，普通浏览器也能进 —— 那种
   *      情况下 `connection.requestRejection()` 会对**子资源**返回 401，
   *      把 splash.css / splash.js / mp3 全部拦掉，启动界面直接黑屏。
   *
   * 所以：只要请求带了渲染器头，就认为它已被第一道栅栏认证过，跳过第二道；
   * 没带头的请求（真浏览器 / 命令行）再走 `connection` 栅栏。
   */
  const RENDERER_HEADER = 'x-dsh-desktop-renderer'

  function isRendererRequest(req) {
    try {
      const headers = req && req.headers
      if (!headers) return false
      const value = headers[RENDERER_HEADER]
      return typeof value === 'string' && value.length > 0
    } catch (err) {
      return false
    }
  }

  /** 浏览器信任栅栏：自定义路由必须过一遍，否则可被任意网页读写。
      渲染器请求已过 `DesktopWebServer.permits()`，这里不再重复计票。 */
  function rejected(req, res) {
    try {
      if (isRendererRequest(req)) return false
      const conn = (typeof ctx.get === 'function' ? ctx.get('connection') : undefined) || ctx.connection
      if (!conn || typeof conn.requestRejection !== 'function') return false
      const code = conn.requestRejection(req)
      if (code === undefined || code === null || code === false) return false
      res.statusCode = typeof code === 'number' ? code : 403
      res.end()
      return true
    } catch (err) {
      return false
    }
  }

  function registerRoute(route) {
    const inner = route && route.handler
    const wrapped = Object.assign({}, route, {
      handler: async (req, res) => {
        if (rejected(req, res)) return
        return inner(req, res)
      }
    })
    return webServer.register(wrapped)
  }

  function sendJson(res, code, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length)
    })
    res.end(body)
  }

  function readBody(req, limit = 64 * 1024) {
    return new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > limit) {
          req.destroy()
          resolve('')
          return
        }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', () => resolve(''))
    })
  }

  function sendText(res, type, text) {
    const body = Buffer.from(text, 'utf8')
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length)
    })
    res.end(body)
  }

  disposers.push(registerRoute({
    kind: 'exact',
    path: ROUTE_BASE + '/splash.css',
    handler: (req, res) => sendText(res, 'text/css; charset=utf-8', readSplashCss())
  }))

  disposers.push(registerRoute({
    kind: 'exact',
    path: ROUTE_BASE + '/splash.js',
    handler: (req, res) => sendText(res, 'application/javascript; charset=utf-8', readSplashJs())
  }))

  /* 音频素材：从用户提供的音轨里抠出来的音效（选项/确认音）。
     只读、白名单、不含子路径 —— 杜绝目录穿越。素材缺失时浏览器会自动回落到合成音。 */
  /* 桌面端适配：素材来源三级回退 —— 本地 mp3 → 本地 base64 文本 → 镜像下载并缓存。
     镜像下载是惰性的（只有真缺素材时才发生），离线/代理不可达时静默跳过。
     每级都用「字节数 + mp3 魔数」校验，损坏/半截素材会被跳过并自动落到下一级。 */
  const MIRROR_BASES = [
    'https://cdn.jsdelivr.net/gh/6shenhonghong9/dsh-startup-screen@main/lib/assets/',
    'https://fastly.jsdelivr.net/gh/6shenhonghong9/dsh-startup-screen@main/lib/assets/',
    'https://gcore.jsdelivr.net/gh/6shenhonghong9/dsh-startup-screen@main/lib/assets/',
    'https://gh-proxy.com/https://raw.githubusercontent.com/6shenhonghong9/dsh-startup-screen/main/lib/assets/'
  ]
  const ASSET_CACHE_DIR = path.join(DSH_HOME, 'dsh-startup-assets')
  /* 上游素材的权威字节数（GitHub contents API 的 size 字段），用于校验是否完整 */
  const ASSET_SIZES = {
    'line-1.mp3': 41317,
    'line-2.mp3': 25121,
    'line-3.mp3': 23554,
    'line-4.mp3': 25644,
    'line-5.mp3': 36093,
    'line-6.mp3': 13105,
    'sfx-tick.mp3': 2133,
    'sfx-ticks-run.mp3': 10493
  }

  function looksLikeMp3(bytes) {
    if (!bytes || bytes.length < 256) return false
    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true  /* ID3 */
    return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
  }

  /** 素材是否可用：魔数对 + （已知期望大小时）字节数必须一致。 */
  function isGoodAsset(name, bytes) {
    if (!looksLikeMp3(bytes)) return false
    const expected = ASSET_SIZES[name]
    return expected ? bytes.length === expected : true
  }

  function readAssetFile(name) {
    try {
      const bytes = fs.readFileSync(path.join(PACKAGE_ROOT, 'lib', 'assets', name))
      if (isGoodAsset(name, bytes)) return bytes
    } catch (err) { /* 落回下一级 */ }
    return null
  }

  /** 素材文件的 mtime（毫秒），用于 ETag；取不到时退化成 0（= 稳定 ETag）。 */
  function assetMtime(name) {
    try {
      return Math.floor(fs.statSync(path.join(PACKAGE_ROOT, 'lib', 'assets', name)).mtimeMs)
    } catch (err) {
      try {
        return Math.floor(fs.statSync(path.join(ASSET_CACHE_DIR, name)).mtimeMs)
      } catch (err2) {
        return 0
      }
    }
  }

  function readAssetBase64(name) {
    try {
      const dir = path.join(PACKAGE_ROOT, 'lib', 'assets')
      const parts = fs.readdirSync(dir)
        .filter((entry) => entry === name + '.b64' || entry.startsWith(name + '.b64.'))
        .sort()
      const text = parts.map((entry) => fs.readFileSync(path.join(dir, entry), 'utf8')).join('')
        .replace(/\\n/g, '')
        .replace(/\s+/g, '')
      const bytes = text ? Buffer.from(text, 'base64') : null
      return isGoodAsset(name, bytes) ? bytes : null
    } catch (err) {
      return null
    }
  }

  const mirrorPending = new Map()

  async function fetchMirrorOnce(name) {
    const cache = path.join(ASSET_CACHE_DIR, name)
    try {
      const bytes = fs.readFileSync(cache)
      if (isGoodAsset(name, bytes)) return bytes
    } catch (err) { /* 未缓存 */ }
    for (const base of MIRROR_BASES) {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 6000)
        const response = await fetch(base + name, { signal: controller.signal })
        clearTimeout(timer)
        if (!response.ok) continue
        const bytes = Buffer.from(await response.arrayBuffer())
        if (!isGoodAsset(name, bytes)) continue
        try {
          fs.mkdirSync(ASSET_CACHE_DIR, { recursive: true })
          fs.writeFileSync(cache, bytes)
        } catch (err) { /* 缓存失败不影响本次返回 */ }
        return bytes
      } catch (err) { /* 离线：跳过这个镜像 */ }
    }
    return null
  }

  /** 同一素材并发请求只下载一次；预热与首播不会互相重复拉流。 */
  function readAssetFromMirror(name) {
    if (mirrorPending.has(name)) return mirrorPending.get(name)
    const pending = fetchMirrorOnce(name).finally(() => mirrorPending.delete(name))
    mirrorPending.set(name, pending)
    return pending
  }

  disposers.push(registerRoute({
    kind: 'prefix',
    path: ROUTE_BASE + '/asset',
    handler: async (req, res) => {
      const name = path.basename(decodeURIComponent((req.url || '').split('?')[0]))
      if (!/^[a-z0-9._-]+\.mp3$/i.test(name) || name.includes('..')) {
        res.writeHead(404); res.end(); return
      }
      const bytes = readAssetFile(name) || readAssetBase64(name) || await readAssetFromMirror(name)
      if (!bytes || !bytes.length) { res.writeHead(404); res.end(); return }
      /* 桌面端是本地 127.0.0.1 回环 + 单机单用户，按 mtime 出 ETag 即可：
         换素材刷新就生效，同一次启动内命中 304 不重复传输。
         原 web 版的 `public, max-age=86400` 会让 Electron 渲染器把旧素材
         缓存一整天，改完素材看不见变化。 */
      const etag = '"' + bytes.length.toString(16) + '-' + assetMtime(name).toString(16) + '"'
      const inm = req.headers['if-none-match']
      if (inm && inm === etag) {
        res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' })
        res.end()
        return
      }
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-cache',
        ETag: etag,
        'Content-Length': String(bytes.length)
      })
      res.end(bytes)
    }
  }))

  disposers.push(registerRoute({
    kind: 'exact',
    path: ROUTE_BASE + '/config',
    handler: async (req, res) => {
      const method = (req.method || 'GET').toUpperCase()
      if (method === 'GET') {
        sendJson(res, 200, { ok: true, version: PLUGIN_VERSION, config: readConfig(), defaults: DEFAULTS, file: CONFIG_FILE })
        return
      }
      if (method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const text = await readBody(req)
      let payload = {}
      try {
        payload = text ? JSON.parse(text) : {}
      } catch (err) {
        sendJson(res, 400, { ok: false, error: 'invalid json' })
        return
      }
      try {
        if (payload && payload.action === 'reset') {
          const cfgNow = writeConfig(DEFAULTS)
          sendJson(res, 200, { ok: true, version: PLUGIN_VERSION, config: cfgNow, defaults: DEFAULTS })
          return
        }
        const current = readConfig()
        const patch = payload && typeof payload.patch === 'object' && payload.patch ? payload.patch : payload
        const cfgNow = writeConfig({ ...current, ...patch })
        sendJson(res, 200, { ok: true, version: PLUGIN_VERSION, config: cfgNow, defaults: DEFAULTS })
      } catch (err) {
        sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
      }
    }
  }))

  disposers.push(webServer.tapIndex((html) => {
    if (!html || html.includes(ROUTE_BASE + '/splash.js')) return html
    const cfg = readConfig()
    const head =
      '<link rel="stylesheet" href="' + ROUTE_BASE + '/splash.css">' +
      '<style id="dsh-startup-critical">' + CRITICAL_CSS + '</style>'
    const body =
      '<div id="dsh-startup-root" class="dsu-root dsu-boot"></div>' +
      '<script>window.__DSH_STARTUP_BOOT__="index";window.__DSH_STARTUP_VERSION__=' + safeJson(PLUGIN_VERSION) + ';window.__DSH_STARTUP__=' + safeJson(cfg) + ';' + BOOTSTRAP_JS + '</script>' +
      '<script defer src="' + ROUTE_BASE + '/splash.js"></script>'

    let out = html
    if (out.includes('</head>')) out = out.replace('</head>', head + '</head>')
    else out = head + out
    if (out.includes('<body>')) out = out.replace('<body>', '<body>' + body)
    else if (out.includes('</body>')) out = out.replace('</body>', body + '</body>')
    else out = out + body
    return out
  }))

  /* 桌面端适配：预热 —— 宿主有网时提前把缺失的音频素材补进缓存，首播不用等下载；
     离线时每个镜像最多 6 秒超时、静默失败，不会阻塞启动。 */
  const prewarm = setTimeout(() => {
    for (const asset of Object.keys(ASSET_SIZES)) {
      if (readAssetFile(asset) || readAssetBase64(asset)) continue
      readAssetFromMirror(asset).catch(() => {})
    }
  }, 1500)
  disposers.push(() => clearTimeout(prewarm))

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try { dispose() } catch (err) { /* noop */ }
    }
  })
}

/* 导出形状对齐 DSH 内部插件（如 dsh-host-open-in-app）：
   只给具名 name / inject / apply。
   两点刻意不做：
   1) 不导出 default —— cordis-plugin-loader 的 unwrapExports 是
      `exports.default ?? exports`，一旦有 default 就只认 default，
      两边都写反而多一个"改一处忘一处"的坑；
   2) 不导出 Config —— Cordis 约定 Config 是 schemastery schema，
      我这份只是普通默认值对象，当 schema 用会炸。本插件也不吃 profile 配置。 */
export { apply, inject, name }

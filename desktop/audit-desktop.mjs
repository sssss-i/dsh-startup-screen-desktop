/* 桌面端隔离兼容性审计：真实 cordis Context + 真实 WebServer 服务 +
   插件按 profile bundle 的同一路径（.dsh.bundle.patch）加载。
   证明「以插件形式」加载时，插件确实通过 cordis 生命周期注册路由、注入 index、
   通过桌面端两道栅栏（DesktopWebServer.permits / connection），
   且宿主路由/fallback/upgrade 不受影响，卸载后完全回退。

   用法：
     node desktop/audit-desktop.mjs                              # 审计本仓库
     node desktop/audit-desktop.mjs "%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-startup-screen"
   环境变量：
     DSH_APP_MODULES  DSH 内核模块目录（默认自动探测 DSH Desktop 安装位置，
                       探测不到时按下面的提示手动指定） */
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'

/* 探测 DSH Desktop 的内核模块目录（<安装目录>/resources/app/node_modules/@deepseek-ai）。
   不写死本机路径：依次尝试环境变量、Windows 常见安装位置，仍找不到就给出明确指引。 */
function resolveAppModules() {
  const candidates = [process.env.DSH_APP_MODULES]
  if (process.platform === 'win32') {
    for (const base of [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]) {
      if (!base) continue
      candidates.push(path.join(base, 'Programs', 'DSH Desktop', 'resources', 'app', 'node_modules', '@deepseek-ai'))
      candidates.push(path.join(base, 'DSH Desktop', 'resources', 'app', 'node_modules', '@deepseek-ai'))
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai')
  } else {
    candidates.push('/opt/DSH Desktop/resources/app/node_modules/@deepseek-ai')
  }
  const found = candidates.find((p) => {
    if (!p) return false
    try { return fs.existsSync(path.join(p, 'cordis', 'lib', 'index.js')) } catch { return false }
  })
  if (found) return found
  console.error('✗ 找不到 DSH 内核模块目录（cordis / dsh-host-webserver 所在处）。')
  console.error('  请设置环境变量 DSH_APP_MODULES 指向 <DSH Desktop 安装目录>/resources/app/node_modules/@deepseek-ai')
  console.error('  例如：$env:DSH_APP_MODULES = "D:\\Apps\\DSH Desktop\\resources\\app\\node_modules\\@deepseek-ai"')
  process.exit(1)
}

const APP = resolveAppModules()
const PLUGIN = process.argv[2]
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (rel) => import(pathToFileURL(path.join(APP, rel)).href)

const { Context } = await imp('cordis/lib/index.js')
const { WebServer } = await imp('dsh-host-webserver/lib/index.js')

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const root = new Context()
/* 提供与桌面端一致的 webServer 服务（端口 0 = 系统分配，避免撞 43120） */
root.plugin(WebServer, { host: '127.0.0.1', port: 0, compression: 'none' })
for (let i = 0; i < 100 && !root.get('webServer'); i++) await sleep(20)
const server = root.get('webServer')
check('webServer 服务就绪', !!server && !!server.port, `port=${server && server.port}`)
const port = server.port

/* 宿主自己的路由 + fallback（模拟 dsh-web-app 的 dist 下发） */
const hostDisposers = []
hostDisposers.push(server.register({ kind: 'exact', path: '/host/heartbeat', handler: (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('host-ok') } }))
hostDisposers.push(server.registerFallback((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(server.renderIndex('<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>'))
}))
const exactBefore = server.exact.size, prefixBefore = server.prefixes.size, tapsBefore = server.indexTaps.length

/* —— 按 profile bundle 方式加载插件：读 package.json 的 dsh.bundle.patch，解析 insert 行 —— */
/* 容错 UTF-8 BOM（Windows 工具常给 JSON 加 BOM，直接 JSON.parse 会抛 Unexpected token） */
const readJsonFile = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const pkg = readJsonFile(path.join(PLUGIN, 'package.json'))
check('插件 package.json 声明 dsh.bundle.patch', !!pkg.dsh?.bundle?.patch)
const patchFile = path.join(PLUGIN, pkg.dsh.bundle.patch)
check('cordis.patch.yml 存在', fs.existsSync(patchFile), pkg.dsh.bundle.patch)
const patch = fs.readFileSync(patchFile, 'utf8')
check('patch 只有 insert 行（不破坏宿主配置树）', /^\s*-\s*insert:/m.test(patch) && !/^\s*-\s*(?:remove|update|config):/m.test(patch))

/* insert 的 name 必须能按 profile 的 node_modules 解析到插件自身 */
const m = patch.match(/name:\s*(\S+)/)
const entryName = m ? m[1] : pkg.name
check('patch 的插件名与包名一致', entryName === pkg.name || entryName === PLUGIN, entryName)

const pluginModule = await import(pathToFileURL(path.join(PLUGIN, 'lib/index.js')).href)
check('插件导出 apply/inject/name', typeof pluginModule.apply === 'function' && Array.isArray(pluginModule.inject) && typeof pluginModule.name === 'string', `inject=${JSON.stringify(pluginModule.inject)}`)

/* 用 cordis 正常装载：注入依赖不满足时插件不会被 apply（这本身就是「不影响 DSH」的保证） */
const fiber = root.plugin(pluginModule)
await fiber
const fiberActive = fiber && !fiber.disposed
check('插件以 cordis 插件形式挂载（未炸）', fiberActive !== false, `disposed=${fiber && fiber.disposed}`)

const get = (p, opts = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET', ...opts }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
  })
  req.on('error', reject)
  req.end()
})

/* 1. 宿主未受影响 */
let r = await get('/host/heartbeat')
check('宿主路由仍然正常', r.status === 200 && r.body.toString() === 'host-ok', `${r.status} ${r.body.toString()}`)
check('插件只增加自己的路由', (server.exact.size - exactBefore) + (server.prefixes.size - prefixBefore) === 4, `+${(server.exact.size - exactBefore) + (server.prefixes.size - prefixBefore)}`)
check('插件只增加 1 个 index tap', server.indexTaps.length - tapsBefore === 1, `+${server.indexTaps.length - tapsBefore}`)
check('插件未抢 fallback', typeof server.fallback === 'function')
check('插件未注册 upgrade', server.upgrades.size === 0)

/* 2. index 注入 */
r = await get('/')
const html = r.body.toString()
check('index 返回 200', r.status === 200, String(r.status))
check('注入黑幕容器', html.includes('id="dsh-startup-root"'))
check('注入 critical CSS', html.includes('dsh-startup-critical'))
check('注入 splash.css', html.includes('/dsh-startup/splash.css'))
check('注入 bootstrap 标记', html.includes('__DSH_STARTUP_BOOT__'))
check('注入 splash.js defer', html.includes('defer src="/dsh-startup/splash.js"'))
check('宿主挂载点 #root 保留', html.includes('id="root"'))
check('注入位于 head 内', html.indexOf('dsh-startup-critical') < html.indexOf('</head>'))
/* 黑幕容器必须出现在 <head> 之后（不能塞进 head）、且早于宿主 #root，保证首帧就被盖住 */
check('黑幕容器在 head 之后且先于 #root', html.indexOf('id="dsh-startup-root"') > html.indexOf('</head>') && html.indexOf('id="dsh-startup-root"') < html.indexOf('id="root"'), `splash=${html.indexOf('id="dsh-startup-root"')} root=${html.indexOf('id="root"')}`)

/* 3. 路由 */
r = await get('/dsh-startup/splash.js')
const splashLen = r.body.length
check('splash.js 200 且非空', r.status === 200 && splashLen > 10000, `${r.status} ${splashLen}B`)
check('splash.js MIME 正确', /javascript/.test(r.headers['content-type'] || ''), r.headers['content-type'])
/* 实际下发给浏览器的字节里，左栏小字必须是 DESKTOP PROFILE */
const splashText = r.body.toString('utf8')
check('下发文案为 DESKTOP PROFILE', splashText.includes('DESKTOP PROFILE') && !splashText.includes('WEB PROFILE'),
  (splashText.split('\n').find((l) => l.includes('PROFILE')) || '').trim())
r = await get('/dsh-startup/splash.css')
check('splash.css 200 且 MIME 正确', r.status === 200 && /css/.test(r.headers['content-type'] || ''), `${r.status} ${r.headers['content-type']}`)
r = await get('/dsh-startup/config')
let cfg = null; try { cfg = JSON.parse(r.body.toString()) } catch {}
check('config 返回合法 JSON', r.status === 200 && !!cfg, String(r.status))
check('config 含 defaults', !!cfg?.defaults?.identity, cfg?.defaults?.identity)

/* 4. 音频：真素材 + 白名单 */
r = await get('/dsh-startup/asset/line-1.mp3')
check('asset 200 audio/mpeg', r.status === 200 && r.headers['content-type'] === 'audio/mpeg', `${r.status}`)
check('asset 字节数=上游 41317', r.body.length === 41317, String(r.body.length))
check('asset 是 ID3', r.body[0] === 0x49 && r.body[1] === 0x44 && r.body[2] === 0x33)
for (const bad of ['..%2Fpackage.json', '..%2f..%2fpackage.json', 'line-1.txt', 'x.js', '%2e%2e%2fpackage.json']) {
  r = await get('/dsh-startup/asset/' + bad)
  check(`拒绝非法素材名 ${bad}`, r.status === 404, String(r.status))
}

/* 5. 桌面端专项：渲染器令牌 / ETag / 交互超时字段 */
{
  /* 5a. 桌面端第一道栅栏 DesktopWebServer.permits 之后，还有第二道
         connection 栅栏（requestRejection）。渲染器请求必须能穿过第二道，
         否则 splash.css / splash.js / *.mp3 子资源会 401，页面直接黑屏。
         这里提供假 connection 服务（若只靠 ctx.get 拿不到就不会走到栅栏）。 */
  const fakeConn = { requestRejection: () => 401 }
  const root2 = new Context()
  root2.plugin({ name: 'fake-connection', apply(c) { c.provide('connection', fakeConn) } })
  root2.plugin(WebServer, { host: '127.0.0.1', port: 0, compression: 'none' })
  for (let i = 0; i < 100 && !root2.get('webServer'); i++) await sleep(20)
  const server2 = root2.get('webServer')
  const p2 = server2.port
  const f2 = root2.plugin(pluginModule)
  await f2
  await sleep(80)

  /* 直接用 http 发请求，分别带/不带渲染器头 */
  const probe = (p, path, headers) => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: p, path, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
  })
  let a = await probe(p2, '/dsh-startup/splash.js', { 'x-dsh-desktop-renderer': 'tok' })
  check('渲染器令牌请求绕过 connection 栅栏', a.status === 200, `${a.status}`)
  let b = await probe(p2, '/dsh-startup/splash.js', {})
  check('无令牌请求被 connection 栅栏拦截', b.status === 401, String(b.status))

  /* 5b. ETag：第二次带 If-None-Match 应返回 304 */
  a = await probe(p2, '/dsh-startup/asset/line-1.mp3', { 'x-dsh-desktop-renderer': 'tok' })
  const etag = a.headers.etag
  check('asset 返回 ETag', typeof etag === 'string' && etag.length > 3, String(etag))
  check('asset 使用 no-cache（可即时更新）', /no-cache/.test(a.headers['cache-control'] || ''), a.headers['cache-control'])
  const c = await probe(p2, '/dsh-startup/asset/line-1.mp3', { 'x-dsh-desktop-renderer': 'tok', 'if-none-match': etag })
  check('If-None-Match 命中返回 304', c.status === 304, String(c.status))

  /* 5c. 配置里必须有交互超时字段 */
  a = await probe(p2, '/dsh-startup/config', { 'x-dsh-desktop-renderer': 'tok' })
  let c2 = null; try { c2 = JSON.parse(a.body.toString()) } catch {}
  check('defaults 含 interactionTimeout', c2?.defaults?.interactionTimeout === 20, String(c2?.defaults?.interactionTimeout))

  /* 5d. splash.js 里必须有超时兜底代码 */
  a = await probe(p2, '/dsh-startup/splash.js', { 'x-dsh-desktop-renderer': 'tok' })
  const sj = a.body.toString('utf8')
  check('splash.js 含交互超时兜底', sj.includes('interactionTimeout') && sj.includes('limit > 0'))

  f2.dispose?.()
  root2.fiber.dispose?.()
  await sleep(40)
}

/* 7. 渲染器设置面板契约：桌面端设置页里「启动动画」分区必须保留
      依赖链：ui-settings-general 把 settings.section 声明为 list 槽 →
      ui-settings-general/各功能包（含本插件 client 半侧）用 slots.register 注册分区 →
      SettingsRoot 用 slots.entries('settings.section') 列出并渲染。
      注意 ui-settings 的 config.enabled 只是「开发者工具」偏好，不是面板开关，
      所以这里断言的是插件自身的注册契约，不依赖任何 profile 补丁。 */
{
  const clientFile = path.join(PLUGIN, 'lib', 'client.js')
  const clientSrc = fs.existsSync(clientFile) ? fs.readFileSync(clientFile, 'utf8') : ''
  check('渲染器半侧 lib/client.js 存在', clientSrc.length > 1000, `${clientSrc.length}B`)
  check('dsh.client.platform 保持 web（桌面端同一份代码）', pkg.dsh?.client?.platform === 'web', String(pkg.dsh?.client?.platform))
  check('dsh.client.inject 声明 ui-settings', Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'), JSON.stringify(pkg.dsh?.client?.inject))
  check('渲染器半侧注册 settings.section', clientSrc.includes("ctx.slots.inject('settings.section'") && clientSrc.includes('ctx.slots.register('))
  check('分区 id=startup-screen / order=26 不变', clientSrc.includes("id: 'startup-screen'") && clientSrc.includes('order: 26'))
  check('分区标题为「启动动画」', clientSrc.includes("label: '启动动画'"))
  const generalClient = path.join(APP, 'dsh-client-ui-settings-general', 'lib', 'client.js')
  if (fs.existsSync(generalClient)) {
    const g = fs.readFileSync(generalClient, 'utf8')
    check('桌面端设置页以 list 槽收集 settings.section', g.includes('entries("settings.section")') && g.includes('"settings.section": {'))
    check('桌面端设置页渲染 settings.section', g.includes('renderSlot("settings.section"'))
  } else {
    check('桌面端设置页契约（跳过：未找到 dsh-client-ui-settings-general）', true, 'skipped')
  }
}

/* 6. 幂等 */
check('tapIndex 幂等（重复渲染不重复注入）', (server.renderIndex(html).match(/dsh-startup\/splash\.js/g) || []).length === 1)

/* 6. 卸载干净 */
fiber.dispose ? fiber.dispose() : null
await sleep(60)
check('卸载后路由全部移除', server.exact.size === exactBefore && server.prefixes.size === prefixBefore, `exact=${server.exact.size}/${exactBefore} prefix=${server.prefixes.size}/${prefixBefore}`)
check('卸载后 index tap 移除', server.indexTaps.length === tapsBefore, `${server.indexTaps.length}/${tapsBefore}`)
r = await get('/dsh-startup/splash.js')
check('卸载后旧路由落到宿主 fallback', r.status === 200 && r.body.toString().includes('id="root"'), String(r.status))
r = await get('/host/heartbeat')
check('卸载后宿主路由仍正常', r.status === 200 && r.body.toString() === 'host-ok')

/* 8. 开源清洁度：仓库里不能出现本机绝对路径 / 调试日志 */
{
  const TEXT_EXT = new Set(['.md', '.js', '.mjs', '.json', '.yml', '.yaml', '.txt', '.cmd'])
  /* 本机路径特征：工作区目录名、Windows 用户目录、DSH 安装目录 */
  const LOCAL_PATH_PATTERNS = [
    new RegExp('DSH' + '工作区'),
    new RegExp('C:' + '\\\\Users\\\\', 'i'),
    new RegExp('D:' + '/DSH', 'i')
  ]
  const offenders = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!TEXT_EXT.has(path.extname(e.name).toLowerCase())) continue
      const text = fs.readFileSync(p, 'utf8')
      for (const pattern of LOCAL_PATH_PATTERNS) {
        if (pattern.test(text)) offenders.push(path.relative(PLUGIN, p).replace(/\\/g, '/') + ' :: ' + pattern)
      }
    }
  }
  walk(PLUGIN)
  check('仓库不含本机绝对路径（隐私清洁）', offenders.length === 0, offenders.slice(0, 5).join(' | '))

  /* Electron run-as-node 在 cwd 生成的 debug.log 必须被 .gitignore 覆盖，不会进版本库 */
  const gitignore = fs.existsSync(path.join(PLUGIN, '.gitignore')) ? fs.readFileSync(path.join(PLUGIN, '.gitignore'), 'utf8') : ''
  const strayLogs = fs.readdirSync(PLUGIN).filter((n) => n.endsWith('.log') && n !== 'debug.log')
  check('调试日志不会进入版本库（.gitignore 覆盖 *.log）', /(^|\n)\*\.log\b/m.test(gitignore) && strayLogs.length === 0, strayLogs.join(',') || '无多余日志')

  const readme = fs.existsSync(path.join(PLUGIN, 'README.md')) ? fs.readFileSync(path.join(PLUGIN, 'README.md'), 'utf8') : ''
  check('README 注明上游来源与许可', readme.includes('6shenhonghong9/dsh-startup-screen') && readme.includes('MIT'))
}

console.log('\n==== 汇总 ====')
const failed = results.filter((x) => !x.ok)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join(' | ')); process.exitCode = 1 }
root.fiber.dispose?.()
await sleep(50)
process.exit(process.exitCode || 0)

#!/usr/bin/env node
/* 桌面端插件安装器 —— 自包含安装，不依赖 git / pnpm / 外网。
 *
 * 做的事（默认 = 自包含，和 billion-context / dshmarket 等第三方插件同构）：
 *   1) 把整个包（package.json、lib/、cordis.patch.yml、LICENSE）复制进
 *      <profile>/node_modules/dsh-startup-screen/ —— 装完即独立，删掉本仓库也不影响。
 *   2) 在 <profile>/package.json 的 dsh.profile.bundles 末尾追加 dsh-startup-screen，
 *      让 Loader 把它当第三方 bundle 加载（内核文件零改动）。
 *
 * 为什么不用 `dsh plugin add` / pnpm：
 *   本包零依赖，不需要任何传递依赖；而 `dsh plugin --profile desktop` 会走 pnpm
 *   安装 + profile 依赖迁移，在已装很多插件的 profile 上有改动 lockfile 的风险。
 *   桌面端的 profileDependencyMigrationRequired() 只看 pnpm-workspace.yaml /
 *   .modules.yaml / pnpm-lock.yaml 设置，**不检查 package.json 的
 *   dependencies 与 bundles**，所以纯文件安装不会被判为需要重装依赖。
 *
 * 用法：
 *   node desktop/install-desktop.mjs                  # 自包含安装（默认 profile）
 *   node desktop/install-desktop.mjs --check          # 只体检，不写文件
 *   node desktop/install-desktop.mjs --uninstall      # 卸载（还原成未安装）
 *   node desktop/install-desktop.mjs --bridge         # 退化为桥接安装（改源码即生效）
 *   node desktop/install-desktop.mjs --profile "D:\\x\\profiles\\desktop"
 *
 * 注意：桌面端必须完全退出后再改 profile，否则改动会被运行中的进程覆盖。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import crypto from 'node:crypto'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const PKG_NAME = 'dsh-startup-screen'

/* 上游 GitHub 上的 git blob sha1（注意是 blob 哈希，不是文件 sha1） */
const EXPECTED_BLOB_SHA1 = {
  'line-1.mp3': 'c59abf0673e30d90b5ae1f196431b69b906012fe',
  'line-2.mp3': '1817504915bee3b163f4931449ae54580b3f202e',
  'line-3.mp3': 'ed77725a5f8978582ebf64c553ac3c38d28f2288',
  'line-4.mp3': '77ba3c598e3d76bfb9329a6f303099a575c74c85',
  'line-5.mp3': 'ebf783d73110ba2d4530b51fe919784ebf3ade77',
  'line-6.mp3': 'cf44c1c2be1bc5a7573ca503a4de04ad71b4316c',
  'sfx-tick.mp3': 'e28dec4af4cbbb93cc9177e6579bd7a6cae2ab35',
  'sfx-ticks-run.mp3': '62d6064115b8fcd4837e85a8469b2eee83996c80'
}

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const CHECK_ONLY = has('--check')
const UNINSTALL = has('--uninstall')
const BRIDGE = has('--bridge')
const PROFILE = path.resolve(valueOf('--profile', path.join(os.homedir(), '.dsh', 'profiles', 'desktop')))
const TARGET_DIR = path.join(PROFILE, 'node_modules', PKG_NAME)
const PROFILE_PKG = path.join(PROFILE, 'package.json')
const STAMP = path.join(TARGET_DIR, '.install-mode.json')

const log = (...a) => console.log(...a)
const fail = (msg) => { console.error('✗ ' + msg); process.exitCode = 1 }
const ok = (msg) => log('✓ ' + msg)

/* 容忍 UTF-8 BOM：Windows 上 PowerShell / 记事本等工具给 JSON 加 BOM 很常见，
   直接 JSON.parse 会抛 "Unexpected token '﻿'"；这里读入时统一剥掉。 */
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')

/** 自包含安装要带的文件/目录（白名单，避免把 .git、node_modules 之类带进去）。 */
const COPY_ENTRIES = ['lib', 'cordis.patch.yml', 'package.json', 'LICENSE', 'README.md', 'DESKTOP-ADAPT.md', 'DESKTOP.md', 'CHANGELOG.md']

/**
 * 容错删除目录：Windows 上目录里可能有 ACL 受限或被过滤驱动拦下的旧文件，
 * `fs.rmSync` 会因个别条目失败。这里先整体删，失败再退化成「能删多少删多少」。
 */
function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 })
    return true
  } catch {
    try {
      cleanExcept(dir, new Set())
      fs.rmdirSync(dir)
    } catch { /* 尽力而为 */ }
    if (fs.existsSync(dir)) { fail('无法完全删除 ' + dir + '（可能有权限受限的残留文件，可手动删除）'); return false }
    return true
  }
}

/**
 * 原地覆盖安装：不删除目标目录本身，只清理「除本次要写入的条目外」的旧文件。
 *
 * 早期版本用 rmrf 整目录重建，在 Windows 上会被两类问题绊住：
 *   1) rmSync 偶发 ENOTEMPTY（句柄释放时序）；
 *   2) 目录里若存在 ACL 受限/被过滤驱动拦下的旧文件（例如安全软件或沙箱留下的
 *      条目），任何删除/覆盖都会 Access denied —— 但目录本身仍可新建文件。
 * 覆盖安装对这两类都免疫：目录始终存在，只需要写自己的文件。
 * 残留的无关文件保留下来，不影响 Loader（它只按 package.json 的入口解析）。
 */
function cleanExcept(target, keep) {
  const removed = []
  const skipped = []
  const walk = (dir, relBase) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relBase ? relBase + '/' + entry.name : entry.name
      const p = path.join(dir, entry.name)
      if (keep.has(rel)) continue
      if (entry.isDirectory()) {
        if ([...keep].some((k) => k.startsWith(rel + '/'))) { walk(p, rel); continue }
        try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 }); removed.push(rel + '/') } catch { skipped.push(rel + '/') }
      } else {
        try { fs.rmSync(p, { force: true, maxRetries: 5, retryDelay: 60 }); removed.push(rel) } catch { skipped.push(rel) }
      }
    }
  }
  walk(target, '')
  return { removed, skipped }
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(src, dst)
    else if (entry.isFile()) fs.copyFileSync(src, dst)
  }
}

/* ---------- 体检 ---------- */

function countFiles(dir) {
  let n = 0
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) n++
    }
  }
  walk(dir)
  return n
}

function checkAssets() {
  const dir = path.join(REPO_ROOT, 'lib', 'assets')
  if (!fs.existsSync(dir)) { fail('缺少素材目录 lib/assets'); return 0 }
  let good = 0
  const names = Object.keys(EXPECTED_BLOB_SHA1)
  for (const name of names) {
    const file = path.join(dir, name)
    if (!fs.existsSync(file)) { fail(`缺少素材 ${name}`); continue }
    const bytes = fs.readFileSync(file)
    const blob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    if (blob === EXPECTED_BLOB_SHA1[name]) { good++; continue }
    const plain = crypto.createHash('sha1').update(bytes).digest('hex')
    fail(`${name} 内容与上游不一致（blob ${blob.slice(0, 10)} ≠ ${EXPECTED_BLOB_SHA1[name].slice(0, 10)}，普通 sha1 ${plain.slice(0, 10)}）`)
  }
  if (good === names.length) ok(`素材 8/8 与上游字节一致（${(names.reduce((s, n) => s + fs.statSync(path.join(dir, n)).size, 0) / 1024).toFixed(0)} KB）`)
  return good
}

async function check() {
  log(`profile: ${PROFILE}`)
  if (!fs.existsSync(PROFILE_PKG)) { fail('没有找到 profile/package.json'); return }

  checkAssets()

  if (!fs.existsSync(TARGET_DIR)) {
    fail(`插件未安装：${TARGET_DIR} 不存在`)
  } else {
    const mode = fs.existsSync(STAMP) ? readJson(STAMP).mode : (fs.existsSync(path.join(TARGET_DIR, 'lib', 'index.js')) ? 'self-contained' : 'bridge')
    ok(`插件已安装（${mode === 'self-contained' ? '自包含' : '桥接'}模式，${countFiles(TARGET_DIR)} 个文件）`)
    for (const f of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/splash.js', 'lib/splash.css', 'lib/client.js']) {
      if (fs.existsSync(path.join(TARGET_DIR, f))) ok(`  ${f}`)
      else fail(`  缺少运行时文件 ${f}`)
    }
    const installedAssets = path.join(TARGET_DIR, 'lib', 'assets')
    const have = fs.existsSync(installedAssets) ? fs.readdirSync(installedAssets).filter((n) => n.endsWith('.mp3')) : []
    if (have.length === 8) ok('  lib/assets/*.mp3 8/8')
    else fail(`  lib/assets/*.mp3 只有 ${have.length} 个（真声素材缺失会退回合成音）`)
    if (mode === 'bridge') log('  ⚠ 桥接模式依赖本仓库路径，仓库移动/删除后插件失效')
  }

  if (!fs.existsSync(path.join(PROFILE_PKG))) return
  const bundles = readJson(PROFILE_PKG)?.dsh?.profile?.bundles || []
  if (bundles.includes(PKG_NAME)) ok(`profile bundles 含 ${PKG_NAME}（共 ${bundles.length} 项）`)
  else fail(`profile bundles 不含 ${PKG_NAME}`)

  /* 插件模块能否被真正 import（语法/入口正确性） */
  if (fs.existsSync(path.join(TARGET_DIR, 'index.js'))) {
    try {
      const mod = await import(pathToFileURL(path.join(TARGET_DIR, 'index.js')).href)
      if (typeof mod.apply === 'function' && Array.isArray(mod.inject) && typeof mod.name === 'string') {
        ok(`入口可加载：name=${mod.name} inject=${JSON.stringify(mod.inject)}`)
      } else fail('入口模块导出不完整（需要 apply/inject/name）')
    } catch (err) {
      fail('入口模块加载失败：' + (err && err.message))
    }
  }

  log('\n运行时自检（桌面端 DevTools Console）：')
  log('  window.__DSH_STARTUP_BOOT__   == "index" 表示首屏已注入')
  log('  window.__DSH_STARTUP__        == 配置对象')
  log('  window.__DSH_STARTUP_SKIP__   == true 表示本次按配置跳过')
  log('  fetch("/dsh-startup/config")  == {ok:true,...} 表示路由已注册')
}

/* ---------- 安装 ---------- */

function installBridge() {
  const version = (fs.existsSync(path.join(REPO_ROOT, 'package.json')) && readJson(path.join(REPO_ROOT, 'package.json')).version) || '0.0.0'
  const entry = path.join(REPO_ROOT, 'lib', 'index.js').replace(/\\/g, '/')
  fs.mkdirSync(TARGET_DIR, { recursive: true })
  writeJson(path.join(TARGET_DIR, 'package.json'), {
    name: PKG_NAME,
    version,
    description: 'DeepSeek Harness 启动动画（桌面端桥接安装包）',
    type: 'module',
    main: 'index.js',
    exports: { '.': './index.js', './package.json': './package.json' },
    license: 'MIT',
    dsh: { bundle: { patch: './cordis.patch.yml' } }
  })
  fs.writeFileSync(path.join(TARGET_DIR, 'index.js'), `/* 桥接入口：指向本仓库源码，改代码即时生效。 */
import { pathToFileURL } from 'node:url'

const mod = await import(pathToFileURL(${JSON.stringify(entry)}).href)

export const apply = mod.apply
export const inject = mod.inject
export const name = mod.name
`)
  fs.copyFileSync(path.join(REPO_ROOT, 'cordis.patch.yml'), path.join(TARGET_DIR, 'cordis.patch.yml'))
  writeJson(STAMP, { mode: 'bridge', source: REPO_ROOT, installedAt: new Date().toISOString() })
  ok('桥接包已写入 ' + TARGET_DIR)
  log('  ⚠ 桥接模式：插件运行时依赖 ' + REPO_ROOT + '，该目录移动或删除后插件失效。')
}

function installSelfContained() {
  for (const name of COPY_ENTRIES) {
    if (!fs.existsSync(path.join(REPO_ROOT, name))) { fail('源码缺少 ' + name); process.exitCode = 1 }
  }
  if (process.exitCode) return

  if (!fs.existsSync(TARGET_DIR)) fs.mkdirSync(TARGET_DIR, { recursive: true })

  /* 覆盖安装：先按白名单清理旧条目，再写入。目录本身永不删除。 */
  const keep = new Set([...COPY_ENTRIES, '.install-mode.json'])
  const { skipped } = cleanExcept(TARGET_DIR, keep)
  if (skipped.length) log(`  跳过 ${skipped.length} 个无法删除的旧条目（不影响加载）：${skipped.join(', ')}`)

  const libSrc = path.join(REPO_ROOT, 'lib')
  copyDir(libSrc, path.join(TARGET_DIR, 'lib'))
  for (const name of ['cordis.patch.yml', 'package.json', 'LICENSE', 'README.md', 'DESKTOP-ADAPT.md', 'DESKTOP.md', 'CHANGELOG.md']) {
    const src = path.join(REPO_ROOT, name)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(TARGET_DIR, name))
  }
  writeJson(STAMP, {
    mode: 'self-contained',
    version: readJson(path.join(REPO_ROOT, 'package.json')).version,
    installedAt: new Date().toISOString()
  })
  ok(`插件已自包含安装：${TARGET_DIR}（${countFiles(TARGET_DIR)} 个文件）`)

  const assets = path.join(TARGET_DIR, 'lib', 'assets')
  const mp3 = fs.existsSync(assets) ? fs.readdirSync(assets).filter((n) => n.endsWith('.mp3')) : []
  if (mp3.length === 8) ok('  真声素材 8/8 已随包安装')
  else fail(`  真声素材只有 ${mp3.length} 个`)
}

function addToBundles() {
  const pkg = readJson(PROFILE_PKG)
  pkg.dsh = pkg.dsh || {}
  pkg.dsh.profile = pkg.dsh.profile || {}
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
  if (bundles.includes(PKG_NAME)) { ok(`profile bundles 已包含 ${PKG_NAME}，未改动`); return false }
  const backup = PROFILE_PKG + '.before-dsh-startup-screen'
  if (!fs.existsSync(backup)) fs.copyFileSync(PROFILE_PKG, backup)
  bundles.push(PKG_NAME)
  pkg.dsh.profile.bundles = bundles
  writeJson(PROFILE_PKG, pkg)
  ok(`profile bundles 末尾追加 ${PKG_NAME}（共 ${bundles.length} 项；原文件备份为 ${path.basename(backup)}）`)
  return true
}

function removeFromBundles() {
  const pkg = readJson(PROFILE_PKG)
  const bundles = pkg?.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || !bundles.includes(PKG_NAME)) { ok('profile bundles 本来就不含 ' + PKG_NAME); return }
  pkg.dsh.profile.bundles = bundles.filter((n) => n !== PKG_NAME)
  writeJson(PROFILE_PKG, pkg)
  ok(`profile bundles 已移除 ${PKG_NAME}（剩 ${pkg.dsh.profile.bundles.length} 项）`)
}

function install() {
  if (!fs.existsSync(PROFILE_PKG)) { fail('没有找到 profile/package.json：' + PROFILE_PKG); return }
  if (!fs.existsSync(path.join(REPO_ROOT, 'lib', 'index.js'))) { fail('没有找到源码入口 lib/index.js'); return }

  checkAssets()
  if (BRIDGE) installBridge()
  else installSelfContained()

  addToBundles()

  log('\n下一步：完全退出 DSH Desktop（含托盘进程）后重新打开，启动动画即生效。')
  log('体检：node desktop/install-desktop.mjs --check')
  log('卸载：node desktop/install-desktop.mjs --uninstall')
}

function uninstall() {
  if (fs.existsSync(TARGET_DIR)) { rmrf(TARGET_DIR); ok('已删除 ' + TARGET_DIR) }
  else ok('插件目录本来就不存在')
  removeFromBundles()
  log('\n完全退出并重新打开 DSH Desktop 后生效。')
}

if (CHECK_ONLY) await check()
else if (UNINSTALL) uninstall()
else install()

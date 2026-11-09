#!/usr/bin/env node
/**
 * apply-whale-fantasy.mjs — 把 dsh-skin-whale-fantasy 装进正在运行的 DSH Desktop。
 *
 *   node scripts/apply-whale-fantasy.mjs              # 安装/升级（幂等）
 *   node scripts/apply-whale-fantasy.mjs --uninstall  # 卸载，恢复备份
 *   node scripts/apply-whale-fantasy.mjs --check      # 只体检不改动
 *
 * 做的事只有四件：拷包到 profile/node_modules、在 cordis.patch.yml 插一行、
 * 写 dsh-video-skin.json（若装了 dsh-video-skin）、把海面壁纸的 CSS 载体放好。
 * 不动 DSH 本体、不改任何别的插件源码。所有被改的文件都留 .bak-<时间戳>。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, platform } from 'node:os'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = 'dsh-skin-whale-fantasy'
const ROW_ID = 'skin-whale-fantasy'
const args = new Set(process.argv.slice(2))
const MODE = args.has('--uninstall') ? 'uninstall' : args.has('--check') ? 'check' : 'install'
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

const log = (...a) => console.log(...a)
const warn = (...a) => console.warn('  ! ' + a.join(' '))

/* ------------------------------------------------------------------ paths */

function harnessDir() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  const home = homedir()
  const candidates = [
    join(home, 'Library/Application Support/dsh-desktop/harness'), // macOS
    join(home, '.config/dsh-desktop/harness'), // Linux
    join(process.env.APPDATA || join(home, 'AppData/Roaming'), 'dsh-desktop/harness'), // Windows
    join(home, '.dsh') // legacy / CLI
  ]
  const hit = candidates.find(p => existsSync(p))
  if (!hit) {
    console.error(`找不到 DSH 的 harness 目录。找过：\n  ${candidates.join('\n  ')}`)
    console.error('请先启动一次 DSH Desktop，或用 DSH_HOME 指定路径。')
    process.exit(2)
  }
  return hit
}

const HARNESS = harnessDir()
const PROFILE = pickProfile(HARNESS)
const NM = join(PROFILE, 'node_modules')
const TARGET = join(NM, PKG)
const PATCH = join(PROFILE, 'cordis.patch.yml')
const VIDEO_CFG = join(HARNESS, 'dsh-video-skin.json')
const MEDIA_DIR = join(HARNESS, 'dsh-video-skin-media')

function pickProfile(h) {
  const profiles = join(h, 'profiles')
  if (!existsSync(profiles)) {
    console.error(`找不到 profiles 目录：${profiles}`)
    process.exit(2)
  }
  const names = readdirSync(profiles).filter(n => statSync(join(profiles, n)).isDirectory())
  const web = names.find(n => n === 'web')
  if (web) return join(profiles, web)
  if (names.length === 1) return join(profiles, names[0])
  console.error(`多个 profile（${names.join(', ')}），请用 DSH_PROFILE 环境变量指定。`)
  process.exit(2)
}

/* ------------------------------------------------------------- yml editing */

function readPatch() {
  return existsSync(PATCH) ? readFileSync(PATCH, 'utf8') : ''
}

function hasRow(y) {
  return new RegExp(`^\\s*-?\\s*id:\\s*${ROW_ID}\\s*$`, 'm').test(y)
}

function insertRow(y) {
  const block =
    `\n# dsh-skin-whale-fantasy: 只插入一行；index.js 自己提供 skin.css 与媒体文件，\n` +
    `# 宿主目录一个文件都不改。\n` +
    `- insert:\n` +
    `    - id: ${ROW_ID}\n` +
    `      name: '${PKG}'\n`
  return y.replace(/\s*$/, '\n') + block
}

function removeRow(y) {
  // 删掉 "- insert:" 块里的这一行；块空了就把 "- insert:" 一起去掉
  const lines = y.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (new RegExp(`^\\s*-\\s*id:\\s*${ROW_ID}\\s*$`).test(l)) {
      // 往前吞掉上一行的 "name:" 和空注释块
      while (out.length && /^\s{4,}-\s+name:/.test(out[out.length - 1]) === false && /^\s{4,}name:/.test(out[out.length - 1])) out.pop()
      if (out.length && /^\s{4,}(name:|- name:)/.test(out[out.length - 1])) out.pop()
      continue
    }
    out.push(l)
  }
  let y2 = out.join('\n').replace(/\n- insert:\s*(?=\n|$)/g, '\n')
  return y2
}

function backup(p) {
  if (!existsSync(p)) return null
  const b = `${p}.bak-whale-${STAMP}`
  cpSync(p, b)
  return b
}

/* ------------------------------------------------------------------ checks */

function check() {
  const row = hasRow(readPatch())
  const installed = existsSync(TARGET) && existsSync(join(TARGET, 'skin.css'))
  const css = installed ? readFileSync(join(TARGET, 'skin.css'), 'utf8') : ''
  const marks = [
    ['壁纸壳: html/body 透明', /html,\s*body\s*\{[^}]*background-color:\s*transparent/s],
    ['反制浅色面纱 #dsvs-backdrop', /#dsvs-backdrop/],
    ['面板暗玻璃 0.26', /rgba\(12,\s*15,\s*22,\s*0\.26\)/],
    ['flowItem 0.18', /rgba\(20,\s*22,\s*28,\s*0\.18\)/],
    ['正文浅墨 #eef3fa', /#eef3fa/],
    ['标题栏墨色', /_crumbCurrent/],
    ['侧栏层级', /sectionLabel/],
    ['输入区缓升渐隐', /composerSeat/],
    ['注入壁纸层兜底定位', /\[data-dsh-skin-layer='background'\]/],
    ['代码块深玻璃', /rgba\(10,\s*14,\s*22,\s*0\.82\)/]
  ]
  log(`harness : ${HARNESS}`)
  log(`profile : ${PROFILE}`)
  log(`package : ${installed ? 'installed' : 'MISSING'}  ${TARGET}`)
  log(`patch   : ${row ? 'row present' : 'row MISSING'}  ${PATCH}`)
  log(`video   : ${existsSync(VIDEO_CFG) ? 'config present' : 'no dsh-video-skin.json'}`)
  log('carrier :')
  for (const [name, re] of marks) log(`  ${re.test(css) ? '✓' : '✗'} ${name}`)
  const ok = installed && row && marks.every(([, re]) => re.test(css))
  log(ok ? '\n状态：OK' : '\n状态：需要跑一次 install')
  return ok
}

/* -------------------------------------------------------------- wallpaper  */

/** 只在装了 dsh-video-skin 时写配置；没有就跳过，皮肤本身也能用（用内置 video 层）。 */
function writeVideoConfig() {
  const example = join(NM, 'dsh-video-skin', 'video-skin.config.example.json')
  if (!existsSync(join(NM, 'dsh-video-skin'))) {
    log('  · 未检测到 dsh-video-skin，跳过壁纸配置文件')
    return
  }
  const assets = join(TARGET, 'assets')
  const loop = join(assets, 'whale-fantasy-loop.mp4')
  const media = pickVideo()
  if (!media) {
    warn('没找到可用的 mp4 壁纸，dsh-video-skin 会回落到包内默认值')
    return
  }
  mkdirSync(MEDIA_DIR, { recursive: true })
  const dest = join(MEDIA_DIR, `whale-fantasy${media.endsWith('.webm') ? '.webm' : '.mp4'}`)
  if (resolve(media) !== resolve(dest)) cpSync(media, dest)
  const cfg = existsSync(VIDEO_CFG) ? JSON.parse(readFileSync(VIDEO_CFG, 'utf8')) : {}
  const base = {
    enabled: true,
    file: dest,
    mode: 'own',
    veil: 0.22,
    surface: 0.28,
    surfaceLight: 0.6,
    veilLight: 0.2,
    panel: 0,
    controls: true,
    delayMs: 1200,
    playbackRate: 1
  }
  // 用户已调过的键一个都不动，只补缺失的
  const next = { ...cfg, background: { ...base, ...(cfg.background || {}), file: (cfg.background && cfg.background.file) || dest } }
  backup(VIDEO_CFG)
  writeFileSync(VIDEO_CFG, JSON.stringify(next, null, 2) + '\n')
  log(`  · 壁纸已指向 ${dest}`)
  const loopOk = existsSync(loop)
  log(`  · 包内循环素材：${loopOk ? 'ok' : '缺失'}（${loop}）`)
  if (existsSync(example)) log(`  · dsh-video-skin 默认值参考：${example}`)
}

function pickVideo() {
  const here = join(TARGET, 'assets')
  if (!existsSync(here)) return null
  const files = readdirSync(here).filter(f => /\.(mp4|webm)$/i.test(f)).map(f => join(here, f))
  if (!files.length) return null
  // 优先带 wallpaper 字样的，其次最大的那个
  files.sort((a, b) => (/wallpaper/i.test(b) ? 1 : 0) - (/wallpaper/i.test(a) ? 1 : 0))
  const best = files[0]
  return statSync(best).size > 1024 ? best : null
}

/* ------------------------------------------------------------------- main  */

if (MODE === 'check') {
  check()
  process.exit(0)
}

if (MODE === 'uninstall') {
  log('卸载 dsh-skin-whale-fantasy')
  if (existsSync(TARGET)) {
    rmSync(TARGET, { recursive: true, force: true })
    log(`  · 已删 ${TARGET}`)
  }
  const y = readPatch()
  if (hasRow(y)) {
    const b = backup(PATCH)
    writeFileSync(PATCH, removeRow(y))
    log(`  · 已从 cordis.patch.yml 移除该行（备份 ${b}）`)
  } else {
    log('  · cordis.patch.yml 里没有这一行，无需改动')
  }
  log('重启 DSH Desktop 后生效。')
  process.exit(0)
}

log('安装 dsh-skin-whale-fantasy')

// 1) 拷包
mkdirSync(NM, { recursive: true })
if (existsSync(TARGET)) {
  const b = `${TARGET}.bak-whale-${STAMP}`
  rmSync(b, { recursive: true, force: true })
  cpSync(TARGET, b, { recursive: true })
  log(`  · 旧版本备份到 ${b}`)
}
rmSync(TARGET, { recursive: true, force: true })
mkdirSync(TARGET, { recursive: true })
for (const f of ['index.js', 'cordis.patch.yml', 'package.json', 'skin.css', 'patches.css']) {
  cpSync(join(ROOT, f), join(TARGET, f))
}
for (const d of ['assets', 'preview']) {
  if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(TARGET, d), { recursive: true })
}
log(`  · 包已就位 ${TARGET}`)

// 2) 插行
const y = readPatch()
if (hasRow(y)) {
  log('  · cordis.patch.yml 已有该行，跳过')
} else {
  const b = backup(PATCH)
  writeFileSync(PATCH, insertRow(y))
  log(`  · cordis.patch.yml 已插入 ${ROW_ID}（备份 ${b}）`)
}

// 3) 壁纸配置
writeVideoConfig()

// 4) 自检
log('')
check()
log('\n下一步：完全退出 DSH Desktop（⌘Q / 托盘退出），再打开一次。插件与路由不走热更新。')
log(`平台：${platform()}`)

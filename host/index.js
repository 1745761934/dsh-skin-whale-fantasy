// dsh-skin-whale-fantasy — host half of the 鲸鱼娘·幻想壁纸 skin.
// Serves the merged sheet, the wallpaper video and the media the sheet points
// at, then installs the page half (sheet link + background layer) from a
// head script: the client's own boot script rewrites <body> before the entry
// module runs, so markup parked in the body would be dropped.
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

const here = dirname(fileURLToPath(import.meta.url))

export const SKIN_ID = 'whale-fantasy'
export const STYLESHEET_ROUTE = '/api/skin-whale-fantasy/skin.css'

const MEDIA_ROUTE = '/api/skin-whale-fantasy/media'
const WALLPAPER_ROUTE = '/api/skin-whale-fantasy/wallpaper.mp4'

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.mp4': 'video/mp4'
}

function inside(root, candidate) {
  const resolved = normalize(join(root, candidate))
  return resolved === root || resolved.startsWith(root + sep) ? resolved : undefined
}

// The wallpaper is a 6.6 MB mp4 and Chromium seeks it with Range requests while
// it loops; buffering it into memory per request both wastes the heap and
// answers `200` where a media element expects `206`. Small assets stay buffered.
const STREAM_THRESHOLD = 1 << 20

function parseRange(raw, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(raw.trim())
  if (m === null) return undefined
  const [, a, b] = m
  if (a === '' && b === '') return undefined
  let start
  let end
  if (a === '') {
    const suffix = Number(b)
    if (suffix <= 0) return undefined
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(a)
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return undefined
  return { start, end }
}

async function send(path, type, request) {
  let size
  try {
    size = (await stat(path)).size
  } catch {
    return new Response(null, { status: 404 })
  }
  const head = {
    'content-type': type,
    'cache-control': 'no-cache',
    'accept-ranges': 'bytes'
  }
  const method = request?.method === 'HEAD' ? 'HEAD' : 'GET'
  let status = 200
  let start = 0
  let end = size - 1
  const raw = request?.headers.get('range')
  if (raw !== null && raw !== undefined) {
    const range = parseRange(raw, size)
    if (range === undefined) {
      return new Response(null, { status: 416, headers: { ...head, 'content-range': `bytes */${size}` } })
    }
    ;({ start, end } = range)
    status = 206
    head['content-range'] = `bytes ${start}-${end}/${size}`
  }
  head['content-length'] = String(end - start + 1)
  if (method === 'HEAD') return new Response(null, { status, headers: head })
  if (size === 0) return new Response(new Uint8Array(0), { status, headers: head })
  if (end - start + 1 > STREAM_THRESHOLD) {
    const stream = createReadStream(path, { start, end })
    return new Response(Readable.toWeb(stream), { status, headers: head })
  }
  try {
    const body = await readFile(path)
    return new Response(new Uint8Array(body).subarray(start, end + 1), { status, headers: head })
  } catch {
    return new Response(null, { status: 404 })
  }
}

function readRelative(raw) {
  if (!raw.startsWith('../')) return undefined
  const relative = raw.slice(3)
  if (relative === '' || relative.split('/').includes('..')) return undefined
  const dot = relative.lastIndexOf('.')
  if (dot <= 0) return undefined
  const type = TYPES[relative.slice(dot).toLowerCase()]
  return type === undefined ? undefined : { relative, type }
}

// The sheet resolves its media against whichever document loads it, so its
// asset path is rewritten once here to an absolute route of this plugin: the
// pack under ~/.dsh/skins/<id> may be reviewed or moved without breaking it.
function rewriteMedia(css) {
  return css.replaceAll('../assets/settings-bg.webp', `${MEDIA_ROUTE}?name=../assets/settings-bg.webp`)
}

async function handleStylesheet() {
  try {
    const css = await readFile(join(here, 'skin.css'), 'utf8')
    const patches = await readFile(join(here, 'patches.css'), 'utf8')
    const merged = rewriteMedia(`${css}\n/* ---- patches ---- */\n${patches}`)
    return new Response(merged, {
      headers: { 'content-type': TYPES['.css'], 'cache-control': 'no-cache' }
    })
  } catch {
    return new Response(null, { status: 500 })
  }
}

async function handleAsset(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  const resolved = readRelative(new URL(request.url).searchParams.get('name') ?? '')
  if (resolved === undefined) return new Response(null, { status: 404 })
  const path = inside(here, resolved.relative)
  if (path === undefined) return new Response(null, { status: 404 })
  return send(path, resolved.type, request)
}

async function handleWallpaper(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  return send(join(here, 'assets/whale-fantasy-loop.mp4'), TYPES['.mp4'], request)
}

// Page half, installed from the head so it survives <body> being rebuilt:
// the sheet link plus the background layer the sheet positions. Both are inert
// until the routes above answer, so a failed route degrades to stock DSH.
const BOOT = `(() => {
  const ID = ${JSON.stringify(SKIN_ID)}
  const SHEET = ${JSON.stringify(STYLESHEET_ROUTE)}
  const VIDEO = ${JSON.stringify(WALLPAPER_ROUTE)}
  const mount = () => {
    const body = document.body
    if (body === null || body === undefined) return
    if (document.querySelector('link[data-dsh-skin="' + ID + '"]') === null) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = SHEET
      link.dataset.dshSkin = ID
      document.head.append(link)
    }
    if (document.querySelector('[data-dsh-skin-layer="background"]') !== null) return
    const layer = document.createElement('div')
    layer.dataset.dshSkinLayer = 'background'
    layer.setAttribute('aria-hidden', 'true')
    const video = document.createElement('video')
    video.src = VIDEO
    video.autoplay = true
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.disablePictureInPicture = true
    layer.append(video)
    body.prepend(layer)
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true })
  }
  mount()
})()`

function bootInjections() {
  return [{ kind: 'script', placement: 'head', text: BOOT }]
}

export function apply(ctx) {
  ctx.on('webserver/index-inject', table => {
    table.push(...bootInjections())
  })
  ctx.inject(['connection'], connectionCtx => {
    const connection = Reflect.get(connectionCtx, 'connection')
    if (connection === undefined) {
      throw new Error('dsh-skin-whale-fantasy: connection service unavailable')
    }
    connection.fetch.register({
      path: STYLESHEET_ROUTE,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: handleStylesheet
    })
    connection.fetch.register({
      path: MEDIA_ROUTE,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: handleAsset
    })
    // Video wallpaper: its own path so the page points <video src> at a
    // stable, extension-bearing URL.
    connection.fetch.register({
      path: WALLPAPER_ROUTE,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: handleWallpaper
    })
  })
}

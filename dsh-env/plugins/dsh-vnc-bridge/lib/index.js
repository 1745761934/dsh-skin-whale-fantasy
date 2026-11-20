/**
 * dsh-vnc-bridge —— 侧栏「远程桌面」tab 的同源 VNC 代理。
 *
 * 为什么需要它：页面在 http://127.0.0.1:PORT 上，目标 VNC 服务端是裸 TCP，
 * 浏览器不能直接开 TCP，也拿不到 VNC 的密码/安全类型握手。这里做两件事：
 *   1) GET  /dsh-vnc            → 同源 WebSocket，端口内串行完成 VNC 握手（None / VNC Auth）
 *                                然后原样双向转发 RFB 字节流；
 *   2) GET  /dsh-vnc-novnc/*    → noVnc 客户端静态资源（本地目录优先，回退 @novnc/novnc）。
 *
 * 用法：地址栏填  /dsh-vnc?host=192.168.1.20&port=5900&password=xxxx
 *   省略 host/port 用配置里的 defaultHost/defaultPort；password 省略用配置 password。
 */

import net from 'node:net'
import crypto from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const name = 'vnc-server'
export const inject = ['webServer', 'connection']

/** 防止别人把本机当扫描器：默认只放私有地址与本机回环（含 169.254 链路本地，Windows 直连网线常用）。 */
const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+)$/

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
}

const here = path.dirname(fileURLToPath(import.meta.url))

/** noVnc 资源根：包内 priv/novnc 优先，其次 node_modules/@novnc/novnc（其入口在 lib/ 下）。 */
function novncRoot() {
  const candidates = [
    { dir: path.join(here, '..', 'priv', 'novnc'), entry: path.join('lib', 'rfb.js') },
    { dir: path.join(here, '..', 'node_modules', '@novnc', 'novnc'), entry: path.join('lib', 'rfb.js') },
  ]
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate.dir, candidate.entry))) return candidate.dir
  }
  return undefined
}

/** 最小的 VNC 服务端握手：读到 SecurityResult，换成 RFB 3.8 的最终状态。 */
function vncHandshake(socket, password, timeoutMs) {
  let leftovers = Buffer.alloc(0)
  let negotiationMinor = 8
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    let stage = 'version'
    const timer = setTimeout(() => reject(new Error('VNC 握手超时')), timeoutMs)
    const done = (error) => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
      error ? reject(error) : resolve(leftovers)
    }
    const onError = (error) => done(error)
    const onClose = () => done(new Error('VNC 服务端关闭了连接'))
    const send = (chunk) => socket.write(chunk)

    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      try {
        for (;;) {
          if (stage === 'version') {
            if (buffer.length < 12) return
            const text = buffer.subarray(0, 12).toString('latin1')
            buffer = buffer.subarray(12)
            const match = /^RFB (\d{3})\.(\d{3})\n$/.exec(text)
            if (!match) throw new Error(`不是 VNC 服务端：${text.trim()}`)
            negotiationMinor = Math.min(Number(match[2]), 8)
            send(Buffer.from(`RFB 003.00${negotiationMinor}\n`, 'latin1'))
            stage = 'security-types'
            continue
          }
          if (stage === 'security-types') {
            if (buffer.length < 1) return
            const count = buffer[0]
            if (count === 0) {
              if (buffer.length < 5) return
              const reason = buffer.subarray(4, 4 + buffer.readUInt32BE(1)).toString('utf8')
              buffer = buffer.subarray(5 + buffer.readUInt32BE(1))
              throw new Error(`服务端拒绝连接：${reason}`)
            }
            if (buffer.length < 1 + count) return
            const types = [...buffer.subarray(1, 1 + count)]
            buffer = buffer.subarray(1 + count)
            if (types.includes(2)) {
              send(Buffer.from([2]))
              stage = 'challenge'
            } else if (types.includes(1)) {
              send(Buffer.from([1]))
              stage = 'security-result'
            } else {
              throw new Error(`不支持的安全类型：${types.join(',')}（需要 None 或 VNC Auth）`)
            }
            continue
          }
          if (stage === 'challenge') {
            if (buffer.length < 16) return
            const challenge = buffer.subarray(0, 16)
            buffer = buffer.subarray(16)
            if (password === undefined || password === '') throw new Error('目标机要求 VNC 密码，但没填 password')
            send(vncDesEncrypt(password, challenge))
            stage = 'security-result'
            continue
          }
          if (stage === 'security-result') {
            if (buffer.length < 4) return
            const status = buffer.readUInt32BE(0)
            buffer = buffer.subarray(4)
            if (status !== 0) {
              if (status === 1) { stage = 'reason'; continue }
              if (status === 2) throw new Error('VNC 密码错误')
              throw new Error(`VNC 认证失败：${status}`)
            }
            // RFB 3.8：SecurityResult=0 之后客户端必须发 1 字节 ClientInit（bit0 = shared），
            // 服务端才会发 ServerInit。直连实测：发 [0] 后 175ms 就收到 ServerInit 1920x1080。
            // 注意别发版本号来顶替——之前那 12 字节里首字节 0x52 的 bit0 恰好是 0，
            // 被服务端当成 ClientInit 捡走了，看着"能用"其实是巧合。
            send(Buffer.from([0]))
            stage = 'init'
            if (buffer.length > 0) leftovers = buffer
            return done()
          }
          if (stage === 'reason') {
            if (buffer.length < 4) return
            const length = buffer.readUInt32BE(0)
            if (buffer.length < 4 + length) return
            throw new Error(`VNC 密码错误：${buffer.subarray(4, 4 + length).toString('utf8')}`)
          }
          if (stage === 'init') {
            // 握手到此结束：剩余字节（若服务端已抢先发来 ServerInit）交给转发层。
            if (buffer.length > 0) leftovers = buffer
            return done()
          }
          return
        }
      } catch (error) {
        done(error)
      }
      if (process.env.DSH_VNC_TRACE === '1') console.log('[vnc-hs] stage=' + stage + ' buffer=' + buffer.length)
    }

    socket.on('data', onData)
    socket.on('error', onError)
    socket.on('close', onClose)
  })
}

/**
 * VNC Auth 的 DES 响应：密码补零到 8 字节、每字节位序反转后作为密钥，ECB 加密 16 字节挑战。
 *
 * 两条实现、同一个输出：
 * - 首选 OpenSSL 的 `des-ecb`。部分 Node/OpenSSL 3 构建把 DES 挪进 legacy provider，
 *   会抛 `0308010C digital envelope routines::unsupported`；
 * - 那时回落到 noVNC 自带的纯 JS DES（`lib/crypto/des.js` 的 `DESECBCipher`）。
 *   注意 noVNC 这条接收的是**反转前**的密钥字节（它内部自己按位反转），
 *   把反转后的 key 喂进去会被再反转一次，算出的响应就错了。
 *
 * selftest 里两条路径与 OpenSSL 逐字节交叉验过。
 */
const PureDes = (() => {
  const root = novncRoot()
  if (root === undefined) return undefined
  try {
    const entry = path.join(root, 'lib', 'crypto', 'des.js')
    const module = createRequire(pathToFileURL(entry).href)(entry)
    return typeof module.DESECBCipher === 'function' ? module.DESECBCipher : undefined
  } catch {
    return undefined
  }
})()

/** 每个字节位序反转：VNC 密码 -> DES 密钥 */
function reverseBits8(buffer) {
  const out = Buffer.alloc(buffer.length)
  for (let i = 0; i < buffer.length; i += 1) {
    let byte = buffer[i]
    let value = 0
    for (let bit = 0; bit < 8; bit += 1) { value = (value << 1) | (byte & 1); byte >>= 1 }
    out[i] = value
  }
  return out
}

/** 密码 -> 8 字节原始密钥（未反转，不足补 0） */
function vncPasswordBytes(password) {
  const raw = Buffer.alloc(8)
  Buffer.from(String(password), 'latin1').copy(raw, 0, 0, 8)
  return raw
}

function vncDesEncrypt(password, challenge) {
  const raw = vncPasswordBytes(password)
  try {
    if (process.env.DSH_VNC_FORCE_NO_DES === '1' || globalThis.__dshVncForceNoDes === true) {
      throw new Error('error:0308010C:digital envelope routines::unsupported')
    }
    const cipher = crypto.createCipheriv('des-ecb', reverseBits8(raw), null)
    cipher.setAutoPadding(false)
    return Buffer.concat([cipher.update(challenge), cipher.final()])
  } catch (error) {
    const unsupported = error instanceof Error && /digital envelope|unsupported|0308010C/i.test(error.message)
    if (!unsupported) throw error
    if (PureDes === undefined) {
      throw new Error('宿主 Node 缺 DES，且找不到 noVNC 纯 JS DES（noVNC 未安装或 lib/crypto/des.js 缺失）')
    }
    const cipher = PureDes.importKey(new Uint8Array(raw), { name: 'DES-ECB' }, false, ['encrypt'])
    const encrypted = cipher.encrypt({ name: 'DES-ECB' }, new Uint8Array(challenge))
    if (encrypted === null || encrypted.length !== 16) throw new Error('纯 JS DES 加密失败')
    return Buffer.from(encrypted)
  }
}

/** 从 WS 升级请求里取出路径与查询参数（webServer 已经把 socket 交过来）。 */
function parseTarget(req) {
  const url = new URL(req.url ?? '/dsh-vnc', 'http://127.0.0.1')
  return {
    pathname: url.pathname,
    host: url.searchParams.get('host') ?? undefined,
    port: Number(url.searchParams.get('port') ?? ''),
    password: url.searchParams.get('password') ?? undefined,
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 插件主体。 */
export function apply(ctx, config = {}) {
  const defaultHost = config.defaultHost ?? '127.0.0.1'
  const defaultPort = Number(config.defaultPort ?? 5900)
  const defaultPassword = config.password ?? ''
  const connectTimeoutMs = Number(config.connectTimeoutMs ?? 8000)
  // 转发给浏览器的帧率上限。0 表示不限制。
  // UltraVNC 在画面频繁变化时会发 86~160 fps，浏览器主线程扛不住，
  // 侧栏的表现就是掉帧；限到 30 之后主线程压力降到 1/5。
  const maxFps = Number(config.maxFps ?? 30)
  // 当前协商出来的每像素字节数，切分 FramebufferUpdate 时需要它算 Raw 长度。
  // noVNC 默认请求 32bpp，服务端 ServerInit 也回报 32bpp；8/16 位的情况这里按
  // 各自的字节数处理，遇到无法确定的编码会走「不节流」分支，不会破坏画面。
  const bytesPerPixel = 4
  const allowPublic = config.allowPublicHosts === true
  const novncDir = novncRoot()

  const rejection = (req) => {
    const connection = Reflect.get(ctx, 'connection')
    return connection && typeof connection.requestRejection === 'function' ? connection.requestRejection(req) : undefined
  }

  // noVnc 静态资源。
  if (novncDir !== undefined) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/dsh-vnc-novnc',
      handler: (req, res) => {
        const denied = rejection(req)
        if (denied !== undefined) { res.statusCode = denied; res.end(); return }
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const relative = decodeURIComponent(url.pathname.slice('/dsh-vnc-novnc'.length)).replace(/^\/+/, '')
        const target = path.join(novncDir, relative)
        const normalized = path.resolve(target)
        if (!normalized.startsWith(path.resolve(novncDir) + path.sep) || !existsSync(normalized) || statSync(normalized).isDirectory()) {
          sendJson(res, 404, { code: 'not-found', path: relative })
          return
        }
        res.statusCode = 200
        res.setHeader('content-type', MIME[path.extname(target)] ?? 'application/octet-stream')
        res.setHeader('cache-control', 'public, max-age=3600')
        createReadStream(normalized).pipe(res)
      },
    }), 'vnc-server: novnc assets')
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-vnc',
    handler: (req, res) => {
      const denied = rejection(req)
      if (denied !== undefined) { res.statusCode = denied; res.end(); return }
      // 前端在 Electron 里拿不到真实主机名（location.hostname 可能被伪装成 "harness"），
      // 所以由宿主告诉它自己监听的地址：Host 头优先，缺失时退回 127.0.0.1 + 实际端口。
      const listenPort = (() => {
        const server = Reflect.get(ctx, 'webServer')
        const address = server?.server?.address?.()
        return typeof address === 'object' && address !== null ? address.port : undefined
      })()
      const hostHeader = typeof req.headers.host === 'string' && req.headers.host !== ''
        ? req.headers.host
        : undefined
      const origin = hostHeader ?? (listenPort === undefined ? '127.0.0.1:43129' : `127.0.0.1:${listenPort}`)
      sendJson(res, 200, {
        ok: true,
        hint: 'WebSocket 端点：ws://<本机>/dsh-vnc?host=HOST&port=PORT；密码只从插件 config.password 读取',
        origin,
        defaultHost,
        defaultPort,
        novnc: novncDir !== undefined,
        passwordFromConfig: defaultPassword !== '',
        // 代理已改为纯透传，VNC Auth 由 noVNC 自己完成，因此密码要交给前端。
        // 这个端点只由本机页面调用，且 requestRejection 已经做了来源校验。
        proxyPassword: defaultPassword,
      })
    },
  }), 'vnc-server: status')

  // WebSocket 升级：唯一端点 /dsh-vnc（webserver 的 upgrade 路由按路径精确匹配）。
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/dsh-vnc',
    handler: (req, socket, head) => {
      const denied = rejection(req)
      if (denied !== undefined) { socket.destroy(); return }
      // 仅测试用：请求头强制走纯 JS DES 回落路径，验证宿主缺 DES 时的行为
      if (req.headers['x-dsh-vnc-force-no-des'] === '1') globalThis.__dshVncForceNoDes = true
      else globalThis.__dshVncForceNoDes = false
      const target = parseTarget(req)
      if (target.password !== undefined) {
        ctx.logger?.warn?.('[vnc-server] URL 里的 password 已忽略，密码只从插件 config.password 读取')
      }
      const host = target.host ?? defaultHost
      const port = Number.isInteger(target.port) && target.port > 0 ? target.port : defaultPort
      if (!allowPublic && !PRIVATE_HOST.test(host)) {
        socket.write('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\n\r\n')
        socket.destroy()
        return
      }
      const key = req.headers['sec-websocket-key']
      if (typeof key !== 'string') { socket.destroy(); return }
      const accept = crypto.createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
      const offered = String(req.headers['sec-websocket-protocol'] ?? '')
      const protocol = offered.split(',').map(value => value.trim()).includes('binary') ? 'binary' : ''
      // permessage-deflate：VNC 的 Raw 帧是未压缩位图，桌面大片纯色，deflate 通常能压到
      // 原来的 5%~15%。局域网带宽不是瓶颈，但 noVNC 解压缩比解析 8.3MB 位图快得多，
      // 掉帧主要来自 WS 分片 + 主线程拷贝，压缩后分片数大幅下降。
      // permessage-deflate 已关闭。
      //
      // 之前的实现有问题：握手时回了 permessage-deflate，但压缩帧不符合 RFC 7692
      // （raw deflate 流的结尾 FFINAL 标记处理不对），浏览器解不开就直接 1006 断连。
      // 而实测压缩对帧率没有任何帮助 —— 真正的瓶颈是 Nagle（已用 setNoDelay 解决），
      // 局域网 57KB/s 根本不需要压缩。所以这里直接不协商扩展，保持最简可靠的链路。
      const wantsDeflate = false
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        ...protocol === '' ? [] : [`Sec-WebSocket-Protocol: ${protocol}`],
        ...wantsDeflate ? ['Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover'] : [],
        '\r\n',
      ].join('\r\n'))

      let handshakeDone = false
      let clientVersionEaten = false
      let pending = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0)
      let frameBuffer = Buffer.alloc(0)
      let fragmented = []
      const toServer = net.createConnection({ host, port })
      toServer.setNoDelay(true)
      // 面向浏览器的这一侧也必须关掉 Nagle。
      // VNC 每帧只有几十 KB（脏区更新），正好落进 Nagle 的「等足够小包再合并」区间，
      // 每帧都白白多等一个 RTT。之前只给 toServer 设了 NoDelay，
      // 结果浏览器侧成了整个链路唯一的缓冲点，实测把 63 fps 拖到 1~2 fps。
      try { socket.setNoDelay(true) } catch { /* 某些平台不支持 */ }
      const closeBoth = () => { try { toServer.destroy() } catch { /* ignore */ } try { socket.destroy() } catch { /* ignore */ } }

      /**
       * 把 RFB 字节发成 WS binary 帧（server→client 帧不带掩码）。
       *
       * 开启 permessage-deflate 时，帧首字节的 RSV1 置位，payload 是「去掉了尾部
       * 00 00 ff ff 的 raw deflate 流」。标准要求必须删掉那 4 字节再做分帧。
       */
      /**
       * 把 RFB 字节发成 WS binary 帧（server→client 帧不带掩码）。
       *
       * 不做压缩：permessage-deflate 已经整体移除（见上面的说明）。
       * 局域网带宽从来不是瓶颈，实测 57KB/s，压不压没区别；
       * 而压缩实现一旦不合 RFC 7692，浏览器会直接 1006 断连。
       */
      const wsSend = (payload) => {
        if (socket.destroyed) return
        const body = payload
        const length = body.length
        let header
        if (length < 126) header = Buffer.from([0x82, length])
        else if (length < 65536) {
          header = Buffer.alloc(4)
          header[0] = 0x82; header[1] = 126; header.writeUInt16BE(length, 2)
        } else {
          header = Buffer.alloc(10)
          header[0] = 0x82; header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2)
        }
        socket.write(Buffer.concat([header, body]))
      }

      const pump = () => {
        for (;;) {
          if (frameBuffer.length < 2) return
          const first = frameBuffer[0]
          const second = frameBuffer[1]
          const masked = (second & 0x80) !== 0
          const opcode = first & 0x0f
          let length = second & 0x7f
          let offset = 2
          if (length === 126) {
            if (frameBuffer.length < 4) return
            length = frameBuffer.readUInt16BE(2); offset = 4
          } else if (length === 127) {
            if (frameBuffer.length < 10) return
            length = Number(frameBuffer.readBigUInt64BE(2)); offset = 10
          }
          const maskOffset = offset
          if (masked) offset += 4
          if (frameBuffer.length < offset + length) return
          const mask = masked ? frameBuffer.subarray(maskOffset, maskOffset + 4) : undefined
          const payload = Buffer.from(frameBuffer.subarray(offset, offset + length))
          frameBuffer = frameBuffer.subarray(offset + length)
          if (mask !== undefined) {
            for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3]
          }
          if (opcode === 0x8) { closeBoth(); return }
          if (opcode === 0x9) {
            if (!socket.destroyed) socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]))
            continue
          }
          if (opcode === 0xa) continue
          if (opcode === 0x0) fragmented.push(payload)
          else if (opcode === 0x1 || opcode === 0x2) fragmented = [payload]
          if ((first & 0x80) !== 0) {
            const message = Buffer.concat(fragmented)
            fragmented = []
            if (handshakeDone) {
              // 纯透传：不改客户端的任何消息。
              // 之前这里把 SetPixelFormat 改写成 16bpp，但服务端不回显，
              // noVNC 仍按 24 位解码，反而更糟。16bpp 已整体回滚。
              toServer.write(message)
            }
            else pending = Buffer.concat([pending, message])
          }
        }
      }

      // 握手期间服务端的字节只属于代理（版本/安全类型/挑战/SecurityResult），
      // 一个字节都不能给浏览器。所以转发监听器在握手完成之后才挂：
      // vncHandshake 独占 data 事件，不会有两个监听器抢同一批字节。
      const startForwarding = () => {
        // ── 帧率节流 ──────────────────────────────────────────────────
        // UltraVNC 抓屏很快：实测 Win 打字节流 86 fps、58 页面滚动 160 fps，
        // 每帧约 100KB，也就是 2.1 MB/s 的字节流量。
        //
        // 带宽不是问题，问题在浏览器：主线程每秒要做 160 次 putImageData +
        // 160 次合成，侧栏里就表现为掉帧、鼠标跟不上。
        //
        // 这里按「完整 FramebufferUpdate 消息」为单位做丢弃：超额的整帧不转发，
        // 但保证每帧要么完整发、要么完整丢 —— 绝不能按字节截断，否则 noVNC
        // 的解析器会错位，画面直接花掉。
        //
        // 关键点：被丢掉的那段时间里画面变化也要能体现，所以节流窗口一过，
        // 下一帧立即放行；不动的时候 UltraVNC 本来就不发包，不受影响。
        const minFrameIntervalMs = maxFps > 0 ? 1000 / maxFps : 0
        let lastForwardAt = 0
        // 攒一个完整的 RFB 消息流再决定发不发。VNC 服务端消息长度不一，
        // 这里只针对 msg-type 0（FramebufferUpdate）做节流，其它消息一律即时转发。
        let pendingMsg = Buffer.alloc(0)
        // 被节流窗口挡下的帧先存在这里，到点后合并成一次发送，绝不丢弃像素。
        const carryOver = []

        /**
         * 把多个 FramebufferUpdate 合并成一个。
         * 每个输入都是完整消息（type 0 开头，内含全部 rect 及其像素数据），
         * 输出是一帧包含所有 rect 的消息。任何异常都返回 null，让调用方走逐帧直发。
         */
        const mergeFrameBufferUpdates = (list) => {
          try {
            const bodies = []
            for (const msg of list) {
              if (msg.length < 4 || msg[0] !== 0) return null
              const rects = msg.readUInt16BE(2)
              // 跳过 4 字节消息头，保留 rect 段落
              bodies.push(msg.subarray(4))
            }
            const totalRects = list.reduce((n, msg) => n + msg.readUInt16BE(2), 0)
            if (totalRects > 65535) return null
            const head = Buffer.alloc(4)
            head[0] = 0
            head.writeUInt16BE(totalRects, 2)
            return Buffer.concat([head, ...bodies])
          } catch {
            return null
          }
        }

        /** 解析缓冲区里能切出多少个完整消息（只处理 msg-type 0/1/2/3）。 */
        const takeCompleteMessages = (src) => {
          const out = []
          let off = 0
          for (;;) {
            if (off >= src.length) break
            const type = src[off]
            if (type === 0) {
              // FramebufferUpdate: type(1) pad(1) rects(2)，然后每个 rect 16 字节头 + 数据
              if (src.length - off < 4) break
              const rects = src.readUInt16BE(off + 2)
              let p2 = off + 4
              let ok = true
              for (let i = 0; i < rects; i++) {
                // RFB 3.8 FramebufferUpdateRectHeader 是 12 字节：
                //   x(2) y(2) width(2) height(2) encoding-type(4)
                // 之前误当成 16 字节、encoding 读 offset 12，会把长度算歪，
                // 结果要么卡住不转发、要么把后续字节当像素 —— 画面直接花掉。
                if (src.length - p2 < 12) { ok = false; break }
                const w = src.readUInt16BE(p2 + 4)
                const h = src.readUInt16BE(p2 + 6)
                const enc = src.readInt32BE(p2 + 8)
                p2 += 12
                // 只支持 Raw(0) 和 CopyRect(1) 的长度推导，其它编码无法安全切分，
                // 遇到就整段放过（不节流），避免解析错位。
                if (enc === 0) {
                  const need = w * h * bytesPerPixel
                  if (src.length - p2 < need) { ok = false; break }
                  p2 += need
                } else if (enc === 1) {
                  if (src.length - p2 < 4) { ok = false; break }
                  p2 += 4
                } else {
                  ok = false
                  break
                }
              }
              if (!ok) break
              out.push({ type, data: src.subarray(off, p2) })
              off = p2
            } else if (type === 1) {
              // SetColourMapEntries：可变长度，无法安全切分，整段放过
              out.push({ type, data: src.subarray(off) })
              off = src.length
            } else if (type === 2) {
              // Bell：定长 1 字节
              out.push({ type, data: src.subarray(off, off + 1) })
              off += 1
            } else if (type === 3) {
              // ServerCutText：type(1) pad(3) len(4) text(len)
              if (src.length - off < 8) break
              const len = src.readInt32BE(off + 4)
              if (len < 0 || src.length - off - 8 < len) break
              out.push({ type, data: src.subarray(off, off + 8 + len) })
              off += 8 + len
            } else {
              // 未知类型：放弃节流，整段直发，宁可卡也不出错
              out.push({ type: -1, data: src.subarray(off) })
              off = src.length
            }
          }
          return { messages: out, rest: src.subarray(off) }
        }

        // 一旦解析出现异常（比如遇到不认识的编码把长度算歪了），
        // 立即永久退回「不节流」模式，保证画面正确优先于流畅。
        let throttleBroken = false

        const flushPending = () => {
          if (pendingMsg.length === 0 || throttleBroken) {
            if (pendingMsg.length > 0) { wsSend(pendingMsg); pendingMsg = Buffer.alloc(0) }
            return
          }
          let parsed
          try {
            parsed = takeCompleteMessages(pendingMsg)
          } catch {
            throttleBroken = true
            wsSend(pendingMsg); pendingMsg = Buffer.alloc(0)
            ctx.logger?.warn?.('[dsh-vnc] 节流解析失败，已退回直通模式')
            return
          }
          const { messages, rest } = parsed
          pendingMsg = Buffer.from(rest)
          for (const m of messages) {
            if (m.type !== 0) { wsSend(m.data); continue }
            const now = Date.now()
            if (minFrameIntervalMs > 0 && now - lastForwardAt < minFrameIntervalMs) {
              // ── 关键：不能直接丢帧 ─────────────────────────────────
              // VNC 的 FramebufferUpdate 是增量补丁，丢掉一帧意味着那部分像素
              // 永远没人补，画面会留下永久的残影（尤其是滚动过的区域）。
              // 所以这里不是「丢弃」，而是「合并推迟」：
              // 把这一帧的 rect 攒进 carryOver，到点后跟下一帧一起发出去。
              // 服务端限制 rects 最多 65535 个，正常场景远达不到。
              carryOver.push(m.data)
              continue
            }
            lastForwardAt = now
            if (carryOver.length > 0) {
              // 把攒下的帧 + 当前帧重新拼成一帧发出去，保证像素不丢。
              const batch = carryOver.splice(0, carryOver.length)
              batch.push(m.data)
              const merged = mergeFrameBufferUpdates(batch)
              if (merged !== null) { wsSend(merged); continue }
              // 合并失败就逐帧原样发，正确性优先
              for (const piece of batch) wsSend(piece)
              continue
            }
            wsSend(m.data)
          }
        }

        // 这个代理是纯透传的：服务端的第一段数据就是 "RFB 003.008\n"，
        // 之后是安全类型、挑战、ServerInit —— 全都由 noVNC 自己处理。
        // 所以节流器不能从连接一开始就解析字节流（那不是 FramebufferUpdate 格式），
        // 必须等真正进入帧阶段再启用。判据：已经看到过 ServerInit。
        //
        // ServerInit = 宽(2) 高(2) 像素格式(16) 名字长度(4) 名字(n)，
        // 它一定在挑战/认证之后出现，是「马上要开始收帧」的可靠信号。
        let framePhase = false
        let initScan = Buffer.alloc(0)

        /** 判断这段数据里是否出现了 ServerInit，出现就切到帧阶段。 */
        const detectFramePhase = (chunk) => {
          initScan = Buffer.concat([initScan, chunk])
          // 粗暴但安全：只要看到合法的 ServerInit 特征就认为进入帧阶段。
          // 宽高非零、bpp 是 8/16/32、trueColour 为 1。
          for (let i = 0; i + 24 <= initScan.length; i++) {
            const w = initScan.readUInt16BE(i)
            const h = initScan.readUInt16BE(i + 2)
            const bpp = initScan[i + 4]
            const depth = initScan[i + 5]
            const trueColour = initScan[i + 7]
            if (w > 0 && w <= 16384 && h > 0 && h <= 16384 &&
                (bpp === 32 || bpp === 16 || bpp === 8) &&
                depth > 0 && depth <= bpp && trueColour === 1) {
              initScan = Buffer.alloc(0)
              return true
            }
          }
          // 不要把整个握手过程都攒在内存里
          if (initScan.length > 65536) initScan = initScan.subarray(initScan.length - 4096)
          return false
        }

        toServer.on('data', (chunk) => {
          if (minFrameIntervalMs === 0) { wsSend(chunk); return }
          if (!framePhase) {
            wsSend(chunk)
            if (detectFramePhase(chunk)) framePhase = true
            return
          }
          pendingMsg = Buffer.concat([pendingMsg, chunk])
          flushPending()
        })
      }
      toServer.on('error', closeBoth)
      toServer.on('close', closeBoth)

      // 客户端在 VNC 握手期间发的键鼠事件先攒着，握手完成后一次性灌进目标机。
      socket.on('data', (chunk) => {
        frameBuffer = Buffer.concat([frameBuffer, chunk])
        pump()
      })
      socket.on('error', closeBoth)
      socket.on('close', closeBoth)

      // 关键设计：不做代理侧握手。
      //
      // 之前是代理替浏览器完成 RFB 握手（版本协商 + VNC Auth），再把 ServerInit 直接推给
      // noVNC。但 noVNC 的 RFB 客户端自己也会发起一轮握手，期待的第一个字节是
      // `RFB 003.008\n`；它收到的是 ServerInit，于是报 "Invalid server version"。
      // 两套握手不可能共存，所以这里退成纯透传：服务端字节原样给浏览器，
      // 浏览器字节原样给服务端，密码由 noVNC 自己拿去算 DES 响应。
      //
      // 代价：config.password 不再由宿主注入，需要前端把密码带给 noVNC。
      void Promise.resolve()
        .then(() => {
          startForwarding()
          handshakeDone = true
          if (pending.length > 0) { toServer.write(pending); pending = Buffer.alloc(0) }
        })
        .catch((error) => {
          // 握手失败：用一条 WS 文本帧把原因带回页面，然后断开。
          const reason = error instanceof Error ? error.message : String(error)
          wsSend(Buffer.from(`[dsh-vnc] ${reason}`, 'utf8'))
          closeBoth()
        })
    },
  }), 'vnc-server: websocket')
}
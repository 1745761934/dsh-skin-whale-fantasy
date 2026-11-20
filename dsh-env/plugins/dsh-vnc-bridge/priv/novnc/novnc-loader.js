/**
 * noVNC 的浏览器端 CommonJS 运行时。
 *
 * 为什么需要它：@novnc/novnc 1.5.0 的 lib/*.js 是 Babel 编译出的 CommonJS
 * （`Object.defineProperty(exports, "__esModule", …)` + `require("./xxx.js")`），
 * 浏览器里直接 `import('/dsh-vnc-novnc/lib/rfb.js')` 会报 `exports is not defined`。
 *
 * 做法：先把整个依赖图（52 个文件）并发抓成文本，再用 Function 包成
 * (exports, require, module) 同步执行。require 全程同步，和 node 语义一致，
 * 循环依赖也能正确处理（先返回已登记的部分导出对象）。
 */
(function () {
  'use strict'

  const BASE = '/dsh-vnc-novnc/lib/'
  const sources = new Map()   // 绝对路径 -> 源码文本
  const modules = new Map()   // 绝对路径 -> module.exports

  /** `./a/b.js`、`../c.js` → `lib` 下的绝对路径。 */
  function resolve(fromPath, request) {
    if (request.startsWith('/')) return request
    const baseDir = fromPath.slice(0, fromPath.lastIndexOf('/') + 1)
    const parts = (baseDir + request).split('/')
    const out = []
    for (const part of parts) {
      if (part === '' || part === '.') continue
      if (part === '..') { out.pop(); continue }
      out.push(part)
    }
    const normalized = '/' + out.join('/')
    return normalized.endsWith('.js') ? normalized : normalized + '.js'
  }

  /** 同步执行一个模块（其源码必须已在 sources 里）。 */
  function execute(path) {
    if (modules.has(path)) return modules.get(path)
    const source = sources.get(path)
    if (source === undefined) throw new Error(`noVNC 源文本缺失：${path}`)

    const module = { exports: {} }
    modules.set(path, module.exports)  // 先登记，循环依赖时能拿到部分导出

    function localRequire(request) {
      const target = resolve(path, request)
      return execute(target)
    }

    // eslint-disable-next-line no-new-func
    const factory = new Function('exports', 'require', 'module', '__filename', '__dirname', source)
    factory(module.exports, localRequire, module, path, path.slice(0, path.lastIndexOf('/')))
    modules.set(path, module.exports)
    return module.exports
  }

  /** 并发抓取整个依赖图，再用 file 指定的入口完成同步加载。 */
  async function boot(entry) {
    const index = await fetch(BASE + 'index.json', { credentials: 'same-origin' })
      .then((res) => { if (!res.ok) throw new Error(`noVNC 文件清单读取失败 HTTP ${res.status}`); return res.json() })
    const fetched = await Promise.all(index.map(async (file) => {
      const res = await fetch(BASE + file, { credentials: 'same-origin' })
      if (!res.ok) throw new Error(`noVNC 模块加载失败：${file} HTTP ${res.status}`)
      return [BASE + file, await res.text()]
    }))
    for (const [path, text] of fetched) sources.set(path, text)
    return execute(BASE + entry)
  }

  window.__dshNoVnc = { boot, execute, resolve, sources, modules, BASE }
})()

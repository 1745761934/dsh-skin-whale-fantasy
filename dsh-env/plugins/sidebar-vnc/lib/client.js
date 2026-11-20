window.__ModuleLoader__.load({
  id: '@deepseek-ai/dsh-client-ui-sidebar-vnc',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const KIND = 'vnc'
    const TAB_ID = '@deepseek-ai/dsh-client-ui-sidebar-vnc'
    const NAMESPACE = 'sidebarVnc'
    // 默认值不能靠 window.location 猜：这个 Electron 宿主里 location.hostname 是伪主机名
    // "harness"，拼出来连不上。改为启动时向宿主插件要一次真实端点（它知道自己的监听地址），
    // 拿到之前先用 127.0.0.1:<当前端口> 兜底。
    const FALLBACK_HOST = '127.0.0.1'
    const DEFAULT_PORT = '43129'

    function localOrigin() {
      // 主机名一律用 127.0.0.1：Electron 里 location.hostname 是伪装值，不可信。
      const port = window.location.port
      return `${FALLBACK_HOST}:${port === '' ? DEFAULT_PORT : port}`
    }

    function defaultUrl() {
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${scheme}//${localOrigin()}/dsh-vnc`
    }

    /**
     * 向宿主插件要真实端点。宿主在 /dsh-vnc 返回 JSON，里面的 origin 字段是它眼里的
     * 本机访问地址；拿不到就沿用 localOrigin()。
     */
    async function resolveEndpoint() {
      try {
        const res = await fetch('/dsh-vnc', { credentials: 'same-origin' })
        if (!res.ok) return defaultUrl()
        const info = await res.json()
        const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        // 宿主回报的 origin 是它眼里的监听地址（127.0.0.1:端口），优先采用。
        const authority = typeof info?.origin === 'string' && info.origin !== ''
          ? info.origin
          : localOrigin()
        const query = typeof info?.defaultHost === 'string' && info.defaultHost !== ''
          ? `?host=${encodeURIComponent(info.defaultHost)}&port=${encodeURIComponent(info.defaultPort ?? 5900)}`
          : ''
        return `${scheme}//${authority}/dsh-vnc${query}`
      } catch {
        return defaultUrl()
      }
    }

    // noVnc 客户端资源：优先本包 priv/novnc，服务器没找到会回退 @novnc/novnc。
    const NOVNC_PATH = '/dsh-vnc-novnc/lib/rfb.js'

    const zh = {
      title: '远程桌面',
      'guide.title': '远程桌面',
      'guide.description': '在侧栏里控制另一台电脑（VNC）',
      'empty.title': '连接远程电脑',
      'empty.hint': '目标机先开 VNC 服务端（交互用户身份，不是 Windows 服务），这里只填 ws(s) 地址；密码在宿主插件 config.password 里配。',
      'field.url': 'WebSocket 地址',
      'field.hint': '/dsh-vnc?host=192.168.1.20&port=5900（密码只配在宿主插件 config.password，URL 不接受 password）',
      'field.scale': '适应侧栏',
      'action.connect': '连接',
      'action.disconnect': '断开',
      'action.screenshot': '截屏',
      'state.connecting': '正在连接…',
      'state.connected': '已连接',
      'state.closed': '已断开',
      'error.bad-url': '地址必须是以 ws:// 或 wss:// 开头的 WebSocket 地址。',
      'error.failed': '连接失败：{message}',
      'error.security': '服务端拒绝了 VNC 安全类型（多半是密码/加密策略）。',
    }

    const en = {
      title: 'Remote desktop',
      'guide.title': 'Remote desktop',
      'guide.description': 'Control another computer from the Sidebar (VNC)',
      'empty.title': 'Connect a remote computer',
      'empty.hint': 'Run a VNC server on the target, then enter its ws(s) address here.',
      'field.url': 'WebSocket address',
      'field.hint': '/dsh-vnc?host=192.168.1.20&port=5900 (the password lives in the host plugin config.password; URL password is rejected)',
      'field.scale': 'Fit',
      'action.connect': 'Connect',
      'action.disconnect': 'Disconnect',
      'action.screenshot': 'Capture',
      'state.connecting': 'Connecting…',
      'state.connected': 'Connected',
      'state.closed': 'Disconnected',
      'error.bad-url': 'The address must start with ws:// or wss://.',
      'error.failed': 'Connection failed: {message}',
      'error.security': 'The server refused the offered VNC security types.',
    }

    const style = {
      root: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0, minHeight: 0, height: '100%' },
      toolbar: { display: 'flex', alignItems: 'center', gap: 4, flex: 'none', height: 38, padding: '5px 6px', boxSizing: 'border-box', borderBottom: '0.5px solid var(--dsw-alias-border-l3)' },
      tool: { height: 28, minWidth: 28, padding: '0 8px', flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 6, background: 'transparent', cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)', font: 'var(--dsw-font-xxs-12)' },
      toolOn: { color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-interactive-bg-hover)' },
      address: { flex: '1 1 auto', minWidth: 0, height: 28, padding: '0 8px', boxSizing: 'border-box', border: '0.5px solid var(--dsw-alias-border-l3)', borderRadius: 6, background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', font: 'var(--dsw-font-xxs-12)', outline: 'none' },
      status: { flex: 'none', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-tertiary)', font: 'var(--dsw-font-xxs-12)' },
      content: { position: 'relative', display: 'flex', flex: '1 1 auto', minWidth: 0, minHeight: 0, background: '#000' },
      screen: { flex: '1 1 auto', minWidth: 0, minHeight: 0, width: '100%', height: '100%', display: 'flex', background: '#000' },
      notice: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, overflow: 'auto', textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)', font: 'var(--dsw-font-xs-13)', background: 'var(--dsw-alias-bg-base)' },
      noticeTitle: { margin: 0, color: 'var(--dsw-alias-label-primary)', font: 'var(--dsw-font-xs-13)' },
      failure: { flex: 'none', padding: '4px 8px', color: 'var(--dsw-alias-state-error-primary)', font: 'var(--dsw-font-xxs-12)', background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent)' },
    }

    function format(template, values) {
      return template.replace(/\{(\w+)\}/g, (whole, key) => (key in values ? String(values[key]) : whole))
    }

    /**
     * noVnc 按需加载。
     *
     * @novnc/novnc 1.5.0 的 lib/*.js 是 CommonJS（exports + require），浏览器 import() 会报
     * `exports is not defined`。服务端已预生成单文件 bundle（52 个模块内联 + 内置 CJS 运行时），
     * 这里用同步 XHR 取回文本再 new Function 求值 —— 同步是刻意的：
     * 侧栏组件要求首帧就有 RFB，异步脚本会赶不上，而 bundle 只有 ~690KB，同源本地读取很快。
     */
    const BUNDLE_URL = '/dsh-vnc-novnc/novnc-bundle.js'
    // 密码由宿主插件在 /dsh-vnc 的 status 里给出（proxyPassword 字段），
    // 页面启动时取一次缓存起来；取不到就留空，noVNC 会自己弹密码框。
    let PASSWORD = ''

    let novncLoading
    function loadNoVnc() {
      if (novncLoading !== undefined) return novncLoading
      novncLoading = (async () => {
        try {
          if (window.__dshNoVncBundle === undefined) {
            const response = await fetch(BUNDLE_URL, { credentials: 'same-origin' })
            if (!response.ok) throw new Error(`bundle HTTP ${response.status}`)
            const source = await response.text()
            // eslint-disable-next-line no-new-func
            new Function(source).call(window)
          }
          const bundle = window.__dshNoVncBundle
          if (bundle === undefined || typeof bundle.RFB !== 'function') {
            throw new Error('bundle 求值后 RFB 不可用')
          }
          return { default: bundle.RFB, RFB: bundle.RFB }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          console.error('[dsh-vnc] noVnc bundle 加载失败:', detail, error)
          throw new Error(`noVnc 加载失败：${detail}`)
        }
      })()
      return novncLoading
    }

    /** 会话与 React 解耦：tab 切走但 keepMounted 时连接不断。 */
    const sessions = new Map()

    function sessionFor(tabId) {
      let session = sessions.get(tabId)
      if (session === undefined) {
        session = {
          container: undefined,
          rfb: undefined,
          url: undefined,
          phase: 'idle',
          listeners: new Set(),
          set(phase) {
            session.phase = phase
            for (const listener of session.listeners) listener(phase)
          },
          subscribe(listener) {
            session.listeners.add(listener)
            return () => { session.listeners.delete(listener) }
          },
          async connect(url) {
            if (PASSWORD === '') {
              try {
                const res = await fetch('/dsh-vnc', { credentials: 'same-origin' })
                if (res.ok) {
                  const info = await res.json()
                  if (typeof info.proxyPassword === 'string') PASSWORD = info.proxyPassword
                }
              } catch { /* 取不到就走 noVNC 自己的密码框 */ }
            }
            const diag = (window.__dshVncDiag = { steps: [] })
            const mark = (step, extra) => { diag.steps.push({ step, extra, t: Date.now() }); console.log('[dsh-vnc diag]', step, extra ?? '') }
            session.url = url
            session.set('connecting')
            mark('url', url)
            let loaded
            try {
              loaded = await loadNoVnc()
            } catch (error) {
              mark('loadNoVnc-FAIL', error instanceof Error ? error.message : String(error))
              throw error
            }
            mark('loadNoVnc-OK', typeof (loaded.default ?? loaded.RFB))
            const RFB = loaded.default?.default ?? loaded.default ?? loaded.RFB
            if (typeof RFB !== 'function') throw new Error('noVnc RFB class is unavailable')
            try { session.rfb?.disconnect() } catch { /* 老连接可能已经死了 */ }
            const host = session.container
            mark('container', host === undefined ? 'UNDEFINED' : host.tagName)
            if (host === undefined || host === null) {
              throw new Error('连接容器未就绪（session.container 为空）')
            }
            host.replaceChildren()
            const rfb = new RFB(host, url, {
              wsProtocols: ['binary'],
              // 代理已改成纯透传，VNC Auth 的 DES 响应由 noVNC 自己算，所以要给它密码。
              credentials: { password: PASSWORD },
            })
            // 性能相关的客户端参数：
            // - compressionLevel / qualityLevel 只影响 Tight/JPEG 系编码，Raw 下无效，
            //   但保留低值对将来换服务端有好处。
            // - showDotCursor 关掉，省掉每帧的鼠标合成。
            // - 缩放交给 CSS：viewportScale 用 GPU 合成，比 noVNC 手工 resize 便宜。
            // 注意：这里不要碰 rfb._display。
            // RFB 构造完之后 _display 仍是 null，要等 connect 事件里才初始化，
            // 之前在这里写 getPrototypeOf(rfb._display) 会直接抛 TypeError，
            // 整个连接流程中断 —— 表现就是「侧栏连不上」。
            // 而且实测渲染队列本身不是瓶颈（putImageData 累计只花 2ms），
            // 真凶是代理那侧缺 setNoDelay，所以这里不需要任何渲染 patch。
            rfb.compressionLevel = 2
            rfb.qualityLevel = 6
            rfb.showDotCursor = false
            rfb.scaleViewport = true
            rfb.clipViewport = true
            rfb.focusOnClick = true
            rfb.background = '#000'
            rfb.addEventListener('connect', () => { session.set('connected') })
            rfb.addEventListener('disconnect', (event) => {
              session.rfb = undefined
              session.set(event?.detail?.clean === false ? 'error' : 'closed')
            })
            rfb.addEventListener('securityfailure', () => { session.set('security') })
            session.rfb = rfb
          },
          disconnect() {
            try { session.rfb?.disconnect() } catch { /* ignore */ }
            session.rfb = undefined
            session.set('closed')
          },
          screenshot() {
            const canvas = session.container?.querySelector('canvas')
            if (canvas === null || canvas === undefined) return
            const link = document.createElement('a')
            link.download = `remote-${Date.now()}.png`
            link.href = canvas.toDataURL('image/png')
            link.click()
          },
        }
        sessions.set(tabId, session)
      }
      return session
    }

    function VncBody(props) {
      const t = props.t
      const tabId = props.tab?.id ?? 'vnc'
      const viewportId = React.useId()
      const [phase, setPhase] = React.useState('idle')
      const [url, setUrl] = React.useState(defaultUrl())
      const [error, setError] = React.useState(undefined)
      const [fit, setFit] = React.useState(true)
      const session = sessionFor(tabId)

      React.useLayoutEffect(() => {
        const host = document.getElementById(viewportId)
        if (host === null) return undefined
        session.container = host
        const unsubscribe = session.subscribe(setPhase)
        setPhase(session.phase)
        // 打开 tab 就直接连，不需要额外点一次「连接」。
        // 只有第一次（idle）才自动连，断开后不会反复重连。
        if (session.phase === 'idle') {
          void resolveEndpoint().then((endpoint) => {
            setUrl(endpoint)
            void start(endpoint)
          })
        }
        return () => { unsubscribe() }
      }, [viewportId, session])

      function connect() {
        void start(url.trim())
      }

      /** 真正的连接：把 http(s)/相对路径统一成 ws(s)，然后交给 session。 */
      async function start(raw) {
        raw = raw.trim()
        let parsed
        try {
          parsed = new URL(raw, window.location.href)
        } catch {
          setError(t('error.bad-url'))
          return
        }
        // 容忍 http(s):// 和纯路径：同源代理本来就是 /dsh-vnc，用户往往直接粘 http 地址。
        if (parsed.protocol === 'http:') parsed.protocol = 'ws:'
        else if (parsed.protocol === 'https:') parsed.protocol = 'wss:'
        if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
          setError(t('error.bad-url'))
          return
        }
        setError(undefined)
        try {
          await session.connect(parsed.toString())
        } catch (reason) {
          setPhase('error')
          setError(format(t('error.failed'), { message: reason instanceof Error ? reason.message : String(reason) }))
        }
      }

      const adjust = (next) => {
        setFit(next)
        if (session.rfb !== undefined) {
          session.rfb.scaleViewport = next
          session.rfb.clipViewport = next
        }
      }

      const status = phase === 'connecting' ? t('state.connecting')
        : phase === 'connected' ? t('state.connected')
          : phase === 'security' ? t('error.security')
            : phase === 'closed' || phase === 'error' ? t('state.closed') : ''

      const button = (label, onClick, options = {}) => React.createElement('button', {
        type: 'button',
        style: options.toggled ? { ...style.tool, ...style.toolOn } : style.tool,
        title: label,
        disabled: options.disabled === true,
        'aria-pressed': options.toggled,
        onClick,
      }, label)

      return React.createElement('div', { style: style.root },
        React.createElement('form', {
          style: style.toolbar,
          onSubmit: (event) => { event.preventDefault(); connect() },
        },
        React.createElement('input', {
          style: style.address, value: url, spellCheck: false, placeholder: t('field.url'), 'aria-label': t('field.url'),
          title: t('field.hint'),
          onChange: (event) => { setUrl(event.currentTarget.value) },
        }),
        button(t('action.connect'), connect, { toggled: true }),
        button(t('action.disconnect'), () => { session.disconnect() }, { disabled: phase !== 'connected' && phase !== 'connecting' }),
        button(t('action.screenshot'), () => { session.screenshot() }, { disabled: phase !== 'connected' }),
        button(t('field.scale'), () => { adjust(!fit) }, { toggled: fit }),
        status !== '' && React.createElement('span', { style: style.status }, status),
        ),
        error !== undefined && React.createElement('div', { style: style.failure, role: 'alert' }, error),
        React.createElement('div', { style: style.content },
          React.createElement('div', { id: viewportId, style: style.screen }),
          phase === 'idle' && React.createElement('div', { style: style.notice },
            React.createElement('p', { style: style.noticeTitle }, t('empty.title')),
            React.createElement('p', { style: { margin: 0 } }, t('empty.hint')),
          ),
        ),
      )
    }

    function VncTitle(props) {
      return React.createElement('span', null, props.t('title'))
    }

    /** 侧栏引导卡图标：显示器 + 双箭头，固定色，和内置 Browser/Files 卡片同风格。 */
    function RemoteScreenArtwork({ size = 36 }) {
      return React.createElement('svg', {
        width: size, height: size, viewBox: '0 0 36 36', fill: 'none', 'aria-hidden': 'true',
        xmlns: 'http://www.w3.org/2000/svg',
      },
      React.createElement('rect', { x: 6.5, y: 9, width: 23, height: 15, rx: 2.5, stroke: '#5AC8FA', strokeWidth: 2 }),
      React.createElement('path', { d: 'M15 29h6M18 24.5V29', stroke: '#5AC8FA', strokeWidth: 2, strokeLinecap: 'round' }),
      React.createElement('path', { d: 'M13 14.6 17 18.2l-4 3.6', stroke: '#539CFA', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      React.createElement('path', { d: 'M19.5 21.8h4.4', stroke: '#539CFA', strokeWidth: 2, strokeLinecap: 'round' }),
      )
    }

    function apply(ctx) {
      const namespace = NAMESPACE
      const t = ctx.locale.bind(namespace)
      ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'ui-sidebar-vnc.copy')
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: KIND,
        multiple: true,
        keepMounted: true,
        priority: 'builtin',
        title: () => t('title'),
        guide: [{
          id: 'new', order: 40, icon: RemoteScreenArtwork,
          title: () => t('guide.title'),
          description: () => t('guide.description'),
        }],
      }), 'ui-sidebar-vnc.type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab', key: TAB_ID, locale: namespace,
      }, VncBody)), 'ui-sidebar-vnc.body')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: namespace,
      }, VncTitle)), 'ui-sidebar-vnc.title')
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs']
    return module.exports
  },
})

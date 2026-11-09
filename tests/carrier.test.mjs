/**
 * 载体体检：括号配平 + 8 处关键修复是否还在。
 * 任意一条丢失就 red，避免后续改动把可读性补丁悄悄弄没。
 */
import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'skin')
const css = readFileSync(join(ROOT, 'skin.css'), 'utf8')

const open = (css.match(/{/g) || []).length
const close = (css.match(/}/g) || []).length
assert.equal(open, close, `大括号不配平：${open} vs ${close}`)
assert.ok(!/<script|@import|javascript:/i.test(css), '载体里出现了可执行内容')
assert.ok(css.length > 8000, `载体疑似被截断（${css.length} 字节）`)

const required = [
  ['壁纸壳透明', /html,\s*body\s*\{[^}]*background-color:\s*transparent/s],
  ['#dsvs-backdrop 反制', /#dsvs-backdrop/],
  ['面板暗玻璃 0.26', /rgba\(12,\s*15,\s*22,\s*0\.26\)/],
  ['flowItem 0.18', /rgba\(20,\s*22,\s*28,\s*0\.18\)/],
  ['正文浅墨', /#eef3fa/],
  ['行内代码', /#d8ecff/],
  ['侧栏层级', /sectionLabel/],
  ['输入区缓升渐隐', /composerSeat/]
]
for (const [name, re] of required) assert.match(css, re, `缺少关键规则：${name}`)

console.log(`carrier ok — ${css.length} 字节，${open} 条规则块，8/8 关键项`)

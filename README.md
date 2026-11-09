# dsh-skin-whale-fantasy

**给 DSH Desktop 的「鲸鱼娘 · 幻想壁纸」皮肤 —— 装上就能用，不用再自己调 CSS。**

深色壁纸会把 DSH 浅色主题的近黑正文吞掉，这个仓库做的事就一件：**把壁纸后面的每一处界面都重新调成能看清**，同时把安装做成一条命令，不再出现「别人装了能用、我装了翻车」。

![预览](docs/preview.png)

> 预览是**合成示意图**，只表示层级与配色（玻璃侧栏 / 暗玻璃面板 / 浅色墨正文 / 缓升渐隐的输入区），不含任何真实会话内容。

---

## 一键安装

要求：DSH Desktop **0.13.0 及以上**、Node.js **≥ 20**（DSH 自带运行时也算）。

```bash
git clone https://github.com/1745761934/dsh-skin-whale-fantasy.git
cd dsh-skin-whale-fantasy

node scripts/apply-whale-fantasy.mjs          # 安装 / 升级，幂等
node scripts/apply-whale-fantasy.mjs --check  # 只体检，不改动
node scripts/apply-whale-fantasy.mjs --uninstall
```

装完**完全退出 DSH Desktop**（⌘Q 或托盘退出）再打开一次。插件与路由不走热更新，只刷新窗口不生效——这一步漏掉就会误以为「没装上」。

脚本自己找 `harness` 目录（macOS / Linux / Windows 三个位置都试），找不到就报出它找过的路径；多 profile 时用 `DSH_PROFILE=... node scripts/apply-whale-fantasy.mjs` 指定。

### 脚本到底改了什么

| 动作 | 目标 | 说明 |
| --- | --- | --- |
| 拷包 | `<profile>/node_modules/dsh-skin-whale-fantasy/` | 旧版本先备份到 `*.bak-whale-<时间戳>` |
| 插一行 | `<profile>/cordis.patch.yml` | 只加 `- insert: {id: skin-whale-fantasy, name: dsh-skin-whale-fantasy}`，改前留 `.bak-whale-<时间戳>` |
| 写壁纸配置 | `<harness>/dsh-video-skin.json` | **仅在检测到 `dsh-video-skin` 时**写；没有就整段跳过 |
| 自检 | — | 逐条检查 8 处关键修复是否落在载体里，缺哪条直接打 ✗ |

不碰 DSH 本体（`/Applications/DSH Desktop.app` 一个字节都不动），不改别的插件源码，`index.js` 与本仓库逐字节一致。

---

## 为什么「别人能用我这边不行」

皮肤的载体是一张 `skin.css`。DSH 会把主题 token 以 `<style>` 插在皮肤样式表**之后**，于是：

1. **同特异性下后写的赢** —— 所以所有覆盖必须带 `!important`，且要同时打浅色与深色两套调色板。
2. **容器继承色不能证明文字可见** —— 父节点报 `rgb(230,235,243)`，子节点照样可能自己算成 `rgb(15,17,21)`（近黑）。必须逐个叶子节点查 `color`。
3. **`::after` 叠层经常画不出来** —— 站点自带的 `!important` 优先，直接设 `background` / `backdrop-filter` 反而稳。
4. **类名是哈希** —— `wSkVaW_root`、`EvIC1a_flowItem` 这类会随构建变，所以选择器一律走 `[class*='_composerSeat']`、`[class$='_sidebarCol']` 这种结构特征，而不是整串哈希。
5. **参考窗口尺寸会骗人** —— 1440×757 下没事，换到 1440×614 就会露出被 `_composerSeat` 渐变压出来的整条横带。

---

## 这一版修了什么（相对上游逐项）

上游皮肤只做「把背景铺开」，没处理深壁纸下的可读性。1.1.0 补的是下面这些：

### 可读性 / 墨色

| 位置 | 上游量到的值 | 现在 |
| --- | --- | --- |
| 会话正文、列表、引用 | `rgb(15,17,21)`（近黑，等于隐形） | `#eef3fa` |
| 会话小标题 `h1–h6` | 近黑 | `#ffffff` |
| 行内代码 / 状态 chip | 浅字压深灰块，糊成一片 | `#d8ecff` + `rgba(255,255,255,.14)` 底 + 1px 白边 |
| 文件引用、链接 | `#4176e6`（深蓝压深底） | `#8fc4ff` |
| 输入框占位符 | 近黑 | `#c3ccda` |
| 输入区底部「完全权限 / 回退 / 模型名」 | `#61666b` | `#b9c2cf` |
| 底部统计行 | 近黑 | `#e6ebf3` |
| 顶部标签页（标准模式 / 各类模式） | 近黑 | 浅灰白 |
| 代码块（` ```yaml ` 这类围栏） | 深底压近黑字，基本看不见 | 深玻璃 `rgba(10,14,22,.82)` + 1px 白边 + 浅色等宽字 |

### 侧栏层级

上游四类文字**全是** `rgb(232,234,240)`，整列糊成一片，看不出主次。现在分四档：

- 导航（工作台 / 插件 / 自动化任务 / 更多）`#dfe6ef`
- 会话标题 `#b9c4d3`，选中态 `#ffffff`
- 时间戳 `#86909f`
- 分组名（工作区 / 未分组）`#7f8a9a` + 600 字重

### 结构性 bug（这两条最容易让别人「装上就废」）

1. **注入的壁纸层没有定位** —— `index.js` 会 `body.prepend` 一个 `<div data-dsh-skin-layer="background">` 里塞 `<video>`，但插件自己没给它任何 CSS。只要别的皮肤/运行时不再顺手接管这一层，它就退化成「0 宽、视频按原始比例撑出 859px 高」的文档流块，**把 `#root` 整个顶到第二屏**——用户看到的就是「界面只剩壁纸」。本版把它钉成 `position: fixed; inset: 0; z-index: -1` + `video { object-fit: cover }`，任何环境下都不再挤占布局。
2. **`patches.css` 是必需文件** —— 样式路由无条件 `readFile(patches.css)` 再与 `skin.css` 拼接，文件缺一个就直接 `500`，整张皮肤表加载失败。本仓库保留一个空壳文件并在安装脚本里强制拷贝。

### 残影 / 硬边

- **输入区底座渐隐**：原来 40px 就冲到 `0.78`，在首页会拉出一整条可见横带 → 改成 0 → 0.34 → 0.72 整段缓升。
- **面板暗玻璃**：`rgba(12,15,22,0.26)`，消息卡再叠 `rgba(20,22,28,0.18)`；更早的版本用过 `0.55` 不透明块，会在壁纸上压出硬边矩形，已删。
- **浅色面纱**：`html[data-dsvs]` 下 `#dsvs-backdrop` 被上游 `runtime/skin.css` 刷成 `rgb(238,241,245)`，顶部整条发白 → 反制成 `#0e1116`。
- **面板 / 侧栏 / 根节点**：全部透明化，壁纸才能真正透到界面底下。
- **文字投影**：`EvIC1a_frame` 上 0 1px 2px 的暗投影，细字压在亮水面上也读得出来。

---

## 出处与来源

本仓库是**衍生工作**，不是从零写的皮肤：

| 组成 | 来源 | 许可 |
| --- | --- | --- |
| 皮肤本体、宿主插件 `index.js`、壁纸素材 | 上游 `dsh-skin-whale-fantasy` v1.0.0 | CC-BY-NC-SA-4.0（作者声明） |
| 壁纸/启动动画运行时（可选依赖） | [`Something11235/dsh-video-skin`](https://github.com/Something11235/dsh-video-skin) v0.1.6 · MIT | MIT |
| 启动动画（可选） | [`Alice-Marx/dsh-boot-animation`](https://github.com/Alice-Marx/dsh-boot-animation) v0.3.0 · MIT | MIT |
| 可读性补丁、安装脚本、本文档 | 本仓库 | MIT |

壁纸素材沿用上游 **CC-BY-NC-SA-4.0**：可以自用、可以改、要署名、不能商用、衍生同样开源。`index.js` 原样保留、未做任何改动；所有视觉修复都写在 `skin.css` 这一张数据表里，宿主插件只当它是个静态资源。

上游素材下载地址（原样保留，便于核对）：
`https://acgay.oss-cn-hangzhou.aliyuncs.com/dsh-skins/whale-wallpaper/assets/`

---

## 目录结构

```
skin.css                          载体：全部视觉规则都在这张表里
index.js                          宿主插件（与上游逐字节一致，未改）
cordis.patch.yml                  插入一行的补丁描述
patches.css                       必须存在的空壳（插件 handler 无条件读取它，缺文件整张表 500）
assets/                           皮肤素材（壁纸循环、设置页背景）
preview/preview-schematic.png     皮肤中心用的小图（合成示意）
scripts/apply-whale-fantasy.mjs   安装 / 体检 / 卸载
tests/carrier.test.mjs            载体自检（CI 也跑这个）
docs/preview.png                  本 README 的预览图
package.json                      DSH 插件清单（dsh.bundle.patch 指向 cordis.patch.yml）
```

## 兼容性

- DSH Desktop **0.13.0**（Electron），macOS 已验证；Linux / Windows 由脚本按各自 `harness` 路径适配，未逐台实机验证。
- 类名是构建哈希，DSH 大版本升级后若哈希全变，`[class*='...']` 这类结构选择器通常仍能命中；命中不了的部分按上文的排查顺序补（先查叶子节点 `color` → 再查哪个祖先在 `background` 上刷了不透明色 → 最后看 `::after`）。
- 与 `dsh-video-skin` 的 `veil` / `veilLight` / `surface` 是两套独立旋钮：皮肤管「元素级」着色，运行时管「全局」蒙层。壁纸发白时先调运行时的 `veilLight`，不要加在皮肤里。

## 更新记录

### 1.1.1

- 修：注入壁纸层无定位导致 `#root` 被顶到第二屏（见上文「结构性 bug」第 1 条）
- 修：`patches.css` 缺失导致样式路由 500
- 修：代码块在深壁纸下几乎不可读
- 安装脚本：只补缺失的 `dsh-video-skin` 配置键，不再覆盖用户已调好的 `veil` / `veilLight`
- 自检扩到 10 项，CI 同步

### 1.1.0

- 正文 / 标题 / 行内代码 / 链接 / 占位符 / 统计行改为浅色墨
- 侧栏四档层级
- 输入区底座渐隐改为整段缓升，去掉首页可见横带
- `#dsvs-backdrop` 反制浅色面纱
- 新增安装脚本、载体自检与 CI

## 许可

代码部分 MIT（见 [LICENSE](LICENSE)）；素材部分沿用上游 CC-BY-NC-SA-4.0。转载、二次分发请保留本节的出处表。

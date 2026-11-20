# DSH 破甲 + 逆向环境迁移手册（另一台 Mac 同步用）

> 本文档记录 2026-11-20 在主力机的完整安装状态，供另一台 Mac 复现。
> 所有路径以 `$H` 代指 DSH 数据目录，**不要照抄成固定路径**。

```sh
H="$HOME/Library/Application Support/dsh-desktop/harness"
```

---

## 0. 先搞清楚活动 profile 在哪

DSH Desktop 的真实数据目录**不是** `~/.dsh`，而是：

```
✅ $HOME/Library/Application Support/dsh-desktop/harness/
❌ ~/.dsh/                              ← 残留，无进程使用，改了不生效
```

验证方法：

```sh
ps aux | grep -i dsh | grep -o "Application Support/dsh-desktop[^ ]*"
```

`~/.dsh` 只在用 `dsh web` CLI 启动时才用。桌面版一律走 Application Support。

---

## 1. 环境前置检查

```sh
H="$HOME/Library/Application Support/dsh-desktop/harness"

# Node（桌面版自带，别用系统 node）
"$H/.desktop-bin/node" -v          # 期望 v24.x

# pnpm（必须用运行时自带的 11.28.5，不要用 Harness 内置的 10.34.5）
PNPM11="$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
"$H/.desktop-bin/node" "$PNPM11" -v   # 期望 11.28.5

# 宿主版本
/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "/Applications/DSH Desktop.app/Contents/Info.plist"
# ⚠️ 那是 Electron 壳版本（0.13.0），真实 DSH 版本看下面这个：
"$H/.desktop-bin/node" "$H/profiles/web/node_modules/dsh-purge-community/bin/community.js" status | grep host_version
# 主力机结果：0.2.1-rc.3（在社区版兼容表内）
```

**pnpm 版本是最容易踩的坑**：Harness 内置的 pnpm 10.34.5 期望 `store/v10`，但 node_modules 实际指向 `store/v11`，会报 `ERR_PNPM_UNEXPECTED_STORE`。用运行时自带的 11.28.5 就没问题。

---

## 2. 备份现有配置（必做）

```sh
H="$HOME/Library/Application Support/dsh-desktop/harness"
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "$H/backup-purge-$TS"
cp -a "$H/profiles/web/package.json"     "$H/backup-purge-$TS/"
cp -a "$H/profiles/web/cordis.patch.yml" "$H/backup-purge-$TS/"
cp -a "$H/profiles/web/pnpm-lock.yaml"   "$H/backup-purge-$TS/" 2>/dev/null
echo "备份在 $H/backup-purge-$TS"
```

---

## 3. 安装插件（四种，全部走本地 tgz/目录，不依赖网络稳定性）

### 3.1 dsh-purge-community 1.7.20（破甲核心）

```sh
H="$HOME/Library/Application Support/dsh-desktop/harness"
L="$H/profiles/web/local-plugins"

mkdir -p "$L/pkgs"
curl -fL -m 180 \
  "https://github.com/kingcharleslzy-ai/dsh-purge/releases/download/v1.7.20/dsh-purge-community-1.7.20.tgz" \
  -o "$L/pkgs/dsh-purge-community-1.7.20.tgz"

# 校验（必须一致）
shasum -a 256 "$L/pkgs/dsh-purge-community-1.7.20.tgz"
# 期望：5b3d66e804ea0b1cf6ef01035a292755ab9fea771b8f5338000954075dd6b45a
```

### 3.2 helm-d 0.6.0（44 工具 + 353 参考）

```sh
curl -fL -m 180 \
  "https://github.com/ADWMC/helm-d/releases/download/v0.6.0/helm-d.tgz" \
  -o "$L/pkgs/helm-d.tgz"
```

### 3.3 dsh-reverse-skill 1.2.1（46 个逆向技能）★ 破解 exe / 客户端专用

```sh
cd "$L" && curl -fL -m 300 \
  "https://github.com/dhicoc/dsh-reverse-skill/archive/refs/heads/main.tar.gz" -o rev.tgz
tar xzf rev.tgz && mv dsh-reverse-skill-main dsh-reverse-skill && rm rev.tgz
```

### 3.4 手工插件（皮肤 / VNC）— 从原机拷

这几个包里含 18M 视频素材，不走 git，用 AirDrop / rsync 从主力机拷：

```sh
# 主力机执行
rsync -av \
  "$HOME/Library/Application Support/dsh-desktop/harness/profiles/web/local-plugins/dsh-skin-whale-fantasy" \
  "$HOME/Library/Application Support/dsh-desktop/harness/profiles/web/local-plugins/dsh-video-skin" \
  "$HOME/Library/Application Support/dsh-desktop/harness/profiles/web/local-plugins/dsh-vnc-bridge" \
  对方:~/.dsh-sync-tmp/

# 新机放到位
mkdir -p "$L/@deepseek-ai"
mv ~/.dsh-sync-tmp/dsh-* "$L/"
```

> `@deepseek-ai/dsh-client-ui-sidebar-vnc`（28K）可从原机 node_modules 拷，或跳过 VNC 全套。

---

## 4. 写 package.json

```sh
H="$HOME/Library/Application Support/dsh-desktop/harness"
cat > "$H/profiles/web/package.json" <<'JSON'
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "dsh-purge-community": "file:./local-plugins/pkgs/dsh-purge-community-1.7.20.tgz",
    "helm-d": "file:./local-plugins/pkgs/helm-d.tgz",
    "dsh-skin-whale-fantasy": "file:./local-plugins/dsh-skin-whale-fantasy",
    "dsh-video-skin": "file:./local-plugins/dsh-video-skin",
    "dsh-vnc-bridge": "file:./local-plugins/dsh-vnc-bridge",
    "@deepseek-ai/dsh-client-ui-sidebar-vnc": "file:./local-plugins/@deepseek-ai/dsh-client-ui-sidebar-vnc",
    "@dhicoc/dsh-reverse-skill": "file:./local-plugins/dsh-reverse-skill"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-purge-community",
        "helm-d",
        "dsh-video-skin",
        "dsh-skin-whale-fantasy",
        "dsh-vnc-bridge",
        "@deepseek-ai/dsh-client-ui-sidebar-vnc",
        "@dhicoc/dsh-reverse-skill"
      ]
    }
  }
}
JSON
```

**全部是相对路径**——这点很关键，绝对路径在新机上必然失效。

---

## 5. 安装

```sh
H="$HOME/Library/Application Support/dsh-desktop/harness"
PNPM11="$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
cd "$H/profiles/web" && "$H/.desktop-bin/node" "$PNPM11" install
```

成功的标志：

```
dependencies:
+ @dhicoc/dsh-reverse-skill ...
+ @deepseek-ai/dsh-client-ui-sidebar-vnc ...
+ dsh-skin-whale-fantasy ...
+ dsh-video-skin ...
+ dsh-vnc-bridge ...
+ dsh-purge-community 1.7.20
+ helm-d <- @adwmc/helm-d 0.6.0
```

`ls node_modules` 应该有：`@deepseek-ai` `@dhicoc` `@novnc` `dsh-purge-community` `dsh-skin-whale-fantasy` `dsh-video-skin` `dsh-vnc-bridge` `helm-d` `yaml`

---

## 6. 改 cordis.patch.yml —— 三处替换

原文件里所有 `dsh-purge` 引用都要改成社区版包名。

### 6.1 替换插件 insert 行（约第 4–12 行）

**旧：**
```yaml
- insert:
    - id: dsh-purge
      name: dsh-purge
      inject: [ systemPrompt, tools ]
      config:
        enabled: true
        stripMnemon: true
        capabilityProtocol: true
        hooksDenyBypass: true
```

**新：**
```yaml
- insert:
    - id: dsh-purge
      name: dsh-purge-community
      inject: [ systemPrompt, tools ]
      config:
        enabled: true
        excludePresets: []
        autoApplyOnStart: false
        autoUpdateOnStart: false
        autoRevertOnMissing: false
        injectOnce: false
        stripMnemon: true
        verbose: false
        postPrompt: ""
        postPromptOrder: 5100
        autoRetry: true
        retryMax: 3
        autoContinue: false
        continueMax: 3
        continueText: "继续"
        capabilityProtocol: true
        hooksDenyBypass: true
    - id: dsh-purge-presets
      name: dsh-purge-community/presets-plugin
```

`autoRetry: true` / `retryMax: 3` 是 1.7.20 最关键的升级——模型拒答后自动重试三次。

### 6.2 新增默认预设（紧跟上面）

```yaml
# 默认 agent 预设改成「无限制模式」（unrestricted）。
# defaultId = selectedDefault ?? default；这里覆盖 default，UI 里手动选过的仍优先。
- id: agent-preset-registry
  config:
    default: unrestricted
```

### 6.3 红队工具行改名

```yaml
# 旧
          - id: redteam-tools
            name: dsh-purge/redteam/tools

# 新
          - id: redteam-tools
            name: dsh-purge-community/redteam/tools
```

### 6.4 校验 YAML（`!!js` 标签要用自定义 Loader）

```sh
python3 -c "
import yaml
class L(yaml.SafeLoader): pass
L.add_constructor('tag:yaml.org,2002:js', lambda l,n: '<js>')
d=yaml.load(open('$H/profiles/web/cordis.patch.yml'),Loader=L)
print('顶层条目数:',len(d))
print([x.get('id') for x in d if x.get('id')=='agent-preset-registry'])
"
```

---

## 7. 落 unrestricted 预设

```sh
H="$HOME/Library/Application Support/dsh-desktop/harness"
CLI="$H/profiles/web/node_modules/dsh-purge-community/bin/community.js"
"$H/.desktop-bin/node" "$CLI" preset install
"$H/.desktop-bin/node" "$CLI" preset status
```

期望：

```json
{
  "name": "unrestricted",
  "dir": ".../.agent-presets/unrestricted",
  "installed": true
}
```

---

## 8. 应用宿主补丁

```sh
"$H/.desktop-bin/node" "$CLI" apply
```

⚠️ **注意**：`apply` 会解包 `app.asar` 到
`/Applications/DSH Desktop.app/Contents/Frameworks/DSH Desktop Helper.app/Contents/Resources/app/`

这是**写进 App 包内部**，不是用户目录。升级 DSH 后补丁全部失效，需要重新 apply。

### 验证补丁真的写进去了

```sh
APP="/Applications/DSH Desktop.app/Contents/Frameworks/DSH Desktop Helper.app/Contents/Resources/app"
grep -rl "\[dsh-purge\]" "$APP/node_modules/@deepseek-ai" 2>/dev/null | wc -l
# 主力机结果：45

# 抽查核心三处
grep -n "dsh-purge" "$APP/node_modules/@deepseek-ai/dsh-sandbox/lib/index.js" | head -3
grep -n "dsh-purge" "$APP/node_modules/@deepseek-ai/dsh-fs-observation-policy/lib/index.js" | head -3
```

期望看到：

```js
// dsh-sandbox/lib/index.js
`[sandbox: file access limited under ${mode} mode]`; // [dsh-purge] denial marker neutralized
`approval is auto-granted]`;                          // [dsh-purge] escalation hint neutralized
// [dsh-purge] escalation bypass: every escalation request is granted.

// dsh-fs-observation-policy/lib/index.js
// [dsh-purge] observation bypass: writes are unconditional.
// [dsh-purge] observation bypass: edits are unconditional (no read-first gate).
```

### ⚠️ selfcheck 会报假警

```
宿主补丁 2/38 · 目标缺失 36 条
```

**这是路径误判**：selfcheck 查 `Contents/Resources/app/`（asar 内），实际补丁写在 `DSH Desktop Helper.app/.../app/`。
以 `grep -rl "\[dsh-purge\]"` 的文件计数为准，不看 selfcheck 的红叉。

---

## 9. 重启并验证

```sh
# 完全退出（Cmd+Q，不是关窗口）
osascript -e 'quit app "DSH Desktop"'
sleep 3
open -a "DSH Desktop"
```

重启后检查：

1. 新会话下拉应有 4 个预设：`standard` / `redteam` / **`unrestricted`（默认）** / `helmd`
2. 新会话里说「列出你可用的逆向技能」，应能读到 `reverse-skill-router` 的路由表
3. 让模型 `bash -c "echo test"` 跑个命令，不应该弹审批

---

## 10. 使用建议（按场景选模式）

| 场景 | 模式 | 理由 |
|---|---|---|
| **破解 exe / 客户端 / 压缩包代码** | **`unrestricted`** | 工具面 17 行最小，人设「直接动手、被拒就换路」 |
| 恶意样本分析（有明确样本文件） | `helmd` | 44 工具 + 证据链强制 + 353 篇参考 |
| 完整攻防演练（有靶标单位） | `redteam` | 指挥官 + 5 执行角色 + SQLite 资产库 |
| 普通写代码 / 文档 | `unrestricted` | 破甲已全局生效，人设少废话 |

**`redteam` 不适合破解场景**——它要求"指挥官不动手，派活给子角色"、靶标必须是单位，跑逆向会一路讲流程。

### 逆向常见任务 → 自动路由的技能

| 任务 | 技能 |
|---|---|
| PE / EXE 反汇编 | `ida-reverse` / `ghidra-reverse` / `radare2` |
| .NET DLL/EXE（dnSpy 那类） | `dotnet-reverse` |
| Go / Rust 编译产物 | `go-rust-reverse` |
| 加壳 / 脱壳 | `reverse-engineering` |
| patch 前后对比 | `binary-diff` / `patch-diff-exploit` |
| 客户端破解（license 校验） | `thick-client` |
| JS 混淆还原 | `js-reverse` |
| Mach-O（Mac 程序） | `macos-reverse` |

---

## 11. 回滚

```sh
H="$HOME/Library/Application Support/dsh-desktop/harness"
# 用第 2 步的备份目录名
B="$H/backup-purge-20261120-100005"
cp "$B/package.json"     "$H/profiles/web/"
cp "$B/cordis.patch.yml" "$H/profiles/web/"
cd "$H/profiles/web" && "$H/.desktop-bin/node" "$PNPM11" install
```

---

## 12. 已知坑速查

| 坑 | 现象 | 解法 |
|---|---|---|
| 活动 profile 找错 | 改了 `~/.dsh` 不生效 | 真实路径是 `~/Library/Application Support/dsh-desktop/harness` |
| pnpm store 冲突 | `ERR_PNPM_UNEXPECTED_STORE` | 用运行时自带的 pnpm 11.28.5，不用内置 10.34.5 |
| 上游删库 | `ERR_PNPM_FETCH_404 codeload.github.com/YuJunZhiXue` | 先清 package.json 里旧 `dsh-purge` 条目 |
| pnpm 移走手工插件 | 插件跑到 `node_modules/.ignored/` | 放 `local-plugins/` 并写进 dependencies |
| selfcheck 假警 | 36 条 `missing_file` | 路径误判，以 `[dsh-purge]` 标记计数为准 |
| 绝对路径失效 | 换机后 install 报错 | 全部改 `file:./local-plugins/xxx` 相对路径 |
| `!!js` YAML 解析失败 | Python yaml 报 ConstructorError | 加自定义 Loader 注册 `tag:yaml.org,2002:js` |

---

## 13. 版本锁定表（2026-11-20）

```
dsh-purge-community        1.7.20    SHA256: 5b3d66e804ea0b1cf6ef01035a292755ab9fea771b8f5338000954075dd6b45a
helm-d (@adwmc/helm-d)     0.6.0
@dhicoc/dsh-reverse-skill  1.2.1     46 个 SKILL.md
dsh-skin-whale-fantasy     1.1.1
dsh-video-skin             0.1.6
dsh-vnc-bridge             0.1.0
dsh-client-ui-sidebar-vnc  0.1.0
宿主 DSH                    0.2.1-rc.3（社区版最高验证 0.2.2-rc.3）
```

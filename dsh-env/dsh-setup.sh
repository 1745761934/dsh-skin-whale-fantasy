#!/bin/bash
# DSH 环境一键部署 — 破甲 + 逆向 + 全套插件
#
# 用法：
#   bash dsh-setup.sh               # 完整安装（幂等，可重复跑）
#   bash dsh-setup.sh --check       # 只体检，不改任何东西
#   bash dsh-setup.sh --rollback     # 回滚到最近一次备份
#
# 幂等：已完成的步骤自动跳过，重复运行安全
set -uo pipefail

H="$HOME/Library/Application Support/dsh-desktop/harness"
NODE="$H/.desktop-bin/node"
PNPM="$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
L="$H/profiles/web/local-plugins"
P="$H/profiles/web/cordis.patch.yml"
PKG="$H/profiles/web/package.json"
REPO_DIR="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd || echo .)"

MODE="install"
for a in "$@"; do
  case "$a" in
    --check)    MODE="check" ;;
    --rollback) MODE="rollback" ;;
    -h|--help)  sed -n '2,12p' "$0"; exit 0 ;;
  esac
done

OK=$'\033[32m'; WARN=$'\033[33m'; ERR=$'\033[31m'; OFF=$'\033[0m'
ok(){ echo "${OK}✓${OFF} $*"; }
warn(){ echo "${WARN}!${OFF} $*"; }
bad(){ echo "${ERR}✗${OFF} $*"; }
step(){ echo; echo "── $* ────────────────────────"; }

SHA_PURGE="5b3d66e804ea0b1cf6ef01035a292755ab9fea771b8f5338000954075dd6b45a"
SHA_HELM="b76ef5299834c31421d3ba4212b8e85035c42d53306d6d0e633de9bd2b9eae14"

# ═══ 回滚分支 ══════════════════════════════════════════════════
if [ "$MODE" = "rollback" ]; then
  step "回滚"
  LATEST=$(ls -dt "$H"/backup-purge-* 2>/dev/null | head -1)
  [ -n "$LATEST" ] || { bad "找不到任何备份目录 $H/backup-purge-*"; exit 1; }
  echo "  使用备份：$LATEST"
  ls -la "$LATEST"
  [ -f "$LATEST/package.json" ]     && cp -a "$LATEST/package.json"     "$PKG" && ok "还原 package.json"
  [ -f "$LATEST/cordis.patch.yml" ] && cp -a "$LATEST/cordis.patch.yml" "$P"   && ok "还原 cordis.patch.yml"
  [ -f "$LATEST/pnpm-lock.yaml" ]   && cp -a "$LATEST/pnpm-lock.yaml"   "$H/profiles/web/" && ok "还原 lock"
  cd "$H/profiles/web" && "$NODE" "$PNPM" install 2>&1 | tail -10
  # 宿主补丁回滚
  CLI="$H/profiles/web/node_modules/dsh-purge-community/bin/community.js"
  if [ -f "$CLI" ]; then
    "$NODE" "$CLI" revert 2>&1 | tail -10
  else
    warn "插件已不在，跳过宿主补丁回滚（升级 DSH 会自动恢复原版 app.asar）"
  fi
  echo
  ok "回滚完成 —— 手动 Cmd+Q 退出 DSH Desktop 再重开"
  exit 0
fi

# ═══ 体检分支 ══════════════════════════════════════════════════
if [ "$MODE" = "check" ]; then
  step "体检（只读，不改动）"
  echo "  DSH 数据目录   $([ -d "$H" ] && echo "✓ $H" || echo "✗ 缺失")"
  echo "  DSH 应用       $([ -d "/Applications/DSH Desktop.app" ] && echo ✓ || echo ✗)"
  echo "  node           $([ -x "$NODE" ] && "$NODE" -v || echo ✗)"
  echo "  pnpm 11        $([ -f "$PNPM" ] && "$NODE" "$PNPM" -v || echo ✗)"
  echo "  local-plugins  $(ls "$L" 2>/dev/null | tr '\n' ' ')"
  echo "  已装插件       $(ls "$H/profiles/web/node_modules" 2>/dev/null | tr '\n' ' ')"
  echo "  预设           $(ls "$H/.agent-presets" 2>/dev/null | tr '\n' ' ')"
  APP="/Applications/DSH Desktop.app/Contents/Frameworks/DSH Desktop Helper.app/Contents/Resources/app"
  [ -d "$APP" ] && echo "  补丁文件数     $(grep -rl "\[dsh-purge\]" "$APP/node_modules/@deepseek-ai" 2>/dev/null | wc -l | tr -d ' ')"
  echo "  最近备份       $(ls -dt "$H"/backup-purge-* 2>/dev/null | head -1)"
  exit 0
fi

# ═══ 0. 环境检查 ═══════════════════════════════════════════════
step "0. 环境检查"
[ -d "$H" ] || { bad "找不到 DSH 数据目录：$H"; echo "   先手动打开一次 DSH Desktop 再跑本脚本"; exit 1; }
[ -d "/Applications/DSH Desktop.app" ] || { bad "没装 DSH Desktop"; exit 1; }
[ -x "$NODE" ] || { bad "找不到 node：$NODE"; exit 1; }
[ -f "$PNPM" ] || { bad "找不到 pnpm 11：$PNPM"; exit 1; }
ok "DSH 数据目录 $H"
ok "node $("$NODE" -v)"
ok "pnpm $("$NODE" "$PNPM" -v)"

# ═══ 1. 备份 ═══════════════════════════════════════════════════
step "1. 备份"
TS=$(date +%Y%m%d-%H%M%S)
B="$H/backup-purge-$TS"
mkdir -p "$B"
cp -a "$PKG" "$B/" 2>/dev/null && ok "备份 package.json"
cp -a "$P"   "$B/" 2>/dev/null && ok "备份 cordis.patch.yml"
cp -a "$H/profiles/web/pnpm-lock.yaml" "$B/" 2>/dev/null && ok "备份 pnpm-lock.yaml"
echo "$B" > /tmp/dsh-backup-path.txt
ok "备份目录 $B"

# ═══ 2. 准备目录 ═══════════════════════════════════════════════
step "2. 准备插件目录"
mkdir -p "$L/pkgs" "$L/@deepseek-ai"
ok "$L"

# ═══ 3. 下载并校验三个核心包 ═══════════════════════════════════
step "3. 下载核心插件"

dl_verify(){
  local url="$1" out="$2" want="$3" name="$4"
  if [ -f "$out" ]; then
    local have; have=$(shasum -a 256 "$out" | awk '{print $1}')
    if [ "$have" = "$want" ]; then ok "$name 已存在且校验通过"; return 0; fi
    warn "$name 校验不符，重新下载"
  fi
  curl -fL -m 600 --retry 3 --retry-delay 2 "$url" -o "$out" || { bad "$name 下载失败"; return 1; }
  local have; have=$(shasum -a 256 "$out" | awk '{print $1}')
  [ "$have" = "$want" ] || { bad "$name SHA256 不符：$have"; return 1; }
  ok "$name 下载并校验通过"
}

dl_verify "https://github.com/kingcharleslzy-ai/dsh-purge/releases/download/v1.7.20/dsh-purge-community-1.7.20.tgz" \
  "$L/pkgs/dsh-purge-community-1.7.20.tgz" "$SHA_PURGE" "dsh-purge-community 1.7.20" || exit 1

dl_verify "https://github.com/ADWMC/helm-d/releases/download/v0.6.0/helm-d.tgz" \
  "$L/pkgs/helm-d.tgz" "$SHA_HELM" "helm-d 0.6.0" || exit 1

# 逆向技能包（目录形态，无 tgz）
if [ -f "$L/dsh-reverse-skill/package.json" ]; then
  ok "dsh-reverse-skill 已存在"
else
  curl -fL -m 900 --retry 3 "https://github.com/dhicoc/dsh-reverse-skill/archive/refs/heads/main.tar.gz" -o /tmp/rev.tgz || { bad "逆向包下载失败"; exit 1; }
  tar xzf /tmp/rev.tgz -C "$L" && mv "$L/dsh-reverse-skill-main" "$L/dsh-reverse-skill" && rm -f /tmp/rev.tgz
  [ -f "$L/dsh-reverse-skill/package.json" ] || { bad "逆向包解压异常"; exit 1; }
  ok "dsh-reverse-skill 就位"
fi
N_SKILL=$(find "$L/dsh-reverse-skill/skills" -name "SKILL.md" 2>/dev/null | wc -l | tr -d ' ')
ok "逆向技能数 $N_SKILL"

# ═══ 4. 皮肤 / VNC（从仓库 dsh-env 拷，有就用，没有就跳过）═══════
step "4. 皮肤 / VNC"

# 4.0 先把 Git LFS 的大文件拉成真身（mp4 克隆下来只是 130 字节指针）
PLUGDIR="$REPO_DIR/dsh-env/plugins"
if [ -d "$PLUGDIR/dsh-video-skin" ]; then
  PTR=$(find "$PLUGDIR" -name "*.mp4" -size -1k 2>/dev/null | wc -l | tr -d ' ')
  if [ "${PTR:-0}" -gt 0 ]; then
    warn "检测到 $PTR 个 LFS 指针文件，正在拉取真实视频（约 20MB）"
    if command -v git-lfs >/dev/null 2>&1; then
      ( cd "$REPO_DIR" && git lfs install --local >/dev/null 2>&1; git lfs pull 2>&1 | tail -3 )
    else
      bad "未安装 git-lfs —— 请先 brew install git-lfs，或从主力机 AirDrop 这三个 mp4"
    fi
    PTR2=$(find "$PLUGDIR" -name "*.mp4" -size -1k 2>/dev/null | wc -l | tr -d ' ')
    [ "${PTR2:-0}" -eq 0 ] && ok "LFS 视频已就位" || warn "仍有 $PTR2 个指针文件，皮肤视频会缺失（不影响破甲功能）"
  fi
fi

OPT_OK=1
for d in dsh-skin-whale-fantasy dsh-video-skin dsh-vnc-bridge; do
  if [ -f "$L/$d/package.json" ]; then ok "$d 已存在"; continue; fi
  if [ -d "$PLUGDIR/$d" ]; then
    cp -a "$PLUGDIR/$d" "$L/" && ok "复制 $d"
    # 视频缺失时只警告，不降级为最小配置（插件本身能跑，只是没背景）
    if [ "$d" = "dsh-video-skin" ]; then
      SMALL=$(find "$L/$d" -name "*.mp4" -size -1k 2>/dev/null | wc -l | tr -d ' ')
      [ "${SMALL:-0}" -gt 0 ] && warn "$d 视频仍是指针，背景动画会缺失"
    fi
  else
    warn "$d 不在仓库里（跳过）"; OPT_OK=0
  fi
done
if [ ! -f "$L/@deepseek-ai/dsh-client-ui-sidebar-vnc/package.json" ]; then
  if [ -d "$PLUGDIR/sidebar-vnc" ]; then
    cp -a "$PLUGDIR/sidebar-vnc" "$L/@deepseek-ai/dsh-client-ui-sidebar-vnc" && ok "复制 sidebar-vnc"
  else
    warn "sidebar-vnc 不在仓库里（跳过）"; OPT_OK=0
  fi
fi

# ═══ 5. 写 package.json ════════════════════════════════════════
step "5. 写 package.json"
if [ "$OPT_OK" = 1 ]; then
  cat > "$PKG" <<'JSON'
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
  ok "完整版 package.json（含皮肤 VNC）"
else
  cat > "$PKG" <<'JSON'
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "dsh-purge-community": "file:./local-plugins/pkgs/dsh-purge-community-1.7.20.tgz",
    "helm-d": "file:./local-plugins/pkgs/helm-d.tgz",
    "@dhicoc/dsh-reverse-skill": "file:./local-plugins/dsh-reverse-skill"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-purge-community",
        "helm-d",
        "@dhicoc/dsh-reverse-skill"
      ]
    }
  }
}
JSON
  ok "最小版 package.json（核心三件套）"
fi

# ═══ 6. 改 cordis.patch.yml ════════════════════════════════════
step "6. 改 cordis.patch.yml"
if [ ! -f "$P" ]; then
  cp "$REPO_DIR/dsh-env/cordis.patch.yml.example" "$P" 2>/dev/null && ok "从模板创建" || { bad "无 cordis.patch.yml 且无模板"; exit 1; }
fi

python3 - "$P" "$OPT_OK" <<'PY'
import sys,re
p,opt=sys.argv[1],sys.argv[2]=='1'
t=open(p,encoding='utf-8').read()
orig=t

# 1) 包名替换
for a,b in [
  ("      name: dsh-purge\n","      name: dsh-purge-community\n"),
  ("name: dsh-purge/redteam/tools","name: dsh-purge-community/redteam/tools"),
  ("name: dsh-purge/redteam/store","name: dsh-purge-community/redteam/store"),
  ("name: dsh-purge/redteam/ui","name: dsh-purge-community/redteam/ui"),
  ("name: dsh-purge/redteam\n","name: dsh-purge-community/redteam\n"),
]:
    t=t.replace(a,b)

# 2) 补齐 dsh-purge 的 config（缺 autoRetry 等关键项就整块替换）
if "autoRetry" not in t:
    t=re.sub(
      r'- insert:\s*\n\s*- id: dsh-purge\s*\n(?:.*\n)*?\s*hooksDenyBypass: true\n',
      '''- insert:
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
''', t, count=1)

# 3) 确保 presets 插件行存在
if "dsh-purge-presets" not in t:
    t=t.replace("        hooksDenyBypass: true\n",
                "        hooksDenyBypass: true\n    - id: dsh-purge-presets\n      name: dsh-purge-community/presets-plugin\n",1)

# 4) 默认预设
if "agent-preset-registry" not in t:
    t=t.replace("\n# dsh-desktop legacy presets begin",
      "\n- id: agent-preset-registry\n  config:\n    default: unrestricted\n\n# dsh-desktop legacy presets begin",1)
    if "agent-preset-registry" not in t:
        t="- id: agent-preset-registry\n  config:\n    default: unrestricted\n\n"+t

# 5) 最小模式时禁用皮肤/VNC 行
if not opt:
    out=[]
    skip=False
    for line in t.split("\n"):
        if re.match(r"\s*-\s*id:\s*(dsh-video-skin|dsh-skin-whale-fantasy|dsh-vnc-bridge|ui-sidebar-vnc)\s*$",line):
            skip=True; out.append("          # [skipped: plugin not installed] "+line.strip()); continue
        if skip and re.match(r"\s+name:",line):
            out.append("          # [skipped] "+line.strip()); skip=False; continue
        out.append(line)
    t="\n".join(out)

if t!=orig:
    open(p,'w',encoding='utf-8').write(t)
    print("  changed")
else:
    print("  unchanged")
PY
ok "cordis.patch.yml 处理完成"

# 校验 YAML
python3 -c "
import yaml,sys
class L(yaml.SafeLoader): pass
L.add_constructor('tag:yaml.org,2002:js', lambda l,n: '<js>')
d=yaml.load(open('$P'),Loader=L)
print('  YAML 合法，顶层条目数:',len(d))
ids=[x.get('id') for x in d if isinstance(x,dict)]
assert 'agent-preset-registry' in ids, '默认预设未写入'
print('  默认预设: unrestricted ✓')
" || { bad "YAML 校验失败"; exit 1; }

# 残留检查
LEFT=$(grep -c "name: dsh-purge$" "$P" 2>/dev/null || true)
[ "${LEFT:-0}" = "0" ] && ok "无裸 dsh-purge 残留" || warn "仍有 $LEFT 处 name: dsh-purge，检查一下"

# ═══ 7. 安装依赖 ═══════════════════════════════════════════════
step "7. 安装依赖"
cd "$H/profiles/web" || exit 1
"$NODE" "$PNPM" install 2>&1 | tail -20
INSTALLED=$(ls "$H/profiles/web/node_modules" 2>/dev/null | tr '\n' ' ')
echo "  node_modules: $INSTALLED"
echo "$INSTALLED" | grep -q "dsh-purge-community" || { bad "dsh-purge-community 未装上"; exit 1; }
echo "$INSTALLED" | grep -q "helm-d" || { bad "helm-d 未装上"; exit 1; }
echo "$INSTALLED" | grep -q "@dhicoc" || { bad "逆向技能包未装上"; exit 1; }
ok "依赖安装完成"

# ═══ 8. 落 unrestricted 预设 ═══════════════════════════════════
step "8. 安装 unrestricted 预设"
CLI="$H/profiles/web/node_modules/dsh-purge-community/bin/community.js"
"$NODE" "$CLI" preset install 2>&1 | tail -8
"$NODE" "$CLI" preset status 2>&1 | grep -q '"installed": true' && ok "预设已安装" || warn "预设状态待确认"

# ═══ 9. 应用宿主补丁 ═══════════════════════════════════════════
step "9. 应用宿主补丁（会写入 App 包内部）"
"$NODE" "$CLI" apply 2>&1 | tail -25

APP="/Applications/DSH Desktop.app/Contents/Frameworks/DSH Desktop Helper.app/Contents/Resources/app"
if [ -d "$APP" ]; then
  N_PATCH=$(grep -rl "\[dsh-purge\]" "$APP/node_modules/@deepseek-ai" 2>/dev/null | wc -l | tr -d ' ')
  ok "补丁写入文件数：$N_PATCH"
  [ "$N_PATCH" -lt 20 ] && warn "少于 20 个，可能未完全生效，看看上面的 apply 输出"
else
  warn "未找到 Helper.app 解包目录（可能是别的宿主布局），检查上面的 apply 输出"
fi

# ═══ 10. 汇总 ══════════════════════════════════════════════════
step "10. 完成"
echo "  破甲插件       dsh-purge-community 1.7.20"
echo "  工具/参考      helm-d 0.6.0"
echo "  逆向技能       $N_SKILL 个"
echo "  皮肤/VNC       $([ "$OPT_OK" = 1 ] && echo 已装 || echo 跳过)"
echo "  默认预设       unrestricted（无限制模式）"
echo "  备份目录       $B"
echo
echo "  ⚠️ 下一步必须手动做：完全退出 DSH Desktop（Cmd+Q）再重新打开"
echo "     重启后新会话默认就是「无限制模式」，下拉里应有 standard/redteam/unrestricted/helmd"
echo
echo "  ℹ️  community.js selfcheck 会报 36 条 missing_file —— 那是路径误判"
echo "     以本脚本第 9 步的「补丁写入文件数」为准"
echo
echo "  回滚：bash $0 --rollback"
exit 0

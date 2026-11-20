# 另一台 Mac 一键同步指令（复制整段给那台机器上的 AI）

> 把下面代码块**整段复制**，粘贴给另一台 Mac 上能操作本机的 AI agent（DSH / Claude Code / Codex 都行）。

---

````text
# 任务：在本机部署 DSH 破甲 + 逆向环境（照抄主力机）

你现在在 macOS 上。目标：把 DeepSeek Harness（DSH Desktop）配置成和主力机一致：
破甲插件 dsh-purge-community 1.7.20 + helm-d 0.6.0 + 逆向技能包 + 默认预设 unrestricted。

## 铁律（违反会搞坏环境）

1. **活动 profile 在 `~/Library/Application Support/dsh-desktop/harness/`，不是 `~/.dsh`。**
   开工前验证：`ps aux | grep -i dsh | grep -o "Application Support/dsh-desktop[^ ]*" | head -1`

2. **必须用 DSH 运行时自带的 node 和 pnpm**，不要用系统 node/npm/npx，不要用内置 pnpm 10.34.5：
   ```
   H="$HOME/Library/Application Support/dsh-desktop/harness"
   NODE="$H/.desktop-bin/node"
   PNPM="$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
   ```
   若 `$PNPM` 不存在：`find ~/.dsh ~/Library/Application\ Support/dsh-desktop -name "pnpm.cjs" -path "*pnpm/bin*"`

3. **全程不要 sudo**。

4. **不要中途重启 DSH**，最后一步才重启。

5. 每步回读验证，不要假设成功。

---

## 执行

### 步骤 1：clone 仓库（含全部插件和脚本）

```sh
rm -rf /tmp/dsh-env && git clone --depth 1 https://github.com/1745761934/dsh-skin-whale-fantasy.git /tmp/dsh-env
ls /tmp/dsh-env/dsh-env/
```

应看到：`dsh-setup.sh`、`package.json.example`、`cordis.patch.yml.example`、`plugins/`

### 步骤 2：先体检

```sh
cd /tmp/dsh-env && bash dsh-env/dsh-setup.sh --check
```

把输出报给我，确认 DSH 数据目录、node、pnpm 三项都是 ✓。

### 步骤 3：跑一键部署

```sh
cd /tmp/dsh-env && bash dsh-env/dsh-setup.sh
```

脚本会自动做完全部 10 步：备份 → 下载校验 tgz → 从仓库拷皮肤/VNC → 写 package.json →
改 cordis.patch.yml → pnpm install → 落 unrestricted 预设 → 应用宿主补丁 → 汇总。

**预计耗时 3–6 分钟**（主要花在下载破甲包 2.2M + helm-d 5M + 逆向包 1.9M）。

### 步骤 4：报告结果

脚本最后会打印汇总，按这个格式报给我：

```
✅ 完成
- dsh-purge-community 版本：
- helm-d 版本：
- 逆向技能数（SKILL.md 计数）：
- 补丁写入文件数：
- 默认预设：
- 备份目录：

⚠️ 异常
- （apply 阶段的报错行，如有）
- （脚本里所有 ✗ 或 ! 开头的行）
```

### 步骤 5：重启验收

```sh
osascript -e 'quit app "DSH Desktop"'; sleep 3; open -a "DSH Desktop"
```

重启后检查三点并回报：
1. 新会话下拉有 4 个预设：`standard` / `redteam` / **`unrestricted`（默认选中）** / `helmd`
2. 新会话说「列出你可用的逆向技能」，能读到 `reverse-skill-router` 路由表
3. 让模型执行 `bash -c "echo ok"`，**不弹审批**

---

## 出错怎么办

| 报错 | 解法 |
|---|---|
| `ERR_PNPM_UNEXPECTED_STORE` | 用错 pnpm → 用步骤 2 那个 `$PNPM`（11.28.5） |
| `ERR_PNPM_FETCH_404 codeload.github.com/YuJunZhiXue` | package.json 有旧 dsh-purge 条目 → 删掉重跑脚本 |
| `EACCES` / 权限 | 用了 sudo → `chown -R $USER "$H/profiles/web"` |
| YAML 解析报 `ConstructorError: js` | 正常，脚本已注册自定义 Loader；若仍失败把完整输出给我 |
| 补丁文件数 < 20 | apply 未完全生效 → 把 `"$NODE" "$CLI" apply` 的完整输出给我 |
| Git LFS 文件是 130 字节指针 | `git lfs install && git lfs pull` 后重跑 |

## 回滚

```sh
cd /tmp/dsh-env && bash dsh-env/dsh-setup.sh --rollback
```

## 重要认知

- **`community.js selfcheck` 会报 36 条 `missing_file`，那是路径误判。**
  它查 `Contents/Resources/app/`（asar 内），补丁实际写在
  `Contents/Frameworks/DSH Desktop Helper.app/.../app/`。
  **以脚本输出的「补丁写入文件数」为准（期望 40–50）。**

- **补丁写在 App 包内部**，DSH 升级后失效，需重跑 `apply`。

- 详细手册：`/tmp/dsh-env/docs/dsh-环境迁移手册.md`（13 章）
````

---

## 附：脚本做了什么（10 步）

| 步骤 | 内容 |
|---|---|
| 0 | 环境检查（DSH 目录 / node / pnpm 11） |
| 1 | 备份 package.json + cordis.patch.yml + lock 到 `backup-purge-<时间戳>/` |
| 2 | 建 `local-plugins/` 结构 |
| 3 | 下载两个 tgz 并校验 SHA256（不符即停）+ 拉逆向技能包 |
| 4 | 从仓库 `dsh-env/plugins/` 拷皮肤 / VNC 四个包 |
| 5 | 写 package.json（全相对路径，缺包时自动降级为最小版） |
| 6 | 改 cordis.patch.yml（包名替换 + 补 autoRetry 配置 + 加默认预设 + YAML 校验） |
| 7 | pnpm install 并验证三个核心包到位 |
| 8 | `community.js preset install` 落 unrestricted |
| 9 | `community.js apply` 写 45 个宿主补丁 + 计数验证 |
| 10 | 汇总 + 提示重启 |

三个模式：`bash dsh-setup.sh` / `--check` / `--rollback`

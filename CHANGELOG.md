# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.3.0] - 2026-11-03

按 awesome-dsh-plugin 贡献指南优化收录条目与校验。

### 新增

- `test-entry.cjs`：把指南里「CI 会检查什么」落成 16 条断言（manifest、category 白名单、
  en/zh 引号与句号、`tarball` 必须 GitHub Release 的 `https .tgz` 且资产名不带版本号、
  `icon` 必须 GitHub 托管位图、描述里的「6 个工具」与 `index.js` 实数一致、单 PR 只 1 条）。
- audit 新增 3 条：收录条目存在且 url 指向本仓库、`tarball` 用 `latest/download`、自检脚本在（共 130 条）。

### 变更

- 收录条目的 `category` 从 `ui` 改为 `fun`：插件主体是桌宠在房间里活动的观赏/陪伴体验，
  QQ 与抖音都是可选外接；按指南「选贴合实际做的事的分类」。
- 条目描述改成可核对的写法，删掉模糊表述；中英文都加引号，避免 `: ` 被 YAML 解析成嵌套键。
- 条目文件里写明逐项对照结果，以及「仓库满 1 天」由 CI 自动判定。

## [2.2.2] - 2026-11-03

修复发版工作流：`npm pack --pack-destination dist` 在 `dist` 不存在时直接失败，
导致推 tag 后 Release 没发出来（v2.2.0 / v2.2.1 的 Action 都是这一步红的）。

### 修复

- 工作流先 `mkdir -p dist` 再打包；v2.2.2 起由 Action 自动发 Release。

## [2.2.1] - 2026-11-03

修正「latest 指向旧版」：GitHub 的 `latest` 按 Release **创建时间**算，先补发 v2.0.0/v2.1.0
会让最新一版变成旧版本。

### 修复

- `release.mjs` 创建 Release 时显式 `make_latest: true`，`releases/latest/download/`
  永远指向刚发的这一版。
- 旧版 Release 标记为非 latest（v2.0.0 / v2.1.0 / v2.2.0 只保留 tag 与资产，不再抢 latest）。

## [2.2.0] - 2026-11-03

按 awesome-dsh-plugin 收录指南整理发布形态：每个版本都有可直接下载的 Release。

### 新增

- GitHub Releases：v2.0.0 / v2.1.0 / v2.2.0 各挂一个预构建 `dsh-pet-bedroom.tgz`；
  资产名不带版本号，`releases/latest/download/dsh-pet-bedroom.tgz` 永远有效。
- `release.mjs`：`node release.mjs [--tag vX.Y.Z] [--dry-run]` 从指定 tag 打包并发 Release。
- `.github/workflows/release.yml`：推 `v*` tag 自动打包、发 Release、上传资产。
- `screenshots.json` + `assets/screenshot-room.jpg`、`assets/screenshot-qq.jpg`、`assets/icon-180.png`：
  市场卡片与截图所需的 GitHub 托管位图。
- `package.json`：补 `repository` / `homepage` / `bugs` / `keywords`，`files` 纳入截图与变更记录。
- `.github/awesome-plugin-entry.yml`：收录条目草稿（含 `tarball` 与 `icon` 字段）。

### 变更

- 安装方式补上「从 Release 一行安装」，源码安装仍可用。

## [2.1.0] - 2026-11-03

QQ 连接窗口（默认 SnowLuma）。

### 新增

- 页面右上角「QQ 连接」按钮与配置窗口：选后端（默认 SnowLuma）、填 OneBot HTTP
  地址/令牌/主人 QQ、复制上报地址、测试连接、保存；关闭时 `display:none`，不挂遮罩。
- 宿主路由：`GET /qq`（状态，不含令牌）、`POST /qq/config`（写 `qq.json`，立即生效）、
  `POST /qq/test`（真调 `get_login_info` / `get_friend_list`）、
  `POST /qq/event`（OneBot 11 HTTP 上报入口）。
- 上报处理：校验 `Authorization: Bearer` / `?access_token=`，按 `message_id` 去重，
  只收主人私聊；消息进手机未读并追加 `$DSH_HOME/dsh-pet-bedroom/qq-log/*.jsonl`。
- `qqLog` 流水并入手机聊天列表（与 Aurabot chatlog 去重合并）。
- 配置项 `qqApiBase` / `qqToken` / `qqSelfId` / `qqFile`；
  环境变量 `BEDROOM_QQ_API` / `BEDROOM_QQ_TOKEN` / `BEDROOM_QQ_SELF_ID`。
- `test-qq.mjs`：保存、测试连接、鉴权、去重、进手机全链路验证。
- README：SnowLuma 三步接入说明、窗口字段表、安全边界；audit 增至 117 条。

### 变更

- QQ 活动处理抽成 `handleQqActivity()`，聊天服务事件与 HTTP 上报共用同一条过滤逻辑。

## [2.0.0] - 2026-11-03

首个开源准备版本（脱敏通用版）。

### 新增

- 通用配置项：`petRoute`、`petId`、`vaultDir`、`notesDir`、`chatService`、
  `chatDataDir`、`chatApiBase`、`douyinApiBase`、`douyinEnabled`、`allowAgentWrite`、`roomFile`。
- 环境变量：`BEDROOM_PET_ROUTE`、`BEDROOM_VAULT_DIR`、`BEDROOM_CHAT_DIR`（兼容 `AURABOT_DATA_DIR`）。
- `test-config.mjs`：验证自定义宠物路由、聊天服务、抖音基地址真的生效。
- README：面向所有读者的安装、配置、接入说明，明确列出对 dsh-pet 的引用范围。

### 变更

- QQ 与抖音从「写死 Aurabot」改为「按契约接入，默认适配 Aurabot」。
- 默认记忆库路径改为 `$DSH_HOME/memory-vault`，不再指向任何个人目录。
- 默认笔记目录改为 `notes`，可用 `notesDir` 指向任意目录。
- 包名从 `@local/dsh-pet-bedroom` 改为 `dsh-pet-bedroom`。
- 全部测试脚本中的示例昵称、QQ 号、群号替换为虚构值。
- 辅助脚本（预览、Playwright 可视验证、椅子生成/配准）改为相对路径与
  可配置的 `PLAYWRIGHT_CORE`，不再依赖作者本机路径。

### 移除

- 仓库内的个人路径、私人记忆库名称、真实聊天内容与群名。

### 保留

- v3 的独立网页架构：不在 DSH 应用里挂任何浮层/遮罩。
- 房间交互、桌宠姿态、椅子前景遮挡、手机界面、拨号盘、壁纸、家具、工具集。
- 对 dsh-pet 的引用方式：只读它的 `/config` 与 `/thumb`，不改它一行代码。

## 历史（原作者环境，未纳入本仓库提交）

- v1：概念稿。
- v2：全屏浮层方案，已废弃（隐藏态遮罩仍拦截点击）。
- v3：独立网页 + 真实日记/聊天流水 + 手机界面。

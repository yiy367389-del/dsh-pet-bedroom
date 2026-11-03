# 桌宠卧室 · dsh-pet-bedroom

给 [dsh-pet](https://www.npmjs.com/package/dsh-pet)（DSH 的桌宠插件）盖一间它自己的卧室：
**一个可以独立打开的网页**。房间图就是整间屋子，桌宠在里面走动、躺床、坐电脑前、
给植物喷水；桌上放着它真实的日记与读书笔记；手机里是真实的 QQ 聊天记录；
还能切换时辰、天气、壁纸，自己添置家具。

它**不改 dsh-pet 一行代码**，只是复用 dsh-pet 已经对外开放的素材与动画池。

> 本仓库是**脱敏的通用版本**：不含任何作者的个人路径、QQ 号、聊天内容或私人服务地址。
> 所有和个人环境相关的接入点都改成了配置项（见 [配置项](#配置项)）。

---

## 目录

- [这是什么](#这是什么)
- [先看效果](#先看效果)
- [名词表](#名词表)
- [前置条件](#前置条件)
- [快速开始](#快速开始)
- [配置项](#配置项)
- [⚠️ 两块需要你自己接入的能力](#️-两块需要你自己接入的能力)
  - [QQ 部分](#qq-部分你需要接入自己的)
  - [抖音部分](#抖音部分你需要接入自己的)
- [本项目引用了 dsh-pet 的哪些功能](#本项目引用了-dsh-pet-的哪些功能)
- [页面与接口清单](#页面与接口清单)
- [目录结构](#目录结构)
- [自定义](#自定义)
- [本地验证](#本地验证)
- [安全与边界](#安全与边界)
- [常见问题](#常见问题)
- [版本与演进](#版本与演进)
- [许可与贡献](#许可与贡献)

---

## 这是什么

一句话：**把桌宠放进一间可以用浏览器打开的卧室，房间里的东西会跟着你的真实数据变。**

它能做的事：

| 能力 | 说明 |
|:--|:--|
| 独立网页 | `http://<你的 DSH 地址>/dsh-pet-bedroom/`，不是 DSH 应用里的浮层，关掉不影响主界面 |
| 桌宠走动 | 点床、电脑桌、椅子、书架、落地窗、龟背竹、地毯，它会走过去做对应动作 |
| 真实动画 | 动作素材全部来自 dsh-pet 自己的动画池，不写死动画名，你在 dsh-pet 里换皮/加动画它自动跟着变 |
| 桌上日记 | 读聊天服务（默认 Aurabot）每天自己写的那篇，按天聚合，只读、不代写 |
| 桌上笔记 | 读你记忆库里的 Markdown 读书笔记；agent 也能通过工具写新笔记 |
| 手机 QQ | 手机界面里是真实的 QQ 会话与聊天记录，有真实头像；群聊标出发言人 |
| QQ 命令 | 主人在 QQ 私聊里说「睡觉 / 刷抖音 / 去电脑桌 / 看窗外」，桌宠在卧室里照做 |
| 刷抖音 | 卧室里的「现在刷一轮」打的是你抖音后端的接口，拒绝就如实说理由，绝不假装在刷 |
| 时辰天气 | 清晨/中午/下午/晚间 × 晴天/雨/雪，可跟着真实时间自动走 |
| 家具与壁纸 | 往房间槽位里加/删家具（会真的出现在房间里），手机壁纸可换 |
| agent 感知 | 注册 6 个工具，让 agent 能读房间状态、读文档、写笔记、调天气、摆家具、换壁纸 |

**它不是**：不是聊天机器人，不是抖音自动机，不是 QQ 客户端。
QQ 与抖音是**可选的外部能力**，需要你自己接（见下文）。

![房间预览](assets/room.png)

---

## 先看效果

打开后你会看到：

- 一张 1536×1024 的房间图（`assets/room.png`），所有交互都叠在图上；
- 右下角是桌宠，素材来自 dsh-pet，尺寸按房间比例恒定；
- 中间偏下是一台手机：锁屏、桌面、图标、dock、QQ 聊天界面、拨号盘；
- 桌上摊着日记和读书笔记，点开是全屏阅读器；
- 顶部控制条：时辰、天气、自动、现在刷一轮、别刷了、离开卧室。

---

## 名词表

给第一次接触这套东西的人：

| 名词 | 是什么 |
|:--|:--|
| **DSH**（DeepSeek Harness） | 一个在本地运行的 AI agent 桌面应用，插件都跑在它里面 |
| **插件 / plugin** | 给 DSH 增加功能的包，有「宿主半侧」（Node 进程里跑的代码）和「浏览器半侧」（页面里跑的代码） |
| **profile** | DSH 的一套配置目录（通常在 `~/.dsh/profiles/<名字>/`），里面的 `package.json` 决定装哪些插件 |
| **Cordis** | DSH 的插件运行时；`ctx.get('xxx')` 用来取别的插件暴露的服务 |
| **dsh-pet** | DSH 的桌宠插件，负责宠物素材、动画池、桌面显示 |
| **Aurabot** | 一个 QQ 机器人插件（`dsh-aurabot-qq`），经 SnowLuma / OneBot 接 QQ。**本项目的 QQ 与抖音默认适配它**，但不是必需 |
| **QQ 后端 / 抖音后端** | 你自己实现的、提供聊天流水与刷抖音动作的服务。本项目只按约定读它、调它 |

---

## 前置条件

1. **Node.js ≥ 20**（本项目用了 `fetch`、`AbortSignal.timeout`、`import.meta.dirname` 等）。
2. **DSH** 已经能正常运行，并且知道你的 profile 目录在哪。
3. **dsh-pet 已安装并在设置里打开显示**（卧室要读它的宠物列表与动画素材）。
   - 没有 dsh-pet 时，卧室页面本身还能打开，但看不到桌宠。
4. （可选）**QQ 接入**：Aurabot 插件，或你自己实现的服务（见 [QQ 部分](#qq-部分你需要接入自己的)）。
5. （可选）**抖音接入**：你自己的刷抖音 HTTP 后端（见 [抖音部分](#抖音部分你需要接入自己的)）。

---

## 快速开始

### 第 1 步：把项目放进 profile

把整个仓库目录放到你喜欢的路径（例如 `D:/plugins/dsh-pet-bedroom`），
然后在你的 profile 的 `package.json` 里加一条 **link 依赖** 和一条 **bundle**：

```jsonc
{
  "dependencies": {
    "dsh-pet-bedroom": "link:D:/plugins/dsh-pet-bedroom"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-pet",
        "dsh-pet-bedroom"
      ]
    }
  }
}
```

> `dsh-pet-bedroom` 必须排在 `dsh-pet` **之后**：卧室启动时会去读 dsh-pet 的宠物列表。
> 顺序不对也能起来（会稍后自动重试），但第一次打开可能暂时没有宠物。

### 第 2 步：确认插件被加载

`cordis.patch.yml` 已经写好插入项，正常情况下不需要改：

```yaml
- insert:
    - id: dsh-pet-bedroom
      name: 'dsh-pet-bedroom'
```

如果它没有自动出现，检查 profile 的 `package.json` 里 `dsh.profile.bundles` 是否包含
`dsh-pet-bedroom`，以及依赖是否真的安装成功（`node_modules/dsh-pet-bedroom` 是否指向你的目录）。

### 第 3 步：重启 DSH，打开卧室

重启后：

- 侧边栏底部会出现一个 **「卧室」** 按钮，点它同窗口跳到卧室；
- 也可以直接访问 `http://<你的 DSH 地址>/dsh-pet-bedroom/`。

宿主半侧的改动（`index.js`、`cordis.patch.yml`）需要**重启 DSH** 生效；
`web/index.html` 的改动刷新页面即可。

---

## 配置项

全部配置都是**可选**的，不填就用默认值。默认值刻意保持通用，不指向任何人的私人目录。

在 `cordis.patch.yml` 里这样写：

```yaml
- insert:
    - id: dsh-pet-bedroom
      name: 'dsh-pet-bedroom'
      config:
        petRoute: '/dsh-pet-7340'
        petId: ''
        vaultDir: '/绝对路径/memory-vault'
        notesDir: 'notes'
        chatService: 'aurabot'
        douyinApiBase: 'http://127.0.0.1:8080/api'
        douyinEnabled: true
        allowAgentWrite: true
```

| 配置项 | 默认值 | 含义 |
|:--|:--|:--|
| `petRoute` | `/dsh-pet-7340` | dsh-pet 的 HTTP 路由前缀。你的 dsh-pet 路由不一样时改这里 |
| `petId` | 空（取第一只） | 指定哪只宠物进卧室，值来自 dsh-pet 的宠物 `id` |
| `vaultDir` | `$DSH_HOME/memory-vault` | 记忆库根目录，读书笔记在里面找 |
| `notesDir` | `notes` | 笔记目录，相对 `vaultDir` 或绝对路径 |
| `chatService` | `aurabot` | 聊天服务名，用 `ctx.get(名字)` 取。接自己的 QQ 实现时改成你的服务名 |
| `chatDataDir` | `$DSH_HOME/plugins-data/<chatService>` | 聊天数据目录（`diary.json`、`chatlog/`） |
| `chatApiBase` | `/<chatService>/api` | 聊天服务的 HTTP 前缀（抖音默认跟随它） |
| `douyinApiBase` | 空（跟随 `chatApiBase`） | **抖音后端基地址**，可填完整 URL（支持别的端口/域名） |
| `douyinEnabled` | `true` | 是否允许卧室触发真实刷抖音 |
| `allowAgentWrite` | `true` | 是否允许 agent 通过工具写笔记、改天气 |
| `roomFile` | `$DSH_HOME/dsh-pet-bedroom/room.json` | 房间状态（时辰/天气/壁纸/家具）的持久化文件 |

对应的环境变量（优先级：显式配置 > 环境变量 > 默认值）：

| 环境变量 | 作用 |
|:--|:--|
| `BEDROOM_VAULT_DIR` | 记忆库根目录 |
| `BEDROOM_CHAT_DIR` | 聊天数据目录（优先于 `AURABOT_DATA_DIR`） |
| `AURABOT_DATA_DIR` | 兼容旧名：Aurabot 的数据目录 |
| `BEDROOM_PET_ROUTE` | dsh-pet 路由前缀 |
| `DSH_HOME` | DSH 配置根目录（默认 `~/.dsh`） |

> 路径里的 `~` 不会被自动展开，请写绝对路径（Windows 如 `D:\memory\vault`，
> macOS/Linux 如 `/Users/me/vault`）。

---

## ⚠️ 两块需要你自己接入的能力

**这两块不是插件自带的，每个人都不一样。** 仓库里只保留「约定」和「默认适配 Aurabot」，
你需要按自己的环境接一个实现，或者干脆不接。

不接也能用：房间、桌宠、日记/笔记、时辰天气、家具、壁纸都正常，
只是手机 QQ 显示「还没有聊天记录」、抖音按钮如实说「没接上」。

### QQ 部分：你需要接入自己的

卧室不直接连 QQ，它只认一个 **DSH 服务**（Cordis service）。默认服务名 `aurabot`。

#### 约定 A：服务与事件

你的插件在宿主半侧这样做：

```js
ctx.provide('你的服务名', service);   // 然后用配置 chatService: '你的服务名' 指过来
```

`service` 需要提供：

```ts
{
  on(event: 'activity', handler): () => void,   // 返回取消订阅函数
  hub?: {
    groupNames?: Map<string, string>,            // 群号 → 群名（可选，用于内存缓存）
    groupName?: (gid: string) => Promise<string>,// 查群名（可选，查不到就退回「群 <号>」）
  },
}
```

`activity` 事件里，卧室关心的字段：

```js
{
  kind: 'in',        // 'in' = 收到对方消息；她发出去的不算
  owner: true,       // 是不是「主人本人」。只认 true
  direct: true,      // 是不是私聊。群聊是 false
  text: '睡觉',      // 消息正文，会先过一遍命令词表
  chatId: 'private:10001',  // 形状 private:<号> / group:<群号>
}
```

只要满足 `kind === 'in' && owner === true && direct === true`，这条消息就会：

1. 进卧室的「手机」未读消息；
2. 命中命令词（睡觉/起床/刷抖音/去电脑桌/看手机/看窗外/自由活动/别刷了）时，
   让桌宠在卧室里真的去做。

> 为什么用 `owner` / `direct` 两个布尔标记，而不是解析消息前缀？
> 靠正则扒文本很容易因为一句文案改动整体失效；结构化字段稳得多。

#### 约定 B：聊天流水（手机里的聊天界面）

手机里显示的是**真实聊天记录**，来自这个目录：

```
<chatDataDir>/chatlog/YYYY-MM-DD.jsonl
```

每行一个 JSON：

```json
{"t": 1730000000000, "chatId": "private:10001", "who": "小明", "uid": "10001", "text": "在吗"}
{"t": 1730000060000, "chatId": "private:10001", "who": "bot", "text": "在的"}
{"t": 1730000120000, "chatId": "group:20002", "who": "小红", "uid": "10002", "text": "刷抖音"}
```

- `who: 'bot'` 表示是她自己发的，其余是对方昵称；
- `uid` 是发言人 QQ 号，用来取头像（可空）；
- `chatId` 必须是 `private:<数字>` 或 `group:<数字>`，否则卧室拒绝显示。

#### 约定 C：日记（桌上那篇）

```
<chatDataDir>/diary.json
{
  "plan": { "...": "随便" },
  "history": [
    { "at": 1730000000000, "text": "今天把房间换成了这张图。", "ok": true }
  ]
}
```

卧室按天聚合：同一天多篇取**最后一篇**当主日记，其余记进 `count`；
点开能看到当天所有篇目（带时间小标题）。**只读，不代写**。

#### 方案一：用现成的 Aurabot

如果你已经装了 `dsh-aurabot-qq`（Aurabot，经 SnowLuma / OneBot 接 QQ），
它正好满足上面全部约定，服务名就是 `aurabot`，什么都不用改。

#### 方案二：自己实现（最小示意）

```js
// 你自己的 QQ 插件（宿主半侧）
export const name = 'my-qq';
export function apply(ctx, config = {}) {
  const listeners = new Set();

  const service = {
    on(event, fn) {
      if (event !== 'activity') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  ctx.provide('my-qq', service);

  // 你的 QQ 网关回调里：把收到的消息转成 activity
  function onIncoming(msg) {
    const activity = {
      kind: 'in',
      owner: msg.from === config.ownerQq,     // 只有主人本人
      direct: msg.type === 'private',          // 只有私聊
      text: msg.text,
      chatId: (msg.type === 'private' ? 'private:' : 'group:') + msg.chatId,
    };
    // 同时追加聊天流水（约定 B）
    appendChatlog(activity, msg.nickname, msg.uid);
    for (const fn of listeners) fn(activity);
  }
}
```

然后在卧室配置里写 `chatService: 'my-qq'`、`chatDataDir: '你写 chatlog 的目录'`。

> **不要**把凭据、QQ 密码、令牌写进这个仓库或配置示例里。
> 本项目不读取、不保存任何凭据。

### 抖音部分：你需要接入自己的

卧室不自己开浏览器、不登录抖音。它只调你后端的两个 HTTP 接口。

#### 接口契约

```
GET  <douyinApiBase>/douyin/state
      → { "ok": true, "busy": false, "watched": 12,
          "pauseReason": "", "lastSkipReason": "", "history": [] }

POST <douyinApiBase>/douyin/run       body: {}
      → { "ok": true, "message": "刚开始刷，这一轮看 3 个左右" }
      → { "ok": false, "message": "今天额度用完了" }     ← 拒绝理由会原样显示
```

- `douyinApiBase` 默认跟随聊天服务（默认即 Aurabot 的 `/aurabot/api`），
  也可以指向完全不同的地址，例如 `http://127.0.0.1:8080/api`。
- 约定 `run` 是**后台开始、马上返回**（一轮要几分钟）；
  卧室只负责说「开刷了」，进度从 `state` 读。
- 约定**没有停止接口**：卧室的「别刷了」会如实返回 `ok: false` 并说明停不了，
  不会假装按停。如果你自己实现了停止接口，可以在此基础上扩展。

#### 最小后端示意（Node，无依赖）

```js
import http from 'node:http';

let busy = false, watched = 0, pauseReason = '';

http.createServer(async (req, res) => {
  const send = (obj) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (req.url === '/api/douyin/state') {
    return send({ ok: true, busy, watched, pauseReason, lastSkipReason: '', history: [] });
  }
  if (req.url === '/api/douyin/run' && req.method === 'POST') {
    if (busy) return send({ ok: false, message: '正在刷，等这一轮结束' });
    busy = true;
    // 这里换成你自己的刷抖音逻辑（浏览器自动化 / 别的服务）
    setTimeout(() => { busy = false; watched += 3; }, 60_000);
    return send({ ok: true, message: '开刷了，这一轮约 1 分钟' });
  }
  res.writeHead(404).end();
}).listen(8080);
```

然后配置：

```yaml
config:
  douyinApiBase: 'http://127.0.0.1:8080/api'
```

#### 默认适配：Aurabot 的「现在刷一轮」

Aurabot 的刷抖音模块正好提供了这两个接口（`/aurabot/api/douyin/run|state`），
所以默认配置下不用额外写后端；没有 Aurabot 时按钮会如实说没接上。

---

## 本项目引用了 dsh-pet 的哪些功能

**明确声明：本项目不改 dsh-pet 一行代码，也不读写它的配置文件或数据库。**
它只使用 dsh-pet 已经对外开着的 HTTP 能力与素材：

| 引用的 dsh-pet 能力 | 用在哪 | 具体怎么用 |
|:--|:--|:--|
| `GET <petRoute>/config` | 选宠物、取动画池 | 读宠物条目：`pets[]`（`id`/`name`/素材根）、`animations`（`idle`、`turn`、`drag`、`clicks`、`moves.actions`、`categories[].actions`、`events`），拼成完整动画池 |
| `GET <petRoute>/thumb/<素材根>/<动画名>.webm` | 卧室里所有桌宠画面 | 经本插件 `/dsh-pet-bedroom/pet/thumb/...` **代理**转发（独立页面不能直接请求宿主路由）；只放行 `<根>/<文件>.webm\|mov` 两段，拒绝目录穿越 |
| 宠物 `id` 与素材根 | `petId` 配置 | 默认取列表第一只；填了 `petId` 就挑那只 |
| 动画 **待机呼吸休闲**（`idle` 优先） | 默认站立 | 从 `animations.idle` 取，取不到再从池里按「待机 / 呼吸」找 |
| 动画 **小憩 / 沉眠 / 睡觉 / 哈欠** | 躺床睡觉 | 按关键词在池里挑，没有就退回待机 |
| 动画 **写代码 / 敲击桌面 / 轻快记录** | 坐电脑前 | 同上 |
| 动画 **对屏 / 碎碎念 / 东张西望** | 拿手机看 | 同上 |
| 动画 **东张西望 / 伸懒腰 / 摇扇** | 趴窗台看外面 | 同上 |
| 动画 **玩水枪**（优先）/ 浇水 / 浇花 | 给龟背竹喷水 | 池里没有「玩水枪」才退到别的 |
| 动画 **360 / 旋转展示** | 坐电脑前的「背面」 | 播到约 2.3s **就地暂停**，得到真背面（不翻转、不裁腿） |
| 动画 **点击回应 / 开心 / 害羞** | 点桌宠 | 随机回应 |
| 动画 **螃蟹走路 / 漂浮踏步 / 奔跑** | 自由走动 | 同上 |
| 素材尺寸约定 | 角色大小恒定 | 素材是 640×360 透明画布，角色实体占**宽 33.8%、高 16.7%~91.7%**；所以容器宽度固定 41.4%，换算后角色约占舞台 **14%** |
| 整个动画池 | 右键「动作演示」 | 把 `config` 里的全部动画名拿来随机演示（例如 106 条） |

**不引用**的部分：dsh-pet 的桌面窗口、拖拽、设置页、存储、皮肤包、内部状态，
本项目都不碰。dsh-pet 升级换皮后，卧室会自动跟着变（因为不写死动画名）。

> 如果你换了一只宠物，只要它的素材仍遵循上面的画布约定，卧室不用改代码；
> 例外情况见 [自定义](#自定义) 里的尺寸换算。

---

## 页面与接口清单

### HTTP 路由（都在 `/dsh-pet-bedroom` 前缀下，**只接受本机请求**）

| 方法 | 路径 | 作用 |
|:--|:--|:--|
| GET | `/` | 卧室页面 |
| GET | `/room.png`、`/chair.png` | 房间图、椅子前景层 |
| GET | `/wallpaper/<id>.jpg` | 手机壁纸（白名单 4 张） |
| GET | `/avatar/<QQ号>` | 个人头像代理（`q1.qlogo.cn`，只放行数字号） |
| GET | `/groupavatar/<群号>` | 群头像代理（`p.qlogo.cn`） |
| GET | `/pet/thumb/<根>/<文件>` | dsh-pet 素材代理 |
| GET | `/state` | 房间完整快照（网页每 2 秒轮询） |
| GET | `/doc?kind=diary\|notes&name=...` | 读日记全文 / 笔记全文 |
| GET | `/phone/chat?id=...` | 读某个会话的消息 |
| POST | `/room` | 改时辰 / 天气 / 壁纸 / 自动时间 |
| POST | `/slot` | 加/删家具 |
| POST | `/command` | 面板按钮/输入框 → 执行命令 |
| POST | `/phone/read`、`/phone/off`、`/phone/say` | 手机已读/灭屏/说一句 |
| POST | `/douyin/start`、`/douyin/stop` | 刷抖音（转给你后端） |

### 给 agent 的工具

| 工具 | 作用 |
|:--|:--|
| `bedroom_status` | 看房间现在什么样：时辰、天气、壁纸、桌上文档、未读消息、抖音状态 |
| `bedroom_read` | 读日记（按日期）或读书笔记（按标题），或只列清单 |
| `bedroom_write` | 写读书笔记（追加/替换）。**日记不能代写**，那是聊天服务自己写的 |
| `bedroom_atmosphere` | 换天气（晴天/雨/雪）、换时辰（清晨/中午/下午/晚间）、开关自动时间 |
| `bedroom_furniture` | 往房间槽位加/删家具（带介绍，鼠标移上去能看到） |
| `bedroom_wallpaper` | 列手机壁纸 / 换壁纸 |

---

## 目录结构

```
dsh-pet-bedroom/
├─ index.js              宿主半侧：HTTP 路由、读日记/笔记/聊天流水、工具、QQ 事件
├─ client.js             浏览器半侧：只在侧边栏加一个「卧室」按钮（不挂浮层）
├─ cordis.patch.yml      插件插入项（id / name）
├─ package.json          包信息与 exports
├─ web/index.html        卧室页面（单文件：HTML + CSS + JS）
├─ assets/
│  ├─ room.png           房间图（1536×1024）
│  ├─ chair.png          椅子前景层（坐电脑前挡住后背）
│  └─ wall/*.jpg         手机壁纸（4 张）
├─ locale/zh.json|en.json 文案
├─ audit.cjs             静态自检（99 条：尺寸、姿态、路由、配置项……）
├─ smoke.mjs             冒烟：页面/房间图/壁纸/日记/笔记/路径逃逸
├─ test-aurabot.mjs      端到端：QQ 过滤 / 日记聚合（假服务）
├─ test-phone.mjs        端到端：手机会话 / 抖音接口
├─ test-group.mjs        端到端：群聊标题与会话人
├─ test-config.mjs       端到端：通用接口（petRoute/petId/chatService/douyinApiBase）
├─ preview.mjs           独立预览服务器（不重启 DSH 验证页面改动）
├─ v-*.mjs               Playwright 可视验证（头像/拨号/群聊/壁纸/圆角）
├─ make-chair.py         从 room.png 抠椅子生成前景层
└─ register-chair.py     配准新椅子图到房间坐标系
```

---

## 自定义

### 换房间图

1. 把新图命名为 `assets/room.png`（建议同比例 3:2，如 1536×1024）；
2. **重新标定** `web/index.html` 里的 `SPOTS`：`x/y/w/h` 是图上的百分比，
   `anchor` 是宠物该站的位置（`anchor.y` 越大，人在画面上越靠下）；
3. 全局上下挪动只改 `const ANCHOR_LIFT`，**不要**逐个改 `anchor`——
   房间里还有写死的 `goTo({x,y})`（躺床、起床、回中间、自由走动），只改 anchor 会漏；
4. 改完跑 `node audit.cjs`。

### 调整桌宠大小

只改一个数：`web/index.html` 里的 `const widthPct = 41.4;`
角色占舞台宽 ≈ `widthPct × 0.338`（41.4 → 14%，60 → 20.3%）。
换目标值后同步改 `audit.cjs` 里那条 14% 的断言。

### 换椅子 / 重新配准

```bash
python make-chair.py        # 从 room.png 抠出椅子
python register-chair.py    # 把新椅子图配准到房间坐标系（需要 scipy/Pillow）
```

脚本会打印 `left/top/width/height` 百分比，写进 `web/index.html` 的 `.chair-front`。

### 加家具 / 壁纸 / 命令词

- 家具：用 `bedroom_furniture` 工具或页面右键菜单，会持久化到 `room.json`；
- 壁纸：把新图放 `assets/wall/`，在 `index.js` 的 `WALLPAPERS` 里加一条（id + 文件）；
- 命令词：改 `index.js` 的 `COMMAND_RULES`。**注意顺序**：「别刷了」必须排在「刷抖音」前面，
  否则「别刷抖音」会被读成「刷抖音」。

### 去掉 QQ 或抖音

- 抖音：`douyinEnabled: false`；
- QQ：不配置 `chatService` 即可（或指向一个不存在的服务名），
  手机 QQ 会显示「还没有聊天记录」，其它功能不受影响。

---

## 本地验证

在项目目录里：

```bash
node audit.cjs          # 99 条静态自检，必须 ALL PASS
node smoke.mjs          # 冒烟（临时目录，不碰真实数据）
node test-aurabot.mjs   # 假聊天服务：QQ 过滤 + 日记聚合
node test-phone.mjs     # 手机会话 + 抖音接口
node test-group.mjs     # 群聊标题 + 发言人
node test-config.mjs    # 通用接口：自定义 petRoute/chatService/douyinApiBase 全生效
```

所有测试都是**隔离的**：临时目录 + 假服务 + 假 `fetch`，不会读写你的真实记忆库、
不会真的刷抖音、不会真的发 QQ 消息。

页面预览（不重启 DSH）：

```bash
node preview.mjs        # → http://127.0.0.1:64123/dsh-pet-bedroom/
```

`preview.mjs` 会照搬宿主的静态路由与素材代理，并把 `/state` 转发给真实宿主
（`UPSTREAM` 可覆盖）。

Playwright 可视验证（可选，需要 `playwright-core` 和 Chromium）：

```bash
# 如果 playwright-core 不在当前 node_modules 里，用环境变量指过去
PLAYWRIGHT_CORE=file:///path/to/node_modules/playwright-core/index.mjs \
BEDROOM_URL=http://127.0.0.1:64123/dsh-pet-bedroom/ \
node v-dial.mjs
```

---

## 安全与边界

- **只接受本机请求**：所有路由的 `Host` 必须是 `127.0.0.1` / `localhost` / `::1`，否则 403。
- **白名单**：壁纸只放行 4 个 id；头像只放行纯数字号码；素材只放行 `<根>/<文件>.webm|mov`。
- **不做目录遍历**：`/doc`、`/wallpaper`、`/pet/thumb` 都有校验，`../` 一律拒绝。
- **不碰凭据**：本项目不读取、不保存 QQ 密码、Cookie、Token。
- **不假装**：抖音拒绝就显示拒绝理由；停不了就说停不了；日记没有就是没有。
- **手机消息是内存态**：重启 DSH 即清空。它是「刚才谁找我」，不是聊天档案。
- **卧室不替抖音过登录/验证码**：那是你后端的事。
- **桌面模式的透明小窗里没有卧室**：卧室是浏览器页面。

---

## 常见问题

**Q：打开 `/dsh-pet-bedroom/` 是 404？**
A：插件没加载。检查 profile 的 `bundles` 是否包含 `dsh-pet-bedroom`、
`node_modules/dsh-pet-bedroom` 是否指向正确目录，然后重启 DSH。

**Q：页面能打开，但没有桌宠？**
A：dsh-pet 没装或没打开显示，或者 `petRoute` 不对。先确认
`http://<DSH>/dsh-pet-7340/config` 能返回 JSON；不能就改 `petRoute`。

**Q：桌宠尺寸不对/位置偏了？**
A：看 [调整桌宠大小](#调整桌宠大小)。位置偏多半是容器结构变了，
用浏览器量一次脚底 y 的差值，改 `ANCHOR_LIFT`。

**Q：手机里没有聊天记录？**
A：QQ 部分没接（见 [QQ 部分](#qq-部分你需要接入自己的)），
或 `chatDataDir` 里没有 `chatlog/*.jsonl`。

**Q：点「现在刷一轮」说没接上？**
A：`douyinApiBase` 没配，或后端没启动。先用
`curl http://127.0.0.1:8080/api/douyin/state` 确认它活着。

**Q：日记是空的？**
A：日记来自聊天服务（默认 Aurabot）的 `diary.json`；没接就没有。
本项目**不会**凭空编一篇日记。

**Q：能同时装多只宠物吗？**
A：一个卧室实例选一只（`petId`）。多实例需要不同路由前缀，目前不推荐。

**Q：支持 macOS / Linux 吗？**
A：代码是跨平台的（路径都用 `path` 拼）。Windows 是主要验证环境。

---

## 版本与演进

- **v2.0.0（本仓库起点）**：脱敏通用版。引入 `petRoute` / `petId` / `vaultDir` /
  `notesDir` / `chatService` / `chatDataDir` / `chatApiBase` / `douyinApiBase` 等配置项，
  QQ 与抖音改为「按契约接入」；保留 v3 的独立网页架构与全部交互。
- 历史（原作者环境）：v1 概念稿 → v2 全屏浮层（已废弃，遮罩会吃掉点击）→
  v3 独立网页 + 真实日记/聊天流水 + 手机界面。

仓库从 v2.0.0 开始按 git 提交记录演进，后续改动请写进 `CHANGELOG.md`。

---

## 许可与贡献

- **许可**：本仓库暂未附带开源许可证。开源前请由仓库所有者选定（MIT / Apache-2.0 /
  GPL-3.0 等）并加入 `LICENSE`。**在选定之前，默认保留所有权利。**
- **贡献**：欢迎 issue / PR。提交前请保证 `node audit.cjs` 与全部测试通过；
  不要提交任何个人路径、QQ 号、聊天内容、令牌或真实记忆库数据。
- **上游**：dsh-pet 的素材与动画版权归 dsh-pet 及其作者所有，本项目只做引用。

---

## 致谢

- [dsh-pet](https://www.npmjs.com/package/dsh-pet)：桌宠本体、动画池与素材接口。
- [DeepSeek Harness](https://github.com/deepseek-ai)：插件运行时与 Web 宿主。
- Aurabot（`dsh-aurabot-qq`）：本项目的 QQ 与抖音默认适配实现。

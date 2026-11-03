/**
 * dsh-pet-bedroom · 宿主半侧（v2）
 * ============================================================================
 * 卧室不再是一个「演给你看」的动画布景：它接的是 agent 自己的东西。
 *
 *   桌上放着的日记 / 读书笔记  ←  真实读取记忆库与聊天服务里的 Markdown / JSON
 *   房间的天气与时辰          ←  真实持久化，并且可以跟着真实时间自己慢慢走
 *   房间里多出来的家具        ←  真实持久化在用户目录，可增可删
 *   agent 对卧室的感知        ←  注册成工具：能查、能读、能写、能调天气
 *
 * 四条边界（改代码前先读）：
 *
 * 1. 不改 dsh-pet。宠物长什么样、有哪些动画，全部读它自己已经对外的 HTTP 接口：
 *    GET /dsh-pet-7340/config 与 /thumb/<素材根>/<名>.webm。本插件不碰它的包与配置。
 *
 * 2. QQ 消息不猜。QQ 那条链路**不是本插件自带的**，默认适配「聊天服务」
 *    （`ctx.get(chatService)`，出厂值 `aurabot`，即 Aurabot 插件经 SnowLuma /
 *    OneBot 接的 QQ）：监听它的 `activity` 事件，事件自带 `owner` / `direct`
 *    两个标记，所以**只认主人本人的私聊**——群聊、别人的私聊、网页输入、
 *    子代理的话，都不会被当成手机消息。没有这个服务时卧室照常可用，
 *    只是手机 QQ 一栏显示「未接入」。
 *
 * 3. 刷抖音不假装。刷抖音按钮打的是**你自己的抖音后端接口**（可配置），
 *    出厂指向「聊天服务」的 `/douyin/run`、`/douyin/state`（默认 Aurabot 的
 *    「现在刷一轮」模块）。它拒绝，就把它的原文理由如实传回卧室，
 *    绝不显示「正在刷」而实际没刷；没有后端时按钮只如实说没接上。
 *
 * 4. **卧室是真的**。日记读的是聊天服务每天自己写的那篇（`diary.json`），
 *    读书笔记读记忆库；没有就是没有，这里不会编一份假日记出来。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本插件目录（卧室网页与房间图都在它下面） */
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(PLUGIN_DIR, 'web');
const ASSET_DIR = path.join(PLUGIN_DIR, 'assets');

/** 卧室自己的 HTTP 前缀（与包名同源，避免与任何插件撞路由） */
const ROOM_PREFIX = '/dsh-pet-bedroom';

/** 手机消息最多留几条（内存态：重启 DSH 即清空，这不是档案，只是「刚才谁找我」） */
const PHONE_KEEP = 20;

/** 抖音接口的短缓存：面板每 2 秒轮询一次，别把对方接口打穿 */
const DOUYIN_CACHE_MS = 2500;

/** QQ 头像缓存（内存态）：同一张头像一天内不重复去 qlogo 拉 */
const AVATAR_TTL_MS = 24 * 60 * 60 * 1000;
const avatarCache = new Map();

/** 头像在页面里的取址前缀（宿主半侧代理到 q1.qlogo.cn） */
const AVATAR_PREFIX = ROOM_PREFIX + '/avatar/';
/** 群头像前缀（代理到 p.qlogo.cn/gh/<群号>/<群号>/640） */
const GROUP_AVATAR_PREFIX = ROOM_PREFIX + '/groupavatar/';

/**
 * 命令词表：**先匹配到的赢**，所以「别刷了」必须排在「刷抖音」前面，
 * 否则「别刷抖音」会被读成「刷抖音」——这是这类关键词路由最典型的翻车点。
 */
const COMMAND_RULES = [
  { action: 'douyin-stop', test: /(别|不要|停|关掉|关)(一下)?(刷|看)?(抖音|视频)|停止(刷|看)|别刷了|停一下/ },
  { action: 'sleep', test: /睡觉|睡吧|去睡|困了|晚安|休息一下|躺(一)?会/ },
  { action: 'wake', test: /起床|醒醒|醒醒吧|起来|别睡了/ },
  { action: 'douyin', test: /刷(一)?(会)?抖音|看(会)?抖音|抖音|短视频|刷视频/ },
  { action: 'desk', test: /电脑|上网|干活|写代码|工作|桌前|写日记|写笔记/ },
  { action: 'phone', test: /手机|看消息|回消息|来消息/ },
  { action: 'window', test: /窗外|看风景|外面|看看天|窗边/ },
  { action: 'idle', test: /自由活动|随便走|自己玩|去玩|溜达|散步/ },
];

/** 宠物被叫去做事时，气泡里回的一句（很短，像人随手打的字） */
const ACTION_REPLY = {
  sleep: '那我躺一会儿…',
  wake: '醒啦醒啦，别喊了',
  desk: '好，我去桌子前坐着',
  phone: '手机我拿到手上了',
  douyin: '行，我刷会儿抖音',
  'douyin-stop': '好啦不刷了',
  window: '我去看看窗外',
  idle: '那我随便走走',
};

/** 一天里的四个时辰（客户端按 id 取配色） */
const TIMES = ['dawn', 'noon', 'afternoon', 'night'];
/** 三种天气 */
const WEATHERS = ['sunny', 'rain', 'snow'];

/** 一句话 → 命令。认不出来返回 null（卧室照实显示「它看了一遍，没明白」） */
function parseCommand(text) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  for (const rule of COMMAND_RULES) {
    if (rule.test.test(value)) return rule.action;
  }
  return null;
}

export const name = 'dsh-pet-bedroom';

/** webServer 是本插件唯一硬依赖；tools 走可选获取，缺了只是 agent 少一套感知 */
export const inject = ['webServer'];

export function apply(ctx, config = {}) {
  const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh');

  const options = {
    /** 哪只宠物进卧室；空 = 取 dsh-pet 列表里第一只 */
    petId: typeof config.petId === 'string' ? config.petId : '',
    /** dsh-pet 的 HTTP 路由前缀（动画池与素材都从它读） */
    petRoute:
      typeof config.petRoute === 'string' && config.petRoute
        ? config.petRoute
        : process.env.BEDROOM_PET_ROUTE || '/dsh-pet-7340',
    /** 是否允许卧室触发真实的自动刷抖音 */
    douyinEnabled: config.douyinEnabled !== false,
    /**
     * 抖音接口基地址（不含 /douyin/run）。空 = 跟随聊天服务（`/<chatService>/api`）。
     * 接自己的抖音后端时填这里，例如 `http://127.0.0.1:8080/api`。
     */
    douyinApiBase: typeof config.douyinApiBase === 'string' ? config.douyinApiBase : '',
    /**
     * QQ / 日记 / 聊天流水来自哪个服务（`ctx.get(名字)`）。
     * 出厂值 `aurabot`：Aurabot 插件对外提供 `ctx.provide('aurabot', service)`。
     * 接自己的 QQ 实现时，把这里改成你的服务名。
     */
    chatService:
      typeof config.chatService === 'string' && config.chatService ? config.chatService : 'aurabot',
    /**
     * 聊天服务的数据目录（diary.json / chatlog/ 在这里）。
     * 空 = `BEDROOM_CHAT_DIR` → `AURABOT_DATA_DIR` → `$DSH_HOME/plugins-data/<chatService>`。
     */
    chatDataDir: typeof config.chatDataDir === 'string' ? config.chatDataDir : '',
    /** 聊天服务 HTTP 前缀；空 = `/<chatService>/api` */
    chatApiBase: typeof config.chatApiBase === 'string' ? config.chatApiBase : '',
    /** 手机消息来源：qq = 只认 QQ；any = 任何渠道都算 */
    phoneSource: config.phoneSource === 'any' ? 'any' : 'qq',
    /** agent 的记忆库根目录（读书笔记在里面；日记来自聊天服务） */
    vaultDir: typeof config.vaultDir === 'string' && config.vaultDir ? config.vaultDir : '',
    /** 读书笔记目录（相对 vault 或绝对路径） */
    notesDir: typeof config.notesDir === 'string' && config.notesDir ? config.notesDir : 'notes',
    /** 允许 agent 通过工具写笔记 / 改天气 */
    allowAgentWrite: config.allowAgentWrite !== false,
    /** 房间布局的持久化文件 */
    roomFile: typeof config.roomFile === 'string' && config.roomFile ? config.roomFile : '',
    /**
     * QQ 直连（出厂默认 SnowLuma）：OneBot 11 的 HTTP API 基地址。
     * 空 = `BEDROOM_QQ_API` → `http://127.0.0.1:3001`（SnowLuma 默认端口）。
     * 这是「QQ 连接窗口」里保存的值，页面改完立即生效，不用重启。
     */
    qqApiBase: typeof config.qqApiBase === 'string' && config.qqApiBase ? config.qqApiBase : '',
    /** OneBot HTTP API 的访问令牌；空 = 不带鉴权（只建议本机使用） */
    qqToken: typeof config.qqToken === 'string' ? config.qqToken : '',
    /** 主人本人 QQ 号：只有它发来的私聊才算「主人的消息」 */
    qqSelfId: typeof config.qqSelfId === 'string' ? config.qqSelfId : '',
    /** QQ 连接配置的持久化文件 */
    qqFile: typeof config.qqFile === 'string' && config.qqFile ? config.qqFile : '',
  };

  /** 记忆库根目录：显式配置 → BEDROOM_VAULT_DIR → $DSH_HOME/memory-vault（通用默认，不指向任何人的私人路径） */
  const vaultDir = options.vaultDir || process.env.BEDROOM_VAULT_DIR || path.join(dshHome, 'memory-vault');

  /** 聊天服务名 / HTTP 前缀 / 数据目录：QQ、日记、抖音共用这一套 */
  const chatServiceName = options.chatService;
  const chatApiBase = () => options.chatApiBase || '/' + chatServiceName + '/api';
  const douyinApiBase = () => options.douyinApiBase || chatApiBase();
  const CHAT_LABEL = chatServiceName === 'aurabot' ? 'Aurabot（聊天服务）' : chatServiceName;
  /** dsh-pet 路由前缀，末尾不带斜杠 */
  const PET_ROUTE = '/' + String(options.petRoute).replace(/^\/+|\/+$/g, '');

  const roomPath = options.roomFile || path.join(dshHome, 'dsh-pet-bedroom', 'room.json');

  // ==========================================================================
  // 房间持久态：天气 / 时辰 / 插槽家具
  // ==========================================================================
  const defaultRoom = { version: 1, time: 'noon', weather: 'sunny', autoTime: true, wallpaper: 'pine', slots: [] };

  // 手机壁纸：真实照片（Unsplash，经 picsum 取回），放在 assets/wall/。
  // 文件名按**实测主色调**取，不按「看起来像什么」取——卧室不编造内容描述。
  const WALLPAPERS = [
    { id: 'pine',  file: 'pine.jpg',  label: '松林',   tone: '深绿',   note: '颜色最沉，图标区最安静' },
    { id: 'azure', file: 'azure.jpg', label: '晴空',   tone: '蓝',     note: '亮，天在上、地在下的构图' },
    { id: 'haze',  file: 'haze.jpg',  label: '雾白',   tone: '灰白',   note: '最淡，接近系统壁纸的干净感' },
    { id: 'dusk',  file: 'dusk.jpg',  label: '暮色',   tone: '紫蓝带橙', note: '饱和最高，像傍晚' },
  ];
  const WALL_IDS = WALLPAPERS.map((w) => w.id);

  const SLOT_KINDS = ['box', 'plant', 'lamp', 'shelf', 'toy'];

  function sanitizeSlot(item) {
    if (!item || typeof item.id !== 'string' || !item.id) return null;
    const num = (value, fallback, min, max) =>
      Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
    return {
      id: String(item.id).slice(0, 60),
      kind: SLOT_KINDS.includes(item.kind) ? item.kind : 'box',
      label: String(item.label ?? '新家具').slice(0, 40),
      detail: String(item.detail ?? '').slice(0, 400),
      x: num(item.x, 520, 40, 1500),
      y: num(item.y, 620, 120, 1000),
      w: num(item.w, 60, 20, 200),
      d: num(item.d, 60, 20, 200),
      h: num(item.h, 50, 6, 200),
      color: /^#[0-9a-f]{6}$/i.test(String(item.color ?? '')) ? item.color : '#cfe3ff',
    };
  }

  function readRoom() {
    try {
      const raw = JSON.parse(fs.readFileSync(roomPath, 'utf8'));
      if (!raw || typeof raw !== 'object') return { ...defaultRoom, slots: [] };
      return {
        version: 1,
        time: TIMES.includes(raw.time) ? raw.time : defaultRoom.time,
        weather: WEATHERS.includes(raw.weather) ? raw.weather : defaultRoom.weather,
        autoTime: raw.autoTime !== false,
        wallpaper: WALL_IDS.includes(raw.wallpaper) ? raw.wallpaper : defaultRoom.wallpaper,
        slots: Array.isArray(raw.slots) ? raw.slots.map(sanitizeSlot).filter(Boolean).slice(0, 40) : [],
      };
    } catch {
      return { ...defaultRoom, slots: [] };
    }
  }

  const room = readRoom();

  function writeRoom() {
    try {
      fs.mkdirSync(path.dirname(roomPath), { recursive: true });
      const tmp = roomPath + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(room, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, roomPath);
      return true;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // QQ 连接：OneBot 11（出厂默认 SnowLuma）
  //   配置窗口保存到 qq.json；页面改完立刻生效（每次请求都重新读）。
  //   两个入口：
  //     1) HTTP API：测试连接（get_login_info / get_friend_list）；
  //     2) HTTP 上报：SnowLuma 把消息 POST 到 /qq/event，卧室据此进手机、执行命令。
  //   令牌只落本机、只写不回显；日志里不打印。
  // ==========================================================================
  const qqPath = options.qqFile || path.join(dshHome, 'dsh-pet-bedroom', 'qq.json');
  const QQ_PROVIDERS = ['snowluma', 'onebot'];
  /** SnowLuma 的 OneBot HTTP 默认端口；以它面板里实际显示的为准 */
  const QQ_DEFAULT_BASE = 'http://127.0.0.1:3001';

  const qqRuntime = {
    /** 最近一次「测试连接」的结果 */
    lastTest: null,
    /** 上报计数（只是给窗口显示「收到了几条」，不进任何档案） */
    events: { total: 0, lastAt: 0, lastText: '', rejected: 0 },
    /** message_id 去重，防止同一条被重复上报（Aurabot + 直连同时开时尤其重要） */
    seen: new Map(),
  };

  /** 只接受 http(s) 地址，末尾斜杠去掉；不合法的返回空串 */
  function sanitizeQqBase(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.toString().replace(/\/+$/, '');
    } catch {
      return '';
    }
  }

  function readQq() {
    const envBase = sanitizeQqBase(process.env.BEDROOM_QQ_API);
    const defaults = {
      version: 1,
      provider: 'snowluma',
      apiBase: options.qqApiBase || envBase || QQ_DEFAULT_BASE,
      token: options.qqToken || process.env.BEDROOM_QQ_TOKEN || '',
      selfId: String(options.qqSelfId || process.env.BEDROOM_QQ_SELF_ID || '').replace(/\D/g, '').slice(0, 12),
      allowGroup: false,
      enabled: true,
    };
    let raw = null;
    try {
      const text = readText(qqPath, 200_000);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
    return {
      version: 1,
      provider: QQ_PROVIDERS.includes(raw.provider) ? raw.provider : 'snowluma',
      apiBase: sanitizeQqBase(raw.apiBase) || defaults.apiBase,
      token: typeof raw.token === 'string' ? raw.token : defaults.token,
      selfId: /^\d{5,12}$/.test(String(raw.selfId ?? '')) ? String(raw.selfId) : defaults.selfId,
      allowGroup: raw.allowGroup === true,
      enabled: raw.enabled !== false,
    };
  }

  /** 合并写入 qq.json；返回 false 表示没写成功（窗口会如实显示） */
  function writeQq(patch) {
    const next = { ...readQq(), ...(patch && typeof patch === 'object' ? patch : {}) };
    try {
      fs.mkdirSync(path.dirname(qqPath), { recursive: true });
      const tmp = qqPath + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, qqPath);
      return true;
    } catch {
      return false;
    }
  }

  /** QQ 上报/直连收到的消息落一份自己的流水（手机聊天列表用得到，且不污染聊天服务的数据） */
  const qqLogDir = () => path.join(dshHome, 'dsh-pet-bedroom', 'qq-log');

  function appendQqLog(rec) {
    try {
      const t = Number(rec.t) || Date.now();
      const day = new Date(t).toLocaleDateString('sv-SE');
      fs.mkdirSync(qqLogDir(), { recursive: true });
      fs.appendFileSync(
        path.join(qqLogDir(), day + '.jsonl'),
        JSON.stringify({ t, chatId: rec.chatId, who: rec.who, uid: rec.uid, text: rec.text }) + '\n',
        { mode: 0o600 },
      );
      return true;
    } catch {
      return false;
    }
  }

  function readQqLog(days = 3) {
    let names = [];
    try {
      names = fs
        .readdirSync(qqLogDir())
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
        .sort()
        .slice(-Math.max(1, days));
    } catch {
      return [];
    }
    const out = [];
    for (const name of names) {
      const raw = readText(path.join(qqLogDir(), name), 4_000_000);
      if (raw === null) continue;
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          const t = Number(item?.t);
          if (!Number.isFinite(t)) continue;
          out.push({
            t,
            chatId: String(item.chatId ?? ''),
            who: String(item.who ?? ''),
            uid: String(item.uid ?? ''),
            text: String(item.text ?? ''),
          });
        } catch {
          /* 坏行跳过 */
        }
      }
    }
    return out;
  }

  /**
   * 调一次 OneBot 11 HTTP API。POST 优先（SnowLuma / NapCat 都支持），
   * 404/405 时退回 GET（少数实现只认 GET）。
   */
  async function oneBotApi(method, { apiBase, token, timeout = 5000, body } = {}) {
    const qq = readQq();
    const base = sanitizeQqBase(apiBase || qq.apiBase);
    if (!base) return { ok: false, error: '还没填 OneBot HTTP 地址' };
    const tok = token === undefined ? qq.token : token;
    const payload = JSON.stringify(body ?? {});
    const headers = { 'content-type': 'application/json' };
    if (tok) headers.authorization = 'Bearer ' + tok;

    const attempt = async (httpMethod, withQuery) => {
      const url = base + '/' + method + (withQuery && tok ? '?access_token=' + encodeURIComponent(tok) : '');
      const init = { method: httpMethod, headers, signal: AbortSignal.timeout(timeout) };
      if (httpMethod === 'POST') init.body = payload;
      return fetch(url, init);
    };

    try {
      let res = await attempt('POST', false);
      if (res.status === 404 || res.status === 405) {
        try {
          res = await attempt('GET', true);
        } catch {
          /* 保持第一次的响应 */
        }
      }
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      if (!res.ok) {
        // 426 / 101 是「这是 WebSocket 端口，不是 HTTP API 端口」的典型信号：
        // SnowLuma 的 WS 服务与 HTTP API 端口不同，填错时浏览器/Node 只会看到升级要求，
        // 直接把这句翻译成人话，免得用户对着 "Upgrade Required" 猜。
        const said = data?.wording || data?.message || text.slice(0, 160) || 'HTTP ' + res.status;
        const hint =
          res.status === 426 || res.status === 101
            ? '（这个端口是 WebSocket 服务，不是 HTTP API。请填 SnowLuma 面板里「HTTP API」那一栏的端口，默认 3001 也常被 WS 占用）'
            : '';
        return { ok: false, status: res.status, error: String(said) + hint };
      }
      if (!data || typeof data !== 'object') {
        return { ok: false, status: res.status, error: '返回的不是 JSON —— 这个地址可能不是 OneBot HTTP API' };
      }
      if (data.status === 'failed' || Number(data.retcode) !== 0) {
        return { ok: false, status: res.status, error: String(data.wording || data.message || 'retcode ' + data.retcode) };
      }
      return { ok: true, data };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: /timeout|abort/i.test(msg) ? '连接超时：后端没启动，或者地址/端口不对' : msg,
      };
    }
  }

  /** 测试连接：拿登录信息 + 好友数，把结果记在内存里给窗口显示 */
  async function testQq(over = {}) {
    const qq = readQq();
    const apiBase = sanitizeQqBase(over.apiBase || qq.apiBase);
    const token = over.token === undefined ? qq.token : String(over.token);
    const login = await oneBotApi('get_login_info', { apiBase, token, timeout: 6000 });
    if (!login.ok) {
      qqRuntime.lastTest = { ok: false, at: now(), error: login.error };
      return { ok: false, apiBase, error: login.error };
    }
    const d = login.data?.data && typeof login.data.data === 'object' ? login.data.data : login.data;
    const uin = String(d?.user_id ?? d?.uin ?? '');
    const nickname = String(d?.nickname ?? d?.nick ?? '');
    let friendCount = null;
    const friends = await oneBotApi('get_friend_list', { apiBase, token, timeout: 6000 });
    if (friends.ok) {
      const list = Array.isArray(friends.data?.data) ? friends.data.data : Array.isArray(friends.data) ? friends.data : null;
      friendCount = list ? list.length : null;
    }
    qqRuntime.lastTest = { ok: true, at: now(), uin, nickname, friendCount };
    return { ok: true, apiBase, uin, nickname, friendCount };
  }

  /** 给窗口的状态快照（永远不包括令牌本身） */
  function qqInfo(origin) {
    const qq = readQq();
    return {
      ok: true,
      provider: qq.provider,
      apiBase: qq.apiBase,
      selfId: qq.selfId,
      hasToken: Boolean(qq.token),
      enabled: qq.enabled,
      allowGroup: qq.allowGroup,
      reportPath: '/qq/event',
      reportUrl: origin ? origin + '/dsh-pet-bedroom/qq/event' : '',
      connected: qqRuntime.lastTest,
      events: {
        total: qqRuntime.events.total,
        lastAt: qqRuntime.events.lastAt,
        lastText: qqRuntime.events.lastText,
        rejected: qqRuntime.events.rejected,
      },
      logDir: qqLogDir(),
      defaultBase: QQ_DEFAULT_BASE,
    };
  }

  /** 真实时间 → 时辰。autoTime 打开时窗外环境跟着真实时间走。 */
  function timeOfNow() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) return 'dawn';
    if (hour >= 11 && hour < 16) return 'noon';
    if (hour >= 16 && hour < 19) return 'afternoon';
    return 'night';
  }

  const currentTime = () => (room.autoTime ? timeOfNow() : room.time);

  // ==========================================================================
  // 记忆库：真实读取（只读/只写在库内部，路径逃逸一律拒绝）
  //   读书笔记仍来自记忆库；**日记已经改由 Aurabot 提供**（见 listDiary）
  // ==========================================================================
  const notesRoot = () =>
    path.isAbsolute(options.notesDir) ? options.notesDir : path.join(vaultDir, options.notesDir);

  function safeJoin(root, name) {
    const resolved = path.resolve(root, name);
    const base = path.resolve(root);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
    return resolved;
  }

  function readText(file, max = 200_000) {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > max) return null;
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }

  function previewOf(text) {
    return String(text)
      .replace(/^---[\s\S]*?---\s*/m, '')
      .replace(/^#.*$/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
  }

  function sectionOf(text, title) {
    const re = new RegExp('##\\s*' + title + '\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)', 'i');
    const hit = String(text).match(re);
    return hit ? hit[1].replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  }

  /**
   * 聊天服务的日记文件：`<BEDROOM_CHAT_DIR | AURABOT_DATA_DIR | $DSH_HOME/plugins-data/<服务名>>/diary.json`。
   * 结构与 Aurabot（出厂适配）的 `src/core/store.js` + `features/qzone.js` 一致：
   *   { plan: {...}, history: [{ at, text, ok, visibility, ... }] }
   * 只读，不写——日记由聊天服务自己写，卧室只负责把它摆到桌上。
   */
  const chatDataDir = () =>
    options.chatDataDir ||
    process.env.BEDROOM_CHAT_DIR ||
    process.env.AURABOT_DATA_DIR ||
    path.join(dshHome, 'plugins-data', chatServiceName);

  function readChatDiary() {
    const file = path.join(chatDataDir(), 'diary.json');
    const raw = readText(file, 8_000_000);
    if (raw === null) return { file, history: [], ok: false };
    let data = null;
    try {
      data = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch {
      return { file, history: [], ok: false };
    }
    const history = Array.isArray(data?.history) ? data.history : [];
    return { file, history, ok: true };
  }

  /**
   * 日记列表：**以聊天服务每日写的那篇为准**。
   *
   * 一条 history 就是一次「空间日记」，同一天可能写了好几篇，
   * 这里按天聚合：同一天取**最后一篇**当这天的主日记，其余篇数记进 `count`。
   * 字段对齐原来的 listDiary()，这样网页侧一行都不用改。
   */
  function listDiary() {
    const { history, ok } = readChatDiary();
    if (!ok) return [];

    const byDay = new Map();
    for (const item of history) {
      const at = Number(item?.at);
      const text = String(item?.text ?? '').trim();
      if (!Number.isFinite(at) || !text) continue;
      const day = new Date(at).toLocaleDateString('sv-SE'); // sv-SE = YYYY-MM-DD，本地时区
      const prev = byDay.get(day);
      if (!prev) byDay.set(day, { day, latest: item, at, count: 1 });
      else {
        prev.count += 1;
        if (at > prev.at) {
          prev.at = at;
          prev.latest = item;
        }
      }
    }

    return [...byDay.values()]
      .map(({ day, latest, at, count }) => {
        const text = String(latest.text ?? '').trim();
        return {
          date: day,
          file: day + '.md',
          bytes: Buffer.byteLength(text),
          mtime: at,
          preview: text.replace(/\s+/g, ' ').trim().slice(0, 160),
          // Aurabot 的日记是整段散文，没有「心情」小节；这里留空，不编造
          mood: '',
          count,
          source: 'chat',
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  /** 读某一天的日记全文（把当天几篇按时间顺序拼起来，并标出时间） */
  function readDiaryDay(day) {
    const { history } = readChatDiary();
    const hits = history
      .map((item) => ({ item, at: Number(item?.at) }))
      .filter(({ at }) => Number.isFinite(at) && new Date(at).toLocaleDateString('sv-SE') === day)
      .sort((a, b) => a.at - b.at);
    if (!hits.length) return null;
    if (hits.length === 1) return String(hits[0].item.text ?? '').trim();
    return hits
      .map(({ item, at }) => {
        const t = new Date(at).toTimeString().slice(0, 5);
        return `## ${t}\n\n${String(item.text ?? '').trim()}`;
      })
      .join('\n\n');
  }

  // ==========================================================================
  // 手机里的 QQ：把聊天服务记下的**真实聊天流水**映射到手机屏幕上
  // ==========================================================================
  /**
   * 聊天服务每收到/发出一条 QQ 消息，就把它追加到
   * `<chatDataDir>/chatlog/YYYY-MM-DD.jsonl`（默认适配 Aurabot 的 hub.js logChat）。
   * 每行是 `{ t, chatId, who, uid?, text }`：
   *   · who = 'bot' 表示她自己发的，其余是对方的昵称
   *   · chatId 形如 `private:QQ号` / `group:群号`
   * 这里只读这些文件，不碰 QQ 客户端本身。
   */
  const chatlogDir = () => path.join(chatDataDir(), 'chatlog');

  /** 最近 N 天的聊天流水（按时间升序） */
  function readChatlog(days = 3) {
    const dir = chatlogDir();
    let names = [];
    try {
      names = fs
        .readdirSync(dir)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
        .sort()
        .slice(-Math.max(1, days));
    } catch {
      names = [];
    }
    const out = [];
    for (const name of names) {
      const raw = readText(path.join(dir, name), 4_000_000);
      if (raw === null) continue;
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          const t = Number(item?.t);
          if (!Number.isFinite(t)) continue;
          out.push({
            t,
            chatId: String(item.chatId ?? ''),
            who: String(item.who ?? ''),
            uid: String(item.uid ?? ''),
            text: String(item.text ?? ''),
          });
        } catch {
          /* 单行坏了就跳过，不因为一行毁掉整屏 */
        }
      }
    }
    // QQ 直连（SnowLuma 的 HTTP 上报）也落了自己的流水，这里并进来：
    // 两套通道同时开着时，同一条消息可能两边都有，按 (会话 + 时间 + 正文) 去重。
    const seen = new Set();
    const merged = [];
    for (const m of [...out, ...readQqLog(days)]) {
      const key = m.chatId + '\u0000' + m.t + '\u0000' + m.text;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(m);
    }
    return merged.sort((a, b) => a.t - b.t);
  }

  /**
   * 群名。
   *
   * 来源优先级（都拿不到就退回「群 + 群号」，不编造）：
   *   1. Aurabot 的 `hub.groupNames`——它调 `get_group_info` 查到的群名缓存在这个
   *      内存 Map 里（见它 hub.js 的 groupName()），最权威、最实时；
   *   2. 我们自己落盘的 `groupnames.json`——Aurabot 重启后内存 Map 是空的，
   *      上次查到的名字留在这里，不至于立刻掉回群号；
   *   3. 群号。
   *
   * 注意：**不主动去 QQ 网关查**。卧室没有 OneBot 通道，也不该为了显示一个
   * 群名去拉起一次 QQ 请求；有就用，没有就老实显示群号。
   */
  const groupNameFile = () => path.join(dshHome, 'dsh-pet-bedroom', 'groupnames.json');

  function readGroupNameCache() {
    try {
      const raw = readText(groupNameFile(), 200_000);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch {
      return {};
    }
  }

  /**
   * 群名（同步版）：只查内存 Map 和自己落的盘。
   * 拿不到就返回空串，由调用方回退成「群 + 群号」。
   */
  function lookupGroupName(groupId) {
    const gid = String(groupId || '');
    if (!/^\d{5,15}$/.test(gid)) return '';
    // 1. Aurabot 内存里的实时群名
    try {
      const names = chatSvc()?.hub?.groupNames;
      if (names && typeof names.get === 'function') {
        const hit = names.get(gid) || names.get(Number(gid));
        if (typeof hit === 'string' && hit.trim()) return hit.trim();
      }
    } catch {
      /* Aurabot 没在跑 / 结构变了，走下一档 */
    }
    // 2. 自己落盘的
    const cached = readGroupNameCache()[gid];
    if (typeof cached === 'string' && cached.trim()) return cached.trim();
    return '';
  }

  /**
   * 群名（异步版）：内存里没有就**通过 Aurabot 的 hub 去问 QQ 网关**。
   *
   * 为什么不自己连网关：卧室没有 OneBot 通道，也不该为了显示一个群名
   * 去维护一条 QQ 连接。Aurabot 的 `hub.groupName(gid)` 本来就是干这个的
   * （内部 `get_group_info`，还自带缓存），直接借用最稳。
   * 查到了就落盘，下次同步读就有。
   */
  async function fetchGroupName(groupId) {
    const gid = String(groupId || '');
    if (!/^\d{5,15}$/.test(gid)) return '';
    const quick = lookupGroupName(gid);
    if (quick) return quick;
    try {
      const hub = chatSvc()?.hub;
      if (hub && typeof hub.groupName === 'function') {
        const name = await hub.groupName(gid);
        const val = typeof name === 'string' ? name.trim() : '';
        // 网关查不到时 groupName 会退回群号本身，那种「名字」不要
        if (val && val !== gid) {
          saveGroupName(gid, val);
          return val;
        }
      }
    } catch {
      /* 网关不通就算了 */
    }
    return '';
  }

  /** 单个群名落盘 */
  function saveGroupName(gid, name) {
    try {
      const cache = readGroupNameCache();
      if (cache[gid] === name) return;
      cache[gid] = name;
      const file = groupNameFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
    } catch {
      /* 缓存而已 */
    }
  }

  /** 把会话列表里的群名补全（并发查，查不到的保持原样） */
  async function enrichGroupNames(chats) {
    const groups = chats.filter((c) => c.kind === 'group' && c.id && c.title.startsWith('群 '));
    if (!groups.length) return chats;
    await Promise.all(
      groups.map(async (c) => {
        const name = await fetchGroupName(c.id);
        if (name) c.title = name;
      }),
    );
    return chats;
  }

  /**
   * 把从 Aurabot 那边能看到的群名顺手落一份盘。
   * 只是缓存：写不进去也不影响任何功能。
   */
  function rememberGroupNames() {
    try {
      const names = chatSvc()?.hub?.groupNames;
      if (!names || typeof names.forEach !== 'function') return;
      const cache = readGroupNameCache();
      let dirty = false;
      names.forEach((name, gid) => {
        const key = String(gid);
        const val = String(name ?? '').trim();
        if (!/^\d{5,15}$/.test(key) || !val) return;
        if (cache[key] !== val) {
          cache[key] = val;
          dirty = true;
        }
      });
      if (!dirty) return;
      const file = groupNameFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
    } catch {
      /* 缓存而已，失败就算了 */
    }
  }

  /**
   * 汇总成「会话列表」：每个 chatId 一个会话，带最后一条消息、条数、未读数。
   * 手机 QQ 首页就显示这个。
   */
  function listChats() {
    const all = readChatlog(3);
    const byChat = new Map();
    for (const m of all) {
      if (!m.chatId) continue;
      const prev = byChat.get(m.chatId);
      if (!prev) {
        byChat.set(m.chatId, {
          chatId: m.chatId,
          title: m.who === 'bot' ? '' : m.who,   // 对方昵称；一直是 bot 说明没收到过对方的话
          lastText: m.text,
          lastAt: m.t,
          count: 1,
          unread: 0,
          uid: m.who === 'bot' ? '' : m.uid,
          messages: [m],
        });
      } else {
        prev.count += 1;
        prev.messages.push(m);
        if (m.t >= prev.lastAt) {
          prev.lastAt = m.t;
          prev.lastText = m.text;
          if (m.who !== 'bot') prev.title = m.who;
        }
        // 头像用**对方**的 QQ 号：只在收到对方消息时更新，别被 bot 那几条覆盖
        if (m.who !== 'bot' && m.uid) prev.uid = m.uid;
      }
    }
    return [...byChat.values()]
      .map((c) => {
        const [kind, id] = c.chatId.split(':');
        const isGroup = kind === 'group';
        // 未读：对方最后一句之后她自己还没回过（也覆盖「进来还没被看过」）
        const last = c.messages[c.messages.length - 1];
        const unread = last && last.who !== 'bot' ? 1 : 0;
        // 群聊：标题必须是**群名**（拿不到退回群号），头像用**群头像**；
        // 私聊：标题是对方昵称，头像用对方 QQ 头像。
        // 之前群聊误用了「最后发言的人」，于是群名显示成某个人的昵称、
        // 头像也变成那一个人的脸——用户明确要求改掉。
        const groupName = isGroup ? lookupGroupName(id) : '';
        return {
          chatId: c.chatId,
          kind: isGroup ? 'group' : 'private',
          id: id ?? '',
          uid: isGroup ? '' : (c.uid || ''),
          // 真实头像走本地代理（见 /avatar/... 与 /groupavatar/...）
          avatar: isGroup
            ? (id ? GROUP_AVATAR_PREFIX + id : '')
            : (c.uid ? AVATAR_PREFIX + c.uid : ''),
          title: isGroup ? (groupName || ('群 ' + (id || ''))) : (c.title || id || c.chatId),
          lastText: c.lastText,
          lastAt: c.lastAt,
          count: c.count,
          unread,
        };
      })
      .sort((a, b) => b.lastAt - a.lastAt);
  }

  /** 某个会话的全部消息（手机点进去看到的聊天界面） */
  function readChat(chatId, limit = 120) {
    const isGroup = chatId.startsWith('group:');
    const all = readChatlog(7).filter((m) => m.chatId === chatId);
    return all.slice(-limit).map((m) => ({
      at: m.t,
      from: m.who === 'bot' ? 'me' : 'them',
      who: m.who === 'bot' ? '我' : m.who,
      uid: m.uid || '',
      // 群聊里说话的是**不同的人**，每条都按发言人的 QQ 号取头像；
      // 私聊就只有那一个人。bot 自己的用空串（前端不摆头像）。
      avatar: m.who !== 'bot' && m.uid ? AVATAR_PREFIX + m.uid : '',
      // 群聊要标出是谁说的（多人混在一起，不标就分不清）
      showName: isGroup && m.who !== 'bot',
      text: m.text,
    }));
  }

  /** 读书笔记：目录里任意 .md */
  function listNotes() {
    const root = notesRoot();
    let names = [];
    try {
      names = fs.readdirSync(root).filter((f) => f.toLowerCase().endsWith('.md'));
    } catch {
      return [];
    }
    return names
      .map((file) => {
        const full = readText(path.join(root, file)) ?? '';
        return {
          name: file,
          title: file.replace(/\.md$/i, ''),
          preview: previewOf(full),
          bytes: Buffer.byteLength(full),
          mtime: (() => {
            try {
              return fs.statSync(path.join(root, file)).mtimeMs;
            } catch {
              return 0;
            }
          })(),
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  // ==========================================================================
  // 卧室运行态
  // ==========================================================================
  const roomState = {
    phone: { items: [], lastReadAt: 0, screen: 'off' },
    command: null,
    say: null,
    douyin: { fetchedAt: 0, ok: false, running: false, status: '', reason: '', watched: 0, today: null, history: [] },
    douyinBusy: false,
    seq: 0,
  };

  const webServer = ctx.webServer;
  const origin = typeof webServer?.getOrigin === 'function' ? webServer.getOrigin() : 'http://127.0.0.1:0';
  const now = () => Date.now();

  function writeJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  function writeText(res, status, text, type = 'text/plain; charset=utf-8') {
    res.writeHead(status, {
      'content-type': type,
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(text),
    });
    res.end(text);
  }

  async function readJsonBody(req, limit = 64 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw Object.assign(new Error('请求体过大'), { status: 413 });
      chunks.push(chunk);
    }
    if (chunks.length === 0) return {};
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text.trim()) return {};
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw Object.assign(new Error('请求体必须是 JSON 对象'), { status: 400 });
    }
    return value;
  }

  async function fetchJson(url, init = {}, timeoutMs = 4000) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 400) };
    }
    return { status: response.status, ok: response.ok, body };
  }

  // ==========================================================================
  // dsh-pet 素材：只为挑「哪只宠物 + 它会哪些动画」
  // ==========================================================================
  async function readPetEntry() {
    try {
      const { ok, body } = await fetchJson(origin + PET_ROUTE + '/config');
      if (!ok || !body || typeof body !== 'object') return null;
      const entries = Object.entries(body).filter(([, value]) => value && typeof value === 'object');
      if (entries.length === 0) return null;
      let picked = entries[0];
      if (options.petId) {
        const found = entries.find(
          ([, value]) => Array.isArray(value.pets) && value.pets.some((pet) => String(pet?.id ?? '') === options.petId),
        );
        if (found) picked = found;
      }
      const [entryKey, entryValue] = picked;
      const pets = Array.isArray(entryValue.pets) ? entryValue.pets : [];
      const pet = pets.find((item) => String(item?.id ?? '') === options.petId) ?? pets[0] ?? null;
      const animations = entryValue.animations && typeof entryValue.animations === 'object' ? entryValue.animations : {};
      const pool = new Set();
      const push = (value) => {
        if (typeof value === 'string' && value.trim()) pool.add(value);
      };
      for (const key of ['idle', 'turn', 'drag', 'clicks']) {
        const list = animations[key];
        if (Array.isArray(list)) list.forEach(push);
      }
      const moves = animations.moves;
      if (moves && Array.isArray(moves.actions)) for (const item of moves.actions) push(item?.name);
      if (Array.isArray(animations.categories)) {
        for (const category of animations.categories) {
          if (Array.isArray(category?.actions)) category.actions.forEach(push);
        }
      }
      if (animations.events && typeof animations.events === 'object') {
        for (const list of Object.values(animations.events)) {
          if (Array.isArray(list)) list.forEach(push);
          else push(list);
        }
      }
      return {
        entry: entryKey,
        assetRoot: entryKey,
        pet: pet ? { id: String(pet.id ?? ''), name: String(pet.name ?? pet.id ?? ''), size: Number(pet.size) || 462 } : null,
        idle: Array.isArray(animations.idle) && animations.idle.length ? animations.idle : ['待机呼吸休闲'],
        animations: [...pool],
      };
    } catch {
      return null;
    }
  }

  // ==========================================================================
  // 聊天服务（手机 QQ 界面用；刷抖音**不用**它，见下面）
  // ==========================================================================
  /**
   * 聊天服务通过 `ctx.provide(<服务名>, service)` 对外暴露自己（出厂 `aurabot`），
   * 这里用 `ctx.get(chatServiceName)` 拿。**不写进 inject**：那样没装聊天服务
   * 卧室就起不来了；用的时候再取，取不到就照实说「没接上」。
   */
  const chatSvc = () => {
    try {
      return ctx.get(chatServiceName) ?? null;
    } catch {
      return null;
    }
  };

  // ==========================================================================
  // 抖音：走**你自己的抖音后端**（出厂指向聊天服务的「现在刷一轮」模块）
  //   地址：POST <douyinApiBase>/douyin/run   状态：GET <douyinApiBase>/douyin/state
  //   注意后端是**后台开始刷、马上返回**（一轮好几分钟），
  //   所以这里只报「开刷了」，刷完的结果由后端自己落进它的 history。
  // ==========================================================================
  const douyinBase = () => {
    const base = String(douyinApiBase()).replace(/\/+$/, '');
    // 允许填完整地址（自己的服务可能在另一个端口），也允许只填路径（跟随宿主）
    return /^https?:\/\//i.test(base) ? base : origin + base;
  };
  const DOUYIN_RUN_TIMEOUT_MS = 20000;

  /** 抖音后端没装 / 没启动时的统一说法 */
  function douyinOffline(reason) {
    return {
      fetchedAt: now(),
      ok: false,
      running: false,
      status: 'offline',
      reason,
    };
  }

  /**
   * 读一次抖音后端的真实状态并写进缓存。
   * 只读它的 state（约定它只读文件、不碰浏览器），不会为了显示状态去开浏览器。
   */
  async function refreshDouyin(force = false) {
    if (!options.douyinEnabled) {
      roomState.douyin = {
        ...roomState.douyin,
        fetchedAt: now(),
        ok: false,
        running: false,
        status: 'disabled',
        reason: '卧室里关掉了抖音联动',
      };
      return roomState.douyin;
    }
    if (!force && now() - roomState.douyin.fetchedAt < DOUYIN_CACHE_MS) return roomState.douyin;
    try {
      const { ok, status, body } = await fetchJson(douyinBase() + '/douyin/state', {}, 4000);
      if (!ok || !body || body.ok === false) {
        roomState.douyin = douyinOffline(
          status === 404 ? CHAT_LABEL + ' 没接上，或者刷抖音模块没开' : CHAT_LABEL + ' 抖音模块没有响应',
        );
        return roomState.douyin;
      }
      roomState.douyin = {
        fetchedAt: now(),
        ok: true,
        // busy = 正在刷（后端的 browse() 是后台跑，这个字段就是它有没有在忙）
        running: Boolean(body.busy),
        status: body.busy ? 'running' : body.pauseReason ? 'paused' : 'idle',
        reason: String(body.pauseReason || body.lastSkipReason || ''),
        watched: Number(body.watched ?? 0) || 0,
        // 今天看了多少个 / 上限多少个（它自己算的，卧室照搬）
        today: body.watched ?? null,
        history: Array.isArray(body.history) ? body.history.slice(0, 6) : [],
        lastRun: body.lastRun ?? null,
      };
      return roomState.douyin;
    } catch (error) {
      roomState.douyin = douyinOffline(error instanceof Error ? error.message : String(error));
      return roomState.douyin;
    }
  }

  /**
   * 真的触发「现在刷一轮」——就是你抖音后端上的那个动作接口。
   * 它拒绝（正在刷 / 抖音没打开 / 今天上限了）就把原文理由带回去，绝不假装成功。
   */
  async function startDouyin() {
    if (!options.douyinEnabled) return { ok: false, step: 'disabled', reason: '卧室里关掉了抖音联动' };
    try {
      const { ok, status, body } = await fetchJson(
        douyinBase() + '/douyin/run',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        DOUYIN_RUN_TIMEOUT_MS,
      );
      // 约定：ok:false 时装在 message 里（不是 error）
      const said = String(body?.message ?? body?.error ?? '');
      if (!ok || body?.ok === false) {
        const reason =
          status === 404 ? CHAT_LABEL + ' 没接上，或者刷抖音模块没开' : said || `${CHAT_LABEL} 返回 HTTP ${status}`;
        await refreshDouyin(true);
        return { ok: false, step: 'douyin/run', reason };
      }
      await refreshDouyin(true);
      return { ok: true, step: 'douyin/run', message: said || '开刷了' };
    } catch (error) {
      return { ok: false, step: 'douyin/run', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 「别刷了」。抖音后端约定**没有**停下来的接口
   * （一轮是它自己的循环，停不了），所以这里不假装按停。
   * 返回 ok:false + 说明，让页面如实显示——不编一个「已停止」。
   */
  async function stopDouyin() {
    const s = roomState.douyin;
    if (!s.running) return { ok: true, note: '没在刷' };
    return {
      ok: false,
      note: '这一轮是 ' + CHAT_LABEL + '自己在跑，卧室停不了它；它刷完会自己停。',
    };
  }

  // ==========================================================================
  // 命令分发：面板按钮、手机输入、QQ 消息走**同一条**函数
  // ==========================================================================
  async function runCommand(action, text, source) {
    roomState.seq += 1;
    roomState.command = { id: roomState.seq, action, text: String(text ?? ''), at: now(), source };
    roomState.say = { text: ACTION_REPLY[action] ?? '嗯？', at: now() };

    if (action === 'douyin') {
      if (roomState.douyinBusy) return { ok: false, reason: '正在处理上一次请求' };
      roomState.douyinBusy = true;
      try {
        const result = await startDouyin();
        // 用后端自己那句话（它知道这一轮看几个、大概几分钟），别自己编
        roomState.say = result.ok
          ? { text: '开刷了，这一轮要好几分钟', at: now() }
          : { text: '刷不了：' + String(result.reason ?? '').slice(0, 60), at: now() };
        return result;
      } finally {
        roomState.douyinBusy = false;
      }
    }
    if (action === 'douyin-stop') {
      const r = await stopDouyin();
      // 停不了就照实说，不假装按停了（抖音后端没有停止接口）
      roomState.say = r.ok
        ? { text: '本来就没在刷', at: now() }
        : { text: '这一轮停不了，等它刷完', at: now() };
      return r;
    }
    return { ok: true };
  }

  // ==========================================================================
  // 手机：从 session/event 里认 QQ 消息
  // ==========================================================================
  function pushPhoneMessage({ text, action, sessionId, channel }) {
    const item = {
      id: ++roomState.seq,
      text,
      action,
      at: now(),
      sessionId: String(sessionId ?? ''),
      channel,
      read: false,
    };
    roomState.phone.items.unshift(item);
    if (roomState.phone.items.length > PHONE_KEEP) roomState.phone.items.length = PHONE_KEEP;
    // QQ 消息一律先「亮屏 + 未读」；宠物去拿手机才算读了（服务端只记事实，动作在客户端）
    roomState.phone.screen = 'on';
    return item;
  }

  /**
   * 「主人私聊」的统一入口：聊天服务的 activity 事件、以及 QQ 直连的 HTTP 上报，
   * 都从这里进卧室。只认 kind=in + owner=true + direct=true；群聊、别人的私聊一律不进。
   * 返回 false 表示这条被过滤掉了（调用方可以据此如实回话）。
   */
  function handleQqActivity(a) {
    if (!a || a.kind !== 'in') return false;          // 只收「收到」，不收她发出去的
    if (a.owner !== true) return false;               // 只认主人本人
    if (a.direct !== true) return false;              // 只认私聊，群聊不要
    const body = String(a.text ?? '').trim();
    if (!body) return false;
    const action = parseCommand(body);
    const chatId = String(a.chatId ?? '');
    pushPhoneMessage({ text: body.slice(0, 500), action, sessionId: chatId, channel: 'qq' });
    if (action) void runCommand(action, body, 'qq').catch(() => {});
    return true;
  }

  /** 从 OneBot 消息体里取纯文本：优先 message 段里的 text，退回 raw_message */
  function oneBotText(body) {
    const segments = Array.isArray(body.message) ? body.message : null;
    if (segments) {
      const text = segments
        .filter((seg) => seg && seg.type === 'text')
        .map((seg) => String(seg.data?.text ?? ''))
        .join('')
        .trim();
      if (text) return text;
    }
    return String(body.raw_message ?? '').trim();
  }

  /**
   * OneBot 11 的 HTTP 上报入口（SnowLuma 面板里的「HTTP 上报」填这里）。
   *
   * 只处理 post_type=message；心跳/通知一律 ack。校验令牌（配了才校验）、
   * 按 message_id 去重（Aurabot 与直连同时开时同一条会到两次）。
   * 不是「主人的私聊」就只回一个 accepted:false + 原因，不进卧室、不落盘。
   */
  async function handleOneBotReport(req, res, url) {
    const qq = readQq();
    if (qq.token) {
      const auth = String(req.headers?.authorization ?? '');
      const got = /^bearer\s+/i.test(auth)
        ? auth.replace(/^bearer\s+/i, '').trim()
        : String(url?.searchParams?.get('access_token') ?? '');
      if (got !== qq.token) {
        qqRuntime.events.rejected += 1;
        return writeJson(res, 401, { ok: false, error: '上报令牌和窗口里填的不一致' });
      }
    }

    const body = await readJsonBody(req, 512 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return writeJson(res, 400, { ok: false, error: '上报体不是 JSON' });
    }
    if (body.post_type !== 'message') return writeJson(res, 200, { ok: true, ignored: true });

    const messageId = String(body.message_id ?? '');
    if (messageId) {
      const prev = qqRuntime.seen.get(messageId);
      if (prev && Date.now() - prev < 60_000) {
        return writeJson(res, 200, { ok: true, duplicate: true });
      }
      qqRuntime.seen.set(messageId, Date.now());
      if (qqRuntime.seen.size > 600) {
        for (const [key, at] of qqRuntime.seen) {
          if (Date.now() - at > 120_000) qqRuntime.seen.delete(key);
        }
      }
    }

    const uid = String(body.sender?.user_id ?? body.user_id ?? '');
    const direct = body.message_type === 'private';
    const text = oneBotText(body);

    if (!qq.selfId) {
      qqRuntime.events.rejected += 1;
      return writeJson(res, 200, { ok: true, accepted: false, reason: '窗口里还没填「主人 QQ」' });
    }
    if (uid !== qq.selfId) {
      qqRuntime.events.rejected += 1;
      return writeJson(res, 200, { ok: true, accepted: false, reason: '不是主人本人，不进卧室' });
    }
    if (!direct) {
      qqRuntime.events.rejected += 1;
      return writeJson(res, 200, { ok: true, accepted: false, reason: '群聊不进卧室（只收私聊）' });
    }
    if (!text) {
      qqRuntime.events.rejected += 1;
      return writeJson(res, 200, { ok: true, accepted: false, reason: '这条没有文字（图片/表情不进卧室）' });
    }

    const chatId = 'private:' + uid;
    appendQqLog({
      t: Number(body.time ? Number(body.time) * 1000 : Date.now()),
      chatId,
      who: String(body.sender?.card || body.sender?.nickname || uid).slice(0, 60),
      uid,
      text: text.slice(0, 500),
    });
    const accepted = handleQqActivity({ kind: 'in', owner: true, direct: true, text, chatId });
    qqRuntime.events.total += 1;
    qqRuntime.events.lastAt = now();
    qqRuntime.events.lastText = text.slice(0, 60);
    return writeJson(res, 200, { ok: true, accepted });
  }

  ctx.effect(() => {
    /**
     * QQ 消息从 **聊天服务的 activity 事件**来（出厂适配 Aurabot，经 SnowLuma / OneBot 接的 QQ），
     * 不再靠 dsh-bridge 往提示词里塞标记。
     *
     * 只认「主人本人的私聊」：事件里直接给了 `owner` 和 `direct`
     * 两个布尔标记（见 Aurabot hub.js 的 onActivity），比自己解析文本可靠得多。
     * 群聊、别人的私聊一律不进卧室。
     */
    const onActivity = handleQqActivity;

    let off = null;
    const attach = () => {
      const service = chatSvc();
      if (!service || typeof service.on !== 'function') return false;
      try {
        off = service.on('activity', onActivity);
        return typeof off === 'function';
      } catch {
        return false;
      }
    };

    // 聊天服务可能比卧室晚加载：先试一次，没接上就每 3 秒重试，挂上就停。
    // （直接轮询 ctx.get 也行，但那样在没有聊天服务的环境里会一直空转。）
    if (!attach()) {
      const timer = setInterval(() => {
        if (attach()) clearInterval(timer);
      }, 3000);
      if (typeof timer.unref === 'function') timer.unref();
      return () => {
        clearInterval(timer);
        try {
          off?.();
        } catch {
          /* 已经断了就算了 */
        }
      };
    }
    return () => {
      try {
        off?.();
      } catch {
        /* 已经断了就算了 */
      }
    };
  }, 'dsh-pet-bedroom: phone inbox from chat service');

  // ==========================================================================
  // 给 agent 的真实感知与书写（工具）
  // ==========================================================================
  function roomSnapshot() {
    const diary = listDiary();
    const notes = listNotes();
    const unread = roomState.phone.items.filter((item) => !item.read).length;
    return {
      at: new Date().toISOString(),
      time: currentTime(),
      timeAuto: room.autoTime,
      weather: room.weather,
      wallpaper: {
        now: room.wallpaper,
        current: WALLPAPERS.find((w) => w.id === room.wallpaper) ?? null,
        options: WALLPAPERS,
      },
      desk: {
        latestDiary: diary[0] ? { date: diary[0].date, preview: diary[0].preview, mood: diary[0].mood } : null,
        diaryCount: diary.length,
        noteCount: notes.length,
        notes: notes.slice(0, 6).map((item) => ({ name: item.name, title: item.title, preview: item.preview })),
      },
      furniture: room.slots.map((slot) => ({ id: slot.id, label: slot.label, kind: slot.kind, detail: slot.detail })),
      phone: {
        unread,
        screen: roomState.phone.screen,
        latest: roomState.phone.items[0]
          ? { text: roomState.phone.items[0].text, action: roomState.phone.items[0].action }
          : null,
      },
      // 抖音状态原样来自 Aurabot「刷抖音」模块（卧室不自己算时段/额度）
      douyin: {
        ok: Boolean(roomState.douyin.ok),
        running: Boolean(roomState.douyin.running),
        status: roomState.douyin.status,
        reason: roomState.douyin.reason,
        watched: roomState.douyin.watched ?? 0,
        history: roomState.douyin.history ?? [],
      },
    };
  }

  function writeNote(title, content, mode) {
    const root = notesRoot();
    fs.mkdirSync(root, { recursive: true });
    const safeTitle = String(title).replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || '读书笔记';
    const file = safeJoin(root, safeTitle + '.md');
    if (!file) return { ok: false, error: '标题不合法' };
    const existing = readText(file);
    let next;
    if (existing === null) next = '# ' + safeTitle + '\n\n' + content.trim() + '\n';
    else if (mode === 'replace') next = content.trim() + '\n';
    else next = existing.replace(/\s*$/, '\n\n') + content.trim() + '\n';
    fs.writeFileSync(file, next, 'utf8');
    return { ok: true, file, bytes: Buffer.byteLength(next) };
  }

  function registerTools() {
    let tools;
    try {
      tools = ctx.get ? ctx.get('tools') : ctx.tools;
    } catch {
      tools = undefined;
    }
    if (!tools || typeof tools.register !== 'function') {
      ctx.logger?.warn?.('[dsh-pet-bedroom] 没拿到 tools 服务：卧室的 agent 感知工具未注册');
      return;
    }

    const asJson = (value) => ({
      schema: { type: 'object', additionalProperties: true },
      render: () => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    });

    const disposers = [];

    disposers.push(
      tools.register({
        name: 'bedroom_status',
        description:
          '看一眼自己卧室现在的样子：现在是什么时辰、外面什么天气、桌上放着哪篇日记和读书笔记、手机有没有未读消息、抖音是不是开着。这是你对自己房间的真实感知。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: asJson({}),
        async execute() {
          return roomSnapshot();
        },
      }),
    );

    disposers.push(
      tools.register({
        name: 'bedroom_read',
        description:
          '读自己卧室桌子上的文档：日记（diary）或读书笔记（notes），也可以只列出清单（list）。不传名字就读最近的那篇。',
        parameters: {
          type: 'object',
          properties: {
            what: { type: 'string', enum: ['diary', 'notes', 'list'] },
            name: { type: 'string', description: '日记用 YYYY-MM-DD；笔记用标题。留空取最近一篇。' },
          },
          required: ['what'],
          additionalProperties: false,
        },
        output: asJson({}),
        async execute(args) {
          const what = String(args?.what ?? 'list');
          if (what === 'list') return { ok: true, diary: listDiary(), notes: listNotes() };
          if (what === 'diary') {
            const all = listDiary();
            const date = String(args?.name ?? '').trim() || all[0]?.date;
            if (!date) return { ok: false, error: '还没有任何日记' };
            // 日记是 Aurabot 写的，卧室只读
            const text = readDiaryDay(date);
            return text === null
              ? { ok: false, error: '没有 ' + date + ' 的日记' }
              : { ok: true, date, content: text, source: 'chat' };
          }
          const notes = listNotes();
          const name = String(args?.name ?? '').trim();
          const hit = name ? notes.find((item) => item.name === name || item.title === name) : notes[0];
          if (!hit) return { ok: false, error: name ? '没有这篇笔记：' + name : '还没有任何读书笔记' };
          const file = safeJoin(notesRoot(), hit.name);
          const text = file ? readText(file) : null;
          return text === null ? { ok: false, error: '读不到这篇笔记' } : { ok: true, name: hit.name, content: text };
        },
      }),
    );

    disposers.push(
      tools.register({
        name: 'bedroom_write',
        description:
          '在自己的卧室桌上写一篇读书笔记（notes）。append 追加到末尾，replace 整篇替换。写完卧室里立刻能看到。' +
          '（日记不能代写：那是聊天服务每天自己写的，卧室只负责摆到桌上。）',
        parameters: {
          type: 'object',
          properties: {
            what: { type: 'string', enum: ['notes'] },
            name: { type: 'string', description: '笔记标题。留空 = 读书笔记。' },
            content: { type: 'string' },
            mode: { type: 'string', enum: ['append', 'replace'] },
          },
          required: ['what', 'content'],
          additionalProperties: false,
        },
        output: asJson({}),
        async execute(args) {
          if (!options.allowAgentWrite) return { ok: false, error: '当前配置不允许 agent 写文件' };
          const what = String(args?.what ?? '');
          const content = String(args?.content ?? '');
          const mode = args?.mode === 'replace' ? 'replace' : 'append';
          if (!content.trim()) return { ok: false, error: '内容不能为空' };
          if (what === 'diary') {
            // 日记现在由聊天服务每天自己写（diary.json），卧室只是**只读**展示。
            // 写进记忆库的 .md 没人会看，等于骗自己「写了」，所以直接拒绝。
            return {
              ok: false,
              error: '日记由聊天服务（默认 Aurabot）每天自己写，卧室只负责摆到桌上，不能代写。要写读书笔记用 what=notes。',
            };
          }
          if (what === 'notes') return writeNote(String(args?.name ?? '').trim() || '读书笔记', content, mode);
          return { ok: false, error: 'what 只能是 diary 或 notes' };
        },
      }),
    );

    disposers.push(
      tools.register({
        name: 'bedroom_atmosphere',
        description:
          '调自己的房间：换天气（晴天/雨天/雪天）、换时辰（清晨/中午/下午/晚间），或者让窗外环境跟着真实时间自己慢慢走。',
        parameters: {
          type: 'object',
          properties: {
            weather: { type: 'string', enum: ['sunny', 'rain', 'snow'] },
            time: { type: 'string', enum: ['dawn', 'noon', 'afternoon', 'night'] },
            autoTime: { type: 'boolean' },
          },
          additionalProperties: false,
        },
        output: asJson({}),
        async execute(args) {
          if (args?.weather && WEATHERS.includes(args.weather)) room.weather = args.weather;
          if (args?.time && TIMES.includes(args.time)) {
            room.time = args.time;
            room.autoTime = false; // 手选了时辰就停掉自动，否则立刻被真实时间覆盖
          }
          if (typeof args?.autoTime === 'boolean') room.autoTime = args.autoTime;
          const saved = writeRoom();
          return { ok: saved, time: currentTime(), weather: room.weather, autoTime: room.autoTime };
        },
      }),
    );

    disposers.push(
      tools.register({
        name: 'bedroom_furniture',
        description:
          '往自己卧室的插槽里加一件家具，或者撤掉一件。加进去的东西会真的出现在房间里，鼠标移上去能看到你写的介绍。',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['add', 'remove', 'list'] },
            label: { type: 'string' },
            detail: { type: 'string' },
            kind: { type: 'string', enum: ['box', 'plant', 'lamp', 'shelf', 'toy'] },
            x: { type: 'number' },
            y: { type: 'number' },
            w: { type: 'number' },
            d: { type: 'number' },
            h: { type: 'number' },
            id: { type: 'string' },
          },
          required: ['action'],
          additionalProperties: false,
        },
        output: asJson({}),
        async execute(args) {
          const action = String(args?.action ?? 'list');
          if (action === 'list') return { ok: true, furniture: room.slots };
          if (action === 'remove') {
            const id = String(args?.id ?? '');
            const before = room.slots.length;
            room.slots = room.slots.filter((slot) => slot.id !== id);
            writeRoom();
            return { ok: room.slots.length < before, furniture: room.slots.map((s) => s.id) };
          }
          const slot = sanitizeSlot({
            id: 'slot-' + Date.now().toString(36),
            kind: args?.kind,
            label: String(args?.label ?? '').trim() || '新家具',
            detail: args?.detail,
            x: args?.x,
            y: args?.y,
            w: args?.w,
            d: args?.d,
            h: args?.h,
          });
          if (!slot) return { ok: false, error: '参数不合法' };
          room.slots.push(slot);
          writeRoom();
          return { ok: true, id: slot.id, furniture: room.slots.map((s) => ({ id: s.id, label: s.label })) };
        },
      }),
    );

    // 换手机壁纸：这是**自己的手机**，壁纸自己挑、自己换。
    disposers.push(
      tools.register({
        name: 'bedroom_wallpaper',
        description:
          '换自己手机的壁纸。不传 id 就列出可选的几张（每张都带实测色调和说明）；传 id 就换上并落盘，刷新后还在。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '壁纸 id；留空只列清单不换。' },
          },
          additionalProperties: false,
        },
        output: asJson({}),
        async execute(args) {
          const id = String(args?.id ?? '').trim();
          if (!id) {
            return {
              ok: true,
              now: room.wallpaper,
              options: WALLPAPERS,
            };
          }
          if (!WALL_IDS.includes(id)) {
            return { ok: false, error: '没有这张壁纸：' + id, options: WALL_IDS };
          }
          room.wallpaper = id;
          const saved = writeRoom();
          return {
            ok: saved,
            now: room.wallpaper,
            label: WALLPAPERS.find((w) => w.id === id)?.label ?? id,
          };
        },
      }),
    );

    ctx.effect(() => () => disposers.forEach((dispose) => dispose?.()), 'dsh-pet-bedroom: agent tools');
  }

  registerTools();

  // ==========================================================================
  // 卧室自己的 HTTP 面
  // ==========================================================================
  const route = {
    kind: 'prefix',
    path: ROOM_PREFIX,
    async handler(req, res) {
      // 只接受本机来源：卧室页面就在本机打开，没有跨机调用的理由
      const host = req.headers.host;
      if (!host || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) {
        return writeJson(res, 403, { ok: false, error: '卧室只接受本机请求' });
      }
      const url = new URL(req.url, 'http://' + host);
      const p = url.pathname.slice(ROOM_PREFIX.length) || '/';

      try {
        // ---------------------------------------------------------------
        // 静态资源：卧室是一个**独立网页**，不在 DSH 应用里渲染。
        //   /            → web/index.html
        //   /room.png    → 参考图（房间本体）
        // 只放行这两个确切路径，不做目录遍历。
        // ---------------------------------------------------------------
        if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
          const html = readText(path.join(WEB_DIR, 'index.html'), 2_000_000);
          if (html === null) return writeText(res, 500, '卧室页面缺失：web/index.html');
          return writeText(res, 200, html, 'text/html; charset=utf-8');
        }
        if (req.method === 'GET' && (p === '/room.png' || p === '/chair.png')) {
          const file = p === '/room.png' ? 'room.png' : 'chair.png';
          try {
            const bytes = fs.readFileSync(path.join(ASSET_DIR, file));
            res.writeHead(200, {
              'content-type': 'image/png',
              'cache-control': 'public, max-age=3600',
              'content-length': bytes.length,
            });
            return res.end(bytes);
          } catch {
            return writeText(res, 404, '房间图缺失：assets/' + file);
          }
        }

        // 手机壁纸：/wallpaper/<id>.jpg。只放行白名单里的四个 id，
        // 不接受任意文件名（和房间图一样，不给目录穿越留口子）。
        if (req.method === 'GET' && p.startsWith('/wallpaper/')) {
          const id = p.slice('/wallpaper/'.length).replace(/\.jpg$/i, '');
          const wall = WALLPAPERS.find((w) => w.id === id);
          if (!wall) return writeText(res, 404, '没有这张壁纸');
          try {
            const bytes = fs.readFileSync(path.join(ASSET_DIR, 'wall', wall.file));
            res.writeHead(200, {
              'content-type': 'image/jpeg',
              'cache-control': 'public, max-age=86400',
              'content-length': bytes.length,
            });
            return res.end(bytes);
          } catch {
            return writeText(res, 404, '壁纸图缺失：assets/wall/' + wall.file);
          }
        }

        // 头像代理：手机里的聊天要显示**真实**头像。
        //   /avatar/<QQ号>     → https://q1.qlogo.cn/g?b=qq&nk=<QQ号>&s=640   个人头像
        //   /groupavatar/<群号> → https://p.qlogo.cn/gh/<群号>/<群号>/640     群头像
        // 替网页转一步：一是避免浏览器直连外域被 CORS/离线卡住，
        // 二是能把图缓存在内存里，免得每次刷新都去 qlogo 拉一遍。
        // 只放行纯数字号，别的一律拒绝（不给任意 URL 代理留口子）。
        const isUserAv = p.startsWith('/avatar/');
        const isGroupAv = p.startsWith('/groupavatar/');
        if (req.method === 'GET' && (isUserAv || isGroupAv)) {
          const prefix = isUserAv ? '/avatar/' : '/groupavatar/';
          const raw = p.slice(prefix.length).replace(/\.(?:jpg|png|webp)$/i, '');
          const num = decodeURIComponent(raw);
          if (!/^\d{5,15}$/.test(num)) {
            return writeText(res, 400, isUserAv ? 'QQ 号不合法' : '群号不合法');
          }
          const cacheKey = (isUserAv ? 'u:' : 'g:') + num;
          const hit = avatarCache.get(cacheKey);
          if (hit && now() - hit.at < AVATAR_TTL_MS) {
            res.writeHead(200, {
              'content-type': hit.type,
              'cache-control': 'public, max-age=86400',
              'content-length': hit.bytes.length,
            });
            return res.end(hit.bytes);
          }
          const upstreamUrl = isUserAv
            ? 'https://q1.qlogo.cn/g?b=qq&nk=' + num + '&s=640'
            : 'https://p.qlogo.cn/gh/' + num + '/' + num + '/640';
          try {
            const upstream = await fetch(upstreamUrl, { signal: AbortSignal.timeout(8000) });
            if (!upstream.ok) return writeText(res, 502, '头像接口返回 ' + upstream.status);
            const type = String(upstream.headers.get('content-type') || '');
            if (!type.startsWith('image/')) return writeText(res, 502, '头像接口没返回图片');
            const bytes = Buffer.from(await upstream.arrayBuffer());
            if (!bytes.length || bytes.length > 2_000_000) return writeText(res, 502, '头像大小异常');
            avatarCache.set(cacheKey, { at: now(), type, bytes });
            if (avatarCache.size > 200) {
              // 简单上限：超了就把最旧的一半丢掉，不搞 LRU 那么复杂
              const keys = [...avatarCache.keys()].slice(0, 100);
              for (const k of keys) avatarCache.delete(k);
            }
            res.writeHead(200, {
              'content-type': type,
              'cache-control': 'public, max-age=86400',
              'content-length': bytes.length,
            });
            return res.end(bytes);
          } catch (error) {
            return writeText(res, 502, '取头像失败：' + (error instanceof Error ? error.message : String(error)));
          }
        }

        // 素材代理：卧室网页是**独立页面**，它不能直接请求 dsh-pet 的路由
        // （不是同一条前缀，独立预览时更是另一个端口）。这里替它转发一步。
        //   /pet/thumb/<素材根>/<名>.webm  →  <上游><petRoute>/thumb/<素材根>/<名>.webm
        if (req.method === 'GET' && p.startsWith('/pet/thumb/')) {
          const rest = p.slice('/pet/thumb/'.length);
          // 只允许 <根>/<文件>.webm|.mov 两段，拒绝任何目录穿越
          const m = /^([^/]{1,80})\/([^/]{1,200}\.(?:webm|mov))$/i.exec(rest);
          if (!m) return writeText(res, 400, '素材路径不合法');
          try {
            // 这里拿到的仍是百分号编码（中文动画名），先解码再拼上游 URL。
            // 不解码就会把 `%E5%BE%85...` 当文件名发给 dsh-pet，它当然找不到。
            const root = decodeURIComponent(m[1]);
            const file = decodeURIComponent(m[2]);
            const upstream = await fetch(
              origin + PET_ROUTE + '/thumb/' + encodeURIComponent(root) + '/' + encodeURIComponent(file),
              { signal: AbortSignal.timeout(15000) },
            );
            if (!upstream.ok) {
              return writeText(res, upstream.status === 404 ? 404 : 502, '上游取素材失败：HTTP ' + upstream.status);
            }
            const type = upstream.headers.get('content-type') || 'video/webm';
            const buf = Buffer.from(await upstream.arrayBuffer());
            res.writeHead(200, {
              'content-type': type,
              'cache-control': 'public, max-age=300',
              'content-length': buf.length,
            });
            return res.end(buf);
          } catch (error) {
            return writeText(res, 502, '取素材失败：' + (error instanceof Error ? error.message : String(error)));
          }
        }

        if (req.method === 'GET' && p === '/state') {
          const [pet, douyin] = await Promise.all([readPetEntry(), refreshDouyin()]);
          const diary = listDiary();
          const notes = listNotes();
          // 会话列表：顺手把 Aurabot 内存里的群名落一份盘（它重启后内存就空了），
          // 再把还没名字的群去网关补一下（查不到就保持「群 + 群号」）
          rememberGroupNames();
          const chats = await enrichGroupNames(listChats());
          return writeJson(res, 200, {
            ok: true,
            at: now(),
            pet,
            room: {
              time: currentTime(),
              timeAuto: room.autoTime,
              manualTime: room.time,
              weather: room.weather,
              wallpaper: room.wallpaper,
              wallpaperList: WALLPAPERS,
              slots: room.slots,
              vaultDir,
              notesDir: notesRoot(),
            },
            docs: {
              diary: diary.slice(0, 12),
              latestDiary: diary[0] ?? null,
              notes: notes.slice(0, 12),
            },
            phone: {
              screen: roomState.phone.screen,
              items: roomState.phone.items,
              lastReadAt: roomState.phone.lastReadAt,
              // 手机屏幕上的 QQ：真实会话列表（来自 Aurabot 的聊天流水）
              qq: { chats, source: chatlogDir() },
            },
            command: roomState.command,
            say: roomState.say,
            douyin,
            qq: qqInfo(origin),
            options: { douyinEnabled: options.douyinEnabled, phoneSource: options.phoneSource, petId: options.petId },
          });
        }

        if (req.method === 'GET' && p === '/doc') {
          const kind = url.searchParams.get('kind') === 'notes' ? 'notes' : 'diary';
          const name = url.searchParams.get('name') ?? '';
          if (!name) return writeJson(res, 400, { ok: false, error: '缺少 name' });
          if (kind === 'diary') {
            // 日记现在来自 Aurabot 的 diary.json（按天聚合），不是 .md 文件
            if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) return writeJson(res, 400, { ok: false, error: '日期不合法' });
            const content = readDiaryDay(name);
            return content === null
              ? writeJson(res, 404, { ok: false, error: '没有这篇日记' })
              : writeJson(res, 200, { ok: true, kind, name, content });
          }
          const file = safeJoin(notesRoot(), name);
          if (!file) return writeJson(res, 400, { ok: false, error: '名字不合法' });
          const text = readText(file);
          return text === null
            ? writeJson(res, 404, { ok: false, error: '没有这篇笔记' })
            : writeJson(res, 200, { ok: true, kind, name, content: text });
        }

        if (req.method === 'POST' && p === '/room') {
          const body = await readJsonBody(req);
          if (typeof body.weather === 'string' && WEATHERS.includes(body.weather)) room.weather = body.weather;
          if (typeof body.time === 'string' && TIMES.includes(body.time)) {
            room.time = body.time;
            if (body.autoTime === undefined) room.autoTime = false;
          }
          if (typeof body.autoTime === 'boolean') room.autoTime = body.autoTime;
          if (typeof body.wallpaper === 'string' && WALL_IDS.includes(body.wallpaper)) room.wallpaper = body.wallpaper;
          const saved = writeRoom();
          return writeJson(res, 200, {
            ok: saved,
            time: currentTime(),
            weather: room.weather,
            autoTime: room.autoTime,
            wallpaper: room.wallpaper,
          });
        }

        if (req.method === 'POST' && p === '/slot') {
          const body = await readJsonBody(req);
          if (body.action === 'remove') {
            const id = String(body.id ?? '');
            room.slots = room.slots.filter((slot) => slot.id !== id);
            writeRoom();
            return writeJson(res, 200, { ok: true, slots: room.slots });
          }
          const label = String(body.label ?? '').trim();
          if (!label) return writeJson(res, 400, { ok: false, error: '给新家具起个名字' });
          const slot = sanitizeSlot({
            id: 'slot-' + Date.now().toString(36),
            kind: body.kind,
            label,
            detail: body.detail,
            x: body.x,
            y: body.y,
            w: body.w,
            d: body.d,
            h: body.h,
            color: body.color,
          });
          if (!slot) return writeJson(res, 400, { ok: false, error: '参数不合法' });
          room.slots.push(slot);
          writeRoom();
          return writeJson(res, 200, { ok: true, id: slot.id, slots: room.slots });
        }

        if (req.method === 'POST' && p === '/command') {
          const body = await readJsonBody(req);
          const text = typeof body.text === 'string' ? body.text : '';
          const action = typeof body.action === 'string' && body.action ? body.action : parseCommand(text);
          if (!action) return writeJson(res, 200, { ok: false, error: '这句话里没有认得出的动作' });
          const result = await runCommand(action, text, typeof body.source === 'string' ? body.source : 'panel');
          // 回带上命令 id：面板已经在本地点播过一遍了，拿到 id 就能把下一次
          // 轮询回显静默掉——不然每个按钮都会演两遍。
          return writeJson(res, 200, { ok: true, action, id: roomState.command?.id ?? 0, result });
        }

        // 手机里点开某个 QQ 会话：读那个会话的真实聊天记录
        if (req.method === 'GET' && p === '/phone/chat') {
          const chatId = String(url.searchParams.get('id') ?? '');
          if (!/^(?:private|group):[^:]{1,40}$/.test(chatId)) {
            return writeJson(res, 400, { ok: false, error: '会话 id 不合法' });
          }
          const messages = readChat(chatId);
          return writeJson(res, 200, {
            ok: true,
            chatId,
            messages,
            // 读不到就是读不到，不编造
            empty: messages.length === 0,
          });
        }

        if (req.method === 'POST' && p === '/phone/read') {
          roomState.phone.screen = 'on';
          roomState.phone.lastReadAt = now();
          for (const item of roomState.phone.items) item.read = true;
          return writeJson(res, 200, { ok: true });
        }

        if (req.method === 'POST' && p === '/phone/off') {
          roomState.phone.screen = 'off';
          return writeJson(res, 200, { ok: true });
        }

        if (req.method === 'POST' && p === '/phone/say') {
          // 面板上的手机输入框：用户直接在卧室里给宠物发一句话（不经过 QQ）
          const body = await readJsonBody(req);
          const text = String(body.text ?? '').trim();
          if (!text) return writeJson(res, 400, { ok: false, error: '消息不能为空' });
          const action = parseCommand(text);
          pushPhoneMessage({ text, action, sessionId: '', channel: 'panel' });
          if (action) await runCommand(action, text, 'panel');
          return writeJson(res, 200, { ok: true, action });
        }

        if (req.method === 'POST' && p === '/douyin/start') return writeJson(res, 200, await startDouyin());
        if (req.method === 'POST' && p === '/douyin/stop') return writeJson(res, 200, await stopDouyin());

        // ---------------- QQ 连接窗口（默认 SnowLuma / OneBot 11） ----------------
        if (req.method === 'GET' && p === '/qq') {
          return writeJson(res, 200, qqInfo(origin));
        }

        if (req.method === 'POST' && p === '/qq/config') {
          const body = await readJsonBody(req);
          const patch = {};
          if (body.provider !== undefined) {
            if (!QQ_PROVIDERS.includes(body.provider)) {
              return writeJson(res, 400, { ok: false, error: '不认识的 QQ 后端类型' });
            }
            patch.provider = body.provider;
          }
          if (body.apiBase !== undefined) {
            const base = sanitizeQqBase(body.apiBase);
            if (!base) return writeJson(res, 400, { ok: false, error: '地址要 http(s):// 开头，例如 http://127.0.0.1:3001' });
            patch.apiBase = base;
          }
          // 令牌：不传 = 保持原样；传空串 = 明确清空。永远不把令牌回显给页面。
          if (body.token !== undefined) patch.token = String(body.token ?? '').trim().slice(0, 200);
          if (body.selfId !== undefined) {
            const id = String(body.selfId ?? '').replace(/\D/g, '');
            if (id && !/^\d{5,12}$/.test(id)) return writeJson(res, 400, { ok: false, error: '主人 QQ 应该是 5–12 位数字' });
            patch.selfId = id;
          }
          if (body.allowGroup !== undefined) patch.allowGroup = body.allowGroup === true;
          if (body.enabled !== undefined) patch.enabled = body.enabled !== false;
          const saved = writeQq(patch);
          // 注意顺序：qqInfo 自带 ok:true，必须先铺开它再写判定，
          // 否则保存失败会被自己的状态对象盖成「成功」（本地试用时踩到过）。
          return writeJson(res, 200, { ...qqInfo(origin), ok: saved, error: saved ? '' : '写不进 qq.json（检查目录权限）' });
        }

        if (req.method === 'POST' && p === '/qq/test') {
          const body = await readJsonBody(req);
          // 允许「先测再存」：带上页面里还没保存的值
          const over = {};
          if (body.apiBase !== undefined) over.apiBase = body.apiBase;
          if (body.token !== undefined) over.token = String(body.token);
          const result = await testQq(over);
          // 同上：状态对象自带 ok:true，判定必须写在它之后，
          // 否则「没连上」会被盖成「通了」——这正是本地试用暴露的问题。
          return writeJson(res, 200, {
            ...qqInfo(origin),
            ok: result.ok,
            apiBase: result.apiBase,
            uin: result.uin,
            nickname: result.nickname,
            friendCount: result.friendCount,
            error: result.ok ? '' : result.error,
          });
        }

        // SnowLuma 的「HTTP 上报」填这个地址；也接受 access_token 查询参数
        if (req.method === 'POST' && p === '/qq/event') {
          return handleOneBotReport(req, res, url);
        }

        return writeJson(res, 404, { ok: false, error: '没有这个地址：' + p });
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 500;
        return writeJson(res, status, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  };

  ctx.effect(() => webServer.register(route), 'dsh-pet-bedroom: room http');
  ctx.logger?.info?.('[dsh-pet-bedroom] 卧室已开门：' + origin + ROOM_PREFIX + '（记忆库：' + vaultDir + '）');
}

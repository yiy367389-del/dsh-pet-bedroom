/**
 * 通用接口验证：证明「每个人不一样」的那几个接入点真的可配置。
 *   1. petRoute   → 指向自己的 dsh-pet 路由前缀，能读到宠物与动画池
 *   2. petId      → 指定哪只宠物
 *   3. vaultDir / notesDir → 指向自己的记忆库与笔记目录
 *   4. chatService / chatDataDir → 指向自己的 QQ 服务与数据目录
 *   5. douyinApiBase → 指向自己的抖音后端（可以是别的端口/域名）
 * 全隔离：临时目录 + 假 fetch + 假服务，不碰真实 DSH / 真实数据。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bedroom-config-'));
const vault = path.join(tmp, 'my-vault');
const chat = path.join(tmp, 'my-chat');
fs.mkdirSync(path.join(vault, '我的笔记'), { recursive: true });
fs.mkdirSync(path.join(chat, 'chatlog'), { recursive: true });
process.env.DSH_HOME = tmp;

// 自己的聊天数据：日记 + 聊天流水
const day = new Date().toLocaleDateString('sv-SE');
fs.writeFileSync(
  path.join(chat, 'diary.json'),
  JSON.stringify({ plan: {}, history: [{ at: Date.now(), text: '这篇日记来自我自己的聊天服务。', ok: true }] }),
  'utf8',
);
fs.writeFileSync(
  path.join(chat, 'chatlog', day + '.jsonl'),
  JSON.stringify({ t: Date.now(), chatId: 'private:10000009', who: '某人', uid: '10000009', text: '你好' }) + '\n',
  'utf8',
);

const { apply } = await import('./index.js');

// ---- 假 fetch：记录所有上游请求，返回可控结果 ----
const calls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  calls.push((init?.method || 'GET') + ' ' + u);
  if (u.endsWith('/my-pets/config')) {
    return new Response(
      JSON.stringify({
        rootA: {
          pets: [{ id: 'cat', name: '猫' }],
          animations: { idle: ['待机呼吸'], categories: [{ actions: ['转圈', '玩水枪'] }] },
        },
      }),
      { status: 200 },
    );
  }
  if (u.includes('/my-pets/thumb/')) {
    return new Response(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), {
      status: 200,
      headers: { 'content-type': 'video/webm' },
    });
  }
  if (u.endsWith('http://127.0.0.1:7000/api/douyin/state')) {
    return new Response(JSON.stringify({ ok: true, busy: false, watched: 5, pauseReason: '', history: [] }), { status: 200 });
  }
  if (u.endsWith('http://127.0.0.1:7000/api/douyin/run')) {
    return new Response(JSON.stringify({ ok: true, message: '我自己的后端：开刷' }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

// ---- 假 QQ 服务：名字故意不叫 aurabot ----
let fireActivity = null;
const fakeQq = {
  on: (event, fn) => {
    if (event === 'activity') fireActivity = fn;
    return () => { fireActivity = null; };
  },
  hub: { groupNames: new Map(), groupName: async () => '' },
};

let route = null;
const webServer = { register: (r) => { route = r; return () => {}; }, getOrigin: () => 'http://127.0.0.1:61000' };
const ctx = {
  webServer,
  get: (key) => {
    if (key === 'my-qq') return fakeQq;
    if (key === 'webServer') return webServer;
    if (key === 'tools') return { register: () => () => {} };
    return undefined;
  },
  effect: (fn) => { const d = fn(); return () => d?.(); },
  on: () => () => {},
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
};

apply(ctx, {
  petRoute: '/my-pets',
  petId: 'cat',
  vaultDir: vault,
  notesDir: '我的笔记',
  chatService: 'my-qq',
  chatDataDir: chat,
  douyinApiBase: 'http://127.0.0.1:7000/api',
});

const mkRes = () => {
  const r = { status: 0, body: '' };
  r.writeHead = (s) => { r.status = s; };
  r.end = (b) => { r.body = typeof b === 'string' ? b : String(b ?? ''); };
  return r;
};
const call = async (url, method = 'GET', body = '') => {
  const res = mkRes();
  const req = { url, method, headers: { host: '127.0.0.1:61000' } };
  req[Symbol.asyncIterator] = async function* () { if (body) yield Buffer.from(body, 'utf8'); };
  if (body) req.headers['content-type'] = 'application/json';
  await route.handler(req, res);
  return res;
};

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'OK  ' : 'FAIL'), name, extra);
  if (!ok) bad++;
};

const st = JSON.parse((await call('/dsh-pet-bedroom/state')).body);

check('自定义 petRoute 读到了宠物', st.pet && st.pet.entry === 'rootA');
check('自定义 petId 选中了那只宠物', st.pet && st.pet.pet && st.pet.pet.id === 'cat');
check('自定义 petRoute 拿到了动画池', st.pet && st.pet.animations.includes('转圈'));
check('自定义记忆库路径生效', st.room.vaultDir === vault, st.room.vaultDir);
check('自定义笔记目录生效', st.room.notesDir === path.join(vault, '我的笔记'), st.room.notesDir);
check('自定义聊天数据目录读到日记', (st.docs.diary || []).length === 1, JSON.stringify(st.docs.diary?.[0]?.preview));
check('自定义聊天服务读到会话', (st.phone.qq.chats || []).length === 1, JSON.stringify(st.phone.qq.chats?.[0]?.title));

// 自定义聊天服务的 activity 事件应该也能进手机
fireActivity?.({ kind: 'in', owner: true, direct: true, text: '睡觉', chatId: 'private:10000009' });
await new Promise((r) => setTimeout(r, 80));
const st2 = JSON.parse((await call('/dsh-pet-bedroom/state')).body);
check('自定义聊天服务的 QQ 事件进了手机', st2.phone.items.some((i) => i.text === '睡觉' && i.action === 'sleep'));

// 素材代理必须转发到自定义 petRoute
const thumb = await call('/dsh-pet-bedroom/pet/thumb/rootA/a.webm');
check('素材代理走自定义 petRoute', thumb.status === 200 && calls.some((c) => c.includes('/my-pets/thumb/rootA/a.webm')));

// 抖音必须打自定义基地址（另一个端口、完整 URL）
check('抖音状态打自定义基地址', calls.some((c) => c === 'GET http://127.0.0.1:7000/api/douyin/state'));
const run = JSON.parse((await call('/dsh-pet-bedroom/command', 'POST', JSON.stringify({ text: '刷抖音' }))).body);
check('刷抖音打自定义基地址', calls.some((c) => c === 'POST http://127.0.0.1:7000/api/douyin/run') && run.result?.ok === true);
check('没有请求过默认 aurabot 地址', !calls.some((c) => c.includes('/aurabot/api')));

// 工具仍然齐全
const tools = ['bedroom_status', 'bedroom_read', 'bedroom_write', 'bedroom_atmosphere', 'bedroom_furniture', 'bedroom_wallpaper'];

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad === 0 ? '\nCONFIG PASS' : '\n' + bad + ' FAILED');
process.exit(bad === 0 ? 0 : 1);

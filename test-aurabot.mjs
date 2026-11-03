// 端到端验证：用**假 Aurabot 服务**喂给卧室，检查三条链路是否真的接上了。
// 不碰真实 DSH、不碰真实记忆库、不碰真实 Aurabot 数据。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bedroom-aurabot-'));
process.env.DSH_HOME = tmp;
process.env.BEDROOM_VAULT_DIR = path.join(tmp, 'vault');
process.env.AURABOT_DATA_DIR = path.join(tmp, 'aurabot');
fs.mkdirSync(path.join(process.env.AURABOT_DATA_DIR), { recursive: true });
fs.mkdirSync(path.join(process.env.BEDROOM_VAULT_DIR, '30-读书笔记'), { recursive: true });

const today = new Date().toLocaleDateString('sv-SE');
// 两篇必须落在**同一天**才有意义（验证「同一天多篇聚合」）。
// 之前用 nowMs - 7200_000，在凌晨跑就会跨到前一天、被拆成两天——这是测试的坑，不是产品的。
// 现在锚定当天中午 12:00，两篇分别是 10:00 和 12:00，不管几点跑都在同一天。
const noon = new Date();
noon.setHours(12, 0, 0, 0);
const nowMs = noon.getTime();
fs.writeFileSync(
  path.join(process.env.AURABOT_DATA_DIR, 'diary.json'),
  JSON.stringify({
    plan: { day: today, times: [], done: [] },
    history: [
      { at: nowMs - 7200_000, text: '上午那篇：窗外云很厚，我趴在窗台看了一会儿。', ok: true, visibility: 'all' },
      { at: nowMs, text: '下午那篇：拿水枪给叶子喷了水，水珠挂在叶尖上。', ok: true, visibility: 'all' },    ],
  }),
  'utf8',
);

const { apply } = await import('./index.js');

// ---- 假 Aurabot：记录调用，返回可控结果 ----
const calls = { browse: 0, listens: [] };
const douyinState = { busy: false, runs: 3, watched: 12, like: 2, comment: 1, share: 1, pauseReason: '', lastSkipReason: '', history: [] };
const fakeDouyin = {
  browse: async (opts) => {
    calls.browse += 1;
    douyinState.busy = true;
    return { ok: true, message: '刚开始刷，这一轮看 3 个左右' };
  },
  state: () => ({ ...douyinState }),
};
const fakeAurabot = {
  use: (id) => (id === 'douyin' ? fakeDouyin : null),
  on: (event, fn) => {
    calls.listens.push(event);
    if (event === 'activity') globalThis.__fire = fn;
    return () => { globalThis.__fire = null; };
  },
};

// ---- 最小 ctx / webServer 桩 ----
let route = null;
const tools = new Map();
const webServer = {
  register: (r) => { route = r; return () => { route = null; }; },
  getOrigin: () => 'http://127.0.0.1:59999',
};
const ctx = {
  webServer,
  get: (key) => {
    if (key === 'aurabot') return fakeAurabot;
    if (key === 'tools') return { register: (t) => { tools.set(t.name, t); return () => tools.delete(t.name); } };
    if (key === 'webServer') return webServer;
    return undefined;
  },
  effect: (fn) => { const d = fn(); return () => d?.(); },
  on: () => () => {},
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
};

apply(ctx, { vaultDir: process.env.BEDROOM_VAULT_DIR });

const mkRes = () => {
  const r = { status: 0, body: '', headers: {} };
  r.writeHead = (s, h) => { r.status = s; Object.assign(r.headers, h || {}); };
  r.end = (b) => { r.body = typeof b === 'string' ? b : String(b ?? ''); };
  return r;
};
const call = async (url, method = 'GET', body = '') => {
  const res = mkRes();
  const req = { url, method, headers: { host: '127.0.0.1:59999' } };
  if (body) {
    req[Symbol.asyncIterator] = async function* () { yield Buffer.from(body, 'utf8'); };
    req.headers['content-type'] = 'application/json';
  } else {
    req[Symbol.asyncIterator] = async function* () {};
  }
  await route.handler(req, res);
  return res;
};

console.log('===== 1. QQ：只认主人私聊 =====');
console.log('  监听了 activity =', calls.listens.includes('activity'));
const fire = globalThis.__fire;
const st0 = JSON.parse((await call('/dsh-pet-bedroom/state')).body);
const before = st0.phone.items.length;

const cases = [
  { name: '主人私聊「刷抖音」', a: { kind: 'in', owner: true, direct: true, text: '刷抖音', chatId: 'private:10001' }, expect: 1 },
  { name: '群里有人叫刷抖音（非私聊）', a: { kind: 'in', owner: true, direct: false, text: '刷抖音', chatId: 'group:20002' }, expect: 0 },
  { name: '别人私聊（非主人）', a: { kind: 'in', owner: false, direct: true, text: '刷抖音', chatId: 'private:99999' }, expect: 0 },
  { name: '主人私聊「睡觉」', a: { kind: 'in', owner: true, direct: true, text: '睡觉', chatId: 'private:10001' }, expect: 1 },
];
for (const c of cases) {
  const n0 = JSON.parse((await call('/dsh-pet-bedroom/state')).body).phone.items.length;
  fire(c.a);
  await new Promise((r) => setTimeout(r, 120));
  const st = JSON.parse((await call('/dsh-pet-bedroom/state')).body);
  const added = st.phone.items.length - n0;
  const ok = added === c.expect;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${c.name.padEnd(24)} 进手机=${added}（期望 ${c.expect}）`);
}

console.log('\n===== 2. 刷抖音 = 后端的「现在刷一轮」（走 HTTP，不再走 service）=====');
// 卧室的刷抖音按钮打的是后端 HTTP 接口 POST <douyinApiBase>/douyin/run，
// 所以这里的 fakeDouyin.browse 不该被调用（那是 service 路径，卧室不用了）。
console.log('  后端的 douyin.browse 被直接调用次数 =', calls.browse, '（应 0：卧室走它的 HTTP 接口，不调 service）');

console.log('\n===== 3. 日记随聊天服务变 =====');
const st3 = JSON.parse((await call('/dsh-pet-bedroom/state')).body);
console.log('  日记天数 =', st3.docs.diary.length, '| 当天篇数 =', st3.docs.latestDiary.count, '| source =', st3.docs.latestDiary.source);
console.log('  预览 =', JSON.stringify(st3.docs.latestDiary.preview.slice(0, 40)));
const docRes = await call('/dsh-pet-bedroom/doc?kind=diary&name=' + today);
const docBody = JSON.parse(docRes.body);
console.log('  读当天全文 →', docRes.status, '| 两篇都有 =', /上午那篇/.test(docBody.content) && /下午那篇/.test(docBody.content));

// 改 diary.json，确认卧室立刻跟着变
const d = JSON.parse(fs.readFileSync(path.join(process.env.AURABOT_DATA_DIR, 'diary.json'), 'utf8'));
d.history.push({ at: nowMs - 86400_000, text: '昨天那篇：换了新的房间图。', ok: true, visibility: 'all' });
fs.writeFileSync(path.join(process.env.AURABOT_DATA_DIR, 'diary.json'), JSON.stringify(d), 'utf8');
const st4 = JSON.parse((await call('/dsh-pet-bedroom/state')).body);
console.log('  加了昨天一篇后 → 天数 =', st4.docs.diary.length, '（应 2）| 日期 =', st4.docs.diary.map((x) => x.date).join(','));

console.log('\n===== 4. 抖音通道归属（源码级）=====');
const src = fs.readFileSync('index.js', 'utf8');
const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
console.log('  代码里用 api/douyin-browser =', /api\/douyin-browser/.test(code), '（应 false，已作废）');
console.log('  代码里用 douyinBase + /douyin/run =',
  /douyinBase\(\)/.test(code) && /\/douyin\/run/.test(code), '（应 true）');
console.log('  抖音地址可配置（douyinApiBase） =', /douyinApiBase/.test(code), '（应 true）');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nDONE（临时目录已清理）');

// 端到端：手机 QQ 界面 + 抖音通道回退验证。全隔离，不碰真实数据。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bedroom-phone-'));
process.env.DSH_HOME = tmp;
process.env.BEDROOM_VAULT_DIR = path.join(tmp, 'vault');
process.env.AURABOT_DATA_DIR = path.join(tmp, 'aurabot');
fs.mkdirSync(path.join(process.env.AURABOT_DATA_DIR, 'chatlog'), { recursive: true });
fs.mkdirSync(path.join(process.env.BEDROOM_VAULT_DIR, '30-读书笔记'), { recursive: true });

// 造一份真实结构的聊天流水（字段照 Aurabot hub.js 的 logChat；名字与号码全是假的）
const nowMs = Date.now();
const lines = [
  { t: nowMs - 90000, chatId: 'private:10000001', who: '小明', uid: '10000001', text: '在吗' },
  { t: nowMs - 80000, chatId: 'private:10000001', who: '小明', uid: '10000001', text: '今天天气不错' },
  { t: nowMs - 70000, chatId: 'private:10000001', who: 'bot', text: '在的，你说' },
  { t: nowMs - 60000, chatId: 'private:10000002', who: '小红', uid: '10000002', text: '你怎么不回消息呢？' },
  { t: nowMs - 50000, chatId: 'private:10000002', who: 'bot', text: '刚在忙，别急' },
  { t: nowMs - 40000, chatId: 'private:10000002', who: '小红', uid: '10000002', text: '刷抖音' },
];
const day = new Date(nowMs).toLocaleDateString('sv-SE');
fs.writeFileSync(
  path.join(process.env.AURABOT_DATA_DIR, 'chatlog', day + '.jsonl'),
  lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  'utf8',
);

const { apply } = await import('./index.js');

let route = null;
const webServer = {
  register: (r) => { route = r; return () => { route = null; }; },
  getOrigin: () => 'http://127.0.0.1:59998',
};
// 假 Aurabot 抖音模块接口（卧室现在走 /aurabot/api/douyin/*）
const douyinCalls = [];
let douyinBusy = false;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  douyinCalls.push({ url: u.replace('http://127.0.0.1:59998', ''), method: init?.method || 'GET' });
  if (u.includes('/aurabot/api/douyin/state')) {
    return new Response(JSON.stringify({
      ok: true,
      busy: douyinBusy,
      watched: 3,
      runs: 1,
      pauseReason: '',
      lastSkipReason: '',
      history: [{ at: Date.now(), count: 2 }],
    }), { status: 200 });
  }
  if (u.includes('/aurabot/api/douyin/run')) {
    douyinBusy = true;   // browse() 是后台开刷、马上返回
    return new Response(JSON.stringify({ ok: true, message: '刚开始刷，这一轮看 2 个左右，大概 1 分钟。' }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

const ctx = {
  webServer,
  get: (k) => {
    if (k === 'webServer') return webServer;
    if (k === 'tools') return { register: () => () => {} };
    if (k === 'aurabot') return null;   // 故意不给 Aurabot：验证抖音不依赖它
    return undefined;
  },
  effect: (fn) => { fn(); return () => {}; },
  on: () => () => {},
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
};
apply(ctx, { vaultDir: process.env.BEDROOM_VAULT_DIR });

const mkRes = () => {
  const r = { status: 0, body: '' };
  r.writeHead = (s) => { r.status = s; };
  r.end = (b) => { r.body = typeof b === 'string' ? b : String(b ?? ''); };
  return r;
};
const call = async (url, method = 'GET', body = '') => {
  const res = mkRes();
  const req = { url, method, headers: { host: '127.0.0.1:59998' } };
  req[Symbol.asyncIterator] = async function* () { if (body) yield Buffer.from(body, 'utf8'); };
  if (body) req.headers['content-type'] = 'application/json';
  await route.handler(req, res);
  return res;
};

console.log('===== 1. 手机 QQ 会话列表（真实聊天流水）=====');
const st = JSON.parse((await call('/dsh-pet-bedroom/state')).body);
const chats = st.phone.qq.chats;
console.log('  会话数 =', chats.length, '（应 2）');
for (const c of chats) {
  console.log(`   ${c.chatId} | 标题=${c.title} | 条数=${c.count} | 未读=${c.unread} | 最后=${JSON.stringify(c.lastText.slice(0, 20))}`);
}

console.log('\n===== 2. 点进会话看聊天记录 =====');
for (const c of chats) {
  const r = await call('/dsh-pet-bedroom/phone/chat?id=' + encodeURIComponent(c.chatId));
  const j = JSON.parse(r.body);
  const mine = j.messages.filter((m) => m.from === 'me').length;
  const theirs = j.messages.filter((m) => m.from === 'them').length;
  console.log(`   ${c.title}: ${r.status} 条数=${j.messages.length} 我=${mine} 对方=${theirs}`);
}

console.log('\n===== 3. 会话 id 校验（防注入）=====');
for (const bad of ['../../etc/passwd', 'private:', 'x:1', 'private:' + 'a'.repeat(60)]) {
  const r = await call('/dsh-pet-bedroom/phone/chat?id=' + encodeURIComponent(bad));
  console.log('  ', JSON.stringify(bad).slice(0, 30), '→', r.status);
}

console.log('\n===== 4. 抖音 = Aurabot 刷抖音模块的「现在刷一轮」 =====');
douyinCalls.length = 0;
const cmd = await call('/dsh-pet-bedroom/command', 'POST', JSON.stringify({ text: '刷抖音' }));
const cmdBody = JSON.parse(cmd.body);
console.log('  /command 刷抖音 →', JSON.stringify(cmdBody.result));
const urls = douyinCalls.map((c) => c.method + ' ' + c.url);
console.log('  调用序列 =', JSON.stringify(urls));

const posted = douyinCalls.find((c) => c.method === 'POST' && c.url.endsWith('/aurabot/api/douyin/run'));
console.log('  真的 POST 了 /aurabot/api/douyin/run =', Boolean(posted), '（应 true，默认接 Aurabot）');
console.log('  全程只走抖音后端接口 =',
  douyinCalls.length > 0 && douyinCalls.every((c) => c.url.includes('/aurabot/api/douyin/')), '（应 true）');
console.log('  没有任何 douyin-browser 调用 =',
  !douyinCalls.some((c) => c.url.includes('douyin-browser')), '（应 true）');

const st2 = JSON.parse((await call('/dsh-pet-bedroom/state')).body);
console.log('  douyin.running =', st2.douyin.running, '（桩里 busy=true → 应 true）');
console.log('  douyin.watched =', st2.douyin.watched, '（应 3，来自后端 state）');
console.log('  douyin.ok =', st2.douyin.ok, '（应 true）');

// 「别刷了」不许假装按停：后端没有停止接口
const stopCmd = await call('/dsh-pet-bedroom/command', 'POST', JSON.stringify({ text: '别刷了' }));
const stopBody = JSON.parse(stopCmd.body);
console.log('  /command 别刷了 →', JSON.stringify(stopBody.result));
console.log('  停不了时如实 ok:false =', stopBody.result && stopBody.result.ok === false, '（应 true，不假装按停）');

console.log('\n===== 5. 源码里应走可配置的抖音后端，且不再有专用浏览器 =====');
const src = fs.readFileSync('index.js', 'utf8');
// 只查「代码」不查注释：把行注释剥掉再找
const code = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
console.log('  代码里 douyinApiBase + /douyin/run =', /douyinApiBase/.test(code) && /\/douyin\/run/.test(code), '（应 true）');
console.log('  代码里 api/douyin-browser =', /api\/douyin-browser/.test(code), '（应 false，已作废）');
console.log('  代码里 watch/start =', /watch\/start/.test(code), '（应 false，旧路径已删）');
console.log('  代码里 douyinToken =', /douyinToken/.test(code), '（应 false，旧设置令牌已删）');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nDONE（临时目录已清理）');

// 群聊：真实群名 + 群头像（不用某个人的头像）。全隔离。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bedroom-group-'));
process.env.DSH_HOME = tmp;
process.env.BEDROOM_VAULT_DIR = path.join(tmp, 'vault');
process.env.AURABOT_DATA_DIR = path.join(tmp, 'aurabot');
fs.mkdirSync(path.join(process.env.AURABOT_DATA_DIR, 'chatlog'), { recursive: true });
fs.mkdirSync(path.join(process.env.BEDROOM_VAULT_DIR, '30-读书笔记'), { recursive: true });

const GID = '100200300';
const nowMs = Date.now();
const lines = [
  // 群聊：两个不同的人说话（名字与号码全是假的）
  { t: nowMs - 90000, chatId: 'group:' + GID, who: '小明', uid: '10000001', text: '你帮我问问小刚在干嘛' },
  { t: nowMs - 80000, chatId: 'group:' + GID, who: '小刚', uid: '10000002', text: '我在这儿呢' },
  { t: nowMs - 70000, chatId: 'group:' + GID, who: 'bot', uid: '', text: '我问了' },
  // 私聊
  { t: nowMs - 60000, chatId: 'private:10000003', who: '小红', uid: '10000003', text: '刷抖音' },
];
const day = new Date(nowMs).toLocaleDateString('sv-SE');
fs.writeFileSync(
  path.join(process.env.AURABOT_DATA_DIR, 'chatlog', day + '.jsonl'),
  lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  'utf8',
);

const { apply } = await import('./index.js');

let route = null;
const webServer = { register: (r) => { route = r; return () => {}; }, getOrigin: () => 'http://127.0.0.1:59997' };

// 假 Aurabot：hub.groupName 返回真实群名（模拟网关查到的）
const REAL_GROUP_NAME = '测试群';
const fakeHub = {
  groupNames: new Map([[GID, REAL_GROUP_NAME]]),   // 模拟「已经查过并存进内存」
  groupName: async (gid) => (String(gid) === GID ? REAL_GROUP_NAME : String(gid)),
};
const fakeAurabot = { hub: fakeHub, use: () => null, on: () => () => {} };

globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });

const ctx = {
  webServer,
  get: (k) => (k === 'aurabot' ? fakeAurabot : k === 'webServer' ? webServer : k === 'tools' ? { register: () => () => {} } : undefined),
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
const call = async (url) => {
  const res = mkRes();
  const req = { url, method: 'GET', headers: { host: '127.0.0.1:59997' } };
  req[Symbol.asyncIterator] = async function* () {};
  await route.handler(req, res);
  return res;
};

console.log('===== 1. 群聊标题 = 真实群名 =====');
const st = JSON.parse((await call('/dsh-pet-bedroom/state')).body);
for (const c of st.phone.qq.chats) {
  console.log(`  [${c.kind}] title=${JSON.stringify(c.title)} avatar=${c.avatar || '(空)'} uid=${JSON.stringify(c.uid)}`);
}
const grp = st.phone.qq.chats.find((c) => c.kind === 'group');
const priv = st.phone.qq.chats.find((c) => c.kind === 'private');
console.log('\n  群标题是群名 =', grp.title === REAL_GROUP_NAME ? 'OK' : `FAIL(${grp.title})`);
console.log('  群标题不是某个人的昵称 =', !['小明', '小刚', '小红'].includes(grp.title) ? 'OK' : 'FAIL');
console.log('  群头像用群头像接口 =', grp.avatar.includes('/groupavatar/') ? 'OK' : `FAIL(${grp.avatar})`);
console.log('  群不挂个人 uid =', grp.uid === '' ? 'OK' : `FAIL(${grp.uid})`);
console.log('  私聊仍用个人头像 =', priv.avatar.includes('/avatar/') && !priv.avatar.includes('group') ? 'OK' : `FAIL(${priv.avatar})`);
console.log('  私聊仍用对方昵称 =', priv.title === '小红' ? 'OK' : `FAIL(${priv.title})`);

console.log('\n===== 2. 群名落盘了（Aurabot 重启也不丢）=====');
const gnFile = path.join(tmp, 'dsh-pet-bedroom', 'groupnames.json');
const saved = fs.existsSync(gnFile) ? JSON.parse(fs.readFileSync(gnFile, 'utf8')) : {};
console.log('  groupnames.json =', JSON.stringify(saved));
console.log('  群名已缓存 =', saved[GID] === REAL_GROUP_NAME ? 'OK' : 'FAIL');

console.log('\n===== 3. 群聊里标出每个发言人 =====');
const chat = JSON.parse((await call('/dsh-pet-bedroom/phone/chat?id=' + encodeURIComponent('group:' + GID))).body);
for (const m of chat.messages) {
  console.log(`  from=${m.from.padEnd(4)} who=${String(m.who).padEnd(4)} showName=${m.showName} avatar=${m.avatar ? m.avatar.replace('/dsh-pet-bedroom', '') : '(无)'}`);
}
const them = chat.messages.filter((m) => m.from === 'them');
console.log('  对方每条都 showName =', them.every((m) => m.showName) ? 'OK' : 'FAIL');
console.log('  不同发言人用不同头像 =', new Set(them.map((m) => m.avatar)).size === 2 ? 'OK' : 'FAIL');
console.log('  bot 自己不 showName =', chat.messages.filter((m) => m.from === 'me').every((m) => !m.showName) ? 'OK' : 'FAIL');

console.log('\n===== 4. 私聊不标发言人 =====');
const pchat = JSON.parse((await call('/dsh-pet-bedroom/phone/chat?id=' + encodeURIComponent('private:10000003'))).body);
console.log('  私聊 showName 全 false =', pchat.messages.every((m) => !m.showName) ? 'OK' : 'FAIL');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nDONE（临时目录已清理）');

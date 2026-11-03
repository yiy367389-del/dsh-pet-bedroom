/**
 * QQ 连接窗口的端到端验证（全隔离：临时目录 + 假 OneBot 后端 + 假 fetch）。
 *   1. 默认后端 = SnowLuma，默认地址 = http://127.0.0.1:3001
 *   2. 保存配置后立即生效，令牌只写不回显
 *   3. 测试连接会带 Bearer 令牌调 get_login_info / get_friend_list
 *   4. HTTP 上报：令牌校验、只收主人私聊、按 message_id 去重
 *   5. 收到的消息真的进了手机 + 命令真的执行了
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bedroom-qq-'));
process.env.DSH_HOME = tmp;

const { apply } = await import('./index.js');

const calls = [];
let loginInfo = { user_id: 10000001, nickname: '测试机' };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, method: init.method || 'GET', headers: init.headers || {} });
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('/get_login_info')) return json({ status: 'ok', retcode: 0, data: loginInfo });
  if (u.includes('/get_friend_list')) return json({ status: 'ok', retcode: 0, data: [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }] });
  return json({ status: 'failed', retcode: 1404, wording: '不认识的接口' }, 404);
};

let route = null;
const webServer = { register: (r) => { route = r; return () => {}; }, getOrigin: () => 'http://127.0.0.1:61000' };
const ctx = {
  webServer,
  get: (key) => (key === 'webServer' ? webServer : key === 'tools' ? { register: () => () => {} } : undefined),
  effect: (fn) => { const d = fn(); return () => d?.(); },
  on: () => () => {},
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
};

apply(ctx, { qqApiBase: 'http://127.0.0.1:3001' });

const mkRes = () => {
  const r = { status: 0, body: '', headers: {} };
  r.writeHead = (s, h) => { r.status = s; if (h) r.headers = h; };
  r.end = (b) => { r.body = typeof b === 'string' ? b : String(b ?? ''); };
  return r;
};
const call = async (url, method = 'GET', body = '', headers = {}) => {
  const res = mkRes();
  const req = { url, method, headers: { host: '127.0.0.1:61000', ...headers } };
  req[Symbol.asyncIterator] = async function* () { if (body) yield Buffer.from(body, 'utf8'); };
  if (body && !req.headers['content-type']) req.headers['content-type'] = 'application/json';
  await route.handler(req, res);
  return res;
};
const parse = (r) => { try { return JSON.parse(r.body); } catch { return null; } };

let bad = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'OK  ' : 'FAIL'), name, extra);
  if (!ok) bad++;
};

const st0 = parse(await call('/dsh-pet-bedroom/state'));
check('默认后端是 SnowLuma', st0.qq && st0.qq.provider === 'snowluma');
check('默认地址是 3001', st0.qq && st0.qq.apiBase === 'http://127.0.0.1:3001', st0.qq?.apiBase);
check('上报地址是 /qq/event', st0.qq && /\/dsh-pet-bedroom\/qq\/event$/.test(st0.qq.reportUrl), st0.qq?.reportUrl);

// ---- 保存 ----
const saved = parse(await call('/dsh-pet-bedroom/qq/config', 'POST', JSON.stringify({
  provider: 'snowluma', apiBase: 'http://127.0.0.1:3001/', token: 'tk-123', selfId: '10000001',
})));
check('保存成功', saved.ok === true, saved.error || '');
check('保存的是令牌（hasToken）', saved.hasToken === true);
check('令牌不返回给页面', !JSON.stringify(saved).includes('tk-123'));
check('主人 QQ 存下来了', saved.selfId === '10000001');
check('地址末尾斜杠被去掉', saved.apiBase === 'http://127.0.0.1:3001', saved.apiBase);

const disk = JSON.parse(fs.readFileSync(path.join(tmp, 'dsh-pet-bedroom', 'qq.json'), 'utf8'));
check('令牌落盘到 qq.json', disk.token === 'tk-123');

// ---- 测试连接 ----
const tested = parse(await call('/dsh-pet-bedroom/qq/test', 'POST', JSON.stringify({})));
check('测试连接成功', tested.ok === true, tested.error || '');
check('拿到机器人昵称', tested.nickname === '测试机');
check('拿到机器人 QQ', tested.uin === '10000001');
check('拿到好友数', tested.friendCount === 3, String(tested.friendCount));
const loginCall = calls.find((c) => c.url.includes('/get_login_info'));
check('请求带 Bearer 令牌', String(loginCall?.headers?.authorization || '') === 'Bearer tk-123');
check('测试结果记进状态', parse(await call('/dsh-pet-bedroom/qq')).connected?.ok === true);

// ---- 上报 ----
const report = (body, headers = { authorization: 'Bearer tk-123' }) =>
  call('/dsh-pet-bedroom/qq/event', 'POST', JSON.stringify(body), headers);

const base = (over = {}) => ({
  post_type: 'message',
  message_type: 'private',
  message_id: 9001,
  time: Math.floor(Date.now() / 1000),
  self_id: 10000002,
  user_id: 10000001,
  sender: { user_id: 10000001, nickname: '主人' },
  raw_message: '睡觉',
  ...over,
});

const wrongToken = parse(await report(base(), { authorization: 'Bearer nope' }));
check('令牌不对 → 401', wrongToken.ok === false);

const stranger = parse(await report(base({ user_id: 2, sender: { user_id: 2, nickname: '路人' }, message_id: 9002 })));
check('不是主人 → 不收', stranger.accepted === false, stranger.reason);

const group = parse(await report(base({ message_type: 'group', group_id: 555, message_id: 9003 })));
check('群聊 → 不收', group.accepted === false, group.reason);

const okMsg = parse(await report(base()));
check('主人私聊「睡觉」→ 收下', okMsg.accepted === true);
const dup = parse(await report(base()));
check('同一条重复上报 → 去重', dup.duplicate === true);

const st1 = parse(await call('/dsh-pet-bedroom/state'));
const newest = (st1.phone.items || [])[0];
check('消息进了手机', newest && newest.text === '睡觉', newest?.text);
check('命令被识别（睡觉）', newest && newest.action === 'sleep', String(newest?.action));
check('上报计数 = 1', st1.qq.events.total === 1, String(st1.qq.events.total));

// 聊天列表：QQ 直连的流水也并进来了
const chat = (st1.phone.qq.chats || []).find((c) => c.chatId === 'private:10000001');
check('手机聊天列表有这条私聊', Boolean(chat), chat?.title);
check('聊天标题用对方昵称', chat && chat.title === '主人', chat?.title);

const logDir = path.join(tmp, 'dsh-pet-bedroom', 'qq-log');
const logFiles = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
check('流水落盘（qq-log）', logFiles.length === 1, logFiles.join(','));

// 令牌不出现于任何状态响应
check('状态响应不含令牌', !JSON.stringify(st1).includes('tk-123'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(bad === 0 ? '\nQQ CONFIG PASS' : '\n' + bad + ' FAILED');
process.exit(bad === 0 ? 0 : 1);

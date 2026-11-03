/**
 * 验证「写盘失败必须是 ok:false」——本地试用时状态对象自带的 ok:true 会盖掉判定。
 * 用只读目录模拟写不进去，断言 /qq/config 如实报失败。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bedroom-fail-'));
process.env.DSH_HOME = tmp;
const { apply } = await import('./index.js');

let route = null;
const webServer = { register: (r) => { route = r; return () => {}; }, getOrigin: () => 'http://127.0.0.1:61001' };
const ctx = {
  webServer,
  get: (k) => (k === 'webServer' ? webServer : k === 'tools' ? { register: () => () => {} } : undefined),
  effect: (fn) => { const d = fn(); return () => d?.(); },
  on: () => () => {},
  logger: { info: () => {}, warn: () => {}, debug: () => {} },
};
apply(ctx, { qqFile: path.join(tmp, 'occupied', 'qq.json') });

// 用一个同名文件占住目录位置，mkdir 必然失败
fs.writeFileSync(path.join(tmp, 'occupied'), 'not a directory');

const mkRes = () => {
  const r = { status: 0, body: '' };
  r.writeHead = (s, h) => { r.status = s; if (h) r.headers = h; };
  r.end = (b) => { r.body = typeof b === 'string' ? b : String(b ?? ''); };
  return r;
};
const call = async (url, method, body) => {
  const res = mkRes();
  const req = { url, method, headers: { host: '127.0.0.1:61001', 'content-type': 'application/json' } };
  req[Symbol.asyncIterator] = async function* () { if (body) yield Buffer.from(body, 'utf8'); };
  await route.handler(req, res);
  return JSON.parse(res.body);
};

const r = await call('/dsh-pet-bedroom/qq/config', 'POST', JSON.stringify({ apiBase: 'http://127.0.0.1:3001' }));
console.log('save result:', JSON.stringify(r).slice(0, 200));
const ok = r.ok === false && /写不进/.test(String(r.error));
console.log(ok ? 'OK   写盘失败如实报 ok:false' : 'FAIL 写盘失败仍报 ok:true');

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(ok ? 0 : 1);

// 独立预览服务器：只为了在**不重启 DSH** 的情况下验证 web/ 里的改动。
// 它照搬宿主半侧的静态路由与素材代理，/state 转发给真实宿主并补上会话列表。
// 用法：node preview.mjs → http://127.0.0.1:64123/dsh-pet-bedroom/
//   环境变量：PORT（默认 64123）、UPSTREAM（真实 DSH 地址）、BEDROOM_PET_ROUTE
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname);           // 本文件所在目录就是插件根
const PORT = Number(process.env.PORT || 64123);
const UPSTREAM = process.env.UPSTREAM || 'http://127.0.0.1:64588';
const PET_ROUTE = '/' + String(process.env.BEDROOM_PET_ROUTE || '/dsh-pet-7340').replace(/^\/+|\/+$/g, '');

const send = (res, code, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  // 页面里所有请求都带 /dsh-pet-bedroom 前缀（宿主半侧的真实前缀），
  // 预览服务器把它剥掉再匹配，这样 web/index.html 一行都不用改。
  let p = url.pathname;
  if (p === '/dsh-pet-bedroom' || p === '/dsh-pet-bedroom/') p = '/';
  else if (p.startsWith('/dsh-pet-bedroom/')) p = p.slice('/dsh-pet-bedroom'.length);

  if (p === '/' || p === '/index.html') {
    return send(res, 200, fs.readFileSync(path.join(ROOT, 'web/index.html')), 'text/html; charset=utf-8');
  }
  if (p === '/room.png' || p === '/chair.png') {
    const f = path.join(ROOT, 'assets', p.slice(1));
    if (!fs.existsSync(f)) return send(res, 404, 'missing ' + p);
    return send(res, 200, fs.readFileSync(f), 'image/png');
  }
  if (p.startsWith('/wallpaper/')) {
    // 只放行白名单里的壁纸 id（和宿主同一条规则）
    const id = p.slice('/wallpaper/'.length).replace(/\.jpg$/i, '');
    const f = path.join(ROOT, 'assets', 'wall', id + '.jpg');
    if (!/^[a-z]{2,20}$/.test(id) || !fs.existsSync(f)) return send(res, 404, 'missing wallpaper');
    return send(res, 200, fs.readFileSync(f), 'image/jpeg');
  }
  if (p.startsWith('/pet/thumb/')) {
    const rest = p.slice('/pet/thumb/'.length);
    const m = /^([^/]{1,80})\/([^/]{1,200}\.(?:webm|mov))$/i.exec(rest);
    if (!m) return send(res, 400, 'bad path');
    try {
      const r = await fetch(`${UPSTREAM}${PET_ROUTE}/thumb/${encodeURIComponent(decodeURIComponent(m[1]))}/${encodeURIComponent(decodeURIComponent(m[2]))}`);
      if (!r.ok) return send(res, r.status, 'upstream ' + r.status);
      res.writeHead(200, { 'content-type': 'video/webm', 'cache-control': 'no-store' });
      return res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      return send(res, 502, String(e.message));
    }
  }
  if (p === '/state') {
    // 预览**始终**用自己从真实 chatlog 现算的会话列表：上游可能还是旧代码
    // （没有 phone.qq，或没有 uid/avatar 字段），那样看不到头像。
    try {
      const r = await fetch(UPSTREAM + '/dsh-pet-bedroom/state');
      const j = await r.json();
      if (!j.phone) j.phone = {};
      j.phone.qq = { chats: computeChats(), source: '(preview 现算)' };
      return send(res, 200, JSON.stringify(j), 'application/json; charset=utf-8');
    } catch (e) {
      return send(res, 502, JSON.stringify({ ok: false, error: String(e.message) }), 'application/json');
    }
  }
  // 预览里也能点开会话看全文（读真实 chatlog）
  if (p === '/phone/chat') {
    const chatId = url.searchParams.get('id') || '';
    if (!/^(?:private|group):[^:]{1,40}$/.test(chatId)) {
      return send(res, 400, JSON.stringify({ ok: false, error: '会话 id 不合法' }), 'application/json');
    }
    const isGroup = chatId.startsWith('group:');
    const msgs = readAll().filter((m) => m.chatId === chatId).slice(-120)
      .map((m) => ({
        at: m.t,
        from: m.who === 'bot' ? 'me' : 'them',
        who: m.who === 'bot' ? '我' : m.who,
        uid: m.uid || '',
        avatar: m.who !== 'bot' && m.uid ? '/dsh-pet-bedroom/avatar/' + m.uid : '',
        showName: isGroup && m.who !== 'bot',
        text: m.text,
      }));
    return send(res, 200, JSON.stringify({ ok: true, chatId, messages: msgs, empty: msgs.length === 0 }), 'application/json');
  }
  // 预览里也能取真实头像（和宿主半侧同一套代理）
  const isUserAv = p.startsWith('/avatar/');
  const isGroupAv = p.startsWith('/groupavatar/');
  if (isUserAv || isGroupAv) {
    const num = decodeURIComponent(p.slice((isUserAv ? '/avatar/' : '/groupavatar/').length)).replace(/\.(?:jpg|png|webp)$/i, '');
    if (!/^\d{5,15}$/.test(num)) return send(res, 400, '号码不合法');
    const u = isUserAv
      ? 'https://q1.qlogo.cn/g?b=qq&nk=' + num + '&s=640'
      : 'https://p.qlogo.cn/gh/' + num + '/' + num + '/640';
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return send(res, 502, 'qlogo ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(200, { 'content-type': r.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=86400' });
      return res.end(buf);
    } catch (e) {
      return send(res, 502, String(e.message));
    }
  }
  if (p === '/doc' || p === '/room' || p === '/slot' || p === '/command' || p.startsWith('/phone/') || p.startsWith('/douyin/')) {
    return send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8');
  }
  return send(res, 404, 'not found: ' + p);
});

// ---- 预览里直接读聊天服务的真实聊天流水（和宿主半侧同一套逻辑）----
const CHAT_DIR =
  process.env.BEDROOM_CHAT_DIR ||
  process.env.AURABOT_DATA_DIR ||
  path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh'), 'plugins-data', 'aurabot');
const CHATLOG_DIR = path.join(CHAT_DIR, 'chatlog');

function readAll(days = 3) {
  let names = [];
  try {
    names = fs.readdirSync(CHATLOG_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-days);
  } catch { return []; }
  const out = [];
  for (const n of names) {
    let raw = '';
    try { raw = fs.readFileSync(path.join(CHATLOG_DIR, n), 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const it = JSON.parse(line);
        if (!Number.isFinite(Number(it.t))) continue;
        out.push({ t: Number(it.t), chatId: String(it.chatId || ''), who: String(it.who || ''), uid: String(it.uid || ''), text: String(it.text || '') });
      } catch { /* 单行坏了跳过 */ }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

function computeChats() {
  const all = readAll();
  const map = new Map();
  for (const m of all) {
    if (!m.chatId) continue;
    const p = map.get(m.chatId);
    if (!p) map.set(m.chatId, { chatId: m.chatId, title: m.who === 'bot' ? '' : m.who, uid: m.who === 'bot' ? '' : m.uid, lastText: m.text, lastAt: m.t, count: 1, messages: [m] });
    else {
      p.count += 1; p.messages.push(m);
      if (m.t >= p.lastAt) { p.lastAt = m.t; p.lastText = m.text; if (m.who !== 'bot') p.title = m.who; }
      if (m.who !== 'bot' && m.uid) p.uid = m.uid;
    }
  }
  return [...map.values()].map((c) => {
    const [kind, id] = c.chatId.split(':');
    const isGroup = kind === 'group';
    const last = c.messages[c.messages.length - 1];
    // 群聊：标题用群名（拿不到用群号），头像用群头像；私聊：对方昵称 + 对方头像
    const gname = isGroup ? readGroupName(id) : '';
    return {
      chatId: c.chatId, kind: isGroup ? 'group' : 'private', id: id || '',
      uid: isGroup ? '' : (c.uid || ''),
      avatar: isGroup
        ? (id ? '/dsh-pet-bedroom/groupavatar/' + id : '')
        : (c.uid ? '/dsh-pet-bedroom/avatar/' + c.uid : ''),
      title: isGroup ? (gname || ('群 ' + (id || ''))) : (c.title || id || c.chatId),
      lastText: c.lastText, lastAt: c.lastAt,
      count: c.count, unread: last && last.who !== 'bot' ? 1 : 0,
    };
  }).sort((a, b) => b.lastAt - a.lastAt);
}

/** 预览里的群名：读宿主落盘的 groupnames.json（预览连不上聊天服务内存） */
function readGroupName(gid) {
  try {
    const file = path.join(process.env.USERPROFILE || '', '.dsh', 'dsh-pet-bedroom', 'groupnames.json');
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    const v = obj && obj[String(gid)];
    return typeof v === 'string' ? v.trim() : '';
  } catch { return ''; }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`preview → http://127.0.0.1:${PORT}/`);
});

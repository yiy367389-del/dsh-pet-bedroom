import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PLAYWRIGHT_CORE || 'playwright-core';
const { chromium } = await import(PW);
const URL = process.env.BEDROOM_URL || 'http://127.0.0.1:64123/dsh-pet-bedroom/';

const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
let exe = null;
for (const d of fs.readdirSync(base).filter((x) => x.startsWith('chromium-') && !x.includes('headless'))) {
  const c = path.join(base, d, 'chrome-win', 'chrome.exe');
  if (fs.existsSync(c)) { exe = c; break; }
}

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

await page.evaluate(() => {
  const el = [...document.querySelectorAll('.ph-app')].find((a) => a.querySelector('.nm').textContent === 'QQ');
  el.click();
});
await page.waitForTimeout(2500);

const list = await page.evaluate(() => [...document.querySelectorAll('.ph-chat-item')].map((it) => {
  const img = it.querySelector('.ph-av-img');
  return {
    name: it.querySelector('.nm').textContent,
    src: img ? img.getAttribute('src') : '',
    loaded: img ? img.naturalWidth > 0 : false,
    w: img ? img.naturalWidth : 0,
  };
}));
console.log('=== 会话列表 ===');
for (const c of list) console.log('  ', JSON.stringify(c));

const grpItem = list.find((c) => c.src.includes('groupavatar'));
console.log('\n群聊用群头像接口 =', grpItem ? 'OK' : 'FAIL');
console.log('群头像真的加载了 =', grpItem && grpItem.loaded ? `OK (${grpItem.w}px)` : 'FAIL');
// 群标题不能是「某个人的昵称」。成员昵称每个人都不一样，所以从环境变量传：
//   BEDROOM_GROUP_MEMBER_NAMES="小明,小刚"  node v-group.mjs
// 不传就跳过这条（不写死任何人的名字）。
const NOT_NAMES = (process.env.BEDROOM_GROUP_MEMBER_NAMES || '').split(',').map((s) => s.trim()).filter(Boolean);
console.log('群标题不是个人昵称 =', !NOT_NAMES.length ? 'SKIP（没传 BEDROOM_GROUP_MEMBER_NAMES）'
  : (grpItem && !NOT_NAMES.includes(grpItem.name) ? `OK (${grpItem.name})` : `FAIL(${grpItem && grpItem.name})`));

// 进群聊
await page.evaluate(() => {
  const items = [...document.querySelectorAll('.ph-chat-item')];
  const g = items.find((it) => (it.querySelector('.ph-av-img') || {}).src && it.querySelector('.ph-av-img').src.includes('groupavatar'));
  (g || items[0]).click();
});
await page.waitForTimeout(2200);

const chat = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.ph-row')];
  return rows.map((r) => {
    const img = r.querySelector('.ph-av-img');
    const who = r.querySelector('.ph-who');
    return {
      side: r.classList.contains('me') ? 'me' : 'them',
      who: who ? who.textContent : '',
      avatarSrc: img ? img.getAttribute('src').replace('/dsh-pet-bedroom', '') : '',
      avatarLoaded: img ? img.naturalWidth > 0 : null,
      title: document.getElementById('phChatTitle').textContent,
    };
  });
});
console.log('\n=== 群聊消息 ===');
for (const m of chat.slice(0, 8)) console.log('  ', JSON.stringify(m));
const them = chat.filter((m) => m.side === 'them');
console.log('\n每条对方消息都标了发言人 =', them.every((m) => m.who) ? 'OK' : 'FAIL');
console.log('不同发言人用不同头像 =', new Set(them.map((m) => m.avatarSrc)).size >= 2 ? 'OK' : 'FAIL');
console.log('聊天标题是群名 =', chat[0] ? `"${chat[0].title}"` : 'n/a');

console.log('\nconsole 错误 =', errs.length ? errs.slice(0, 3) : '无');
await browser.close();

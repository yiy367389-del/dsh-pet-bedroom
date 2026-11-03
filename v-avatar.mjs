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

// 进 QQ
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.ph-app')].find((a) => a.querySelector('.nm').textContent === 'QQ');
  el.click();
});
await page.waitForTimeout(2000);

// 会话列表头像：img 是否真的加载出像素
const listAvatars = await page.evaluate(() => {
  return [...document.querySelectorAll('.ph-chat-item')].map((it) => {
    const img = it.querySelector('.ph-av-img');
    const fb = it.querySelector('.ph-av-fb');
    return {
      name: it.querySelector('.nm').textContent,
      hasImg: Boolean(img),
      src: img ? img.getAttribute('src') : '',
      // naturalWidth > 0 才说明图真的下载并解码成功
      loaded: img ? img.naturalWidth > 0 : false,
      w: img ? img.naturalWidth : 0,
      h: img ? img.naturalHeight : 0,
      fbVisible: fb ? getComputedStyle(fb).display !== 'none' : null,
    };
  });
});
console.log('会话列表头像 =');
for (const a of listAvatars) console.log('  ', JSON.stringify(a));

// 进聊天
await page.evaluate(() => document.querySelector('.ph-chat-item').click());
await page.waitForTimeout(2000);

const chatAvatars = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.ph-row')];
  return rows.slice(0, 6).map((r) => {
    const img = r.querySelector('.ph-av-img');
    return {
      side: r.classList.contains('me') ? 'me' : 'them',
      hasAvatar: Boolean(r.querySelector('.ph-rowav')),
      loaded: img ? img.naturalWidth > 0 : null,
      w: img ? img.naturalWidth : 0,
    };
  });
});
console.log('\n聊天气泡头像 =');
for (const a of chatAvatars) console.log('  ', JSON.stringify(a));

const themWithAvatar = chatAvatars.filter((a) => a.side === 'them' && a.hasAvatar && a.loaded);
const meWithout = chatAvatars.filter((a) => a.side === 'me' && !a.hasAvatar);
console.log('\n对方消息带头像且加载成功 =', themWithAvatar.length, '条');
console.log('自己那侧不摆头像 =', meWithout.length, '条');
console.log('console 错误 =', errs.length ? errs.slice(0, 3) : '无');

await browser.close();

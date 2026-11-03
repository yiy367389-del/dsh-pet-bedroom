import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PLAYWRIGHT_CORE || 'playwright-core';
const { chromium } = await import(PW);
const URL = process.env.BEDROOM_URL || 'http://127.0.0.1:64123/dsh-pet-bedroom/';
const OUT = path.join(import.meta.dirname, '_dial');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

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

// ---- 1. dock 有四个图标 ----
const dock = await page.evaluate(() => [...document.querySelectorAll('#phDock .ph-app')].map((a) => ({
  name: a.querySelector('.nm').textContent,
  live: a.classList.contains('live'),
  off: a.classList.contains('off'),
})));
console.log('=== 底部 dock ===');
for (const d of dock) console.log('  ', JSON.stringify(d));
console.log('  四个图标 =', dock.length === 4 ? 'OK' : `FAIL(${dock.length})`);
console.log('  只有拨号可点 =', dock.filter((d) => d.live).map((d) => d.name).join(',') === '拨号' ? 'OK' : 'FAIL');

// ---- 2. 点「浏览器」应点不开 ----
await page.evaluate(() => {
  const el = [...document.querySelectorAll('#phDock .ph-app')].find((a) => a.querySelector('.nm').textContent === '浏览器');
  el.click();
});
await page.waitForTimeout(600);
const afterBrowser = await page.evaluate(() => ({
  home: getComputedStyle(document.getElementById('phHome')).display !== 'none',
  dialOn: document.getElementById('phDial').classList.contains('on'),
  bubble: (document.getElementById('bubble') || {}).textContent || '',
}));
console.log('\n点浏览器后 =', JSON.stringify(afterBrowser), '（应仍在桌面、拨号没开）');

// ---- 3. 点「拨号」应打开 ----
await page.evaluate(() => {
  const el = [...document.querySelectorAll('#phDock .ph-app')].find((a) => a.querySelector('.nm').textContent === '拨号');
  el.click();
});
await page.waitForTimeout(1000);
const dial = await page.evaluate(() => ({
  on: document.getElementById('phDial').classList.contains('on'),
  keys: document.querySelectorAll('#phKeys .ph-key').length,
  keyLabels: [...document.querySelectorAll('#phKeys .ph-key .d')].map((x) => x.textContent).join(''),
  placeholder: document.getElementById('phNumShow').textContent,
  contacts: [...document.querySelectorAll('#phContacts .ph-contact')].map((c) => ({
    name: c.querySelector('.nm').textContent,
    qq: c.querySelector('.qq').textContent,
    hasAvatar: Boolean(c.querySelector('.ph-av-img')),
  })),
}));
console.log('\n=== 拨号界面 ===');
console.log('  已打开 =', dial.on ? 'OK' : 'FAIL');
console.log('  键盘按键 =', dial.keys, '(', dial.keyLabels, ')');
console.log('  初始提示 =', JSON.stringify(dial.placeholder));
console.log('  联系人 =', dial.contacts.length, '个');
for (const c of dial.contacts) console.log('    ', JSON.stringify(c));

// ---- 4. 按键 + 删除 + 呼叫 ----
await page.evaluate(() => {
  const keys = [...document.querySelectorAll('#phKeys .ph-key')];
  for (const ch of ['1', '2', '3']) {
    const k = keys.find((x) => x.querySelector('.d').textContent === ch);
    if (k) k.click();
  }
});
await page.waitForTimeout(400);
const typed = await page.evaluate(() => document.getElementById('phNumShow').textContent);
console.log('\n按 1 2 3 →', JSON.stringify(typed), typed === '123' ? 'OK' : 'FAIL');

await page.evaluate(() => document.getElementById('phDelBtn').click());
await page.waitForTimeout(300);
const afterDel = await page.evaluate(() => document.getElementById('phNumShow').textContent);
console.log('删一位 →', JSON.stringify(afterDel), afterDel === '12' ? 'OK' : 'FAIL');

await page.evaluate(() => document.getElementById('phCallBtn').click());
await page.waitForTimeout(600);
const called = await page.evaluate(() => (document.getElementById('bubble') || {}).textContent || '');
console.log('点呼叫 →', JSON.stringify(called));

// ---- 5. 点联系人应填入号码 ----
await page.evaluate(() => {
  const c = document.querySelector('#phContacts .ph-contact');
  if (c) c.click();
});
await page.waitForTimeout(400);
const filled = await page.evaluate(() => document.getElementById('phNumShow').textContent);
const firstQQ = dial.contacts[0] ? dial.contacts[0].qq : '';
console.log('点第一个联系人 → 号码框 =', JSON.stringify(filled), filled === firstQQ ? 'OK（就是他的 QQ 号）' : `FAIL(期望 ${firstQQ})`);

// ---- 6. 返回桌面 ----
await page.evaluate(() => document.getElementById('phDialBack').click());
await page.waitForTimeout(400);
const back = await page.evaluate(() => ({
  home: getComputedStyle(document.getElementById('phHome')).display !== 'none',
  dialOn: document.getElementById('phDial').classList.contains('on'),
}));
console.log('\n返回桌面 =', JSON.stringify(back));

// 布局：拨号界面不该溢出手机屏
const geo = await page.evaluate(() => {
  const scr = document.querySelector('.phone-screen').getBoundingClientRect();
  const dial = document.getElementById('phDial');
  return { scrW: Math.round(scr.width), scrH: Math.round(scr.height), dialScrollH: dial.scrollHeight, dialClientH: dial.clientHeight };
});
console.log('\n拨号界面尺寸 =', JSON.stringify(geo), geo.dialScrollH <= geo.dialClientH + 2 ? '（不溢出）' : '（有滚动，可能偏挤）');

console.log('\nconsole 错误 =', errs.length ? errs.slice(0, 3) : '无');
await browser.close();

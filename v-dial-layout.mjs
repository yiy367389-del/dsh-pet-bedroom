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
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

await page.evaluate(() => {
  const el = [...document.querySelectorAll('#phDock .ph-app')].find((a) => a.querySelector('.nm').textContent === '拨号');
  el.click();
});
await page.waitForTimeout(1200);

const geo = await page.evaluate(() => {
  const scr = document.querySelector('.phone-screen').getBoundingClientRect();
  const dial = document.getElementById('phDial');
  const keys = document.getElementById('phKeys').getBoundingClientRect();
  const contacts = document.getElementById('phContacts').getBoundingClientRect();
  const call = document.getElementById('phCallBtn').getBoundingClientRect();
  const num = document.getElementById('phNumShow').getBoundingClientRect();
  return {
    screen: { w: Math.round(scr.width), h: Math.round(scr.height) },
    dial: { scrollH: dial.scrollHeight, clientH: dial.clientHeight },
    // 各块是否都在手机屏内
    keysBottom: Math.round(keys.bottom - scr.top),
    callBottom: Math.round(call.bottom - scr.top),
    numBottom: Math.round(num.bottom - scr.top),
    contactsTop: Math.round(contacts.top - scr.top),
    contactsBottom: Math.round(contacts.bottom - scr.top),
    withinScreen: keys.bottom <= scr.bottom + 1 && call.bottom <= scr.bottom + 1 && contacts.bottom <= scr.bottom + 1,
    // 键盘没被挤压
    keyCount: document.querySelectorAll('#phKeys .ph-key').length,
    keyH: Math.round(document.querySelector('#phKeys .ph-key').getBoundingClientRect().height),
    // 联系人区还有多少可视高度
    contactsVisibleH: Math.round(contacts.height),
  };
});
console.log('拨号布局 =', JSON.stringify(geo, null, 0));
console.log('全部在手机屏内 =', geo.withinScreen ? 'OK' : 'FAIL');
console.log('键盘按键高度 =', geo.keyH + 'px', geo.keyH >= 26 ? '（可点）' : '（太扁）');
console.log('联系人可视高度 =', geo.contactsVisibleH + 'px', geo.contactsVisibleH >= 60 ? 'OK' : '（太窄）');

await browser.close();

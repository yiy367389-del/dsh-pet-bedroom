import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PLAYWRIGHT_CORE || 'playwright-core';
const { chromium } = await import(PW);
const URL = process.env.BEDROOM_URL || 'http://127.0.0.1:64123/dsh-pet-bedroom/';
const OUT = path.join(import.meta.dirname, '_rc');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
let exe = null;
for (const d of fs.readdirSync(base).filter((x) => x.startsWith('chromium-') && !x.includes('headless'))) {
  const c = path.join(base, d, 'chrome-win', 'chrome.exe');
  if (fs.existsSync(c)) { exe = c; break; }
}

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 8 });
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2200);

// 打开拨号，把每一层都涂成不同亮色——任何一层从圆角里漏出来都会被看见
await page.evaluate(() => {
  [...document.querySelectorAll('#phDock .ph-app')].find((a) => a.querySelector('.nm').textContent === '拨号').click();
});
await page.waitForTimeout(400);
// 真实点一个数字（用户报的场景：点数字之后变直角）
const key = await page.$('#phKeys .ph-key');
const kb = await key.boundingBox();
await page.mouse.click(kb.x + kb.width / 2, kb.y + kb.height / 2);
await page.waitForTimeout(400);

// 各层分别着色，验证「每层自己带圆角」
await page.evaluate(() => {
  document.querySelector('.ph-dial').style.background = '#ff0000';
  document.querySelector('.ph-contacts').style.background = '#00ff00';
});
await page.waitForTimeout(300);

const geo = await page.evaluate(() => {
  const q = (s) => {
    const el = document.querySelector(s);
    const cs = getComputedStyle(el);
    return { radius: cs.borderRadius, clip: cs.clipPath, overflow: cs.overflow };
  };
  return {
    screen: q('.phone-screen'),
    body: q('.phone-body'),
    home: q('.ph-home'),
    dial: q('.ph-dial'),
    qq: q('.ph-qq'),
    chat: q('.ph-chat'),
  };
});
console.log('=== 每层自己的圆角 ===');
for (const [k, v] of Object.entries(geo)) {
  console.log(`  ${k.padEnd(7)} radius=${v.radius.padEnd(7)} clip=${v.clip.padEnd(24)} overflow=${v.overflow}`);
}

const num = await page.evaluate(() => document.getElementById('phNumShow').textContent);
console.log('\n号码框 =', JSON.stringify(num), '（应已输入一位）');

const el = await page.$('.phone-body');
fs.writeFileSync(path.join(OUT, 'dial-corner.png'), await el.screenshot());
await browser.close();
console.log('saved');

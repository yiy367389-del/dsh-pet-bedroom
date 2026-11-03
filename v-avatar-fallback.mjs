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
await page.waitForTimeout(2500);

// 拦掉所有 /avatar/ 请求，模拟「头像取不到」
await page.route('**/avatar/**', (route) => route.abort());
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.ph-app')].find((a) => a.querySelector('.nm').textContent === 'QQ');
  el.click();
});
await page.waitForTimeout(2500);

const fallback = await page.evaluate(() => {
  return [...document.querySelectorAll('.ph-chat-item')].map((it) => {
    const img = it.querySelector('.ph-av-img');
    const fb = it.querySelector('.ph-av-fb');
    return {
      name: it.querySelector('.nm').textContent,
      imgBroken: img ? img.naturalWidth === 0 : null,
      imgHidden: img ? getComputedStyle(img).display === 'none' : null,
      fbVisible: fb ? getComputedStyle(fb).display !== 'none' : null,
      fbText: fb ? fb.textContent : '',
      // 头像框里不能出现「图 + 字」叠在一起
      avatarBoxChildrenVisible: [...(it.querySelector('.ph-av') || { children: [] }).children]
        .filter((c) => getComputedStyle(c).display !== 'none').length,
    };
  });
});

console.log('=== 头像取不到时（拦截 /avatar/）===');
for (const f of fallback) console.log('  ', JSON.stringify(f));
const allOk = fallback.every((f) => f.fbVisible && f.fbText && f.avatarBoxChildrenVisible === 1);
console.log('\n每个头像框只显示一个元素（首字母兜底）=', allOk ? 'OK' : 'FAIL');

await browser.close();

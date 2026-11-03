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

console.log('=== 头像取不到时（只拦截 /avatar/，群头像不拦）===');
for (const f of fallback) console.log('  ', JSON.stringify(f));
// 正确口径：每个头像框**始终只显示一个元素**；只对「图真的加载失败」的那些，
// 要求首字母兜底可见。群头像走另一条路由、没被拦截，不该要求兜底。
const oneChild = fallback.every((f) => f.avatarBoxChildrenVisible === 1);
const fallbackOk = fallback.every((f) => !f.imgBroken || (f.fbVisible && Boolean(f.fbText)));
const exercised = fallback.some((f) => f.imgBroken && f.fbVisible);
console.log('每个头像框只显示一个元素 =', oneChild ? 'OK' : 'FAIL');
console.log('加载失败的头像都有首字母兜底 =', fallbackOk ? 'OK' : 'FAIL');
console.log('至少验证到一个失败头像 =', exercised ? 'OK' : `SKIP（本次数据里没有失败头像，共 ${fallback.length} 个）`);

await browser.close();

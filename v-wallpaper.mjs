import path from 'node:path';
import fs from 'node:fs';

const PW = process.env.PLAYWRIGHT_CORE || 'playwright-core';
const { chromium } = await import(PW);
const URL = process.env.BEDROOM_URL || 'http://127.0.0.1:64123/dsh-pet-bedroom/';
const OUT = path.join(import.meta.dirname, '_wpv');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
let exe = null;
for (const d of fs.readdirSync(base).filter((x) => x.startsWith('chromium-') && !x.includes('headless'))) {
  const c = path.join(base, d, 'chrome-win', 'chrome.exe');
  if (fs.existsSync(c)) { exe = c; break; }
}

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 4 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

// 上游 DSH 可能还是旧代码（/state 没有 wallpaper 字段），
// 这里拦截 /state 补上字段，只测**前端**渲染与切换逻辑本身。
// 关键：mock 必须记住 POST 过的壁纸，否则页面 2.5s 一次的 refresh
// 会把壁纸拉回初值——那是测试假象，不是产品 bug（这个坑踩过一次）。
const WALLS = [
  { id: 'pine', file: 'pine.jpg', label: '松林', tone: '深绿' },
  { id: 'azure', file: 'azure.jpg', label: '晴空', tone: '蓝' },
  { id: 'haze', file: 'haze.jpg', label: '雾白', tone: '灰白' },
  { id: 'dusk', file: 'dusk.jpg', label: '暮色', tone: '紫蓝带橙' },
];
let mockWall = 'pine';
await page.route('**/dsh-pet-bedroom/state', async (route) => {
  const res = await route.fetch();
  const j = await res.json();
  if (!j.room) j.room = {};
  j.room.wallpaper = mockWall;
  j.room.wallpaperList = WALLS;
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) });
});
await page.route('**/dsh-pet-bedroom/room', async (route) => {
  try {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.wallpaper) mockWall = body.wallpaper;
  } catch { /* ignore */ }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
});

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2500);

const read = () => page.evaluate(() => {
  const el = document.getElementById('phWall');
  const cs = getComputedStyle(el);
  const scr = document.querySelector('.phone-screen');
  const home = document.getElementById('phHome');
  return {
    bg: cs.backgroundImage.replace(/^url\("?.*\/wallpaper\//, '').replace(/"?\)$/, ''),
    size: cs.backgroundSize,
    pos: cs.backgroundPosition,
    zIndex: cs.zIndex,
    homeRadius: getComputedStyle(home).borderRadius,
    homeClip: getComputedStyle(home).clipPath,
    scrRadius: getComputedStyle(scr).borderRadius,
    wallBox: el.getBoundingClientRect().toJSON(),
    homeBox: home.getBoundingClientRect().toJSON(),
  };
});

console.log('=== 壁纸应用 ===');
console.log(JSON.stringify(await read(), null, 2));

// 壁纸图真的加载了吗（用 Image 探一次）
const loaded = await page.evaluate(async () => {
  const el = document.getElementById('phWall');
  const m = /url\("?(.*?)"?\)/.exec(getComputedStyle(el).backgroundImage);
  if (!m) return { ok: false, why: 'no url' };
  const img = new Image();
  const p = new Promise((res) => {
    img.onload = () => res({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => res({ ok: false, why: 'onerror' });
  });
  img.src = m[1];
  return p;
});
console.log('壁纸图加载 =', JSON.stringify(loaded));

// 长按桌面 → 换下一张
const home = await page.$('#phHome');
const box = await home.boundingBox();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
await page.mouse.down();
await page.waitForTimeout(750);
await page.mouse.up();
await page.waitForTimeout(900);

const after = await read();
console.log('\n=== 长按后 ===');
console.log('bg =', after.bg);

// 再长按三次，应该循环回 pine
for (let i = 0; i < 3; i++) {
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
  await page.waitForTimeout(800);
}
const cycled = await read();
console.log('循环一圈后 bg =', cycled.bg);

// 点图标不该换壁纸
const beforeClick = (await read()).bg;
await page.evaluate(() => {
  [...document.querySelectorAll('#phDock .ph-app')].find((a) => a.querySelector('.nm').textContent === '拨号').click();
});
await page.waitForTimeout(800);
const afterClick = (await read()).bg;
console.log('点图标后壁纸不变 =', beforeClick === afterClick ? 'OK' : `FAIL(${beforeClick}->${afterClick})`);

// 圆角：壁纸层被桌面层的圆角裁掉
console.log('\n=== 圆角 ===');
console.log('home borderRadius =', cycled.homeRadius, '| clipPath =', cycled.homeClip, '| screen =', cycled.scrRadius);
const same = cycled.homeBox;
console.log('壁纸层与桌面层同框 =', Math.abs(cycled.wallBox.width - same.width) < 0.6 && Math.abs(cycled.wallBox.height - same.height) < 0.6 ? 'OK' : 'FAIL');

await page.evaluate(() => {
  [...document.querySelectorAll('#phDock .ph-app')].find((a) => a.querySelector('.nm').textContent === '拨号').click();
});
await page.waitForTimeout(300);
await page.evaluate(() => document.getElementById('phDialBack').click());
await page.waitForTimeout(300);
const el = await page.$('.phone-body');
await el.screenshot({ path: path.join(OUT, 'wall.png') });

console.log('\nconsole 错误 =', errs.length ? errs.slice(0, 3) : '无');
await browser.close();

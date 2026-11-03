/**
 * v3 冒烟：独立网页版。
 * 验证网页 / 房间图 / API / 日记真读 / 路径逃逸，全部在临时库里跑，不碰真实记忆库。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bedroom-v3-'));
process.env.DSH_HOME = path.join(tmp, 'dsh-home');
process.env.BEDROOM_VAULT_DIR = path.join(tmp, 'vault');
fs.mkdirSync(path.join(process.env.BEDROOM_VAULT_DIR, '20-日记'), { recursive: true });

const { apply, name } = await import('./index.js?v=' + Date.now());

const routes = [];
const tools = new Map();
const ctx = {
  logger: { info() {}, warn() {} },
  webServer: { getOrigin: () => 'http://127.0.0.1:50062', register: (r) => (routes.push(r), () => {}) },
  effect: (fn) => (fn(), () => {}),
  on: () => () => {},
  get: (n) => (n === 'tools' ? { register: (d) => (tools.set(d.name, d), () => {}) } : undefined),
};
apply(ctx, {});

console.log('name =', name, '| 路由 =', routes.map((r) => r.kind + ' ' + r.path).join(','));
console.log('工具 =', [...tools.keys()].join(', '));

const mkRes = () => {
  const chunks = [];
  return {
    status: 0,
    headers: {},
    chunks,
    writeHead(s, hd) {
      this.status = s;
      this.headers = hd || {};
      return this;
    },
    end(d) {
      if (d !== undefined) chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d)));
    },
    get body() {
      return Buffer.concat(chunks);
    },
    get text() {
      return this.body.toString('utf8');
    },
  };
};

const route = routes[0];
async function call(p, method = 'GET', body) {
  const res = mkRes();
  const buf = Buffer.from(body ?? '', 'utf8');
  await route.handler(
    {
      url: '/dsh-pet-bedroom' + p,
      method,
      headers: { host: '127.0.0.1:50062' },
      async *[Symbol.asyncIterator]() {
        if (buf.length) yield buf;
      },
    },
    res,
  );
  return res;
}

console.log('\n===== 1. 网页本身 =====');
const page = await call('/');
console.log('GET / →', page.status, page.headers['content-type'], page.body.length, 'bytes');
const html = page.text;
const checks = {
  '有房间图 img': html.includes('src="./room.png"'),
  '有桌宠 video': html.includes('<video id="video"'),
  '有时辰切换': html.includes('segTime'),
  '有天气切换': html.includes('segWeather'),
  '有家具热点': html.includes('SPOTS'),
  '没有全屏遮罩 backdrop': !html.includes('pb-backdrop'),
};
for (const [k, v] of Object.entries(checks)) console.log(' ', v ? 'OK ' : 'FAIL', k);

console.log('\n===== 2. 房间图 =====');
const img = await call('/room.png');
console.log('GET /room.png →', img.status, img.headers['content-type'], img.body.length, 'bytes');
const isPng = img.body.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
console.log('  PNG 魔数正确 =', isPng);

console.log('\n===== 2b. 手机壁纸（真实照片，白名单）=====');
for (const id of ['pine', 'azure', 'haze', 'dusk']) {
  const w = await call('/wallpaper/' + id + '.jpg');
  const isJpg = w.body.slice(0, 2).equals(Buffer.from([0xff, 0xd8]));
  console.log(`  /wallpaper/${id}.jpg → ${w.status} ${w.headers['content-type']} ${w.body.length}B JPEG=${isJpg}`);
}
// 注意：HTTP 客户端会把 /wallpaper/../../index.js 规范化成 /index.js，
// 那样测的就不是壁纸路由了。用百分号编码让 ../ 真的到达服务器。
const badWall = await call('/wallpaper/%2e%2e%2f%2e%2e%2findex.js');
console.log('  路径逃逸（编码的 ../）→', badWall.status, '（应 404/400）');
const noWall = await call('/wallpaper/nope.jpg');
console.log('  白名单外 nope.jpg →', noWall.status, '（应 404）');

// 换壁纸：工具换 + POST 换，都要真的落盘
const wallTool = await tools.get('bedroom_wallpaper').execute({});
console.log('  工具列清单 =', wallTool.ok, '共', (wallTool.options || []).length, '张，当前', wallTool.now);
const wallSet = await tools.get('bedroom_wallpaper').execute({ id: 'azure' });
console.log('  工具换成 azure =', wallSet.ok, '→', wallSet.now);
const wallBad = await tools.get('bedroom_wallpaper').execute({ id: 'nope' });
console.log('  换成不存在的 =', wallBad.ok, '（应 false）');
const wallPost = await call('/room', 'POST', JSON.stringify({ wallpaper: 'dusk' }));
const wallState = JSON.parse((await call('/state')).text);
console.log('  POST 换成 dusk → /state 里 =', wallState.room.wallpaper, wallState.room.wallpaper === 'dusk' ? 'OK' : 'FAIL');
console.log('  /state 带壁纸清单 =', (wallState.room.wallpaperList || []).length, '张');

console.log('\n===== 3. 隔离确认 + 状态 =====');
const st = await call('/state');
const j = JSON.parse(st.text);
if (!String(j.room.vaultDir).startsWith(tmp)) {
  console.error('!! 库路径不在临时目录，中止：', j.room.vaultDir);
  process.exit(2);
}
console.log('（隔离确认）库 =', j.room.vaultDir);
console.log('room =', JSON.stringify({ time: j.room.time, weather: j.room.weather, auto: j.room.timeAuto }));

console.log('\n===== 4. 日记来自 Aurabot / 笔记来自记忆库 =====');
// 日记现在由 Aurabot 提供：给它一个隔离的 data 目录 + 一条假日记，验证卧室真读它
const auraDir = path.join(tmp, 'aurabot');
fs.mkdirSync(auraDir, { recursive: true });
process.env.AURABOT_DATA_DIR = auraDir;
const nowMs = Date.now();
fs.writeFileSync(
  path.join(auraDir, 'diary.json'),
  JSON.stringify({
    plan: { day: '', times: [], done: [] },
    history: [
      { at: nowMs - 3600_000, text: '今天把房间换成了这张图，云从窗外慢慢走过去。', ok: true, visibility: 'all' },
      { at: nowMs, text: '晚上又写了一篇：被子是蓝鲸花纹，躺着很舒服。', ok: true, visibility: 'all' },
    ],
  }),
  'utf8',
);
const writeDiaryRes = await tools.get('bedroom_write').execute({ what: 'diary', content: '不该写进去' });
await tools.get('bedroom_write').execute({ what: 'notes', name: '云海观察笔记', content: '云是会走的，下午最厚。' });
const st2 = JSON.parse((await call('/state')).text);
console.log('日记 =', st2.docs.diary.length, '| 笔记 =', st2.docs.notes.length);
console.log('最新日记摘要 =', JSON.stringify(st2.docs.latestDiary.preview));
console.log('同一天两篇 → 篇数 =', st2.docs.latestDiary.count, '（应聚合为 1 天 / 2 篇）');
console.log('代写日记被拒 =', writeDiaryRes.ok === false, '|', String(writeDiaryRes.error).slice(0, 40));

const day = st2.docs.latestDiary.date;
const docRes = await call('/doc?kind=diary&name=' + encodeURIComponent(day));
const docBody = JSON.parse(docRes.text);
console.log('读当天全文 →', docRes.status, '| 含两篇的时间小标题 =', /## \d{2}:\d{2}/.test(docBody.content || ''));

console.log('\n===== 5. 路径逃逸 =====');
for (const q of ['../../../../etc/passwd', '../outside/secret.md']) {
  const r = await call('/doc?kind=notes&name=' + encodeURIComponent(q));
  console.log(' ', q.slice(0, 24), '→', r.status, JSON.parse(r.text).error);
}

console.log('\n===== 6. 时辰 / 天气 =====');
await call('/room', 'POST', JSON.stringify({ weather: 'snow', time: 'night' }));
const st3 = JSON.parse((await call('/state')).text);
console.log('现在 =', st3.room.weather, '/', st3.room.time, '| auto =', st3.room.timeAuto);

console.log('\n===== 7. 非本机来源必须被拒 =====');
const bad = mkRes();
await route.handler({ url: '/dsh-pet-bedroom/', method: 'GET', headers: { host: '10.0.0.5:8080' } }, bad);
console.log('外部 host →', bad.status);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nV3 SMOKE DONE（临时目录已清理）');

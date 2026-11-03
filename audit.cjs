const fs = require('fs');
const { execFileSync } = require('child_process');
const h = fs.readFileSync('web/index.html', 'utf8');
const host = fs.readFileSync('index.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const patch = fs.readFileSync('cordis.patch.yml', 'utf8');
const shotsRaw = JSON.parse(fs.readFileSync('screenshots.json', 'utf8'));
const shots = Array.isArray(shotsRaw) ? shotsRaw : shotsRaw.screenshots;
const readme = fs.readFileSync('README.md', 'utf8');
const entry = fs.readFileSync('.github/awesome-plugin-entry.yml', 'utf8');

// 仓库地址必须和 origin 一致：owner 写错会让 README / Release / 收录条目里所有链接 404
const ownerOf = (url) => (String(url).match(/github\.com[/:]([^/]+)\//) || [])[1] || '';
let remoteOwner = '';
try {
  remoteOwner = ownerOf(execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim());
} catch {
  remoteOwner = '';
}
const repoOwner = ownerOf(pkg?.repository?.url);
const ALLOWED_FOREIGN = new Set(['awesome-dsh-plugin', 'dsh-market', 'deepseek-ai']);
const readmeOwners = [...new Set([...readme.matchAll(/github\.com\/([A-Za-z0-9-]+)\//g)].map((m) => m[1]))]
  .filter((o) => o !== repoOwner && !ALLOWED_FOREIGN.has(o));

// 1) 抽出 <script> 内容做语法检查（用 Function 构造器解析，不执行）
const m = h.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.log('FAIL 找不到 script'); process.exit(1); }
try {
  new Function(m[1]);
  console.log('OK   script 语法通过');
} catch (e) {
  console.log('FAIL script 语法错误:', e.message);
  process.exit(1);
}

// 2) 姿态里**不允许再出现 scale**：那正是「不同交互尺寸不统一」的根因
const poseBlocks = [...h.matchAll(/\.pet\.(sit|back|lie|lean)[^{]*\{([\s\S]*?)\}/g)];
const poseHasScale = poseBlocks.filter(([, , body]) => /transform:[^;]*scale\(/.test(body));

// 容器宽度必须是**字面常量**（不是含 depth 的表达式），否则尺寸又会随位置变
const widthMatch = /const widthPct = ([\d.]+);/.exec(h);
const widthPct = widthMatch ? Number(widthMatch[1]) : NaN;
// widthPct 已经是「占舞台宽的百分比」，角色实体只占画布宽的 33.8%
const charPct = widthPct * 0.338;

const checks = {
  // ---- 收录 / 发版形态（awesome-dsh-plugin 指南）----
  'package.json 声明 dsh.bundle.patch': pkg?.dsh?.bundle?.patch === './cordis.patch.yml',
  'cordis.patch.yml 有 insert 与唯一条目 id': /insert:/.test(patch) && /id: dsh-pet-bedroom/.test(patch),
  'package.json 有 GitHub repository': /github\.com\/[^/]+\/dsh-pet-bedroom/.test(String(pkg?.repository?.url || '')),
  '仓库 owner 与 origin 一致': Boolean(repoOwner) && (!remoteOwner || repoOwner === remoteOwner),
  'README 只指向本仓库与允许的外链': readmeOwners.length === 0,
  '收录条目 url/icon/tarball 同 owner': [entry]
    .map((t) => t.split(/\r?\n/).filter((line) => !line.trim().startsWith('#')).join('\n'))
    .every((t) => [...t.matchAll(/https:\/\/[^\s]*github\.com\/([A-Za-z0-9-]+)\//g)].every((m) => m[1] === repoOwner)),
  '截图清单 1–8 张且文件都在': Array.isArray(shots) && shots.length >= 1 && shots.length <= 8 && shots.every((p) => fs.existsSync(p)),
  '市场图标是位图（不是 SVG）': fs.existsSync('assets/icon-180.png'),
  'release.mjs 使用固定资产名': /dsh-pet-bedroom\.tgz/.test(fs.readFileSync('release.mjs', 'utf8')),
  '发版工作流存在且推 tag 触发': /tags:\s*[\s\S]*v\*/.test(fs.readFileSync('.github/workflows/release.yml', 'utf8')),

  '容器宽度是字面常量（不随进深变）': Boolean(widthMatch),
  [`角色约占舞台 ${charPct.toFixed(1)}%（目标 14%）`]: Math.abs(charPct - 14) <= 0.6,
  '没有 depth 造成的缩放': !h.includes('66 + depth * 6'),
  '姿态里不再出现 scale()': poseHasScale.length === 0,
  '躺姿头朝右（正角度 72deg）': /\.pet\.lie video\{[\s\S]*?rotate\(72deg\)/.test(h),
  '躺姿不再 scaleX 镜像': !/\.pet\.lie video\{[\s\S]*?scaleX\(/.test(h),
  '背面不再 scaleX 翻转': !h.includes('scaleX(-1)'),
  '背面不裁下半身': !h.includes('clip-path:inset(0 0 26% 0)'),
  '接入 rotate 360 动作': h.includes('/360/'),
  'anims.spin 定义': h.includes('spin:'),
  '背面靠定格帧实现': h.includes('BACK_FRAME_T'),
  '椅子前景层存在': h.includes('id="chairFront"'),
  '椅子层坐标写死（配准值）': h.includes('left:70.833%'),
  '椅子层跟随时辰色调': /\.chair-front \.tint\{[\s\S]*?mask-image:url\(\.\/chair\.png\)/.test(h),
  '椅子层 z-index 高于桌宠': /\.chair-front\{[\s\S]*?z-index:150/.test(h),
  '椅子层只在 back 时出现': h.includes("chairFrontEl.classList.toggle('on', !!back)"),
  '宿主侧放行 chair.png': host.includes("p === '/chair.png'"),

  // ---- 抖音：走可配置的后端（默认适配 Aurabot「现在刷一轮」）----
  // 卧室只打后端 HTTP 接口：POST <douyinApiBase>/douyin/run、GET .../douyin/state。
  // 原来 dsh-douyin-browser-local 那条路已作废。
  '抖音打后端的 /douyin/run': (() => {
    const code = host.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    return /douyinBase\(\)/.test(code) && /'\/douyin\/run'/.test(code);
  })(),
  '抖音状态读后端 /douyin/state': /'\/douyin\/state'/.test(host),
  '抖音地址可配置（douyinApiBase）': /config\.douyinApiBase/.test(host) && /douyinApiBase\(\)/.test(host),
  '专用浏览器那条路已作废': (() => {
    const code = host.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    return !/api\/douyin-browser/.test(code) && !/watch\/start/.test(code) && !/douyinToken/.test(code);
  })(),
  '卧室按钮文案 = 现在刷一轮': /id="btnDouyin"[^>]*>现在刷一轮</.test(h),
  '停不了就如实说（不假装按停）': /卧室停不了它/.test(host),

  // ---- 显示浏览器窗口：用户要求回退掉了，这里盯着别再回来 ----
  '没有显示浏览器按钮（已回退）': !h.includes('btnWin') && !h.includes('显示浏览器'),
  '没有 /douyin/window 路由（已回退）': !host.includes('/douyin/window') && !host.includes('showDouyinWindow'),

  // ---- 手机：真实 QQ 界面 ----
  '手机有四个 App 图标': /id: 'qq'/.test(h) && /id: 'douyin'/.test(h) && /id: 'wechat'/.test(h) && /id: 'heybox'/.test(h),
  '只有 QQ 可点开': /id: 'qq',\s*name: 'QQ'[^}]*live: true/.test(h) && /id: 'douyin'[^}]*live: false/.test(h),
  'QQ 读真实聊天流水': /chatlog/.test(host) && /readChatlog/.test(host),
  '会话列表接口': /listChats/.test(host),
  '点开会话读全文接口': /p === '\/phone\/chat'/.test(host),
  '会话 id 有白名单校验': /\^\(\?:private\|group\):/.test(host),
  'QQ 消息不走去手机（直接执行命令）': !/手机响了/.test(h),

  // ---- 手机底部 dock：拨号 / 浏览器 / 相机 / 信息，只有拨号能真点开 ----
  'dock 有四个图标': (() => {
    const m = /const DOCK = \[([\s\S]*?)\];/.exec(h);
    if (!m) return false;
    return ['dial', 'browser', 'camera', 'message'].every((id) => new RegExp("id: '" + id + "'").test(m[1]));
  })(),
  'dock 只有拨号 live': (() => {
    const m = /const DOCK = \[([\s\S]*?)\];/.exec(h);
    if (!m) return false;
    const live = [...m[1].matchAll(/id: '([a-z]+)'[^}]*?live: true/g)].map((x) => x[1]);
    return live.length === 1 && live[0] === 'dial';
  })(),
  'dock 画在 phDock 上': h.includes("paintApps($('phDock'), DOCK"),
  '拨号界面容器': h.includes('id="phDial"'),
  '拨号键盘 12 键': (() => {
    const m = /const KEYS = \[([\s\S]*?)\];/.exec(h);
    if (!m) return false;
    const keys = [...m[1].matchAll(/'([0-9*#])'/g)].map((x) => x[1]);
    return keys.length === 12 && ['*', '0', '#'].every((k) => keys.includes(k));
  })(),
  '拨号键盘真渲染': h.includes('renderKeys()') && h.includes('paintNumber()'),
  '联系人来自 QQ 好友': /const phoneContacts = \(\) => phChats\.filter\(\(c\) => c\.kind === 'private'\)/.test(h),
  '联系人真渲染': h.includes('renderContacts()'),
  '拨号界面能开关': h.includes("phShow('dial')") && h.includes("$('phDialBack').addEventListener"),
  '拨号界面不真打出去': h.includes('这台手机打不出去'),
  '拨号界面在 phShow 里收放': /phShow = \(which\) => \{[\s\S]*?phDial[\s\S]*?\};/.test(h),

  // ---- 圆角：每一层自己带，不靠父级裁（Electron 里父级裁剪会丢）----
  '屏幕定义圆角变量': /--ph-r:\s*20px/.test(h),
  '屏幕自己 clip-path': /\.phone-screen\{[\s\S]*?clip-path:inset\(0 round var\(--ph-r\)\)/.test(h),
  '机身自己 clip-path': /\.phone-body\{[\s\S]*?clip-path:inset\(0 round 26px\)/.test(h),
  '每个全屏层都自己圆角': (() => {
    const m = /\.ph-home,\.ph-dial,\.ph-qq,\.ph-chat\{([\s\S]*?)\}/.exec(h);
    if (!m) return false;
    return /border-radius:var\(--ph-r/.test(m[1]) && /clip-path:inset\(0 round var\(--ph-r/.test(m[1]);
  })(),
  '圆角不靠 .ph-home>* 通配（会压掉绝对定位）': !/\.ph-home>\*\s*\{/.test(h),

  // ---- 壁纸：真实照片，agent 自己挑自己换 ----
  '宿主有壁纸白名单': /const WALLPAPERS = \[/.test(host) && /const WALL_IDS =/.test(host),
  '壁纸走 /wallpaper/ 路由': /p\.startsWith\('\/wallpaper\/'\)/.test(host),
  '壁纸路由只放行白名单': /WALLPAPERS\.find\(\(w\) => w\.id === id\)/.test(host),
  '壁纸写进房间状态': /wallpaper: WALL_IDS\.includes\(raw\.wallpaper\)/.test(host),
  '有换壁纸工具': /name: 'bedroom_wallpaper'/.test(host),
  'bedroom_status 报告壁纸': /wallpaper: \{\s*\n?\s*now: room\.wallpaper/.test(host),
  'POST /room 能改壁纸': /body\.wallpaper/.test(host),
  '前端有壁纸层': h.includes('id="phWall"'),
  '壁纸层铺满且在最底': /\.ph-wall\{position:absolute;inset:0/.test(h),
  '壁纸带暗色蒙层（白字可读）': /\.ph-wall::after\{[\s\S]*?linear-gradient/.test(h),
  '前端按状态画壁纸': h.includes('paintWallpaper(room.wallpaper'),
  '长按桌面换壁纸': h.includes('bindWallpaperGesture') && h.includes('cycleWallpaper'),
  '点图标不触发换壁纸': /if \(e\.target\.closest\('\.ph-app'\)\) return;/.test(h),
  '换壁纸手势只绑一次': /if \(home\._wpBound\) return;/.test(h),

  // ---- QQ 头像（真实头像，走宿主代理）----
  '头像走 qlogo 公开接口': /q1\.qlogo\.cn/.test(host),
  '头像有 /avatar/ 代理路由': /p\.startsWith\('\/avatar\/'\)/.test(host),
  '头像只放行数字号码': /\^\\d\{5,15\}\$/.test(host),
  '头像有内存缓存': /AVATAR_TTL_MS/.test(host) && /avatarCache/.test(host),
  '会话按类型分头像（群/个人）': /isGroup\s*\n?\s*\?/.test(host) && /GROUP_AVATAR_PREFIX \+ id/.test(host),
  '前端头像有首字母兜底': /ph-av-fb/.test(h) && /avatarHtml/.test(h),
  '兜底默认隐藏（不与头像重叠）': /ph-av-fb" style="display:none"/.test(h),

  // ---- 群聊：真实群名 + 群头像（不借用某个人的脸）----
  '群头像走 p.qlogo.cn': /p\.qlogo\.cn\/gh\//.test(host),
  '群头像有 /groupavatar/ 代理': /p\.startsWith\('\/groupavatar\/'\)/.test(host),
  '群名从 Aurabot hub 取': /hub\.groupName/.test(host),
  '群名有本地落盘缓存': /groupnames\.json/.test(host),
  '群标题不用发言人昵称': /title: isGroup \? \(groupName/.test(host),
  '群不挂个人 uid': /uid: isGroup \? '' :/.test(host),
  '群聊消息标发言人': /showName: isGroup && m\.who !== 'bot'/.test(host),
  '群聊消息按发言人取头像': /avatar: m\.who !== 'bot' && m\.uid \? AVATAR_PREFIX/.test(host),

  // ---- QQ：走可配置的聊天服务（默认适配 Aurabot）----
  'QQ 只认主人私聊（owner+direct）': /a\.owner !== true/.test(host) && /a\.direct !== true/.test(host),
  'QQ 走聊天服务 activity 事件': /service\.on\('activity'/.test(host),
  '聊天服务名可配置（chatService）': /config\.chatService/.test(host) && /ctx\.get\(chatServiceName\)/.test(host),
  '聊天数据目录可配置': /config\.chatDataDir/.test(host) && /BEDROOM_CHAT_DIR/.test(host),
  '不再依赖 dsh-bridge 标记': !/BRIDGE_MARKER|dsh-bridge\\s\*提示/.test(host),
  '日记读聊天服务 diary.json': /'plugins-data', chatServiceName/.test(host) && /diary\.json/.test(host),
  '日记按天聚合（同一天取最后一篇）': /byDay/.test(host) && /count/.test(host),
  '日记不给代写（只读聊天服务）': /日记由聊天服务（默认 Aurabot）每天自己写/.test(host),
  '记忆库路径可配置（无私人路径）': /BEDROOM_VAULT_DIR/.test(host) && !/D:[\\/]桌面/.test(host),
  'dsh-pet 路由可配置（petRoute）': /config\.petRoute/.test(host) && /PET_ROUTE/.test(host),

  // ---- QQ 连接窗口（默认 SnowLuma / OneBot 11）----
  'QQ 连接按钮存在': h.includes('id="btnQq"'),
  'QQ 连接窗口存在': h.includes('id="qqWin"'),
  'QQ 窗口默认 display:none': /\.qqwin\{[^}]*display:none/.test(h),
  'QQ 窗口没有全屏遮罩': !h.includes('qqMask') && !/class="qq-[^"]*backdrop/.test(h),
  '默认后端 SnowLuma + 3001': /QQ_DEFAULT_BASE = 'http:\/\/127\.0\.0\.1:3001'/.test(host),
  '上报地址 = /qq/event': /reportPath: '\/qq\/event'/.test(host),
  '令牌只回 hasToken（不回显）': /hasToken: Boolean\(qq\.token\)/.test(host),
  '上报要校验令牌': /got !== qq\.token/.test(host),
  '上报只收主人私聊': /uid !== qq\.selfId/.test(host) && /message_type === 'private'/.test(host),
  '上报按 message_id 去重': /qqRuntime\.seen/.test(host),
  'QQ 直连流水并入聊天列表': /\.\.\.readQqLog\(days\)/.test(host),
  'QQ 窗口有测试连接与保存': h.includes('id="qqTest"') && h.includes('id="qqSave"'),
  'QQ 窗口给得上报地址': h.includes('id="qqReport"'),

  '右键菜单容器': h.includes('id="ctxmenu"'),
  '右键 contextmenu 监听': h.includes("addEventListener('contextmenu'"),
  '待机随机演示定时器': h.includes('playDemo(name, 9000)'),
  'randomDemo 用完整池': h.includes('allAnims[Math.floor'),
  '植物=玩水枪动画优先': h.includes('plant: pick(pool, [/玩水枪/'),
  '植物=喷水文案': h.includes('喷两下水'),
  '电脑桌锚点下移（y>57）': (() => {
    const m = /\{ id:'chair'[\s\S]*?anchor:\{x:([\d.]+),y:([\d.]+)\}/.exec(h);
    return Boolean(m) && Number(m[2]) > 57;
  })(),
  '植物锚点右移（x>13）': (() => {
    const m = /\{ id:'plant'[\s\S]*?anchor:\{x:([\d.]+),y:([\d.]+)\}/.exec(h);
    return Boolean(m) && Number(m[1]) > 13;
  })(),
  '落地窗锚点站到床上（x>22 且 y>44）': (() => {
    const m = /\{ id:'win'[\s\S]*?anchor:\{x:([\d.]+),y:([\d.]+)\}/.exec(h);
    return Boolean(m) && Number(m[1]) > 22 && Number(m[2]) > 44;
  })(),
  // 只查「真节点」和「真 keyframes」，注释里提到 .zzz 不算（这次就是因为注释误报）
  '没有 Zzz 跟着桌宠跑': !/class="zzz"|<div class="zzz"/.test(h) && !/@keyframes\s+zzz/.test(h),
  // 全局上移必须是「goTo 里统一减一个常量」，不能靠在 SPOTS 里逐个改数字
  // （那样会漏掉躺床/回中间这些写死的 goTo）
  '全局上移走 goTo 单点（ANCHOR_LIFT）': (() => {
    const m = /const ANCHOR_LIFT = ([\d.]+);/.exec(h);
    const g = /const goTo = \(a\) => \{ target = \{ x:a\.x, y:a\.y - ANCHOR_LIFT \}; \}/.test(h);
    return Boolean(m) && g && Number(m[1]) > 0;
  })(),
  '没有绕过 goTo 的裸 target 赋值': !/target = \{ x:a\.x, y:a\.y \};/.test(h),
  '退出按钮存在': h.includes('id="btnExit"'),
  '退出按钮逻辑': h.includes("$('btnExit').addEventListener"),
  '退出样式': h.includes('button.exit'),
  'ctxmenu 样式': h.includes('.ctxmenu.open'),
};
let bad = 0;
for (const [k, v] of Object.entries(checks)) {
  console.log((v ? 'OK  ' : 'FAIL'), k);
  if (!v) bad++;
}
console.log(bad === 0 ? '\nALL PASS' : '\n' + bad + ' FAILED');
process.exit(bad === 0 ? 0 : 1);

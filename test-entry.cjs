/**
 * 收录条目自检：把 awesome-dsh-plugin/contributing.md 里「CI 会检查什么」逐条落成断言。
 * 不联网、不改仓库，只读本地文件 + 可选读 origin。
 */
const fs = require('fs');

const entry = fs.readFileSync('.github/awesome-plugin-entry.yml', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const body = entry.split(/\r?\n/).filter((line) => !line.trim().startsWith('#')).join('\n');
const field = (name) => (body.match(new RegExp('^' + name + ':\\s*(.+)$', 'm')) || [])[1] || '';
const strip = (v) => v.trim().replace(/^['"]|['"]$/g, '');

const checks = {
  '顶层键齐全（url/name/category/description/icon/tarball）':
    ['url', 'name', 'category', 'description', 'icon', 'tarball'].every((k) => new RegExp('^' + k + ':', 'm').test(body)),
  'url 与 package.json 仓库一致': strip(field('url')) === String(pkg.repository.url).replace(/^git\+/, '').replace(/\.git$/, ''),
  'name 是 owner/repo': /^[A-Za-z0-9-]+\/dsh-pet-bedroom$/.test(strip(field('name'))),
  'category 在允许集合内': ['agi', 'ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory', 'tools', 'wsl', 'browser', 'vision', 'voice', 'docs', 'skill', 'workflow', 'git', 'notify', 'dev', 'security', 'remote', 'market', 'fun']
    .includes(strip(field('category'))),
  'en 与 zh 都有且带引号（防冒号空格解析失败）': /^\s+en:\s*'.+'$/m.test(body) && /^\s+zh:\s*'.+'$/m.test(body),
  'en 以句号结尾': /[.!?]'?\s*$/m.test((body.match(/^\s+en:\s*(.+)$/m) || [])[1] || ''),
  'zh 以句号结尾': /。'?\s*$/m.test((body.match(/^\s+zh:\s*(.+)$/m) || [])[1] || ''),
  'tarball 是 GitHub Release 的 https .tgz': /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/(latest\/download|download\/[^/]+)\/[^/]+\.tgz$/
    .test(strip(field('tarball'))),
  'tarball 资产名不带版本号（latest 不会 404）': !/\d+\.\d+\.\d+/.test(strip(field('tarball')).split('/').pop()),
  'icon 是 GitHub 托管位图（png/jpg/webp）': /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/.+\.(png|jpg|jpeg|webp)$/
    .test(strip(field('icon'))),
  'icon 文件真在仓库里': (() => {
    // https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path...>
    //   0        1  2                        3       4      5      6..
    const parts = strip(field('icon')).split('/');
    const rel = parts.slice(6).join('/');
    return Boolean(rel) && fs.existsSync(rel);
  })(),
  'dsh.bundle.patch 有对应文件': Boolean(pkg?.dsh?.bundle?.patch) && fs.existsSync(pkg.dsh.bundle.patch.replace(/^\.\//, '')),
  '描述里的 6 个工具真存在': (fs.readFileSync('index.js', 'utf8').match(/name: '(bedroom_[a-z]+)'/g) || []).length === 6,
  '描述提到 QQ 且代码有 /qq 路由': /QQ/.test(body) && /p === '\/qq'/.test(fs.readFileSync('index.js', 'utf8')),
  '描述提到抖音且代码有 /douyin': /抖音/.test(body) && /\/douyin\/start/.test(fs.readFileSync('index.js', 'utf8')),
  'PR 只加 1 条（≤3）': (body.match(/^url:/gm) || []).length === 1,
};

let bad = 0;
for (const [name, ok] of Object.entries(checks)) {
  console.log((ok ? 'OK  ' : 'FAIL'), name);
  if (!ok) bad++;
}
console.log(bad === 0 ? '\nENTRY PASS' : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);

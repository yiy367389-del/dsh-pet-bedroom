/**
 * 发版脚本：把某个 tag 打成预构建 tarball，挂到 GitHub Releases。
 *
 * 用法（需要本机已登录 GitHub，或提供 GITHUB_TOKEN）：
 *   node release.mjs                 # 发当前 package.json 版本（tag = v<version>）
 *   node release.mjs --tag v2.1.0    # 补发某个已有 tag
 *   node release.mjs --dry-run       # 只打包，不碰 GitHub
 *
 * 产物名固定为 dsh-pet-bedroom.tgz（不带版本号），这样
 *   https://github.com/<owner>/<repo>/releases/latest/download/dsh-pet-bedroom.tgz
 * 在每次发版后都不会 404；钉住版本时用
 *   .../releases/download/v2.1.0/dsh-pet-bedroom.tgz
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = import.meta.dirname;
const args = process.argv.slice(2);
const pick = (name, fallback = '') => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const dryRun = args.includes('--dry-run');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tag = pick('tag', 'v' + pkg.version);
const notesFile = pick('notes', '');
const repoUrl = String(pkg.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, '');
const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
if (!m) {
  console.error('package.json 里的 repository 不是 GitHub 地址：' + repoUrl);
  process.exit(1);
}
const [, owner, repo] = m;

/** 从 tag 解出一份干净工作树：保证资产和 tag 完全一致，而不是当前工作区 */
function exportTag(tagName, dest) {
  const tar = path.join(dest, 'src.tar');
  execFileSync('git', ['archive', '--format=tar', '--prefix=pkg/', tagName, '-o', tar], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('tar', ['-xf', tar, '-C', dest], { cwd: ROOT, stdio: 'inherit' });
  fs.rmSync(tar, { force: true });
  return path.join(dest, 'pkg');
}

function buildTarball() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bedroom-release-'));
  try {
    const src = exportTag(tag, tmp);
    const dist = path.join(tmp, 'dist');
    fs.mkdirSync(dist);
    const out = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--pack-destination', dist], {
      cwd: src,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim();
    const tgz = path.join(dist, out.split(/\r?\n/).pop().trim());
    if (!fs.existsSync(tgz)) throw new Error('npm pack 没产出文件：' + out);
    const finalPath = path.join(tmp, 'dsh-pet-bedroom.tgz');
    fs.copyFileSync(tgz, finalPath);
    return { tmp, tgz: finalPath, size: fs.statSync(finalPath).size };
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw error;
  }
}

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const out = execFileSync('git', ['credential', 'fill'], {
    cwd: ROOT,
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const hit = out.split(/\r?\n/).find((line) => line.startsWith('password='));
  if (!hit) throw new Error('没有 GitHub 凭据：先设置 GITHUB_TOKEN，或让 git 登录 GitHub');
  return hit.slice('password='.length);
}

async function api(pathname, init = {}) {
  const res = await fetch('https://api.github.com' + pathname, {
    ...init,
    headers: {
      authorization: 'Bearer ' + token(),
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-pet-bedroom-release',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${pathname} → ${res.status} ${text.slice(0, 300)}`);
  return data;
}

function changelogBody(tagName) {
  const version = tagName.replace(/^v/, '');
  const text = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const start = text.indexOf('## [' + version + ']');
  if (start < 0) return '';
  const rest = text.slice(start);
  const end = rest.indexOf('\n## ', 5);
  return rest.slice(0, end < 0 ? undefined : end).trim();
}

const built = buildTarball();
console.log(`已打包 ${tag} → dsh-pet-bedroom.tgz（${(built.size / 1024).toFixed(0)} KB）`);
if (dryRun) {
  const keep = path.join(ROOT, 'dist');
  fs.mkdirSync(keep, { recursive: true });
  fs.copyFileSync(built.tgz, path.join(keep, 'dsh-pet-bedroom.tgz'));
  fs.rmSync(built.tmp, { recursive: true, force: true });
  console.log('dry-run：只放到 dist/dsh-pet-bedroom.tgz，没有发 Release');
  process.exit(0);
}

const body = [
  changelogBody(tag),
  '',
  '## 安装',
  '',
  '```bash',
  `dsh plugin add https://github.com/${owner}/${repo}/releases/download/${tag}/dsh-pet-bedroom.tgz`,
  '```',
  '',
  '或用 latest（永远指向最新一版）：',
  '',
  '```bash',
  `dsh plugin add https://github.com/${owner}/${repo}/releases/latest/download/dsh-pet-bedroom.tgz`,
  '```',
].filter(Boolean).join('\n');

let release = null;
try {
  release = await api(`/repos/${owner}/${repo}/releases/tags/${tag}`);
  console.log(`Release ${tag} 已存在（id ${release.id}），只补资产`);
} catch {
  release = await api(`/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name: tag, body, draft: false, prerelease: false, make_latest: 'true' }),
  });
  console.log(`已创建 Release ${tag}（id ${release.id}）`);
}

const assets = Array.isArray(release.assets) ? release.assets : [];
const existing = assets.find((a) => a.name === 'dsh-pet-bedroom.tgz');
if (existing) {
  await api(`/repos/${owner}/${repo}/releases/assets/${existing.id}`, { method: 'DELETE' }).catch(() => {});
}

const upload = await fetch(
  `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=dsh-pet-bedroom.tgz`,
  {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token(),
      'content-type': 'application/gzip',
      'user-agent': 'dsh-pet-bedroom-release',
    },
    body: fs.readFileSync(built.tgz),
    signal: AbortSignal.timeout(120_000),
  },
);
if (!upload.ok) throw new Error('上传资产失败：' + upload.status + ' ' + (await upload.text()).slice(0, 300));
fs.rmSync(built.tmp, { recursive: true, force: true });
console.log('资产已上传：' + `https://github.com/${owner}/${repo}/releases/download/${tag}/dsh-pet-bedroom.tgz`);

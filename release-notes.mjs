/**
 * 补齐 Release 说明：把 CHANGELOG 里对应版本的小节写进 Release 正文，
 * 并在末尾统一附上安装命令。只改 body，不动资产与 tag。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname;
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const repoUrl = String(pkg.repository.url).replace(/^git\+/, '').replace(/\.git$/, '');
const [, owner, repo] = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+)$/);

const token = (() => {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  const out = execFileSync('git', ['credential', 'fill'], {
    cwd: ROOT,
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const hit = out.split(/\r?\n/).find((l) => l.startsWith('password='));
  if (!hit) throw new Error('没有 GitHub 凭据');
  return hit.slice('password='.length);
})();

const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const section = (tag) => {
  const version = tag.replace(/^v/, '');
  const start = changelog.indexOf('## [' + version + ']');
  if (start < 0) return '';
  const rest = changelog.slice(start);
  const end = rest.indexOf('\n## ', 5);
  return rest.slice(0, end < 0 ? undefined : end).trim();
};

async function api(p, init = {}) {
  const res = await fetch('https://api.github.com' + p, {
    ...init,
    headers: {
      authorization: 'Bearer ' + token,
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-pet-bedroom-release',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${p} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const releases = await api(`/repos/${owner}/${repo}/releases?per_page=30`);
const tags = execFileSync('git', ['tag'], { cwd: ROOT, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);

for (const tag of tags) {
  const release = releases.find((r) => r.tag_name === tag);
  if (!release) {
    console.log('SKIP（没有对应 Release）', tag);
    continue;
  }
  const sectionText = section(tag);
  if (!sectionText) {
    console.log('SKIP（CHANGELOG 里没有该版本）', tag);
    continue;
  }
  const body = [
    sectionText,
    '',
    '## 安装',
    '',
    '```bash',
    `dsh plugin add ${repoUrl}/releases/download/${tag}/dsh-pet-bedroom.tgz`,
    '```',
    '',
    '始终跟最新：',
    '',
    '```bash',
    `dsh plugin add ${repoUrl}/releases/latest/download/dsh-pet-bedroom.tgz`,
    '```',
  ].join('\n');
  if (release.body && release.body.trim() === body.trim()) {
    console.log('已是最新', tag);
    continue;
  }
  await api(`/repos/${owner}/${repo}/releases/${release.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  console.log('已更新说明', tag, `${body.length} 字符`);
}

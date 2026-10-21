#!/usr/bin/env node
/* 内容发布：把新版单文件 HTML 发布到 release/，并更新桌面端热更新清单。
   内容更新不需要重新打包桌面壳，也不需要打 tag。

   用法：
     node scripts/publish-content.js <新HTML路径> [--website] [--dry-run] [--force]

   参数：
     --website  同时把官网 website/index.html 的「在线应用」链接与版本徽章指向新版
     --dry-run  只打印将要执行的动作，不写入任何文件
     --force    允许发布不高于当前 latest.json 的版本（默认拒绝，防止版本倒退）
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'release');
const MANIFEST = path.join(RELEASE_DIR, 'latest.json');
const WEBSITE_INDEX = path.join(ROOT, 'website', 'index.html');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const SITE = 'https://jidiandian.top/release/';
const MIN_BYTES = 1024 * 1024;

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { src: '', website: false, dryRun: false, force: false };
  for (const a of argv) {
    if (a === '--website') out.website = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a.startsWith('-')) fail('未知参数: ' + a);
    else if (!out.src) out.src = a;
  }
  return out;
}

/* 逐段比较版本号，返回 1 / 0 / -1 */
function cmpVer(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function readManifestVersion() {
  try {
    return String(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).version || '').trim();
  } catch (e) {
    return '';
  }
}

/* 版本号以应用内的 APP_VER 为准，缺失时退回 <title> */
function pickVersion(html) {
  let m = html.match(/APP_VER\s*=\s*['"]([0-9]+(?:\.[0-9]+)+)['"]/);
  if (m) return { version: m[1], from: 'APP_VER' };
  m = html.match(/<title>[^<]*?V([0-9]+(?:\.[0-9]+)+)[^<]*<\/title>/);
  if (m) return { version: m[1], from: 'title' };
  return null;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function fmtSize(n) {
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

const args = parseArgs(process.argv.slice(2));
if (!args.src) {
  console.log('用法: node scripts/publish-content.js <新HTML路径> [--website] [--dry-run] [--force]');
  process.exit(1);
}

const srcPath = path.resolve(process.cwd(), args.src);
if (!fs.existsSync(srcPath)) fail('找不到源文件: ' + srcPath);

const stat = fs.statSync(srcPath);
if (!stat.isFile()) fail('源路径不是文件: ' + srcPath);
if (stat.size < MIN_BYTES) fail('源文件只有 ' + fmtSize(stat.size) + '，不像是完整的应用');

const html = fs.readFileSync(srcPath, 'utf8');
const picked = pickVersion(html);
if (!picked) fail('无法从 HTML 中解析版本号（APP_VER 与 <title> 都没有）');

const version = picked.version;
const current = readManifestVersion();

console.log('源文件   : ' + srcPath);
console.log('文件大小 : ' + fmtSize(stat.size));
console.log('解析版本 : V' + version + '（来自 ' + picked.from + '）');
console.log('线上版本 : ' + (current ? 'V' + current : '（清单缺失）'));

if (current && cmpVer(version, current) <= 0 && !args.force) {
  fail('版本没有提升（' + version + ' ≤ ' + current + '）。确认要覆盖请加 --force');
}
if (current && cmpVer(version, current) < 0) {
  console.log('⚠ 这是版本回退，仅因 --force 才继续。');
}

const fileName = 'TraceDot-V' + version + '.html';
const destPath = path.join(RELEASE_DIR, fileName);
const sameFile = path.resolve(destPath) === path.resolve(srcPath);

const manifest = {
  version: version,
  file: fileName,
  url: SITE + fileName,
  updated: today(),
  note:
    '桌面端内容更新清单。改这里并推送，已安装的壳会在下次启动时自动拉取新 HTML，无需重新打包。'
};

if (args.dryRun) {
  console.log('\n[dry-run] 将执行：');
  console.log('  1. ' + (sameFile ? '文件已在位，跳过复制' : '复制到 release/' + fileName));
  console.log('  2. 写 release/latest.json → V' + version);
  if (args.website) console.log('  3. 同步 website/index.html 的在线应用链接与版本徽章');
  process.exit(0);
}

/* 1. 落盘内容文件 */
if (!sameFile) {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  console.log('\n✓ 已复制 → release/' + fileName + '（' + fmtSize(fs.statSync(destPath).size) + '）');
} else {
  console.log('\n✓ 文件已在 release/ 内，跳过复制');
}

/* 2. 写热更新清单 */
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log('✓ 清单已更新 → release/latest.json（V' + version + '）');

/* 3. 可选：同步官网在线应用入口 */
if (args.website) {
  if (!fs.existsSync(WEBSITE_INDEX)) {
    console.log('⚠ 找不到 website/index.html，跳过官网同步');
  } else {
    let site = fs.readFileSync(WEBSITE_INDEX, 'utf8');
    const before = site;
    /* 只替换这三类精确引用，避免误伤历史版本文字 */
    site = site.replace(/TraceDot-V[0-9]+(?:\.[0-9]+)*\.html/g, fileName);
    site = site.replace(/迹点点_V[0-9]+(?:\.[0-9]+)*\.html/g, '迹点点_V' + version + '.html');
    site = site.replace(/>V[0-9]+(?:\.[0-9]+)+</g, '>V' + version + '<');
    if (site !== before) {
      fs.writeFileSync(WEBSITE_INDEX, site);
      console.log('✓ 官网已同步 → website/index.html（在线应用 → V' + version + '）');
    } else {
      console.log('· 官网站内没有需要替换的版本引用');
    }
  }
}

/* 4. 提醒：应用内「有新版本」提示依赖 CHANGELOG 顶部的版本标题 */
if (fs.existsSync(CHANGELOG)) {
  const head = fs.readFileSync(CHANGELOG, 'utf8').slice(0, 4000);
  if (!head.includes('V' + version)) {
    console.log('\n⚠ CHANGELOG.md 顶部还没有 V' + version + ' 的标题。');
    console.log('  应用内「有新版本」提示靠解析该标题取版本号，建议先补上：');
    console.log('  ## [V' + version + '] - ' + today());
  }
}

console.log('\n下一步：');
console.log('  git add release/ website/');
console.log('  git commit -m "content: V' + version + '"');
console.log('  git push');
console.log('推送后约 1 分钟生效；已安装的桌面端下次启动会自动拉取。');
console.log('本次不需要打 tag，也不需要重新打包桌面壳。');

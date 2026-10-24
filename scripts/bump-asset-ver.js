#!/usr/bin/env node
/**
 * 为 website/ 下的 CSS/JS 静态资源打内容指纹，写回各 HTML 的引用处。
 *
 *   node scripts/bump-asset-ver.js            # 写入
 *   node scripts/bump-asset-ver.js --dry-run  # 只看差异
 *
 * 为什么需要：GitHub Pages 给 .css/.js 发的是 Cache-Control: max-age=14400（4 小时），
 * 前面又挂了 Cloudflare 边缘缓存。改完样式后 HTML 只有 10 分钟缓存会更新，
 * 但浏览器仍拿着旧 CSS 渲染新 DOM —— 表现为「我这边改好了，你那边还是老样子」。
 * 加 ?v=<内容哈希> 后每次内容变化都是新 URL，浏览器与边缘缓存都不会命中旧版本。
 *
 * ⚠️ 改完 glass.css / glass.js 后必须跑一次本脚本，再提交。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'website');
const dryRun = process.argv.includes('--dry-run');

const hash = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(SITE, f))).digest('hex').slice(0, 10);

const targets = [
  { file: 'glass.css', re: /href="glass\.css(?:\?v=[0-9a-f]+)?"/g, tpl: (v) => `href="glass.css?v=${v}"` },
  { file: 'glass.js', re: /src="glass\.js(?:\?v=[0-9a-f]+)?"/g, tpl: (v) => `src="glass.js?v=${v}"` },
].map((t) => ({ ...t, ver: hash(t.file) }));

targets.forEach((t) => console.log(`  ${t.file.padEnd(10)} → v=${t.ver}`));

const htmls = fs.readdirSync(SITE).filter((f) => f.endsWith('.html'));
let touched = 0;

for (const h of htmls) {
  const p = path.join(SITE, h);
  const src = fs.readFileSync(p, 'utf8');
  let out = src;
  const hits = [];
  for (const t of targets) {
    t.re.lastIndex = 0;
    out = out.replace(t.re, (m) => {
      hits.push(m);
      return t.tpl(t.ver);
    });
  }
  if (out !== src) {
    touched++;
    console.log(`  ✓ ${h}  (${hits.length} 处引用)`);
    if (!dryRun) fs.writeFileSync(p, out);
  } else {
    console.log(`  · ${h}  已是最新`);
  }
}

console.log(dryRun ? `\n[dry-run] 将更新 ${touched} 个 HTML` : `\n完成：更新 ${touched} 个 HTML`);

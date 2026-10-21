/* 打壳包前，把「当前线上内容的种子」铺进 app/：
   壳内置一份最新 HTML 与实际版本号，用户首次安装即可离线使用。
   之后内容更新不再走打包，直接替换用户目录里的 HTML。 */
const fs = require('fs');
const path = require('path');

const releaseDir = path.join(__dirname, '..', 'release');
const manifestPath = path.join(releaseDir, 'latest.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = String(manifest.version || '').trim();
if (!version) throw new Error('release/latest.json 缺少 version');

const fileName = manifest.file || 'TraceDot-V' + version + '.html';
const src = path.join(releaseDir, fileName);
if (!fs.existsSync(src)) throw new Error('找不到内容文件: ' + src);

const outDir = path.join(__dirname, 'app');
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(src, path.join(outDir, 'index.html'));
fs.writeFileSync(path.join(outDir, 'version.txt'), version);

console.log('[prep] seed = ' + fileName + ' (V' + version + ')');

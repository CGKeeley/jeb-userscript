// Bundles src/bookmarklet.ts into a single minified IIFE and emits:
//   dist/bookmarklet.js        plain script (used by tests, can be pasted into DevTools)
//   dist/bookmarklet.url.txt   javascript: URL to paste as a bookmark address (compressed, see below)
//   dist/install.html          page with a draggable bookmarklet link
import { build } from 'esbuild';
import fs from 'node:fs';
import zlib from 'node:zlib';

const result = await build({
  entryPoints: ['src/bookmarklet.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  charset: 'ascii',
  legalComments: 'none',
  write: false,
});
const code = result.outputFiles[0].text.trim();

// The bookmark holds the bundle raw-deflated and base64'd, plus a small loader that inflates it with the
// browser's DecompressionStream and runs it: under half the size of the plain script, which keeps well
// clear of bookmark URL length limits. The site sends no CSP, so the loader's indirect eval is allowed.
// On any other site the loader goes straight to the meals page without unpacking anything: other sites may
// forbid eval through their CSP, and the bundle would only redirect there anyway (see main() in
// src/bookmarklet.ts, whose HOST must match).
const HOST = 'app.business.just-eat.co.uk';
if (!code.includes(`"${HOST}"`)) throw new Error(`HOST ${HOST} not found in the bundle; keep it in sync with src/bookmarklet.ts`);
const packed = zlib.deflateRawSync(code, { level: 9 }).toString('base64');
const loader =
  `(async()=>{if(location.hostname!=='${HOST}'){location.href='https://${HOST}/my-meals';return}` +
  `try{const b=Uint8Array.from(atob('${packed}'),c=>c.charCodeAt(0));` +
  `(0,eval)(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text())}` +
  `catch(e){alert('Just Eat for Business UserScript could not start: '+e)}})()`;
// Chrome/Edge accept most characters verbatim in javascript: URLs, but %, # and whitespace other than
// spaces must be escaped or they get misinterpreted when the bookmark is saved. (Base64 and the loader
// contain none of these today; the escaping is kept so a future loader change can't break the URL.)
const light = loader.replace(/[%#\n\r\t]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
const url = `javascript:${light};void 0`;
// Sanity checks: what the browser will execute after percent-decoding must be exactly the loader, and the
// payload inside it must inflate back to exactly our code.
const decoded = decodeURIComponent(url.slice('javascript:'.length));
if (decoded !== `${loader};void 0`) throw new Error('bookmarklet URL does not round-trip; check the encoding step');
if (zlib.inflateRawSync(Buffer.from(packed, 'base64')).toString('utf8') !== code) throw new Error('packed payload does not inflate back to the bundle');

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/bookmarklet.js', code + '\n');
fs.writeFileSync('dist/bookmarklet.url.txt', url + '\n');

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
fs.writeFileSync(
  'dist/install.html',
  `<!doctype html><meta charset="utf-8"><title>Just Eat for Business UserScript</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 16px}a.bm{display:inline-block;padding:10px 16px;background:#ff8000;color:#fff;border-radius:8px;text-decoration:none;font-weight:700}textarea{width:100%;height:120px;font:12px monospace}</style>
<h1>Just Eat for Business UserScript</h1>
<p>Drag this link to your bookmarks bar: <a class="bm" href="${escapeHtml(url)}">Compare menus</a></p>
<p>If dragging is blocked, create a new bookmark manually and paste this as its URL:</p>
<textarea readonly onclick="this.select()">${escapeHtml(url)}</textarea>
<p>Then open <a href="https://app.business.just-eat.co.uk/my-meals">app.business.just-eat.co.uk/my-meals</a> and click the bookmark. A <b>Compare menus</b> button appears next to each day, along with <b>Lunch arrivals</b> for a live board of that day's deliveries.</p>
<p>Size: ${(url.length / 1024).toFixed(1)} KB</p>
`,
);
// GitHub Pages serves index.html at the site root.
fs.copyFileSync('dist/install.html', 'dist/index.html');
console.log(`built dist/bookmarklet.js (${(code.length / 1024).toFixed(1)} KB), url ${(url.length / 1024).toFixed(1)} KB compressed`);

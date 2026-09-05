// Bundles src/bookmarklet.ts into a single minified IIFE and emits:
//   dist/bookmarklet.js        plain script (used by tests, can be pasted into DevTools)
//   dist/bookmarklet.url.txt   javascript: URL to paste as a bookmark address
//   dist/install.html          page with a draggable bookmarklet link
import { build } from 'esbuild';
import fs from 'node:fs';

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

// Chrome/Edge accept most characters verbatim in javascript: URLs, but %, # and whitespace other than
// spaces must be escaped or they get misinterpreted when the bookmark is saved.
const light = code.replace(/[%#\n\r\t]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
const url = `javascript:${light};void 0`;
// Sanity check: what the browser will execute after percent-decoding must be exactly our code.
const decoded = decodeURIComponent(url.slice('javascript:'.length));
if (decoded !== `${code};void 0`) throw new Error('bookmarklet URL does not round-trip; check the encoding step');

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/bookmarklet.js', code + '\n');
fs.writeFileSync('dist/bookmarklet.url.txt', url + '\n');

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
fs.writeFileSync(
  'dist/install.html',
  `<!doctype html><meta charset="utf-8"><title>JEFB Compare bookmarklet</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 16px}a.bm{display:inline-block;padding:10px 16px;background:#ff8000;color:#fff;border-radius:8px;text-decoration:none;font-weight:700}textarea{width:100%;height:120px;font:12px monospace}</style>
<h1>Just Eat for Business: Compare menus</h1>
<p>Drag this link to your bookmarks bar: <a class="bm" href="${escapeHtml(url)}">Compare menus</a></p>
<p>If dragging is blocked, create a new bookmark manually and paste this as its URL:</p>
<textarea readonly onclick="this.select()">${escapeHtml(url)}</textarea>
<p>Then open <a href="https://app.business.just-eat.co.uk/my-meals">app.business.just-eat.co.uk/my-meals</a> and click the bookmark. A <b>Compare menus</b> button appears next to each day.</p>
<p>Size: ${(url.length / 1024).toFixed(1)} KB</p>
`,
);
// GitHub Pages serves index.html at the site root.
fs.copyFileSync('dist/install.html', 'dist/index.html');
console.log(`built dist/bookmarklet.js (${(code.length / 1024).toFixed(1)} KB), url ${(url.length / 1024).toFixed(1)} KB`);

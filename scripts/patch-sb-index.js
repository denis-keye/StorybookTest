#!/usr/bin/env node
// Post-processes public/sb/index.html after storybook build.
// Replaces all ./ relative asset paths with absolute /sb/ paths so the page
// works when served at /sb (without trailing slash) from Next.js on Vercel.
const fs = require('fs');
const file = 'public/sb/index.html';
const html = fs.readFileSync(file, 'utf8');
// Replace ="./  with ="/sb/  (href and src attributes)
let patched = html.replace(/="(\.\/)/g, '="/sb/');
// Replace import './ and import "./ inside inline <script type="module"> blocks
patched = patched.replace(/\bimport ['"](\.\/)([^'"]+)['"]/g, "import '/sb/$2'");
// Replace url('./ inside inline <style> blocks (e.g. @font-face src)
patched = patched.replace(/url\(['"](\.\/)([^'"]+)['"]\)/g, "url('/sb/$2')");
fs.writeFileSync(file, patched);
console.log('[patch-sb-index] Patched', file);

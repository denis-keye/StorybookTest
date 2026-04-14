#!/usr/bin/env node
// Post-processes public/sb/index.html after storybook build.
// Replaces all ./ relative asset paths with absolute /sb/ paths so the page
// works when served at /sb (without trailing slash) from Next.js on Vercel.
const fs = require('fs');
const file = 'public/sb/index.html';
const html = fs.readFileSync(file, 'utf8');
// Replace ="./  with ="/sb/  (href and src attributes)
const patched = html.replace(/="(\.\/)/g, '="/sb/');
fs.writeFileSync(file, patched);
console.log('[patch-sb-index] Patched', file);

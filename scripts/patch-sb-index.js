#!/usr/bin/env node
// Post-processes public/sb HTML files after storybook build.
// Replaces all ./ relative asset paths with absolute /sb/ paths so pages
// work when served at /sb (without trailing slash) from Next.js on Vercel.
const fs = require('fs');

function patchHtml(file) {
  if (!fs.existsSync(file)) return;
  let html = fs.readFileSync(file, 'utf8');
  // HTML attribute values: href="./ src="./ action="./
  html = html.replace(/="(\.\/)/g, '="/sb/');
  // Bare ES module imports inside inline <script type="module"> blocks
  html = html.replace(/\bimport ['"](\.\/)([^'"]+)['"]/g, "import '/sb/$2'");
  // url('./ inside inline <style> blocks (e.g. @font-face src)
  html = html.replace(/url\(['"](\.\/)([^'"]+)['"]\)/g, "url('/sb/$2')");
  fs.writeFileSync(file, html);
  console.log('[patch-sb-index] Patched', file);
}

patchHtml('public/sb/index.html');
patchHtml('public/sb/iframe.html');

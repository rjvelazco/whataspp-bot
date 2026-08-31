#!/usr/bin/env node
/**
 * Downloads the design system's three faces into public/fonts/ and prints the
 * @font-face block for src/styles.css.
 *
 * They are self-hosted rather than loaded from a CDN because the admin panel binds to
 * loopback (src/config.ts webHost) and may run with no outbound internet — from a CDN,
 * the type half of the design system silently vanishes offline while the colour half
 * still applies. All three families are OFL-licensed.
 *
 * Only latin and latin-ext are kept; vietnamese and cyrillic are dropped. Run this again
 * if a weight or family changes, then paste the printed block into styles.css.
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');
const KEEP_SUBSETS = new Set(['latin', 'latin-ext']);
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const CSS_URL =
  'https://fonts.googleapis.com/css2' +
  '?family=Bricolage+Grotesque:opsz,wght@12..96,500..800' +
  '&family=Instrument+Sans:wght@400..700' +
  '&family=DM+Mono:wght@400;500' +
  '&display=swap';

const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();
mkdirSync(FONTS_DIR, { recursive: true });

const blocks = [...css.matchAll(/\/\* (\S+) \*\/\s*(@font-face \{[\s\S]*?\})/g)];
const faces = [];

for (const [, subset, block] of blocks) {
  if (!KEEP_SUBSETS.has(subset)) continue;
  const family = /font-family: '([^']+)'/.exec(block)[1];
  const style = /font-style: (\S+);/.exec(block)[1];
  const weight = /font-weight: ([^;]+);/.exec(block)[1].trim();
  const url = /url\((https:\/\/[^)]+\.woff2)\)/.exec(block)[1];
  const unicodeRange = /unicode-range: ([^;]+);/.exec(block)[1];

  // A range ("500 800") is one variable file; a single weight is a static cut, and each
  // cut is a DIFFERENT file — so the weight must be part of the name or they collide.
  const slug = family.toLowerCase().replaceAll(' ', '-');
  const suffix = weight.includes(' ') ? 'var' : weight;
  const file = `${slug}-${suffix}-${subset}.woff2`;
  const dest = join(FONTS_DIR, file);

  if (existsSync(dest)) {
    console.error(`FATAL: ${file} written twice — filenames are colliding.`);
    process.exit(1);
  }
  const bytes = Buffer.from(
    await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer(),
  );
  writeFileSync(dest, bytes);
  faces.push({ family, style, weight, file, unicodeRange, size: bytes.length });
}

const total = faces.reduce((n, f) => n + f.size, 0);
for (const f of faces) {
  console.error(`  ${f.file.padEnd(42)} w=${f.weight.padEnd(9)} ${(f.size / 1024).toFixed(1)} KB`);
}
console.error(`  total ${(total / 1024).toFixed(1)} KB across ${faces.length} files\n`);

const rules = faces
  .map((f) =>
    [
      '@font-face {',
      `  font-family: '${f.family}';`,
      `  font-style: ${f.style};`,
      `  font-weight: ${f.weight};`,
      '  font-display: swap;',
      `  src: url('/fonts/${f.file}') format('woff2');`,
      `  unicode-range: ${f.unicodeRange};`,
      '}',
    ].join('\n'),
  )
  .join('\n');
console.log(rules);

#!/usr/bin/env node
/**
 * Enforces the 8-point grid on Tailwind spacing utilities in Angular templates.
 *
 * Why this exists: Stylelint cannot parse templates, and the views are pure Tailwind —
 * their .css files are 28-byte stubs. So the stylelint rule in .stylelintrc.mjs governs
 * a handful of declarations in the app shell while every real spacing decision in the app
 * is a class name it never sees. This closes that gap.
 *
 * Tailwind's numeric scale is n x 0.25rem, i.e. n x 4px, so a utility is on the grid
 * exactly when n is zero or even. gap-2 (8px) is fine; gap-3 (12px) and gap-1.5 (6px)
 * are not.
 *
 * Ratchet, not a wall: spacing-baseline.json records the off-grid count each file is
 * allowed to carry, because sweeping all of them at once would mean rewriting every view
 * in one commit. A file over its budget fails, and so does any file not listed. Each PR
 * that restyles a view lowers its number; the last one to reach zero deletes its entry.
 * Run with --update to re-baseline after a deliberate sweep.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(webRoot, 'spacing-baseline.json');

const SPACING = String.raw`p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y`;
const DIMENSION = String.raw`w|h|size|min-w|min-h|max-w|max-h`;

/**
 * Matches a numeric spacing/dimension utility, with any variant prefixes (lg:, hover:).
 * Deliberately excludes arbitrary values (p-[13px]), fractions (w-1/2) and keywords
 * (w-full, h-auto): those are escape hatches the grid rule does not govern.
 */
const UTILITY = new RegExp(
  String.raw`(?<![\w-])(?:[a-z@\[\]0-9.-]+:)*((?:${SPACING})|(?:${DIMENSION}))-(\d+(?:\.\d+)?)(?![\w./\[%])`,
  'g',
);

/** On the grid when the step is zero or even — n x 4px lands on a multiple of 8. */
const onGrid = (n) => n === 0 || (Number.isInteger(n) && n % 2 === 0);

/** Nearest on-grid step, ties rounding up, so the fix suggestion is never smaller by default. */
function suggest(n) {
  const lower = Math.floor(n / 2) * 2;
  const upper = lower + 2;
  return n - lower < upper - n ? lower : upper;
}

function templates(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) templates(full, found);
    else if (entry.endsWith('.html') || entry.endsWith('.ts')) found.push(full);
  }
  return found;
}

const findings = [];
for (const file of templates(join(webRoot, 'src'))) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(UTILITY)) {
      const step = Number(m[2]);
      if (onGrid(step)) continue;
      findings.push({
        file: relative(webRoot, file),
        line: i + 1,
        column: m.index + 1,
        utility: `${m[1]}-${m[2]}`,
        fix: `${m[1]}-${suggest(step)}`,
        pixels: step * 4,
      });
    }
  });
}

const counts = {};
for (const f of findings) counts[f.file] = (counts[f.file] ?? 0) + 1;

if (process.argv.includes('--update')) {
  writeFileSync(baselinePath, JSON.stringify(counts, Object.keys(counts).sort(), 2) + '\n');
  console.log(
    `Re-baselined: ${findings.length} off-grid utilities across ${Object.keys(counts).length} files.`,
  );
  process.exit(0);
}

let baseline = {};
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch {
  console.error(`Missing ${relative(webRoot, baselinePath)}. Run with --update to create it.`);
  process.exit(2);
}

const over = [];
const under = [];
for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
  const now = counts[file] ?? 0;
  const allowed = baseline[file] ?? 0;
  if (now > allowed) over.push({ file, now, allowed });
  else if (now < allowed) under.push({ file, now, allowed });
}

if (over.length) {
  console.error('\nOff-grid Tailwind spacing utilities beyond the allowed budget.');
  console.error(
    'Tailwind steps are n x 4px, so only zero and even steps land on the 8-point grid.',
  );
  console.error('See CLAUDE.md rule 1.\n');
  for (const { file, now, allowed } of over) {
    console.error(`  ${file} — ${now} off-grid, budget ${allowed}`);
    for (const f of findings.filter((x) => x.file === file)) {
      console.error(
        `    ${f.file}:${f.line}:${f.column}  ${f.utility} (${f.pixels}px) -> ${f.fix}`,
      );
    }
  }
  console.error('');
  process.exit(1);
}

if (under.length) {
  console.log('\nOff-grid budgets are now loose — lower them in this commit:');
  for (const { file, now, allowed } of under)
    console.log(`  ${file} — ${now} off-grid, budget ${allowed}`);
  console.log('Run: npm run lint:spacing -- --update\n');
  process.exit(1);
}

console.log(
  `Spacing grid: ${findings.length} off-grid utilities, all within budget (${Object.keys(baseline).length} files carrying debt).`,
);

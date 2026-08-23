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
import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(webRoot, 'spacing-baseline.json');

const SPACING = String.raw`p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y`;
const DIMENSION = String.raw`w|h|size|min-w|min-h|max-w|max-h`;
/** Offsets read the same --spacing scale, and are fixed dimensions under rule 1. */
const OFFSET = String.raw`inset|inset-x|inset-y|top|right|bottom|left|start|end|scroll-m|scroll-mx|scroll-my|scroll-mt|scroll-mr|scroll-mb|scroll-ml|scroll-p|scroll-px|scroll-py|scroll-pt|scroll-pr|scroll-pb|scroll-pl|translate-x|translate-y`;

/**
 * Matches a numeric spacing/dimension/offset utility, with any variant prefixes (lg:,
 * hover:, [&>*]:) and an optional leading minus.
 *
 * Deliberately excludes arbitrary values (p-[13px]), fractions (w-1/2) and keywords
 * (w-full, h-auto): those are escape hatches the grid rule does not govern.
 *
 * The leading minus is matched rather than excluded by the lookbehind. That lookbehind
 * stops `max-w-3` matching at `w`, but on its own it also swallowed the entire negative
 * arm of the scale, so `-mt-3` was invisible.
 */
const UTILITY = new RegExp(
  String.raw`(?<![\w-])(-?)(?:[a-z@\[\]0-9.&>:_-]+:)*((?:${SPACING})|(?:${DIMENSION})|(?:${OFFSET}))-(\d+(?:\.\d+)?)(?![\w./\[%])`,
  'g',
);

/** On the grid when the step is zero or even — n x 4px lands on a multiple of 8. */
const onGrid = (n) => n === 0 || (Number.isInteger(n) && n % 2 === 0);

/** Nearest on-grid step, exact ties rounding up. */
function suggest(n) {
  const lower = Math.floor(n / 2) * 2;
  const upper = lower + 2;
  return n - lower < upper - n ? lower : upper;
}

function templates(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      continue; // dangling symlink; not worth failing the whole check over
    }
    if (stat.isDirectory()) templates(full, found);
    else if (entry.endsWith('.html') || entry.endsWith('.ts')) found.push(full);
  }
  return found;
}

// "On-grid <=> even step" holds only while --spacing is Tailwind's default 0.25rem
// (n x 4px). Overriding it in @theme would silently invert this tool's meaning.
if (/^\s*--spacing:/m.test(readFileSync(join(webRoot, 'src', 'styles.css'), 'utf8'))) {
  console.error(
    'src/styles.css overrides --spacing, so "even step = on grid" no longer holds.\n' +
      'Update onGrid() before continuing.',
  );
  process.exit(2);
}

const findings = [];
for (const file of templates(join(webRoot, 'src'))) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // An explicit opt-out for the cases the regex cannot get right — a class name in
    // prose or a URL. Without one, an unavoidable false positive could only be silenced
    // by raising a file's budget, which is indistinguishable from real debt.
    if (line.includes('spacing-ok')) return;
    for (const m of line.matchAll(UTILITY)) {
      const [, sign, util, num] = m;
      const step = Number(num);
      if (onGrid(step)) continue;
      findings.push({
        file: relative(webRoot, file),
        line: i + 1,
        column: m.index + 1,
        utility: `${sign}${util}-${num}`,
        fix: `${sign}${util}-${suggest(step)}`,
        pixels: step * 4,
      });
    }
  });
}

const counts = {};
for (const f of findings) counts[f.file] = (counts[f.file] ?? 0) + 1;

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map((k) => [k, counts[k]]),
  );
  writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n');
  console.log(
    `Re-baselined: ${findings.length} off-grid utilities across ${Object.keys(counts).length} files.`,
  );
  console.log('The committed baseline still gates this: a budget that went UP fails.');
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

// The ratchet only ratchets if budgets cannot rise. `--update` is convenient for the
// legitimate downward case, but on its own it will happily write a larger number and go
// green forever — so compare the working baseline against the committed one.
let committed = null;
try {
  committed = JSON.parse(
    execFileSync('git', ['show', 'HEAD:web/spacing-baseline.json'], {
      cwd: webRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  );
} catch {
  committed = null; // no git, or the file is new: nothing to compare against
}

const raised = committed
  ? Object.keys(baseline).filter((f) => (baseline[f] ?? 0) > (committed[f] ?? 0))
  : [];
if (raised.length) {
  console.error('\nOff-grid budgets went UP. The grid ratchet only turns one way.\n');
  for (const f of raised) console.error(`  ${f} — budget ${committed[f] ?? 0} -> ${baseline[f]}`);
  console.error('\nFix the utilities instead of widening the budget.\n');
  process.exit(1);
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

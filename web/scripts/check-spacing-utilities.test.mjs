/**
 * Table-driven fixtures for the utility regex in check-spacing-utilities.mjs.
 *
 * The regex is the only non-obvious part of that script, and it is where its bugs have
 * actually been: the offset family (top-, inset-, right-) was missing entirely, and the
 * negative arm (-mt-3) was invisible because the lookbehind swallowed the minus sign.
 * Both shipped, and both would have been caught here.
 *
 * Run with `npm --prefix web test:spacing` (node --test, no dependencies).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The script is a CLI, so lift the regex out of its source rather than exporting from a
// module that would run the whole check on import.
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'check-spacing-utilities.mjs'),
  'utf8',
);
const build = new Function(`${src.match(/const SPACING[\s\S]*?'g',\n\);/)[0]}\nreturn UTILITY;`);
const flagged = (text) => {
  const re = build();
  const onGrid = (n) => n === 0 || (Number.isInteger(n) && n % 2 === 0);
  return [...text.matchAll(re)]
    .filter((m) => !onGrid(Number(m[3])))
    .map((m) => `${m[1]}${m[2]}-${m[3]}`);
};

const CATCH = [
  // plain spacing
  'gap-3',
  'gap-1.5',
  'gap-0.5',
  'p-3',
  'px-3',
  'py-1',
  'mt-1',
  'mb-1.5',
  'p-2.5',
  // logical properties
  'ps-3',
  'pe-5',
  'ms-1',
  'me-3',
  // axis and space utilities
  'gap-x-3',
  'gap-y-3',
  'space-x-3',
  'space-y-1.5',
  // fixed dimensions
  'w-11',
  'h-11',
  'size-11',
  'min-h-11',
  'max-w-3',
  // offsets — the family that was missing
  'inset-3',
  'inset-x-3',
  'top-3',
  'right-1.5',
  'bottom-1',
  'left-5',
  'start-3',
  'end-3',
  'scroll-mt-3',
  'scroll-p-3',
  'translate-x-3',
  // negatives — the arm that was invisible
  '-mt-3',
  '-mx-1',
  '-top-3',
  '-inset-1',
  // variants
  'lg:gap-3',
  'hover:p-3',
  'md:-mt-3',
  'group-hover:mt-1',
  '[&>*]:gap-3',
  'has-[:checked]:p-3',
  'peer-checked:ms-3',
  'lg:hover:p-3',
];

const IGNORE = [
  // escape hatches the rule does not govern
  'p-[13px]',
  'w-1/2',
  'basis-1/3',
  'w-full',
  'h-auto',
  'mt-px',
  'w-dvw',
  // on-grid, so not findings
  'gap-2',
  'p-4',
  'mt-8',
  'gap-x-2',
  'w-12',
  'p-0',
  'inset-0',
  '-mt-2',
  // not spacing at all
  'grid-cols-3',
  'col-span-3',
  'duration-300',
  'z-10',
  'order-1',
  'opacity-50',
  'border-2',
  'text-3xl',
  'leading-5',
  'rounded-3xl',
  'max-w-3xl',
  'delay-150',
];

test('flags off-grid utilities', () => {
  for (const cls of CATCH) {
    assert.ok(flagged(`class="${cls}"`).length === 1, `expected to flag ${cls}`);
  }
});

test('ignores escape hatches, on-grid steps and non-spacing utilities', () => {
  for (const cls of IGNORE) {
    assert.deepEqual(flagged(`class="${cls}"`), [], `expected to ignore ${cls}`);
  }
});

test('reports the utility with its sign so the suggestion is copy-pasteable', () => {
  assert.deepEqual(flagged('class="-mt-3"'), ['-mt-3']);
  assert.deepEqual(flagged('class="lg:hover:gap-1.5"'), ['gap-1.5']);
});

test('finds every occurrence on a line, not just the first', () => {
  assert.deepEqual(flagged('class="top-1.5 right-1.5"'), ['top-1.5', 'right-1.5']);
});

test('longest utility prefix wins over a shorter alternative', () => {
  // `w` precedes `max-w` in the alternation, so this pins the backtracking behaviour.
  assert.deepEqual(flagged('class="max-w-3"'), ['max-w-3']);
  assert.deepEqual(flagged('class="gap-x-3"'), ['gap-x-3']);
});

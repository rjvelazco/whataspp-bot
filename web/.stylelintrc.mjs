// Only the conventions from ../CLAUDE.md. Deliberately no shared config: Tailwind v4's
// at-rules (@theme, @plugin, @layer) trip stylelint-config-standard, and a flood of
// unrelated CSS-hygiene complaints would bury the rules that matter here.
//
// SCOPE, stated plainly: stylelint sees .css files only. It cannot parse Angular
// templates, so it does NOT see off-grid Tailwind spacing utilities (gap-1.5, px-3, p-3).
// Those are governed by the token scale itself — see docs/design-system.md — not by this
// file. Do not read a green stylelint run as "the grid is enforced everywhere".

/** Every multiple of 8 up to 256px. Generated, so there are no arbitrary gaps. */
const STEPS = Array.from({ length: 32 }, (_, i) => (i + 1) * 8);
/** A literal length: zero, a (possibly negative) multiple of 8, or a keyword.
    Negative values are on the grid too — a -8px bleed is how you cancel padding. */
const BARE = String.raw`(?:0|-?0px|-?(?:${STEPS.join('|')})px|auto|inherit)`;
/** A token, optionally with a fallback — which is itself checked, so
    `var(--card-inset, 16px)` passes and `var(--card-inset, 12px)` does not. */
const TOKEN = String.raw`var\(--[a-z0-9-]+(?:,\s*${BARE})?\)`;
/** One permitted length. */
const LEN = String.raw`(?:${BARE}|${TOKEN})`;
/** A shorthand of up to four such lengths. */
const SPACING = new RegExp(String.raw`^${LEN}(?:\s+${LEN}){0,3}$`);

const SPACING_MESSAGE =
  'Off the 8-point grid. Use a multiple of 8 (or a spacing token). See CLAUDE.md rule 1.';

/** Longhands included: `padding-left: 10px` bypassed a shorthand-only list. */
const SPACING_PROPERTIES = Object.fromEntries(
  [
    'padding',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'padding-inline',
    'padding-block',
    'margin',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'margin-inline',
    'margin-block',
    'gap',
    'row-gap',
    'column-gap',
  ].map((property) => [property, [SPACING]]),
);

export default {
  rules: {
    // Colour is defined in src/styles.css (@theme) and src/app/theme/app-preset.ts,
    // and nowhere else. See CLAUDE.md rule 4.
    'color-no-hex': [true, { message: 'No raw hex. Define the colour as a token and use it.' }],
    'color-named': [
      'never',
      { message: 'No named colours. Define the colour as a token and use it.' },
    ],
    'function-disallowed-list': [
      ['rgb', 'rgba', 'hsl', 'hsla'],
      { message: 'No literal colour functions. Define the colour as a token and use it.' },
    ],

    'declaration-property-value-allowed-list': [SPACING_PROPERTIES, { message: SPACING_MESSAGE }],

    // @apply is a hole in both fences: this file only checks declarations, and the
    // template checker only walks .html/.ts — so `@apply p-3 gap-3` in a stylesheet is
    // invisible to each. It is unused today and the views are pure utilities, so ban it
    // rather than teach two tools to parse it.
    'at-rule-disallowed-list': [
      ['apply'],
      { message: 'No @apply — put utilities in the template, where the grid check can see them.' },
    ],
  },

  overrides: [
    {
      // The token file IS where colours are defined — including the shadow's rgb().
      files: ['src/styles.css'],
      rules: { 'color-no-hex': null, 'color-named': null, 'function-disallowed-list': null },
    },
  ],
};

// Only the conventions from ../CLAUDE.md. Deliberately no shared config: Tailwind v4's
// at-rules (@theme, @plugin, @layer) trip stylelint-config-standard, and a flood of
// unrelated CSS-hygiene complaints would bury the two rules that matter here.

/** Spacing values the 8-point grid permits, plus tokens and keywords. */
const LEN = String.raw`(?:0|(?:8|16|24|32|40|48|56|64|72|80|96|112|128)px|var\(--[a-z0-9-]+\)|auto|inherit)`;
/** A shorthand of up to four such values. */
const SPACING = new RegExp(String.raw`^${LEN}(?: ${LEN}){0,3}$`);

const SPACING_MESSAGE =
  'Off the 8-point grid. Use a multiple of 8 (or a spacing token). See CLAUDE.md rule 1.';

export default {
  rules: {
    // Colour is defined in src/styles.css (@theme) and src/app/theme/app-preset.ts,
    // and nowhere else. See CLAUDE.md rule 4.
    'color-no-hex': [true, { message: 'No raw hex. Define the colour as a token and use it.' }],

    'declaration-property-value-allowed-list': [
      { padding: [SPACING], margin: [SPACING], gap: [SPACING] },
      { message: SPACING_MESSAGE },
    ],
  },

  overrides: [
    {
      // The token file IS where colours are defined.
      files: ['src/styles.css'],
      rules: { 'color-no-hex': null },
    },
    {
      // The app shell is the one part of the UI the Tailwind migration never reached,
      // and it carries ten off-grid values (7px, 9px, 10px, 12px, 20px, 2px, 6px).
      // Step 3 in PR 1 rewrites the shell responsively and puts it on the grid; delete
      // this override in that same change rather than letting it ossify.
      files: ['src/styles.css', 'src/app/dashboard/dashboard.css'],
      rules: {
        'declaration-property-value-allowed-list': [
          { padding: [SPACING], margin: [SPACING], gap: [SPACING] },
          { message: SPACING_MESSAGE, severity: 'warning' },
        ],
      },
    },
  ],
};

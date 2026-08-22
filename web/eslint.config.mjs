// Angular admin panel. The bot package has its own config at the repo root.
//
// A focused rule set that encodes the conventions in ../CLAUDE.md, plus the
// angular-eslint template accessibility rules. It is deliberately not the full
// `recommended` set: broadening it is worth doing as its own change with its own
// cleanup, rather than smuggled in behind a docs PR.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

/** A bare colour literal: #abc, #aabbcc, #aabbccdd. */
const HEX_COLOUR = String.raw`/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/`;

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.angular/**'] },
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'no-console': 'error',

      // Colour lives in the two token files and nowhere else. See ../CLAUDE.md rule 4.
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=${HEX_COLOUR}]`,
          message:
            'No raw hex colours. Define the colour in src/styles.css (@theme) or src/app/theme/app-preset.ts and use the token.',
        },
        {
          selector: `TemplateElement[value.raw=${HEX_COLOUR}]`,
          message:
            'No raw hex colours. Define the colour in src/styles.css (@theme) or src/app/theme/app-preset.ts and use the token.',
        },
      ],
    },
  },
  {
    // The PrimeNG preset IS the place colours are defined.
    files: ['src/app/theme/app-preset.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // console.error in the bootstrap catch is correct — there is no logger in the
    // browser, and a failed bootstrap has no UI left to report through.
    files: ['src/main.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {
      // Accessibility floor from ../CLAUDE.md. A named list rather than
      // templateAccessibility, so adding a rule here is a deliberate decision.
      '@angular-eslint/template/interactive-supports-focus': 'error',
      '@angular-eslint/template/click-events-have-key-events': 'error',
      '@angular-eslint/template/alt-text': 'error',
      '@angular-eslint/template/valid-aria': 'error',
      '@angular-eslint/template/role-has-required-aria': 'error',

      // A <label> wrapping its control is valid implicit labelling, but the rule only
      // recognises native form elements. Teach it the PrimeNG controls this app uses.
      '@angular-eslint/template/label-has-associated-control': [
        'error',
        {
          controlComponents: [
            'p-select',
            'p-inputnumber',
            'p-toggleswitch',
            'p-datepicker',
            'p-selectbutton',
            'p-textarea',
            'p-checkbox',
            'p-fileupload',
          ],
        },
      ],

      // Deliberately NOT enabled: @angular-eslint/template/elements-content. PrimeNG
      // renders button and anchor content from a `label` input, which the rule cannot
      // see, so it fires on the app's dominant button idiom. A rule that is wrong about
      // <a pButton label="Mensaje"> does not earn its place.
    },
  },
  {
    // Pre-existing accessibility debt, carried as warnings so `npm run lint` stays
    // green while it is worked off. Each entry names the step that clears it; delete
    // the entry in that same change rather than letting this block ossify.
    //
    // configuracion.html, three findings, all real:
    //   - the CDK drag handle has a click handler but no keyboard path, so menu
    //     reordering is mouse-only;
    //   - two <label> elements are used as section headings and label nothing (the
    //     trigger-word input is their sibling, and the attachment list has no control
    //     at all), so a screen reader announces a label with no target.
    // Both are cleared by PR 6, which rebuilds the menu editor (step 16) and adds a
    // keyboard reorder affordance in the accessibility audit (step 17).
    files: ['src/app/configuracion/configuracion.html'],
    rules: {
      '@angular-eslint/template/interactive-supports-focus': 'warn',
      '@angular-eslint/template/click-events-have-key-events': 'warn',
      '@angular-eslint/template/label-has-associated-control': 'warn',
    },
  },
);

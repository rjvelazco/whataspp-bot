// Angular admin panel. The bot package has its own config at the repo root.
//
// A focused rule set that encodes the conventions in ../CLAUDE.md, plus the
// angular-eslint template accessibility rules. It is deliberately not the full
// `recommended` set: broadening it is worth doing as its own change with its own
// cleanup, rather than smuggled in behind a docs PR.
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

/**
 * A hex colour anywhere in a string — deliberately NOT anchored, so it also fires inside
 * a longer literal such as `border: 1px solid #4f46e5`. Longest alternative first, and a
 * trailing \b, so #aabbcc is not reported as a 3-digit match.
 */
const HEX_COLOUR = String.raw`/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/`;

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.angular/**'] },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      // The browser has no logger, and swallowing a failure to keep this rule quiet is
      // worse than the rule: an operation that fails deterministically needs a trace
      // somewhere. console.log debugging is still banned.
      'no-console': ['error', { allow: ['error', 'warn'] }],

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

      '@angular-eslint/template/elements-content': 'error',
    },
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

      '@angular-eslint/template/elements-content': 'error',
    },
  },
  {
    // pedidos.html has the app's one empty <a pButton></a>: PrimeNG renders its content
    // from the `label` input at runtime, which elements-content cannot see. Scoped off
    // here rather than disabled globally — it is one template, not a widespread idiom.
    files: ['src/app/pedidos/pedidos.html'],
    rules: { '@angular-eslint/template/elements-content': 'off' },
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

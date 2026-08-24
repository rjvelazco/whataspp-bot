import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';

/**
 * App theme preset. This file and the @theme block in src/styles.css are the only two
 * places a colour may be defined — see ../../../CLAUDE.md rule 4.
 *
 * It carries more weight than it looks: the tailwindcss-primeui plugin derives the
 * Tailwind *-primary-* and *-surface-* utilities from these ramps, so editing this file
 * re-tints every PrimeNG component AND every one of those utilities at once. That is why
 * dropping violet for emerald is a small diff rather than a sweep through every template.
 *
 * Mapping to the design tokens in src/styles.css:
 *   --color-signal       #0A6C48  -> primary.600  (the bot / verified / primary action)
 *   --color-signal-ink   #075437  -> primary.700  (hover, active, on-soft text)
 *   --color-signal-soft  #DCEEE3  -> primary.50   (highlight background)
 *   --color-paper        #FFFFFF  -> surface.0
 *   --color-wash         #EEF2EE  -> surface.50
 *   --color-line-soft    #EAEFEC  -> surface.100
 *   --color-line         #DCE4E1  -> surface.200
 *   --color-ink-3        #7D9199  -> surface.400  (muted text, placeholders)
 *   --color-ink-2        #41585F  -> surface.500  (secondary text)
 *   --color-ink          #101A21  -> surface.700  (Aura reads text.color from surface.700;
 *                                                 950 is never used as a text colour)
 */
export const AppPreset = definePreset(Aura, {
  semantic: {
    // Emerald, anchored on the design system's signal colour at 600 and its hover/active
    // shade at 700. The rest of the ramp is interpolated around those two fixed points.
    primary: {
      50: '#dceee3',
      100: '#bcdecb',
      200: '#93c9ac',
      300: '#63ae89',
      400: '#35906a',
      500: '#157a54',
      600: '#0a6c48',
      700: '#075437',
      800: '#06422c',
      900: '#053626',
      950: '#022017',
    },
    colorScheme: {
      light: {
        primary: {
          color: '{primary.600}',
          contrastColor: '#ffffff',
          hoverColor: '{primary.700}',
          activeColor: '{primary.700}',
        },
        highlight: {
          background: '{primary.50}',
          focusBackground: '{primary.100}',
          color: '{primary.700}',
          focusColor: '{primary.700}',
        },
        // Neutrals. 0/50/100/200/400/500/700 are the design tokens (paper, wash,
        // line-soft, line, and the three ink weights); 300/600/800/900/950 are
        // interpolated around them. Slightly green-cast greys, so they sit with the
        // emerald rather than fighting it.
        surface: {
          0: '#ffffff',
          50: '#eef2ee',
          100: '#eaefec',
          200: '#dce4e1',
          300: '#c6d2cc',
          400: '#7d9199',
          500: '#41585f',
          600: '#2a3c42',
          // Aura's light scheme takes text.color from here — keep it equal to
          // --color-ink so plain markup and PrimeNG text match.
          700: '#101a21',
          800: '#0d151b',
          900: '#0a1116',
          // Continues the ramp. It previously repeated 700, which made it *lighter*
          // than 900 — so bg-surface-950 rendered lighter than bg-surface-900.
          950: '#060a0d',
        },
      },
    },
  },
  components: {
    /**
     * Tags carry the design system's own rose/amber/emerald, not Aura's ramps.
     *
     * p-tag drove StatusTag, PayBadge and the stock badges off Aura's red/orange
     * (#B91C1C on #FEE2E2, #C2410C on #FFEDD5), which are near enough to look deliberate
     * and wrong enough to break rule 4. One block here re-tints every call site.
     */
    tag: {
      colorScheme: {
        light: {
          primary: { background: '#dceee3', color: '#075437' },
          success: { background: '#dceee3', color: '#075437' },
          warn: { background: '#fbeacc', color: '#8f5300' },
          danger: { background: '#fadfdc', color: '#9e241b' },
          secondary: { background: '#eaefec', color: '#41585f' },
          info: { background: '#eaefec', color: '#41585f' },
        },
      },
    },

    /**
     * A text button keeps a hairline border at rest.
     *
     * PrimeNG's text variant is transparent-bordered, so the row actions in Productos —
     * the only two controls that act on a row — were invisible until hover, in a view
     * that has to work at 390px where there is no hover. That is rule 6.
     */
    button: {
      colorScheme: {
        light: {
          text: {
            secondary: { hoverBackground: '#eaefec', activeBackground: '#dce4e1' },
            danger: { hoverBackground: '#fadfdc', activeBackground: '#fadfdc' },
          },
        },
      },
    },
  },
});

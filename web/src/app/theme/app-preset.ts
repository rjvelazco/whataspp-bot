import { definePreset } from '@primeng/themes';
import Aura from '@primeng/themes/aura';

/**
 * App theme preset — ports the hand-rolled design tokens from styles.css into the
 * Aura preset so every PrimeNG component inherits the store-admin look for free.
 *
 * Mapping from the old CSS custom properties:
 *   --text-accent / --border-accent  #4f46e5  -> primary.600 (indigo)
 *   --bg-accent                      #eef0fe  -> primary.50 (highlight background)
 *   --surface-0                      #ffffff  -> surface.0
 *   --surface-2                      #fafbfc  -> surface.50
 *   --surface-1                      #f5f6f8  -> surface.100
 *   --border                         #e6e8eb  -> surface.200
 *   --border-strong                  #d5d8dd  -> surface.300
 *   --text-muted                     #9aa4ae  -> surface.400
 *   --text-secondary                 #5b6570  -> surface.500
 *   --text-primary                   #1a1d21  -> surface.950
 */
export const AppPreset = definePreset(Aura, {
  semantic: {
    // Indigo accent (Tailwind indigo scale; 600 = the old #4f46e5 accent).
    primary: {
      50: '#eef2ff',
      100: '#e0e7ff',
      200: '#c7d2fe',
      300: '#a5b4fc',
      400: '#818cf8',
      500: '#6366f1',
      600: '#4f46e5',
      700: '#4338ca',
      800: '#3730a3',
      900: '#312e81',
      950: '#1e1b4b',
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
        // Neutral surfaces tuned to the old grey tokens.
        surface: {
          0: '#ffffff',
          50: '#fafbfc',
          100: '#f5f6f8',
          200: '#e6e8eb',
          300: '#d5d8dd',
          400: '#9aa4ae',
          500: '#5b6570',
          600: '#4b545e',
          700: '#3a424b',
          800: '#292f36',
          900: '#1f242a',
          950: '#1a1d21',
        },
      },
    },
  },
});

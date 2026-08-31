import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService, MessageService } from 'primeng/api';
import { AppPreset } from './theme/app-preset';
import { routes } from './app.routes';

/**
 * Spanish date formatting. Registered rather than set as LOCALE_ID: the views ask for
 * 'es' explicitly where they want Spanish month names, while money keeps the "$12.00"
 * form the design uses. A global LOCALE_ID would also turn every amount into "12,00 US$".
 */
registerLocaleData(localeEs);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(),
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: AppPreset,
        options: {
          // Keep the admin light-only: this class is never applied to <html>.
          darkModeSelector: '.app-dark',
          // Emit PrimeNG styles into the `primeng` layer declared in styles.css.
          cssLayer: { name: 'primeng', order: 'theme, base, primeng, components, utilities' },
        },
      },
    }),
    MessageService,
    ConfirmationService,
  ],
};

import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  type ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { authInterceptor } from './core/auth.interceptor';
import { ConfigService } from './core/config.service';
import { SessionService } from './core/session.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Load instance config (theme + setup state) and seat any existing token
    // before the first route resolves — independent reads, one round trip.
    provideAppInitializer(async () => {
      const config = inject(ConfigService);
      const session = inject(SessionService);
      await Promise.all([config.load(), session.restore()]);
    }),
  ],
};

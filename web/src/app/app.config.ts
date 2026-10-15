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
    // Load instance config (theme + setup state), then seat any existing token,
    // before the first route resolves.
    provideAppInitializer(async () => {
      const config = inject(ConfigService);
      const session = inject(SessionService);
      await config.load();
      await session.restore();
    }),
  ],
};

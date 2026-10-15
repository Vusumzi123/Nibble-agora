import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';

import { ConfigService } from './config.service';
import { SessionService } from './session.service';

/** The seat needs a configured instance and a seated token. */
export const seatGuard: CanActivateFn = () => {
  const config = inject(ConfigService);
  const session = inject(SessionService);
  const router = inject(Router);
  if (!config.configured()) return router.parseUrl('/setup');
  return session.connected() ? true : router.parseUrl('/login');
};

/** Login only makes sense once the instance is set up. */
export const loginGuard: CanActivateFn = () => {
  const config = inject(ConfigService);
  const router = inject(Router);
  return config.configured() ? true : router.parseUrl('/setup');
};

/** The setup wizard is a one-time thing. */
export const setupGuard: CanActivateFn = () => {
  const config = inject(ConfigService);
  const router = inject(Router);
  return config.configured() ? router.parseUrl('/') : true;
};

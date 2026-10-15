import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { SessionService } from './session.service';

/** Attaches the bearer token to every request once the seat is connected. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(SessionService).token();
  if (!token) return next(req);
  return next(req.clone({ setHeaders: { authorization: `Bearer ${token}` } }));
};

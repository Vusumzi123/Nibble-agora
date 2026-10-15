# Agora — web seat (Angular 22)

The human read/write seat for the Agora forum. A standalone Angular application
that talks to the Agora REST API (same origin when served by the Node service).

## Commands

```sh
npm install         # once
npm run build       # ng build → dist/agora/browser (served by `npm start` at the repo root)
npm start           # ng serve — dev server only; point it at a running Agora API
npm test            # ng test (vitest + jsdom)
```

When developing against the real API, run the service from the repo root
(`npm start`) and `npm run build:web` there, or use `npm start` here and set a
proxy. Production serving is done by `src/server/static.ts`, which serves the
built bundle with an SPA fallback.

## Structure

```
src/app/
├── app.config.ts        providers: router, HttpClient + auth interceptor, config + seat bootstrap
├── app.routes.ts        setup · login · guard-seated shell (threads · board · inbox · settings)
├── core/
│   ├── models.ts        domain types mirroring the REST payloads
│   ├── api.service.ts   typed REST client + ApiError
│   ├── auth.interceptor.ts  attaches the bearer token
│   ├── session.service.ts   token · identity · limits (localStorage-backed)
│   ├── config.service.ts    instance config: setup state, forum name, theme
│   ├── theme.ts             theme registry + `applyTheme` (data-theme)
│   ├── forum.store.ts       signal store: boards/threads/cards/inbox + ~3 s polling
│   ├── seat.guard.ts        setup/login/seat route guards
│   ├── status.service.ts    transient status/flash messages
│   └── time.ts              `when` formatter + pipe
├── shared/              CategoryBadge · CharCounter · text helpers
├── themes/calm.css      calm theme — light, blue & violet (--ph-* overrides)
└── features/            setup · login · rail · shell · threads · board · inbox · settings
```

The seat's own layout lives in `src/styles.css` on Phosphorstrap `--ph-*` tokens;
Bootstrap, Phosphorstrap, and the calm theme are bundled via `angular.json`.

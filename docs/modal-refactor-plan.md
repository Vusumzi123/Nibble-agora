# Agora — shared modal component

Implementation plan. Status: implemented 2026-10-23 on top of `12ca8cd`
("i18n service with locale config, and inbox mention dismissal").

## Why

Every overlay modal in the web seat hand-rolls the same scrim → card → header
markup and its own click/Escape handling. The result is five near-identical
implementations with divergent behaviour: the thread composer has no
`role="dialog"`, `aria-modal` or Escape at all; the sort menu puts the dialog
role on the scrim; board settings repeats `(keydown.escape)` on every input;
and a drag that starts inside a modal and releases on the scrim still counts
as an outside click and closes the dialog.

One `app-modal` component should own the scrim, the panel, the header, and
the shared behaviour; each feature keeps only its internal view.

## Inventory (current commit)

| Site | File | Notes |
| --- | --- | --- |
| Create project | `web/src/app/features/boards/boards.html:6` | default header + `×`, `aria-labelledby`, width via `.boards__modal` |
| New thread composer | `web/src/app/features/threads/threads.html:87` | no `role` / `aria-modal` / Escape; width from `.ph-panel` |
| Sort menu | `web/src/app/features/threads/threads.html:131` | `--menu` variant; dialog role on the scrim |
| Board settings | `web/src/app/features/board/board.html:100` | per-input Escape bindings; `.board__settings` width |
| Card detail | `web/src/app/features/board/card-detail.html:1` | root element is the scrim; custom header (title input, blocked badge, `×`) |
| Confirm dialog | `web/src/app/shared/confirm-dialog.ts` | already a component, but hand-rolls its own scrim; nests inside card detail |

Shared CSS already exists in `web/src/styles.css:379` (`.overlay`,
`.overlay__card`, `.overlay__card--menu`), so only markup and behaviour are
duplicated. Angular 22, standalone components, signals, vitest + jsdom for the
web seat. No `@angular/cdk` is installed; this plan adds no dependency.

`shared/blocking-overlay.ts` is a busy curtain, not a modal — it stays as-is.

## Design

### `web/src/app/shared/modal.ts` — `Modal`, selector `app-modal`

Template: `.overlay` scrim containing `.overlay__card` with `role="dialog"`,
`aria-modal="true"`, `[attr.aria-labelledby]` from `labelledBy()` or the
default header's generated id, and `[attr.aria-label]` from `ariaLabel()`.
Clicks inside the card stop propagation.

Inputs:

| Input | Type | Purpose |
| --- | --- | --- |
| `title` | `string` | Renders the default `.ph-panel__header` with this label |
| `showClose` | `boolean` (default `true`) | Adds the default header `×` that emits `closed` |
| `variant` | `'card' \| 'menu'` (default `'card'`) | Adds `overlay__card--menu` |
| `panelClass` | `string` | Feature class/width (e.g. `boards__modal`, `card-detail`, `ph-panel composer`) |
| `activeClass` | `string` | State class applied to the panel (e.g. `card-detail--blocked`) |
| `labelledBy` | `string` | Id of a projected heading, for custom headers |
| `ariaLabel` | `string` | Fallback accessible name when no heading is projected |
| `headingId` | `string` | Stable id for the default header title (generated when omitted) |

Output: `closed` — emitted by the scrim guard, the default `×`, and Escape.

Header projection uses Angular's `ng-content` fallback (18+):

```html
<ng-content select="[modal-header]">
  <header class="ph-panel__header">
    <span [id]="headingId()">{{ title() }}</span>
    @if (showClose()) {
      <button class="btn btn-sm btn-outline-secondary btn-icon" type="button"
              [attr.aria-label]="i18n.t('shell.close')" (click)="closed.emit()">…</button>
    }
  </header>
</ng-content>
<ng-content />
```

So a feature that projects `<header modal-header>` keeps full control (card
detail) while every other modal gets the standard header for free.

Callers keep their own `@if (open)` / `@if (someOpen)` wrapper. Content is
destroyed on close exactly as today, so no form state leaks between opens.

### `web/src/app/shared/modal-stack.ts` — modal stack service

Injected by `Modal`, owns the behaviours that cannot live in one instance:

- **Depth counter** for the body scroll lock: first open saves
  `document.body.style.overflow`, sets `hidden`; last close restores it.
- **Focus save/restore**: remembers `document.activeElement` on open and
  restores it on destroy if the element is still connected.
- **Initial focus**: focus the first focusable element in the card (or the
  card itself with `tabindex="-1"`). Features that already focus a specific
  input via `setTimeout` (boards, board settings) still win, because their
  timer runs after the component's microtask.
- **Escape**: one `document` keydown listener; only the topmost registered
  modal closes. This is what keeps `app-confirm-dialog` nested inside
  `app-card-detail` from closing both layers.
- **Tab trap**: cycle focus among the card's focusable elements while the
  modal is topmost. No CDK required.

### Scrim click guard (down and up must both be on the scrim)

A browser dispatches `click` on the nearest common ancestor of the
pointerdown and pointerup targets, so a drag from the card to the scrim
produces a click whose target is the overlay. Matching the click target alone
cannot reject that drag; the component must remember where the press started
and where it ended.

- `viewChild` ref to the scrim element.
- `(pointerdown)` on `.overlay`: `sawPointer = true`,
  `downOnScrim = event.target === scrim`.
- `(pointerup)` on `.overlay`: `upOnScrim = event.target === scrim`.
- `(pointercancel)`: clear `downOnScrim` / `upOnScrim`.
- `(click)` on `.overlay`: ignore unless `event.target === scrim`; close only
  when `downOnScrim && upOnScrim`, or when `!sawPointer` (fallback for
  synthetic `.click()` in jsdom and existing specs). Reset all three flags
  after every click.

Result: text selection or a drag that starts in the panel and ends on the
scrim no longer dismisses the modal; a genuine press-and-release on the scrim
does.

## Migration

Keep every existing class name so current selectors and specs stay valid
(`.boards__modal`, `.board__settings`, `.card-detail`, `.overlay`,
`.ph-panel__header`, `.confirm`).

1. **boards** — `features/boards/boards.html`: replace the wrapper and header
   with `<app-modal [title]="i18n.t('boards.newProject')"
   headingId="new-project-title" panelClass="boards__modal"
   (closed)="closeCreate()">`; keep the form and
   `boards__modal-actions`; keep the existing `setTimeout` focus on
   `#nameInput`.
2. **threads composer** — `<app-modal [title]="i18n.t('threads.newThread')"
   [showClose]="false" panelClass="ph-panel composer"
   (closed)="closeComposer()">`.
3. **threads sort** — `<app-modal [title]="i18n.t('threads.sortBy')"
   variant="menu" [showClose]="false" (closed)="closeSort()">`. Make
   composer and sort mutually exclusive (opening one closes the other).
   Remove `@HostListener('document:keydown.escape')` from
   `features/threads/threads.ts:85`; the stack handles Escape now.
4. **board settings** — `<app-modal [title]="i18n.t('board.settings')"
   [showClose]="false" panelClass="board__settings"
   (closed)="closeSettings()">`; drop the three `(keydown.escape)` bindings
   inside the form.
5. **card detail** — replace the root `<div class="overlay">` with
   `<app-modal panelClass="card-detail"
   [activeClass]="blocked() ? 'card-detail--blocked' : ''"
   [showClose]="false" [labelledBy]="…" (closed)="closed.emit()">`; project
   the existing header as
   `<header modal-header class="ph-panel__header card-detail__header">`;
   give the read-mode `h2` the id `card-detail-heading` and keep
   `card-detail-title` on the edit-mode input; `labelledBy` switches between
   them.
6. **confirm dialog** — `shared/confirm-dialog.ts` renders
   `<app-modal [title]="title() ?? i18n.t('shell.confirm')" [showClose]="false"
   panelClass="confirm" (closed)="cancelled.emit()">`; keep the cancel-button
   focus `@ViewChild` and the existing outputs.
7. **blocking overlay** — unchanged.

## Tests

New `web/src/app/shared/modal.spec.ts`:

- default header renders `title`; projected `[modal-header]` replaces it.
- scrim click closes; card click does not.
- pointerdown + pointerup on scrim closes.
- pointerdown in the card, pointerup/click on the scrim does not close.
- pointerdown on the scrim, pointerup over the card does not close.
- bare `.click()` on the scrim still closes (jsdom fallback).
- Escape closes only the topmost modal; stacked modals close one at a time.
- body scroll lock engages once and restores on the last close.
- focus returns to the trigger element on close.
- `variant="menu"` applies `overlay__card--menu`.

Existing specs must pass untouched:
`features/boards/boards.spec.ts:131` (`.boards__modal`),
`features/board/card-tile.spec.ts:91` (`.overlay` click),
`shared/confirm-dialog.spec.ts` (`.ph-panel__header` text).

## Verification

```sh
cd Projects/Nibble-agora
npm test                 # node --test, 51 tests at plan time
npm run typecheck
cd web && npx ng test --watch=false   # 25 files / 106 tests at plan time
npx ng build
```

## Implementation notes (as built)

- Panel-level rules that used to live in feature stylesheets had to move to
  `web/src/styles.css`: the panel element is rendered by `app-modal`, so
  emulated encapsulation no longer matches `.boards__modal`,
  `.board__settings`, `.confirm`, `.card-detail` or `.card-detail--blocked`.
  Everything projected keeps its feature-scoped styles.
- `headingId` exists so the existing `#new-project-title` contract (and its
  spec) survives the extraction.
- Threads now opens the sort menu and the composer exclusively, which replaces
  the old "Escape closes both" handler.
- Scrim-close keeps a synthetic-click fallback (`!sawPointer`) for jsdom and
  assistive clicks; real gestures must start and end on the scrim.

## Risks and non-goals

- **Nested modals**: card detail opens confirm-dialog on top. The stack's
  topmost-only Escape and depth-counted scroll lock are the mitigation; the
  spec above covers it.
- **Projected header styling**: a projected header must carry
  `ph-panel__header` itself, since fallback-class merging does not apply.
- Not in scope: `blocking-overlay` (busy curtain), the side panel and the
  inbox/thread views (not modal overlays), and any router-driven dialog
  state.

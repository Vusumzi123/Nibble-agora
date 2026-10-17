import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { ForumStore } from '../../core/forum.store';
import type { Card } from '../../core/models';
import { CardTile } from './card-tile';

const CARD: Card = {
  id: 3,
  board_id: 7,
  column_id: 1,
  position: 0,
  title: 'ship it',
  body: 'first line of the body\nway more follows',
  assignee_id: null,
  created_by: 1,
  created_at: '2026-10-16T00:00:00.000Z',
  updated_at: '2026-10-16T00:00:00.000Z',
  done_at: null,
};

describe('CardTile (excerpt + click-through to the modal)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(CardTile);
    fixture.componentRef.setInput('card', CARD);
    fixture.detectChanges();
    return fixture;
  }

  it('flattens the body into a snippet; title clamps at 1 line, snippet at 3', () => {
    const el = render().nativeElement as HTMLElement;
    const title = el.querySelector('.kanban-card__title');
    const desc = el.querySelector('.kanban-card__desc');
    expect(desc?.textContent).toContain('first line of the body way more follows');
    expect(title?.classList.contains('ellipsis')).toBe(true);
    expect(title?.classList.contains('ellipsis--multi')).toBe(false);
    expect(desc?.classList.contains('ellipsis')).toBe(true);
    expect(desc?.classList.contains('ellipsis--multi')).toBe(true);
    expect(desc?.getAttribute('style')).toContain('--ellipsis-lines: 3');
  });

  it('opens the card detail modal on the tile text, closes it again', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-card-detail')).toBeNull();

    el.querySelector<HTMLElement>('.kanban-card__open')?.click();
    fixture.detectChanges();
    expect(el.querySelector('app-card-detail')).toBeTruthy();

    el.querySelector<HTMLElement>('.overlay')?.click();
    fixture.detectChanges();
    expect(el.querySelector('app-card-detail')).toBeNull();
  });

  it('the trash button asks via the confirm dialog: keep aborts, delete issues DELETE', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    store.view.set('settings');

    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    // no ✓ done button anymore
    expect(el.querySelector('[title="mark done"]')).toBeNull();

    el.querySelector<HTMLButtonElement>('[title="delete card"]')?.click();
    fixture.detectChanges();
    const dialog = el.querySelector('app-confirm-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain('delete this card?');

    // the footer stays put now — only the dialog toggles
    expect(el.querySelector('.kanban-card__foot')).toBeTruthy();
    dialog!.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    expect(el.querySelector('app-confirm-dialog')).toBeNull();

    el.querySelector<HTMLButtonElement>('[title="delete card"]')?.click();
    fixture.detectChanges();
    el.querySelector<HTMLElement>('app-confirm-dialog .btn-danger')?.click();
    await new Promise((r) => setTimeout(r, 0));

    const req = http.expectOne('/api/cards/3');
    expect(req.request.method).toBe('DELETE');
    req.flush({ ok: true, id: 3 });
    await new Promise((r) => setTimeout(r, 0));
    http.expectOne('/api/forums').flush({ forums: [] });
  });
});

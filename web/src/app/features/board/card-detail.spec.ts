import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForumStore } from '../../core/forum.store';
import type { Card } from '../../core/models';
import { CardDetail } from './card-detail';

const CARD: Card = {
  id: 3,
  board_id: 7,
  column_id: 1,
  position: 0,
  title: 'ship it',
  body: 'first line\nsecond line',
  assignee_id: null,
  created_by: 1,
  created_at: '2026-10-16T00:00:00.000Z',
  updated_at: '2026-10-16T00:00:00.000Z',
  done_at: null,
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('CardDetail (the card body modal)', () => {
  let http: HttpTestingController;
  let store: ForumStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(ForumStore);
    // keep the post-save refresh cycle to the forums call only
    store.view.set('settings');
  });

  function open() {
    const fixture = TestBed.createComponent(CardDetail);
    fixture.componentRef.setInput('card', CARD);
    fixture.detectChanges();
    return fixture;
  }

  it('seeds title and body from the card', async () => {
    const fixture = open();
    await tick(); // ngModel writes its value to the inputs in a microtask
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector<HTMLInputElement>('#card-detail-title')?.value).toBe('ship it');
    expect(el.querySelector<HTMLTextAreaElement>('#card-detail-body')?.value).toBe(CARD.body);
  });

  it('PATCHes title and body on save, then reports closed', async () => {
    const fixture = open();
    const el = fixture.nativeElement as HTMLElement;
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    const comp = fixture.componentInstance as unknown as {
      title: { set: (v: string) => void };
      body: { set: (v: string) => void };
      save: () => Promise<void>;
    };
    comp.title.set('ship it now');
    comp.body.set('rewritten');
    fixture.detectChanges();

    const saving = comp.save();
    const req = http.expectOne('/api/cards/3');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ title: 'ship it now', body: 'rewritten' });
    req.flush({ card: { ...CARD, title: 'ship it now', body: 'rewritten' } });

    await tick();
    http.expectOne('/api/forums').flush({ forums: [] });

    await saving;
    expect(closed).toHaveBeenCalledOnce();
  });

  it('disables save while the title is blank', () => {
    const fixture = open();
    const comp = fixture.componentInstance as unknown as { title: { set: (v: string) => void } };
    comp.title.set('   ');
    fixture.detectChanges();

    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.card-detail__actions button',
      ),
    );
    const save = buttons.find((b) => b.textContent?.includes('save'));
    expect(save?.disabled).toBe(true);
  });

  it('cancel closes without any request', () => {
    const fixture = open();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    const cancel = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('.card-detail__actions button');
    cancel?.click();

    expect(closed).toHaveBeenCalledOnce();
  });
});

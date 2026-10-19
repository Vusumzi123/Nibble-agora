import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForumStore } from '../../core/forum.store';
import { BusyService } from '../../core/busy.service';
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
  blocked_at: null,
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

  const toggleSwitch = (fixture: { nativeElement: HTMLElement }): HTMLInputElement =>
    fixture.nativeElement.querySelector<HTMLInputElement>('.card-detail__switch input')!;

  function open(comments: unknown[] = []) {
    const fixture = TestBed.createComponent(CardDetail);
    fixture.componentRef.setInput('card', CARD);
    fixture.detectChanges();
    http.expectOne('/api/cards/3/comments').flush({ card_id: CARD.id, comments });
    fixture.detectChanges();
    return fixture;
  }

  it('opens with the title in the header and the body in read mode', async () => {
    const fixture = open();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    // The header carries the real title; the form no longer repeats it.
    expect(el.querySelector('.card-detail__title')?.textContent?.trim()).toBe('ship it');
    expect(el.querySelector('#card-detail-title')).toBeNull();

    // Read mode: the body is prose, not a textarea.
    const preview = el.querySelector('.card-detail__preview');
    expect(preview?.textContent).toContain('first line');
    expect(preview?.textContent).toContain('second line');
    expect(el.querySelector('#card-detail-body')).toBeNull();

    // The view/edit switch flips to the raw markdown source.
    const toggle = toggleSwitch(fixture);
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.checked).toBe(false);
    toggle.click();
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
    expect(el.querySelector<HTMLTextAreaElement>('#card-detail-body')?.value).toBe(CARD.body);

    // And back — the same switch returns to the preview.
    expect(toggle.checked).toBe(true);
    toggle.click();
    fixture.detectChanges();
    expect(el.querySelector('#card-detail-body')).toBeNull();
    expect(el.querySelector('.card-detail__preview')).not.toBeNull();
  });

  it('opens the editor when the rendered body is double-clicked', async () => {
    const fixture = open();
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector('.card-detail__preview')!.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();

    const textarea = el.querySelector<HTMLTextAreaElement>('#card-detail-body');
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toBe(CARD.body);
    expect(el.querySelector('.card-detail__preview')).toBeNull();
  });

  it('renames the card from the header on double click', async () => {
    const fixture = open();
    const el = fixture.nativeElement as HTMLElement;
    const title = () => el.querySelector('.card-detail__title')?.textContent?.trim();
    const openEditor = async () => {
      el.querySelector('.card-detail__title')!.dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true }),
      );
      fixture.detectChanges();
      await tick(); // ngModel copies the draft into the input
      fixture.detectChanges();
      return el.querySelector<HTMLInputElement>('#card-detail-title')!;
    };

    const input = await openEditor();
    expect(input.value).toBe('ship it');

    input.value = 'renamed';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(title()).toBe('renamed');
    expect(el.querySelector('#card-detail-title')).toBeNull();

    // Escape drops the draft and restores the committed title.
    const again = await openEditor();
    again.value = 'discarded';
    again.dispatchEvent(new Event('input'));
    again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(title()).toBe('renamed');
  });

  it('offers an owner picker and saves the chosen assignee', async () => {
    const fixture = open();
    const el = fixture.nativeElement as HTMLElement;
    store.agents.set([
      {
        id: 2,
        handle: 'kael',
        display_name: 'Kael',
        is_human: 0,
        color: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    fixture.detectChanges();

    const select = el.querySelector<HTMLSelectElement>('#card-detail-assignee')!;
    expect(select.options.length).toBe(2);
    expect(select.options[0].textContent?.trim()).toBe('unassigned');
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const comp = fixture.componentInstance as unknown as { save: () => Promise<void> };
    const saving = comp.save();
    const req = http.expectOne('/api/cards/3');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ title: 'ship it', body: CARD.body, assignee: 2 });
    req.flush({ card: { ...CARD, assignee_id: 2 } });

    await tick();
    http.expectOne('/api/forums').flush({ forums: [] });
    await saving;
  });

  it('preselects the card owner in the picker', () => {
    store.agents.set([
      {
        id: 2,
        handle: 'kael',
        display_name: 'Kael',
        is_human: 0,
        color: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const fixture = TestBed.createComponent(CardDetail);
    fixture.componentRef.setInput('card', { ...CARD, assignee_id: 2 });
    fixture.detectChanges();
    http.expectOne('/api/cards/3/comments').flush({ card_id: CARD.id, comments: [] });
    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      '#card-detail-assignee',
    )!;
    expect(select.value).toBe('2');
  });

  it('posts the pending comment with the card save and stays open', async () => {
    const fixture = open([
      {
        id: 1,
        card_id: 3,
        author_id: 2,
        body: 'waiting on the API',
        created_at: '2026-10-16T00:00:00.000Z',
        author_handle: 'kael',
        author_is_human: 0,
      },
    ]);
    await tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    expect(el.querySelector('.card-comment__author')?.textContent?.trim()).toBe('@kael');
    expect(el.querySelector('.card-comment__body')?.textContent).toContain('waiting on the API');

    const comp = fixture.componentInstance as unknown as {
      commentDraft: { set: (v: string) => void };
      save: () => Promise<void>;
    };
    comp.commentDraft.set('on it');
    fixture.detectChanges();

    // No standalone comment button — Save carries the draft.
    expect(
      Array.from(el.querySelectorAll<HTMLButtonElement>('.card-detail__actions button')).some(
        (button) => button.textContent?.trim() === 'comment',
      ),
    ).toBe(false);

    const saving = comp.save();
    expect(TestBed.inject(BusyService).label()).toBe('saving card');

    const patch = http.expectOne('/api/cards/3');
    expect(patch.request.method).toBe('PATCH');
    patch.flush({ card: CARD });
    await tick();

    const req = http.expectOne('/api/cards/3/comments');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ body: 'on it' });
    req.flush({
      comment: {
        id: 2,
        card_id: 3,
        author_id: 1,
        body: 'on it',
        created_at: '2026-10-16T00:01:00.000Z',
        author_handle: 'vuszi',
        author_is_human: 1,
      },
    });

    await tick();
    http.expectOne('/api/forums').flush({ forums: [] });
    await saving;
    await tick();
    fixture.detectChanges();

    expect(el.querySelectorAll('.card-comment').length).toBe(2);
    expect(el.querySelector<HTMLTextAreaElement>('.card-detail__comment-input')?.value).toBe('');
    expect(closed).not.toHaveBeenCalled();
  });

  it('marks the card blocked immediately, then offers to unblock', async () => {
    const fixture = open();
    const busy = TestBed.inject(BusyService);
    const el = fixture.nativeElement as HTMLElement;
    const button = () =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('.card-detail__actions button')).find(
        (b) => b.textContent?.trim() === 'mark blocked' || b.textContent?.trim() === 'unblock',
      )!;

    button().click();
    fixture.detectChanges();
    expect(busy.active()).toBe(true);
    expect(busy.label()).toBe('blocking card');
    const req = http.expectOne('/api/cards/3');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ blocked: true });
    req.flush({ card: { ...CARD, blocked_at: '2026-10-16T00:02:00.000Z' } });

    await tick();
    http.expectOne('/api/forums').flush({ forums: [] });
    await tick();
    fixture.detectChanges();

    expect(button().textContent?.trim()).toBe('unblock');
    expect(el.querySelector('.card-detail__blocked')?.textContent?.trim()).toBe('blocked');
    expect(el.querySelector('.card-detail')?.classList.contains('card-detail--blocked')).toBe(true);
    expect(busy.active()).toBe(false);
  });

  it('adopts a remote update while the draft is clean', async () => {
    const fixture = open();
    const el = fixture.nativeElement as HTMLElement;
    store.cards.set([
      {
        ...CARD,
        title: 'remote title',
        body: 'remote body',
        updated_at: '2026-10-17T00:00:00.000Z',
      },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.card-detail__title')?.textContent?.trim()).toBe('remote title');
    expect(el.querySelector('.card-detail__preview')?.textContent).toContain('remote body');
    expect(el.querySelector('.card-detail__remote')).toBeNull();
  });

  it('keeps a dirty draft and offers a reload instead', async () => {
    const fixture = open();
    const el = fixture.nativeElement as HTMLElement;
    const comp = fixture.componentInstance as unknown as {
      title: { set: (value: string) => void };
    };
    comp.title.set('local draft');
    store.cards.set([
      {
        ...CARD,
        title: 'remote title',
        body: 'remote body',
        updated_at: '2026-10-17T00:00:00.000Z',
      },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.card-detail__title')?.textContent?.trim()).toBe('local draft');
    const banner = el.querySelector('.card-detail__remote');
    expect(banner).toBeTruthy();

    banner!.querySelector<HTMLButtonElement>('button')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.card-detail__title')?.textContent?.trim()).toBe('remote title');
    expect(el.querySelector('.card-detail__remote')).toBeNull();
  });

  it('asks before deleting, then closes', async () => {
    const fixture = open();
    const busy = TestBed.inject(BusyService);
    const el = fixture.nativeElement as HTMLElement;
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    const del = Array.from(
      el.querySelectorAll<HTMLButtonElement>('.card-detail__actions button'),
    ).find((button) => button.textContent?.trim() === 'delete')!;
    del.click();
    fixture.detectChanges();
    expect(el.querySelector('app-confirm-dialog')).toBeTruthy();

    el.querySelector<HTMLButtonElement>('app-confirm-dialog .btn-danger')!.click();
    fixture.detectChanges();
    expect(busy.label()).toBe('deleting card');
    const req = http.expectOne('/api/cards/3');
    expect(req.request.method).toBe('DELETE');
    req.flush({ ok: true, id: 3 });

    await tick();
    http.expectOne('/api/forums').flush({ forums: [] });
    await tick();
    fixture.detectChanges();
    expect(closed).toHaveBeenCalledOnce();
    expect(busy.active()).toBe(false);
  });

  it('renders markdown in read mode and edits the raw source', async () => {
    const fixture = open();
    const comp = fixture.componentInstance as unknown as { body: { set: (v: string) => void } };
    const source = '# head\n\n- **one**';
    comp.body.set(source);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const preview = el.querySelector('.card-detail__preview') as HTMLElement;
    expect(preview.querySelector('h1')?.textContent).toBe('head');
    expect(preview.querySelector('li strong')?.textContent).toBe('one');

    toggleSwitch(fixture).click();
    fixture.detectChanges();
    await tick(); // ngModel copies the draft into the textarea
    fixture.detectChanges();
    expect(el.querySelector<HTMLTextAreaElement>('#card-detail-body')?.value).toBe(source);
  });

  it('PATCHes title and body on save, then keeps the card open', async () => {
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
    expect(TestBed.inject(BusyService).label()).toBe('saving card');
    const req = http.expectOne('/api/cards/3');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ title: 'ship it now', body: 'rewritten', assignee: null });
    req.flush({ card: { ...CARD, title: 'ship it now', body: 'rewritten' } });

    await tick();
    http.expectOne('/api/forums').flush({ forums: [] });

    await saving;
    await tick();
    fixture.detectChanges();
    expect(closed).not.toHaveBeenCalled();
    expect(el.querySelector('.card-detail')).toBeTruthy();
    expect(TestBed.inject(BusyService).active()).toBe(false);
  });

  it('closes from the X in the title bar', () => {
    const fixture = open();
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector<HTMLButtonElement>('.card-detail__close')!.click();
    fixture.detectChanges();
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

    const cancel = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.card-detail__actions button',
      ),
    ).find((button) => button.textContent?.trim() === 'cancel');
    cancel?.click();

    expect(closed).toHaveBeenCalledOnce();
  });
});

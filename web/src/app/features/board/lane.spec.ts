import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusyService } from '../../core/busy.service';
import { ForumStore } from '../../core/forum.store';
import type { Card, Column } from '../../core/models';
import { CardDetail } from './card-detail';
import { Lane } from './lane';

const COLUMN: Column = {
  id: 1,
  board_id: 7,
  name: 'todo',
  position: 0,
  wip_limit: null,
};

const card = (id: number, position: number): Card => ({
  id,
  board_id: 7,
  column_id: 1,
  position,
  title: `card ${id}`,
  body: '',
  assignee_id: null,
  created_by: 1,
  created_at: '2026-10-19T00:00:00.000Z',
  updated_at: '2026-10-19T00:00:00.000Z',
  done_at: null,
  blocked_at: null,
});

describe('Lane (delete column asks via the confirm dialog)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(Lane);
    fixture.componentRef.setInput('column', COLUMN);
    fixture.detectChanges();
    return fixture;
  }

  it('shows animated card placeholders while the first read lands', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    expect(el.querySelectorAll('.kanban-card--skeleton')).toHaveLength(3);
    expect(el.querySelectorAll('.skeleton').length).toBeGreaterThan(0);

    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    expect(el.querySelectorAll('.kanban-card--skeleton')).toHaveLength(0);
  });

  it('shows a landing placeholder and lifts the dragged card out of the flow', () => {
    const store = TestBed.inject(ForumStore);
    store.view.set('settings');
    store.boardId.set(7);
    store.cards.set([card(1, 0), card(2, 1), card(3, 2)]);

    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('app-card-tile')).toHaveLength(3);
    expect(el.querySelector('.kanban-card--placeholder')).toBeNull();

    // drag card 1 over this lane; pointer above the first visible card → index 0
    store.draggingCardId.set(1);
    const cardsBody = el.querySelector<HTMLElement>('.lane__cards')!;
    const event = {
      preventDefault: () => {},
      dataTransfer: { types: ['text/plain'], dropEffect: '' },
      clientY: 0,
      currentTarget: cardsBody,
    } as unknown as DragEvent;
    Object.defineProperty(cardsBody, 'querySelectorAll', {
      value: () => [],
      configurable: true,
    });
    (fixture.componentInstance as unknown as { onCardsDragOver: (e: DragEvent) => void })
      .onCardsDragOver(event);
    fixture.detectChanges();

    expect(el.querySelector('.kanban-card--placeholder')).toBeTruthy();
    // the dragged card is lifted out — two tiles remain plus the gap
    expect(el.querySelectorAll('app-card-tile')).toHaveLength(2);
  });

  it('restores the card when it is dropped on its own position', () => {
    const store = TestBed.inject(ForumStore);
    store.view.set('settings');
    store.boardId.set(7);
    store.cards.set([card(1, 0), card(2, 1), card(3, 2)]);
    const move = vi.spyOn(store, 'moveCard').mockResolvedValue(true);

    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    // start dragging card 2 (index 1) and lift it out of the flow
    store.draggingCardId.set(2);
    fixture.detectChanges();
    expect(el.querySelectorAll('app-card-tile')).toHaveLength(2);

    // drop on the same column, same slot
    const cardsBody = el.querySelector<HTMLElement>('.lane__cards')!;
    const drop = {
      preventDefault: () => {},
      dataTransfer: { getData: () => '2' },
      clientY: 40,
      currentTarget: cardsBody,
    } as unknown as DragEvent;
    Object.defineProperty(cardsBody, 'querySelectorAll', {
      value: () => [],
      configurable: true,
    });
    (fixture.componentInstance as unknown as { onDrop: (e: DragEvent) => void }).onDrop(drop);

    // the drag state must be cleared so the tile is restored
    expect(store.draggingCardId()).toBeNull();
    fixture.detectChanges();
    expect(el.querySelectorAll('app-card-tile')).toHaveLength(3);
    expect(el.querySelector('.kanban-card--placeholder')).toBeNull();
  });

  it('clears the placeholder when the pointer leaves the column', () => {
    const store = TestBed.inject(ForumStore);
    store.view.set('settings');
    store.boardId.set(7);
    store.cards.set([card(1, 0), card(2, 1)]);

    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;
    const lane = fixture.componentInstance as unknown as {
      dropAt: { set: (v: number | null) => void };
    };
    lane.dropAt.set(1);
    fixture.detectChanges();
    expect(el.querySelector('.kanban-card--placeholder')).toBeTruthy();

    const cardsBody = el.querySelector<HTMLElement>('.lane__cards')!;
    const leave = {
      relatedTarget: null,
      currentTarget: cardsBody,
    } as unknown as DragEvent;
    (fixture.componentInstance as unknown as { onCardsDragLeave: (e: DragEvent) => void })
      .onCardsDragLeave(leave);
    fixture.detectChanges();
    expect(el.querySelector('.kanban-card--placeholder')).toBeNull();
  });

  it('opens a blank card in edit mode and creates it on save', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    const busy = TestBed.inject(BusyService);
    store.view.set('settings');
    store.boardId.set(7);

    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector<HTMLButtonElement>('[title="add card"]')?.click();
    fixture.detectChanges();

    const modal = el.querySelector('app-card-detail');
    expect(modal).toBeTruthy();
    expect(modal?.querySelector('#card-detail-title')).toBeTruthy();
    expect(modal?.querySelector<HTMLTextAreaElement>('#card-detail-body')).toBeTruthy();
    expect(modal?.querySelector('.card-detail__conversation')).toBeNull();

    const detail = fixture.debugElement.query(By.directive(CardDetail))
      .componentInstance as unknown as {
      title: { set: (v: string) => void };
      body: { set: (v: string) => void };
      save: () => Promise<void>;
    };
    detail.title.set('fresh card');
    detail.body.set('drafted in the modal');
    fixture.detectChanges();

    const saving = detail.save();
    expect(busy.label()).toBe('creating card');
    const req = http.expectOne('/api/cards');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      board_id: 7,
      column_id: 1,
      title: 'fresh card',
      body: 'drafted in the modal',
      assignee: null,
    });
    req.flush({
      card: {
        id: 9,
        board_id: 7,
        column_id: 1,
        position: 0,
        title: 'fresh card',
        body: 'drafted in the modal',
        assignee_id: null,
        created_by: 1,
        created_at: '2026-10-18T00:00:00.000Z',
        updated_at: '2026-10-18T00:00:00.000Z',
        done_at: null,
        blocked_at: null,
      },
    });

    await new Promise((r) => setTimeout(r, 0));
    http.expectOne('/api/forums').flush({ forums: [] });
    await saving;
    fixture.detectChanges();
    expect(el.querySelector('app-card-detail')).toBeNull();
    expect(busy.active()).toBe(false);
  });

  it('keep aborts; delete issues DELETE on the column', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
    const busy = TestBed.inject(BusyService);
    store.view.set('settings');
    // deleteColumn refuses while no board is picked
    store.boardId.set(7);

    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    el.querySelector<HTMLButtonElement>('[title="delete column"]')?.click();
    fixture.detectChanges();
    const dialog = el.querySelector('app-confirm-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog?.textContent).toContain('delete this column and its cards?');

    dialog!.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    expect(el.querySelector('app-confirm-dialog')).toBeNull();

    el.querySelector<HTMLButtonElement>('[title="delete column"]')?.click();
    fixture.detectChanges();
    el.querySelector<HTMLElement>('app-confirm-dialog .btn-danger')?.click();
    expect(busy.label()).toBe('deleting column');
    await new Promise((r) => setTimeout(r, 0));

    const req = http.expectOne('/api/columns/1');
    expect(req.request.method).toBe('DELETE');
    req.flush({ ok: true, id: 1 });
    await new Promise((r) => setTimeout(r, 0));
    http.expectOne('/api/forums').flush({ forums: [] });
  });
});

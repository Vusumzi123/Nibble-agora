import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { ForumStore } from '../../core/forum.store';
import type { Column } from '../../core/models';
import { Lane } from './lane';

const COLUMN: Column = {
  id: 1,
  board_id: 7,
  name: 'todo',
  position: 0,
  wip_limit: null,
};

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

  it('keep aborts; delete issues DELETE on the column', async () => {
    const store = TestBed.inject(ForumStore);
    const http = TestBed.inject(HttpTestingController);
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
    await new Promise((r) => setTimeout(r, 0));

    const req = http.expectOne('/api/columns/1');
    expect(req.request.method).toBe('DELETE');
    req.flush({ ok: true, id: 1 });
    await new Promise((r) => setTimeout(r, 0));
    http.expectOne('/api/forums').flush({ forums: [] });
  });
});

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForumStore } from '../../core/forum.store';
import type { Post } from '../../core/models';
import { SessionService } from '../../core/session.service';
import { PostCard } from './post-card';

const post: Post = {
  id: 7,
  thread_id: 1,
  author_id: 2,
  body: 'hello @you',
  created_at: '2026-10-14T10:00:00.000Z',
  edited_at: null,
  author_handle: 'kael',
  author_is_human: 0,
  mentions: ['you'],
  reactions: [
    { emoji: '+1', agent: 'kael' },
    { emoji: '+1', agent: 'you' },
  ],
};

describe('PostCard', () => {
  let toggleReaction: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toggleReaction = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: ForumStore, useValue: { toggleReaction } },
        { provide: SessionService, useValue: { me: () => ({ handle: 'you' }) } },
      ],
    });
  });

  function render(): HTMLElement {
    const fixture = TestBed.createComponent(PostCard);
    fixture.componentRef.setInput('post', post);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('always shows every preset with a counter and marks the caller’s own reaction', () => {
    const el = render();
    const chips = [...el.querySelectorAll<HTMLButtonElement>('.reactions .chip')];
    expect(chips.length).toBeGreaterThanOrEqual(4);
    const plusOne = chips.find((c) => c.textContent?.includes('👍'));
    expect(plusOne?.textContent).toContain('2');
    expect(plusOne?.classList.contains('btn-primary')).toBe(true);
    const thumbsDown = chips.find((c) => c.textContent?.includes('👎'));
    expect(thumbsDown?.textContent).toContain('0');
    expect(thumbsDown?.classList.contains('reaction--zero')).toBe(true);
  });

  it('adds a preset reaction the caller has not used yet', () => {
    const el = render();
    const thumbsDown = [...el.querySelectorAll<HTMLButtonElement>('.reactions .chip')].find((c) =>
      c.textContent?.includes('👎'),
    );
    thumbsDown?.click();
    expect(toggleReaction).toHaveBeenCalledWith(7, '-1', false);
  });

  it('removes the caller’s reaction when an owned chip is clicked', () => {
    const el = render();
    const plusOne = [...el.querySelectorAll<HTMLButtonElement>('.reactions .chip')].find((c) =>
      c.textContent?.includes('👍'),
    );
    plusOne?.click();
    expect(toggleReaction).toHaveBeenCalledWith(7, '+1', true);
  });

  it('renders the author, body and mentions', () => {
    const el = render();
    expect(el.querySelector('.post__author')?.textContent).toContain('@kael');
    expect(el.querySelector('.post__body')?.textContent).toContain('hello @you');
    expect(el.querySelector('.post__mentions')?.textContent).toContain('@you');
  });
});

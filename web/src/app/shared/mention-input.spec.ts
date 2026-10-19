import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ForumStore } from '../core/forum.store';
import { MentionInput } from './mention-input';
import type { Agent } from '../core/models';

const agent = (id: number, handle: string): Agent => ({
  id,
  handle,
  display_name: handle,
  is_human: 0,
  color: null,
  created_at: '2026-01-01T00:00:00.000Z',
});

describe('MentionInput', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<MentionInput>>;
  let input: HTMLInputElement;

  const options = () =>
    Array.from(
      fixture.nativeElement.querySelectorAll('[role="option"]') as NodeListOf<HTMLElement>,
    ).map((el) => el.textContent?.trim());

  const type = async (text: string) => {
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  const enter = () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MentionInput],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    TestBed.inject(ForumStore).agents.set([
      agent(1, 'kael'),
      agent(2, 'nemu-cli'),
      agent(3, 'root'),
    ]);
    fixture = TestBed.createComponent(MentionInput);
    fixture.detectChanges();
    input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
  });

  it('offers the known handles and narrows them while typing', async () => {
    input.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(options()).toEqual(['@kael', '@nemu-cli', '@root']);
    expect(input.getAttribute('aria-expanded')).toBe('true');

    await type('ro');
    expect(options()).toEqual(['@root']);
  });

  it('picks with Enter without letting the composer post', async () => {
    const bubbled = vi.fn();
    fixture.nativeElement.addEventListener('keydown', bubbled);
    input.dispatchEvent(new FocusEvent('focus'));

    await type('ka');
    expect(enter()).toBe(false);
    expect(bubbled).not.toHaveBeenCalled();
    expect(fixture.componentInstance.value()).toBe('kael, ');
    fixture.detectChanges();
    expect(options()).toEqual([]);
  });

  it('moves the highlight with the arrow keys', async () => {
    input.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(input.getAttribute('aria-activedescendant')).toBe('mention-option-1');
    enter();

    expect(fixture.componentInstance.value()).toBe('nemu-cli, ');
  });

  it('keeps the earlier mentions when picking the next handle', async () => {
    input.dispatchEvent(new FocusEvent('focus'));
    await type('kael, ka');
    expect(options()).toEqual(['@kael']);

    enter();
    expect(fixture.componentInstance.value()).toBe('kael, kael, ');
    fixture.detectChanges();
    expect(options()).toEqual([]);
  });
});

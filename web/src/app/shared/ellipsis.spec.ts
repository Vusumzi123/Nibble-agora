import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { Ellipsis } from './ellipsis';

@Component({
  template: `<span appEllipsis>{{ text }}</span>`,
  imports: [Ellipsis],
})
class BareHost {
  text = 'hello';
}

@Component({
  template: `<span [appEllipsis]="lines">{{ text }}</span>`,
  imports: [Ellipsis],
})
class MultiHost {
  text = 'a body of text long enough to need several lines before clipping';
  lines = 3;
}

describe('Ellipsis', () => {
  let fixture: ComponentFixture<BareHost>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BareHost] });
    fixture = TestBed.createComponent(BareHost);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement.querySelector('span') as HTMLElement;

  it('leaves the title off while the text fits', () => {
    // jsdom reports 0 for both — nothing clipped.
    expect(el().getAttribute('title')).toBeNull();
  });

  it('puts the .ellipsis utility class on the host (the CSS that draws the …)', () => {
    expect(el().classList.contains('ellipsis')).toBe(true);
  });

  it('stays single-line without an explicit line count', () => {
    expect(el().classList.contains('ellipsis--multi')).toBe(false);
    expect(el().style.getPropertyValue('--ellipsis-lines')).toBe('1');
  });

  it('exposes the full text as the title once clipped', async () => {
    const node = el().firstChild as Text;
    // fake a clipped box, then mutate the text so the observer re-syncs.
    Object.defineProperty(el(), 'scrollWidth', { value: 200, configurable: true });
    Object.defineProperty(el(), 'clientWidth', { value: 100, configurable: true });
    node.textContent = 'hello world';
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    expect(el().getAttribute('title')).toBe('hello world');
  });
});

describe('Ellipsis with a line count', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [MultiHost] });
  });

  it('switches on the multi-line clamp for [appEllipsis]="n"', () => {
    const fixture = TestBed.createComponent(MultiHost);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('span') as HTMLElement;
    expect(el.classList.contains('ellipsis')).toBe(true);
    expect(el.classList.contains('ellipsis--multi')).toBe(true);
    expect(el.style.getPropertyValue('--ellipsis-lines')).toBe('3');
  });
});

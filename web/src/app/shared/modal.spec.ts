import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { Modal } from './modal';

@Component({
  imports: [Modal],
  template: `
    <app-modal [title]="'ignored default'" [showClose]="false">
      <header modal-header class="custom-head">custom heading</header>
      <p class="projected-body">projected</p>
    </app-modal>
  `,
})
class CustomHeaderHost {}

@Component({
  imports: [Modal],
  template: `
    @if (!first()) {
      <app-modal title="first" (closed)="first.set(true)" />
    }
    @if (!second()) {
      <app-modal title="second" (closed)="second.set(true)" />
    }
  `,
})
class StackedHost {
  readonly first = signal(false);
  readonly second = signal(false);
}

function mount(): {
  fixture: ComponentFixture<Modal>;
  scrim: HTMLElement;
  card: HTMLElement;
  closes: () => number;
} {
  TestBed.configureTestingModule({ imports: [Modal] });
  const fixture = TestBed.createComponent(Modal);
  fixture.componentRef.setInput('title', 'busy');
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  let count = 0;
  fixture.componentInstance.closed.subscribe(() => count++);
  return {
    fixture,
    scrim: root.querySelector('.overlay') as HTMLElement,
    card: root.querySelector('.overlay__card') as HTMLElement,
    closes: () => count,
  };
}

function pointer(target: HTMLElement, type: string): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true }));
}

describe('Modal', () => {
  it('renders the default header, dialog semantics and the close button', () => {
    const { fixture, card, scrim } = mount();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.ph-panel__header')?.textContent).toContain('busy');
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(scrim.querySelector('.btn-icon')).toBeTruthy();
  });

  it('lets a caller replace the header and keep projected content', () => {
    TestBed.configureTestingModule({ imports: [CustomHeaderHost] });
    const fixture = TestBed.createComponent(CustomHeaderHost);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.custom-head')?.textContent).toBe('custom heading');
    expect(root.querySelector('.ph-panel__header')).toBeNull();
    expect(root.querySelector('.projected-body')?.textContent).toBe('projected');
  });

  it('applies the menu variant and panel classes', () => {
    const { fixture, card } = mount();
    fixture.componentRef.setInput('variant', 'menu');
    fixture.componentRef.setInput('panelClass', 'wide');
    fixture.componentRef.setInput('activeClass', 'is-blocked');
    fixture.detectChanges();
    expect(card.classList.contains('overlay__card--menu')).toBe(true);
    expect(card.classList.contains('wide')).toBe(true);
    expect(card.classList.contains('is-blocked')).toBe(true);
  });

  it('closes on a plain scrim click', () => {
    const { scrim, closes } = mount();
    scrim.click();
    expect(closes()).toBe(1);
  });

  it('does not close when the click starts inside the panel', () => {
    const { card, scrim, closes } = mount();
    pointer(card, 'pointerdown');
    scrim.click();
    expect(closes()).toBe(0);
  });

  it('does not close when a press on the scrim is released over the panel', () => {
    const { card, scrim, closes } = mount();
    pointer(scrim, 'pointerdown');
    pointer(card, 'pointerup');
    scrim.click();
    expect(closes()).toBe(0);
  });

  it('does not close on a click inside the panel', () => {
    const { card, closes } = mount();
    card.click();
    expect(closes()).toBe(0);
  });

  it('closes when press and release both land on the scrim', () => {
    const { scrim, closes } = mount();
    pointer(scrim, 'pointerdown');
    pointer(scrim, 'pointerup');
    scrim.click();
    expect(closes()).toBe(1);
  });

  it('closes only the topmost modal on Escape', () => {
    TestBed.configureTestingModule({ imports: [StackedHost] });
    const fixture = TestBed.createComponent(StackedHost);
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.second()).toBe(true);
    expect(fixture.componentInstance.first()).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.first()).toBe(true);
  });

  it('leaves Escape to a control that consumes it', () => {
    const { card, closes } = mount();
    card.addEventListener('keydown', (event) => event.stopPropagation(), { once: true });
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closes()).toBe(0);
  });

  it('locks body scroll across nested modals and restores it once', () => {
    const previous = document.body.style.overflow;
    const first = TestBed.createComponent(Modal);
    first.componentRef.setInput('title', 'first');
    first.detectChanges();
    const second = TestBed.createComponent(Modal);
    second.componentRef.setInput('title', 'second');
    second.detectChanges();
    expect(document.body.style.overflow).toBe('hidden');
    first.destroy();
    expect(document.body.style.overflow).toBe('hidden');
    second.destroy();
    expect(document.body.style.overflow).toBe(previous);
  });

  it('restores focus to the trigger when it closes', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    TestBed.configureTestingModule({ imports: [Modal] });
    const fixture = TestBed.createComponent(Modal);
    fixture.componentRef.setInput('title', 'focus');
    fixture.detectChanges();
    await Promise.resolve();
    expect(document.activeElement).not.toBe(trigger);
    fixture.destroy();
    await Promise.resolve();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

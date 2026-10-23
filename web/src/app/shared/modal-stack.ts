import { Injectable } from '@angular/core';

/** One open `app-modal`, registered for the duration of its lifetime. */
export interface ModalEntry {
  /** The dialog panel; Tab cycles inside it while the modal is topmost. */
  readonly panel: HTMLElement;
  /** Ask the owning modal to close (same path as the scrim or the `×`). */
  close(): void;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The first element inside `panel` that can take focus, if any. */
export function firstFocusable(panel: HTMLElement): HTMLElement | null {
  const found = panel.querySelector<HTMLElement>(FOCUSABLE);
  return found && !found.closest('[hidden]') ? found : null;
}

/**
 * Document-level behaviour shared by every `app-modal`:
 *
 * - Escape closes the **topmost** modal only, so a confirm dialog nested in a
 *   card detail closes alone. A focused control that consumes Escape first
 *   (e.g. the title input cancelling an edit) stops propagation and keeps the
 *   modal open.
 * - Tab wraps around the topmost panel instead of escaping behind the scrim.
 * - The body scroll lock is depth-counted, so nested dialogs restore the page
 *   scroll exactly once, when the last one closes.
 */
@Injectable({ providedIn: 'root' })
export class ModalStack {
  private readonly entries: ModalEntry[] = [];
  private previousOverflow: string | null = null;
  private listening = false;

  register(entry: ModalEntry): () => void {
    this.entries.push(entry);
    if (this.entries.length === 1) {
      this.previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    if (!this.listening) {
      // Bubble phase: a control inside the modal gets the first look at the
      // event and can stop it before Escape reaches the stack.
      document.addEventListener('keydown', this.onKeydown);
      this.listening = true;
    }
    return () => this.unregister(entry);
  }

  private unregister(entry: ModalEntry): void {
    const index = this.entries.indexOf(entry);
    if (index >= 0) this.entries.splice(index, 1);
    if (this.entries.length > 0) return;
    if (this.listening) {
      document.removeEventListener('keydown', this.onKeydown);
      this.listening = false;
    }
    document.body.style.overflow = this.previousOverflow ?? '';
    this.previousOverflow = null;
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    const top = this.entries[this.entries.length - 1];
    if (!top) return;
    if (event.key === 'Escape') {
      if (event.defaultPrevented) return;
      event.preventDefault();
      top.close();
      return;
    }
    if (event.key === 'Tab') this.trapTab(event, top.panel);
  };

  private trapTab(event: KeyboardEvent, panel: HTMLElement): void {
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => !el.closest('[hidden]'),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && panel.contains(active);
    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

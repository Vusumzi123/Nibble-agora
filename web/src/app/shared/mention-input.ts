import { Component, ElementRef, computed, inject, model, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ForumStore } from '../core/forum.store';

/** Maximum rows the suggestion menu shows at once. */
const MAX_SUGGESTIONS = 6;

/**
 * Text field for the comma-separated mentions draft, with a suggestion menu
 * fed by the agents the forum already knows. The menu opens upward so it never
 * fights the composer's docked bar for room.
 */
@Component({
  selector: 'app-mention-input',
  imports: [FormsModule],
  template: `
    <div class="mention-input" (focusout)="onFocusOut($event)">
      <input
        #field
        class="form-control mention-input__field"
        type="text"
        placeholder="mentions, comma separated"
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="mention-menu"
        [attr.aria-expanded]="menuOpen()"
        [attr.aria-activedescendant]="menuOpen() ? optionId(active()) : null"
        [ngModel]="value()"
        (ngModelChange)="onInput($event)"
        (focus)="onFocus()"
        (keydown)="onKeydown($event)"
      />
      @if (menuOpen()) {
        <ul id="mention-menu" class="mention-input__menu" role="listbox">
          @for (handle of suggestions(); track handle; let i = $index) {
            <li
              class="mention-input__option"
              role="option"
              [id]="optionId(i)"
              [attr.aria-selected]="i === active()"
              [class.mention-input__option--active]="i === active()"
              (mousedown)="$event.preventDefault()"
              (click)="choose(handle)"
            >
              <span aria-hidden="true">@</span>{{ handle }}
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .mention-input {
      position: relative;
    }

    .mention-input__menu {
      position: absolute;
      bottom: calc(100% + 4px);
      left: 0;
      right: 0;
      z-index: 40;
      margin: 0;
      padding: var(--ph-space-1);
      list-style: none;
      background: var(--ph-surface);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius-md);
      box-shadow: var(--ph-shadow-2);
    }

    .mention-input__option {
      padding: var(--ph-space-1) var(--ph-space-2);
      border-radius: var(--ph-radius-sm);
      color: var(--ph-text);
      font-family: var(--ph-font-mono);
      font-size: var(--ph-text-sm);
      line-height: var(--ph-leading-tight);
      cursor: pointer;
    }

    .mention-input__option--active,
    .mention-input__option:hover {
      background: var(--ph-surface-raised);
    }
  `,
})
export class MentionInput {
  /** The draft: "a, @b ,, c" — commas separate, the menu only edits the last one. */
  readonly value = model('');

  private readonly store = inject(ForumStore);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  protected readonly focused = signal(false);
  protected readonly active = signal(0);
  /** The agents list is view-scoped in the store; ask for it once when the
      field is first used on a page that did not load it. */
  private askedAgents = false;

  private readonly fragment = computed(() => {
    const raw = this.value();
    const cut = raw.lastIndexOf(',');
    return (cut >= 0 ? raw.slice(cut + 1) : raw).trim().replace(/^@/, '');
  });

  protected readonly suggestions = computed(() => {
    const query = this.fragment().toLowerCase();
    return this.store
      .agents()
      .map((agent) => agent.handle)
      .filter((handle) => handle.toLowerCase().startsWith(query))
      .slice(0, MAX_SUGGESTIONS);
  });

  protected readonly menuOpen = computed(
    () => this.focused() && this.suggestions().length > 0,
  );

  protected optionId(index: number): string {
    return `mention-option-${index}`;
  }

  protected onFocus(): void {
    this.focused.set(true);
    this.requestAgents();
  }

  private requestAgents(): void {
    if (this.askedAgents || this.store.agents().length) return;
    this.askedAgents = true;
    void this.store.refreshAgents().catch(() => {});
  }

  protected onInput(text: string): void {
    this.value.set(text);
    this.active.set(0);
    this.focused.set(true);
    this.requestAgents();
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as HTMLElement).contains(next)) return;
    this.focused.set(false);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.menuOpen()) return;
    const count = this.suggestions().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.active.set((this.active() + step + count) % count);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      // Swallow the key so the composer's Enter-to-post does not fire.
      event.preventDefault();
      event.stopPropagation();
      const handle = this.suggestions()[this.active()];
      if (handle) this.choose(handle);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.focused.set(false);
    }
  }

  protected choose(handle: string): void {
    const raw = this.value();
    const cut = raw.lastIndexOf(',');
    const before = cut >= 0 ? `${raw.slice(0, cut + 1)} ` : '';
    this.value.set(`${before}${handle}, `);
    this.active.set(0);
    // Focus first (a real browser reports it synchronously), then drop the
    // menu — placing the caret must not reopen the list.
    this.field().nativeElement.focus();
    this.focused.set(false);
  }
}

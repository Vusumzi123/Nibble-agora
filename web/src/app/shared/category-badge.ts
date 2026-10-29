import { Component, computed, inject, input } from '@angular/core';

import { TranslateService } from '../core/i18n';

/**
 * The list's category pill, carried onto the detail head. Angular's emulated
 * scoping keeps `.tag` rules in threads.css from reaching this component, so
 * the pill owns its styles here — same size, case, radius, tint and accent map
 * as the threads list. Do not move `.tag` out of threads.css: the list is the
 * reference and must stay untouched.
 */
@Component({
  selector: 'app-category-badge',
  template: `<span class="tag" [attr.data-cat]="category()">{{ label() }}</span>`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      align-self: center;
    }

    .tag {
      padding: 2px var(--ph-space-2);
      border: 1px solid var(--tag-accent, var(--ph-primary));
      border-radius: 999px;
      background: color-mix(in srgb, var(--tag-accent, var(--ph-primary)) 10%, transparent);
      color: var(--tag-accent, var(--ph-primary));
      font-family: var(--ph-font-mono);
      font-size: var(--ph-text-xs);
      letter-spacing: 0.04em;
      text-transform: lowercase;
    }

    .tag[data-cat='discussion'] {
      --tag-accent: var(--ph-text-muted);
    }

    .tag[data-cat='task'] {
      --tag-accent: var(--ph-primary);
    }

    .tag[data-cat='idea'] {
      --tag-accent: var(--ph-info);
    }

    .tag[data-cat='idle'] {
      --tag-accent: var(--ph-warning);
    }

    .tag[data-cat='announcement'] {
      --tag-accent: var(--ph-danger);
    }
  `,
})
export class CategoryBadge {
  readonly category = input.required<string>();
  private readonly i18n = inject(TranslateService);
  protected readonly label = computed(() => this.i18n.t(`threads.cat.${this.category()}`));
}

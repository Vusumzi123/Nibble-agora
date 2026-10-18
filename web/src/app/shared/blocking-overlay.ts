import { Component, inject } from '@angular/core';

import { BusyService } from '../core/busy.service';
import { LoadingDots } from './loading-dots';

/**
 * Full-screen curtain shown while a blocking action (post, reply, create) is
 * in flight. It swallows every click, so the action cannot be fired twice.
 */
@Component({
  selector: 'app-blocking-overlay',
  imports: [LoadingDots],
  template: `
    @if (busy.active()) {
      <div class="overlay overlay--busy" role="status" aria-live="polite" aria-busy="true">
        <div class="overlay__card busy__card" (click)="$event.stopPropagation()">
          <app-loading-dots [label]="busy.label()" />
          <span class="busy__label">{{ busy.label() }}…</span>
        </div>
      </div>
    }
  `,
  styles: `
    .overlay--busy {
      z-index: 1050;
      align-items: center;
      padding: var(--ph-space-4);
      background: color-mix(in srgb, var(--ph-bg) 72%, transparent);
    }

    .busy__card {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--ph-space-3);
      width: auto;
      max-width: none;
      padding: var(--ph-space-4) var(--ph-space-5);
      color: var(--ph-primary);
      font-family: var(--ph-font-mono);
      font-size: var(--ph-text-sm);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .busy__label {
      white-space: nowrap;
    }

    @media (prefers-reduced-motion: reduce) {
      .overlay--busy {
        backdrop-filter: none;
      }
    }
  `,
})
export class BlockingOverlay {
  protected readonly busy = inject(BusyService);
}

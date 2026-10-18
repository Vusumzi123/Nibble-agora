import { Injectable, computed, signal } from '@angular/core';

/**
 * Global "blocking action" gate. Wrap a mutation in `run()` and the app shows
 * the blocking overlay until it settles; the overlay host renders it, and a
 * depth counter keeps overlapping runs from dropping the curtain early.
 */
@Injectable({ providedIn: 'root' })
export class BusyService {
  private readonly depth = signal(0);
  private readonly current = signal('working');

  readonly active = computed(() => this.depth() > 0);
  readonly label = computed(() => this.current());

  /** Show the overlay for the duration of `action` (label = what is happening). */
  async run<T>(label: string, action: () => Promise<T>): Promise<T> {
    this.current.set(label);
    this.depth.update((n) => n + 1);
    try {
      return await action();
    } finally {
      this.depth.update((n) => Math.max(0, n - 1));
    }
  }
}

import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly kind: ToastKind;
}

const MAX_TOASTS = 4;
const ERROR_MS = 8000;
const SUCCESS_MS = 3000;

@Injectable({ providedIn: 'root' })
export class StatusService {
  readonly toasts = signal<readonly Toast[]>([]);
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  /** Queue a toast. Errors linger longer than success notes. */
  flash(message: string, isError = false): void {
    const kind: ToastKind = isError ? 'error' : 'success';
    const id = this.nextId++;
    const toast: Toast = { id, message, kind };
    this.toasts.update((list) => [...list, toast].slice(-MAX_TOASTS));
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), isError ? ERROR_MS : SUCCESS_MS) as unknown as number,
    );
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.toasts.update((list) => list.filter((toast) => toast.id !== id));
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.toasts.set([]);
  }
}

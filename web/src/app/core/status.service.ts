import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class StatusService {
  readonly message = signal('');
  readonly isError = signal(false);
  private timer = 0;

  flash(message: string, isError = false): void {
    this.message.set(message);
    this.isError.set(isError);
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.message.set('');
        this.isError.set(false);
      },
      isError ? 8000 : 3000,
    ) as unknown as number;
  }

  clear(): void {
    clearTimeout(this.timer);
    this.message.set('');
    this.isError.set(false);
  }
}

import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-char-counter',
  template: `<span class="counter field__hint" [class.counter--over]="over()">{{ value().length }}/{{ limit() }}</span>`,
})
export class CharCounter {
  readonly value = input.required<string>();
  readonly limit = input.required<number>();
  protected readonly over = computed(() => this.value().length > this.limit());
}

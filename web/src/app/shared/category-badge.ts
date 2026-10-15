import { Component, computed, input } from '@angular/core';

export const CATEGORY_BADGE: Record<string, string> = {
  discussion: 'text-bg-secondary',
  task: 'text-bg-primary',
  idea: 'text-bg-info',
  idle: 'text-bg-warning',
  announcement: 'text-bg-danger',
};

@Component({
  selector: 'app-category-badge',
  template: `<span [class]="'badge ' + tone()">{{ category() }}</span>`,
})
export class CategoryBadge {
  readonly category = input.required<string>();
  protected readonly tone = computed(() => CATEGORY_BADGE[this.category()] ?? 'text-bg-secondary');
}

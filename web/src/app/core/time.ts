import { Pipe, type PipeTransform } from '@angular/core';

/** Compact "Mar 4, 14:05" formatting used throughout the seat. */
export function when(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

@Pipe({ name: 'when' })
export class WhenPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return when(value);
  }
}

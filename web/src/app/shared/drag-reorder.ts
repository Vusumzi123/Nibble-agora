/** Shared HTML5 drag helpers for the board's two reorder surfaces (columns,
    project cards). The mime names keep a column drag from accepting a project
    drop and vice versa. */
export const COLUMN_DRAG_TYPE = 'application/x-nibble-column';
export const PROJECT_DRAG_TYPE = 'application/x-nibble-project';

export type DropAxis = 'x' | 'y';

export function startDrag(event: DragEvent, type: string, id: number): void {
  const dt = event.dataTransfer;
  if (!dt) return;
  dt.effectAllowed = 'move';
  dt.setData(type, String(id));
}

export function acceptsDrag(event: DragEvent, type: string): boolean {
  return event.dataTransfer?.types.includes(type) ?? false;
}

/**
 * Final index for an item dragged over `element`: the half closest to the
 * pointer wins (left/right for x, top/bottom for y), then the source slot is
 * removed from the count when it sat before the target.
 */
export function dropIndex(
  event: DragEvent,
  element: HTMLElement,
  overIndex: number,
  fromIndex: number,
  axis: DropAxis,
): number {
  const rect = element.getBoundingClientRect();
  const point = axis === 'x' ? event.clientX : event.clientY;
  const start = axis === 'x' ? rect.left : rect.top;
  const extent = axis === 'x' ? rect.width : rect.height;
  let target = point < start + extent / 2 ? overIndex : overIndex + 1;
  if (fromIndex >= 0 && fromIndex < target) target -= 1;
  return target;
}

/** How close the pointer must be to an edge before the strip starts scrolling. */
export const EDGE_PX = 56;
/** Peak px/frame the strip scrolls at an edge; eased off by {@link edgeFactor}. */
export const SCROLL_SPEED = 16;

/** 0 at the edge threshold, 1 once the pointer reaches (or passes) the edge. */
export function edgeFactor(distance: number, edge = EDGE_PX): number {
  return Math.min(1, Math.max(0, 1 - distance / edge));
}

/**
 * Scroll the drag surface with the pointer (board strip horizontally, the
 * hovered column vertically) while an HTML5 drag is in flight. The pointer
 * position is re-read every frame, so the strip keeps up as the drag moves.
 * Call {@link dragScroll} on dragover, and {@link stopDragScroll} on dragend
 * or drop.
 */
let raf = 0;
let point = { x: 0, y: 0 };
let target: Element | null = null;
let root: HTMLElement | null = null;

function tick(): void {
  raf = 0;
  const start = target instanceof HTMLElement ? target : target?.parentElement ?? null;
  let node: HTMLElement | null = start;
  while (node && root?.contains(node)) {
    const rect = node.getBoundingClientRect();
    if (node.scrollWidth > node.clientWidth) {
      const left = edgeFactor(point.x - rect.left);
      const right = edgeFactor(rect.right - point.x);
      if (left > 0) node.scrollLeft -= SCROLL_SPEED * left;
      else if (right > 0) node.scrollLeft += SCROLL_SPEED * right;
    }
    if (node.scrollHeight > node.clientHeight) {
      const top = edgeFactor(point.y - rect.top);
      const bottom = edgeFactor(rect.bottom - point.y);
      if (top > 0) node.scrollTop -= SCROLL_SPEED * top;
      else if (bottom > 0) node.scrollTop += SCROLL_SPEED * bottom;
    }
    node = node.parentElement;
  }
  if (target) raf = requestAnimationFrame(tick);
}

export function dragScroll(rootEl: HTMLElement, event: DragEvent): void {
  root = rootEl;
  target = event.target instanceof Element ? event.target : null;
  point = { x: event.clientX, y: event.clientY };
  if (!raf && target) raf = requestAnimationFrame(tick);
}

export function stopDragScroll(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  target = null;
  root = null;
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EDGE_PX, dragScroll, dropIndex, edgeFactor, stopDragScroll } from './drag-reorder';

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

const element = (box: DOMRect): HTMLElement =>
  ({ getBoundingClientRect: () => box }) as HTMLElement;

const event = (x: number, y: number): DragEvent => ({ clientX: x, clientY: y }) as DragEvent;

describe('dropIndex (shared column/project reorder)', () => {
  const box = rect(0, 0, 100, 40);

  it('inserts before on the near half and after on the far half', () => {
    // over slot 1, dragged from slot 0: right half → final index 1
    expect(dropIndex(event(75, 20), element(box), 1, 0, 'x')).toBe(1);
    // left half → final index 0
    expect(dropIndex(event(25, 20), element(box), 1, 0, 'x')).toBe(0);
  });

  it('compensates when the source sat before the target', () => {
    // over slot 2 from slot 0, right half: target 3 minus the removed source
    expect(dropIndex(event(90, 20), element(box), 2, 0, 'x')).toBe(2);
    // from after the target: no compensation
    expect(dropIndex(event(90, 20), element(box), 2, 3, 'x')).toBe(3);
  });

  it('uses the vertical axis for card lists', () => {
    expect(dropIndex(event(20, 5), element(box), 1, 0, 'y')).toBe(0);
    expect(dropIndex(event(20, 35), element(box), 1, 0, 'y')).toBe(1);
  });
});

describe('edgeFactor (drag auto-scroll easing)', () => {
  it('ramps from 0 at the edge threshold to 1 at the edge', () => {
    expect(edgeFactor(EDGE_PX)).toBe(0);
    expect(edgeFactor(EDGE_PX / 2)).toBe(0.5);
    expect(edgeFactor(0)).toBe(1);
  });

  it('clamps past the edge and far from it', () => {
    expect(edgeFactor(-20)).toBe(1);
    expect(edgeFactor(EDGE_PX * 3)).toBe(0);
  });
});

describe('dragScroll (strip keeps up with the pointer)', () => {
  let rafs: FrameRequestCallback[];

  beforeEach(() => {
    rafs = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
      rafs.push(cb);
      return rafs.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
      rafs[id - 1] = undefined as unknown as FrameRequestCallback;
    });
  });

  afterEach(() => {
    stopDragScroll();
    vi.unstubAllGlobals();
  });

  const strip = (): HTMLElement => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => rect(0, 0, 400, 300),
      configurable: true,
    });
    Object.defineProperty(el, 'scrollWidth', { value: 800, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: 300, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 100, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true });
    Object.defineProperty(el, 'parentElement', { value: null, configurable: true });
    return el;
  };

  it('scrolls the hovered strip toward the edge it is approaching', () => {
    const el = strip();

    dragScroll(el, {
      target: el,
      clientX: 399,
      clientY: 150,
    } as unknown as DragEvent);
    rafs[0]?.(0);

    expect(el.scrollLeft).toBeGreaterThan(100);
  });

  it('leaves the strip alone when the pointer is away from the edges', () => {
    const el = strip();

    dragScroll(el, {
      target: el,
      clientX: 200,
      clientY: 150,
    } as unknown as DragEvent);
    rafs[0]?.(0);

    expect(el.scrollLeft).toBe(100);
  });

  it('stops scrolling once the drag ends', () => {
    const el = strip();
    dragScroll(el, { target: el, clientX: 399, clientY: 150 } as unknown as DragEvent);
    stopDragScroll();

    expect(rafs[0]).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { BusyService } from './busy.service';

describe('BusyService', () => {
  it('is idle until a run starts', () => {
    const busy = new BusyService();
    expect(busy.active()).toBe(false);
  });

  it('shows the label while the action is in flight and clears after', async () => {
    const busy = new BusyService();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const running = busy.run('posting reply', () => held);

    expect(busy.active()).toBe(true);
    expect(busy.label()).toBe('posting reply');
    release();
    await running;
    expect(busy.active()).toBe(false);
  });

  it('keeps the curtain up for overlapping runs and reports the latest label', async () => {
    const busy = new BusyService();
    let releaseFirst!: () => void;
    const first = busy.run(
      'posting thread',
      () => new Promise<void>((r) => (releaseFirst = r)),
    );
    let releaseSecond!: () => void;
    const second = busy.run(
      'creating project',
      () => new Promise<void>((r) => (releaseSecond = r)),
    );

    expect(busy.label()).toBe('creating project');
    releaseFirst();
    await first;
    expect(busy.active()).toBe(true);
    releaseSecond();
    await second;
    expect(busy.active()).toBe(false);
  });

  it('drops the curtain and rethrows when the action fails', async () => {
    const busy = new BusyService();
    await expect(
      busy.run('posting reply', async () => {
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect(busy.active()).toBe(false);
  });
});

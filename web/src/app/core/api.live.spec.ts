import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiService } from './api.service';
import type { ChangeEvent } from './models';

const frame = (id: number): string =>
  `id: ${id}\nevent: change\ndata: ${JSON.stringify({
    id,
    ts: '2026-10-18T00:00:00.000Z',
    actor_id: 1,
    action: 'card.create',
    target: `card:${id}`,
    payload: { title: `card ${id}` },
  })}\n\n`;

const mockStream = (chunks: string[]): void => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status: 200 })),
  );
};

describe('ApiService.streamChanges', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('parses SSE frames (split across chunks) and forwards each event', async () => {
    const whole = frame(7) + frame(8);
    mockStream([': connected\n\n', whole.slice(0, 20), whole.slice(20)]);

    const api = TestBed.inject(ApiService);
    const seen: ChangeEvent[] = [];
    await api.streamChanges('tok', 7, new AbortController().signal, (event) => seen.push(event));

    expect(seen.map((event) => event.id)).toEqual([7, 8]);
    expect(seen[0].payload).toEqual({ title: 'card 7' });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/events/stream?since=7',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer tok' }),
      }),
    );
  });

  it('starts at the head when no cursor is supplied', async () => {
    mockStream([': connected\n\n']);
    const api = TestBed.inject(ApiService);
    await api.streamChanges('tok', null, new AbortController().signal, () => {});
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/events/stream',
      expect.anything(),
    );
  });
});

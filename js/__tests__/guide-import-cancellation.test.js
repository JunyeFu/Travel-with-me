import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractGuideText } from '../api/guide-import.js';
import { buildGuideDraft } from '../guide-import-flow.js';
import { setAMap } from '../state.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('guide import cancellation', () => {
  it('does not add artificial waits while retaining the place-request timeout', async () => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { getElementById: () => null });
    setAMap(null);
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const progress = vi.fn();

    const draft = await buildGuideDraft(
      { events: [{ place_name: '外滩' }, { place_name: '豫园' }], warnings: [] },
      { text: '', cityHint: '上海' },
      progress
    );

    expect(draft.events.map(event => event.placeName)).toEqual(['外滩', '豫园']);
    expect(timer.mock.calls.map(([, delay]) => delay)).toEqual([8000, 8000]);
    expect(progress.mock.calls.map(([stage]) => stage)).toEqual([
      'matching',
      'matching',
      'matching',
      'previewing'
    ]);
  });

  it('preserves notes when a guide place remains unmatched', async () => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { getElementById: () => null });
    setAMap(null);

    const draft = await buildGuideDraft(
      {
        events: [{ place_name: '小众观景台', day: 1, note: '日落前半小时到达' }],
        warnings: []
      },
      { text: '', cityHint: '上海' },
      vi.fn()
    );

    expect(draft.events[0]).toMatchObject({
      matched: false,
      note: '日落前半小时到达'
    });
  });

  it('passes cancellation to the extraction request', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, options) => {
        expect(options.signal).toBe(controller.signal);
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true
          });
        });
      })
    );

    const pending = extractGuideText({
      text: '旅行攻略',
      cityHint: '上海',
      signal: controller.signal
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not continue from an already cancelled draft build', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      buildGuideDraft(
        { events: [{ place_name: '外滩' }], warnings: [] },
        { text: '', cityHint: '上海' },
        vi.fn(),
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborts an in-flight place matching request when the draft build is cancelled', async () => {
    const controller = new AbortController();
    let requestSignal = null;
    setAMap({});
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', { getElementById: () => null });
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, options) => {
        requestSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(options.signal.reason), {
            once: true
          });
        });
      })
    );

    const pending = buildGuideDraft(
      { events: [{ place_name: '外滩' }], warnings: [] },
      { text: '', cityHint: '上海' },
      vi.fn(),
      controller.signal
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    expect(requestSignal).toBe(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

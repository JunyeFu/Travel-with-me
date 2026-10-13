import { afterEach, describe, expect, it, vi } from 'vitest';

import { extractGuideText } from '../api/guide-import.js';
import {
  buildGuideDraft,
  matchGuidePlace,
  normalizeGuideEventsFromSource
} from '../guide-import-flow.js';
import { cleanGuideExtractedEvents } from '../guide-import-cleanup.js';
import * as geocode from '../api/geocode.js';
import { setAMap } from '../state.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('guide import cancellation', () => {
  it('warns on conflicting same-day routes without silently merging or reordering the draft', () => {
    const input = ['西湖', '灵隐寺', '河坊街'].map(place_name => ({ place_name, day: 1 }));
    const warnings = [];
    expect(
      normalizeGuideEventsFromSource(
        input,
        'Day 1\n路线：西湖→灵隐寺→河坊街\n路线：西湖→河坊街→灵隐寺',
        warnings
      )
    ).toEqual(input);
    expect(warnings[0]).toContain('原文顺序冲突');
    expect(warnings[0]).toContain('西湖→灵隐寺→河坊街');
    expect(warnings[0]).toContain('西湖→河坊街→灵隐寺');
  });
  it('preserves double-digit days and distinguishes continuous routes from conflicting alternatives', () => {
    const warnings = [];
    const output = normalizeGuideEventsFromSource(
      [],
      'Day 10\n路线：西湖→灵隐寺\n路线：灵隐寺→河坊街\nDay 11\n路线：河坊街→灵隐寺→西湖',
      warnings
    );
    expect(output.map(e => e.day)).toEqual([10, 10, 10, 11, 11, 11]);
    expect(output.map(e => e.place_name)).toEqual([
      '西湖',
      '灵隐寺',
      '河坊街',
      '河坊街',
      '灵隐寺',
      '西湖'
    ]);
    expect(warnings).toEqual([]);
  });
  it('preserves return visits in explicit arrow routes and their independent time facts', () => {
    const input = [
      { place_name: '清河坊', day: 1, time_facts: { arrival: 540 } },
      { place_name: '胡庆余堂', day: 1, time_facts: { arrival: 600 } },
      { place_name: '清河坊', day: 1, time_facts: { arrival: 660 } }
    ];
    const events = cleanGuideExtractedEvents(
      normalizeGuideEventsFromSource(input, 'Day 1\n路线：清河坊→胡庆余堂→清河坊', [])
    );
    expect(events).toHaveLength(3);
    expect(events.map(e => e.time_facts.arrival)).toEqual([540, 600, 660]);
  });
  it('does not bind a landmark to a hotel carrying the landmark in its branch name', async () => {
    vi.spyOn(geocode, 'searchPlaces').mockResolvedValue([
      { name: '布丁酒店(杭州西湖断桥店)', lnglat: [120.1, 30.2] }
    ]);
    setAMap({
      Geocoder: class {
        getLocation(name, callback) {
          callback('no_data', null);
        }
      }
    });
    expect(await matchGuidePlace({ placeName: '西湖断桥', city: '杭州' })).toBeNull();
  });
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

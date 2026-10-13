import { describe, expect, it } from 'vitest';

import {
  MAX_GUIDE_DAYS,
  cleanGuideExtractedEvents,
  isGuideNoisePlaceName
} from '../guide-import-cleanup.js';

describe('cleanGuideExtractedEvents', () => {
  it('retains distinct visits to the same place within one time slot', () => {
    const events = cleanGuideExtractedEvents(
      [540, 650].map(arrival => ({
        place_name: '清河坊步行街',
        day: 1,
        time_slot: 'morning',
        time_facts: { arrival }
      }))
    );
    expect(events).toHaveLength(2);
  });
  it('filters common non-place noise from guide extraction output', () => {
    const warnings = [];
    const events = cleanGuideExtractedEvents(
      [
        { place_name: '武康路', day: 1, time_slot: 'afternoon', note: '拍照' },
        { place_name: '相机', day: 1, note: '不用加入行程' },
        { place_name: '酒店优惠码', day: 1, note: '广告' },
        { place_name: '大阪购物清单', day: 2, note: '不要加入路线' }
      ],
      { warnings }
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      place_name: '武康路',
      day: 1,
      time_slot: 'afternoon',
      note: '拍照'
    });
    expect(warnings).toEqual(['已过滤 3 个非地点或噪声项。']);
  });

  it('does not reject named hotels or concrete shops', () => {
    expect(isGuideNoisePlaceName('酒店')).toBe(true);
    expect(isGuideNoisePlaceName('和平饭店')).toBe(false);
    expect(isGuideNoisePlaceName('镛舍酒店')).toBe(false);
    expect(isGuideNoisePlaceName('又喜商店')).toBe(false);
  });

  it('normalizes duplicate events and invalid day or time values', () => {
    const events = cleanGuideExtractedEvents([
      { place_name: '鼓楼', day: '1', time_slot: 'morning', note: '出发' },
      { placeName: '鼓楼', day: 1, timeSlot: 'morning', note: '重复' },
      { place_name: '烟袋斜街', day: 0, time_slot: 'breakfast', note: '逛街' }
    ]);

    expect(events).toEqual([
      {
        place_name: '鼓楼',
        day: 1,
        time_slot: 'morning',
        note: '出发',
        source_quote: ''
      },
      {
        place_name: '烟袋斜街',
        day: null,
        time_slot: null,
        note: '逛街',
        source_quote: ''
      }
    ]);
  });

  it('moves out-of-range model day values to the unscheduled group', () => {
    const warnings = [];
    const events = cleanGuideExtractedEvents([{ place_name: '外滩', day: 1_000_000_000 }], {
      warnings
    });

    expect(MAX_GUIDE_DAYS).toBeGreaterThan(1);
    expect(events[0].day).toBeNull();
    expect(warnings).toContain(`超出 ${MAX_GUIDE_DAYS} 天的地点已移入未排期。`);
  });
});

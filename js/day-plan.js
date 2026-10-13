// Pure daily plan contract and time arithmetic. Durations are seconds internally.
const MODES = new Set(['walking', 'riding', 'driving', 'transit']);

export function reconcilePlan(day, input = {}, locations, city = '') {
  const nodes = [
    { id: 'start', locationId: input.start?.locationId },
    ...day.events.map(event => ({ id: event.id, locationId: event.locationId, event })),
    { id: 'end', locationId: input.end?.locationId }
  ];
  const legs = nodes.slice(0, -1).map((node, index) => {
    const next = nodes[index + 1];
    const previous = input.legs?.find(leg => leg.from === node.id && leg.to === next.id);
    const legacy = node.event?.routeToNext;
    const transport = node.event
      ? node.event.sourceFacts?.transport
      : next.event?.sourceFacts?.startTransport;
    const selected = previous
      ? previous.mode
      : transport?.mode || (legacy?.manual ? legacy.mode : null);
    const mode = MODES.has(selected) ? selected : null;
    const unchanged =
      previous?.fromLocationId === node.locationId &&
      previous?.toLocationId === next.locationId &&
      previous?.mode === mode &&
      (!locations ||
        !previous.estimate ||
        planEstimateMatches(previous, previous.estimate, locations, city));
    return {
      from: node.id,
      to: next.id,
      fromLocationId: node.locationId || null,
      toLocationId: next.locationId || null,
      mode,
      modeSource:
        previous?.modeSource || (transport?.mode ? 'guide' : legacy?.manual ? 'user' : 'missing'),
      transitPreference: previous
        ? (previous.transitPreference ?? null)
        : transport?.preference || null,
      legacyMode: previous?.legacyMode || (!legacy?.manual ? legacy?.mode : null),
      estimate: unchanged ? previous.estimate || null : null,
      previousEstimate:
        (!unchanged && previous?.estimate?.status === 'real'
          ? previous.estimate
          : previous?.previousEstimate) || null,
      queryState: unchanged ? previous?.queryState || null : previous ? 'changed' : null
    };
  });
  return {
    ...input,
    start: input.start || { locationId: null, minute: null },
    end: input.end || { locationId: null, minute: null },
    legs
  };
}

export function planEstimateMatches(leg, estimate, locations, city = '') {
  const query = estimate?.query;
  const from = locations[leg.fromLocationId],
    to = locations[leg.toLocationId];
  return Boolean(
    query &&
    query.from?.length === 2 &&
    query.to?.length === 2 &&
    from?.lnglat &&
    to?.lnglat &&
    query.mode === leg.mode &&
    query.from?.every((value, i) => Number(value) === Number(from.lnglat[i])) &&
    query.to?.every((value, i) => Number(value) === Number(to.lnglat[i])) &&
    (query.transitPreference ?? null) === (leg.transitPreference ?? null) &&
    (leg.mode !== 'transit' ||
      (query.fromCity === (from.city || city) && query.toCity === (to.city || city)))
  );
}

function hasCurrentEstimate(leg) {
  return Boolean(
    leg?.mode &&
    leg.transitPreference !== 'subway' &&
    !['pending', 'failed', 'cancelled', 'changed'].includes(leg.queryState) &&
    leg.estimate?.status === 'real' &&
    Number.isFinite(leg.estimate.seconds) &&
    leg.estimate.seconds >= 0
  );
}

export function evaluateDayPlan(day) {
  if (!day.plan) return null;
  const plan = day.plan;
  const missing = [];
  if (!plan.start?.locationId || plan.start.minute == null) missing.push('填写出发地点和时间');
  if (!plan.end?.locationId || plan.end.minute == null) missing.push('填写结束地点和时间');
  if (
    plan.start?.minute != null &&
    plan.end?.minute != null &&
    plan.end.minute <= plan.start.minute
  )
    missing.push('结束时间须晚于出发时间，跨午夜请选择次日');
  if (plan.legs?.length !== day.events.length + 1) missing.push('补齐首尾及站间交通');
  let travelSeconds = 0;
  for (const leg of plan.legs || []) {
    if (!leg.mode || leg.transitPreference === 'subway') missing.push('确认路段交通方式');
    if (!hasCurrentEstimate(leg)) missing.push('取得真实路段耗时');
    else travelSeconds += leg.estimate.seconds;
  }
  for (const event of day.events) {
    if (
      !event.visit ||
      !Number.isFinite(event.visit.min) ||
      !Number.isFinite(event.visit.max) ||
      event.visit.min < 0 ||
      event.visit.max < event.visit.min
    )
      missing.push(`${event.title || '地点'}：补充有效停留区间`);
  }
  const scenarios = ['min', 'max'].map(bound => {
    let time = plan.start?.locationId && plan.start.minute != null ? plan.start.minute * 60 : null,
      waiting = 0,
      activity = 0;
    const stops = day.events.map((event, index) => {
      const leg = plan.legs?.[index];
      const usable = hasCurrentEstimate(leg);
      time = time != null && usable ? time + leg.estimate.seconds : null;
      const arrival = time;
      const wait =
        time == null
          ? null
          : event.fixedStart == null
            ? 0
            : Math.max(0, event.fixedStart * 60 - time);
      const late =
        time == null
          ? null
          : event.fixedStart == null
            ? 0
            : Math.max(0, time - event.fixedStart * 60);
      if (wait != null) waiting += wait;
      const start = time == null ? null : time + wait;
      const validVisit =
        Number.isFinite(event.visit?.min) &&
        Number.isFinite(event.visit?.max) &&
        event.visit.min >= 0 &&
        event.visit.max >= event.visit.min;
      if (validVisit) activity += event.visit[bound] * 60;
      time = start != null && validVisit ? start + event.visit[bound] * 60 : null;
      return { eventId: event.id, arrival, start, departure: time, wait, late };
    });
    const last = plan.legs?.[day.events.length];
    const completion =
      time != null && plan.end?.locationId && hasCurrentEstimate(last)
        ? time + last.estimate.seconds
        : null;
    return { completion, stops, waiting, activity };
  });
  const completion = scenarios.map(s => s.completion),
    end = plan.end?.minute == null ? null : plan.end.minute * 60;
  const conflicts = day.events.flatMap((event, index) => {
    const late = scenarios.map(s => s.stops[index].late);
    return late.some(x => x > 0) ? [{ eventId: event.id, late }] : [];
  });
  return {
    status: missing.length
      ? 'incomplete'
      : completion[0] > end
        ? 'overrun'
        : completion[1] > end
          ? 'possible-overrun'
          : 'within-window',
    missing: [...new Set(missing)],
    completion: missing.length ? null : completion,
    slack: missing.length ? null : [end - completion[1], end - completion[0]],
    travelSeconds,
    activity: scenarios.map(s => s.activity),
    waiting: scenarios.map(s => s.waiting),
    stops: day.events.map((event, index) => ({
      eventId: event.id,
      arrival: scenarios.map(s => s.stops[index].arrival),
      start: scenarios.map(s => s.stops[index].start),
      waiting: scenarios.map(s => s.stops[index].wait),
      departure: scenarios.map(s => s.stops[index].departure)
    })),
    conflicts
  };
}

export function shortenVisits(day, eventId) {
  const next = structuredClone(day);
  for (const event of next.events)
    if (event.id === eventId && event.visit)
      event.visit = { ...event.visit, max: event.visit.min, source: 'user' };
  return next;
}

export function formatPlanTime(seconds) {
  if (seconds == null) return '待计算';
  const minute = Math.floor(seconds / 60),
    offset = Math.floor(minute / 1440),
    clock = minute % 1440;
  return `${offset ? (offset === 1 ? '次日 ' : `第${offset + 1}日 `) : ''}${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}`;
}

export function formatPlanRange(values) {
  return values[0] === values[1] ? formatPlanTime(values[0]) : values.map(formatPlanTime).join('—');
}

export function describeGuideTime(stop, originalMinute) {
  if (originalMinute == null) return '';
  const original = formatPlanTime(originalMinute * 60);
  if (stop.arrival.some(time => time == null)) return ` · 原文 ${original}（仅对照）`;
  const differences = stop.arrival.map(time => time - originalMinute * 60);
  const describe = seconds =>
    seconds === 0 ? '一致' : `${seconds > 0 ? '晚' : '早'}${Math.ceil(Math.abs(seconds) / 60)}分钟`;
  return ` · 原文 ${original}：${differences[0] === differences[1] ? describe(differences[0]) : differences.map(describe).join('至')}（仅对照）`;
}

export function planSummary(day) {
  const result = evaluateDayPlan(day);
  if (!result) return '';
  if (result.status === 'incomplete') return '未完整计算：' + result.missing.join('；');
  const labels = {
    'within-window': '预计在窗口内',
    'possible-overrun': '可能超时',
    overrun: '预计超时'
  };
  return `${labels[result.status]} · 预计结束 ${formatPlanRange(result.completion)}${result.slack[0] === 0 ? ' · 较长耗时情景没有额外缓冲' : ''}${result.conflicts.length ? ' · 有固定时间冲突' : ''}`;
}

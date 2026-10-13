export function parseGuideClock(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
}

export function normalizeGuideTimeFacts(event, index) {
  const min = event.duration_min,
    max = event.duration_max;
  const valid =
    typeof min === 'number' &&
    typeof max === 'number' &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    min >= 0 &&
    max >= min;
  const mode = ['walking', 'riding', 'driving', 'transit'].includes(event.transport_mode)
    ? event.transport_mode
    : null;
  const startMode = ['walking', 'riding', 'driving', 'transit'].includes(event.start_transport_mode)
    ? event.start_transport_mode
    : null;
  return {
    order: index,
    quote: String(event.source_quote || '').slice(0, 200),
    timeText: String(event.time_text || '').slice(0, 120),
    arrival: parseGuideClock(event.arrival_time),
    duration: valid ? { min, max } : null,
    fixedCandidate: parseGuideClock(event.fixed_time),
    activity: String(event.activity_type || '').slice(0, 40),
    transport: mode
      ? { mode, preference: event.transport_preference === 'subway' ? 'subway' : null }
      : null,
    startTransport: startMode
      ? {
          mode: startMode,
          preference: event.start_transport_preference === 'subway' ? 'subway' : null
        }
      : null
  };
}

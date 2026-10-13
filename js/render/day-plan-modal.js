// Inline day assessment. The historical filename is retained in the 2D manifest.
import { escapeHTML } from '../utils.js';
import {
  reconcilePlan,
  evaluateDayPlan,
  formatPlanRange,
  planSummary,
  shortenVisits
} from '../day-plan.js';
import { ROUTE_MODE_OPTIONS } from '../route-config.js';

const sessions = new Map();
export function cancelDayPlanSessions() {
  for (const session of sessions.values()) {
    session.sequence++;
    session.busy = false;
    session.preview = null;
  }
}
const clock = minute =>
  minute == null
    ? ''
    : `${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const readClock = value =>
  value ? value.split(':').reduce((h, m) => Number(h) * 60 + Number(m)) : null;
const number = value => (value === '' ? null : Number(value));
const modeOptions = mode =>
  '<option value="">待确认</option>' +
  ROUTE_MODE_OPTIONS.map(
    o => `<option value="${o.id}" ${o.id === mode ? 'selected' : ''}>${o.label}</option>`
  ).join('');
const stamp = estimate =>
  estimate
    ? `历史估计 ${Math.ceil(estimate.seconds / 60)} 分钟 · 获取于 ${new Date(estimate.fetchedAt).toLocaleString()}`
    : '尚无可用于评估的真实耗时';

export function mountDayPlan(group, day, locations, handlers, ownerKey) {
  const key = ownerKey + '/' + day.id;
  if (!sessions.has(key))
    sessions.set(key, {
      draft: null,
      preview: null,
      undo: null,
      busy: false,
      sequence: 0,
      notice: ''
    });
  const session = sessions.get(key);
  session.preview = null;
  if (session.undo) {
    const patch = session.undo;
    const value =
      patch.type === 'visit'
        ? day.events.find(e => e.id === patch.id)?.visit
        : day.plan.legs.find(x => x.from === patch.from && x.to === patch.to);
    if (
      !value ||
      (patch.type === 'visit'
        ? value.min !== patch.after.min || value.max !== patch.after.max
        : value.mode !== patch.after.mode ||
          value.transitPreference !== patch.after.transitPreference)
    )
      session.undo = null;
  }
  session.root = group;
  session.locations = locations;
  group._planSession = session;
  const form = group.querySelector('.plan-form');
  const view = session.draft ? mergeDraft(day, session.draft) : day;
  const plan = reconcilePlan(view, view.plan);
  const options = selected =>
    '<option value="">请选择</option>' +
    Object.entries(locations)
      .map(
        ([id, loc]) =>
          `<option value="${escapeHTML(id)}" ${id === selected ? 'selected' : ''}>${escapeHTML(loc.name)}</option>`
      )
      .join('');
  form.querySelector('.plan-settings-slot').innerHTML =
    `<details class="plan-settings" ${!plan.start.locationId || !plan.end.locationId ? 'open' : ''}>
    <summary><span>${escapeHTML(locations[plan.start.locationId]?.name || '待选出发地')} ${clock(plan.start.minute) || '待填时间'} 出发 → ${escapeHTML(locations[plan.end.locationId]?.name || '待选结束地')} ${plan.end.minute >= 1440 ? '次日 ' : ''}${clock(plan.end.minute) || '待填时间'} 前抵达</span><span>编辑起讫与日期</span></summary>
    <div class="plan-grid">
      <label>出发地点<select name="startLocation">${options(plan.start.locationId)}</select></label><label>出发时间<input name="startTime" type="time" value="${clock(plan.start.minute)}"></label>
      <label>结束地点<select name="endLocation">${options(plan.end.locationId)}</select></label><label>希望抵达时间<input name="endTime" type="time" value="${clock(plan.end.minute)}"></label>
      <label>旅行日期（可选）<input name="date" type="date" value="${escapeHTML(plan.travelDate || '')}"></label><label class="plan-checkbox"><input name="nextDay" type="checkbox" ${plan.end.minute >= 1440 ? 'checked' : ''}>次日结束</label>
    </div><button type="button" class="text-button plan-search-endpoint">搜索新的起讫地点</button></details>
    <label class="plan-batch-label">批量补充缺失交通<select class="plan-batch"><option value="">不修改</option>${ROUTE_MODE_OPTIONS.map(o => `<option value="${o.id}">${o.label}</option>`).join('')}</select></label>`;
  for (const event of view.events) {
    const card = [...group.querySelectorAll('.card')].find(el => el.dataset.eventId === event.id);
    if (!card) continue;
    const container = document.createElement('details');
    container.className = 'plan-event';
    container.dataset.event = event.id;
    container.open = event.visit?.min == null || event.visit?.max == null;
    container.innerHTML = `<summary>停留 ${event.visit?.min == null || event.visit?.max == null ? '时间待补充' : event.visit.min === event.visit.max ? event.visit.min + ' 分钟' : event.visit.min + '—' + event.visit.max + ' 分钟'} · 查看依据与编辑</summary>
      <p class="plan-source">原文：${escapeHTML(event.sourceFacts?.quote || event.sourceQuote || '未提供时间依据')}${event.sourceFacts?.timeText ? ' · ' + escapeHTML(event.sourceFacts.timeText) : ''}${event.sourceFacts?.duration ? ' · 停留 ' + event.sourceFacts.duration.min + '—' + event.sourceFacts.duration.max + ' 分钟' : ''}</p>
      <div class="plan-grid"><label>最短（分钟）<input name="min" type="number" min="0" step="1" value="${event.visit?.min ?? ''}"></label><label>最长（分钟）<input name="max" type="number" min="0" step="1" value="${event.visit?.max ?? ''}"></label>
      <label>固定开始时间<input name="fixed" type="time" value="${clock(event.fixedStart ?? event.sourceFacts?.fixedCandidate)}"></label><label class="plan-checkbox"><input name="fixedNext" type="checkbox" ${event.fixedStart >= 1440 ? 'checked' : ''}>固定时间在次日</label></div>
      <label class="plan-checkbox"><input name="fixedConfirmed" type="checkbox" ${event.fixedStart != null ? 'checked' : ''}>确认为固定预约（普通叙述只作对照）</label>`;
    card.querySelector('.card-content').appendChild(container);
    container.addEventListener('click', e => e.stopPropagation());
  }
  plan.legs.forEach((leg, i) => {
    const card = group.querySelector(`[data-route-id="${CSS.escape(day.id)}-plan-route-${i}"]`);
    if (!card) return;
    const editor = document.createElement('div');
    editor.className = 'plan-leg';
    editor.dataset.leg = String(i);
    editor.setAttribute(
      'aria-label',
      `${locations[leg.fromLocationId]?.name || '待选起点'} → ${locations[leg.toLocationId]?.name || '待选终点'}`
    );
    editor.innerHTML = `<label><select name="mode" aria-label="路段${i + 1}交通方式">${modeOptions(leg.mode)}</select></label>
      ${leg.transitPreference === 'subway' ? '<label class="plan-checkbox"><input name="acceptTransit" type="checkbox">原文指定地铁；接受公共交通替代</label>' : ''}
      <small class="plan-route-source"></small>
      <details class="plan-compare-options"><summary>查看依据与比较方式</summary><small class="plan-route-history"></small><select name="compareMode" aria-label="路段${i + 1}比较方式">${modeOptions(leg.mode)}</select><button type="button" class="text-button plan-compare" data-index="${i}">预览所选方式</button></details>`;
    editor.addEventListener('click', e => e.stopPropagation());
    card.appendChild(editor);
  });
  const startNode = document.createElement('div');
  startNode.className = 'plan-terminal';
  startNode.textContent = `出发 · ${locations[plan.start.locationId]?.name || '待选地点'} · ${clock(plan.start.minute) || '待填时间'}`;
  form.querySelector('.event-container').prepend(startNode);
  const endNode = document.createElement('div');
  endNode.className = 'plan-terminal plan-end';
  form.querySelector('.event-container').appendChild(endNode);
  form.querySelector('.plan-actions-slot').innerHTML =
    `<details class="plan-suggestions"><summary>查看调整建议</summary>${day.events
      .filter(e => e.visit?.max > e.visit?.min)
      .map(
        event =>
          `<button type="button" class="text-button plan-short" data-id="${escapeHTML(event.id)}">预览「${escapeHTML(event.title)}」按较短停留安排</button>`
      )
      .join(
        ''
      )}<p class="plan-preview"></p><button type="button" class="text-button plan-apply">采用建议</button></details>
    <button type="button" class="text-button plan-undo">撤销最近采用</button>
    <p class="plan-message" role="status"></p><div class="plan-actions"><button type="submit" class="text-button plan-save">保存设置</button><button type="button" class="modal-submit plan-calculate">更新评估</button><button type="button" class="text-button plan-cancel">取消查询</button></div>
    <div class="plan-save-recovery" hidden><button type="button" class="text-button plan-retry">重试保存</button><button type="button" class="text-button plan-export">导出JSON备份</button></div>`;
  const current = () => handlers.getDay();
  const notify = text => {
    session.notice = text;
    refreshDayPlan(current());
  };
  const cancel = () => {
    session.sequence++;
    session.busy = false;
    handlers.onCancel();
  };
  const read = (validate = true) => {
    if (validate && !form.reportValidity()) return null;
    const next = structuredClone(current());
    next.plan = {
      ...next.plan,
      travelDate: form.elements.date.value || null,
      start: {
        locationId: form.elements.startLocation.value || null,
        minute: readClock(form.elements.startTime.value)
      },
      end: {
        locationId: form.elements.endLocation.value || null,
        minute: readClock(form.elements.endTime.value)
      }
    };
    if (next.plan.end.minute != null && form.elements.nextDay.checked) next.plan.end.minute += 1440;
    if (
      validate &&
      next.plan.start.minute != null &&
      next.plan.end.minute != null &&
      next.plan.end.minute <= next.plan.start.minute
    ) {
      notify('结束须晚于出发，跨午夜请勾选次日。');
      return null;
    }
    for (const field of form.querySelectorAll('[data-event]')) {
      const event = next.events.find(e => e.id === field.dataset.event);
      const min = number(field.querySelector('[name=min]').value),
        max = number(field.querySelector('[name=max]').value);
      if (validate && min != null && max != null && max < min) {
        notify('最长停留不能小于最短停留。');
        return null;
      }
      event.visit =
        min == null && max == null
          ? null
          : {
              min,
              max,
              source:
                event.visit?.min === min && event.visit?.max === max ? event.visit.source : 'user'
            };
      const fixed = readClock(field.querySelector('[name=fixed]').value);
      event.fixedStart =
        field.querySelector('[name=fixedConfirmed]').checked && fixed != null
          ? fixed + (field.querySelector('[name=fixedNext]').checked ? 1440 : 0)
          : null;
    }
    next.plan.legs = next.plan.legs.map((leg, i) => {
      const field = form.querySelector(`[data-leg="${i}"]`);
      const mode = field.querySelector('[name=mode]').value || null;
      const preference =
        mode !== 'transit' || field.querySelector('[name=acceptTransit]')?.checked
          ? null
          : leg.transitPreference;
      const unchanged = mode === leg.mode && preference === leg.transitPreference;
      return {
        ...leg,
        mode,
        transitPreference: preference,
        modeSource: mode === leg.mode ? leg.modeSource : 'user',
        estimate: unchanged ? leg.estimate : null,
        previousEstimate: unchanged
          ? leg.previousEstimate
          : leg.estimate?.status === 'real'
            ? leg.estimate
            : leg.previousEstimate,
        queryState: unchanged ? leg.queryState : 'changed'
      };
    });
    next.plan = reconcilePlan(next, next.plan);
    return next;
  };
  const store = async next => {
    session.draft = null;
    session.preview = null;
    const result = await handlers.onSave(next);
    session.storageFailed = !result.ok;
    notify(
      result.ok ? '已保存到浏览器本地。' : '保存失败；修改仅在当前页面有效，请重试或导出JSON备份。'
    );
    return true;
  };
  form.addEventListener('input', e => {
    session.preview = null;
    if (session.busy) cancel();
    if (e.target.name === 'compareMode') {
      refreshDayPlan(current());
      return;
    }
    session.draft = read(false);
    notify('有未保存修改；保存设置后更新评估。');
  });
  form.querySelector('.plan-batch').addEventListener('change', e => {
    for (const select of form.querySelectorAll('[data-leg] [name=mode]'))
      if (!select.value) select.value = e.target.value;
    session.draft = read(false);
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const next = read();
    if (!next) return;
    cancel();
    await store(next);
  });
  form.querySelector('.plan-calculate').addEventListener('click', async () => {
    const next = read();
    if (!next || session.busy) return;
    cancel();
    const run = session.sequence;
    session.busy = true;
    await store(next);
    if (run !== session.sequence) return;
    refreshDayPlan(current());
    await handlers.onCalculate();
    if (run !== session.sequence) return;
    session.busy = false;
    notify(
      session.storageFailed
        ? '保存失败；本次评估仅在当前页面有效，请备份。'
        : '评估已更新；请查看当前状态与各段获取时间。'
    );
  });
  form.querySelector('.plan-cancel').addEventListener('click', () => {
    cancel();
    notify('已取消查询；保留当前编辑，旧响应不会写回。');
  });
  form.querySelector('.plan-retry').addEventListener('click', async () => {
    const result = await handlers.onRetrySave();
    session.storageFailed = !result.ok;
    notify(result.ok ? '已保存到浏览器本地。' : '保存仍失败，请导出JSON备份。');
  });
  form.querySelector('.plan-export').addEventListener('click', handlers.onExport);
  form.querySelector('.plan-search-endpoint').addEventListener('click', () => {
    if (session.draft) {
      notify('先保存未完成设置，再搜索新地点。');
      return;
    }
    handlers.onSearchEndpoint();
  });
  const canPreview = () => {
    if (session.draft) {
      notify('请先保存修改，再预览单项调整。');
      return false;
    }
    return !session.busy;
  };
  form.querySelectorAll('.plan-short').forEach(button =>
    button.addEventListener('click', () => {
      if (!canPreview()) return;
      const before = current(),
        changed = shortenVisits(before, button.dataset.id);
      session.preview = {
        type: 'visit',
        id: button.dataset.id,
        before: structuredClone(before.events.find(e => e.id === button.dataset.id).visit),
        after: changed.events.find(e => e.id === button.dataset.id).visit,
        text: previewText(before, changed, '该站采用较短参观安排')
      };
      refreshDayPlan(before);
    })
  );
  form.querySelectorAll('.plan-compare').forEach(button =>
    button.addEventListener('click', async () => {
      if (!canPreview()) return;
      const index = Number(button.dataset.index),
        before = structuredClone(current()),
        next = structuredClone(before);
      const mode = button.closest('.plan-leg').querySelector('[name=compareMode]').value;
      if (!mode) {
        notify('先选择要比较的交通方式。');
        return;
      }
      next.plan.legs[index].mode = mode;
      next.plan.legs[index].modeSource = 'user';
      if (mode !== 'transit') next.plan.legs[index].transitPreference = null;
      next.plan.legs[index].estimate = null;
      cancel();
      const run = session.sequence;
      session.busy = true;
      refreshDayPlan(current());
      const estimate = await handlers.onCompare(next, index);
      if (run !== session.sequence) return;
      session.busy = false;
      if (!estimate) {
        notify('未取得替代方式耗时，不能承诺节省。');
        return;
      }
      next.plan.legs[index].estimate = estimate;
      next.plan.legs[index].queryState = 'success';
      const leg = before.plan.legs[index];
      session.preview = {
        type: 'leg',
        from: leg.from,
        to: leg.to,
        before: structuredClone(leg),
        after: next.plan.legs[index],
        text: previewText(before, next, '需确认费用、换乘与体验')
      };
      refreshDayPlan(current());
    })
  );
  form.querySelector('.plan-apply').addEventListener('click', async () => {
    if (!session.preview || session.draft || session.busy) return;
    const patch = session.preview;
    session.undo = patch;
    await store(applyPatch(current(), patch, 'after'));
  });
  form.querySelector('.plan-undo').addEventListener('click', async () => {
    if (!session.undo || session.draft || session.busy) return;
    const patch = session.undo;
    session.undo = null;
    await store(applyPatch(current(), patch, 'before'));
  });
  refreshDayPlan(day);
}

function mergeDraft(day, draft) {
  const next = structuredClone(day);
  next.plan = {
    ...next.plan,
    start: draft.plan.start,
    end: draft.plan.end,
    travelDate: draft.plan.travelDate
  };
  next.plan.legs = next.plan.legs.map(
    leg => draft.plan.legs.find(x => x.from === leg.from && x.to === leg.to) || leg
  );
  for (const event of next.events) {
    const prior = draft.events.find(e => e.id === event.id);
    if (prior) {
      event.visit = prior.visit;
      event.fixedStart = prior.fixedStart;
    }
  }
  return next;
}

function applyPatch(day, patch, side) {
  const next = structuredClone(day);
  if (patch.type === 'visit')
    next.events.find(e => e.id === patch.id).visit = structuredClone(patch[side]);
  else {
    const leg = next.plan.legs.find(x => x.from === patch.from && x.to === patch.to);
    Object.assign(leg, structuredClone(patch[side]));
  }
  return next;
}

function previewText(before, after, cost) {
  const a = evaluateDayPlan(before),
    b = evaluateDayPlan(after);
  return a.completion && b.completion
    ? `当前预计结束 ${formatPlanRange(a.completion)} → 建议预计结束 ${formatPlanRange(b.completion)}；较短/较长情景分别节省 ${a.completion.map((value, i) => Math.round((value - b.completion[i]) / 60)).join('/')} 分钟（负数表示增加）。代价：${cost}。`
    : `资料尚缺，不能计算整日节省。代价：${cost}。`;
}

export function refreshDayPlan(day) {
  const group = document.querySelector(`.day-group[data-day-id="${CSS.escape(day.id)}"]`);
  const session = group?._planSession;
  if (!session) return;
  const result = evaluateDayPlan(day);
  const minRange = values => {
    const bounds = values.map(x => Math.ceil(x / 60)).sort((a, b) => a - b);
    return bounds[0] === bounds[1] ? String(bounds[0]) : bounds.join('—');
  };
  group.querySelector('.plan-results-slot').innerHTML =
    `<section class="plan-results day-plan-summary" data-plan-day="${escapeHTML(day.id)}" tabindex="-1" aria-live="polite">
    <h3>${escapeHTML(planSummary(day))}</h3>
    <div class="plan-totals"><span>交通${result.completion ? '' : '已知小计'}<strong>${Math.ceil(result.travelSeconds / 60)} 分钟</strong></span><span>活动${result.completion ? '' : '已知小计'}<strong>${minRange(result.activity)} 分钟</strong></span><span>等待${result.completion ? '' : '已知小计'}<strong>${minRange(result.waiting)} 分钟</strong></span></div>
    ${result.slack ? `<p>余量 ${result.slack.map(x => Math.floor(x / 60)).join('—')} 分钟</p>` : '<button type="button" class="text-button plan-find-missing">定位缺项</button>'}
    ${result.conflicts.length ? '<p class="plan-conflicts">固定时间冲突：' + result.conflicts.map(c => escapeHTML(day.events.find(e => e.id === c.eventId)?.title || '地点') + ' 可能迟到 ' + Math.ceil(Math.max(...c.late) / 60) + ' 分钟').join('；') + '</p>' : ''}
    <details class="plan-timeline"><summary>展开时间轴</summary><ol>${result.stops.map(stop => `<li>${escapeHTML(day.events.find(e => e.id === stop.eventId)?.title || '地点')}：到达 ${formatPlanRange(stop.arrival)}；开始 ${formatPlanRange(stop.start)}；离开 ${formatPlanRange(stop.departure)}；等待 ${stop.waiting.map(x => (x == null ? '待计算' : Math.ceil(x / 60) + '分')).join('—')}</li>`).join('')}</ol></details></section>`;
  group.querySelector('.plan-find-missing')?.addEventListener('click', () => {
    const field = [
      ...group.querySelectorAll(
        '[name=startLocation],[name=startTime],[name=endLocation],[name=endTime],[name=mode],[name=min],[name=max]'
      )
    ].find(el => el.value === '');
    if (field) {
      const details = field.closest('details');
      if (details) details.open = true;
      field.focus();
      field.scrollIntoView({ block: 'nearest' });
    } else group.querySelector('.plan-calculate').focus();
  });
  for (const [index, leg] of day.plan.legs.entries()) {
    const source = group.querySelector(`[data-leg="${index}"] .plan-route-source`);
    const history = group.querySelector(`[data-leg="${index}"] .plan-route-history`);
    if (source)
      source.textContent =
        leg.estimate?.status === 'real'
          ? `地图估计 ${Math.ceil(leg.estimate.seconds / 60)} 分钟`
          : `${leg.queryState === 'failed' ? '更新失败 · ' : leg.queryState === 'cancelled' ? '已取消 · ' : ''}${leg.previousEstimate ? '旧估计仅供查看' : '待补充耗时'}`;
    if (history)
      history.textContent =
        leg.estimate?.status === 'real'
          ? stamp(leg.estimate) + ' · 查询时估计，非未来路况预测'
          : stamp(leg.previousEstimate) + (leg.previousEstimate ? ' · 不计入本次评估' : '');
  }
  group.querySelector('.plan-end').textContent =
    `结束 · ${session.locations[day.plan.end.locationId]?.name || '待选地点'} · 预计抵达：${result.completion ? formatPlanRange(result.completion) : '待计算'}`;
  group.querySelector('.plan-preview').textContent =
    session.preview?.text || '每次预览一项，采用后才修改计划。';
  if (session.preview) {
    group.querySelector('.plan-suggestions').open = true;
    group.querySelector('.plan-preview').scrollIntoView({ block: 'nearest' });
  }
  group.querySelector('.plan-message').textContent = session.busy
    ? '正在查询真实道路，可编辑或取消。'
    : session.notice;
  group.querySelector('.plan-apply').disabled =
    !session.preview || Boolean(session.draft) || session.busy;
  group.querySelector('.plan-undo').disabled =
    !session.undo || Boolean(session.draft) || session.busy;
  group.querySelector('.plan-calculate').disabled = session.busy;
  group.querySelector('.plan-cancel').hidden = !session.busy;
  group.querySelector('.plan-save-recovery').hidden = !session.storageFailed;
  group.querySelector('.plan-batch-label').hidden = !day.plan.legs.some(leg => !leg.mode);
}

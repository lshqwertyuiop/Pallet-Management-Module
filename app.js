(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const format = n => n.toLocaleString('zh-CN', {maximumFractionDigits: 1});
  const formatPartWeight = weight => weight == null ? '—' : format(weight);
  const sortTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const formatSortTime = value => value ? sortTimeFormatter.format(new Date(value)) : '';
  let store = new PalletModel.Store(PalletModel.demoSnapshot());
  let external = false;
  let palletIndex = 0, page = 1, pageSize = 10, sort = 0, historyIndex = -1;
  let filteredHistory = [];
  let filters = {keyword: '', flow: '', ship: '', mark: ''}, resetTarget = null;
  const pallet = () => store.pallets[palletIndex];
  let toastTimer;
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
  function mutate(change, source = external) {
    const next = new PalletModel.Store(store.snapshot());
    const result = change(next);
    store = next; external = source; renderAll(); return result;
  }
  function attempt(action) { try { action(); } catch (error) { toast(error.message); } }
  const statusHTML = p => {
    const style = p.fullAlarmAcknowledged ? 'awaiting-swap' : p.latched ? 'full' : '';
    return `<span class="status ${style}"><i class="dot ${style}"></i>${p.status}</span>`;
  };
  function metric(label, value, max, unit) {
    const exceeded = value >= max;
    return `<div class="pallet-metric"><div class="metric-label ${exceeded ? 'exceeded' : ''}"><span>${label}</span><strong>${format(value)} / ${format(max)} ${unit}</strong></div><div class="meter"><span class="${exceeded ? 'exceeded' : ''}" style="width:${Math.min(100, value / max * 100)}%"></span></div></div>`;
  }
  function workbench(p) {
    const locked = !!p.pending;
    const limit = store.limits[p.type];
    const retained = p.reasons.includes('数量达到上限') && p.parts.length < limit.count ||
      p.reasons.includes('重量达到上限') && p.weight < limit.weight;
    const note = p.allowance ? '已允许额外 1 件，等待分拣接收' : p.pending ? '1 件正在入盘，完成前不可复位' : retained && !p.fullAlarmAcknowledged ? '此前已触发容量报警' : '';
    const rows = p.parts.slice(0, 3).map(part => `<tr><td>${escapeHTML(part.id)}</td><td>${escapeHTML(part.workOrderNo)}</td><td>${escapeHTML(part.flow)}</td><td class="numeric">${formatPartWeight(part.weight)}</td><td class="numeric">${format(part.length)}</td></tr>`).join('');
    const receivingStatus = p.clearedAlarmReasons.length ? '满盘报警已解除 · 恢复收件' : '正常接收 · 未触发满盘条件';
    const reasons = p.reasons.length ? p.reasons : [receivingStatus];
    const reasonText = escapeHTML(reasons.join('；'));
    const displayedReason = p.fullAlarmAcknowledged ? '满盘报警已复位 · 等待换盘' : reasonText;
    const alarmStyle = p.fullAlarmAcknowledged ? 'awaiting-swap' : p.latched ? 'full' : '';
    return `<article class="pallet workbench${alarmStyle === 'full' ? ' is-full' : ''}" id="pallet-${p.id}" tabindex="-1" aria-labelledby="workbench-${p.id}">
      <div class="workbench-heading"><div class="workbench-identity"><div><h2 id="workbench-${p.id}">${p.name}</h2><div class="workbench-number">${escapeHTML(p.number)}</div></div>${statusHTML(p)}</div></div>
      <div class="workbench-metrics">${metric('累计数量', p.parts.length, limit.count, '件')}${metric('累计重量', p.weight, limit.weight, 'kg')}</div>
      <div class="workbench-reason ${alarmStyle}" title="${reasonText}"><span>${displayedReason}</span>${note ? `<span class="workbench-note">${escapeHTML(note)}</span>` : ''}</div>
      <div class="workbench-preview"><table class="workbench-table" aria-label="${p.name}零件摘要"><thead><tr><th>零件编号</th><th>工单号</th><th>流向</th><th class="numeric">重量 / kg</th><th class="numeric">长度 / mm</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="workbench-empty">空托盘 · 等待零件入盘</td></tr>'}</tbody></table></div>
      <div class="workbench-footer"><div class="workbench-actions" role="group" aria-label="${p.name}操作">
        <button class="btn" data-action="one" data-id="${p.id}" hidden ${locked || !p.latched || p.allowance ? 'disabled' : ''}>再加一件</button>
        <button class="btn" data-action="continue" data-id="${p.id}" hidden ${locked || p.allowMixedFlow || p.allowance ? 'disabled' : ''}>${p.allowMixedFlow ? '已启用不限流向' : '继续装盘（不限流向）'}</button>
        <button class="btn primary" data-action="reset" data-id="${p.id}" ${locked ? 'disabled' : ''}>满盘复位</button>
      </div><button class="workbench-detail" data-action="detail" data-id="${p.id}" aria-label="查看${p.name}全部明细">全部明细 →</button></div>
    </article>`;
  }
  function renderPallets() {
    const full = store.pallets.filter(p => p.latched && !p.fullAlarmAcknowledged).length;
    const awaitingSwap = store.pallets.filter(p => p.fullAlarmAcknowledged).length;
    const normal = store.pallets.length - full - awaitingSwap;
    $('pallet-summary').innerHTML = `<span class="legend"><i class="dot"></i>正常 ${normal}</span><span class="legend"><i class="dot full"></i>满盘 ${full}</span>${awaitingSwap ? `<span class="legend"><i class="dot awaiting-swap"></i>待换盘 ${awaitingSwap}</span>` : ''}`;
    $('pallet-grid').innerHTML = store.pallets.map(workbench).join('');
    const p = pallet();
    $('detail-id').textContent = `托盘编号：${p.number}`; $('detail-status').innerHTML = statusHTML(p);
    $('detail-heading').textContent = `${p.name} · 盘内零件`;
    $('open-manual').hidden = !$('history-panel').hidden;
  }
  function fillOptions(id, key) {
    const value = $(id).value;
    $(id).innerHTML = '<option value="">全部</option>' + [...new Set(pallet().parts.map(p => p[key]))].map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('');
    if ([...$(id).options].some(o => o.value === value)) $(id).value = value;
  }
  function resetFilters() {
    filters = {keyword: '', flow: '', ship: '', mark: ''}; page = 1; sort = 0;
    $('keyword').value = ''; $('mark-filter').value = ''; $('flow-filter').value = ''; $('ship-filter').value = '';
    fillOptions('flow-filter', 'flow'); fillOptions('ship-filter', 'ship');
  }
  const partMarks = part => part.marks ?? [];
  function filteredParts() {
    const selectedFlow = PalletModel.flowCode(filters.flow);
    const rows = pallet().parts.filter(p => {
      const marks = partMarks(p);
      const matchesMark = !filters.mark || (filters.mark === 'none' ? marks.length === 0 : marks.includes(filters.mark));
      return matchesMark && (!filters.keyword || p.id.toLowerCase().includes(filters.keyword) || p.program.toLowerCase().includes(filters.keyword)) &&
        (!selectedFlow || PalletModel.flowCode(p.flow) === selectedFlow) && (!filters.ship || p.ship === filters.ship);
    });
    if (sort) rows.sort((a, b) => sort * (a.length - b.length)); return rows;
  }
  function partMarkTags(part) {
    const marks = partMarks(part);
    if (!marks.length) return '<span class="muted-dash" aria-label="未标记">—</span>';
    return marks.map(mark => `<span class="part-mark ${mark === '余料' ? 'part-mark-remnant' : 'part-mark-mixed'}">${escapeHTML(mark)}</span>`).join('');
  }
  function partRows(parts, start = 0, historical = false) {
    return parts.map((p, i) => {
      const weight = historical ? '' : `<td class="numeric">${formatPartWeight(p.weight)}</td>`;
      const times = historical
        ? `<td>${formatSortTime(p.sortStartedAt) || '—'}</td><td>${formatSortTime(p.sortReportedAt) || '—'}</td>`
        : '';
      return `<tr><td>${String(start + i + 1).padStart(2, '0')}</td><td class="part-id">${escapeHTML(p.id)}</td><td>${escapeHTML(p.workOrderNo)}</td><td><span class="flow">${escapeHTML(p.flow)}</span></td><td class="mark">${partMarkTags(p)}</td><td>${escapeHTML(p.ship)}</td><td>${escapeHTML(p.section)}</td><td>${escapeHTML(p.program)}</td><td>${escapeHTML(p.profile)}</td><td>${escapeHTML(p.material)}</td>${weight}<td class="numeric">${format(p.length)}</td>${times}</tr>`;
    }).join('');
  }
  const emptyRow = (title, note, columns = 12) => `<tr><td colspan="${columns}" class="empty"><strong>${title}</strong>${note}</td></tr>`;
  function renderRows() {
    const parts = filteredParts(), totalPages = Math.max(1, Math.ceil(parts.length / pageSize)); page = Math.min(page, totalPages);
    const start = (page - 1) * pageSize;
    $('part-rows').innerHTML = parts.length ? partRows(parts.slice(start, start + pageSize), start) : emptyRow(pallet().parts.length ? '未找到符合条件的零件' : '当前托盘暂无零件', pallet().parts.length ? '请调整查询条件或重置查询。' : '零件入盘后将在此显示。');
    $('result-count').textContent = `当前托盘 ${pallet().parts.length} 件 · 筛选结果 ${parts.length} 件`;
    $('table-summary').textContent = `共 ${parts.length} 件零件 · 合计长度 ${format(parts.reduce((sum, p) => sum + p.length, 0))} mm`;
    $('page-range').textContent = parts.length ? `${start + 1}–${Math.min(start + pageSize, parts.length)} / ${parts.length} 条` : '0 条';
    const pages = [...new Set([1, page - 1, page, page + 1, totalPages].filter(n => n > 0 && n <= totalPages))].sort((a, b) => a - b);
    $('page-buttons').innerHTML = pages.map((n, i) => `${i && n - pages[i - 1] > 1 ? '<span>…</span>' : ''}<button class="page-btn ${n === page ? 'current' : ''}" ${n === page ? 'aria-current="page"' : ''} data-page="${n}" aria-label="第 ${n} 页">${n}</button>`).join('');
    $('prev').disabled = page <= 1; $('next').disabled = page >= totalPages;
    $('sort-length').querySelector('span').textContent = sort === 1 ? '↑' : sort === -1 ? '↓' : '↕';
    $('sort-length').closest('th').setAttribute('aria-sort', sort === 1 ? 'ascending' : sort === -1 ? 'descending' : 'none');
  }
  function renderHistory() {
    $('history-count').textContent = store.history.length;
    const keyword = $('history-search').value.trim().toLowerCase();
    const start = $('history-date-start').value;
    const end = $('history-date-end').value;
    const invalidRange = !!(start && end && start > end);
    const startOfRange = start ? new Date(`${start}T00:00:00`).getTime() : -Infinity;
    const dayAfterEnd = end ? new Date(`${end}T00:00:00`) : null;
    const endOfRange = dayAfterEnd ? dayAfterEnd.setDate(dayAfterEnd.getDate() + 1) : Infinity;
    const records = invalidRange ? [] : store.history.map((p, i) => ({p, i})).filter(({p}) => {
      if (!p.number.toLowerCase().includes(keyword)) return false;
      if (!start && !end) return true;
      const archivedAt = new Date(p.completedAt).getTime();
      return archivedAt >= startOfRange && archivedAt < endOfRange;
    }).reverse();
    filteredHistory = records.map(({p}) => p);
    $('export-filtered-history').disabled = !filteredHistory.some(p => p.parts.length > 0);
    $('history-date-status').textContent = invalidRange ? '开始日期不能晚于结束日期' : `共 ${records.length} 条记录`;
    $('history-date-status').classList.toggle('invalid', invalidRange);
    $('clear-history-dates').disabled = !start && !end;
    if (!records.some(r => r.i === historyIndex)) historyIndex = records.length ? records[0].i : -1;
    $('history-list').innerHTML = records.length ? records.map(({p, i}) => `<button class="history-record ${i === historyIndex ? 'active' : ''}" data-history="${i}" aria-pressed="${i === historyIndex}"><strong>${escapeHTML(p.number)}</strong>${p.name} · ${format(p.parts.length)} 件 · ${format(p.weight)} kg<span>装载批次 ${p.cycle} · ${new Date(p.completedAt).toLocaleString('zh-CN', {hour12: false})}</span></button>`).join('') : '<p class="subtitle">暂无匹配的历史托盘。</p>';
    const record = store.history[historyIndex];
    $('history-title').textContent = record ? `${record.name} · ${record.number}` : '历史盘内零件';
    $('history-caption').textContent = record ? `装载批次 ${record.cycle} · ${record.parts.length} 件 · 归档原因：${record.reasons.join('；') || '手工吊装换盘'}` : '选择历史托盘查看其全部零件';
    $('history-rows').innerHTML = record && record.parts.length ? partRows(record.parts, 0, true) : emptyRow(record ? '该历史托盘无零件' : '暂无历史明细', '历史明细与当前托盘分开保存。', 13);
    $('export-history').disabled = !record?.parts.length;
  }
  function renderAll() {
    renderPallets();
    fillOptions('flow-filter', 'flow');
    fillOptions('ship-filter', 'ship');
    renderRows();
    renderHistory();
    alerts?.update(store.pallets, store.limits);
    if ($('manual-dialog').open && !manualEditing) renderManualAssignments();
  }
  function showView(history) {
    $('current-panel').hidden = history; $('history-panel').hidden = !history;
    for (const id of ['current-tab', 'history-tab']) {
      const selected = (id === 'history-tab') === history;
      $(id).classList.toggle('active', selected); $(id).setAttribute('aria-selected', String(selected)); $(id).tabIndex = selected ? 0 : -1;
    }
    $('open-manual').hidden = history;
  }
  function focusPallet(id) {
    showView(false);
    const target = $(`pallet-${id}`);
    target?.focus({preventScroll: true});
    target?.scrollIntoView({block: 'nearest'});
  }
  $('current-tab').addEventListener('click', () => showView(false)); $('history-tab').addEventListener('click', () => { renderHistory(); showView(true); });
  for (const id of ['current-tab', 'history-tab']) $(id).addEventListener('keydown', e => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const history = e.key === 'End' || (e.key !== 'Home' && id === 'current-tab'); showView(history); $(history ? 'history-tab' : 'current-tab').focus(); }
  });
  $('pallet-grid').addEventListener('click', e => {
    const button = e.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const {id, action} = button.dataset;
    attempt(() => {
      const target = store.get(id);
      if (action === 'detail') {
        palletIndex = store.pallets.findIndex(p => p.id === id);
        resetFilters(); renderAll(); $('detail-dialog').showModal();
      } else if (action === 'one') {
        mutate(s => s.grantOne(id)); toast(`${target.name}：已放行一件，入盘后自动复位满盘报警`);
      } else if (action === 'continue') {
        mutate(s => s.continueLoading(id));
        toast(`${target.name}：${store.get(id).latched ? '已启用不限流向，托盘仍待处理' : '已启用不限流向，可接收不同流向的零件'}`);
      } else if (action === 'reset') openReset(id);
      if (action === 'one' || action === 'continue') {
        $('pallet-grid').querySelector(`[data-action="detail"][data-id="${id}"]`).focus({preventScroll: true});
      }
    });
  });
  $('filter-form').addEventListener('submit', e => { e.preventDefault(); filters = {keyword: $('keyword').value.trim().toLowerCase(), flow: $('flow-filter').value, ship: $('ship-filter').value, mark: $('mark-filter').value}; page = 1; renderRows(); });
  $('reset').addEventListener('click', () => { resetFilters(); renderRows(); });
  $('prev').addEventListener('click', () => { page--; renderRows(); }); $('next').addEventListener('click', () => { page++; renderRows(); });
  $('page-buttons').addEventListener('click', e => { const button = e.target.closest('[data-page]'); if (button) { page = Number(button.dataset.page); renderRows(); } });
  $('page-size').addEventListener('change', () => { pageSize = Number($('page-size').value); page = 1; renderRows(); });
  $('sort-length').addEventListener('click', () => { sort = sort === 0 ? 1 : sort === 1 ? -1 : 0; page = 1; renderRows(); });
  $('history-search').addEventListener('input', renderHistory);
  for (const id of ['history-date-start', 'history-date-end']) $(id).addEventListener('change', renderHistory);
  $('clear-history-dates').addEventListener('click', () => {
    $('history-date-start').value = '';
    $('history-date-end').value = '';
    renderHistory();
  });
  $('history-list').addEventListener('click', e => { const button = e.target.closest('[data-history]'); if (button) { historyIndex = Number(button.dataset.history); renderHistory(); } });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  let manualEditing = false;
  let manualProfileId = null;
  let manualTargetCycles = new Map();
  function renderManualAssignments() {
    const current = store.cuttingProfile;
    manualProfileId = current?.id;
    manualTargetCycles = new Map(store.pallets.map(p => [p.id, p.cycle]));
    $('manual-profile').textContent = current ? `型材 ${current.id} · ${current.profile} · ${current.parts.length} 件零件` : '当前暂无切割型材。';
    const rows = current?.parts || [];
    $('manual-demo').hidden = !!current || external;
    $('manual-list').hidden = !rows.length;
    let hasEditableRows = false;
    $('manual-rows').innerHTML = rows.map(job => {
      const part = job.part;
      const assignment = store.assignments.get(job.taskId);
      const pending = store.pallets.find(p => p.pending?.requestId === job.taskId);
      const received = [...store.pallets, ...store.history].find(p => p.parts.some(palletPart => palletPart.taskId === job.taskId));
      const planned = store.assignedTarget(job.taskId);
      const target = received || pending || (planned ? store.get(planned.palletId) : null);
      const targetText = target ? escapeHTML(`${target.name}（${target.number}）`) : '未分配';
      const sortingState = received ? '分拣完成' : pending ? '分拣中' : '未开始';
      const stateClass = received ? 'received' : pending ? 'active' : 'waiting';
      let targetCell = targetText;
      if (!pending && !received) {
        hasEditableRows = true;
        if (manualEditing) {
          const options = store.pallets.filter(p => store.acceptsLength(p, part.length)).map(p => {
            const issue = store.assignmentIssue(p, job);
            const status = issue || (p.latched ? '可用单件放行' : '');
            const selection = target?.id === p.id ? ' selected' : issue ? ' disabled' : '';
            return `<option value="${escapeHTML(p.id)}"${selection}>${escapeHTML(`${p.name}（${p.number}）${status ? ' · ' + status : ''}`)}</option>`;
          }).join('');
          const placeholder = target ? '' : '<option value="">未分配</option>';
          const clear = assignment ? '<option value="clear">取消手工分配</option>' : '';
          targetCell = `<select data-assignment-task="${escapeHTML(job.taskId)}" data-original-target="${escapeHTML(target?.id || '')}" aria-label="零件 ${escapeHTML(part.id)} 的目标托盘">${placeholder}${options}${clear}</select>`;
        }
      }
      return `<tr><td class="part-id">${escapeHTML(part.id)}</td><td>${escapeHTML(part.workOrderNo)}</td><td>${escapeHTML(part.flow)}</td><td>${partMarkTags(part)}</td><td class="numeric">${format(part.length)}</td><td class="numeric">${format(job.weight)}</td><td><span class="sorting-state ${stateClass}">${sortingState}</span></td><td>${targetCell}</td></tr>`;
    }).join('');
    $('manual-edit').checked = manualEditing;
    $('manual-edit').disabled = !hasEditableRows;
    $('manual-confirm').hidden = !manualEditing;
    $('manual-hint').hidden = !manualEditing;
    $('manual-error').textContent = '';
  }
  $('open-manual').addEventListener('click', () => {
    manualEditing = false;
    renderManualAssignments();
    $('manual-dialog').showModal();
  });
  $('manual-edit').addEventListener('change', e => {
    manualEditing = e.target.checked;
    renderManualAssignments();
  });
  function finishManualEditing() {
    manualEditing = false;
    renderManualAssignments();
    $('manual-edit').focus();
  }
  $('manual-demo').addEventListener('click', () => {
    try {
      if (external) throw new Error('请等待系统提供当前切割型材');
      mutate(s => {
        const id = `XC-${Date.now()}`;
        const parts = [];
        const landed = [...s.pallets, ...s.history].find(p => p.parts.length)?.parts[0];
        if (landed) {
          landed.taskId ||= `${id}-落盘`;
          parts.push({taskId: landed.taskId, part: landed, weight: landed.weight ?? 35});
        }
        const activePallet = s.get('L01');
        if (!activePallet.pending) {
          const taskId = `${id}-PLC`;
          const flow = activePallet.parts[0]?.flow || 'X_H3M1';
          const part = demoPart(taskId, flow, 3600, 'PY');
          if (activePallet.latched && !activePallet.allowance) s.grantOne(activePallet.id);
          s.reservePart(activePallet.id, taskId, flow);
          parts.push({taskId, part, weight: 70, targetPalletId: activePallet.id});
        }
        for (const [label, length, program, weight] of [['03', 1250, 'PZ', 45], ['04', 3000, 'PJ', 60]]) {
          const taskId = `${id}-${label}`;
          const job = {taskId, part: demoPart(taskId, 'X_H1M2', length, program), weight};
          const target = s.pallets.find(p => !s.assignmentIssue(p, job));
          if (target) job.targetPalletId = target.id;
          parts.push(job);
        }
        s.setCuttingProfile({id, profile: 'HP 120×7', parts});
      });
    } catch (error) { $('manual-error').textContent = error.message; }
  });
  $('manual-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!manualEditing) return;
    try {
      const choices = [...$('manual-rows').querySelectorAll('select[data-assignment-task]')]
        .filter(select => select.value && select.value !== select.dataset.originalTarget)
        .map(select => ({
          taskId: select.dataset.assignmentTask,
          palletId: select.value === 'clear' ? '' : select.value,
          cycle: manualTargetCycles.get(select.value)
        }));
      if (choices.length) mutate(s => s.assignPallets(manualProfileId, choices));
      finishManualEditing();
      if (choices.length) toast('托盘分配已保存');
    } catch (error) {
      $('manual-error').textContent = error.message;
    }
  });
  $('open-settings').addEventListener('click', () => {
    for (const type of ['short', 'long']) {
      $(`${type}-count`).value = store.limits[type].count;
      $(`${type}-weight`).value = store.limits[type].weight;
      $(`${type}-warning`).value = store.limits[type].warningPercent;
    }
    $('settings-error').textContent = ''; $('settings-dialog').showModal();
  });
  $('settings-form').addEventListener('submit', e => {
    e.preventDefault();
    try {
      const limits = {};
      for (const type of ['short', 'long']) {
        limits[type] = {
          count: Number($(`${type}-count`).value),
          weight: Number($(`${type}-weight`).value),
          warningPercent: Number($(`${type}-warning`).value)
        };
      }
      mutate(s => s.configure(limits));
      $('settings-dialog').close();
      toast('托盘上限和预警比例已更新');
    } catch (error) { $('settings-error').textContent = error.message; }
  });
  function openReset(id) {
    const target = store.get(id);
    resetTarget = {id: target.id, cycle: target.cycle};
    $('reset-context').textContent = `${target.name} · 托盘 ${target.number} · 当前 ${target.parts.length} 件`;
    $('reset-alarm').disabled = !target.latched;
    $('reset-alarm').checked = target.latched;
    $('reset-replace').checked = !target.latched;
    $('new-number').value = target.number;
    renderResetMode();
    $('reset-dialog').showModal();
  }
  function renderResetMode() {
    const resume = $('reset-alarm').checked;
    $('reset-number-field').hidden = resume;
    $('new-number').disabled = resume;
    $('new-number').required = !resume;
    $('reset-note').textContent = resume
      ? '原托盘恢复收件，保留托盘编号和盘内零件，数量和重量继续累计。'
      : '吊走原托盘并放入空托盘后，核对托盘编号。可沿用默认编号或修改。确认后归档原盘明细，清空当前零件列表，数量和重量归零。';
    $('reset-confirm').textContent = resume ? '确认复位' : '确认换盘';
    $('reset-error').textContent = '';
  }
  for (const id of ['reset-alarm', 'reset-replace']) $(id).addEventListener('change', renderResetMode);
  $('reset-form').addEventListener('submit', e => {
    e.preventDefault();
    try {
      const resume = $('reset-alarm').checked;
      mutate(s => {
        const target = resetTarget && s.get(resetTarget.id);
        if (!target || target.cycle !== resetTarget.cycle) throw new Error('托盘批次已变化，请重新打开复位窗口');
        if (resume) {
          s.resetAlarm(target.id);
        } else {
          const number = $('new-number').value.trim();
          s.reset(target.id, number, {reuseNumber: number === target.number});
        }
      });
      resetFilters(); renderAll(); $('reset-dialog').close();
      toast(resume ? '满盘报警已解除，原托盘已恢复收件' : '原托盘已归档，空托盘已启用');
    } catch (error) { $('reset-error').textContent = error.message; }
  });
  function demoPart(id, flow, length, program) {
    return {id, workOrderNo: 'WO-20261116-03', flow, marks: [], ship: 'N1130', section: 'FC2P', program, profile: 'HP 120×7', material: 'DH36', length};
  }
  function exportHistoryCSV(records, filename) {
    const header = ['托盘位置', '托盘编号', '装载批次', '状态', '累计数量(件)', '累计重量(kg)', '归档时间', '零件编号', '工单号', '流向', '标记', '船号', '分段号', '程序号', '型材规格', '材质', '零件长度(mm)', '分拣开工时间', '分拣报工时间'];
    const details = records.flatMap(p => p.parts.map(part =>
      [p.name, p.number, p.cycle, p.status, p.parts.length, p.weight, p.completedAt || '',
        part.id, part.workOrderNo, part.flow, partMarks(part).join('、'), part.ship, part.section, part.program,
        part.profile, part.material, part.length, formatSortTime(part.sortStartedAt), formatSortTime(part.sortReportedAt)]
    ));
    if (!details.length) return;
    const cell = value => { let text = String(value); if (/^[=+@\-\t\r\n]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; };
    const blob = new Blob(['\ufeff' + [header, ...details].map(row => row.map(cell).join(',')).join('\r\n')], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url;
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast(`已导出 ${details.length} 件零件明细`);
  }
  $('export-filtered-history').addEventListener('click', () => exportHistoryCSV(filteredHistory, '历史托盘_零件明细.csv'));
  $('export-history').addEventListener('click', () => {
    const p = store.history[historyIndex];
    if (p) exportHistoryCSV([p], `${p.name}_${p.number.replace(/[<>:"/\\|?*]/g, '_')}_批次${p.cycle}_历史明细.csv`);
  });
  // Local prototype API only. Production authorization and persistence belong on the host service.
  window.PalletManagement = Object.freeze({
    getState: () => store.snapshot(),
    getDemoSnapshot: () => PalletModel.demoSnapshot(),
    setCurrentPart: current => mutate(s => s.setCurrentPart(current), true),
    setCuttingProfile: current => mutate(s => s.setCuttingProfile(current), true),
    getAssignedPallet: taskId => store.assignedTarget(taskId),
    updateMeasurements: (id, data) => mutate(s => s.updateMeasurements(id, data), true),
    completePackage: id => mutate(s => s.completePackage(id), true),
    reservePart: (id, taskId, flow, sortStartedAt) => mutate(s => s.reservePart(id, taskId, flow, sortStartedAt), true),
    receivePart: (id, token, part, data) => mutate(s => s.receivePart(id, token, part, data), true)
  });
  const alerts = window.PalletAlerts?.mount($('pallet-alerts'), {onNavigate: focusPallet});
  resetFilters(); renderAll();
})();

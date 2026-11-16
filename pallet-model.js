/* Shared by the standalone page and the Node.js behavior checks. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PalletModel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const names = ['短托盘01', '短托盘02', '长托盘01', '长托盘02'];
  const defaultCountLimits = {short: 24, long: 8};
  const defaultWarningPercent = 90;
  const longPalletFrom = 3000;
  const allowedPartMarks = ['混套', '余料'];
  const nonnegative = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  function flowCode(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    const match = text.match(/(?:^|_)(H\d+)(?:M\d+)?$/i);
    return match ? match[1].toUpperCase() : text;
  }
  function checkedLimits(limits, currentLimits) {
    const result = {};
    for (const type of ['short', 'long']) {
      const limit = limits?.[type];
      if (!limit || !Number.isSafeInteger(limit.count) || limit.count <= 0) throw new Error('数量上限必须为正整数');
      if (!nonnegative(limit.weight) || limit.weight <= 0) throw new Error('重量上限必须为大于 0 的有效数值');
      const warningPercent = limit.warningPercent === undefined
        ? currentLimits?.[type].warningPercent ?? defaultWarningPercent
        : limit.warningPercent;
      if (!nonnegative(warningPercent) || warningPercent <= 0 || warningPercent > 100) {
        throw new Error('预警比例必须大于 0 且不超过 100');
      }
      result[type] = {count: limit.count, weight: limit.weight, warningPercent};
    }
    return result;
  }
  function validatePart(part) {
    if (!part || !['id', 'flow', 'ship', 'section', 'program', 'profile', 'material'].every(k => typeof part[k] === 'string' && part[k].length > 0) || !nonnegative(part.length)) throw new Error('零件数据不完整');
    if (part.marks !== undefined && (!Array.isArray(part.marks) || part.marks.some(mark => !allowedPartMarks.includes(mark)) || new Set(part.marks).size !== part.marks.length)) throw new Error('零件标记只支持混套、余料，每项最多出现一次');
    if (part.weight != null && !nonnegative(part.weight)) throw new Error('零件重量必须为非负有效数值');
  }
  function sortingTime(value, label) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`${label}无效`);
    return new Date(value).toISOString();
  }
  function checkedPart(part) {
    validatePart(part);
    const flow = part.flow.trim();
    if (!flow) throw new Error('请提供零件流向');
    const workOrderNo = part.workOrderNo ?? part.packageId;
    if (typeof workOrderNo !== 'string' || !workOrderNo.trim()) throw new Error('请提供工单号');
    const sortStartedAt = sortingTime(part.sortStartedAt, '分拣开工时间');
    const sortReportedAt = sortingTime(part.sortReportedAt, '分拣报工时间');
    if (sortStartedAt && sortReportedAt && sortReportedAt < sortStartedAt) throw new Error('分拣报工时间不能早于开工时间');
    return {...part, flow, workOrderNo: workOrderNo.trim(), sortStartedAt, sortReportedAt};
  }
  function cuttingJob(current) {
    if (!current || typeof current.taskId !== 'string' || !current.taskId.trim()) throw new Error('请输入零件的唯一任务编号');
    if (!nonnegative(current.weight)) throw new Error('请输入有效的零件重量（kg）');
    return {taskId: current.taskId.trim(), part: copy(checkedPart(current.part)), weight: current.weight};
  }
  class Store {
    constructor(snapshot) {
      if (snapshot.version === 1) {
        const {limits, pallets, history = []} = snapshot;
        const discardLegacyFields = ({height, ignorePackage, ...pallet}) => pallet;
        snapshot = {
          ...snapshot,
          version: 2,
          limits: {
            short: {count: defaultCountLimits.short, weight: limits.short.weight},
            long: {count: defaultCountLimits.long, weight: limits.long.weight}
          },
          pallets: pallets.map(discardLegacyFields),
          history: history.map(discardLegacyFields)
        };
      }
      if (!Array.isArray(snapshot.pallets) || snapshot.pallets.length !== 4) throw new Error('必须提供四个托盘');
      this.limits = checkedLimits(snapshot.limits);
      this.pallets = copy(snapshot.pallets);
      this.history = copy(snapshot.history || []);
      for (const record of this.history) record.parts = record.parts.map(checkedPart);
      this.completedPackages = new Set(snapshot.completedPackages || []);
      this.sequence = snapshot.sequence || 0;
      this.cuttingProfile = null;
      this.assignments = new Map(copy(snapshot.assignments || []));
      for (const assignment of this.assignments.values()) assignment.part = checkedPart(assignment.part);
      const ids = new Set();
      this.pallets.forEach((p, i) => {
        if (!p.id || typeof p.id !== 'string' || ids.has(p.id) || p.name !== names[i] || p.type !== (i < 2 ? 'short' : 'long') || typeof p.number !== 'string' || !p.number || !Number.isInteger(p.cycle) || p.cycle < 1 || !Number.isInteger(p.revision) || p.revision < 0 || !nonnegative(p.weight) || !Array.isArray(p.parts)) throw new Error('托盘数据不完整');
        ids.add(p.id);
        p.parts = p.parts.map(checkedPart);
        if (new Set(p.parts.map(part => part.id)).size !== p.parts.length) throw new Error('同一托盘的零件编号不能重复');
        if (this.pallets.some(other => other !== p && other.number === p.number)) throw new Error('在用托盘编号不能重复');
        p.physicalReasons = Array.isArray(p.physicalReasons) ? p.physicalReasons.filter(r => ['数量达到上限', '重量达到上限'].includes(r)) : [];
        p.clearedAlarmReasons = Array.isArray(p.clearedAlarmReasons) ? p.clearedAlarmReasons : [];
        p.allowMixedFlow = p.allowMixedFlow === true;
        p.allowance = p.allowance === 1 ? 1 : 0;
        p.pending = p.pending || null;
        if (p.pending?.flow) p.pending.flow = flowCode(p.pending.flow);
        this.evaluate(p);
        if (!p.latched) p.allowance = 0;
      });
      for (const [taskId, job] of this.assignments) {
        const p = this.get(job.palletId);
        if (p.pending?.requestId !== taskId && !this.acceptsLength(p, job.part.length)) this.assignments.delete(taskId);
      }
      if (snapshot.cuttingProfile) this.setCuttingProfile(snapshot.cuttingProfile);
      else if (snapshot.currentPart) this.setCurrentPart(snapshot.currentPart);
    }
    get(id) { const p = this.pallets.find(p => p.id === id); if (!p) throw new Error('托盘不存在'); return p; }
    evaluate(p) {
      const limit = this.limits[p.type];
      if (p.parts.length >= limit.count && !p.physicalReasons.includes('数量达到上限')) p.physicalReasons.push('数量达到上限');
      if (p.weight >= limit.weight && !p.physicalReasons.includes('重量达到上限')) p.physicalReasons.push('重量达到上限');
      const packages = [...new Set(p.parts.map(part => part.packageId))].filter(id => this.completedPackages.has(id));
      const previousReasons = p.reasons || [];
      const reasons = [...p.physicalReasons, ...packages.map(id => `切割包 ${id} 已切完`)];
      // Only the demo snapshot supplies this simulated sorting condition.
      if (p.demoFlowFull === true && !p.allowMixedFlow) reasons.push('流向满盘');
      p.reasons = reasons.filter(reason => !p.clearedAlarmReasons.includes(reason));
      p.latched = p.reasons.length > 0;
      p.fullAlarmAcknowledged = p.latched && p.fullAlarmAcknowledged === true &&
        p.reasons.every(reason => previousReasons.includes(reason));
      p.status = p.fullAlarmAcknowledged ? '待换盘' : p.latched ? '满盘' : '正常';
    }
    acceptsLength(p, length) { return p.type === (length < longPalletFrom ? 'short' : 'long'); }
    configure(limits) {
      this.limits = checkedLimits(limits, this.limits);
      this.pallets.forEach(p => this.evaluate(p));
    }
    completePackage(packageId) {
      if (typeof packageId !== 'string' || !packageId.trim()) throw new Error('请输入有效的切割包编号');
      this.completedPackages.add(packageId.trim());
      this.pallets.forEach(p => this.evaluate(p));
    }
    continueLoading(id) {
      const p = this.get(id);
      if (p.allowance || p.pending) throw new Error('请先完成待分拣的一件，再切换装盘模式');
      p.allowMixedFlow = true;
      this.evaluate(p);
    }
    updateMeasurements(id, data) {
      const p = this.get(id);
      this.validateMeasurement(p, data);
      p.weight = data.weight; p.revision = data.revision;
      this.evaluate(p);
    }
    validateMeasurement(p, data) {
      if (!data || data.cycle !== p.cycle) throw new Error('托盘批次已变化，请丢弃旧批次数据');
      if (!Number.isInteger(data.revision) || data.revision <= p.revision) throw new Error('测量数据重复或已过期');
      if (!nonnegative(data.weight)) throw new Error('算法重量必须为非负有效数值');
    }
    grantOne(id) {
      const p = this.get(id);
      if (!p.latched) throw new Error('仅满盘托盘可申请再加一件');
      if (p.allowance || p.pending) throw new Error('已有一件待分拣，不能叠加放行');
      p.allowance = 1;
    }
    hasReceivedTask(taskId) {
      return [...this.pallets, ...this.history].some(p => p.parts.some(part => part.taskId === taskId));
    }
    reservationIssue(p, taskId, flow) {
      if (p.pending) return '当前托盘已有入盘任务';
      if (this.pallets.some(other => other.pending?.requestId === taskId)) return '该零件已有在途入盘任务';
      if (this.hasReceivedTask(taskId)) return '该任务已入盘';
      if (p.latched && p.allowance !== 1) return '托盘满盘，已暂停接收零件';
      const code = flowCode(flow);
      if (!code) return '请提供零件流向';
      const firstFlow = p.parts[0]?.flow;
      if (!p.allowMixedFlow && firstFlow && code !== flowCode(firstFlow)) return `当前托盘只接收「${firstFlow}」对应的流向`;
      return '';
    }
    reservePart(id, requestId, flow, sortStartedAt) {
      const p = this.get(id);
      if (typeof requestId !== 'string' || !requestId) throw new Error('必须提供唯一任务编号');
      flow = flowCode(flow);
      if (p.pending?.requestId === requestId) {
        if (p.pending.flow && p.pending.flow !== flow) throw new Error('任务流向与原申请不一致');
        return copy(p.pending);
      }
      const assignment = this.assignments.get(requestId);
      if (assignment && (assignment.palletId !== id || assignment.cycle !== p.cycle)) throw new Error('请按已保存的托盘分配执行分拣');
      if (assignment && flowCode(assignment.part.flow) !== flow) throw new Error('任务流向与托盘分配不一致');
      const job = assignment || this.cuttingProfile?.parts.find(item => item.taskId === requestId);
      if (job && !this.acceptsLength(p, job.part.length)) throw new Error('零件长度不符合长短托盘分配规则');
      const issue = this.reservationIssue(p, requestId, flow);
      if (issue) throw new Error(issue);
      const startedAt = sortingTime(sortStartedAt, '分拣开工时间') || new Date().toISOString();
      const extra = p.latched;
      if (extra) p.allowance = 0;
      p.pending = {token: `${p.id}:${p.cycle}:${++this.sequence}`, requestId, cycle: p.cycle, extra, flow, sortStartedAt: startedAt};
      return copy(p.pending);
    }
    receivePart(id, token, part, measurement) {
      const p = this.get(id);
      if (!p.pending || p.pending.token !== token) throw new Error('入盘任务无效或已经完成');
      part = checkedPart(part);
      this.validateMeasurement(p, measurement);
      if (p.pending.flow && flowCode(part.flow) !== p.pending.flow) throw new Error('入盘零件流向与放行任务不一致');
      const taskId = p.pending.requestId;
      const assignment = this.assignments.get(taskId);
      if (assignment && part.id !== assignment.part.id) throw new Error('入盘零件编号与托盘分配不一致');
      if (p.parts.some(existing => existing.id === part.id)) throw new Error('零件已在盘内');
      const wasExtra = p.pending.extra;
      const job = assignment || this.cuttingProfile?.parts.find(item => item.taskId === taskId);
      const nextPart = checkedPart({
        ...copy(part),
        taskId,
        weight: part.weight ?? (job?.part.id === part.id ? job.weight : undefined),
        sortStartedAt: part.sortStartedAt || p.pending.sortStartedAt,
        sortReportedAt: part.sortReportedAt || new Date().toISOString()
      });
      p.parts.push(nextPart); p.pending = null;
      this.assignments.delete(nextPart.taskId);
      this.updateMeasurements(id, measurement);
      if (wasExtra && p.latched) {
        p.fullAlarmAcknowledged = true;
        p.status = '待换盘';
      }
    }
    setCurrentPart(current) {
      const job = cuttingJob(current);
      this.setCuttingProfile({id: job.taskId, profile: job.part.profile, parts: [job]});
    }
    setCuttingProfile(current) {
      if (current === null) { this.cuttingProfile = null; return; }
      if (!current || typeof current.id !== 'string' || !current.id.trim() || typeof current.profile !== 'string' || !current.profile.trim() || !Array.isArray(current.parts)) throw new Error('请提供当前型材编号、规格和零件列表');
      const parts = current.parts.map(item => {
        const job = cuttingJob(item);
        if (!item.targetPalletId) return job;
        const pallet = this.get(item.targetPalletId);
        const targetCycle = item.targetCycle ?? pallet.cycle;
        if (!Number.isInteger(targetCycle) || targetCycle < 1) throw new Error('目标托盘批次无效');
        return {...job, targetPalletId: pallet.id, targetCycle};
      });
      if (new Set(parts.map(job => job.taskId)).size !== parts.length) throw new Error('型材零件的任务编号不能重复');
      this.cuttingProfile = {id: current.id.trim(), profile: current.profile.trim(), parts};
    }
    assignedTarget(taskId) {
      const manual = this.assignments.get(taskId);
      if (manual) return {palletId: manual.palletId, cycle: manual.cycle};
      const job = this.cuttingProfile?.parts.find(item => item.taskId === taskId);
      if (!job?.targetPalletId || this.hasReceivedTask(taskId)) return null;
      const pallet = this.get(job.targetPalletId);
      return pallet.cycle === job.targetCycle && this.acceptsLength(pallet, job.part.length)
        ? {palletId: pallet.id, cycle: pallet.cycle}
        : null;
    }
    assignmentIssue(p, job) {
      const {taskId, part, weight} = job;
      if (!this.acceptsLength(p, part.length)) return '零件长度不符合长短托盘分配规则';
      const issue = this.reservationIssue(p, taskId, part.flow);
      if (issue) return issue;
      if (p.parts.some(existing => existing.id === part.id)) return '零件已在盘内';
      if (!nonnegative(p.weight + weight)) return '入盘后的累计重量无效';
      return '';
    }
    assignPallets(profileId, choices) {
      if (!this.cuttingProfile || this.cuttingProfile.id !== profileId) throw new Error('正在切割的型材已变化，请重新打开分配窗口');
      const next = new Map(this.assignments);
      const affected = new Set();
      const tasks = new Map(this.cuttingProfile.parts.map(job => [job.taskId, job]));
      for (const {taskId, palletId, cycle} of choices) {
        const job = tasks.get(taskId);
        if (!job) throw new Error('零件已不在当前切割列表中');
        const prior = next.get(taskId);
        if ((!prior && !palletId) || (prior?.palletId === palletId && prior.cycle === cycle)) continue;
        if (this.hasReceivedTask(taskId) || this.pallets.some(p => p.pending?.requestId === taskId)) throw new Error(`零件 ${job.part.id} 已开始分拣或入盘，无法改分配`);
        if (!palletId) { next.delete(taskId); continue; }
        const pallet = this.get(palletId);
        if (pallet.cycle !== cycle) throw new Error(`${pallet.name}已换盘，请重新选择`);
        next.set(taskId, {...job, palletId, cycle});
        affected.add(palletId);
      }

      // Check the combined plan on a copy. Saving assignments never updates actual inventory.
      const projection = new Store(this.snapshot());
      projection.assignments.clear();
      for (const palletId of affected) {
        const pallet = projection.get(palletId);
        const jobs = [...next.values()].filter(job => job.palletId === palletId);
        const pendingTask = pallet.pending?.requestId;
        if (pendingTask) jobs.sort((a, b) => Number(b.taskId === pendingTask) - Number(a.taskId === pendingTask));
        for (const job of jobs) {
          const pending = pallet.pending?.requestId === job.taskId ? pallet.pending : null;
          const issue = pending ? '' : projection.assignmentIssue(pallet, job);
          if (issue) throw new Error(`零件 ${job.part.id} → ${pallet.name}：${issue}`);
          const ticket = pending || projection.reservePart(pallet.id, job.taskId, job.part.flow);
          projection.receivePart(pallet.id, ticket.token, job.part, {cycle: job.cycle, revision: pallet.revision + 1, weight: pallet.weight + job.weight});
        }
      }
      this.assignments = next;
    }
    resetAlarm(id) {
      const p = this.get(id);
      if (p.pending) throw new Error('入盘任务尚未完成，请完成后再复位');
      if (!p.latched) throw new Error('当前托盘没有待复位的满盘状态');
      p.clearedAlarmReasons.push(...p.reasons);
      p.allowance = 0;
      this.evaluate(p);
    }
    reset(id, number, {reuseNumber = false} = {}) {
      const p = this.get(id);
      if (p.pending) throw new Error('入盘任务尚未完成，请完成后再复位');
      if (reuseNumber === true) {
        number = p.number;
      } else {
        if (typeof number !== 'string' || !number.trim() || number.trim().length > 60) throw new Error('请输入有效的新托盘编号（最多 60 字）');
        number = number.trim();
        if (number === p.number) throw new Error('新托盘编号不能与原托盘编号相同');
        if (this.pallets.some(other => other.id !== id && other.number === number)) throw new Error('该托盘编号已被其他位置使用');
      }
      this.history.push({...copy(p), completedAt: new Date().toISOString()});
      for (const [taskId, assignment] of this.assignments) {
        if (assignment.palletId === id) this.assignments.delete(taskId);
      }
      p.cycle++; p.revision = 0; p.parts = []; p.weight = 0;
      p.number = number; p.physicalReasons = []; p.clearedAlarmReasons = []; p.allowMixedFlow = false;
      delete p.demoFlowFull;
      p.latched = false; p.reasons = []; p.allowance = 0; p.fullAlarmAcknowledged = false; p.status = '正常';
    }
    snapshot() { return copy({version: 2, limits: this.limits, pallets: this.pallets, history: this.history, completedPackages: [...this.completedPackages], sequence: this.sequence, cuttingProfile: this.cuttingProfile, assignments: [...this.assignments]}); }
  }
  function demoSnapshot() {
    const counts = [18, 24, 6, 5];
    const weights = [1380, 1260, 3150, 920];
    return {
      version: 2,
      limits: {
        short: {count: defaultCountLimits.short, weight: 1500, warningPercent: defaultWarningPercent},
        long: {count: defaultCountLimits.long, weight: 3000, warningPercent: defaultWarningPercent}
      },
      pallets: names.map((name, p) => ({
        id: ['S01', 'S02', 'L01', 'L02'][p], name, type: p < 2 ? 'short' : 'long', number: `TP-${['S01', 'S02', 'L01', 'L02'][p]}`,
        cycle: 1, revision: 1, weight: weights[p], demoFlowFull: p === 3,
        parts: Array.from({length: counts[p]}, (_, i) => {
          const startedAt = Date.UTC(2026, 10, 16, 1, p * 6 + i * 2);
          return {
            id: `P${p + 1}-${String(i + 1).padStart(4, '0')}`,
            packageId: p < 2 ? 'CP-20260917-01' : 'CP-20260917-02',
            workOrderNo: p < 2 ? 'WO-20261116-01' : 'WO-20261116-02',
            flow: `X_H${[1, 2, 3, 2][p]}M${i % 3 + 1}`,
            marks: [['混套'], ['余料'], ['混套', '余料'], []][i % 4],
            ship: i % 5 === 4 ? 'N1131' : 'N1130',
            section: ['FC2P', 'FC3S', 'DB01'][i % 3],
            program: ['PX', 'PY', 'PZ', 'PJ'][i % 4],
            profile: ['HP 120×7', 'HP 140×8', 'L 100×63×8'][i % 3],
            material: i % 3 === 2 ? 'AH36' : 'DH36',
            length: p < 2 ? 850 + i * 117.5 : 4250 + i * 215.5,
            weight: Math.round(weights[p] * (i + 1) / counts[p]) - Math.round(weights[p] * i / counts[p]),
            sortStartedAt: new Date(startedAt).toISOString(),
            sortReportedAt: new Date(startedAt + 75_000).toISOString()
          };
        })
      }))
    };
  }
  return {Store, demoSnapshot, flowCode};
});

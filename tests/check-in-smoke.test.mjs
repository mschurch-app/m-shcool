import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const appMarker = html.indexOf('const SUPABASE_URL');
const appScriptStart = html.lastIndexOf('<script', appMarker);
const appScriptEnd = html.indexOf('</script>', appMarker);
assert.ok(appMarker >= 0 && appScriptStart >= 0 && appScriptEnd > appMarker, 'could not locate inline application script');
const appScript = html.slice(html.indexOf('>', appScriptStart) + 1, appScriptEnd);

function createHarness({ user = null, users = user ? [user] : [], logs = [], counseling = [], schedules = [], rollCalls = [], parentMessages = [], failures = {} } = {}) {
  const writes = [];
  const elements = new Map();
  const storage = new Map();
  const alerts = [];
  const blockedRequests = [];
  const listeners = new Map();
  const counselingRows = counseling.map((record) => ({ ...record }));
  const scheduleRows = schedules.map((record) => ({ ...record }));
  const rollCallRows = rollCalls.map((record) => ({ ...record }));
  const parentMessageRows = parentMessages.map((record) => ({ ...record }));
  const getElement = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        id,
        className: '',
        innerHTML: '',
        textContent: '',
        value: '',
        classList: {
          add(...names) { names.forEach((name) => classes.add(name)); },
          remove(...names) { names.forEach((name) => classes.delete(name)); },
          toggle(name, force) { if (force === true) classes.add(name); else if (force === false) classes.delete(name); else if (classes.has(name)) classes.delete(name); else classes.add(name); return classes.has(name); },
          contains(name) { return classes.has(name); },
        },
        focus() {},
        reset() {},
        appendChild() {},
        addEventListener(event, callback) { this[`on${event}`] = callback; },
      });
    }
    return elements.get(id);
  };

  class Query {
    constructor(table) { this.table = table; this.filters = []; this.action = null; }
    select() { return this; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    gte() { return this; }
    lte() { return this; }
    order() { return this; }
    limit() { return this; }
    or() { return this; }
    maybeSingle() { return Promise.resolve({ data: user ?? null, error: null }); }
    insert(payload) {
      writes.push({ table: this.table, method: 'insert', payload });
      const error = failures[`${this.table}.insert`];
      if (!error && this.table === 'users') (Array.isArray(payload) ? payload : [payload]).forEach((row) => users.push({ ...row }));
      if (!error && this.table === 'counseling_logs') counselingRows.push({ ...payload, id: Math.max(0, ...counselingRows.map((record) => Number(record.id) || 0)) + 1 });
      if (!error && this.table === 'schedules') (Array.isArray(payload) ? payload : [payload]).forEach((row) => scheduleRows.push({ ...row, id: Math.max(0, ...scheduleRows.map((record) => Number(record.id) || 0)) + 1 }));
      return Promise.resolve({ data: null, error: error ? { message: error } : null });
    }
    update(payload) { this.action = { method: 'update', payload }; writes.push({ table: this.table, method: 'update', payload }); return this; }
    upsert(payload, options) {
      writes.push({ table: this.table, method: 'upsert', payload, options });
      const error = failures[`${this.table}.upsert`];
      if (!error && this.table === 'roll_calls') {
        for (const row of payload) {
          const existing = row.id == null ? null : rollCallRows.find(record => String(record.id) === String(row.id));
          if (existing) Object.assign(existing, row);
          else rollCallRows.push({ ...row, id: Math.max(0, ...rollCallRows.map(record => Number(record.id) || 0)) + 1 });
        }
      }
      return Promise.resolve({ data: null, error: error ? { message: error } : null });
    }
    delete() { this.action = { method: 'delete' }; writes.push({ table: this.table, method: 'delete' }); return this; }
    then(resolve, reject) {
      const error = failures[`${this.table}.${this.action?.method || 'select'}`];
      if (!error && this.action) {
        const targetRows = this.table === 'users' ? users : this.table === 'counseling_logs' ? counselingRows : this.table === 'schedules' ? scheduleRows : this.table === 'roll_calls' ? rollCallRows : this.table === 'parent_messages' ? parentMessageRows : [];
        const matches = (record) => this.filters.every(([column, value]) => String(record[column]) === String(value));
        if (this.action.method === 'update') {
          targetRows.forEach((record) => { if (matches(record)) Object.assign(record, this.action.payload); });
        } else if (this.action.method === 'delete') {
          for (let i = targetRows.length - 1; i >= 0; i--) if (matches(targetRows[i])) targetRows.splice(i, 1);
        }
      }
      const data = this.table === 'check_in_logs' ? logs : this.table === 'users' ? users : this.table === 'counseling_logs' ? counselingRows : this.table === 'schedules' ? scheduleRows : this.table === 'roll_calls' ? rollCallRows : this.table === 'parent_messages' ? parentMessageRows : [];
      return Promise.resolve({ data, error: error ? { message: error } : null }).then(resolve, reject);
    }
  }

  const db = { from: (table) => new Query(table), storage: { from: () => ({}) } };
  const context = vm.createContext({
    supabase: { createClient: () => db },
    document: {
      getElementById: getElement,
      querySelector: getElement,
      querySelectorAll: () => [],
      createElement: (tag) => ({ tagName: tag, className: '', innerHTML: '', appendChild() {} }),
      addEventListener(event, callback) { listeners.set(event, callback); },
    },
    window: {},
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    fetch(input) {
      blockedRequests.push(String(input));
      return Promise.reject(new Error('Blocked outbound request in offline test harness'));
    },
    XMLHttpRequest: class {
      constructor() { throw new Error('Blocked XMLHttpRequest in offline test harness'); }
    },
    setInterval: () => 0,
    clearInterval() {},
    setTimeout: () => 0,
    clearTimeout() {},
    alert(message) { alerts.push(message); },
    confirm: () => true,
    prompt: () => null,
  });
  new vm.Script(appScript, { filename: 'index.html:inline-app' }).runInContext(context);
  return { context, writes, elements, storage, alerts, listeners, blockedRequests, counselingRows, scheduleRows, rollCallRows, parentMessageRows };
}

test('parent messages escape stored content and allow teachers to reply with a confirmed update', async () => {
  const { context, writes, elements, alerts, parentMessageRows } = createHarness({
    user: { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師' },
    parentMessages: [{ id: 42, created_at: '2026-09-30T02:00:00.000Z', student_name: '<img src=x>', parent_message: '<script>unsafe()</script>', reply_content: null }],
  });
  vm.runInContext("currentUser = { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師' }; prompt = () => ' 已收到，謝謝。 '", context);

  await vm.runInContext('loadMessages()', context);
  assert.match(elements.get('messages-list').innerHTML, /&lt;img src=x&gt;/u);
  assert.match(elements.get('messages-list').innerHTML, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/u);
  assert.match(elements.get('messages-list').innerHTML, /replyParentMsg\(42\)/u);

  await vm.runInContext('replyParentMsg(42)', context);
  assert.equal(parentMessageRows[0].reply_content, '已收到，謝謝。');
  assert.ok(parentMessageRows[0].reply_time);
  assert.deepEqual(writes.filter(write => write.table === 'parent_messages').map(write => write.method), ['update']);
  assert.ok(alerts.some(message => message.includes('已回覆')));
});

test('part-time staff can view parent messages but cannot reply through the UI or handler', async () => {
  const { context, writes, elements, alerts } = createHarness({
    user: { id: 'P-QA-001', name: 'Synthetic Part-time Staff', role_type: '工讀生' },
    parentMessages: [{ id: 8, created_at: '2026-09-30T02:00:00.000Z', student_name: 'Synthetic Student', parent_message: '請假', reply_content: null }],
  });

  await vm.runInContext('loadMessages()', context);
  assert.match(elements.get('messages-list').innerHTML, /請假/u);
  assert.doesNotMatch(elements.get('messages-list').innerHTML, /replyParentMsg\(8\)/u);
  await vm.runInContext('replyParentMsg(8)', context);
  assert.equal(writes.some(write => write.table === 'parent_messages'), false);
  assert.ok(alerts.some(message => message.includes('只有查閱')));
});

test('parent message read and reply errors are shown instead of reported as success', async () => {
  const readHarness = createHarness({ failures: { 'parent_messages.select': 'read denied' } });
  await vm.runInContext('loadMessages()', readHarness.context);
  assert.match(readHarness.elements.get('messages-list').innerHTML, /載入失敗/u);
  assert.ok(readHarness.alerts.some(message => message.includes('read denied')));

  const writeHarness = createHarness({
    user: { id: 'M-QA-001', name: 'Synthetic Staff', role_type: '同工' },
    parentMessages: [{ id: 9, created_at: '2026-09-30T02:00:00.000Z', student_name: 'Synthetic Student', parent_message: '請假', reply_content: null }],
    failures: { 'parent_messages.update': 'write denied' },
  });
  vm.runInContext("currentUser = { id: 'M-QA-001', name: 'Synthetic Staff', role_type: '同工' }; prompt = () => '收到'", writeHarness.context);
  await vm.runInContext('replyParentMsg(9)', writeHarness.context);
  assert.ok(writeHarness.alerts.some(message => message.includes('write denied')));
  assert.equal(writeHarness.alerts.some(message => message.includes('已回覆')), false);
});

test('counseling list renders all fields safely, filters records, and calculates the visible totals', async () => {
  const { context, elements } = createHarness({
    user: { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師' },
    users: [
      { id: 'S-QA-001', name: 'Synthetic <Student>', role_type: '學生', status: '在班' },
      { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師', status: '在職' },
    ],
    counseling: [{
      id: 7, created_at: '2026-09-30T16:00:00.000Z', student_id: 'S-QA-001', student_name: '<img src=x>',
      teacher_name: 'Synthetic Teacher', duration_min: 35, content: '<script>unsafe()</script>', category: '課業輔導',
      follow_up: '下週追蹤', selected_tags: '專注度良好、完成度高',
    }],
  });
  vm.runInContext("currentUser = { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師' }", context);
  await vm.runInContext('loadCounseling()', context);

  const list = elements.get('counseling-list').innerHTML;
  assert.equal((list.match(/<td\b/gu) || []).length, 8);
  assert.match(list, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/u);
  assert.doesNotMatch(list, /<script>unsafe/u);
  assert.match(list, /下週追蹤/u);
  assert.match(elements.get('cs-stat-count').textContent, /1 次/u);
  assert.match(elements.get('cs-stat-mins').textContent, /35 分鐘/u);
  assert.match(elements.get('cs-stat-students').textContent, /1 位/u);
  assert.match(elements.get('cs-stat-followup').textContent, /1 案/u);

  elements.get('counsel-filter-student').value = 'missing';
  vm.runInContext('filterCounselingList()', context);
  assert.match(elements.get('counseling-list').innerHTML, /沒有符合條件/u);
  assert.match(elements.get('cs-stat-count').textContent, /0 次/u);
  elements.get('counsel-filter-student').value = '';
  elements.get('counsel-filter-category').value = '課業輔導';
  vm.runInContext('filterCounselingList()', context);
  assert.match(elements.get('cs-stat-count').textContent, /1 次/u);
});

test('counseling teachers can create/update, while only M can delete', async () => {
  const { context, writes, elements, counselingRows, alerts } = createHarness({
    user: { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師' },
    users: [
      { id: 'S-QA-001', name: 'Synthetic Student', role_type: '學生', status: '在班' },
      { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師', status: '在職' },
    ],
    counseling: [{ id: 11, created_at: '2026-09-29T16:00:00.000Z', student_id: 'S-QA-001', student_name: 'Synthetic Student', teacher_name: 'Synthetic Teacher', duration_min: 30, content: '原紀錄', category: '課業輔導', follow_up: null, selected_tags: null }],
  });
  vm.runInContext("currentUser = { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師' }", context);
  await vm.runInContext('loadCounseling()', context);

  assert.match(elements.get('counsel-student-select').innerHTML, /Synthetic Student/u);
  assert.equal(elements.get('counsel-teacher-select').value, 'T-QA-001');
  assert.equal(elements.get('counsel-teacher-select').disabled, true);
  vm.runInContext('openAddCounselingModal()', context);
  vm.runInContext('switchCounselTags()', context);
  assert.match(elements.get('counsel-quick-tags').innerHTML, /type="checkbox"/u);
  assert.match(elements.get('counsel-psychology-tags').innerHTML, /願意表達感受/u);
  assert.match(elements.get('counsel-family-tags').innerHTML, /關心家庭近況/u);
  assert.ok(html.indexOf('counsel-psychology-tags') < html.indexOf('counsel-student-select'), 'psychology and family checklists should appear at the top of the form');

  const field = (id, value) => { context.document.getElementById(id).value = value; };
  field('counsel-student-select', 'S-QA-001');
  field('counsel-teacher-select', 'M-QA-OTHER');
  field('counsel-date', '2026-09-30');
  field('counsel-duration', '40');
  field('counsel-content', '新增合成紀錄');
  field('counsel-category', '情緒行為');
  field('counsel-followup', '確認情緒狀況');
  vm.runInContext("toggleCounselTag(0); toggleCounselDimensionTag('心理層面', 0); toggleCounselDimensionTag('家庭層面', 0); toggleCounselFollowupTag(0)", context);
  await vm.runInContext('handleCounselingSubmit({ preventDefault() {} })', context);

  const inserted = writes.find((write) => write.table === 'counseling_logs' && write.method === 'insert');
  assert.ok(inserted);
  assert.equal(inserted.payload.student_id, 'S-QA-001');
  assert.equal(inserted.payload.created_at, '2026-09-30T16:00:00.000Z');
  assert.equal(inserted.payload.duration_min, 40);
  assert.equal(inserted.payload.teacher_name, 'Synthetic Teacher');
  assert.match(inserted.payload.content, /觀察與協助：情緒平穩/u);
  assert.match(inserted.payload.selected_tags, /情緒平穩/u);
  assert.match(inserted.payload.selected_tags, /願意表達感受/u);
  assert.match(inserted.payload.selected_tags, /關心家庭近況/u);
  assert.match(inserted.payload.follow_up, /處理方式：下次課輔持續觀察/u);
  assert.match(inserted.payload.follow_up, /補充：確認情緒狀況/u);
  assert.equal(counselingRows.length, 2);

  await vm.runInContext('editCounseling(11)', context);
  field('counsel-content', '修改合成紀錄');
  await vm.runInContext('handleCounselingSubmit({ preventDefault() {} })', context);
  assert.equal(counselingRows.find((record) => record.id === 11).content, '修改合成紀錄');
  assert.ok(writes.some((write) => write.table === 'counseling_logs' && write.method === 'update'));

  await vm.runInContext('deleteCounseling(11)', context);
  assert.equal(writes.some((write) => write.table === 'counseling_logs' && write.method === 'delete'), false);
  assert.match(alerts.at(-1), /只有同工/u);
  vm.runInContext("currentUser = { id: 'M-QA-001', name: 'Synthetic Manager', role_type: '同工' }", context);
  await vm.runInContext('deleteCounseling(11)', context);
  assert.equal(counselingRows.some((record) => record.id === 11), false);
});

test('counseling student selection includes noncanonical student roles and excludes inactive students', async () => {
  const { context, elements } = createHarness({
    user: { id: 'M-QA-001', name: 'Synthetic Manager', role_type: '同工' },
    users: [
      { id: 'S-QA-001', name: 'Synthetic Student', role_type: '學員', status: '在班' },
      { id: 'S-QA-002', name: 'Former Student', role_type: '學生', status: '畢業' },
      { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師', status: '在職' },
    ],
  });
  vm.runInContext("currentUser = { id: 'M-QA-001', name: 'Synthetic Manager', role_type: '同工' }", context);
  await vm.runInContext('loadCounseling()', context);
  assert.match(elements.get('counsel-student-select').innerHTML, /Synthetic Student/u);
  assert.doesNotMatch(elements.get('counsel-student-select').innerHTML, /Former Student/u);
  assert.doesNotMatch(elements.get('counsel-student-select').innerHTML, /Synthetic Teacher/u);
});

test('counseling form keeps unsaved input on database failure and reports read errors', async () => {
  const { context, elements, alerts, counselingRows } = createHarness({
    users: [
      { id: 'S-QA-001', name: 'Synthetic Student', role_type: '學生', status: '在班' },
      { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師', status: '在職' },
    ],
    failures: { 'counseling_logs.insert': 'mock insert denied', 'counseling_logs.select': 'mock read denied' },
  });
  vm.runInContext("currentUser = { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師' }", context);
  await vm.runInContext('loadCounseling()', context);
  assert.match(alerts.at(-1), /mock read denied/u);

  // Clear the read failure so the add form can load its minimal people list.
  vm.runInContext('rawCounselingList = []; counselingPeople = [{ id: \'S-QA-001\', name: \'Synthetic Student\', role_type: \'學生\', status: \'在班\' }, { id: \'T-QA-001\', name: \'Synthetic Teacher\', role_type: \'老師\', status: \'在職\' }]', context);
  vm.runInContext('openAddCounselingModal()', context);
  for (const [id, value] of [['counsel-student-select', 'S-QA-001'], ['counsel-teacher-select', 'T-QA-001'], ['counsel-date', '2026-09-30'], ['counsel-duration', '30'], ['counsel-content', '保留輸入的合成文字']]) context.document.getElementById(id).value = value;
  await vm.runInContext('handleCounselingSubmit({ preventDefault() {} })', context);
  assert.equal(counselingRows.length, 0);
  assert.equal(elements.get('counsel-content').value, '保留輸入的合成文字');
  assert.match(alerts.at(-1), /mock insert denied/u);
  assert.equal(elements.get('modal-counseling-add').classList.contains('hidden'), false);
});

test('new person forms generate the next Taipei-year role ID and insert without upserting', async () => {
  const { context, writes } = createHarness({ users: [
    { id: '2026S0001', name: 'Old Student', role_type: '學生', status: '退班' },
    { id: '2026S0007', name: 'Current Student', role_type: '學生', status: '在班' },
    { id: '2025S9999', name: 'Prior Year Student', role_type: '學生', status: '畢業' },
    { id: 'M-QA-001', name: 'Synthetic Staff', role_type: '同工', status: '在職' },
  ] });
  await vm.runInContext('loadUsers()', context);
  const field = (id) => context.document.getElementById(id);
  field('form-role').value = '學生';
  vm.runInContext("openUserModal('add')", context);
  const currentYear = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Taipei', year: 'numeric' }).format(new Date());
  assert.equal(field('form-id').value, `${currentYear}S0008`);
  assert.match(field('form-id-label').textContent, /自動編號/u);

  field('form-role').value = '老師';
  vm.runInContext('handleUserRoleChange()', context);
  assert.equal(field('form-id').value, `${currentYear}T0001`);
  assert.equal(field('form-id-label').textContent, '人員編號（自動編號）*');
  field('form-role').value = '學生';
  vm.runInContext('handleUserRoleChange()', context);
  field('form-name').value = 'Synthetic New Student';
  await vm.runInContext('handleUserSubmit({ preventDefault() {} })', context);

  const insert = writes.find((write) => write.table === 'users' && write.method === 'insert');
  assert.ok(insert);
  assert.equal(insert.payload[0].id, `${currentYear}S0008`);
  assert.equal(insert.payload[0].role_type, '學生');
  assert.equal(writes.some((write) => write.table === 'users' && write.method === 'upsert'), false);
});

test('staff role IDs use independent M, T, and P sequences', async () => {
  const { context } = createHarness({ users: [
    { id: '2026M0004', name: 'Existing Coworker', role_type: '同工', status: '在職' },
    { id: '2026T0002', name: 'Existing Teacher', role_type: '老師', status: '在職' },
    { id: '2026P0011', name: 'Existing Part-time', role_type: '工讀生', status: '在職' },
  ] });
  await vm.runInContext('loadUsers()', context);
  const field = (id) => context.document.getElementById(id);
  vm.runInContext("openUserModal('add')", context);
  const currentYear = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Taipei', year: 'numeric' }).format(new Date());

  for (const [role, prefix, nextNumber] of [['同工', 'M', 5], ['老師', 'T', 3], ['工讀生', 'P', 12]]) {
    field('form-role').value = role;
    vm.runInContext('handleUserRoleChange()', context);
    assert.equal(field('form-id').value, `${currentYear}${prefix}${String(nextNumber).padStart(4, '0')}`);
    assert.equal(field('form-id-label').textContent, '人員編號（自動編號）*');
  }
});

test('schedule single-day create, edit, delete, and role permissions use the existing table', async () => {
  const { context, writes, scheduleRows, elements, alerts } = createHarness({
    users: [
      { id: 'M-QA-001', name: 'Synthetic Coworker', role_type: '同工', status: '在職' },
      { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師', status: '在職' },
      { id: 'P-QA-001', name: 'Synthetic Part-time', role_type: '工讀生', status: '在職' },
    ],
    schedules: [{ id: 41, date: '2026-09-30', worker_id: 'T-QA-001', worker_name: 'Synthetic Teacher', shift: '16:00 - 18:00', hours: 2, job_desc: '課輔陪伴', hourly_wage: 190 }],
  });
  vm.runInContext("currentUser = { id: 'M-QA-001', name: 'Synthetic Coworker', role_type: '同工' }", context);
  await vm.runInContext('loadSchedules()', context);
  await vm.runInContext("openScheduleModal('add')", context);
  const field = (id) => context.document.getElementById(id);
  for (const [id, value] of [['sch-date', '2026-10-01'], ['sch-worker-select', 'T-QA-001'], ['sch-start-time', '16:00'], ['sch-end-time', '18:00'], ['sch-job', '合成測試排班']]) field(id).value = value;
  vm.runInContext('autoCalcHours()', context);
  await vm.runInContext('handleScheduleSubmit({ preventDefault() {} })', context);
  assert.equal(writes.find(write => write.table === 'schedules' && write.method === 'insert').payload[0].worker_id, 'T-QA-001');
  assert.equal(scheduleRows.length, 2);

  await vm.runInContext("openScheduleModal('edit', 41)", context);
  field('sch-job').value = '修改後的工作';
  await vm.runInContext('handleScheduleSubmit({ preventDefault() {} })', context);
  assert.equal(scheduleRows.find(row => row.id === 41).job_desc, '修改後的工作');
  assert.ok(writes.some(write => write.table === 'schedules' && write.method === 'update'));

  await vm.runInContext('deleteSchedule(41)', context);
  assert.equal(scheduleRows.some(row => row.id === 41), false);
  assert.ok(writes.some(write => write.table === 'schedules' && write.method === 'delete'));

  vm.runInContext("currentUser = { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師' }; currentCalMonth = 10; activeScheduleView = 'list'; renderActiveScheduleView()", context);
  assert.match(field('schedules-list').innerHTML, /編輯/u);
  assert.doesNotMatch(field('schedules-list').innerHTML, /刪除/u);
  await vm.runInContext('deleteSchedule(42)', context);
  assert.equal(writes.filter(write => write.table === 'schedules' && write.method === 'delete').length, 1);

  vm.runInContext("currentUser = { id: 'P-QA-001', name: 'Synthetic Part-time', role_type: '工讀生' }; updateScheduleActionUI()", context);
  assert.equal(field('btn-add-schedule').classList.contains('hidden'), true);
  await vm.runInContext("openScheduleModal('add')", context);
  assert.match(alerts.at(-1), /查看排班的權限/u);
});

test('schedule wage totals and monthly payroll report use each shift hourly wage', async () => {
  const schedules = [
    { id: 51, date: '2026-09-10', worker_id: 'T-QA-001', worker_name: 'Synthetic Teacher', shift: '16:00 - 18:00', hours: 2, hourly_wage: 190, job_desc: '課輔' },
    { id: 52, date: '2026-09-17', worker_id: 'T-QA-001', worker_name: 'Synthetic Teacher', shift: '16:00 - 17:00', hours: 1, hourly_wage: 250, job_desc: '代班' },
  ];
  const { context, elements } = createHarness({ schedules });
  vm.runInContext("rawSchedules = JSON.parse(testSchedules); currentCalYear = 2026; currentCalMonth = 9; activeScheduleView = 'calendar'; allUsers = [];", Object.assign(context, { testSchedules: JSON.stringify(schedules) }));
  vm.runInContext('renderActiveScheduleView()', context);
  assert.equal(elements.get('total-wage-badge').textContent, '$630');

  context.document.getElementById('print-report-type').value = 'workhours';
  context.document.getElementById('print-month-filter').value = '2026-09';
  await vm.runInContext('renderSelectedReport()', context);
  const report = context.document.getElementById('print-paper-content').innerHTML;
  assert.match(report, /\$210 \/h 平均/u);
  assert.match(report, /\$630/u);
  assert.match(report, /\$250\/h/u);
  assert.match(report, /\$250/u);
});

test('saving the same roll call day twice updates its rows without duplicates', async () => {
  const { context, writes, rollCallRows, elements } = createHarness({ users: [
    { id: '2026S0001', name: 'Synthetic Student', role_type: '學生', status: '在班', school: 'Test School', grade: '4' },
  ] });
  vm.runInContext("currentUser = { id: 'T-QA-001', role_type: '老師' }", context);
  context.document.getElementById('rollcall-date-picker').value = '2026-09-30';
  await vm.runInContext('loadRollCallsForDate()', context);
  vm.runInContext("activeRollCallList[0].attendance = '請假'", context);
  await vm.runInContext('saveRollCallSheet()', context);
  assert.equal(rollCallRows.length, 1);
  const firstId = rollCallRows[0].id;
  assert.equal(rollCallRows[0].attendance_status, '請假');
  vm.runInContext("activeRollCallList[0].attendance = '出席'", context);
  await vm.runInContext('saveRollCallSheet()', context);
  assert.equal(rollCallRows.length, 1);
  assert.equal(rollCallRows[0].id, firstId);
  assert.equal(rollCallRows[0].attendance_status, '出席');
  assert.equal(writes.filter(write => write.table === 'roll_calls' && write.method === 'upsert').length, 2);
  assert.equal(writes[0].options.onConflict, 'id');
});

test('failed roll call writes report failure without claiming success', async () => {
  const { context, elements, alerts } = createHarness({
    users: [{ id: '2026S0001', name: 'Synthetic Student', role_type: '學生', status: '在班' }],
    failures: { 'roll_calls.upsert': 'synthetic write denied' },
  });
  vm.runInContext("currentUser = { id: 'T-QA-001', role_type: '老師' }", context);
  context.document.getElementById('rollcall-date-picker').value = '2026-09-30';
  await vm.runInContext('loadRollCallsForDate()', context);
  await vm.runInContext('saveRollCallSheet()', context);
  assert.match(alerts.at(-1), /儲存點名失敗.*synthetic write denied/u);
  assert.doesNotMatch(alerts.at(-1), /儲存成功/u);
});

test('part-time staff can view roll call but cannot edit or save it', async () => {
  const { context, writes, elements, alerts } = createHarness({ users: [
    { id: '2026S0001', name: 'Synthetic Student', role_type: '學生', status: '在班' },
  ] });
  vm.runInContext("currentUser = { id: 'P-QA-001', role_type: '工讀生' }", context);
  context.document.getElementById('rollcall-date-picker').value = '2026-09-30';
  vm.runInContext('updateRollCallActionUI()', context);
  await vm.runInContext('loadRollCallsForDate()', context);
  assert.match(elements.get('rollcall-table-body').innerHTML, /<select disabled/u);
  assert.equal(elements.get('rollcall-save').classList.contains('hidden'), true);
  await vm.runInContext('saveRollCallSheet()', context);
  assert.equal(writes.some(write => write.table === 'roll_calls' && write.method === 'upsert'), false);
  assert.match(alerts.at(-1), /查看點名紀錄的權限/u);
});

test('student first scan adds one point and writes both attendance ledgers through the mock', async () => {
  const { context, writes } = createHarness({ user: { id: 'S-QA-001', name: 'Synthetic Student', role_type: '學生', points: 4 } });

  await vm.runInContext("processScanCode('S-QA-001')", context);

  assert.deepEqual(writes.map(({ table, method }) => `${table}.${method}`), [
    'users.update',
    'points_logs.insert',
    'check_in_logs.insert',
  ]);
  assert.equal(writes[0].payload.points, 5);
  assert.equal(writes[1].payload[0].points_delta, 1);
  assert.equal(writes[2].payload[0].action_text, '+1 點 (到班)');
});

test('duplicate student scan makes no writes through the mock', async () => {
  const { context, writes } = createHarness({
    user: { id: 'S-QA-001', name: 'Synthetic Student', role_type: '學生', points: 4 },
    logs: [{ check_time: new Date().toISOString() }],
  });

  await vm.runInContext("processScanCode('S-QA-001')", context);

  assert.deepEqual(writes, []);
});

test('staff first scan writes an attendance log without student points', async () => {
  const { context, writes } = createHarness({ user: { id: 'M-QA-001', name: 'Synthetic Staff', role_type: '同工', points: 0 } });

  await vm.runInContext("processScanCode('M-QA-001')", context);

  assert.deepEqual(writes.map(({ table, method }) => `${table}.${method}`), ['check_in_logs.insert']);
  assert.equal(writes[0].payload[0].action_text, '上班簽到');
});

test('unknown code makes no writes through the mock', async () => {
  const { context, writes } = createHarness({ user: null });

  await vm.runInContext("processScanCode('UNKNOWN-QA')", context);

  assert.deepEqual(writes, []);
});

test('staff rescan inside the one-minute cooldown makes no writes', async () => {
  const { context, writes } = createHarness({
    user: { id: 'M-QA-001', name: 'Synthetic Staff', role_type: '同工', points: 0 },
    logs: [{ check_time: new Date().toISOString() }],
  });

  await vm.runInContext("processScanCode('M-QA-001')", context);

  assert.deepEqual(writes, []);
});

test('staff rescan after cooldown writes checkout attendance', async () => {
  const previousCheckIn = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { context, writes } = createHarness({
    user: { id: 'M-QA-001', name: 'Synthetic Staff', role_type: '同工', points: 0 },
    logs: [{ check_time: previousCheckIn, target_id: 'M-QA-001', target_name: 'Synthetic Staff', role: '同工', action_text: '上班簽到' }],
  });

  await vm.runInContext("processScanCode('M-QA-001')", context);

  assert.deepEqual(writes.map(({ table, method }) => `${table}.${method}`), ['check_in_logs.insert']);
  assert.equal(writes[0].payload[0].action_text, '下班簽退');
});

test('login accepts an arbitrary password value and stores the complete user row', async () => {
  const user = {
    id: 'M-QA-001',
    name: 'Synthetic Staff',
    role_type: '同工',
    phone: '00000000',
    health_notes: 'synthetic note',
  };
  const { context, storage, elements } = createHarness({ user });
  const switchedTabs = [];
  context.testSwitchedTabs = switchedTabs;
  vm.runInContext('switchTab = (tab) => testSwitchedTabs.push(tab)', context);
  context.document.getElementById('login-uid').value = 'M-QA-001';
  context.document.getElementById('login-pwd').value = 'definitely-not-the-phone-number';

  await vm.runInContext('handleLoginSubmit({ preventDefault() {} })', context);

  assert.deepEqual(JSON.parse(storage.get('mplus_current_user')), user);
  assert.deepEqual(switchedTabs, ['schedules']);
  assert.equal(elements.get('nav-print').classList.contains('hidden'), false);
  assert.equal(elements.get('nav-import').classList.contains('hidden'), false);
});

test('P staff can open counseling and message tabs for read-only use', () => {
  const { context, elements } = createHarness({
    counseling: [{ id: 5, created_at: '2026-09-30T16:00:00.000Z', student_id: 'S-QA-001', student_name: 'Synthetic Student', teacher_name: 'Synthetic Teacher', duration_min: 30, content: '合成摘要', category: '課業輔導' }],
  });
  const switchedTabs = [];
  context.testSwitchedTabs = switchedTabs;
  vm.runInContext("currentUser = { id: 'P-QA-001', name: 'Synthetic Part-time Staff', role_type: '工讀生' }; switchTab = (tab) => testSwitchedTabs.push(tab)", context);

  vm.runInContext("requireTab('counseling'); requireTab('messages')", context);

  assert.deepEqual(switchedTabs, ['counseling', 'messages']);
  return vm.runInContext('loadCounseling()', context).then(() => {
    assert.equal(elements.get('counsel-add-button').classList.contains('hidden'), true);
    assert.doesNotMatch(elements.get('counseling-list').innerHTML, /data-counsel-action/u);
    const modal = context.document.getElementById('modal-counseling-add');
    modal.classList.add('hidden');
    vm.runInContext('openAddCounselingModal()', context);
    assert.equal(modal.classList.contains('hidden'), true);
  });
});

test('non-M user is denied report and import tabs by the current UI gate', () => {
  const { context, alerts } = createHarness();
  const switchedTabs = [];
  context.testSwitchedTabs = switchedTabs;
  vm.runInContext("currentUser = { id: 'T-QA-001', name: 'Synthetic Teacher', role_type: '老師' }; switchTab = (tab) => testSwitchedTabs.push(tab)", context);

  vm.runInContext('requireStaffPrintTab(); requireImportTab()', context);

  assert.deepEqual(switchedTabs, []);
  assert.equal(alerts.length, 2);
});

test('logout clears the locally stored profile', () => {
  const { context, storage } = createHarness();
  const switchedTabs = [];
  context.testSwitchedTabs = switchedTabs;
  vm.runInContext('switchTab = (tab) => testSwitchedTabs.push(tab)', context);
  storage.set('mplus_current_user', JSON.stringify({ id: 'M-QA-001', name: 'Synthetic Staff' }));

  vm.runInContext('doLogout()', context);

  assert.equal(storage.has('mplus_current_user'), false);
  assert.deepEqual(switchedTabs, ['checkin']);
});

test('offline harness blocks fetch and XMLHttpRequest before any request can leave', async () => {
  const { context, blockedRequests } = createHarness();

  await assert.rejects(
    vm.runInContext("fetch('https://othgvewffvkkafbezejy.supabase.co/rest/v1/users')", context),
    /Blocked outbound request in offline test harness/,
  );
  assert.throws(() => vm.runInContext('new XMLHttpRequest()', context), /Blocked XMLHttpRequest in offline test harness/);
  assert.deepEqual(blockedRequests, ['https://othgvewffvkkafbezejy.supabase.co/rest/v1/users']);
});

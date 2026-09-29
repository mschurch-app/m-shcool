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

function createHarness({ user = null, users = user ? [user] : [], logs = [], counseling = [], failures = {} } = {}) {
  const writes = [];
  const elements = new Map();
  const storage = new Map();
  const alerts = [];
  const blockedRequests = [];
  const listeners = new Map();
  const counselingRows = counseling.map((record) => ({ ...record }));
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
          toggle(name) { if (classes.has(name)) classes.delete(name); else classes.add(name); },
          contains(name) { return classes.has(name); },
        },
        focus() {},
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
      if (!error && this.table === 'counseling_logs') counselingRows.push({ ...payload, id: Math.max(0, ...counselingRows.map((record) => Number(record.id) || 0)) + 1 });
      return Promise.resolve({ data: null, error: error ? { message: error } : null });
    }
    update(payload) { this.action = { method: 'update', payload }; writes.push({ table: this.table, method: 'update', payload }); return this; }
    upsert(payload) { writes.push({ table: this.table, method: 'upsert', payload }); return Promise.resolve({ data: null, error: null }); }
    delete() { this.action = { method: 'delete' }; writes.push({ table: this.table, method: 'delete' }); return this; }
    then(resolve, reject) {
      const error = failures[`${this.table}.${this.action?.method || 'select'}`];
      if (!error && this.table === 'counseling_logs' && this.action) {
        const [column, value] = this.filters.at(-1) || [];
        if (this.action.method === 'update') {
          counselingRows.forEach((record) => { if (String(record[column]) === String(value)) Object.assign(record, this.action.payload); });
        } else if (this.action.method === 'delete') {
          for (let i = counselingRows.length - 1; i >= 0; i--) if (String(counselingRows[i][column]) === String(value)) counselingRows.splice(i, 1);
        }
      }
      const data = this.table === 'check_in_logs' ? logs : (this.table === 'users' ? users : (this.table === 'counseling_logs' ? counselingRows : []));
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
  return { context, writes, elements, storage, alerts, listeners, blockedRequests, counselingRows };
}

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

  const field = (id, value) => { context.document.getElementById(id).value = value; };
  field('counsel-student-select', 'S-QA-001');
  field('counsel-teacher-select', 'T-QA-001');
  field('counsel-date', '2026-09-30');
  field('counsel-duration', '40');
  field('counsel-content', '新增合成紀錄');
  field('counsel-category', '情緒行為');
  field('counsel-followup', '確認情緒狀況');
  await vm.runInContext('handleCounselingSubmit({ preventDefault() {} })', context);

  const inserted = writes.find((write) => write.table === 'counseling_logs' && write.method === 'insert');
  assert.ok(inserted);
  assert.equal(inserted.payload.student_id, 'S-QA-001');
  assert.equal(inserted.payload.created_at, '2026-09-30T16:00:00.000Z');
  assert.equal(inserted.payload.duration_min, 40);
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

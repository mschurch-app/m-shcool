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

function createHarness({ user = null, users = user ? [user] : [], logs = [] } = {}) {
  const writes = [];
  const elements = new Map();
  const storage = new Map();
  const alerts = [];
  const listeners = new Map();
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
      });
    }
    return elements.get(id);
  };

  class Query {
    constructor(table) { this.table = table; }
    select() { return this; }
    eq() { return this; }
    gte() { return this; }
    lte() { return this; }
    order() { return this; }
    limit() { return this; }
    or() { return this; }
    maybeSingle() { return Promise.resolve({ data: user ?? null, error: null }); }
    insert(payload) { writes.push({ table: this.table, method: 'insert', payload }); return Promise.resolve({ data: null, error: null }); }
    update(payload) { writes.push({ table: this.table, method: 'update', payload }); return this; }
    upsert(payload) { writes.push({ table: this.table, method: 'upsert', payload }); return Promise.resolve({ data: null, error: null }); }
    delete() { writes.push({ table: this.table, method: 'delete' }); return this; }
    then(resolve, reject) {
      const data = this.table === 'check_in_logs' ? logs : (this.table === 'users' ? users : []);
      return Promise.resolve({ data, error: null }).then(resolve, reject);
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
    setInterval: () => 0,
    clearInterval() {},
    setTimeout: () => 0,
    clearTimeout() {},
    alert(message) { alerts.push(message); },
    confirm: () => true,
    prompt: () => null,
  });
  new vm.Script(appScript, { filename: 'index.html:inline-app' }).runInContext(context);
  return { context, writes, elements, storage, alerts, listeners };
}

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

test('any current user can open general administrative tabs', () => {
  const { context } = createHarness();
  const switchedTabs = [];
  context.testSwitchedTabs = switchedTabs;
  vm.runInContext("currentUser = { id: 'S-QA-001', name: 'Synthetic Student', role_type: '學生' }; switchTab = (tab) => testSwitchedTabs.push(tab)", context);

  vm.runInContext("requireTab('counseling'); requireTab('messages')", context);

  assert.deepEqual(switchedTabs, ['counseling', 'messages']);
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

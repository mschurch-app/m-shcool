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

function createHarness({ user, logs = [] }) {
  const writes = [];
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        className: '',
        innerHTML: '',
        textContent: '',
        value: '',
        classList: { add() {}, remove() {}, toggle() {} },
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
      const data = this.table === 'check_in_logs' ? logs : [];
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
      addEventListener() {},
    },
    window: {},
    setInterval: () => 0,
    clearInterval() {},
    setTimeout: () => 0,
    clearTimeout() {},
    alert() {},
    confirm: () => true,
    prompt: () => null,
  });
  new vm.Script(appScript, { filename: 'index.html:inline-app' }).runInContext(context);
  return { context, writes, elements };
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

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import test from 'node:test';

const html = await readFile(new URL('../'+(process.env.MSCHOOL_FRONTEND_FILE||'index.html'), import.meta.url), 'utf8');
const appMarker = html.indexOf('const SUPABASE_URL');
const appScriptStart = html.lastIndexOf('<script', appMarker);
const appScriptEnd = html.indexOf('</script>', appMarker);
assert.ok(appMarker >= 0 && appScriptStart >= 0 && appScriptEnd > appMarker, 'could not locate inline application script');
const appScript = html.slice(html.indexOf('>', appScriptStart) + 1, appScriptEnd);

function createHarness({ user = null, users = user ? [user] : [], logs = [], counseling = [], schedules = [], rollCalls = [], parentMessages = [], actualAttendance = {summary: [], days: []}, failures = {} } = {}) {
  const writes = [];
  const elements = new Map();
  const storage = new Map();
  const alerts = [];
  const blockedRequests = [];
  const listeners = new Map();
  const queries = [];
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
    constructor(table) { this.table = table; this.filters = []; this.action = null; queries.push(this); }
    select() { return this; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    gte(column, value) { this.filters.push({ operator: 'gte', column, value }); return this; }
    lte(column, value) { this.filters.push({ operator: 'lte', column, value }); return this; }
    lt(column, value) { this.filters.push({ operator: 'lt', column, value }); return this; }
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
    crypto: webcrypto,
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
    fetch(input, options = {}) {
      blockedRequests.push(String(input));
      const url = String(input);
      const response = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
      if (url.includes('/attendance/workhours?')) return failures.workhours ? response(503, {error:'Synthetic workhours unavailable'}) : response(200, actualAttendance);
      const path=new URL(url).pathname, request=JSON.parse(String(options.body||'{}'));
      if(url.includes('/rollcalls?')) {
        queries.push({table:'roll_calls',filters:[]});
        if(failures['roll_calls.select'])return response(503,{error:failures['roll_calls.select']});
        return response(200,{records:rollCallRows,revision:'0'});
      }
      if(path.endsWith('/rollcalls')) {
        if(failures['roll_calls.upsert'])return response(400,{error:failures['roll_calls.upsert']});
        writes.push({table:'roll_calls',method:'atomic-save',payload:request.rows,revision:request.revision,request_id:request.request_id});
        for(const row of request.rows){const existing=rollCallRows.find(r=>r.student_id===row.student_id&&String(r.class_date||r.created_at).slice(0,10)===request.day);
          if(existing)Object.assign(existing,row,{class_date:request.day});else rollCallRows.push({...row,id:Math.max(0,...rollCallRows.map(r=>Number(r.id)))+1,class_date:request.day,created_at:request.day+'T16:00:00Z'});}
        return response(200,{ok:true,revision:'1'});
      }
      if(path.endsWith('/schedules/preview'))return response(200,{ok:!failures.schedule_conflict,count:request.method==='DELETE'?1:request.rows.length,conflicts:failures.schedule_conflict?[{existing_date:'2026-10-12',shift:'16:00-18:00'}]:[]});
      if(path.endsWith('/schedules/save')) {
        const method={POST:'insert',PATCH:'update',DELETE:'delete'}[request.method];
        if(failures['schedules.'+method])return response(400,{error:failures['schedules.'+method]});
        writes.push({table:'schedules',method,payload:method==='update'?request.rows[0]:request.rows});
        if(method==='insert')for(const row of request.rows)scheduleRows.push({...row,id:Math.max(0,...scheduleRows.map(r=>Number(r.id)))+1});
        else if(method==='update')Object.assign(scheduleRows.find(r=>String(r.id)===String(request.id)),request.rows[0]);
        else {const i=scheduleRows.findIndex(r=>String(r.id)===String(request.id));if(i>=0)scheduleRows.splice(i,1);}
        return response(200,{ok:true});
      }
      if(path.endsWith('/points/adjust')) {
        if(failures['users.update'])return response(400,{error:failures['users.update']});
        const target=users.find(r=>r.id===request.id);target.points=(target.points||0)+request.delta;
        writes.push({table:'points',method:'adjust',payload:request});return response(200,{balance:target.points});
      }
      if(path.endsWith('/imports')) {
        const results=[];
        for(const row of request.rows){const method=row.kind==='insert'?'insert':'update',error=failures['users.'+method];
          if(error){results.push({row:row.row,id:row.id,ok:false,error});continue;}
          writes.push({table:'users',method,payload:method==='insert'?[row.payload]:row.payload});
          if(method==='insert')users.push({...row.payload});else Object.assign(users.find(r=>r.id===row.id),row.payload);
          results.push({row:row.row,id:row.id,ok:true});}
        return response(200,{results,success:results.filter(r=>r.ok).length});
      }
      if (url.endsWith('/kiosk/check-in')) {
        const request = JSON.parse(String(options.body || '{}'));
        const target = users.find((entry) => String(entry.id) === String(request.id));
        if (!target) return response(200, { ok: false, code: 'not_found' });
        const todayLogs = logs.filter((entry) => String(entry.target_id) === String(target.id));
        const isStaff = target.role_type && target.role_type !== '學生';
        if (!isStaff && todayLogs.length) return response(200, { ok: false, code: 'already', name: target.name });
        if (isStaff && todayLogs.length && Date.now() - new Date(todayLogs.at(-1).check_time).getTime() < 60000) return response(200, { ok: false, code: 'too_soon', name: target.name });
        if (!isStaff) {
          writes.push({ table: 'users', method: 'update', payload: { points: (target.points || 0) + 1 } });
          writes.push({ table: 'points_logs', method: 'insert', payload: [{ target_id: target.id, points_delta: 1 }] });
          writes.push({ table: 'check_in_logs', method: 'insert', payload: [{ target_id: target.id, action_text: '+1 點 (到班)' }] });
          return response(200, { ok: true, kind: 'student', title: `🎉 ${target.name} 簽到成功！`, subtitle: '點數 +1！' });
        }
        const actionText = todayLogs.length ? '下班簽退' : '上班簽到';
        writes.push({ table: 'check_in_logs', method: 'insert', payload: [{ target_id: target.id, action_text: actionText }] });
        return response(200, { ok: true, kind: 'staff', title: `💼 ${target.name} ${actionText}成功！`, subtitle: '出勤已登記' });
      }
      if (url.endsWith('/logout')) { if (failures.logout) return Promise.reject(new Error('Synthetic network failure')); return response(200, { ok: true }); }
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
    prompt: () => 'Synthetic reason',
  });
  context.window.fetch = context.fetch;
  context.Request = class Request {};
  context.Headers = class Headers {
    constructor() { this.values = new Map(); }
    set(key, value) { this.values.set(String(key).toLowerCase(), String(value)); }
    get(key) { return this.values.get(String(key).toLowerCase()) ?? null; }
    forEach(callback) { this.values.forEach((value, key) => callback(value, key)); }
  };
  context.URL = URL;
  new vm.Script(appScript, { filename: 'index.html:inline-app' }).runInContext(context);
  return { context, writes, elements, storage, alerts, listeners, blockedRequests, counselingRows, scheduleRows, rollCallRows, parentMessageRows, queries };
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
  assert.ok(html.indexOf('counsel-quick-tags') < html.indexOf('counsel-psychology-tags'), 'psychology checklist should follow the main counseling fields');
  assert.ok(html.indexOf('counsel-psychology-tags') < html.indexOf('counsel-family-tags'), 'psychology checklist should appear before family checklist');
  assert.ok(html.indexOf('counsel-family-tags') < html.indexOf('counsel-followup-tags'), 'dimension checklists should appear before follow-up options');

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
  const syntheticDescriptor = Array(128).fill(0);
  field('form-face-descriptor').value = JSON.stringify(syntheticDescriptor);
  await vm.runInContext('handleUserSubmit({ preventDefault() {} })', context);

  const insert = writes.find((write) => write.table === 'users' && write.method === 'insert');
  assert.ok(insert);
  assert.equal(insert.payload[0].id, `${currentYear}S0008`);
  assert.equal(insert.payload[0].role_type, '學生');
  assert.equal(JSON.stringify(insert.payload[0].face_descriptor), JSON.stringify(syntheticDescriptor));
  assert.equal(writes.some((write) => write.table === 'users' && write.method === 'atomic-save'), false);
});

test('invalid face descriptor is rejected without writing a person record', async () => {
  const { context, writes, alerts } = createHarness();
  await vm.runInContext('loadUsers()', context);
  vm.runInContext("openUserModal('add')", context);
  context.document.getElementById('form-name').value = 'Synthetic New Student';
  context.document.getElementById('form-face-descriptor').value = JSON.stringify([0, 1]);

  await vm.runInContext('handleUserSubmit({ preventDefault() {} })', context);

  assert.equal(writes.some(write => write.table === 'users' && write.method === 'insert'), false);
  assert.ok(alerts.some(message => message.includes('人臉特徵資料不完整')));
});

test('editing another field preserves an existing face descriptor', async () => {
  const descriptor = Array(128).fill(0.25);
  const { context, writes } = createHarness({ users: [
    { id: 'S-QA-001', name: 'Synthetic Student', role_type: '學生', status: '在班', avatar_url: 'mschool-avatar://avatars/test.jpg', face_descriptor: descriptor },
  ] });
  await vm.runInContext('loadUsers()', context);
  await vm.runInContext("openUserModal('edit', 'S-QA-001')", context);
  context.document.getElementById('form-name').value = 'Synthetic Student Updated';

  await vm.runInContext('handleUserSubmit({ preventDefault() {} })', context);

  const update = writes.find(write => write.table === 'users' && write.method === 'update');
  assert.ok(update);
  assert.equal(Object.hasOwn(update.payload, 'face_descriptor'), false);
});

test('changing a photo without a successful new match clears the old descriptor', async () => {
  const descriptor = Array(128).fill(0.25);
  const { context, writes } = createHarness({ users: [
    { id: 'S-QA-001', name: 'Synthetic Student', role_type: '學生', status: '在班', avatar_url: 'mschool-avatar://avatars/old.jpg', face_descriptor: descriptor },
  ] });
  await vm.runInContext('loadUsers()', context);
  await vm.runInContext("openUserModal('edit', 'S-QA-001')", context);
  context.document.getElementById('form-avatar').value = 'mschool-avatar://avatars/new.jpg';

  await vm.runInContext('handleUserSubmit({ preventDefault() {} })', context);

  const update = writes.find(write => write.table === 'users' && write.method === 'update');
  assert.ok(update);
  assert.equal(update.payload.face_descriptor, null);
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

test('roster load failures stay visible and provide a retry action', async () => {
  const { context, elements } = createHarness({ failures: { 'users.select': 'mock roster unavailable' } });

  await vm.runInContext('loadUsers()', context);

  assert.match(elements.get('students-cards-mobile').innerHTML, /mock roster unavailable/u);
  assert.match(elements.get('students-cards-mobile').innerHTML, /loadUsers\(\)/u);
  assert.match(elements.get('students-table').innerHTML, /mock roster unavailable/u);
});

test('roster delete and point update failures are reported without claiming success', async () => {
  const person = { id: 'S-QA-001', name: 'Synthetic Student', role_type: '學生', status: '在班', points: 2 };
  const deleteHarness = createHarness({ users: [{ ...person }], failures: { 'users.delete': 'mock delete denied' } });
  await vm.runInContext("allUsers = [{ id: 'S-QA-001', name: 'Synthetic Student', points: 2 }]", deleteHarness.context);
  await vm.runInContext("deleteUser('S-QA-001')", deleteHarness.context);
  assert.match(deleteHarness.alerts.at(-1), /mock delete denied/u);

  const updateHarness = createHarness({ users: [{ ...person }], failures: { 'users.update': 'mock point update denied' } });
  await vm.runInContext("allUsers = [{ id: 'S-QA-001', name: 'Synthetic Student', points: 2 }]", updateHarness.context);
  vm.runInContext("currentUser={id:'M-QA',role_type:'同工'}",updateHarness.context);
  await vm.runInContext("changePoints('S-QA-001', 1)", updateHarness.context);
  assert.match(updateHarness.alerts.at(-1), /mock point update denied/u);
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

test('monthly attendance report uses Taipei month boundaries and local attendance dates', async () => {
  const { context, queries } = createHarness({
    users: [{ id: '2026S0010', name: 'Synthetic Student', role_type: '學生', status: '在班', school: 'Test School', grade: '4' }],
    logs: [
      { target_id: '2026S0010', check_time: '2026-08-31T16:05:00.000Z' },
      { target_id: '2026S0010', check_time: '2026-09-30T15:59:00.000Z' },
    ],
  });
  context.document.getElementById('print-report-type').value = 'month_rollcall';
  context.document.getElementById('print-month-filter').value = '2026-09';
  context.document.getElementById('print-class-filter').value = 'elementary';

  await vm.runInContext('renderSelectedReport()', context);

  const logQuery = queries.find(query => query.table === 'check_in_logs');
  assert.ok(logQuery.filters.some(filter => filter.operator === 'gte' && filter.column === 'check_time' && filter.value === '2026-08-31T16:00:00.000Z'));
  assert.ok(logQuery.filters.some(filter => filter.operator === 'lt' && filter.column === 'check_time' && filter.value === '2026-09-30T16:00:00.000Z'));
  const report = context.document.getElementById('print-paper-content').innerHTML;
  assert.equal((report.match(/>出</gu) || []).length, 2, 'Taipei Sep 1 and Sep 30 check-ins should be counted as class days');
  assert.match(report, /應上課日：2 天/u);
  assert.match(report, /整體出席率：100%/u);
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

test('monthly payroll report queries the actual last day of each month', async () => {
  const { context, queries } = createHarness();
  context.document.getElementById('print-report-type').value = 'workhours';

  for (const [month, lastDate] of [['2026-02', '2026-02-28'], ['2028-02', '2028-02-29'], ['2026-09', '2026-09-30']]) {
    context.document.getElementById('print-month-filter').value = month;
    await vm.runInContext('renderSelectedReport()', context);
    const scheduleQuery = queries.filter(query => query.table === 'schedules').at(-1);
    assert.ok(scheduleQuery, `expected a schedules query for ${month}`);
    assert.ok(scheduleQuery.filters.some(filter => filter.operator === 'lte' && filter.column === 'date' && filter.value === lastDate), `expected ${month} report to end on ${lastDate}`);
  }
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
  assert.equal(writes.filter(write => write.table === 'roll_calls' && write.method === 'atomic-save').length, 2);
  assert.equal(writes[0].revision, '0'); assert.match(writes[0].request_id, /^[0-9a-f-]{36}$/);
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
  assert.equal(writes.some(write => write.table === 'roll_calls' && write.method === 'atomic-save'), false);
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
    logs: [{ check_time: new Date().toISOString(), target_id: 'S-QA-001' }],
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
    logs: [{ check_time: new Date().toISOString(), target_id: 'M-QA-001' }],
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

test('login directs users to Church OS without collecting a phone password', async () => {
  const {context, storage, elements, blockedRequests} = createHarness();
  await vm.runInContext('handleLoginSubmit({ preventDefault() {} })', context);
  assert.equal(storage.has('mplus_mschool_session'), false);
  assert.equal(elements.get('modal-login').classList.contains('hidden'), false);
  assert.equal(blockedRequests.length, 0);
});
test('logout clears the local session and revokes the server token', async () => {
  const {context,storage,blockedRequests}=createHarness();
  vm.runInContext("mschoolSessionToken='a'.repeat(64); currentUser={id:'M-QA',role_type:'同工'}; switchTab=()=>{}",context);
  await vm.runInContext('doLogout()',context);
  assert.equal(storage.has('mplus_mschool_session'),false);
  assert.equal(storage.has('mplus_pending_logout'),false);
  assert.ok(blockedRequests.some(url=>url.endsWith('/logout')));
});
test('manager UI uses the verified role instead of ID text', () => {
  const {context,elements}=createHarness();
  vm.runInContext("currentUser={id:'T-QA',name:'Synthetic Admin',role_type:'同工'}; updateAuthUI()",context);
  assert.equal(elements.get('nav-import').classList.contains('hidden'),false);
  vm.runInContext("currentUser={id:'M-QA',name:'Synthetic Reader',role_type:'工讀生'}; updateAuthUI()",context);
  assert.equal(elements.get('nav-import').classList.contains('hidden'),true);
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

test('interrupted logout cannot restore a pending token when offline', async () => {
 const {context,storage}=createHarness({failures:{logout:true}});
 storage.set('mplus_pending_logout','a'.repeat(64));storage.set('mplus_mschool_session','a'.repeat(64));
 vm.runInContext("mschoolSessionToken='a'.repeat(64)",context);
 await assert.rejects(vm.runInContext('flushSchoolLogout()',context),/Synthetic network failure/);
 assert.equal(storage.has('mplus_mschool_session'),false);
 assert.equal(vm.runInContext('mschoolSessionToken',context),null);
 assert.equal(storage.get('mplus_pending_logout'),'a'.repeat(64));
});

test('face presence stays claimed while visible, even after a minute, and rearms only after observed absence',()=>{const {context}=createHarness();assert.equal(vm.runInContext("claimFacePunch('P-QA')",context),true);for(const time of [1000,65000,120000]){context.testNow=time;vm.runInContext("updateFacePresence(['P-QA'],testNow)",context);assert.equal(vm.runInContext("claimFacePunch('P-QA')",context),false);}vm.runInContext('updateFacePresence([],121000);updateFacePresence([],124000)',context);assert.equal(vm.runInContext("claimFacePunch('P-QA')",context),false);vm.runInContext('updateFacePresence([],126001)',context);assert.equal(vm.runInContext("claimFacePunch('P-QA')",context),true);});
test('actual workhours render separately from planned payroll and missing hours never display zero',async()=>{const {context,elements}=createHarness({schedules:[{date:'2026-09-10',worker_id:'P-QA',worker_name:'Synthetic',hours:7,hourly_wage:250}],actualAttendance:{summary:[{worker_id:'P-QA',name:'<b>Synthetic</b>',planned_hours:7,actual_hours:3.5,completed_days:1,pending_days:1}],days:[{day:'2026-09-10',name:'Synthetic',clock_in:'2026-09-10T01:00Z',clock_out:'2026-09-10T04:30Z',actual_hours:3.5,status:'已完成'},{day:'2026-09-11',name:'Synthetic',clock_in:'2026-09-11T01:00Z',clock_out:null,actual_hours:null,status:'待補下班卡'}]}});context.document.getElementById('print-report-type').value='workhours';context.document.getElementById('print-month-filter').value='2026-09';await vm.runInContext('renderSelectedReport()',context);const html=elements.get('print-paper-content').innerHTML;assert.match(html,/3\.50 小時/);assert.match(html,/7\.00 小時/);assert.match(html,/待補下班卡/);assert.match(html,/待確認<\/td>/);assert.match(html,/&lt;b&gt;Synthetic&lt;\/b&gt;/);assert.doesNotMatch(html,/<b>Synthetic<\/b>/);assert.match(html,/排班時數與金額參考/);});
test('failed actual-hours query shows a retry action, never a misleading empty report',async()=>{const {context,elements}=createHarness({failures:{workhours:true}});context.document.getElementById('print-report-type').value='workhours';context.document.getElementById('print-month-filter').value='2026-09';await vm.runInContext('renderSelectedReport()',context);assert.match(elements.get('print-paper-content').innerHTML,/載入失敗/);assert.match(elements.get('print-paper-content').innerHTML,/重新載入/);assert.doesNotMatch(elements.get('print-paper-content').innerHTML,/本月無/);});

test('late report queries cannot overwrite the most recently selected month',async()=>{
 const pending=[];const thenable={then(resolve){pending.push(resolve)}};const {context,elements}=createHarness({actualAttendance:thenable});context.document.getElementById('print-report-type').value='workhours';context.document.getElementById('print-month-filter').value='2026-09';const older=vm.runInContext('renderSelectedReport()',context);await new Promise(r=>setImmediate(r));assert.equal(pending.length,1);
 context.document.getElementById('print-month-filter').value='2026-10';const newer=vm.runInContext('renderSelectedReport()',context);await new Promise(r=>setImmediate(r));assert.equal(pending.length,2);
 const report=name=>({days:[],summary:[{worker_id:'P-QA',name,planned_hours:2,actual_hours:1,completed_days:1,pending_days:0}]});pending[1](report('Newest month'));await newer;pending[0](report('Older month'));await older;assert.match(elements.get('print-paper-content').innerHTML,/Newest month/);assert.doesNotMatch(elements.get('print-paper-content').innerHTML,/Older month/);
});

test('roll call mobile exposes every field, preserves incomplete options, escapes text and updates all statistics', async () => {
  const h = createHarness({users:[{id:'S-QA',name:'<img src=x>',role_type:'學生',status:'在班'}],rollCalls:[
    {id:9,student_id:'S-QA',created_at:'2026-10-09T16:00:00Z',course_name:'課後輔導',attendance_status:'請假',homework_status:'未完成',contact_book_signed:'未簽',note:'"><script>bad()</script>'}
  ]});
  vm.runInContext("currentUser={id:'T-QA',role_type:'老師'}",h.context);
  h.context.document.getElementById('rollcall-date-picker').value='2026-10-09';
  await vm.runInContext('loadRollCallsForDate()',h.context);
  for(const id of ['rollcall-cards-mobile','rollcall-table-body']) {
    const markup=h.elements.get(id).innerHTML;
    for(const title of ['出席','作業','聯絡簿','備註'])assert.ok(markup.includes(title));
    assert.match(markup,/value="未完成" selected/);assert.match(markup,/value="未簽" selected/);
    assert.doesNotMatch(markup,/<script>|<img/);assert.match(markup,/&lt;img/);
  }
  assert.equal(h.elements.get('rc-stat-hw').textContent,'0%');assert.equal(h.elements.get('rc-stat-signed').textContent,'0 人');
  vm.runInContext("batchSetAll('homework','已完成');batchSetAll('signed','是');updateRollCallField(0,'attendance','出席')",h.context);
  assert.equal(h.elements.get('rc-stat-hw').textContent,'100%');assert.equal(h.elements.get('rc-stat-signed').textContent,'1 人');assert.equal(h.elements.get('rc-stat-attend').textContent,'1 人');
});
test('legacy duplicate roll call rows select highest exact bigint ID and leave every historical row intact',()=>{
 const h=createHarness();
 const records=[{id:'9007199254740993',student_id:'S',created_at:'2026-10-09T16:00Z',homework_status:'未完成'},{id:'9007199254740992',student_id:'S',created_at:'2026-10-09T16:00Z',homework_status:'已完成'},{id:99,student_id:'S',created_at:'2026-10-09T16:00Z',course_name:'其他課程'}];
 h.context.records=records;
 const latest=vm.runInContext("latestRollCallRecords(records,'課後輔導')",h.context);
 assert.equal(latest.length,1);assert.equal(latest[0].homework_status,'未完成');assert.equal(records.length,3);assert.equal(h.writes.length,0);
});
test('cannot save old roll call entries under a newly selected date; failed save keeps input',async()=>{
 const h=createHarness({users:[{id:'S-QA',name:'Student',status:'在班',role_type:'學生'}],failures:{'roll_calls.upsert':'retry'}});
 vm.runInContext("currentUser={id:'T',role_type:'老師'}",h.context);h.context.document.getElementById('rollcall-date-picker').value='2026-10-09';
 await vm.runInContext('loadRollCallsForDate()',h.context);
 h.elements.get('rollcall-date-picker').value='2026-10-10';await vm.runInContext('saveRollCallSheet()',h.context);assert.equal(h.writes.length,0);
 h.elements.get('rollcall-date-picker').value='2026-10-09';vm.runInContext("updateRollCallField(0,'note','保留備註')",h.context);await vm.runInContext('saveRollCallSheet()',h.context);
 assert.equal(vm.runInContext('activeRollCallList[0].note',h.context),'保留備註');assert.equal(h.elements.get('rollcall-save').disabled,false);assert.equal(h.elements.get('rollcall-date-picker').disabled,false);
});
test('CSV and TSV parser handles quoted commas, tabs, newlines, doubled quotes and BOM',()=>{
 const h=createHarness();h.context.raw='\ufeffid,name,note\r\nS1,"張,同學","第一行\n第二行 ""引號"""\r\n';
 const csv=vm.runInContext('parseDelimitedText(raw)',h.context);assert.deepEqual(JSON.parse(JSON.stringify(csv.rows)),[['S1','張,同學','第一行\n第二行 "引號"']]);
 h.context.raw='id\tname\tnote\nS2\t名字\t"有,逗號及\t分隔"';assert.equal(vm.runInContext('parseDelimitedText(raw).rows[0][2]',h.context),'有,逗號及\t分隔');
 for(const raw of ['id,name\nS1,"broken','id,name\nS1,Name,extra','id,name\nS1,"Name"bad']) {h.context.raw=raw;assert.throws(()=>vm.runInContext('parseDelimitedText(raw)',h.context));}
});
test('CSV change plans preserve unmapped/empty fields and existing points; reject duplicates and invalid values',()=>{
 const h=createHarness();h.context.people=[{id:'S1',name:'舊姓名',phone:'Keep',health_notes:'Keep health',points:50}];h.context.rows=[['S1','新姓名','','0'],['S2','新增','New','3']];h.context.mapping={id:0,name:1,phone:2,points:3};
 const plan=vm.runInContext('buildCsvImportPlan(rows,mapping,people)',h.context);
 assert.deepEqual(JSON.parse(JSON.stringify(plan[0].payload)),{name:'新姓名'});assert.equal(plan[1].payload.points,3);assert.equal(plan[1].payload.role_type,'學生');
 h.context.rows=[['S1','One'],['S1','Two'],['','No ID']];h.context.mapping={id:0,name:1};assert.ok(vm.runInContext('buildCsvImportPlan(rows,mapping,people)',h.context).every(x=>x.kind==='error'));
 h.context.rows=[['S3','Three','2026-02-30']];h.context.mapping={id:0,name:1,birth:2};assert.equal(vm.runInContext('buildCsvImportPlan(rows,mapping,people)[0].kind',h.context),'error');
});
function setupCsvHarness(h,raw,mapping) {
 h.context.document.getElementById('csv-raw-textarea').value=raw;
 h.context.document.querySelectorAll=selector=>selector==='.csv-mapping-select'?Object.entries(mapping).map(([key,value])=>({value:String(value),getAttribute:()=>key})):[];
 vm.runInContext("currentUser={id:'M-QA',role_type:'同工'};parseCsvContent()",h.context);
}
test('CSV requires preview, patches only confirmed fields, inserts new students and permits a safe retry',async()=>{
 const users=[{id:'S1',name:'Old',phone:'Keep',points:8}];const h=createHarness({users});
 setupCsvHarness(h,'id,name\nS1,Updated\nS2,New',{id:0,name:1});
 await vm.runInContext('executeCsvImport()',h.context);assert.equal(h.writes.length,0);
 await vm.runInContext('previewCsvImport()',h.context);assert.equal(h.writes.length,0);
 await vm.runInContext('executeCsvImport()',h.context);assert.deepEqual(h.writes.map(x=>x.method),['update','insert']);assert.equal(users[0].phone,'Keep');assert.equal(users[0].points,8);assert.equal(users.length,2);
 await vm.runInContext('previewCsvImport()',h.context);assert.ok(vm.runInContext("csvImportPlan.entries.every(x=>x.kind==='skip')",h.context));
 await vm.runInContext('executeCsvImport()',h.context);assert.equal(h.writes.length,2);
});
test('CSV content changes invalidate confirmation; failed writes list the affected row and preserve source',async()=>{
 const h=createHarness({users:[{id:'S1',name:'Old'}],failures:{'users.update':'denied'}});const raw='id,name\nS1,Updated';setupCsvHarness(h,raw,{id:0,name:1});
 await vm.runInContext('previewCsvImport()',h.context);h.elements.get('csv-raw-textarea').value=raw+'changed';await vm.runInContext('executeCsvImport()',h.context);assert.equal(h.writes.length,0);
 h.elements.get('csv-raw-textarea').value=raw;await vm.runInContext('executeCsvImport()',h.context);assert.match(h.elements.get('csv-import-review').innerHTML,/denied/);assert.match(h.alerts.at(-1),/完成 0 筆；失敗 1 筆/);assert.equal(h.elements.get('csv-raw-textarea').value,raw);assert.equal(h.elements.get('csv-confirm-button').disabled,false);
});
test('CSV upload headers and previews escape HTML; reader roles cannot preview or import',async()=>{
 const h=createHarness();setupCsvHarness(h,'id,name,<img src=x>\nS1,<script>bad()</script>,note',{id:0,name:1});
 assert.doesNotMatch(h.elements.get('mapping-dropdowns-grid').innerHTML,/<img/);
 await vm.runInContext('previewCsvImport()',h.context);assert.doesNotMatch(h.elements.get('csv-import-review').innerHTML,/<script>/);
 vm.runInContext("currentUser={id:'T',role_type:'老師'}",h.context);await vm.runInContext('executeCsvImport()',h.context);assert.equal(h.writes.length,0);
});

test('monthly roll call keeps legacy course history and does not silently render failed reads as zero',async()=>{
 const h=createHarness({users:[{id:'S-QA',name:'Student',role_type:'學生',status:'在班'}],rollCalls:[{id:1,student_id:'S-QA',created_at:'2026-10-02T16:00:00Z',course_name:'課後輔導互動',attendance_status:'出席'}]});
 h.context.document.getElementById('print-report-type').value='month_rollcall';h.context.document.getElementById('print-month-filter').value='2026-10';h.context.document.getElementById('print-class-filter').value='elementary';
 await vm.runInContext('renderSelectedReport()',h.context);assert.match(h.elements.get('print-paper-content').innerHTML,/100%/);assert.equal(h.queries.filter(query=>query.table==='roll_calls').at(-1).filters.some(filter=>Array.isArray(filter)&&filter[0]==='course_name'),false);
 const denied=createHarness({failures:{'roll_calls.select':'Synthetic read failed'}});denied.context.document.getElementById('print-report-type').value='month_rollcall';denied.context.document.getElementById('print-month-filter').value='2026-10';
 await vm.runInContext('renderSelectedReport()',denied.context);assert.match(denied.elements.get('print-paper-content').innerHTML,/載入失敗/);assert.doesNotMatch(denied.elements.get('print-paper-content').innerHTML,/0%/);
});

test('late face and photo camera permissions are stopped after cancellation',async()=>{
 for(const [start,stop,generation] of [['startFaceRecognition','stopFaceRecognition','faceGeneration'],['startCameraSnapForFace','stopCameraSnap','snapGeneration']]){
  const h=createHarness();let resolve,stopped=0;const pending=new Promise(r=>resolve=r);
  h.context.navigator={mediaDevices:{getUserMedia:()=>pending}};
  vm.runInContext('isFaceModelsLoaded=true',h.context);
  const task=vm.runInContext(start+'()',h.context);await new Promise(r=>setImmediate(r));
  vm.runInContext(stop+'()',h.context);resolve({getTracks:()=>[{stop(){stopped++;}}]});await task;
  assert.equal(stopped,1,start);assert.equal(vm.runInContext(start==='startFaceRecognition'?'faceStream':'snapStream',h.context),null);
 }
});
test('model failure never opens the face camera and restores the start button',async()=>{
 const h=createHarness();let calls=0;h.context.navigator={mediaDevices:{getUserMedia(){calls++;throw new Error('must not open');}}};
 h.context.faceapi={nets:{tinyFaceDetector:{loadFromUri:()=>Promise.reject(new Error('offline'))},faceLandmark68TinyNet:{loadFromUri:()=>Promise.resolve()},faceRecognitionNet:{loadFromUri:()=>Promise.resolve()}}};
 await vm.runInContext('startFaceRecognition()',h.context);assert.equal(calls,0);assert.equal(vm.runInContext('faceStarting',h.context),false);assert.match(h.alerts.at(-1),/模型載入失敗/);
});
test('stale profile form omits points and read-only roster hides every write action',async()=>{
 const h=createHarness({users:[{id:'S-QA',name:'<img onerror="bad()">',role_type:'學生',points:8,status:'在班',avatar_url:'javascript:bad()'}]});
 vm.runInContext("currentUser={id:'M-QA',role_type:'同工'}",h.context);await vm.runInContext('loadUsers();',h.context);await vm.runInContext("openUserModal('edit','S-QA')",h.context);
 assert.equal(h.elements.get('form-points').readOnly,true);h.elements.get('form-points').value=0;await vm.runInContext('handleUserSubmit({preventDefault(){}})',h.context);
 assert.equal(Object.hasOwn(h.writes.find(w=>w.table==='users').payload,'points'),false);
 vm.runInContext("currentUser={id:'P-QA',role_type:'工讀生'};renderUsers(allUsers)",h.context);
 for(const id of ['students-table','students-cards-mobile']){const html=h.elements.get(id).innerHTML;assert.doesNotMatch(html,/onclick="(?:openUserModal|changePoints|deleteUser)/);assert.doesNotMatch(html,/<img onerror|javascript:bad/);assert.match(html,/&lt;img/);assert.match(html,/點數紀錄/);}
});
test('schedule conflicts stop before confirmation or mutation and preserve the entered form',async()=>{
 const h=createHarness({failures:{schedule_conflict:true}});vm.runInContext("currentUser={id:'M-QA',role_type:'同工'};staffList=[{id:'P-QA',name:'Worker',role_type:'工讀生'}]",h.context);
 for(const [id,value]of [['sch-date','2026-10-12'],['sch-worker-select','P-QA'],['sch-start-time','16:00'],['sch-end-time','18:00'],['sch-hours-val','2'],['sch-job','Keep']])h.context.document.getElementById(id).value=value;
 await vm.runInContext('handleScheduleSubmit({preventDefault(){}})',h.context);assert.equal(h.writes.length,0);assert.equal(h.elements.get('sch-job').value,'Keep');assert.equal(vm.runInContext('scheduleSaving',h.context),false);assert.match(h.alerts.at(-1),/重疊/);
});
test('uncertain rollcall retries reuse the same operation ID; confirmed failure preserves the draft',async()=>{
 const h=createHarness({users:[{id:'S-QA',name:'Student',role_type:'學生',status:'在班'}]});vm.runInContext("currentUser={id:'T-QA',role_type:'老師'}",h.context);h.context.document.getElementById('rollcall-date-picker').value='2026-10-12';await vm.runInContext('loadRollCallsForDate()',h.context);
 const requests=[];h.context.window.fetch=()=>{};
 // nativeFetch is deliberately replaced only in the isolated VM; no real network.
 vm.runInContext("callMschoolApi=async(path,options)=>{testRequests.push(JSON.parse(options.body));throw new Error('Synthetic uncertain response');}",Object.assign(h.context,{testRequests:requests}));
 await vm.runInContext('saveRollCallSheet();',h.context);await vm.runInContext('saveRollCallSheet();',h.context);assert.equal(requests.length,2);assert.equal(requests[0].request_id,requests[1].request_id);assert.equal(vm.runInContext('activeRollCallList.length',h.context),1);assert.equal(h.elements.get('rollcall-save').disabled,false);
});

test('QR cancellation releases a late scanner without reactivating or clearing its replacement',async()=>{
 const h=createHarness(),scanners=[];
 h.context.Html5Qrcode=class{constructor(id){this.id=id;this.stopped=0;this.cleared=0;this.pending=new Promise(r=>this.resolve=r);scanners.push(this);}start(){return this.pending;}async stop(){this.stopped++;}clear(){this.cleared++;}};
 const first=vm.runInContext('startCameraScanner()',h.context);await new Promise(r=>setImmediate(r));vm.runInContext('stopCameraScanner()',h.context);
 const second=vm.runInContext('startCameraScanner()',h.context);await new Promise(r=>setImmediate(r));assert.equal(scanners.length,2);assert.notEqual(scanners[0].id,scanners[1].id);
 scanners[0].resolve();await first;await new Promise(r=>setImmediate(r));assert.equal(scanners[0].stopped,1);assert.equal(scanners[1].stopped,0);assert.equal(vm.runInContext('isCameraScanning',h.context),false);
 scanners[1].resolve();await second;assert.equal(vm.runInContext('isCameraScanning',h.context),true);
});

test('zero-wage schedules remain zero in totals and payroll reference',async()=>{const h=createHarness({schedules:[{id:1,date:'2026-10-12',worker_id:'P-QA',worker_name:'Volunteer',shift:'16:00-18:00',hours:2,hourly_wage:0}]});h.context.plans=[{id:1,date:'2026-10-12',worker_id:'P-QA',worker_name:'Volunteer',shift:'16:00-18:00',hours:2,hourly_wage:0}];vm.runInContext("rawSchedules=plans;currentCalYear=2026;currentCalMonth=10;renderActiveScheduleView()",h.context);assert.equal(h.elements.get('total-wage-badge').textContent,'$0');h.context.document.getElementById('print-report-type').value='workhours';h.context.document.getElementById('print-month-filter').value='2026-10';await vm.runInContext('renderSelectedReport()',h.context);assert.match(h.elements.get('print-paper-content').innerHTML,/\$0\/h/);assert.doesNotMatch(h.elements.get('print-paper-content').innerHTML,/\$380/);});

test('missing QR library restores controls and permits retry',async()=>{const h=createHarness();await vm.runInContext('startCameraScanner()',h.context);assert.equal(vm.runInContext('qrStarting',h.context),false);assert.equal(vm.runInContext('isCameraScanning',h.context),false);assert.equal(h.elements.get('camera-scanner-container').classList.contains('hidden'),true);assert.ok(h.alerts.length);});

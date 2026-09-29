import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const duplicateIndex = await readFile(new URL('../index2.html', import.meta.url), 'utf8');
const databaseNotes = await readFile(new URL('../DATABASE.md', import.meta.url), 'utf8');

test('Supabase business table access matches the documented baseline', () => {
  const expected = {
    users: ['delete', 'select', 'update', 'upsert'],
    schedules: ['insert', 'select'],
    check_in_logs: ['insert', 'select'],
    points_logs: ['insert'],
    roll_calls: ['insert', 'select'],
    counseling_logs: ['delete', 'select'],
    parent_messages: ['select', 'update'],
  };

  const observed = {};
  for (const [, table, method] of index.matchAll(/db\.from\(\s*['"]([^'"]+)['"]\s*\)\s*\.([a-z][a-z\d_]*)/gi)) {
    (observed[table] ??= new Set()).add(method);
  }

  assert.deepEqual(Object.keys(observed).sort(), Object.keys(expected).sort());
  for (const [table, methods] of Object.entries(expected)) {
    assert.deepEqual([...observed[table]].sort(), methods, `${table} access changed; update the audit and review write paths`);
    assert.ok(databaseNotes.includes(`\`${table}\``), `${table} is missing from DATABASE.md`);
  }
});

test('avatar access remains explicit in the documented baseline', () => {
  assert.match(index, /db\.storage\.from\(['"]avatars['"]\)\.upload\(/);
  assert.match(index, /db\.storage\.from\(['"]avatars['"]\)\.getPublicUrl\(/);
  assert.match(databaseNotes, /Storage bucket `avatars`/);
});

test('browser source contains no privileged Supabase secret key', () => {
  assert.doesNotMatch(index, /sb_secret_[A-Za-z0-9_-]+/i);
  assert.doesNotMatch(index, /service_role/i);
});

test('duplicate HTML entry files stay byte-identical until hosting source is confirmed', () => {
  assert.equal(index, duplicateIndex);
});

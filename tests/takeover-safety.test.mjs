import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const duplicateIndex = await readFile(new URL('../index2.html', import.meta.url), 'utf8');
test('browser uses the unified school API and no longer names the retired project', () => {
  assert.match(index, /const MSCHOOL_API_URL\s*=\s*`\$\{SUPABASE_URL\}\/functions\/v1\/mschool-api`/u);
  assert.match(index, /aqanuwilmvdtlzuqlrau\.supabase\.co/u);
  assert.doesNotMatch(index, /othgvewffvkkafbezejy/u);
  assert.match(index, /callMschoolApi\(['"]\/manual-login['"]/u);
  assert.match(index, /callMschoolApi\(['"]\/kiosk\/check-in['"]/u);
});

test('avatar uploads use the authenticated private media endpoint', () => {
  assert.doesNotMatch(index, /db\.storage\.from\(['"]avatars['"]\)/u);
  assert.match(index, /callMschoolApi\(['"]\/upload['"]/u);
  assert.match(index, /\)\.storageRef/u);
});

test('browser source contains no privileged Supabase secret key', () => {
  assert.doesNotMatch(index, /sb_secret_[A-Za-z0-9_-]+/i);
  assert.doesNotMatch(index, /service_role/i);
});

test('duplicate HTML entry files stay byte-identical until hosting source is confirmed', () => {
  assert.equal(index, duplicateIndex);
});

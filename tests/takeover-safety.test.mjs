import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const duplicateIndex = await readFile(new URL('../index2.html', import.meta.url), 'utf8');
test('browser uses the unified school API and no longer names the retired project', () => {
  assert.match(index, /const MSCHOOL_API_URL\s*=\s*`\$\{SUPABASE_URL\}\/functions\/v1\/mschool-api`/u);
  assert.match(index, /aqanuwilmvdtlzuqlrau\.supabase\.co/u);
  assert.doesNotMatch(index, /othgvewffvkkafbezejy/u);
  assert.doesNotMatch(index, /callMschoolApi\(['"]\/manual-login['"]/u);
  assert.match(index, /mscos\.mchurch\.online\/admin-dashboard\.html/u);
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

test('all HTML entry files use the active school API project', () => {
  for (const [name, source] of [['index.html', index], ['index2.html', duplicateIndex]]) {
    assert.match(source, /const MSCHOOL_API_URL\s*=\s*`\$\{SUPABASE_URL\}\/functions\/v1\/mschool-api`/u, name);
    assert.match(source, /aqanuwilmvdtlzuqlrau\.supabase\.co/u, name);
    assert.doesNotMatch(source, /othgvewffvkkafbezejy/u, name);
    assert.doesNotMatch(source, /sb_secret_[A-Za-z0-9_-]+|service_role/i, name);
  }
});

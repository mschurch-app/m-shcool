import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const staticIds = [...html.matchAll(/\bid="([^"$]+)"/gu)].map(match => match[1]);
const definedFunctions = new Set([...html.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gu)].map(match => match[1]));
const browserBuiltins = new Set(['Number', 'print', 'stopPropagation']);

test('all static element ids are unique', () => {
  const duplicates = staticIds.filter((id, index) => staticIds.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});

test('all literal getElementById targets exist in the page', () => {
  const ids = new Set(staticIds);
  const references = [...html.matchAll(/getElementById\(['"]([^'"]+)['"]\)/gu)].map(match => match[1]);
  assert.deepEqual([...new Set(references.filter(id => !ids.has(id)))], []);
});

test('all inline UI event handlers point to defined functions', () => {
  const handlers = [...html.matchAll(/on(?:click|change|input|submit)="([^"]+)"/gu)]
    .flatMap(match => [...match[1].matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/gu)].map(call => call[1]));
  const missing = [...new Set(handlers.filter(name => !definedFunctions.has(name) && !browserBuiltins.has(name)))];
  assert.deepEqual(missing, []);
});

test('every navigation target has a matching page panel', () => {
  const ids = new Set(staticIds);
  const targets = [...html.matchAll(/(?:requireTab|switchTab)\(['"]([^'"]+)['"]\)/gu)].map(match => match[1]);
  assert.deepEqual([...new Set(targets.filter(target => !ids.has(`tab-${target}`)))], []);
});

test('school API proxy removes unnecessary Supabase headers before CORS preflight', () => {
  for (const header of ['authorization', 'apikey', 'x-client-info', 'accept-profile', 'content-profile']) {
    assert.match(html, new RegExp(`['"]${header}['"]`, 'u'));
  }
  assert.match(html, /headers\.delete\(name\)/u);
});

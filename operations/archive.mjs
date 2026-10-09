import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export function seal(bytes,key=randomBytes(32)) {
 if(key.length!==32)throw Error('A 32-byte key is required');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from('mschool-archive-v1'));
 const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
 return {key,envelope:{format:'mschool-archive-v1',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}};
}
export function unseal(envelope,key) {
 if(envelope.format!=='mschool-archive-v1')throw Error('Unknown archive format');
 const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
 cipher.setAAD(Buffer.from('mschool-archive-v1'));cipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
 return Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext,'base64')),cipher.final()]);
}
export function readRows(xml) {
 const match=xml.match(/<data>([\s\S]*?)<\/data>/);
 if(!match)throw Error('Missing snapshot data');
 const decoded=match[1].replace(/&(lt|gt|quot|apos|amp);/g,(_,s)=>({lt:'<',gt:'>',quot:'"',apos:"'",amp:'&'}[s]));
 const rows=JSON.parse(decoded);if(!Array.isArray(rows))throw Error('Invalid rows');return rows;
}
function stable(value) {
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
 return value;
}
export function rowsDigest(rows){return sha256(rows.map(row=>JSON.stringify(stable(row))).sort().join('\n'));}
export function identifier(value){if(!/^[a-z_][a-z0-9_]*$/.test(value))throw Error('Unsafe SQL identifier');return '"'+value+'"';}
const types=new Set(['text','timestamp with time zone','uuid','integer','bigint','jsonb','boolean','date','numeric']);
// Reconstruct typed data in a fresh, isolated database. Never connect this to production.
// Defaults, sequences, RLS, functions, auth and storage require a separate platform restore.
export async function restoreApplicationData(db,snapshot) {
 const schema=identifier(snapshot.schema);if(snapshot.schema!=='public')await db.exec(`create schema ${schema}`);
 const results=[];
 for(const table of snapshot.tables) {
  const name=identifier(table.table),columns=snapshot.catalog.columns.filter(c=>c.table===table.table);
  if(!columns.length||columns.some(c=>!types.has(c.type)))throw Error('Unknown snapshot type');
  await db.exec(`create table ${schema}.${name} (${columns.map(c=>identifier(c.name)+' '+c.type+(c.not_null?' not null':'')).join(',')})`);
  const rows=readRows(table.data_xml);
  await db.query(`insert into ${schema}.${name} select * from jsonb_populate_recordset(null::${schema}.${name},$1::jsonb)`,[JSON.stringify(rows)]);
  // Do not execute arbitrary catalog SQL. Rebuild only the parsed primary/unique column list.
  for(const constraint of snapshot.catalog.constraints.filter(c=>c.table===table.table&&['p','u'].includes(c.type))) {
   const match=constraint.definition.match(/^(?:PRIMARY KEY|UNIQUE) \(([a-z_, ]+)\)$/);
   if(!match)throw Error('Unsupported key constraint');
   const names=match[1].split(',').map(s=>s.trim());if(names.some(n=>!columns.some(c=>c.name===n)))throw Error('Unknown key column');
   await db.exec(`alter table ${schema}.${name} add constraint ${identifier(constraint.name)} ${constraint.type==='p'?'primary key':'unique'} (${names.map(identifier).join(',')})`);
  }
  const actual=(await db.query(`select to_jsonb(t) row from ${schema}.${name} t`)).rows.map(r=>r.row);
  const expectedDigest=rowsDigest(rows),restoredDigest=rowsDigest(actual);
  if(expectedDigest!==restoredDigest)throw Error('Restored data mismatch: '+table.table);
  results.push({table:table.table,rows:rows.length,sha256:restoredDigest});
 }
 return {tables:results,rows:results.reduce((n,t)=>n+t.rows,0),scope:'typed rows, nullability, primary and unique keys; not a full Supabase platform restore'};
}

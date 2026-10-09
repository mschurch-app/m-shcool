import test from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal,readRows,rowsDigest,identifier,restoreApplicationData,sha256} from '../operations/archive.mjs';
import {probe,runHealth} from '../operations/health.mjs';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('encrypted archive authenticates contents and rejects wrong keys/tampering',()=>{
 const source=Buffer.from('synthetic private data'),a=seal(source),b=seal(source);
 assert.deepEqual(unseal(a.envelope,a.key),source);assert.notEqual(a.envelope.ciphertext,b.envelope.ciphertext);
 assert.throws(()=>unseal(a.envelope,b.key));assert.throws(()=>unseal({...a.envelope,tag:Buffer.alloc(16).toString('base64')},a.key));
});
test('XML export round trips text without treating it as markup or double decoding',()=>{
 const rows=[{name:'<x> &lt; "ok"'}];
 const xml=JSON.stringify(rows).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 assert.deepEqual(readRows('<row><data>'+xml+'</data></row>'),rows);
 assert.throws(()=>readRows('<row/>'));assert.throws(()=>identifier('users;drop table users'));
 assert.equal(rowsDigest([{b:2,a:1},{a:3}]),rowsDigest([{a:3},{a:1,b:2}]));
});
test('restore drill rebuilds typed rows and keys only in a fresh local database',async()=>{
 const db=new PGlite();try{
 const snapshot={schema:'mschool',tables:[{table:'users',data_xml:'<row><data>[{"id":"S-QA","name":"Synthetic","points":5}]</data></row>'}],catalog:{columns:[{table:'users',name:'id',type:'text',not_null:true},{table:'users',name:'name',type:'text'},{table:'users',name:'points',type:'integer'}],constraints:[{table:'users',name:'users_pkey',type:'p',definition:'PRIMARY KEY (id)'}]}};
 const result=await restoreApplicationData(db,snapshot);assert.equal(result.rows,1);
 await assert.rejects(db.exec("insert into mschool.users(id) values('S-QA')"));
 }finally{await db.close();}
});
test('health fails closed on redirect, unavailable API and drift',async()=>{
 await assert.rejects(probe('https://example.test',{hash:sha256('a')},async()=>new Response('b')));
 await assert.rejects(probe('https://example.test',{},async()=>new Response('',{status:503})));
 const manifest={assets:[{path:'index.html',sha256:sha256('page')}],baseline:'synthetic'};
 const request=async(url,options)=>{assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.ok(options.signal);return new Response(url.includes('functions/')?' {"error":"denied"}':'page',{status:url.includes('functions/')?401:200});};
 assert.equal((await runHealth(manifest,request)).ok,true);
 assert.equal((await runHealth(manifest,async()=>new Response('page'))).ok,false);
 await assert.rejects(runHealth({assets:[{path:'../secrets',sha256:sha256('x')}]},request));
});
test('release manifest covers all school assets and remains synchronized with source',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../operations/release-manifest.json',import.meta.url)));
 assert.equal(manifest.assets.length,11);
 for(const asset of manifest.assets){assert.equal(sha256(await readFile(new URL('../'+asset.path,import.meta.url))),asset.sha256,asset.path);}
});

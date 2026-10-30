import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../server/feedback-worker.js';

const ORIGIN = 'https://oil-flow-studio.vercel.app';
const URL_BASE = 'https://feedback.example.test';
const schema = readFileSync(new URL('../server/feedback-schema.sql', import.meta.url), 'utf8');
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'];

function database() {
  const sql = new DatabaseSync(':memory:');sql.exec(schema);
  const statements = [];
  const DB = {prepare(query) {
    statements.push(query);
    assert.doesNotMatch(query, /\b(?:CREATE|ALTER|DROP)\b/i, 'runtime must not manage schema');
    const statement = sql.prepare(query);
    const prepared = values => ({
      bind(...parameters) { return prepared(parameters); },
      async all() { return {success:true, results:statement.all(...values)}; },
      async first() { return statement.get(...values) || null; },
      async run() { const result=statement.run(...values);return {success:true, meta:{changes:Number(result.changes)}}; }
    });
    return prepared([]);
  }};
  return {sql, DB, statements, close:()=>sql.close()};
}

function suggestion(overrides = {}) {
  return {requestId:ids[0], name:' 小王 ', title:' 管線工具建議 ', category:'idea',
    body:'第一行\r\n第二行', website:'', ...overrides};
}

function request(path='/api/feedback', options={}) {
  const {origin=ORIGIN, method='GET', body, headers={}} = options;
  return new Request(URL_BASE+path, {method, headers:{...(origin ? {Origin:origin}:{}),
    ...(body == null ? {} : {'Content-Type':'application/json'}), ...headers},
    ...(body == null ? {} : {body:typeof body==='string'?body:JSON.stringify(body)})});
}

test('anonymous posts persist across independent requests and readers, with normalized public fields', async () => {
  const db=database();
  try {
    const created=await worker.fetch(request('/api/feedback',{method:'POST',body:suggestion()}),{DB:db.DB});
    assert.equal(created.status,201);assert.equal(created.headers.get('Access-Control-Allow-Origin'),ORIGIN);
    const result=await created.json();assert.equal(result.duplicate,false);
    assert.deepEqual({...result.item,createdAt:0},{id:ids[0],name:'小王',title:'管線工具建議',category:'idea',body:'第一行\n第二行',createdAt:0});
    assert.ok(Number.isSafeInteger(result.item.createdAt));
    const anotherBrowser=await worker.fetch(request(),{DB:db.DB});
    const list=await anotherBrowser.json();assert.equal(list.total,1);assert.equal(list.nextCursor,null);
    assert.deepEqual(list.items,[result.item]);
    assert.equal(anotherBrowser.headers.get('Cache-Control'),'no-store');
    assert.ok(db.statements.every(statement=>!statement.includes(';')),'one statement per prepare');
  } finally { db.close(); }
});

test('request identifiers make retries idempotent without overwriting another suggestion', async () => {
  const db=database();
  try {
    const responses=await Promise.all([worker.fetch(request('/api/feedback',{method:'POST',body:suggestion()}),{DB:db.DB}),
      worker.fetch(request('/api/feedback',{method:'POST',body:suggestion()}),{DB:db.DB})]);
    assert.deepEqual(responses.map(response=>response.status).sort(),[200,201]);
    assert.equal((await worker.fetch(request(),{DB:db.DB}).then(response=>response.json())).total,1);
    const conflicting=await worker.fetch(request('/api/feedback',{method:'POST',body:suggestion({title:'不同主旨'})}),{DB:db.DB});
    assert.equal(conflicting.status,409);
    assert.equal((await worker.fetch(request(),{DB:db.DB}).then(response=>response.json())).items[0].title,'管線工具建議');
  } finally { db.close(); }
});

test('CORS permits the production website, service origin and loopback, and denies unrelated origins', async () => {
  const db=database();
  try {
    for(const origin of [ORIGIN, URL_BASE, 'null','http://localhost:4173','http://127.0.0.1:8921','http://[::1]:4173']) {
      const response=await worker.fetch(request('/api/feedback',{origin}),{DB:db.DB});
      assert.equal(response.status,200,origin);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
      assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);
    }
    for(const origin of ['https://evil.test','https://oil-flow-studio.vercel.app.evil.test','https://localhost.evil.test']) {
      const response=await worker.fetch(request('/api/feedback',{origin,method:'POST',body:suggestion()}),{DB:db.DB});
      assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
    }
    const preflight=await worker.fetch(request('/api/feedback',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST'}}),{});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Headers'),'Content-Type');
    assert.equal((await worker.fetch(request('/api/feedback',{origin:null}),{DB:db.DB})).status,200);
    assert.equal((await worker.fetch(request('/api/feedback',{method:'DELETE'}),{DB:db.DB})).status,405);
    assert.equal((await worker.fetch(request('/elsewhere'),{DB:db.DB})).status,404);
  } finally { db.close(); }
});

test('validation rejects malformed, oversized, bot and unsafe submissions before writing', async () => {
  const db=database();
  try {
    const invalid = [suggestion({requestId:'not-a-uuid'}),suggestion({name:'同'.repeat(41)}),
      suggestion({title:''}),suggestion({title:'題'.repeat(81)}),suggestion({body:'文'.repeat(3001)}),
      suggestion({category:'administration'}),suggestion({website:'https://bot.test'}),
      suggestion({name:42}),suggestion({body:'bad\u0000text'}),[],null];
    for(const input of invalid) {
      const response=await worker.fetch(request('/api/feedback',{method:'POST',body:JSON.stringify(input)}),{DB:db.DB});
      assert.equal(response.status,400,JSON.stringify(input)?.slice(0,100));assert.equal(typeof (await response.json()).error,'string');
    }
    const malformed=await worker.fetch(request('/api/feedback',{method:'POST',body:'{ broken'}),{DB:db.DB});
    assert.equal(malformed.status,400);
    const wrongType=await worker.fetch(request('/api/feedback',{method:'POST',body:'{}',headers:{'Content-Type':'text/plain'}}),{DB:db.DB});
    assert.equal(wrongType.status,415);
    const declaredTooLarge=await worker.fetch(request('/api/feedback',{method:'POST',body:'{}',headers:{'Content-Length':'17000'}}),{DB:db.DB});
    assert.equal(declaredTooLarge.status,413);
    const streamedTooLarge=await worker.fetch(request('/api/feedback',{method:'POST',body:JSON.stringify({body:'x'.repeat(17000)})}),{DB:db.DB});
    assert.equal(streamedTooLarge.status,413);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS total FROM feedback').get().total,0);
    const fullChinese=await worker.fetch(request('/api/feedback',{method:'POST',body:suggestion({body:'文'.repeat(3000)})}),{DB:db.DB});
    assert.equal(fullChinese.status,201,'3000 Chinese characters fit within the 16 KB packet limit');
  } finally { db.close(); }
});

test('stored user text remains literal and parameterized SQL preserves the table', async () => {
  const db=database();
  try {
    const text=`<script>alert('x')</script>\n'; DROP TABLE feedback; --`;
    const response=await worker.fetch(request('/api/feedback',{method:'POST',body:suggestion({name:'匿名',body:text})}),{DB:db.DB});
    assert.equal(response.status,201);assert.equal((await response.json()).item.body,text);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS total FROM feedback').get().total,1);
  } finally { db.close(); }
});

test('pagination is stable newest-first and can retrieve all records without duplicates', async () => {
  const db=database();
  try {
    const insert=db.sql.prepare('INSERT INTO feedback (id,name,title,category,body,created_at) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run(ids[0],'','一','other','內容一',100);
    insert.run(ids[1],'','二','bug','內容二',200);
    insert.run(ids[2],'','三','ui','內容三',200);
    const first=await worker.fetch(request('/api/feedback?limit=2'),{DB:db.DB}).then(response=>response.json());
    assert.equal(first.total,3);assert.deepEqual(first.items.map(item=>item.id),[ids[2],ids[1]]);
    assert.equal(first.nextCursor,`200.${ids[1]}`);
    const second=await worker.fetch(request('/api/feedback?limit=2&cursor='+encodeURIComponent(first.nextCursor)),{DB:db.DB}).then(response=>response.json());
    assert.deepEqual(second.items.map(item=>item.id),[ids[0]]);assert.equal(second.nextCursor,null);
    for(const query of ['limit=0','limit=201','limit=oops','cursor=broken','cursor=-1.'+ids[0]]) {
      assert.equal((await worker.fetch(request('/api/feedback?'+query),{DB:db.DB})).status,400);
    }
  } finally { db.close(); }
});

test('missing or failing storage produces a recoverable message without internal details', async () => {
  assert.equal((await worker.fetch(request(),{})).status,503);
  const failing=await worker.fetch(request(),{DB:{prepare(){throw new Error('do-not-leak-credentials');}}});
  assert.equal(failing.status,503);assert.doesNotMatch(await failing.text(),/do-not-leak/);
  const home=await worker.fetch(request('/'),{});assert.equal(home.status,200);
});

test('maintenance deletion requires the runtime secret and deletes only the selected record', async () => {
  const db=database(), secret='example-runtime-only-key-for-unit-test';
  try {
    for(const id of ids.slice(0,2)) {
      assert.equal((await worker.fetch(request('/api/feedback',{method:'POST',body:suggestion({requestId:id})}),{DB:db.DB})).status,201);
    }
    const path='/api/feedback/'+ids[0];
    const remove=headers=>worker.fetch(request(path,{method:'DELETE',headers}),{DB:db.DB,FEEDBACK_ADMIN_KEY:secret});
    assert.equal((await remove({})).status,403);
    assert.equal((await remove({Authorization:'Bearer wrong-key'})).status,403);
    assert.equal((await worker.fetch(request(path,{method:'DELETE',headers:{Authorization:'Bearer '+secret}}),{DB:db.DB})).status,403);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS total FROM feedback').get().total,2);
    const deleted=await remove({Authorization:'Bearer '+secret});assert.equal(deleted.status,200);
    assert.deepEqual(await deleted.json(),{id:ids[0],deleted:true});
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS total FROM feedback').get().total,1);
    assert.equal(db.sql.prepare('SELECT id FROM feedback').get().id,ids[1]);
    assert.equal((await remove({Authorization:'Bearer '+secret})).status,404);
  } finally { db.close(); }
});

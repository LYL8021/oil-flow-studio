import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createD1SnapshotStore} from '../server/d1-snapshots.js';
import worker from '../server/feedback-worker.js';
import {captureOperation} from '../dist/operations.js';

const schema = name => readFileSync(new URL('../server/' + name, import.meta.url), 'utf8');
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;

function storage({snapshots = true} = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  sql.exec(schema('feedback-schema.sql'));
  sql.exec(schema('drawings-schema.sql'));
  if (snapshots) sql.exec(schema('d1-snapshots-schema.sql'));
  const queries = [], batches = [];
  const DB = {
    prepare(query) {
      queries.push(query);
      assert.doesNotMatch(query, /\b(?:CREATE|ALTER|DROP)\b/i, 'requests must not change migration-owned schema');
      assert.ok(!query.includes(';'), 'one statement per prepare');
      const statement = sql.prepare(query);
      const prepared = values => ({
        bind(...parameters) {
          for (const value of parameters) {
            assert.ok(!Array.isArray(value) && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer),
              'large snapshots must not use D1 numeric-array BLOB bindings');
            if (typeof value === 'string') assert.ok(Buffer.byteLength(value) <= 1048576, 'all text bindings fit below D1 row limits');
          }
          return prepared(parameters);
        },
        async first() { return statement.get(...values) || null; },
        async all() { return {success:true, results:statement.all(...values)}; },
        execute() { const result = statement.run(...values); return {success:true, meta:{changes:Number(result.changes)}}; },
        async run() { return this.execute(); }
      });
      return prepared([]);
    },
    async batch(commands) {
      batches.push(commands.length);
      sql.exec('BEGIN');
      try {
        const results = commands.map(command => command.execute());
        sql.exec('COMMIT');
        return results;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    }
  };
  return {sql, DB, queries, batches, store:createD1SnapshotStore(DB), close:() => sql.close()};
}

test('large UTF-8 snapshots preserve Chinese, supplementary characters and exact text without BLOB arrays', async () => {
  const db = storage();
  try {
    const prefix = 'x'.repeat(256 * 1024 - 1);
    const body = prefix + '🛢️柴油／燃料油\n'.repeat(200000);
    assert.ok(Buffer.byteLength(body) > 2000000);
    await db.store.put('drawings/utf8/1/test.json', body);
    const saved = await db.store.get('drawings/utf8/1/test.json');
    assert.equal(saved.size, Buffer.byteLength(body));
    assert.equal(await saved.text(), body);
    const chunks = db.sql.prepare('SELECT body, length(CAST(body AS BLOB)) AS bytes FROM drawing_snapshot_chunks ORDER BY chunk_index').all();
    assert.ok(chunks.length > 2);
    assert.ok(chunks.every(chunk => chunk.bytes <= 1048576 && !/[\uD800-\uDFFF]/u.test(chunk.body)));
    assert.equal(db.batches.length, 1, 'all header and chunk writes use a single atomic D1 batch');
  } finally { db.close(); }
});

test('identical concurrent puts and lost commit responses are idempotent; immutable content cannot be replaced', async () => {
  const db = storage();
  try {
    const text = JSON.stringify({name:'日南中繼站', oil:'柴油', comment:'A／B 口'});
    await Promise.all([db.store.put('same-key', text), db.store.put('same-key', text)]);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS count FROM drawing_snapshot_objects').get().count, 1);
    assert.equal(await (await db.store.get('same-key')).text(), text);
    await assert.rejects(db.store.put('same-key', 'different'), error => error.code === 'snapshot-conflict');
    assert.equal(await (await db.store.get('same-key')).text(), text);
    const batch = db.DB.batch;
    db.DB.batch = async commands => { await batch(commands); throw new Error('response lost after COMMIT'); };
    await db.store.put('committed-key', text);
    assert.equal(await (await db.store.get('committed-key')).text(), text);
  } finally { db.close(); }
});

test('failed partial writes roll back atomically without exposing a header or orphan chunks', async () => {
  const db = storage();
  try {
    const originalBatch = db.DB.batch;
    db.DB.batch = async commands => {
      const second = commands[2];
      commands[2] = {execute() { second.execute(); throw new Error('simulated transaction failure'); }};
      return originalBatch(commands);
    };
    await assert.rejects(db.store.put('incomplete', 'a'.repeat(600000)), /simulated transaction failure/);
    assert.equal(await db.store.get('incomplete'), null);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS count FROM drawing_snapshot_chunks').get().count, 0);
  } finally { db.close(); }
});

test('read assembly accepts variable import chunk sizes and detects missing, reordered or truncated parts', async () => {
  const db = storage();
  try {
    const parts = ['{"text":"', '輸王田', '🛢️', '"}'];
    db.sql.prepare('INSERT INTO drawing_snapshot_objects VALUES (?, ?, ?, ?)').run('imported', Buffer.byteLength(parts.join('')), parts.length, 1);
    for (let index = parts.length - 1; index >= 0; index--) db.sql.prepare('INSERT INTO drawing_snapshot_chunks VALUES (?, ?, ?)').run('imported', index, parts[index]);
    assert.deepEqual(await (await db.store.get('imported')).json(), {text:'輸王田🛢️'});
    db.sql.prepare('DELETE FROM drawing_snapshot_chunks WHERE object_key = ? AND chunk_index = 2').run('imported');
    await assert.rejects(db.store.get('imported'), error => error.code === 'snapshot-incomplete');
    await db.store.put('truncated', '柴油');
    db.sql.prepare('UPDATE drawing_snapshot_chunks SET body = ? WHERE object_key = ?').run('油', 'truncated');
    await assert.rejects(db.store.get('truncated'), error => error.code === 'snapshot-incomplete');
  } finally { db.close(); }
});

test('delete accepts one or multiple keys and removes headers and every part atomically', async () => {
  const db = storage();
  try {
    await db.store.put('a', 'one'); await db.store.put('b', 'two'); await db.store.put('c', 'three');
    await db.store.delete(['a', 'b', 'a']);
    assert.equal(await db.store.get('a'), null); assert.equal(await db.store.get('b'), null);
    assert.equal(await (await db.store.get('c')).text(), 'three');
    await db.store.delete('c'); await db.store.delete('not-found'); await db.store.delete([]);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS count FROM drawing_snapshot_objects').get().count, 0);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS count FROM drawing_snapshot_chunks').get().count, 0);
  } finally { db.close(); }
});

test('empty text is supported; invalid UTF-8 and snapshots over the existing 24 MiB limit are rejected before writing', async () => {
  const db = storage();
  try {
    await db.store.put('empty', '');
    assert.equal(await (await db.store.get('empty')).text(), '');
    await assert.rejects(db.store.put('invalid', '\uD800'), error => error.code === 'invalid-snapshot');
    await assert.rejects(db.store.put('large', 'x'.repeat(24 * 1024 * 1024 + 1)), error => error.status === 413);
    await assert.rejects(db.store.put('large-utf8', '油'.repeat(9 * 1024 * 1024)), error => error.status === 413);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS count FROM drawing_snapshot_objects').get().count, 1);
  } finally { db.close(); }
});

test('the full 24 MiB snapshot limit round-trips in bounded text rows and one write batch', async () => {
  const db = storage();
  try {
    const text = 'x'.repeat(24 * 1024 * 1024);
    await db.store.put('maximum-size', text);
    const saved = await db.store.get('maximum-size');
    assert.equal(saved.size, 24 * 1024 * 1024);
    assert.equal(await saved.text(), text);
    assert.equal(db.batches.length, 1, 'the full snapshot uses one atomic write batch instead of one network call per chunk');
  } finally { db.close(); }
});

const request = (path, body, method = body ? 'POST' : 'GET') => new Request('https://service.example' + path, {
  method, headers:{Origin:'https://oil-flow-studio.vercel.app', ...(body ? {'Content-Type':'application/json'} : {})},
  ...(body ? {body:JSON.stringify(body)} : {})
});

function project() {
  const diagram = {title:'日南共用測試', nodes:[
    {id:'tank', type:'tank', x:100, y:100, scale:30, inAngle:15, outAngle:90, enabled:true, fuel:'diesel', portModes:{in:'outlet', out:'outlet'}, code:''},
    {id:'valve', type:'valve', x:200, y:100, open:true, code:'RN-D1'},
    {id:'ground', type:'ground', x:300, y:100, variant:'sink', flowMode:'idle', enabled:false, fuel:'gasoline'}
  ], edges:[
    {id:'a', from:{node:'tank', port:'out'}, to:{node:'valve', port:'in'}, kind:'bridge', routing:'free', waypoints:[{x:150,y:120}], layer:3},
    {id:'b', from:{node:'valve', port:'out'}, to:{node:'ground', port:'port'}, kind:'underground', routing:'orthogonal', waypoints:[]}
  ], reference:{dataUrl:'data:image/png;base64,' + 'A'.repeat(2200000), width:1000, height:1000, baseWidth:1000, baseHeight:1000, x:0, y:0, opacity:.22, visible:true}};
  diagram.operations = [captureOperation(diagram, {id:'stop', name:'停止輸送'})];
  return diagram;
}

test('the drawings API works with D1 alone, retaining >2 MB backgrounds, source roles, histories, retries and conflict handling', async () => {
  const db = storage();
  try {
    const diagram = project(), firstBody = {requestId:id(1), name:'日南共用測試', project:diagram};
    const first = await worker.fetch(request('/api/drawings', firstBody), {DB:db.DB});
    assert.equal(first.status, 201, await first.clone().text());
    const saved = (await first.json()).item;
    assert.deepEqual(saved.project, diagram);
    const read = await worker.fetch(request('/api/drawings/' + saved.id), {DB:db.DB});
    assert.deepEqual((await read.json()).project, diagram);
    const changed = structuredClone(diagram); changed.nodes[1].open = false;
    const updateBody = {requestId:id(2), id:saved.id, expectedRevision:1, name:saved.name, project:changed};
    const updated = await worker.fetch(request('/api/drawings', updateBody), {DB:db.DB});
    assert.equal(updated.status, 200); assert.equal((await updated.json()).item.revision, 2);
    const retry = await worker.fetch(request('/api/drawings', updateBody), {DB:db.DB});
    assert.equal((await retry.json()).duplicate, true);
    const stale = await worker.fetch(request('/api/drawings', {...updateBody, requestId:id(3)}), {DB:db.DB});
    assert.equal(stale.status, 409);
    const old = await worker.fetch(request('/api/drawings/' + saved.id + '/revisions/1'), {DB:db.DB});
    assert.deepEqual((await old.json()).project, diagram);
    const current = await worker.fetch(request('/api/drawings/' + saved.id), {DB:db.DB});
    assert.deepEqual((await current.json()).project, changed);
    assert.equal(db.sql.prepare('SELECT COUNT(*) AS count FROM drawing_snapshot_objects').get().count, 2);
  } finally { db.close(); }
});

test('an existing R2 binding takes precedence and does not require D1 snapshot tables', async () => {
  const db = storage({snapshots:false}), objects = new Map();
  const BUCKET = {async put(key, body) { objects.set(key, body); }, async get(key) { return objects.has(key) ? {text:async () => objects.get(key)} : null; },
    async delete(key) { objects.delete(key); }};
  try {
    const diagram = {nodes:[], edges:[]};
    const response = await worker.fetch(request('/api/drawings', {requestId:id(1), name:'R2 remains', project:diagram}), {DB:db.DB, BUCKET});
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal(objects.size, 1);
    assert.ok(db.queries.every(query => !query.includes('drawing_snapshot_')));
  } finally { db.close(); }
});

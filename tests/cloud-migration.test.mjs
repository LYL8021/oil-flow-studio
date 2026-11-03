import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createD1SnapshotStore} from '../server/d1-snapshots.js';

test('cloud migration preserves SQLite records, R2 snapshots and historical API content; rejects incomplete and changing sources', async () => {
  await promisify(execFile)('python3', [new URL('./cloud_migration_checks.py', import.meta.url).pathname], {
    cwd:new URL('..', import.meta.url).pathname
  });
});

test('D1 migration SQL is readable by the actual snapshot adapter for every historical full project', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'oil-d1-migration-'));
  let database;
  try {
    await promisify(execFile)('python3', ['-c', `
import runpy,sys,pathlib
checks=runpy.run_path('tests/cloud_migration_checks.py')
m=checks['m'];bundle=checks['fixture']()
for version in bundle['drawings'][0]['versions']:
    version['project']['reference']['dataUrl']='data:image/png;base64,'+'YWJj'*35000
    version['project']['unicodeNote']='完整圖面😀多位元字元'*1000
bundle['checksum']=m.digest({key:value for key,value in bundle.items() if key!='checksum'})
m.prepare_import(bundle,pathlib.Path(sys.argv[1])/'import',storage='d1')
pathlib.Path(sys.argv[1],'expected.json').write_bytes(m.json_bytes(bundle))
`, temporary], {cwd:new URL('..', import.meta.url).pathname});
    const expected = JSON.parse(await readFile(join(temporary, 'expected.json'), 'utf8'));
    const sql = await readFile(join(temporary, 'import/import.sql'), 'utf8');
    database = new DatabaseSync(':memory:');
    for (const filename of ['feedback-schema.sql','drawings-schema.sql','d1-snapshots-schema.sql']) {
      database.exec(await readFile(new URL('../server/' + filename, import.meta.url), 'utf8'));
    }
    database.exec(sql);
    const DB = {
      prepare(query) {
        const statement = database.prepare(query);
        const prepared = values => ({
          bind(...parameters) { return prepared(parameters); },
          async first() { return statement.get(...values) || null; },
          async all() { return {results:statement.all(...values)}; }
        });
        return prepared([]);
      },
      async batch() { throw Error('Read verification must not mutate imported snapshots'); }
    };
    const snapshots = createD1SnapshotStore(DB);
    for (const drawing of expected.drawings) {
      for (const version of drawing.versions) {
        const stored = database.prepare('SELECT object_key FROM drawing_revisions WHERE drawing_id=? AND revision=?').get(drawing.id, version.revision);
        const snapshot = await snapshots.get(stored.object_key);
        assert.deepEqual(await snapshot.json(), version.project);
        assert.equal(snapshot.size, Buffer.byteLength(await snapshot.text(), 'utf8'));
      }
    }
    const plan = JSON.parse(await readFile(join(temporary, 'import/import-plan.json'), 'utf8'));
    assert.equal(plan.storage, 'd1');assert.deepEqual(plan.objects, []);
    assert.ok(plan.maxStatementBytes < 90000);
  } finally {
    database?.close();await rm(temporary, {recursive:true, force:true});
  }
});

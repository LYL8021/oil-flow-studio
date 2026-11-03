import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('cloud migration preserves SQLite records, R2 snapshots and historical API content; rejects incomplete and changing sources', async () => {
  await promisify(execFile)('python3', [new URL('./cloud_migration_checks.py', import.meta.url).pathname], {
    cwd:new URL('..', import.meta.url).pathname
  });
});

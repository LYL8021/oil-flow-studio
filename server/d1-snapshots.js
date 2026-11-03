/* D1-only immutable JSON snapshots for accounts without R2 billing enabled.
 * Text chunks avoid D1's BLOB-to-JavaScript-number-array expansion. A native
 * UTF-8 encode measures only one small chunk at a time; no full binary copy is
 * retained. Migrations own both tables; request handling never creates them.
 */
const MAX_SNAPSHOT_BYTES = 24 * 1024 * 1024;
const CHUNK_CODE_UNITS = 256 * 1024;
const MAX_CHUNKS = 1024;

function snapshotError(code, message, status = 503) {
  return Object.assign(new Error(message), {code, status});
}

function snapshotKey(key) {
  if (typeof key !== 'string' || !key || key.length > 1024 || /[\u0000-\u001f]/.test(key)) {
    throw snapshotError('invalid-snapshot-key', '圖面版本識別碼無效。', 400);
  }
  return key;
}

function snapshotChunks(value) {
  if (typeof value !== 'string' || /[\uD800-\uDFFF]/u.test(value)) {
    throw snapshotError('invalid-snapshot', '圖面版本必須是有效的 UTF-8 文字。', 400);
  }
  const tooLarge = () => snapshotError('too-large', '圖面超過 24 MB，請縮小底圖或匯出 JSON 備份。', 413);
  if (value.length > MAX_SNAPSHOT_BYTES) throw tooLarge();
  const chunks = [], encoder = new TextEncoder();
  let byteLength = 0;
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + CHUNK_CODE_UNITS, value.length);
    // Keep supplementary characters (for example emoji) in a single SQL value.
    if (end < value.length && value.charCodeAt(end - 1) >= 0xD800 && value.charCodeAt(end - 1) <= 0xDBFF
        && value.charCodeAt(end) >= 0xDC00 && value.charCodeAt(end) <= 0xDFFF) end--;
    const body = value.slice(start, end);
    byteLength += encoder.encode(body).byteLength;
    if (byteLength > MAX_SNAPSHOT_BYTES) throw tooLarge();
    chunks.push(body);
    start = end;
  }
  if (!chunks.length) chunks.push('');
  return {chunks, byteLength};
}

/** The get/put/delete subset used by drawings-worker; existing R2 wins upstream. */
export function createD1SnapshotStore(database) {
  if (!database?.prepare || !database?.batch) throw new TypeError('A D1 database binding is required');

  async function get(key) {
    snapshotKey(key);
    const header = await database.prepare('SELECT byte_length, chunk_count FROM drawing_snapshot_objects WHERE object_key = ?').bind(key).first();
    if (!header) return null;
    if (!Number.isSafeInteger(header.byte_length) || header.byte_length < 0 || header.byte_length > MAX_SNAPSHOT_BYTES
        || !Number.isSafeInteger(header.chunk_count) || header.chunk_count < 1 || header.chunk_count > MAX_CHUNKS) {
      throw snapshotError('snapshot-incomplete', '圖面版本資料不完整，請稍後重試。');
    }
    const result = await database.prepare('SELECT chunk_index, body, length(CAST(body AS BLOB)) AS byte_length FROM drawing_snapshot_chunks WHERE object_key = ? ORDER BY chunk_index').bind(key).all();
    const rows = result.results || [];
    if (rows.length !== header.chunk_count || rows.some((row, index) => row.chunk_index !== index || typeof row.body !== 'string')
        || rows.reduce((sum, row) => sum + Number(row.byte_length), 0) !== header.byte_length) {
      throw snapshotError('snapshot-incomplete', '圖面版本資料不完整，請稍後重試。');
    }
    const body = rows.map(row => row.body).join('');
    return {key, size:header.byte_length, text:async () => body, json:async () => JSON.parse(body)};
  }

  async function put(key, value) {
    snapshotKey(key);
    const {chunks, byteLength} = snapshotChunks(value);
    const statements = [database.prepare('INSERT INTO drawing_snapshot_objects (object_key, byte_length, chunk_count, created_at) VALUES (?, ?, ?, ?)')
      .bind(key, byteLength, chunks.length, Date.now())];
    chunks.forEach((body, index) => statements.push(database.prepare('INSERT INTO drawing_snapshot_chunks (object_key, chunk_index, body) VALUES (?, ?, ?)')
      .bind(key, index, body)));
    try {
      // The header and every chunk become visible together, including on retries.
      await database.batch(statements);
    } catch (error) {
      // An identical concurrent write or a response lost after COMMIT is safe.
      // Never replace an existing immutable snapshot with different content.
      let existing;
      try { existing = await get(key); } catch { throw error; }
      if (!existing) throw error;
      if (existing.size !== byteLength || await existing.text() !== value) {
        throw snapshotError('snapshot-conflict', '圖面版本已存在且內容不同，尚未儲存。');
      }
    }
    return {key, size:byteLength};
  }

  async function remove(keyOrKeys) {
    const keys = [...new Set((Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]).map(snapshotKey))];
    if (!keys.length) return;
    const statements = [];
    for (const key of keys) {
      // Explicit child deletion is portable to SQLite test/migration adapters too.
      statements.push(database.prepare('DELETE FROM drawing_snapshot_chunks WHERE object_key = ?').bind(key));
      statements.push(database.prepare('DELETE FROM drawing_snapshot_objects WHERE object_key = ?').bind(key));
    }
    await database.batch(statements);
  }

  return {get, put, delete:remove};
}

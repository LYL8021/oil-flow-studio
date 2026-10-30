/* Anonymous shared suggestions; D1 schema is installed by deployment migrations. */
const MAX_BODY_BYTES = 16384;
const MAX_LIST_SIZE = 200;
const PRODUCTION_ORIGIN = 'https://oil-flow-studio.vercel.app';
const CATEGORIES = new Set(['idea', 'bug', 'ui', 'other']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = 'id, name, title, category, body, created_at';

function allowedOrigin(origin, serviceOrigin) {
  if (!origin) return true;
  if (origin === 'null') return true; // The downloadable file:// editor is also anonymous.
  if (origin === PRODUCTION_ORIGIN || origin === serviceOrigin) return true;
  try {
    const url = new URL(origin);
    return url.origin === origin && ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

function responseHeaders(origin, allowed = true) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  });
  if (origin && allowed) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function reply(data, status, origin, allowed = true) {
  return new Response(JSON.stringify(data), {status, headers:responseHeaders(origin, allowed)});
}

function inputError(message, status = 400) {
  const error = new Error(message);error.status = status;return error;
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
    throw inputError('請使用 JSON 格式送出建議。', 415);
  }
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    throw inputError('建議內容過長，請縮短後再送出。', 413);
  }
  if (!request.body) throw inputError('請填寫建議內容。');
  const reader = request.body.getReader();
  const chunks = [];let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw inputError('建議內容過長，請縮短後再送出。', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset);offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { throw inputError('建議格式無法讀取，請重新送出。'); }
}

function textField(value, name, minimum, maximum, optional = false) {
  if (value == null && optional) return '';
  if (typeof value !== 'string') throw inputError(`請填寫${name}。`);
  const text = value.replace(/\r\n?/g, '\n').trim();
  const length = Array.from(text).length;
  if (length < minimum || length > maximum) {
    throw inputError(`${name}需為 ${minimum} 到 ${maximum} 個字。`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(text)) {
    throw inputError(`${name}包含無法使用的字元。`);
  }
  return text;
}

function suggestionInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw inputError('請填寫建議內容。');
  if (typeof value.requestId !== 'string' || !UUID.test(value.requestId)) {
    throw inputError('送出識別碼無效，請重新開啟建議區後再試。');
  }
  if (value.website != null && (typeof value.website !== 'string' || value.website.trim())) {
    throw inputError('無法送出這份建議，請重新填寫。');
  }
  const category = value.category == null ? 'idea' : value.category;
  if (!CATEGORIES.has(category)) throw inputError('請選擇有效的建議類型。');
  return {
    id:value.requestId.toLowerCase(),
    name:textField(value.name, '稱呼', 0, 40, true),
    title:textField(value.title, '主旨', 1, 80),
    category,
    body:textField(value.body, '建議內容', 1, 3000)
  };
}

function publicItem(row) {
  return {id:row.id, name:row.name, title:row.title, category:row.category,
    body:row.body, createdAt:Number(row.created_at)};
}

function sameSuggestion(row, input) {
  return ['name', 'title', 'category', 'body'].every(field => row[field] === input[field]);
}

function listOptions(url) {
  const rawLimit = url.searchParams.get('limit');
  if (rawLimit != null && (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > MAX_LIST_SIZE)) {
    throw inputError('每頁建議數量須介於 1 到 200。');
  }
  const limit = rawLimit == null ? MAX_LIST_SIZE : Number(rawLimit);
  const rawCursor = url.searchParams.get('cursor');
  if (!rawCursor) return {limit, cursor:null};
  const split = rawCursor.indexOf('.');
  const time = rawCursor.slice(0, split), id = rawCursor.slice(split + 1);
  if (split < 1 || !/^\d+$/.test(time) || !Number.isSafeInteger(Number(time))
      || Number(time) < 0 || !UUID.test(id)) throw inputError('建議清單的分頁位置無效，請重新整理。');
  return {limit, cursor:{time:Number(time), id:id.toLowerCase()}};
}

async function listSuggestions(db, url) {
  const {limit, cursor} = listOptions(url);
  const statement = cursor
    ? db.prepare(`SELECT ${FIELDS} FROM feedback WHERE created_at < ? OR (created_at = ? AND id < ?) ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(cursor.time, cursor.time, cursor.id, limit + 1)
    : db.prepare(`SELECT ${FIELDS} FROM feedback ORDER BY created_at DESC, id DESC LIMIT ?`).bind(limit + 1);
  const result = await statement.all();
  const count = await db.prepare('SELECT COUNT(*) AS total FROM feedback').first();
  const rows = Array.isArray(result.results) ? result.results : [];
  const items = rows.slice(0, limit).map(publicItem);
  const last = items.at(-1);
  return {items, total:Number(count?.total || 0),
    nextCursor:rows.length > limit && last ? `${last.createdAt}.${last.id}` : null};
}

async function saveSuggestion(db, input) {
  const result = await db.prepare('INSERT INTO feedback (id, name, title, category, body, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
    .bind(input.id, input.name, input.title, input.category, input.body, Date.now()).run();
  const row = await db.prepare(`SELECT ${FIELDS} FROM feedback WHERE id = ?`).bind(input.id).first();
  if (!row) throw new Error('storage-write-failed');
  if (!sameSuggestion(row, input)) throw inputError('這次送出的識別碼已使用，請重新開啟建議區再送出新內容。', 409);
  return {item:publicItem(row), duplicate:result.meta?.changes === 0};
}

async function authorizedMaintenance(request, secret) {
  if (typeof secret !== 'string' || !secret || secret.length > 1024) return false;
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization') || '');
  const provided = match?.[1] || '';
  if (provided.length > 1024) return false;
  // Compare fixed-size digests without an early return on differing bytes.
  const encoder = new TextEncoder();
  const [expected, received] = await Promise.all([secret, provided]
    .map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const a = new Uint8Array(expected), b = new Uint8Array(received);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), origin = request.headers.get('Origin');
    const allowed = allowedOrigin(origin, url.origin);
    if (!allowed) return reply({error:'此來源無法使用建議服務。'}, 403, origin, false);
    if (request.method === 'GET' && url.pathname === '/') {
      return reply({service:'油路工坊修改建議', api:'/api/feedback'}, 200, origin);
    }
    const maintenance = /^\/api\/feedback\/([^/]+)\/?$/.exec(url.pathname);
    if (url.pathname !== '/api/feedback' && url.pathname !== '/api/feedback/' && !maintenance) {
      return reply({error:'找不到這個服務。'}, 404, origin);
    }
    if (request.method === 'OPTIONS') {
      const method = request.headers.get('Access-Control-Request-Method');
      const methods = maintenance ? ['DELETE'] : ['GET', 'POST'];
      if (method && !methods.includes(method)) return reply({error:'不支援此操作。'}, 405, origin);
      const headers = responseHeaders(origin);
      headers.set('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
      headers.set('Access-Control-Allow-Headers', maintenance ? 'Authorization' : 'Content-Type');
      headers.set('Access-Control-Max-Age', '600');
      return new Response(null, {status:204, headers});
    }
    if (maintenance) {
      if (request.method !== 'DELETE') return reply({error:'不支援此操作。'}, 405, origin);
      if (!await authorizedMaintenance(request, env?.FEEDBACK_ADMIN_KEY)) {
        return reply({error:'無法執行此維護操作。'}, 403, origin);
      }
      if (!UUID.test(maintenance[1])) return reply({error:'建議識別碼無效。'}, 400, origin);
      if (!env?.DB?.prepare) return reply({error:'建議區尚在設定，請稍後再試。'}, 503, origin);
      try {
        const id=maintenance[1].toLowerCase();
        const result=await env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run();
        return result.meta?.changes
          ? reply({id, deleted:true}, 200, origin)
          : reply({error:'找不到這份建議。'}, 404, origin);
      } catch { return reply({error:'建議區暫時無法使用，請稍後再試。'}, 503, origin); }
    }
    if (!['GET', 'POST'].includes(request.method)) {
      const response = reply({error:'不支援此操作。'}, 405, origin);response.headers.set('Allow', 'GET, POST, OPTIONS');return response;
    }
    if (!env?.DB?.prepare) return reply({error:'建議區尚在設定，請稍後再試。'}, 503, origin);
    try {
      if (request.method === 'GET') return reply(await listSuggestions(env.DB, url), 200, origin);
      const input = suggestionInput(await readJson(request));
      const result = await saveSuggestion(env.DB, input);
      return reply(result, result.duplicate ? 200 : 201, origin);
    } catch (error) {
      return reply({error:error.status ? error.message : '建議區暫時無法使用，請稍後再試。'}, error.status || 503, origin);
    }
  }
};

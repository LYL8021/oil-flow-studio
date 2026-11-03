/* Shared drawings: D1 owns revisions; immutable JSON snapshots live in R2. */
export const MAX_DRAWING_BODY_BYTES = 24 * 1024 * 1024;
const MAX_LIST = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const PORTS = {text:[],point:['joint'],pipe:['in','out'],cap:['in'],flowmeter:['in','out'],tank:['in','out','out2'],
  ground:['port'],valve:['in','out'],elbow:['in','out'],filter:['in','out'],junction:['in','out','branch'],
  cross:['in','out','branch','top'],outlet:['in']};
const COLUMNS = 'id, name, revision, created_at, updated_at, node_count, edge_count, operation_count, object_key';
const VERSION_COLUMNS = 'drawing_id AS id, name, revision, created_at, updated_at, node_count, edge_count, operation_count, object_key, request_id, request_hash';

function problem(code, message, status = 400) { return Object.assign(new Error(message), {code, status}); }
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const validId = value => typeof value === 'string' && SAFE_ID.test(value);
const position = point => plain(point) && Number.isFinite(point.x) && Number.isFinite(point.y)
  && Math.abs(point.x) <= 40000 && Math.abs(point.y) <= 40000;
const tankModes = new Set(['inlet','outlet','closed']);
const validTankModes = value => plain(value) && tankModes.has(value.in) && tankModes.has(value.out)
  && (value.out2 === undefined || tankModes.has(value.out2));

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw problem('invalid-id', '圖面識別碼無效，請重新開啟共用圖面庫。');
  return value.toLowerCase();
}

function drawingName(value) {
  if (typeof value !== 'string') throw problem('invalid-name', '請輸入圖面名稱。');
  const name = value.trim().replace(/\s+/gu, ' ');
  if (!name || Array.from(name).length > 80 || /[\u0000-\u001f\ufffe\uffff]/.test(name)) {
    throw problem('invalid-name', '圖面名稱需為 1 到 80 個字。');
  }
  return {name, key:name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()};
}

function validateProject(project) {
  const bad = message => { throw problem('invalid-project', message); };
  if (!plain(project) || !Array.isArray(project.nodes) || !Array.isArray(project.edges)
      || project.nodes.length > 400 || project.edges.length > 1600) bad('圖面最多支援 400 個元件與 1600 段油管。');
  const nodes = new Map();
  for (const node of project.nodes) {
    if (!position(node) || !validId(node.id) || nodes.has(node.id) || !Object.hasOwn(PORTS, node.type)) bad('元件資料不完整、重複或超出位置範圍。');
    if (node.scale !== undefined && (!Number.isFinite(node.scale) || node.scale < .25 || node.scale > (node.type === 'tank' ? 30 : 4))) bad('元件大小超出範圍。');
    if (node.rotation !== undefined && !Number.isFinite(node.rotation)) bad('元件旋轉角度無效。');
    if (node.type === 'tank') {
      if (node.portCount !== undefined && ![2,3].includes(node.portCount)) bad('油槽接管口數須為 2 或 3。');
      for (const angle of ['inAngle', 'outAngle', 'out2Angle']) if (node[angle] !== undefined && !Number.isFinite(node[angle])) bad('油槽管口方位無效。');
      if (node.portModes !== undefined && !validTankModes(node.portModes)) bad('油槽管口用途無效。');
    }
    if (node.type === 'ground' && node.flowMode !== undefined && !['source','receive','idle'].includes(node.flowMode)) bad('出入土端來油模式無效。');
    nodes.set(node.id, node);
  }
  const edges = new Set(), caps = new Map();
  const endpoint = ep => plain(ep) && nodes.has(ep.node) && PORTS[nodes.get(ep.node).type].includes(ep.port)
    && !(nodes.get(ep.node).type === 'tank' && ep.port === 'out2' && nodes.get(ep.node).portCount !== 3);
  for (const edge of project.edges) {
    if (!plain(edge) || !validId(edge.id) || edges.has(edge.id) || !endpoint(edge.from) || !endpoint(edge.to)
        || edge.from.node === edge.to.node) bad('油管接點無效或有重複編號。');
    if (edge.waypoints !== undefined && (!Array.isArray(edge.waypoints) || edge.waypoints.length > 100
        || edge.waypoints.some(point => !position(point)))) bad('油管轉折點無效或超出範圍。');
    for (const ep of [edge.from, edge.to]) if (nodes.get(ep.node).type === 'cap') {
      const count = (caps.get(ep.node) || 0) + 1;
      if (count > 1) bad('盲封只能連接一段油管。');
      caps.set(ep.node, count);
    }
    edges.add(edge.id);
  }
  if (project.reference != null) {
    const r = project.reference;
    if (!plain(r) || typeof r.dataUrl !== 'string' || r.dataUrl.length > 3.5e6
        || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(r.dataUrl)
        || !Number.isFinite(r.width) || r.width < 1 || r.width > 30000
        || !Number.isFinite(r.height) || r.height < 1 || r.height > 30000) bad('圖片底圖資料無效或超過範圍。');
    for (const axis of ['x','y']) if (r[axis] !== undefined && (!Number.isFinite(r[axis]) || Math.abs(r[axis]) > 40000)) bad('圖片底圖位置超出範圍。');
    let baseWidth = r.baseWidth, baseHeight = r.baseHeight;
    if (baseWidth == null && baseHeight == null) {
      const factor = Math.min(1, 3000 / Math.max(r.width, r.height));
      baseWidth = r.width * factor; baseHeight = r.height * factor;
    }
    if (!Number.isFinite(baseWidth) || baseWidth < 1 || baseWidth > 3000
        || !Number.isFinite(baseHeight) || baseHeight < 1 || baseHeight > 3000) bad('圖片底圖原始尺寸無效。');
    const ratioX = r.width / baseWidth, ratioY = r.height / baseHeight;
    if (Math.abs(ratioX - ratioY) > 1e-6 * Math.max(1, ratioX, ratioY)) bad('圖片底圖尺寸與顯示比例不符。');
  }
  if (project.operations !== undefined) {
    if (!Array.isArray(project.operations) || project.operations.length > 100) bad('每張圖面最多支援 100 項作業。');
    const ids = new Set(), names = new Set();
    for (const operation of project.operations) {
      if (!plain(operation) || !validId(operation.id) || ids.has(operation.id) || typeof operation.name !== 'string'
          || !operation.name.trim() || Array.from(operation.name).length > 80
          || typeof operation.signature !== 'string' || !operation.signature.startsWith('topology-v1:')
          || operation.signature.length > 1e6 || !Array.isArray(operation.valves) || operation.valves.length > 400
          || operation.valves.some(v => !plain(v) || !validId(v.id) || typeof v.open !== 'boolean')) bad('作業配置資料無效。');
      const nameKey = operation.name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
      if (names.has(nameKey)) bad('圖面有重複的作業名稱。');
      names.add(nameKey);
      try {
        const topology = JSON.parse(operation.signature.slice('topology-v1:'.length));
        if (!plain(topology) || !Array.isArray(topology.nodes) || !Array.isArray(topology.edges)) throw new Error();
      } catch { bad('作業的管線圖識別資料無效。'); }
      if (new Set(operation.valves.map(v => v.id)).size !== operation.valves.length) bad('作業的閥門編號重複。');
      for (const field of ['createdAt','updatedAt']) if (operation[field] !== undefined
          && (!Number.isFinite(operation[field]) || operation[field] < 0)) bad('作業儲存時間無效。');
      if (operation.sources !== undefined && (!Array.isArray(operation.sources) || operation.sources.length > 400
          || operation.sources.some(s => !plain(s) || !validId(s.id) || !['tank','ground'].includes(s.type)
            || typeof s.enabled !== 'boolean' || (s.type === 'tank'
              ? !validTankModes(s.portModes)
              : !['source','receive','idle'].includes(s.flowMode) || s.enabled !== (s.flowMode === 'source'))))) bad('作業油源配置資料無效。');
      if (operation.sources && new Set(operation.sources.map(s => s.id)).size !== operation.sources.length) bad('作業的油源編號重複。');
      ids.add(operation.id);
    }
  }
  return project;
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw problem('content-type', '請使用 JSON 格式儲存圖面。', 415);
  const declared = request.headers.get('Content-Length');
  if (declared && Number(declared) > MAX_DRAWING_BODY_BYTES) throw problem('too-large', '圖面超過 24 MB，請縮小底圖或匯出 JSON 備份。', 413);
  if (!request.body) throw problem('invalid-project', '請提供要儲存的圖面。');
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', {fatal:true});
  const chunks = [];let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DRAWING_BODY_BYTES) { await reader.cancel(); throw problem('too-large', '圖面超過 24 MB，請縮小底圖或匯出 JSON 備份。', 413); }
      chunks.push(decoder.decode(value, {stream:true}));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join(''));
  } catch (error) {
    if (error.status) throw error;
    throw problem('invalid-json', '圖面格式無法讀取，尚未儲存。');
  } finally { reader.releaseLock(); }
}

function metadata(row) {
  return {id:row.id, name:row.name, revision:Number(row.revision), createdAt:Number(row.created_at),
    updatedAt:Number(row.updated_at), nodeCount:Number(row.node_count), edgeCount:Number(row.edge_count),
    operationCount:Number(row.operation_count)};
}

async function record(bucket, row) {
  if (!row) throw problem('not-found', '找不到這張共用圖面，請重新整理清單。', 404);
  const object = await bucket.get(row.object_key);
  if (!object) throw problem('storage-unavailable', '圖面檔案暫時無法讀取，請稍後重試。', 503);
  let project;
  try { project = JSON.parse(await object.text()); }
  catch { throw problem('storage-unavailable', '圖面檔案暫時無法讀取，請稍後重試。', 503); }
  return {...metadata(row), project};
}

function listLimit(url) {
  const raw = url.searchParams.get('limit');
  if (raw != null && (!/^\d+$/.test(raw) || !positive(Number(raw)) || Number(raw) > MAX_LIST)) throw problem('invalid-page', '每頁圖面數量須介於 1 到 100。');
  return raw == null ? MAX_LIST : Number(raw);
}

async function listDrawings(db, url) {
  const limit = listLimit(url), cursor = url.searchParams.get('cursor');
  let result;
  if (cursor) {
    const match = /^(\d+)\.([0-9a-f-]+)$/i.exec(cursor);
    if (!match || !Number.isSafeInteger(Number(match[1])) || !UUID.test(match[2])) throw problem('invalid-page', '圖面清單位置無效，請重新整理。');
    result = await db.prepare(`SELECT ${COLUMNS} FROM drawings WHERE updated_at < ? OR (updated_at = ? AND id < ?) ORDER BY updated_at DESC, id DESC LIMIT ?`)
      .bind(Number(match[1]), Number(match[1]), match[2].toLowerCase(), limit + 1).all();
  } else result = await db.prepare(`SELECT ${COLUMNS} FROM drawings ORDER BY updated_at DESC, id DESC LIMIT ?`).bind(limit + 1).all();
  const count = await db.prepare('SELECT COUNT(*) AS total FROM drawings').first();
  const rows = result.results || [], items = rows.slice(0, limit).map(metadata), last = items.at(-1);
  return {items, total:Number(count?.total || 0), nextCursor:rows.length > limit && last ? `${last.updatedAt}.${last.id}` : null};
}

async function listRevisions(db, id, url) {
  const exists = await db.prepare('SELECT id FROM drawings WHERE id = ?').bind(id).first();
  if (!exists) throw problem('not-found', '找不到這張共用圖面。', 404);
  const limit = listLimit(url), cursor = url.searchParams.get('cursor');
  if (cursor != null && (!/^\d+$/.test(cursor) || !positive(Number(cursor)))) throw problem('invalid-page', '歷史版本位置無效。');
  const result = cursor
    ? await db.prepare(`SELECT ${VERSION_COLUMNS} FROM drawing_revisions WHERE drawing_id = ? AND revision < ? ORDER BY revision DESC LIMIT ?`).bind(id, Number(cursor), limit + 1).all()
    : await db.prepare(`SELECT ${VERSION_COLUMNS} FROM drawing_revisions WHERE drawing_id = ? ORDER BY revision DESC LIMIT ?`).bind(id, limit + 1).all();
  const count = await db.prepare('SELECT COUNT(*) AS total FROM drawing_revisions WHERE drawing_id = ?').bind(id).first();
  const rows = result.results || [], items = rows.slice(0, limit).map(metadata);
  return {items, total:Number(count?.total || 0), nextCursor:rows.length > limit ? String(items.at(-1).revision) : null};
}

async function requestHash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function priorRequest(db, requestId, hash) {
  const previous = await db.prepare(`SELECT ${VERSION_COLUMNS} FROM drawing_revisions WHERE request_id = ?`).bind(requestId).first();
  if (previous && previous.request_hash !== hash) throw problem('request-conflict', '這次儲存識別碼已用於不同內容，請重新儲存。', 409);
  return previous;
}

// Never delete an uncertain snapshot after a network/transaction failure: a commit
// may already reference it. Only verified unreferenced objects can be removed.
async function discardUnreferenced(db, bucket, key) {
  try {
    const row = await db.prepare('SELECT object_key FROM drawing_revisions WHERE object_key = ?').bind(key).first();
    if (!row) await bucket.delete(key);
  } catch { /* A harmless orphan is preferable to deleting a committed drawing. */ }
}

async function saveDrawing(env, input) {
  if (!plain(input)) throw problem('invalid-project', '請提供要儲存的圖面。');
  const requestId = uuid(input.requestId), id = input.id === undefined ? requestId : uuid(input.id);
  const creating = input.id === undefined;
  if (creating ? input.expectedRevision !== undefined : !positive(input.expectedRevision)) throw problem('invalid-revision', '請先載入最新圖面，再儲存更新。');
  const named = drawingName(input.name), project = validateProject(input.project);
  const hash = await requestHash({id:creating ? null : id, expectedRevision:input.expectedRevision ?? null, name:named.name, project});
  const {DB:db, BUCKET:bucket} = env;
  const duplicate = await priorRequest(db, requestId, hash);
  if (duplicate) return {item:await record(bucket, duplicate), duplicate:true, created:false};
  const previous = await db.prepare(`SELECT ${COLUMNS} FROM drawings WHERE id = ?`).bind(id).first();
  if (creating ? !!previous : !previous || previous.revision !== input.expectedRevision) throw problem('conflict', '此圖面已由其他人更新。請另存目前畫布，或載入最新版本後再修改。', 409);
  const existingName = await db.prepare('SELECT id FROM drawings WHERE name_key = ?').bind(named.key).first();
  if (existingName && existingName.id !== id) throw problem('name-exists', '共用圖面庫已有同名圖面，請使用另一個名稱。', 409);
  const revision = (previous?.revision || 0) + 1, now = Math.max(Date.now(), (previous?.updated_at || 0) + 1);
  const createdAt = previous?.created_at ?? now, objectKey = `drawings/${id}/${revision}/${requestId}-${hash}.json`;
  const nodeCount = project.nodes.length, edgeCount = project.edges.length, operationCount = project.operations?.length || 0;
  await bucket.put(objectKey, JSON.stringify(project), {httpMetadata:{contentType:'application/json; charset=utf-8'}});
  const revisionStatement = db.prepare(`INSERT INTO drawing_revisions (drawing_id, revision, name, created_at, updated_at, node_count, edge_count, operation_count, object_key, request_id, request_hash) SELECT id, revision, name, created_at, updated_at, node_count, edge_count, operation_count, object_key, ?, ? FROM drawings WHERE id = ? AND revision = ? AND object_key = ?`)
    .bind(requestId, hash, id, revision, objectKey);
  let failure, results;
  try {
    const write = creating
      ? db.prepare('INSERT INTO drawings (id, name, name_key, revision, created_at, updated_at, node_count, edge_count, operation_count, object_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
        .bind(id, named.name, named.key, revision, createdAt, now, nodeCount, edgeCount, operationCount, objectKey)
      : db.prepare('UPDATE drawings SET name = ?, name_key = ?, revision = ?, updated_at = ?, node_count = ?, edge_count = ?, operation_count = ?, object_key = ? WHERE id = ? AND revision = ?')
        .bind(named.name, named.key, revision, now, nodeCount, edgeCount, operationCount, objectKey, id, input.expectedRevision);
    // A colliding request ID must roll back the metadata UPDATE as well.
    // Silently ignoring a version INSERT could leave a head without history.
    results = await db.batch([write, revisionStatement]);
  } catch (error) { failure = error; }
  let saved;
  try { saved = await priorRequest(db, requestId, hash); }
  catch (error) { await discardUnreferenced(db, bucket, objectKey); throw error; }
  if (!saved) {
    await discardUnreferenced(db, bucket, objectKey);
    const sameName = await db.prepare('SELECT id FROM drawings WHERE name_key = ?').bind(named.key).first();
    if (sameName && sameName.id !== id) throw problem('name-exists', '共用圖面庫已有同名圖面，請使用另一個名稱。', 409);
    if (failure) throw failure;
    throw problem('conflict', '此圖面已由其他人更新。請另存目前畫布，或載入最新版本後再修改。', 409);
  }
  const retried = !!failure || results?.[1]?.meta?.changes === 0;
  return {item:{...metadata(saved), project}, duplicate:retried, created:creating && !retried};
}

async function removeDrawing(env, id) {
  const current = await env.DB.prepare('SELECT id FROM drawings WHERE id = ?').bind(id).first();
  if (!current) throw problem('not-found', '找不到這張共用圖面。', 404);
  const versions = await env.DB.prepare('SELECT object_key FROM drawing_revisions WHERE drawing_id = ?').bind(id).all();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM drawing_revisions WHERE drawing_id = ?').bind(id),
    env.DB.prepare('DELETE FROM drawings WHERE id = ?').bind(id)
  ]);
  for (const row of versions.results || []) await env.BUCKET.delete(row.object_key);
  return {id, deleted:true};
}

export async function handleDrawings(request, env, {origin, reply, responseHeaders, authorizedMaintenance}) {
  const url = new URL(request.url), parts = url.pathname.replace(/\/$/, '').split('/');
  const collection = parts.length === 3, item = parts.length === 4, history = parts.length === 5 && parts[4] === 'revisions';
  const version = parts.length === 6 && parts[4] === 'revisions';
  if (!collection && !item && !history && !version) return reply({error:'找不到這個圖面服務。',code:'not-found'}, 404, origin);
  const methods = collection ? ['GET','POST'] : item ? ['GET','DELETE'] : ['GET'];
  if (request.method === 'OPTIONS') {
    const method = request.headers.get('Access-Control-Request-Method');
    if (method && !methods.includes(method)) return reply({error:'不支援此操作。',code:'method'}, 405, origin);
    const headers = responseHeaders(origin);
    headers.set('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '));
    headers.set('Access-Control-Allow-Headers', item ? 'Content-Type, Authorization' : 'Content-Type');
    headers.set('Access-Control-Max-Age', '600');
    return new Response(null, {status:204, headers});
  }
  if (!methods.includes(request.method)) return reply({error:'不支援此操作。',code:'method'}, 405, origin);
  try {
    if (request.method === 'DELETE' && !await authorizedMaintenance(request, env?.FEEDBACK_ADMIN_KEY)) throw problem('forbidden', '無法執行此維護操作。', 403);
    if (!env?.DB?.prepare || !env?.DB?.batch || !env?.BUCKET?.get || !env?.BUCKET?.put) throw problem('unavailable', '共用圖面庫暫時無法連線，請稍後再試；目前畫布仍保留。', 503);
    if (collection) {
      if (request.method === 'GET') return reply(await listDrawings(env.DB, url), 200, origin);
      const result = await saveDrawing(env, await readJson(request));
      return reply({item:result.item, duplicate:result.duplicate}, result.created ? 201 : 200, origin);
    }
    const id = uuid(parts[3]);
    if (request.method === 'DELETE') return reply(await removeDrawing(env, id), 200, origin);
    if (history) return reply(await listRevisions(env.DB, id, url), 200, origin);
    if (version) {
      if (!/^\d+$/.test(parts[5]) || !positive(Number(parts[5]))) throw problem('invalid-revision', '歷史版本編號無效。');
      const row = await env.DB.prepare(`SELECT ${VERSION_COLUMNS} FROM drawing_revisions WHERE drawing_id = ? AND revision = ?`).bind(id, Number(parts[5])).first();
      return reply(await record(env.BUCKET, row), 200, origin);
    }
    const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM drawings WHERE id = ?`).bind(id).first();
    return reply(await record(env.BUCKET, row), 200, origin);
  } catch (error) {
    return reply({error:error.status ? error.message : '共用圖面庫暫時無法連線，請稍後再試；目前畫布仍保留。', code:error.status ? error.code : 'unavailable'}, error.status || 503, origin);
  }
}

// Cloud records remain remote; a failed request never substitutes browser-only data.
const CLOUD_DRAWINGS_ORIGIN = 'https://oil-flow-studio.lililinomj330223.workers.dev';
const CLOUD_DRAWING_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOUD_DRAWING_MAX_BYTES = 24 * 1024 * 1024;

export function createCloudProjectStore(options = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 45000;
  let endpoint = null, pendingSubmission = null;
  try {
    const url = new URL(options.apiBase ?? CLOUD_DRAWINGS_ORIGIN);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      endpoint = url.origin + url.pathname.replace(/\/+$/, '') + '/api/drawings';
    }
  } catch {}

  function problem(code, message, cause, status) {
    const error = new Error(message);
    error.name = 'ProjectStoreError';error.code = code;
    if (cause) error.cause = cause;
    if (status) error.status = status;
    return error;
  }
  const invalidData = () => problem('invalid-data', '共用圖面資料暫時無法讀取，請重新整理清單。');
  function remoteId(id) {
    if (typeof id !== 'string') throw problem('not-found', '請重新選擇一張共用圖面。');
    const raw = id.startsWith('cloud:') ? id.slice(6) : id;
    if (!CLOUD_DRAWING_UUID.test(raw)) throw problem('not-found', '請重新選擇一張共用圖面。');
    return raw.toLowerCase();
  }
  function revisionNumber(revision) {
    if (!Number.isSafeInteger(revision) || revision < 1) throw problem('invalid-revision', '請重新選擇圖面版本。');
    return revision;
  }
  function metadata(value) {
    if (!value || typeof value !== 'object' || !CLOUD_DRAWING_UUID.test(value.id || '')
        || typeof value.name !== 'string' || !value.name.trim() || Array.from(value.name).length > 80
        || !Number.isSafeInteger(value.revision) || value.revision < 1
        || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0
        || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < value.createdAt
        || ['nodeCount', 'edgeCount', 'operationCount'].some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)) {
      throw invalidData();
    }
    return {id:'cloud:' + value.id.toLowerCase(), scope:'cloud', name:value.name, revision:value.revision,
      createdAt:value.createdAt, updatedAt:value.updatedAt, nodeCount:value.nodeCount,
      edgeCount:value.edgeCount, operationCount:value.operationCount};
  }
  function record(value) {
    value = value?.item ?? value;
    const data = metadata(value);
    if (!value.project || typeof value.project !== 'object' || !Array.isArray(value.project.nodes)
        || !Array.isArray(value.project.edges)) throw invalidData();
    return {...data, project:structuredClone(value.project)};
  }
  async function request(path = '', {method = 'GET', body} = {}) {
    if (!endpoint || typeof fetcher !== 'function') throw problem('unavailable', '共用圖面服務正在準備中，請稍後再試。');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(endpoint + path, {method, mode:'cors', credentials:'omit', cache:'no-store',
        signal:controller.signal, ...(body !== undefined ? {headers:{'Content-Type':'application/json'}, body} : {})});
      let data;
      try { data = await response.json(); }
      catch (error) { throw problem('invalid-data', '共用服務的回應暫時無法讀取，請重試；目前畫布仍保留。', error, response.status); }
      if (!response.ok) {
        throw problem(typeof data?.code === 'string' ? data.code : response.status === 409 ? 'conflict' : 'unavailable',
          typeof data?.error === 'string' && data.error ? data.error : '共用圖面服務暫時無法使用，請稍後重試。', undefined, response.status);
      }
      return data;
    } catch (error) {
      if (error?.name === 'ProjectStoreError') throw error;
      if (controller.signal.aborted || error?.name === 'AbortError') {
        throw problem('timeout', '連線較久，請稍後重試；目前畫布與待儲存內容仍保留。', error);
      }
      throw problem('network', '無法連線至共用圖面庫，請確認網路後重試；目前畫布仍保留。', error);
    } finally { clearTimeout(timer); }
  }
  async function collect(path) {
    const items = new Map(), seen = new Set();let cursor = null;
    do {
      const page = await request(path + '?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      if (!page || !Array.isArray(page.items) || page.items.length > 100 || !Number.isSafeInteger(page.total)
          || page.total < page.items.length || (page.nextCursor != null && (typeof page.nextCursor !== 'string'
            || !page.nextCursor || page.nextCursor.length > 200))) throw invalidData();
      for (const raw of page.items) {
        const item = metadata(raw), key = path ? item.revision : item.id;
        if (items.has(key)) throw invalidData();
        items.set(key, item);
      }
      cursor = page.nextCursor || null;
      if (cursor) {
        if (seen.has(cursor) || seen.size >= 1000) throw invalidData();
        seen.add(cursor);
      }
    } while (cursor);
    return [...items.values()];
  }
  return {
    list:() => collect(''),
    get:async id => record(await request('/' + remoteId(id))),
    revisions:id => collect('/' + remoteId(id) + '/revisions'),
    getRevision:async (id, revision) => record(await request('/' + remoteId(id) + '/revisions/' + revisionNumber(revision))),
    async save({id, name, project, expectedRevision} = {}) {
      if (typeof name !== 'string' || !name.trim() || Array.from(name.trim()).length > 80) {
        throw problem('invalid-name', '圖面名稱需為 1 到 80 個字。');
      }
      if (!project || typeof project !== 'object' || !Array.isArray(project.nodes) || !Array.isArray(project.edges)) {
        throw problem('invalid-project', '圖面需要有效的元件與管線資料。');
      }
      if (id === undefined && expectedRevision !== undefined) throw problem('conflict', '請重新選擇要更新的共用圖面。');
      const value = {name:name.trim().replace(/\s+/gu, ' '), project,
        ...(id !== undefined ? {id:remoteId(id), expectedRevision:revisionNumber(expectedRevision)} : {})};
      let key;
      try { key = JSON.stringify(value); }
      catch (error) { throw problem('invalid-project', '圖面資料無法儲存，請先匯出 JSON 備份。', error); }
      if (!pendingSubmission || pendingSubmission.key !== key) {
        pendingSubmission = {key, requestId:crypto.randomUUID()};
      }
      const pending = pendingSubmission;
      const body = JSON.stringify({...value, requestId:pending.requestId});
      if (new TextEncoder().encode(body).byteLength > CLOUD_DRAWING_MAX_BYTES) {
        throw problem('too-large', '共用圖面超過 24 MB，請縮小參考底圖後再儲存；目前畫布仍保留。');
      }
      try {
        const saved = record(await request('', {method:'POST', body}));
        if (pendingSubmission === pending) pendingSubmission = null;
        return saved;
      } catch (error) {
        // Network, timeout, 5xx, or a malformed success may have committed the write.
        // Retrying the same snapshot must use the same server idempotency key.
        if (error.status >= 400 && error.status < 500 && pendingSubmission === pending) pendingSubmission = null;
        throw error;
      }
    }
  };
}

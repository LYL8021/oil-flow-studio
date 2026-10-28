// Named drawings stay in this browser. IndexedDB also keeps reference images
// without consuming the small localStorage allowance used by the working draft.
export function createProjectStore(options = {}) {
  const databaseName = options.databaseName || 'oil-flow-projects-v1';
  const storeName = 'projects';
  let databasePromise;

  function problem(code, message, cause) {
    const error = new Error(message);
    error.name = 'ProjectStoreError';
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }

  function storageProblem(error) {
    if (error?.name === 'ProjectStoreError') return error;
    if (error?.name === 'ConstraintError') return problem('name-exists', '已有同名圖面，請使用另一個名稱。', error);
    if (error?.name === 'QuotaExceededError') return problem('quota', '瀏覽器儲存空間不足，請先匯出圖面備份。', error);
    return problem('unavailable', '目前無法存取圖面儲存區，請匯出 JSON 保留設計後再試。', error);
  }

  function drawingName(value) {
    if (typeof value !== 'string') throw problem('invalid-name', '請輸入圖面名稱。');
    const name = value.trim().replace(/\s+/gu, ' ');
    if (!name || Array.from(name).length > 80) throw problem('invalid-name', '圖面名稱需為 1 到 80 個字。');
    const nameKey = name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
    return {name, nameKey};
  }

  function copyProject(project) {
    if (!project || typeof project !== 'object' || !Array.isArray(project.nodes) || !Array.isArray(project.edges)) {
      throw problem('invalid-project', '圖面需要有效的元件與管線資料。');
    }
    try { return structuredClone(project); }
    catch (error) { throw problem('invalid-project', '圖面資料無法儲存，請先匯出 JSON 備份。', error); }
  }

  function checkRecord(record) {
    if (!record || typeof record.id !== 'string' || !record.id || typeof record.name !== 'string' ||
        typeof record.nameKey !== 'string' || !Number.isInteger(record.revision) || record.revision < 1 ||
        !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt) ||
        !record.project || !Array.isArray(record.project.nodes) || !Array.isArray(record.project.edges)) {
      throw problem('invalid-data', '儲存的圖面資料不完整，請保留現有資料並匯出可開啟的圖面備份。');
    }
    return record;
  }

  function metadata(record) {
    checkRecord(record);
    return {id:record.id, name:record.name, createdAt:record.createdAt, updatedAt:record.updatedAt,
      revision:record.revision, nodeCount:record.project.nodes.length, edgeCount:record.project.edges.length};
  }

  function publicRecord(record) {
    return {...metadata(record), project:copyProject(record.project)};
  }

  function checkRevision(record, expectedRevision) {
    if (expectedRevision !== undefined && record.revision !== expectedRevision) {
      throw problem('conflict', '此圖面已在另一個分頁更新。請先另存目前畫布，或載入最新圖面後再修改。');
    }
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    const pending = new Promise((resolve, reject) => {
      let request, settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        databasePromise = undefined;
        reject(storageProblem(error));
      };
      try {
        const factory = options.indexedDB ?? globalThis.indexedDB;
        if (!factory || typeof factory.open !== 'function') throw problem('unavailable', '此瀏覽器無法使用圖面儲存區，請使用 JSON 匯出備份。');
        request = factory.open(databaseName, 1);
      } catch (error) { fail(error); return; }
      request.onupgradeneeded = () => {
        try {
          const database = request.result;
          const store = database.objectStoreNames.contains(storeName)
            ? request.transaction.objectStore(storeName)
            : database.createObjectStore(storeName, {keyPath:'id'});
          if (!store.indexNames.contains('nameKey')) store.createIndex('nameKey', 'nameKey', {unique:true});
        } catch (error) {
          fail(error);
          try { request.transaction.abort(); } catch {}
        }
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(problem('unavailable', '圖面儲存區正被其他分頁占用，請關閉其他油路工坊分頁後再試。'));
      request.onsuccess = () => {
        const database = request.result;
        if (settled) { database.close(); return; }
        try {
          const store = database.transaction(storeName, 'readonly').objectStore(storeName);
          if (!store.indexNames.contains('nameKey') || !store.index('nameKey').unique) throw problem('invalid-data', '儲存區的資料結構不完整，請保留資料並匯出圖面備份。');
          database.onversionchange = () => { database.close(); databasePromise = undefined; };
          settled = true;
          resolve(database);
        } catch (error) { database.close(); fail(error); }
      };
    });
    databasePromise = pending;
    pending.catch(() => { if (databasePromise === pending) databasePromise = undefined; });
    return pending;
  }

  async function transaction(mode, work) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      let tx, result, failure;
      try { tx = database.transaction(storeName, mode); }
      catch (error) { reject(storageProblem(error)); return; }
      const fail = error => {
        failure = storageProblem(error);
        try { tx.abort(); } catch { reject(failure); }
      };
      const read = (request, handler) => {
        request.onerror = () => { failure = storageProblem(request.error); };
        request.onsuccess = () => { try { handler(request.result); } catch (error) { fail(error); } };
      };
      tx.oncomplete = () => failure ? reject(failure) : resolve(result);
      tx.onerror = () => { failure ||= storageProblem(tx.error); };
      tx.onabort = () => reject(failure || storageProblem(tx.error));
      try { work(tx.objectStore(storeName), read, value => { result = value; }); }
      catch (error) { fail(error); }
    });
  }

  function requireId(id) {
    if (typeof id !== 'string' || !id) throw problem('not-found', '找不到這張圖面，請重新開啟儲存區。');
    return id;
  }

  function requireRecord(record, expectedRevision) {
    if (!record) throw problem('not-found', '這張圖面已不存在，請重新開啟儲存區。');
    checkRecord(record);
    checkRevision(record, expectedRevision);
    return record;
  }

  return {
    async list() {
      return transaction('readonly', (store, read, done) => read(store.getAll(), records => {
        done(records.map(metadata).sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name)));
      }));
    },

    async get(id) {
      requireId(id);
      return transaction('readonly', (store, read, done) => read(store.get(id), record => done(publicRecord(requireRecord(record)))));
    },

    async save({id, name, project, expectedRevision} = {}) {
      const named = drawingName(name);
      const snapshot = copyProject(project);
      if (id !== undefined) requireId(id);
      if (id === undefined && expectedRevision !== undefined) throw problem('conflict', '請重新選擇要更新的圖面。');
      return transaction('readwrite', (store, read, done) => {
        const write = previous => {
          const now = previous ? Math.max(Date.now(), previous.updatedAt + 1) : Date.now();
          const record = {id:previous?.id || globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
            ...named, project:snapshot, createdAt:previous?.createdAt ?? now, updatedAt:now, revision:(previous?.revision ?? 0) + 1};
          read(previous ? store.put(record) : store.add(record), () => done(publicRecord(record)));
        };
        if (id === undefined) write(null);
        else read(store.get(id), previous => write(requireRecord(previous, expectedRevision)));
      });
    },

    async rename(id, name, {expectedRevision} = {}) {
      requireId(id);
      const named = drawingName(name);
      return transaction('readwrite', (store, read, done) => read(store.get(id), previous => {
        const record = requireRecord(previous, expectedRevision);
        const next = {...record, ...named, updatedAt:Math.max(Date.now(), record.updatedAt + 1), revision:record.revision + 1};
        read(store.put(next), () => done(publicRecord(next)));
      }));
    },

    async remove(id, {expectedRevision} = {}) {
      requireId(id);
      return transaction('readwrite', (store, read, done) => read(store.get(id), previous => {
        const record = requireRecord(previous, expectedRevision);
        read(store.delete(id), () => done(metadata(record)));
      }));
    }
  };
}

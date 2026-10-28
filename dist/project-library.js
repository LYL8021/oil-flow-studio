import {createProjectStore} from './project-store.js?v=library-1';

export function setupProjectLibrary({getProject, normalizeProject, setProject, setTitle, confirm, notify, downloadProject}) {
  const el = id => document.getElementById(id);
  const dialog = el('projectLibraryDialog');
  const input = el('projectSaveName');
  const store = createProjectStore();
  const nameKey = value => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  let records = [], active = null, renaming = null, busy = false, session = 0;

  function message(text = '', error = false) {
    el('projectLibraryMessage').textContent = text;
    el('projectLibraryMessage').classList.toggle('is-error', error);
  }
  function projectOf(record) {
    return normalizeProject({...record.project, title:record.name});
  }
  function activate(record) {
    session++;
    active = {id:record.id, name:record.name, revision:record.revision, snapshot:JSON.stringify(projectOf(record))};
  }
  function sync() {
    const title = getProject().title || '未命名油路圖';
    el('projectName').textContent = title;
    el('canvasProjectName').textContent = title;
    el('projectLocationTag').textContent = active ? '已命名圖面' : '瀏覽器草稿';
  }
  function detach() {
    session++;
    active = null;
    sync();
  }
  function dirty() {
    const current = normalizeProject(getProject());
    return active ? JSON.stringify(current) !== active.snapshot : !!(current.nodes.length || current.edges.length || current.reference);
  }
  function updateSubmit() {
    const updating = active && nameKey(input.value) === nameKey(active.name);
    el('projectSaveSubmit').textContent = renaming ? '確認改名' : updating ? '更新這張圖面' : '儲存新圖面';
  }
  function resetForm() {
    renaming = null;
    el('projectSaveLabel').textContent = '目前圖面名稱';
    el('cancelProjectRename').hidden = true;
    input.value = getProject().title || '';
    updateSubmit();
  }
  function setBusy(value) {
    busy = value;
    dialog.setAttribute('aria-busy', String(value));
    dialog.querySelectorAll('input, button').forEach(button => { button.disabled = value; });
  }
  async function run(action) {
    if (busy) return;
    setBusy(true);
    try { await action(); }
    catch (error) { message(error.message || '操作失敗，請先匯出 JSON 備份後再試。', true); }
    finally { setBusy(false); }
  }
  function button(label, action, className) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    if (className) node.className = className;
    node.onclick = action;
    return node;
  }
  function renderList() {
    const list = el('projectLibraryList');
    list.replaceChildren();
    el('projectLibraryCount').textContent = `${records.length} 張圖面`;
    if (!records.length) {
      const empty = document.createElement('div');
      empty.className = 'project-library-empty';
      const title = document.createElement('strong');
      title.textContent = '把畫好的油路，留在這裡。';
      const description = document.createElement('p');
      description.textContent = '輸入名稱，例如「輸王田」，按儲存即可建立第一張圖面。';
      empty.append(title, description);
      list.append(empty);
    }
    for (const record of records) {
      const card = document.createElement('div');
      card.className = 'saved-project-card' + (active?.id === record.id ? ' is-current' : '');
      card.dataset.projectId = record.id;
      const open = button('', () => run(() => openSaved(record.id)), 'saved-project-open');
      open.setAttribute('aria-label', `載入圖面 ${record.name}`);
      const name = document.createElement('strong');
      name.textContent = record.name;
      const meta = document.createElement('span');
      meta.className = 'saved-project-meta';
      const date = new Date(record.updatedAt).toLocaleString('zh-TW', {year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
      meta.textContent = `${record.nodeCount} 個元件 · ${record.edgeCount} 段油管 · ${date}${active?.id === record.id ? ' · 目前圖面' : ''}`;
      open.append(name, meta);
      const actions = document.createElement('div');
      actions.className = 'saved-project-actions';
      const rename = button('改名', () => {
        renaming = record;
        el('projectSaveLabel').textContent = '新的圖面名稱';
        el('cancelProjectRename').hidden = false;
        input.value = record.name;
        updateSubmit();
        message(`正在修改「${record.name}」的名稱，畫布內容會保留。`);
        input.focus(); input.select();
      });
      rename.setAttribute('aria-label', `改名圖面 ${record.name}`);
      const exportButton = button('匯出', () => run(async () => {
        const saved = await store.get(record.id);
        downloadProject(projectOf(saved), saved.name);
        message(`已匯出「${saved.name}」JSON 備份。`);
      }));
      exportButton.setAttribute('aria-label', `匯出圖面 ${record.name}`);
      const remove = button('刪除', () => confirm(`刪除「${record.name}」？`, '這張圖面會從儲存區移除。需要保留時，請先匯出 JSON；目前畫布不會被清空。', () => run(async () => {
        const expectedRevision = active?.id === record.id ? active.revision : record.revision;
        await store.remove(record.id, {expectedRevision});
        if (active?.id === record.id) detach();
        if (renaming?.id === record.id) resetForm();
        await refresh();
        message(`已刪除「${record.name}」，目前畫布內容仍保留。`);
      })), 'danger');
      remove.setAttribute('aria-label', `刪除圖面 ${record.name}`);
      actions.append(rename, exportButton, remove);
      card.append(open, actions);
      list.append(card);
    }
  }
  async function refresh() {
    records = await store.list();
    renderList();
  }
  async function openSaved(id) {
    const record = await store.get(id);
    const next = projectOf(record);
    const replace = () => {
      activate(record);
      setProject(next);
      resetForm();
      dialog.close();
      notify(`已載入「${record.name}」`);
    };
    if (dirty()) confirm(`載入「${record.name}」？`, '目前畫布有尚未存入儲存區的內容。載入會取代畫布；若要保留修改，請先取消並儲存圖面。', replace);
    else replace();
  }
  async function saveSnapshot(name, project, target) {
    const record = await store.save({...(target ? {id:target.id, expectedRevision:target.revision} : {}), name, project});
    activate(record);
    setTitle(record.name);
    resetForm();
    await refresh();
    message(`已儲存「${record.name}」。下次從清單點名稱即可載入。`);
    notify(`已儲存「${record.name}」`);
  }
  el('projectSaveForm').onsubmit = event => {
    event.preventDefault();
    run(async () => {
      const name = input.value.trim().replace(/\s+/gu, ' ');
      if (!name) { input.focus(); throw new Error('請輸入圖面名稱，例如「輸王田」。'); }
      if (renaming) {
        const target = renaming;
        const expectedRevision = active?.id === target.id ? active.revision : target.revision;
        const record = await store.rename(target.id, name, {expectedRevision});
        if (active?.id === record.id) { activate(record); setTitle(record.name); }
        resetForm();
        await refresh();
        message(`圖面已改名為「${record.name}」。`);
        return;
      }
      const project = normalizeProject({...getProject(), title:name});
      const current = active && nameKey(name) === nameKey(active.name) ? active : null;
      const existing = records.find(record => nameKey(record.name) === nameKey(name));
      if (!current && existing) {
        confirm(`取代已儲存的「${existing.name}」？`, '儲存區已有同名圖面。確定後，會以目前畫布取代那張圖面的內容；也可以取消並使用其他名稱。', () => run(() => saveSnapshot(name, project, existing)));
      } else await saveSnapshot(name, project, current);
    });
  };
  input.oninput = updateSubmit;
  el('cancelProjectRename').onclick = () => { resetForm(); message(); input.focus(); };
  el('closeProjectLibrary').onclick = () => dialog.close();
  el('projectLibraryDone').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  async function open({focusName = false} = {}) {
    if (busy) return;
    resetForm(); message();
    if (!dialog.open) dialog.showModal();
    await run(refresh);
    if (focusName || !records.length) { input.focus(); input.select(); }
    else el('projectLibraryList').querySelector('.saved-project-open')?.focus();
  }
  el('saveProjectBtn').onclick = () => open({focusName:true});
  el('projectLibraryBtn').onclick = () => open();
  async function restore(context) {
    if (!context || typeof context.id !== 'string' || !Number.isInteger(context.revision) || context.revision < 1 || typeof context.name !== 'string') return;
    const initialSession = session;
    try {
      const record = await store.get(context.id);
      if (session !== initialSession) return;
      if (record.revision === context.revision) activate(record);
      else {
        session++;
        active = {id:context.id, name:context.name, revision:context.revision, snapshot:null};
      }
      sync();
    } catch {}
  }
  sync();
  return {open, sync, detach, restore, context:() => active ? {id:active.id, name:active.name, revision:active.revision} : null};
}

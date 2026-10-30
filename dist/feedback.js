/* Suggestions are shared server records, never browser-local substitute messages. */
const feedbackCategories = {idea:'功能建議', bug:'問題回報', ui:'介面操作', other:'其他'};

function feedbackFormatError() { return new Error('留言資料暫時無法讀取，請重新整理。'); }

export function normalizeFeedbackItem(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || value.id.length > 100
      || typeof value.title !== 'string' || !value.title.trim() || Array.from(value.title).length > 80
      || typeof value.body !== 'string' || !value.body.trim() || Array.from(value.body).length > 3000
      || (value.name != null && (typeof value.name !== 'string' || Array.from(value.name).length > 40))
      || !Object.hasOwn(feedbackCategories, value.category)) throw feedbackFormatError();
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.parse(value.createdAt);
  if (!Number.isFinite(createdAt) || createdAt < 0 || !Number.isFinite(new Date(createdAt).getTime())) throw feedbackFormatError();
  return {id:value.id, name:value.name || '', title:value.title, category:value.category, body:value.body, createdAt};
}

export function normalizeFeedbackPage(value) {
  if (!value || !Array.isArray(value.items) || value.items.length > 200
      || !Number.isSafeInteger(value.total) || value.total < value.items.length
      || (value.nextCursor != null && (typeof value.nextCursor !== 'string' || !value.nextCursor || value.nextCursor.length > 180))) throw feedbackFormatError();
  const items = value.items.map(normalizeFeedbackItem);
  if (new Set(items.map(item=>item.id)).size !== items.length) throw feedbackFormatError();
  return {items, total:value.total, nextCursor:value.nextCursor || null};
}

const feedbackDate = value => new Intl.DateTimeFormat('zh-TW', {
  timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false
}).format(new Date(value));

function feedbackCsvCell(value) {
  let text = String(value ?? '');
  // Spreadsheet formula protection also covers leading whitespace and control characters.
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r]/u.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function feedbackCsv(items) {
  const rows = [['日期','分類','姓名','標題','建議內容'], ...items.map(item=>[
    feedbackDate(item.createdAt), feedbackCategories[item.category] || '其他', item.name || '匿名', item.title, item.body
  ])];
  return '\uFEFF' + rows.map(row=>row.map(feedbackCsvCell).join(',')).join('\r\n') + '\r\n';
}

export function feedbackText(items) {
  return items.map((item,index)=>`${index+1}. ${item.title}\n${feedbackCategories[item.category] || '其他'} · ${item.name || '匿名'} · ${feedbackDate(item.createdAt)}\n${item.body}`).join('\n\n');
}

function feedbackMerge(items, additional) {
  const merged = new Map(items.map(item=>[item.id,item]));
  for (const item of additional) merged.set(item.id,item);
  return [...merged.values()].sort((a,b)=>b.createdAt-a.createdAt || b.id.localeCompare(a.id));
}

export function setupFeedback({apiBase, notify=()=>{}} = {}) {
  const el = id=>document.getElementById(id), dialog=el('feedbackDialog'), form=el('feedbackForm');
  let endpoint=null;
  try {
    const url = new URL(apiBase);
    if (url.protocol === 'https:' || url.protocol === 'http:') endpoint = url.origin + url.pathname.replace(/\/+$/,'') + '/api/feedback';
  } catch {}
  let items=[], total=0, nextCursor=null, loaded=false, failed=false, reading=false, posting=false, gathering=false;
  let pendingSubmission=null;
  const submitLabel=el('feedbackSubmit').textContent || '送出建議';
  const more=document.createElement('button');
  more.id='feedbackLoadMore';more.type='button';more.className='button secondary feedback-load-more';more.textContent='載入較早留言';more.hidden=true;
  el('feedbackList').after(more);

  function message(text='', error=false) {
    el('feedbackMessage').textContent=text;
    el('feedbackMessage').classList.toggle('is-error',error);
  }
  function busy() { return reading || posting || gathering; }
  function syncBusy() {
    dialog.setAttribute('aria-busy',String(busy()));
    for (const field of form.querySelectorAll('input, textarea, select')) field.disabled=posting;
    el('feedbackSubmit').disabled=busy();el('feedbackSubmit').textContent=posting?'送出中…':submitLabel;
    el('refreshFeedback').disabled=busy();more.disabled=busy();
    el('exportFeedback').disabled=busy() || (!items.length && total===0);
    el('copyFeedback').disabled=busy() || (!items.length && total===0);
  }
  function empty(title,description) {
    const box=document.createElement('div');box.className='feedback-empty';
    const strong=document.createElement('strong');strong.textContent=title;
    const text=document.createElement('p');text.textContent=description;box.append(strong,text);return box;
  }
  function render() {
    const list=el('feedbackList'), filter=el('feedbackFilter').value;
    const visible=filter==='all'?items:items.filter(item=>item.category===filter);
    list.replaceChildren();
    el('feedbackCount').textContent=loaded?(items.length<total?`已讀取 ${items.length}／${total} 則`:`${total} 則建議`):reading?'讀取中…':'尚未讀取';
    more.hidden=!nextCursor;
    if (!loaded) {
      list.append(reading?empty('正在讀取共用留言','請稍候。'):failed?empty('暫時無法載入留言','請按「重新整理」再試一次。'):empty('共用修改建議','送出後，其他使用者也能在這裡看見。'));
      syncBusy();return;
    }
    if (!visible.length) list.append(items.length?empty('目前沒有這個分類的留言','可切換分類，或載入較早留言。'):empty('留下第一個想法','使用上有新的想法，或發現不順手的地方，都可以在這裡留言。'));
    for (const item of visible) {
      const card=document.createElement('article');card.className='feedback-card';card.setAttribute('role','listitem');
      const header=document.createElement('div');header.className='feedback-card-meta';
      const category=document.createElement('span');category.className='feedback-category feedback-category-'+item.category;category.textContent=feedbackCategories[item.category];
      const author=document.createElement('span');author.className='feedback-author';author.textContent=item.name || '匿名';
      const time=document.createElement('time');time.dateTime=new Date(item.createdAt).toISOString();time.textContent=feedbackDate(item.createdAt);
      const title=document.createElement('h3');title.textContent=item.title;
      const body=document.createElement('p');body.className='feedback-card-body';body.textContent=item.body;
      header.append(category,author,time);card.append(header,title,body);list.append(card);
    }
    syncBusy();
  }
  async function request(method='GET', payload, cursor) {
    if (!endpoint) throw new Error('留言服務正在準備中，請稍後再試。');
    const url=new URL(endpoint);url.searchParams.set('limit','200');if(cursor)url.searchParams.set('cursor',cursor);
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch(url,{method, mode:'cors', credentials:'omit', cache:'no-store', signal:controller.signal,
        ...(payload?{headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{})});
      let data;try { data=await response.json(); } catch { throw feedbackFormatError(); }
      if (!response.ok) throw new Error(typeof data?.error==='string'?data.error:'留言服務暫時無法使用，請稍後再試。');
      return data;
    } catch(error) {
      if (error?.name==='AbortError') throw new Error('連線較久，請稍後重試；未送出的內容仍會保留。');
      if (error instanceof TypeError) throw new Error('無法連線至共用留言區，請確認網路後重試。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function readPage(cursor=null) {
    const page=normalizeFeedbackPage(await request('GET',undefined,cursor));
    items=cursor?feedbackMerge(items,page.items):feedbackMerge([],page.items);
    total=page.total;nextCursor=page.nextCursor;loaded=true;failed=false;render();return page;
  }
  async function refresh() {
    if(busy())return;
    reading=true;message('正在讀取共用留言…');render();
    try { await readPage();message(items.length<total?'可載入較早留言；匯出或複製時會一併讀取全部內容。':''); }
    catch(error){failed=true;message(error.message+(loaded?' 下方保留上次讀取的留言。':''),true);}
    finally { reading=false;render(); }
  }
  more.onclick=async()=>{
    if(busy()||!nextCursor)return;
    reading=true;message('正在讀取較早留言…');syncBusy();
    try {await readPage(nextCursor);message('');}
    catch(error){message(error.message,true);}
    finally{reading=false;render();}
  };
  function draft() { return {name:el('feedbackName').value.trim(), title:el('feedbackTitleInput').value.trim(),
    category:el('feedbackCategory').value, body:el('feedbackBody').value.trim(), website:el('feedbackWebsite').value}; }
  function draftKey(value) {return JSON.stringify(value);}
  form.addEventListener('input',()=>{if(pendingSubmission&&pendingSubmission.key!==draftKey(draft()))pendingSubmission=null;});
  form.addEventListener('change',()=>{if(pendingSubmission&&pendingSubmission.key!==draftKey(draft()))pendingSubmission=null;});
  form.onsubmit=async event=>{
    event.preventDefault();if(busy()||!form.reportValidity())return;
    const value=draft();
    if(!value.title||!value.body){message('請填寫建議標題與內容。',true);(!value.title?el('feedbackTitleInput'):el('feedbackBody')).focus();return;}
    const key=draftKey(value);
    if(!pendingSubmission||pendingSubmission.key!==key)pendingSubmission={key,requestId:crypto.randomUUID()};
    const payload={...value,requestId:pendingSubmission.requestId};
    if(new TextEncoder().encode(JSON.stringify(payload)).length>16384){message('內容較長，請縮短後再送出。',true);return;}
    posting=true;message('正在送出建議…');syncBusy();
    try {
      const result=await request('POST',payload), item=normalizeFeedbackItem(result?.item);
      const exists=items.some(previous=>previous.id===item.id);items=feedbackMerge(items,[item]);total=Math.max(total+(exists?0:1),items.length);loaded=true;
      pendingSubmission=null;form.reset();el('feedbackName').value=value.name;el('feedbackCategory').value=value.category;el('feedbackFilter').value='all';
      message('建議已送出，大家都能在這裡查看。');notify('建議已送出');render();
      try{await readPage();message('建議已送出，大家都能在這裡查看。');}
      catch{message('建議已送出；完整清單暫時無法更新，稍後可按重新整理。');}
    } catch(error){message(error.message+' 未送出的內容仍會保留。',true);}
    finally {posting=false;render();}
  };
  async function gatherAll() {
    const seen=new Set();await readPage();
    while(nextCursor){
      if(seen.has(nextCursor))throw feedbackFormatError();seen.add(nextCursor);
      message(`正在整理全部留言…已讀取 ${items.length}／${total} 則`);
      await readPage(nextCursor);
    }
    if(items.length<total){
      // A colleague may have posted while older pages were being read.
      const latest=normalizeFeedbackPage(await request());items=feedbackMerge(items,latest.items);total=latest.total;render();
      if(items.length<total)throw new Error('留言清單正在更新，請重新整理後再匯出。');
    }
    return [...items];
  }
  async function aggregate(action) {
    if(busy())return;
    gathering=true;message('正在整理全部留言…');syncBusy();
    try{const all=await gatherAll();if(!all.length){message('目前沒有可整理的留言。');return;}await action(all);}
    catch(error){message(error.message,true);}
    finally{gathering=false;render();}
  }
  el('exportFeedback').title='匯出所有分類與較早留言';
  el('exportFeedback').onclick=()=>aggregate(async all=>{
    const blob=new Blob([feedbackCsv(all)],{type:'text/csv;charset=utf-8'}), url=URL.createObjectURL(blob), link=document.createElement('a');
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    link.href=url;link.download=`油路工坊_修改建議_${parts}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message(`已匯出 ${all.length} 則建議。`);
  });
  el('copyFeedback').title='複製所有分類與較早留言';
  el('copyFeedback').onclick=()=>aggregate(async all=>{
    const text=feedbackText(all);let copied=false;
    try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);copied=true;}}catch{}
    if(!copied){const area=document.createElement('textarea');area.value=text;area.className='feedback-copy-buffer';dialog.append(area);area.select();try{copied=document.execCommand('copy');}catch{}area.remove();}
    if(!copied)throw new Error('瀏覽器無法複製，請改用「匯出 CSV」。');
    message(`已複製 ${all.length} 則建議，可貼給程式助理統整。`);notify('已複製全部建議');
  });
  el('feedbackFilter').onchange=render;el('refreshFeedback').onclick=refresh;
  for(const id of ['closeFeedback','feedbackDone'])el(id).onclick=()=>dialog.close();
  function open(){if(!dialog.open)dialog.showModal();if(!busy())refresh();}
  el('feedbackBtn').onclick=open;render();
  return {open};
}

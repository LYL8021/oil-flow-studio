import {createProjectStore} from './project-store.js?v=operations-1';
import {createCloudProjectStore} from './cloud-project-store.js?v=cloud-1';
import {operationMatches} from './operations.js?v=ports-3-1';
import {normalizeTankPortModes,normalizeGroundMode} from './source-settings.js?v=ports-3-1';

function librarySourceSettings(node) {
  if(node?.type==='tank')return JSON.stringify({enabled:node.enabled!==false,portModes:normalizeTankPortModes(node)});
  if(node?.type==='ground')return normalizeGroundMode(node);
  return null;
}

export function setupProjectLibrary({getProject, normalizeProject, setProject, setTitle, confirm, notify, downloadProject, isOperationMode=()=>false, onChange=()=>{}, onOperationsSaved=()=>{}}) {
  const el=id=>document.getElementById(id),dialog=el('projectLibraryDialog'),input=el('projectSaveName');
  const stores={local:createProjectStore(),cloud:createCloudProjectStore()};
  const nameKey=value=>value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
  const scopeOf=id=>String(id).startsWith('cloud:')?'cloud':'local';
  const storeFor=id=>stores[scopeOf(id)];
  let records=[],active=null,renaming=null,busy=false,session=0,scope='cloud',forceNew=false,cloudFailure='';

  function message(text='',error=false){el('projectLibraryMessage').textContent=text;el('projectLibraryMessage').classList.toggle('is-error',error);}
  function projectOf(record){return normalizeProject({...record.project,title:record.name});}
  function activate(record,{loadedRevision}={}){
    session++;
    active={id:record.id,name:record.name,revision:record.revision,snapshot:JSON.stringify(projectOf(record)),...(loadedRevision?{loadedRevision}:{})};
    onChange();
  }
  function sync(){
    const title=getProject().title||'未命名油路圖';
    el('projectName').textContent=title;el('canvasProjectName').textContent=title;
    el('projectLocationTag').textContent=!active?'瀏覽器草稿':scopeOf(active.id)==='local'?'本機圖面':active.loadedRevision?`歷史草稿 v${active.loadedRevision}`:active.snapshot===null?'共用圖面 · 待確認':`共用圖面 v${active.revision}`;
  }
  function detach(){session++;active=null;sync();onChange();}
  function comparison(project,ignoreValves=false){
    const normalized=normalizeProject(project);
    if(ignoreValves){
      delete normalized.operations;
      normalized.nodes.forEach(node=>{
        if(node.type==='valve')delete node.open;
        if(node.type==='tank'){delete node.enabled;delete node.portModes;}
        if(node.type==='ground'){delete node.enabled;delete node.flowMode;}
      });
    }
    return JSON.stringify(normalized);
  }
  function dirty(){
    const current=normalizeProject(getProject());
    if(!active)return !!(current.nodes.length||current.edges.length||current.reference);
    if(active.snapshot===null)return true;
    const saved=JSON.parse(active.snapshot);
    if(!isOperationMode())return comparison(current)!==comparison(saved);
    if(comparison(current,true)!==comparison(saved,true))return true;
    if(comparison(current)===comparison(saved))return false;
    const savedNodes=new Map(saved.nodes.map(node=>[node.id,node]));
    const changedSources=current.nodes.filter(node=>['tank','ground'].includes(node.type)&&librarySourceSettings(node)!==librarySourceSettings(savedNodes.get(node.id)));
    return !(current.operations||[]).some(operation=>operationMatches(current,operation)&&changedSources.every(node=>operation.sources?.some(source=>source.id===node.id&&source.type===node.type)));
  }
  function updateSubmit(){
    const updating=!forceNew&&active&&scopeOf(active.id)===scope&&nameKey(input.value)===nameKey(active.name);
    el('projectSaveSubmit').textContent=renaming?'確認改名':updating?(scope==='cloud'?'更新共用圖面':'更新這張圖面'):(scope==='cloud'?'儲存新共用圖面':'儲存新圖面');
    el('projectSaveAsNew').hidden=!!renaming||!active||forceNew;
  }
  function resetForm(){
    renaming=null;forceNew=false;
    el('projectSaveLabel').textContent=scope==='cloud'?'將目前畫布儲存為共用圖面':'目前圖面名稱';
    el('cancelProjectRename').hidden=true;
    el('projectSaveForm').hidden=isOperationMode();
    input.value=getProject().title||'';
    updateSubmit();
  }
  function setBusy(value){busy=value;dialog.setAttribute('aria-busy',String(value));dialog.querySelectorAll('input, button').forEach(button=>{button.disabled=value;});}
  async function run(action){
    if(busy)return;setBusy(true);
    try{await action();}
    catch(error){message(error.message||'操作失敗，請先匯出 JSON 備份後再試。',true);if(error.code==='conflict')message('這張共用圖面已有新版，目前畫布已保留。請先「另存新圖面」保留修改，或重新載入最新圖面後再編修。',true);}
    finally{setBusy(false);}
  }
  function button(label,action,className){const node=document.createElement('button');node.type='button';node.textContent=label;if(className)node.className=className;node.onclick=action;return node;}
  function dateText(time){return new Date(time).toLocaleString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
  function closeHistory(){el('projectHistoryPanel').hidden=true;el('projectLibraryList').hidden=false;el('projectLibraryListHeading').hidden=false;}
  function renderScope(){
    el('projectScopeCloud').setAttribute('aria-pressed',String(scope==='cloud'));el('projectScopeLocal').setAttribute('aria-pressed',String(scope==='local'));
    el('projectLibraryListTitle').textContent=scope==='cloud'?'共用圖面':'這台電腦的圖面';
    el('projectLibraryScopeNote').textContent=scope==='cloud'?'共用圖面可由使用此網站的人開啟，包含元件、油管、底圖與已儲存的作業。':'本機圖面只存在目前瀏覽器。可按圖面旁的「分享至共用」，保留原本存檔並上傳一份。';
    el('projectLibraryFooterNote').textContent=scope==='cloud'?'儲存需連線；每次更新保留歷史版本。若同仁已更新，會提醒你先保留目前修改。':'本機圖面不會自動上傳。清除網站資料會移除本機存檔，可匯出 JSON 備份。';
  }
  function renderList(){
    const list=el('projectLibraryList');list.replaceChildren();el('projectLibraryCount').textContent=`${records.length} 張圖面`;
    if(!records.length){
      const empty=document.createElement('div');empty.className='project-library-empty';
      const title=document.createElement('strong');title.textContent=scope==='cloud'?'把大家常用的管線圖放在這裡。':'把畫好的油路，留在這台電腦。';
      const description=document.createElement('p');description.textContent=isOperationMode()?'切到「編修管線圖與元件」後，就能命名儲存目前畫布。':scope==='cloud'?'輸入名稱，例如「輸王田」，儲存後同仁就能在其他電腦開啟。':'輸入名稱，例如「輸王田」，按儲存即可建立第一張本機圖面。';
      empty.append(title,description);list.append(empty);
    }
    for(const record of records){
      const card=document.createElement('div');card.className='saved-project-card'+(active?.id===record.id?' is-current':'');card.dataset.projectId=record.id;
      const open=button('',()=>run(()=>openSaved(record.id)),'saved-project-open');open.setAttribute('aria-label',`載入圖面 ${record.name}`);
      const name=document.createElement('strong');name.textContent=record.name;
      const meta=document.createElement('span');meta.className='saved-project-meta';
      meta.textContent=`${scope==='cloud'?`v${record.revision} · `:''}${record.nodeCount} 個元件 · ${record.edgeCount} 段油管 · ${dateText(record.updatedAt)}${active?.id===record.id?' · 目前圖面':''}`;
      open.append(name,meta);
      const actions=document.createElement('div');actions.className='saved-project-actions';
      if(scope==='cloud'){
        const history=button('歷史版本',()=>run(()=>showHistory(record)),'saved-project-history');history.setAttribute('aria-label',`歷史版本 ${record.name}`);actions.append(history);
      }else{
        const share=button('分享至共用',()=>confirm(`分享「${record.name}」至共用圖面？`,'元件、油管、底圖與已儲存作業將上傳雲端，使用網站的人都能開啟。本機存檔會保留；目前畫布不會變更。',()=>run(async()=>{
          const local=await stores.local.get(record.id),snapshot=projectOf(local);
          const shared=await stores.cloud.save({name:local.name,project:snapshot});
          scope='cloud';resetForm();renderScope();closeHistory();await refresh();
          message(`已分享「${shared.name}」。請點圖面名稱開啟共用版本，之後可繼續更新。`);notify(`已分享「${shared.name}」至共用圖面`);
        })),'saved-project-share');share.setAttribute('aria-label',`分享圖面 ${record.name} 至共用`);actions.append(share);
        const rename=button('改名',()=>{renaming=record;forceNew=false;el('projectSaveForm').hidden=false;el('projectSaveLabel').textContent='新的圖面名稱';el('cancelProjectRename').hidden=false;input.value=record.name;updateSubmit();message(`正在修改「${record.name}」的名稱，畫布內容會保留。`);input.focus();input.select();});rename.setAttribute('aria-label',`改名圖面 ${record.name}`);actions.append(rename);
      }
      const exportButton=button('匯出',()=>run(async()=>{const saved=await storeFor(record.id).get(record.id);downloadProject(projectOf(saved),saved.name);message(`已匯出「${saved.name}」JSON 備份。`);}),'saved-project-export');exportButton.setAttribute('aria-label',`匯出圖面 ${record.name}`);actions.append(exportButton);
      if(scope==='local'){
        const remove=button('刪除',()=>confirm(`刪除「${record.name}」？`,'這張圖面會從本機儲存區移除。需要保留時，請先匯出 JSON；目前畫布不會被清空。',()=>run(async()=>{
          await stores.local.remove(record.id,{expectedRevision:active?.id===record.id?active.revision:record.revision});
          if(active?.id===record.id)detach();if(renaming?.id===record.id)resetForm();await refresh();message(`已刪除本機圖面「${record.name}」，目前畫布內容仍保留。`);
        })),'danger');remove.setAttribute('aria-label',`刪除圖面 ${record.name}`);actions.append(remove);
      }
      card.append(open,actions);list.append(card);
    }
  }
  async function refresh(){
    const requestedScope=scope;
    try{
      const next=await stores[requestedScope].list();
      if(requestedScope!==scope)return;
      records=next;if(scope==='cloud')cloudFailure='';renderList();onChange();
    }catch(error){
      if(requestedScope===scope){records=[];el('projectLibraryList').replaceChildren();el('projectLibraryCount').textContent='無法載入';if(scope==='cloud')cloudFailure=error.message;}
      throw error;
    }
  }
  function replaceWith(record,next,{loadedRevision,expectedSession=session}={}){
    if(session!==expectedSession)return;
    const replace=()=>{if(session!==expectedSession)return;activate(record,{loadedRevision});setProject(next);resetForm();dialog.close();notify(loadedRevision?`已載入 v${loadedRevision} 為歷史草稿；編修後儲存才會更新共用圖面。`:`已載入${scopeOf(record.id)==='cloud'?'共用圖面':''}「${record.name}」`);};
    if(dirty())confirm(`載入「${record.name}」${loadedRevision?` v${loadedRevision}`:''}？`,isOperationMode()?'目前仍有未儲存的調整，載入會取代畫布。要保留閥位請先儲存作業；管線變更請到編修圖面儲存。':'目前畫布有尚未存入儲存區的內容。載入會取代畫布；若要保留修改，請先取消並儲存圖面。',replace);else replace();
  }
  async function openSaved(id){const initialSession=++session,record=await storeFor(id).get(id);if(session!==initialSession)return;replaceWith(record,projectOf(record),{expectedSession:initialSession});}
  async function showHistory(record){
    const revisions=await stores.cloud.revisions(record.id);
    el('projectLibraryList').hidden=true;el('projectLibraryListHeading').hidden=true;el('projectHistoryPanel').hidden=false;
    el('projectHistoryTitle').textContent=`「${record.name}」歷史版本`;const list=el('projectHistoryList');list.replaceChildren();
    for(const revision of revisions){
      const row=document.createElement('div');row.className='project-history-row';row.dataset.revision=String(revision.revision);
      const details=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('span');
      name.textContent=`版本 ${revision.revision}${revision.revision===record.revision?' · 最新':''}`;meta.textContent=`${dateText(revision.updatedAt)} · ${revision.nodeCount} 個元件 · ${revision.edgeCount} 段油管`;details.append(name,meta);
      const load=button('載入此版本',()=>run(async()=>{
        const initialSession=++session;
        const [latest,historical]=await Promise.all([stores.cloud.get(record.id),stores.cloud.getRevision(record.id,revision.revision)]);
        if(session!==initialSession)return;
        replaceWith(latest,projectOf({...historical,name:latest.name}),{expectedSession:initialSession,...(revision.revision===latest.revision?{}:{loadedRevision:revision.revision})});
      }),'project-history-load');load.setAttribute('aria-label',`載入歷史版本 ${revision.revision}`);row.append(details,load);list.append(row);
    }
    message('選擇版本載入至目前畫布，雲端圖面會保留。');
  }
  async function saveSnapshot(name,project,target){
    const record=await stores[scope].save({...(target?{id:target.id,expectedRevision:target.revision}:{}),name,project});
    activate(record);setTitle(record.name);resetForm();
    const savedScope=scope;
    try{await refresh();}catch{message(`「${record.name}」已儲存，但清單暫時無法重新整理。`,true);notify(`已儲存「${record.name}」`);return;}
    message(savedScope==='cloud'?`已儲存「${record.name}」v${record.revision}，其他電腦重新載入即可開啟。`:`已儲存「${record.name}」至這台電腦。`);notify(`已儲存「${record.name}」`);
  }
  el('projectSaveForm').onsubmit=event=>{
    event.preventDefault();run(async()=>{
      const name=input.value.trim().replace(/\s+/gu,' ');if(!name){input.focus();throw new Error('請輸入圖面名稱，例如「輸王田」。');}
      if(renaming){
        const target=renaming,record=await stores.local.rename(target.id,name,{expectedRevision:active?.id===target.id?active.revision:target.revision});
        if(active?.id===record.id){activate(record);setTitle(record.name);}resetForm();await refresh();message(`圖面已改名為「${record.name}」。`);return;
      }
      const project=normalizeProject({...getProject(),title:name});
      const current=!forceNew&&active&&scopeOf(active.id)===scope&&nameKey(name)===nameKey(active.name)?active:null;
      const existing=records.find(record=>nameKey(record.name)===nameKey(name));
      if(scope==='cloud'&&!current&&existing)throw new Error('共用區已有同名圖面。請用另一個名稱另存，或先載入那張圖面，再編修更新。');
      if(scope==='local'&&!current&&existing)confirm(`取代已儲存的「${existing.name}」？`,'本機儲存區已有同名圖面。確定後會以目前畫布取代那張圖面；也可以取消並使用其他名稱。',()=>run(()=>saveSnapshot(name,project,existing)));
      else await saveSnapshot(name,project,current);
    });
  };
  input.oninput=updateSubmit;
  el('projectSaveAsNew').onclick=()=>{forceNew=true;renaming=null;input.value=`${input.value||getProject().title||'油路圖'} 副本`.slice(0,80);updateSubmit();message('請輸入新的圖面名稱。儲存後會建立另一張圖面，原圖保持原樣。');input.focus();input.select();};
  el('cancelProjectRename').onclick=()=>{resetForm();message();input.focus();};
  el('closeProjectLibrary').onclick=()=>dialog.close();el('projectLibraryDone').onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  el('projectHistoryBack').onclick=()=>{closeHistory();message();};
  el('projectLibraryRefresh').onclick=()=>run(async()=>{closeHistory();message();await refresh();message('已重新取得最新圖面清單；目前畫布內容保持原樣。');});
  async function changeScope(next){if(busy||scope===next)return;scope=next;resetForm();renderScope();closeHistory();message();await run(refresh);}
  el('projectScopeCloud').onclick=()=>changeScope('cloud');el('projectScopeLocal').onclick=()=>changeScope('local');
  async function open({focusName=false}={}){
    if(busy)return;
    if(focusName&&active)scope=scopeOf(active.id);
    resetForm();renderScope();closeHistory();message();if(!dialog.open)dialog.showModal();await run(refresh);
    if(!el('projectSaveForm').hidden&&(focusName||!records.length)){input.focus();input.select();}else el('projectLibraryList').querySelector('.saved-project-open')?.focus();
  }
  el('saveProjectBtn').onclick=()=>open({focusName:true});el('projectLibraryBtn').onclick=()=>open();
  async function restore(context){
    if(!context||typeof context.id!=='string'||!Number.isInteger(context.revision)||context.revision<1||typeof context.name!=='string')return;
    const initialSession=++session;
    // Keep cloud identity even when offline. A cloud draft must never become a local update.
    active={id:context.id,name:context.name,revision:context.revision,snapshot:null,...(context.loadedRevision?{loadedRevision:context.loadedRevision}:{})};sync();onChange();
    try{
      const record=await storeFor(context.id).get(context.id);if(session!==initialSession)return;
      if(record.revision===context.revision)activate(record,{loadedRevision:context.loadedRevision});
      else notify('這張圖面已有新版。目前草稿已保留；可另存新圖面，或到圖面儲存區載入最新版。');
      sync();
    }catch(error){if(session===initialSession){if(scopeOf(context.id)==='cloud')cloudFailure=error.message;sync();}}
  }
  async function updateOperations(operations,{requireDiagramMatch=true}={}){
    if(!active)throw new Error('請先選擇或儲存一張固定管線圖，再儲存作業。');
    if(active.snapshot===null)throw new Error('尚無法確認這張圖面的最新版本。請先另存目前草稿，或重新載入最新圖面。');
    if(active.loadedRevision)throw new Error('目前是歷史版本草稿。請先到編修圖面儲存為新的共用版本，或載入最新圖面，再修改作業。');
    if(requireDiagramMatch&&comparison(getProject(),true)!==comparison(JSON.parse(active.snapshot),true))throw new Error('管線圖還有未儲存的版面修改，請先切到編修圖面並儲存管線圖。');
    const target={...active},initialSession=session,store=storeFor(target.id),record=await store.get(target.id);
    const project=normalizeProject({...record.project,operations});
    const saved=await store.save({id:target.id,name:record.name,project,expectedRevision:target.revision});
    if(session===initialSession&&active?.id===target.id){activate(saved);onOperationsSaved(project.operations||[]);}
    try{await refresh();}catch{}
    return saved;
  }
  async function listAll(){
    const result=await Promise.allSettled([stores.cloud.list(),stores.local.list()]);
    cloudFailure=result[0].status==='rejected'?result[0].reason.message:'';
    if(result.every(item=>item.status==='rejected'))throw new Error('共用圖面暫時無法連線，本機儲存區也無法讀取。');
    return result.flatMap((item,index)=>item.status==='fulfilled'?item.value.map(record=>({...record,scope:index===0?'cloud':'local'})):[]);
  }
  sync();renderScope();
  return {open,sync,detach,restore,updateOperations,list:listAll,cloudError:()=>cloudFailure,load:id=>openSaved(id),context:()=>active?{id:active.id,name:active.name,revision:active.revision,...(active.loadedRevision?{loadedRevision:active.loadedRevision}:{})}:null};
}

import {captureOperation,applyOperation,operationMatches,normalizeOperations,topologySignature} from './operations.js?v=text-1';

export function setupOperationPanel({getProject,getMode,library,apply,edit,operate,confirm,notify}) {
  const el=id=>document.getElementById(id),dialog=el('operationDialog');
  const key=name=>name.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
  let selectedId=null,diagramId=null,renaming=null,busy=false,listRequest=0;
  const presets=()=>getProject().operations||[];
  const valves=()=>getProject().nodes.filter(node=>node.type==='valve');
  function message(text='',error=false){el('operationMessage').textContent=text;el('operationMessage').classList.toggle('is-error',error);}
  async function run(action){
    if(busy)return;busy=true;dialog.setAttribute('aria-busy','true');dialog.querySelectorAll('button,input').forEach(node=>node.disabled=true);
    try{await action();}catch(error){if(dialog.open)message(error.message,true);else notify(error.message);}
    finally{busy=false;dialog.setAttribute('aria-busy','false');dialog.querySelectorAll('button,input').forEach(node=>node.disabled=false);}
  }
  function button(text,action,className){const node=document.createElement('button');node.type='button';node.textContent=text;node.onclick=action;if(className)node.className=className;return node;}
  function empty(target,title,description){const box=document.createElement('div');box.className='operation-empty';const strong=document.createElement('strong');strong.textContent=title;const p=document.createElement('p');p.textContent=description;box.append(strong,p);target.append(box);}
  function matchingOperation(){const selected=presets().find(operation=>operation.id===selectedId);return selected||presets().find(operation=>operationMatches(getProject(),operation));}
  async function refreshDiagrams(){
    const request=++listRequest;
    try{
      const records=await library.list();if(request!==listRequest)return;
      const target=el('fixedDiagramList');target.replaceChildren();
      if(!records.length)empty(target,'先存好常用的管線圖','切到「編修圖面」，畫好後按「儲存管線圖」。');
      for(const record of records){
        const node=button('',()=>run(()=>library.load(record.id)),'fixed-diagram-card');
        node.dataset.diagramId=record.id;node.setAttribute('aria-label',`選擇管線圖 ${record.name}`);
        const title=document.createElement('strong');title.textContent=record.name;
        const meta=document.createElement('span');meta.textContent=`${record.nodeCount} 個元件 · ${record.operationCount||0} 項作業`;
        node.append(title,meta);target.append(node);
      }
      sync();
    }catch(error){el('fixedDiagramList').replaceChildren();empty(el('fixedDiagramList'),'無法讀取管線圖',error.message);}
  }
  function sync(){
    const operating=getMode()==='sim',context=library.context(),project=getProject();
    el('operationsSidebar').hidden=!operating;el('editorLibrary').hidden=operating;
    el('editorModeBar').hidden=operating;
    el('saveOperationBtn').hidden=!operating;el('saveProjectBtn').hidden=operating;
    el('operationStatus').hidden=!operating;
    if(diagramId!==context?.id){diagramId=context?.id||null;selectedId=null;}
    document.querySelectorAll('.fixed-diagram-card').forEach(node=>{
      const current=node.dataset.diagramId===context?.id;node.classList.toggle('is-current',current);node.setAttribute('aria-pressed',String(current));
    });
    if(!operating)return;
    const allValves=valves(),openCount=allValves.filter(node=>node.open!==false).length;
    const canSave=!!context&&allValves.length>0;
    for(const id of ['saveOperationBtn','newOperationBtn','saveOperationInline']){el(id).disabled=!canSave;el(id).title=!context?'請先選擇一張已儲存管線圖':!allValves.length?'這張管線圖尚無閥門':'儲存目前閥門配置';}
    el('operationDiagramLabel').textContent=context?`「${context.name}」的閥門配置`:'先選擇一張已儲存管線圖';
    const current=matchingOperation(),matches=current&&operationMatches(project,current);
    el('operationStatusText').textContent=!context?'先選管線圖，再選擇作業':current?(matches?`目前作業：${current.name}`:`手動調整中 · 原作業：${current.name}`):'目前配置：手動調整';
    el('operationCounts').textContent=`${openCount} 開 · ${allValves.length-openCount} 關`;
    const target=el('operationList');target.replaceChildren();
    if(!context){empty(target,'圖面與作業，分開整理','左邊選圖，這裡就會列出那張圖的常用作業。');return;}
    if(!presets().length){empty(target,'儲存第一項作業','先調整閥門開關，再按「＋」或「儲存作業」。');return;}
    const signature=topologySignature(project),ids=new Set(allValves.map(node=>node.id));
    for(const operation of presets()){
      const compatible=operation.signature===signature&&operation.valves.length===ids.size&&operation.valves.every(valve=>ids.has(valve.id));
      const card=document.createElement('div');card.className='operation-card'+(matches&&current.id===operation.id?' is-current':'')+(!compatible?' is-incompatible':'');
      const activate=button('',()=>run(async()=>{const next=applyOperation(getProject(),operation);selectedId=operation.id;apply(next);notify(`已套用「${operation.name}」的閥門配置`);}), 'operation-apply');
      activate.setAttribute('aria-label',`套用作業 ${operation.name}`);activate.disabled=!compatible;
      const name=document.createElement('strong');name.textContent=operation.name;
      const count=document.createElement('span');const opened=operation.valves.filter(valve=>valve.open).length;
      count.textContent=compatible?`${opened} 開 · ${operation.valves.length-opened} 關${matches&&current.id===operation.id?' · 目前作業':''}`:'管線已變更 · 請重新儲存此作業';activate.append(name,count);
      const actions=document.createElement('div');actions.className='operation-card-actions';
      const rename=button('改名',()=>openDialog({rename:operation}));rename.setAttribute('aria-label',`改名作業 ${operation.name}`);
      const remove=button('刪除',()=>confirm(`刪除作業「${operation.name}」？`,'只移除此作業設定，管線圖與目前閥門開關會保留。',()=>run(async()=>{
        await library.updateOperations(presets().filter(item=>item.id!==operation.id),{requireDiagramMatch:false});if(selectedId===operation.id)selectedId=null;sync();notify('作業已刪除，管線圖與閥位保留');
      })),'danger');remove.setAttribute('aria-label',`刪除作業 ${operation.name}`);
      actions.append(rename,remove);card.append(activate,actions);target.append(card);
    }
  }
  function preview(){
    const all=valves(),opened=all.filter(node=>node.open!==false).length;
    el('operationOpenCount').textContent=`${opened} 個開啟`;el('operationClosedCount').textContent=`${all.length-opened} 個關閉`;
    const list=el('operationValvePreview');list.replaceChildren();
    for(const valve of all){const row=document.createElement('div');row.className='operation-valve-row';const name=document.createElement('strong');name.textContent=`${valve.code} · ${valve.name}`;const state=document.createElement('span');state.className='operation-valve-state'+(valve.open!==false?' is-open':'');state.textContent=valve.open!==false?'開啟':'關閉';row.append(name,state);list.append(row);}
  }
  function updateSubmit(){const same=presets().find(operation=>key(operation.name)===key(el('operationName').value));el('operationSubmit').textContent=renaming?'確認改名':same?'更新作業配置':'儲存新作業';}
  function openDialog({rename=null,newOperation=false}={}){
    if(busy)return;
    if(!library.context()){notify('請先選擇或儲存一張固定管線圖');return;}
    if(!rename&&!valves().length){notify('這張管線圖尚無閥門');return;}
    renaming=rename;message();
    el('operationDialogTitle').textContent=rename?'修改作業名稱':'儲存作業配置';
    el('operationDialogDescription').textContent=rename?'只修改名稱，原有作業的閥門配置保持不變。':'保存畫布上每一顆閥門的開關；管線與元件位置保持不變。';
    el('operationName').value=rename?rename.name:newOperation?'':matchingOperation()?.name||'';
    el('operationValveSection').hidden=!!rename;preview();updateSubmit();dialog.showModal();el('operationName').focus();el('operationName').select();
  }
  async function saveConfiguration(name,existing){
    const operation=captureOperation(getProject(),{name,...(existing?{id:existing.id,createdAt:existing.createdAt}:{})});
    const next=existing?presets().map(item=>item.id===existing.id?operation:item):[...presets(),operation];
    await library.updateOperations(normalizeOperations(next));selectedId=operation.id;dialog.close();sync();notify(`已儲存作業「${operation.name}」`);
  }
  el('operationForm').onsubmit=event=>{
    event.preventDefault();run(async()=>{
      const name=el('operationName').value.trim().replace(/\s+/gu,' '),existing=presets().find(operation=>key(operation.name)===key(name));
      if(renaming){
        const next=normalizeOperations(presets().map(operation=>operation.id===renaming.id?{...operation,name,updatedAt:Date.now()}:operation));
        await library.updateOperations(next,{requireDiagramMatch:false});dialog.close();sync();notify('作業名稱已更新');return;
      }
      if(existing&&existing.id!==selectedId){confirm(`更新作業「${existing.name}」？`,'同名作業已存在，確定後會用目前畫布的閥門開關取代原配置。',()=>run(()=>saveConfiguration(name,existing)));}
      else await saveConfiguration(name,existing);
    });
  };
  el('operationName').oninput=updateSubmit;
  el('closeOperationDialog').onclick=()=>dialog.close();el('cancelOperation').onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  el('saveOperationBtn').onclick=()=>openDialog();el('saveOperationInline').onclick=()=>openDialog();el('newOperationBtn').onclick=()=>openDialog({newOperation:true});
  el('editDiagramBtn').onclick=edit;el('returnToOperationsBtn').onclick=operate;el('manageDiagramsBtn').onclick=()=>library.open();
  refreshDiagrams();sync();
  return {sync,refreshDiagrams};
}

import {setupFeedback} from './feedback.js?v=feedback-1';
import {computeFlow} from './flow.js?v=tank-flow-1';
import {commitPipeRun} from './pipe-runs.js?v=tank-ports-1';
import {pipePath} from './pipes.js?v=bridge-3';
import {normalizePipeLayer,pipeDrawOrder,reorderPipes} from './pipe-order.js?v=layer-1';
import {normalizeTextMark,textMarkMarkup,textMarkBounds} from './text-marks.js?v=text-1';
import {referenceSymbol} from './symbols.js?v=ground-short-1';
import {normalizeReference,transformReference} from './reference-layout.js?v=1000-1';
import {readImage,analyzePreparedImage} from './image-draft.js?v=pdf-1';
import {isPdfFile} from './pdf-import.js?v=pdf-1';
import {componentPort,nodeScale,normalizeTankPorts,normalizeAngle} from './component-geometry.js?v=ground-short-1';
import {setupTransformControls} from './transform-controls.js?v=transform-1';
import {identifierLayout} from './component-labels.js?v=labels-1';
import {copyComponent,pasteComponent,copyPipeSegment,pastePipeSegment} from './component-clipboard.js?v=clipboard-1';
import {createBlankDrawing,applyReference} from './drawing-actions.js?v=drawing-1';
import {setupProjectLibrary} from './project-library.js?v=text-1';
import {normalizeOperations} from './operations.js?v=text-1';
import {setupOperationPanel} from './operation-panel.js?v=text-1';

const $ = (id) => document.getElementById(id);
const icons = {
 save:'M4 3h13l3 3v15H4Zm4 0v6h8V3M8 21v-8h8v8',
 diagonal:'M3 18 9 7l6 8 6-12',
 sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m0-6v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',moon:'M20.8 13.2A9 9 0 0 1 10.8 3a9 9 0 1 0 10 10.2Z',
 message:'M3 4h18v13H8l-5 4Zm4 4h10M7 12h7',
 folder:'M3 7V5a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v11H3Z',
 download:'M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4',
 cursor:'m5 3 14 10-7 1-3 7Z',pipe:'M4 18V6h16M4 13h5V6',hand:'M7 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v8c0 5-3 7-7 7-3 0-4-2-6-4l-3-4a2 2 0 0 1 3-2l1 1Z',
 undo:'M8 5 3 10l5 5M3 10h10c8 0 8 10 1 10',redo:'m16 5 5 5-5 5m5-5H11c-8 0-8 10-1 10',rotate:'M4 8a8 8 0 1 1-1 8M4 3v5h5',trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
 grid:'M3 3h6v6H3Zm12 0h6v6h-6ZM3 15h6v6H3Zm12 0h6v6h-6Z',fit:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',play:'m8 4 12 8-12 8Z',power:'M12 2v10M7 5a9 9 0 1 0 10 0',info:'M12 10v7m0-11v1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',spark:'m12 3 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z',sliders:'M5 3v5m0 4v9m7-18v11m0 4v3m7-18v2m0 4v12M2 8h6m1 6h6m1-9h6',valve:'M3 8v10l9-5 9 5V8l-9 5Zm9 5V4M8 4h8'
};
function icon(name){return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]||icons.info}"/></svg>`;}
document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
function applyTheme(theme){
 const dark=theme==='dark';document.documentElement.dataset.theme=dark?'dark':'light';
 $('themeIcon').innerHTML=icon(dark?'moon':'sun');$('themeLabel').textContent=dark?'暗色':'亮色';
 const label=dark?'切換為亮色主題':'切換為暗色主題';
 $('themeToggle').setAttribute('aria-pressed',String(dark));$('themeToggle').setAttribute('aria-label',label);$('themeToggle').title=label;
 document.querySelector('meta[name="theme-color"]').content=dark?'#14181f':'#f7f8fa';
}
applyTheme(document.documentElement.dataset.theme||'dark');
$('themeToggle').onclick=()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(theme);try{localStorage.setItem('oil-flow-theme',theme);}catch{}};
window.addEventListener('storage',ev=>{if(ev.key==='oil-flow-theme')applyTheme(ev.newValue==='light'?'light':'dark');});
const types={text:{name:'文字標記',en:'Text annotation',code:'TXT',ports:[]},point:{name:'管線接點',en:'Pipe joint',code:'',ports:['joint']},pipe:{name:'直油管',en:'Straight pipe',code:'P',ports:['in','out']},cap:{name:'盲封',en:'Blind flange',code:'BF',ports:['in']},flowmeter:{name:'流量計',en:'Flow meter',code:'FM',ports:['in','out']},tank:{name:'油槽',en:'Oil tank',code:'TK',ports:['in','out']},ground:{name:'出／入土端',en:'Ground terminal',code:'UG',ports:['port']},valve:{name:'閥門',en:'Valve',code:'V',ports:['in','out']},elbow:{name:'彎頭',en:'Elbow',code:'E',ports:['in','out']},filter:{name:'過濾器',en:'Filter',code:'F',ports:['in','out']},junction:{name:'三通',en:'Tee junction',code:'T',ports:['in','out','branch']},cross:{name:'四通',en:'Cross junction',code:'X',ports:['in','out','branch','top']},outlet:{name:'用油端',en:'Outlet',code:'OUT',ports:['in']}};
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function symbol(type,active=true,open=true,mini=false,variant){
 const fill=active?'var(--fluid-fill,var(--diagram-active-fill))':'var(--diagram-idle-fill)',oil=active?'var(--fluid-oil,var(--diagram-oil))':'var(--diagram-idle-oil)';
 const reference=referenceSymbol(type,{fill,active,open,variant});if(reference)return reference;
 switch(type){
 case 'text':return '<text x="0" y="15" text-anchor="middle" fill="currentColor" stroke="none" font-size="48" font-family="serif">T</text>';
 case 'pipe':return `<path d="M-43 0H43" fill="none" stroke-width="5"/><path d="M-43-6v12m86-12v12" stroke-width="1.5"/>`;
 case 'cap':return `<path d="M-28 0H5"/><rect x="5" y="-22" width="9" height="44" rx="1" fill="${fill}"/><path d="M-1-22h21m-21 44h21M8-15h4M8 15h4" stroke-width="2"/>`;
 case 'flowmeter':return `<path d="M-36 0h12m48 0h12"/><circle r="24" fill="${fill}"/><text x="0" y="6" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-size="18" font-weight="500">F</text>`;
 case 'elbow':return `<path d="M0-32v14Q0 0 18 0h14" stroke-width="14" stroke="var(--diagram-surface)" fill="none"/><path d="M0-32v14Q0 0 18 0h14" stroke-width="8" fill="none"/><path d="M0-32v14Q0 0 18 0h14" stroke-width="4" stroke="${fill}" fill="none"/><path d="M-9-27H9m18 18v18" stroke-width="2"/>`;
 case 'cross':return `<path d="M-26 0h52M0-26v52" stroke="var(--diagram-surface)" stroke-width="14"/><path d="M-26 0h52M0-26v52" stroke-width="8"/><path d="M-26 0h52M0-26v52" stroke="${fill}" stroke-width="4"/><circle r="5" fill="${active?'var(--fluid-line,var(--orange))':'var(--diagram-idle-symbol)'}" stroke="none"/>`;
 case 'junction':return `<path d="M-26 0h52M0 0v26" stroke="var(--diagram-surface)" stroke-width="14"/><path d="M-26 0h52M0 0v26" stroke-width="8"/><path d="M-26 0h52M0 0v26" stroke="${fill}" stroke-width="4"/><circle r="5" fill="${active?'var(--fluid-line,var(--orange))':'var(--diagram-idle-symbol)'}" stroke="none"/>`;
 case 'outlet':return `<path d="M-33 0h12"/><circle r="21" fill="${fill}"/><path d="M-9 0H9m-6-6 6 6-6 6" stroke-width="1.8"/>`;
 }
}
function thumbnail(type,variant){return `<svg viewBox="${type==='tank'?'-55 -55 110 110':type==='valve'||type==='filter'||type==='ground'?'-44 -48 88 96':'-58 -70 116 140'}" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${symbol(type,false,true,true,variant)}</g></svg>`;}
const components=Object.entries(types).filter(([type])=>type!=='point').flatMap(([type,t])=>type==='ground'?[{type,...t,variant:'rise',name:'出土端',en:'Incoming ground pipe'},{type,...t,variant:'sink',name:'入土端',en:'Outgoing ground pipe'}]:[{type,...t},...(type==='valve'?[{type:'valve',variant:'riser',name:'立管閥',en:'Vertical riser valve'}]:[])]);
const legacyComponents=new Set(['pipe','elbow','junction','cross']);
const componentCard=t=>`<button class="component-card" draggable="true" data-component="${t.type}" ${t.variant?`data-variant="${t.variant}"`:''} title="拖曳或點擊新增${t.name}"><span class="component-icon">${thumbnail(t.type,t.variant)}</span><span class="component-copy"><strong>${t.name}</strong><small>${t.en}</small></span><span class="drag-dots">⠿</span></button>`;
$('componentLibrary').innerHTML=components.filter(t=>!legacyComponents.has(t.type)).map(componentCard).join('');
$('legacyComponentLibrary').innerHTML=components.filter(t=>legacyComponents.has(t.type)).map(componentCard).join('');
document.querySelector('.library .count').textContent=String(components.length-legacyComponents.size).padStart(2,'0');

const normalizeVariant=(type,value)=>type==='valve'?(['flanged','motor','round','riser'].includes(value)?value:'flanged'):type==='filter'?(value==='basket'?'basket':'round'):type==='ground'?(value==='sink'?'sink':'rise'):undefined;
const pipeLength=n=>Number.isFinite(n.length)?Math.max(60,Math.min(1600,Math.round(n.length))):160;
const normalizeFuel=value=>value==='diesel'||value==='gasoline'?value:'fuel';
const fuelName=value=>({fuel:'燃料油',diesel:'柴油',gasoline:'汽油'})[normalizeFuel(value)];
const isFuelSource=n=>n.type==='tank'||n.type==='ground';
const sourceEnabled=n=>n.type==='tank'?n.enabled!==false:n.type==='ground'&&n.enabled===true;
const fuelOptions=(value,compact=false)=>[['fuel','燃料油','橘色'],['diesel','柴油','淺藍色'],['gasoline','汽油','淺綠色']].map(([key,label,color])=>`<option value="${key}" ${normalizeFuel(value)===key?'selected':''}>${label}${compact?'':' · '+color}</option>`).join('');
const fluidClass=fuels=>fuels?.size>1?'fluid-mixed '+(fuels.size>2?'mix-all':fuels.has('gasoline')?(fuels.has('diesel')?'mix-diesel-gasoline':'mix-fuel-gasoline'):'mix-fuel-diesel'):fuels?.has('gasoline')?'fluid-gasoline':fuels?.has('diesel')?'fluid-diesel':'fluid-fuel';
const fluidColor=fuels=>!fuels?.size?'var(--muted)':fuels.has('fuel')?'var(--orange)':fuels.has('diesel')?'var(--diesel-line)':'var(--gasoline-line)';
const fluidText=fuels=>fuels?.size>1?(fuels.size>2?'三油源連通':'雙油源連通'):fuels?.size?fuelName([...fuels][0]):'未通油';
const pipeKinds={normal:'一般油管',bridge:'跨管',underground:'地下管'};
const pipeKindOptions=value=>Object.entries(pipeKinds).map(([key,name])=>`<option value="${key}" ${value===key?'selected':''}>${name}</option>`).join('');
const STORAGE='oil-flow-studio-v1';
let state={nodes:[],edges:[]},history=[],future=[],selected=null,mode='sim',tool='select',canvasPointer=null,newPipeKind='normal',newRouting='orthogonal',grid=true,pendingPort=null,draftWaypoints=[],draftPointer=null,selectedWaypoint=null,view={x:0,y:0,w:1200,h:720},drag=null,toastTimer,saveTimer,storageAvailable=true;
let projectLibrary=null,operationPanel=null,transformControls=null,componentClipboard=null,pasteSequence=0;
let flow={activeEdges:new Set(),activeNodes:new Set(),activePorts:new Set(),activeEdgeFuels:new Map(),activeNodeFuels:new Map(),activePortFuels:new Map(),edgeDirections:new Map(),nodeDirections:new Map()};
const clone=v=>JSON.parse(JSON.stringify(v));
function sample(){
 const nodes=[
 {id:'tk1',type:'tank',x:140,y:270,name:'供油槽',code:'TK-01',enabled:true,fuel:'fuel',rotation:0},
 {id:'v1',type:'valve',x:330,y:270,name:'主供油閥',code:'V-01',open:true,rotation:0},
 {id:'f1',type:'filter',x:520,y:270,name:'精密過濾器',code:'F-01',rotation:0},
 {id:'t1',type:'junction',x:710,y:270,name:'分流三通',code:'T-01',rotation:0},
 {id:'v2',type:'valve',x:900,y:270,name:'主路閥',code:'V-02',open:true,rotation:0},
 {id:'o1',type:'outlet',x:1080,y:270,name:'主路用油端',code:'OUT-01',rotation:0},
 {id:'e1',type:'elbow',x:710,y:470,name:'90° 彎頭',code:'E-01',rotation:0},
 {id:'v3',type:'valve',x:900,y:470,name:'支路閥',code:'V-03',open:true,rotation:0},
 {id:'o2',type:'outlet',x:1080,y:470,name:'支路用油端',code:'OUT-02',rotation:0}
 ];
 const pairs=[['tk1','out','v1','in'],['v1','out','f1','in'],['f1','out','t1','in'],['t1','out','v2','in'],['v2','out','o1','in'],['t1','branch','e1','in'],['e1','out','v3','in'],['v3','out','o2','in']];
 return {nodes,edges:pairs.map(([a,b,c,d],i)=>({id:'p'+(i+1),from:{node:a,port:b},to:{node:c,port:d}}))};
}
function notify(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),2600);}
function remember(){history.push(clone(state));if(history.length>70)history.shift();future=[];}
function persist(){clearTimeout(saveTimer);$('saveState').textContent='草稿儲存中…';saveTimer=setTimeout(()=>{try{localStorage.setItem(STORAGE,JSON.stringify({...state,_savedDrawing:projectLibrary?.context()||null}));$('saveState').textContent='✓ 草稿已暫存';}catch{$('saveState').textContent='請儲存圖面或匯出';if(storageAvailable){notify('草稿暫存空間不足，請按儲存圖面或匯出 JSON 保留設計');storageAvailable=false;}}},300);}
function change(fn){remember();fn();render();persist();}
function nodeById(id){return state.nodes.find(n=>n.id===id);}
function rotatePoint(x,y,angle){const a=angle*Math.PI/180;return {x:Math.round((x*Math.cos(a)-y*Math.sin(a))*100)/100,y:Math.round((x*Math.sin(a)+y*Math.cos(a))*100)/100};}
function portInfo(node,port){return componentPort(node,port);}
function endpoint(ep){if(ep?.point)return {...ep.point,dx:0,dy:0};const n=nodeById(ep.node);return n?portInfo(n,ep.port):null;}
function routePoints(a,b){
 if(Math.abs(a.y-b.y)<.1&&a.dx&&b.dx&&a.dx*(b.x-a.x)>0&&b.dx*(a.x-b.x)>0)return [a,b];
 if(Math.abs(a.x-b.x)<.1&&a.dy&&b.dy&&a.dy*(b.y-a.y)>0&&b.dy*(a.y-b.y)>0)return [a,b];
 const start={x:a.x+a.dx*28,y:a.y+a.dy*28},end={x:b.x+b.dx*28,y:b.y+b.dy*28};let middle=[];
 if(a.dx&&b.dx){const mid=(start.x+end.x)/2;middle=[{x:mid,y:start.y},{x:mid,y:end.y}];}
 else if(a.dy&&b.dy){const mid=(start.y+end.y)/2;middle=[{x:start.x,y:mid},{x:end.x,y:mid}];}
 else if(a.dx)middle=[{x:end.x,y:start.y}];else middle=[{x:start.x,y:end.y}];
 return [a,start,...middle,end,b];
}
function route(a,b){return pipePath(routePoints(a,b));}
function edgePoints(edge){
 const a=endpoint(edge.from),b=endpoint(edge.to);if(!a||!b)return [];
 return edge.routing==='free'?[a,...(edge.waypoints||[]),b]:routePoints(a,b);
}
function clearDraft(){pendingPort=null;draftWaypoints=[];draftPointer=null;$('draftPipe').setAttribute('d','');$('draftPoints').innerHTML='';}
function canvasAction(target){
 if(tool==='hand'||drag?.kind==='pan')return 'hand';
 if(mode!=='edit')return 'select';
 if(drag?.kind==='node'||drag?.kind==='waypoint')return 'select';
 if(pendingPort)return 'pipe';
 if(target?.closest('[data-toggle]'))return 'toggle';
 if(target?.closest('[data-port]'))return 'pipe';
 if(tool==='pipe'&&target?.closest('[data-edge]'))return 'pipe';
 if(target?.closest('[data-node],[data-edge],[data-waypoint]'))return 'select';
 return tool;
}
function updateCanvasIntent(target){
 const canvas=$('canvas');
 if(!target&&canvasPointer){const hit=document.elementFromPoint(canvasPointer.x,canvasPointer.y);if(hit&&canvas.contains(hit))target=hit;}
 const action=canvasAction(target),effectiveTool=action==='toggle'?'select':action;
 $('finishPipeBtn').hidden=!pendingPort;$('finishPipeBtn').disabled=!draftWaypoints.length;
 canvas.dataset.tool=effectiveTool;canvas.dataset.action=action;canvas.dataset.connecting=String(!!pendingPort);canvas.dataset.dragging=String(!!drag&&drag.kind!=='sim');
 for(const t of ['select','pipe','hand']){const button=$(t+'Tool');button.classList.toggle('active',t===effectiveTool);button.setAttribute('aria-pressed',String(t===effectiveTool));}
 const hint=action==='hand'?'拖曳畫布平移 · V 回到選取':mode==='sim'?'點擊閥門本體，即可切換開關':pendingPort?(newRouting==='free'?'連續畫管：點擊加轉折 · 右鍵結束 · Esc 取消':'直角畫管：點擊加轉折 · 右鍵結束 · Esc 取消'):action==='toggle'?'點擊切換閥門開關':action==='pipe'?'點空白處開始畫管，或點接點／管線建立分支':'拖曳元件移動 · 點接點接管 · C 連續畫管';
 const html=`<span class="hint-dot"></span>${hint}`;if($('modeHint').innerHTML!==html)$('modeHint').innerHTML=html;
}
function routingHint(){updateCanvasIntent();}

function applyRoutingMode(){
 const free=newRouting==='free';$('freeRouteBtn').classList.toggle('active',free);$('freeRouteBtn').setAttribute('aria-pressed',String(free));
 $('freeRouteBtn').title=free?'自由斜走：接管途中點畫布加入轉折':'直角接管：點擊切換自由斜走';$('freeRouteBtn').setAttribute('aria-label',free?'切換為直角接管':'切換為自由斜走');$('routeLabel').textContent=free?'自由':'直角';
 routingHint();
}
function extendPipePath(points,target){
 const result=points.map(p=>({x:p.x,y:p.y})),last=result.at(-1);if(!last)return result;
 if(newRouting!=='free'&&Math.abs(target.x-last.x)>.01&&Math.abs(target.y-last.y)>.01){
  result.push(Math.abs(target.x-last.x)>=Math.abs(target.y-last.y)?{x:target.x,y:last.y}:{x:last.x,y:target.y});
 }
 if(Math.hypot(target.x-result.at(-1).x,target.y-result.at(-1).y)>.01)result.push({x:target.x,y:target.y});
 return result;
}
function updateDraft(pointer){
 if(!pendingPort){$('draftPipe').setAttribute('d','');$('draftPoints').innerHTML='';return;}
 const a=endpoint(pendingPort);if(!a){clearDraft();return;}
 if(pointer)draftPointer={x:pointer.x,y:pointer.y};
 const fixed=[a,...draftWaypoints],points=draftPointer?extendPipePath(fixed,draftPointer):fixed;
 $('draftPipe').setAttribute('d',points.length>1?pipePath(points):'');
 $('draftPoints').innerHTML=fixed.map(p=>`<circle class="draft-waypoint" cx="${p.x}" cy="${p.y}" r="4" fill="var(--diagram-surface)" stroke="var(--orange)" stroke-width="2"/>`).join('');
}
function addPipeBend(p){
 const target={x:Math.max(-40000,Math.min(40000,p.altKey?Math.round(p.x):snap(p.x))),y:Math.max(-40000,Math.min(40000,p.altKey?Math.round(p.y):snap(p.y)))};
 const last=draftWaypoints.at(-1)||endpoint(pendingPort);
 if(newRouting!=='free'&&!p.altKey){if(Math.abs(p.x-last.x)<10)target.x=last.x;if(Math.abs(p.y-last.y)<10)target.y=last.y;}
 const path=extendPipePath([endpoint(pendingPort),...draftWaypoints],target);
 if(path.length>101){notify('每段油管最多支援 100 個轉折點，請先結束這段油管');return;}
 draftWaypoints=path.slice(1);draftPointer=target;updateDraft();updateCanvasIntent();
}
function pipeTarget(edgeId,p){
 const edge=state.edges.find(e=>e.id===edgeId);if(!edge)return null;
 const path=edgePoints(edge);let best=null;
 for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i],dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;if(!len)continue;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len)),point={x:a.x+t*dx,y:a.y+t*dy},distance=Math.hypot(p.x-point.x,p.y-point.y);
  if(!best||distance<best.distance)best={point,distance};
 }
 return best?{edge:edgeId,point:best.point,path}:null;
}
function beginPipe(start){pendingPort=start;draftWaypoints=[];draftPointer=null;selectedWaypoint=null;tool='pipe';renderGraph();}
function finishPipe(target){
 if(!pendingPort)return;
 const a=endpoint(pendingPort),end=target|| (draftWaypoints.length?{point:{...draftWaypoints.at(-1)}}:null);
 if(!end){clearDraft();tool='select';render();notify('尚未畫出管段，已結束繪製');return;}
 const b=endpoint(end);if(!a||!b)return;
 const points=target?extendPipePath([a,...draftWaypoints],b):[a,...draftWaypoints];
 try{
  const result=commitPipeRun(state,{start:pendingPort,end,points,kind:newPipeKind});
  change(()=>{state=result.project;selected={kind:'edge',id:result.edgeId};clearDraft();tool='select';});notify('油管已繪製，可從接點或管線繼續建立分支');
 }catch(error){notify(error.message);}
}
$('finishPipeBtn').onclick=()=>finishPipe();
$('startPipeBtn').onclick=()=>{if(mode==='edit'){setTool('pipe');notify('點畫布或接點開始畫管，沿途點轉折，右鍵結束');}};

function renderWaypoints(){
 const edge=mode==='edit'&&!pendingPort&&selected?.kind==='edge'?state.edges.find(e=>e.id===selected.id&&e.routing==='free'):null;
 if(!edge){selectedWaypoint=null;$('waypointLayer').innerHTML='';return;}
 if(selectedWaypoint&&(selectedWaypoint.edge!==edge.id||selectedWaypoint.index>=(edge.waypoints||[]).length))selectedWaypoint=null;
 $('waypointLayer').innerHTML=(edge.waypoints||[]).map((p,index)=>`<circle class="waypoint-handle ${selectedWaypoint?.edge===edge.id&&selectedWaypoint.index===index?'selected':''}" data-waypoint="${index}" data-waypoint-owner="${edge.id}" cx="${p.x}" cy="${p.y}" r="${selectedWaypoint?.edge===edge.id&&selectedWaypoint.index===index?7:6}" fill="var(--diagram-surface)" stroke="var(--orange)" stroke-width="2" tabindex="0" role="button" aria-label="油管轉折點 ${index+1}，拖曳調整，Delete 刪除"><title>拖曳調整轉折點；選取後按 Delete 刪除</title></circle>`).join('');
}
function removeWaypoint(){
 if(mode==='sim'||!selectedWaypoint)return false;
 const edge=state.edges.find(e=>e.id===selectedWaypoint.edge),index=selectedWaypoint.index;
 if(!edge||edge.routing!=='free'||!edge.waypoints?.[index])return false;
 change(()=>{edge.waypoints.splice(index,1);selectedWaypoint=null;});return true;
}
function addWaypoint(edge){
 if(mode==='sim'||edge.routing!=='free')return;
 if((edge.waypoints||[]).length>=100){notify('每段油管最多支援 100 個轉折點');return;}
 const points=edgePoints(edge);if(points.length<2)return;
 let index=0,length=-1;for(let i=0;i<points.length-1;i++){const d=Math.hypot(points[i+1].x-points[i].x,points[i+1].y-points[i].y);if(d>length){length=d;index=i;}}
 const p={x:Math.round((points[index].x+points[index+1].x)/2),y:Math.round((points[index].y+points[index+1].y)/2)};
 change(()=>{edge.waypoints||=[];edge.waypoints.splice(index,0,p);selectedWaypoint={edge:edge.id,index};});
}

function tankNozzles(n){const angles=normalizeTankPorts(n);return ['in','out'].map(port=>{const a=angles[port==='in'?'inAngle':'outAngle']*Math.PI/180;return `<path class="tank-nozzle tank-nozzle-${port}" d="M${46*Math.cos(a)} ${46*Math.sin(a)}L${50*Math.cos(a)} ${50*Math.sin(a)}" fill="none"/>`;}).join('');}
function renderGraph(){
 flow=computeFlow(state.nodes,state.edges);
 renderReference();renderDraftInfo();
 const nodePipes=new Map(state.nodes.filter(n=>n.type==='pipe').map(n=>[n.id,[portInfo(n,'in'),portInfo(n,'out')]]));
 const routes=new Map(state.edges.map(e=>[e.id,edgePoints(e)]));
 const pipeItems=pipeDrawOrder([
  ...state.nodes.filter(n=>n.type==='pipe').map(n=>({group:'node',id:n.id,kind:n.kind,layer:n.layer,ref:n,points:nodePipes.get(n.id)})),
  ...state.edges.map(e=>({group:'edge',id:e.id,kind:e.kind,layer:e.layer,ref:e,points:routes.get(e.id)}))
 ]);
 const renderEdge=(e,lowerPaths)=>{
  const points=routes.get(e.id);if(!points.length)return '';
  const direction=flow.edgeDirections.get(e.id);
  const d=pipePath(points,e.kind==='bridge'?lowerPaths:[]),active=flow.activeEdges.has(e.id),fuels=flow.activeEdgeFuels.get(e.id),mixed=fuels?.size>1;
  return `<g class="pipe ${e.kind||'normal'} ${fluidClass(fuels)} ${active?'active':''} ${selected?.kind==='edge'&&selected.id===e.id?'selected':''}" data-edge="${e.id}" data-kind="${e.kind||'normal'}" data-layer="${normalizePipeLayer(e.layer)}" data-flow-direction="${direction||'none'}" role="button" tabindex="0" aria-label="${pipeKinds[e.kind]||pipeKinds.normal} ${esc(e.id)}，${fluidText(fuels)}"><title>${pipeKinds[e.kind]||pipeKinds.normal} · ${fluidText(fuels)}</title><path class="pipe-border" d="${d}"/><path class="pipe-line" d="${d}"/>${mixed?`<path class="pipe-secondary" d="${d}"/>`:''}${fuels?.size>2?`<path class="pipe-tertiary" d="${d}"/>`:''}${active&&!mixed&&e.kind!=='underground'&&direction&&direction!=='ambiguous'?`<path class="flow-dashes ${direction==='reverse'?'flow-reverse':''}" d="${d}"/>`:''}<path class="pipe-hit" d="${d}"/></g>`;
 };
 const renderNode=(n,lowerPaths=[])=>{
 if(n.type==='text')return `<g class="node text-mark ${selected?.kind==='node'&&selected.id===n.id?'selected':''}" data-node="${n.id}" transform="translate(${n.x} ${n.y}) rotate(${n.rotation||0}) scale(${nodeScale(n)})" tabindex="0" role="button" aria-label="文字標記 ${esc(normalizeTextMark(n).text.slice(0,80)||'空白')}">${textMarkMarkup(n)}</g>`;
 if(n.type==='point'){
  const active=flow.activeNodes.has(n.id),pending=pendingPort?.node===n.id;
  return `<g class="node pipe-point ${fluidClass(flow.activeNodeFuels.get(n.id))} ${active?'active':''} ${selected?.kind==='node'&&selected.id===n.id?'selected':''}" data-node="${n.id}" transform="translate(${n.x} ${n.y})" tabindex="0" role="button" aria-label="管線接點"><circle class="joint-hit" r="11" fill="transparent"/><circle class="joint-dot" r="4"/><circle class="port ${pending?'pending':''}" data-port="joint" data-owner="${n.id}" r="4.5" tabindex="${mode==='edit'?0:-1}" role="button" aria-label="管線接管點"/></g>`;
 }
 const closedValve=n.type==='valve'&&n.open===false,active=flow.activeNodes.has(n.id)&&!closedValve,isSelected=selected?.kind==='node'&&selected.id===n.id,identifier=identifierLayout(n,{operationMode:mode==='sim'}),labelX=identifier.x,labelAnchor=identifier.anchor,labelY=identifier.y;
 const pipePoints=n.type==='pipe'?nodePipes.get(n.id).map(p=>({x:p.x-n.x,y:p.y-n.y})):[];
 const crossingPaths=n.type==='pipe'&&n.kind==='bridge'?lowerPaths.map(points=>points.map(p=>({x:p.x-n.x,y:p.y-n.y}))):[];
 const pipeD=n.type==='pipe'?pipePath(pipePoints,crossingPaths):'';
 const minX=n.type==='pipe'?Math.min(-63,...pipePoints.map(p=>p.x-16)):-63,maxX=n.type==='pipe'?Math.max(63,...pipePoints.map(p=>p.x+16)):63,minY=n.type==='tank'?-76:n.type==='pipe'?Math.min(-20,...pipePoints.map(p=>p.y-16)):-49;
 const pipeDirection=n.type==='pipe'?flow.nodeDirections.get(n.id):null;
 const graphic=n.type==='pipe'?`<g class="pipe standalone-pipe ${n.kind||'normal'} ${fluidClass(flow.activeNodeFuels.get(n.id))} ${active?'active':''}"><path class="pipe-border" d="${pipeD}"/><path class="pipe-line" d="${pipeD}"/>${flow.activeNodeFuels.get(n.id)?.size>1?`<path class="pipe-secondary" d="${pipeD}"/>`:''}${flow.activeNodeFuels.get(n.id)?.size>2?`<path class="pipe-tertiary" d="${pipeD}"/>`:''}${active&&flow.activeNodeFuels.get(n.id)?.size===1&&n.kind!=='underground'&&pipeDirection&&pipeDirection!=='ambiguous'?`<path class="flow-dashes ${pipeDirection==='reverse'?'flow-reverse':''}" d="${pipeD}"/>`:''}<path class="standalone-pipe-hit" d="${pipeD}"/></g>`:symbol(n.type,active,n.open!==false,false,n.variant);
 const central=n.type==='valve'&&n.variant==='riser';
 const ports=(central?['center']:types[n.type].ports).map(p=>{
  const pos=portInfo(n,p),isPending=pendingPort?.node===n.id&&(central||pendingPort.port===p),fuels=central?flow.activeNodeFuels.get(n.id):flow.activePortFuels.get(n.id+':'+p),activePort=central?!!fuels?.size:flow.activePorts.has(n.id+':'+p);
  return `<circle class="port ${fluidClass(fuels)} ${activePort?'active':''} ${isPending?'pending':''}" data-port="${p}" data-owner="${n.id}" cx="${pos.x-n.x}" cy="${pos.y-n.y}" r="4.5" tabindex="${mode==='edit'?0:-1}" role="button" aria-label="${esc(n.name)} ${central?'立管閥中心':p==='in'?'入口':p==='branch'?'支路':p==='top'?'上方分支':'出口'}接點"/>`;
 }).join('');
 const hasCapacity=n.type==='tank'&&Number.isFinite(n.capacity);
 const tankInfo=n.type==='tank'?`<g transform="scale(${nodeScale(n)})" class="tank-info" fill="var(--diagram-label)" stroke="none" text-anchor="middle"><text x="0" y="${hasCapacity?-14:-5}" font-size="16" font-weight="600">${esc(n.code)}</text>${hasCapacity?`<text x="0" y="2" font-size="10">${n.capacity} 公秉</text>`:''}<text x="0" y="${hasCapacity?19:14}" font-size="11">${fuelName(n.fuel)}</text></g>`:'';

 const badge=n.type==='valve'&&mode==='sim'?`<g class="valve-badge ${n.open?'':'closed'}" data-toggle="${n.id}" transform="translate(-27 ${identifier.badgeY})" role="button" tabindex="0" aria-label="${esc(n.name)}，${n.open?'開啟，點擊關閉':'關閉，點擊開啟'}"><rect width="54" height="22" rx="11"/><circle cx="12" cy="11" r="2.5" fill="${n.open?'#ed9a62':'#ce8a81'}"/><text x="31" y="14" text-anchor="middle">${n.open?'開啟':'關閉'}</text></g>`:'';
 return `<g class="node ${closedValve?'closed-valve':''} ${n.review?'needs-review':''} ${fluidClass(flow.activeNodeFuels.get(n.id))} ${active?'active':''} ${isSelected?'selected':''}" data-node="${n.id}" transform="translate(${n.x} ${n.y})" tabindex="0" role="button" aria-label="${esc(n.name)} ${types[n.type].name}"><rect class="selection-box" x="${minX}" y="${minY}" width="${maxX-minX}" height="${labelY+30-minY}" rx="8"/><g class="node-symbol" transform="rotate(${n.type==='pipe'?0:n.rotation||0}) scale(${n.type==='pipe'?1:nodeScale(n)})">${graphic}${n.type==='tank'?tankNozzles(n):''}</g>${tankInfo}${ports}${badge}${n.review?`<text class="review-marker" x="46" y="-28" text-anchor="middle"><title>${esc(n.note||'圖片辨識候選，請確認元件位置與種類')}</title>?</text>`:''}<text class="node-code node-identifier" x="${labelX}" y="${labelY}" text-anchor="${labelAnchor}">${n.type==='tank'?'':esc(n.code)}</text></g>`;
 };
 const lowerPaths=[];
 $('pipeNodeLayer').innerHTML='';
 $('edgeLayer').innerHTML=pipeItems.map(item=>{const markup=item.group==='edge'?renderEdge(item.ref,lowerPaths):renderNode(item.ref,lowerPaths);if(item.points?.length)lowerPaths.push(item.points);return markup;}).join('');
 $('nodeLayer').innerHTML=state.nodes.filter(n=>n.type!=='pipe').map(n=>renderNode(n)).join('');
 renderWaypoints();updateDraft();transformControls?.render();updateCanvasIntent();
 $('emptyCanvas').hidden=state.nodes.length>0||!!state.reference||!!pendingPort;
 $('canvasStatus').textContent=`${state.nodes.length} 個元件 · ${state.edges.length} 段油管`;
 $('undoBtn').disabled=!history.length;$('redoBtn').disabled=!future.length;
 $('rotateBtn').disabled=selected?.kind!=='node'||mode==='sim';$('deleteBtn').disabled=!selected||mode==='sim';
}
function pipeOrderControls(){return `<div class="section-title">交叉顯示層級</div><div class="property-actions"><button id="pipeToTop" class="button secondary" ${mode==='sim'?'disabled':''}>此管段在上層</button><button id="pipeToBottom" class="button secondary" ${mode==='sim'?'disabled':''}>此管段在下層</button></div><p class="connection-detail">調整此管段在交叉處的顯示順序；交叉管線仍各自獨立。</p>`;}
function changePipeOrder(target,placement){if(mode==='sim')return;change(()=>{state=reorderPipes(state,target,placement);});notify(placement==='top'?'已將此管段放在交叉上層':'已將此管段放在交叉下層');}
function renderTextInspector(n){
 const style=normalizeTextMark(n);
 $('inspectorContent').innerHTML=`<div class="selected-type"><span class="component-icon">${thumbnail('text')}</span><div><strong>文字標記</strong><small>文字不參與通油</small></div></div><label class="field"><span>標記文字（可換行）</span><textarea id="textContent" maxlength="2000" rows="5" ${mode==='sim'?'disabled':''}>${esc(style.text)}</textarea></label><div class="field-row"><label class="field"><span>字級</span><input id="textSize" type="number" min="8" max="72" value="${style.fontSize}" ${mode==='sim'?'disabled':''}></label><label class="field"><span>對齊</span><select id="textAlign" class="fuel-select" ${mode==='sim'?'disabled':''}>${[['start','靠左'],['middle','置中'],['end','靠右']].map(([value,label])=>`<option value="${value}" ${style.textAlign===value?'selected':''}>${label}</option>`).join('')}</select></label></div><label class="field"><span>字色${style.textColor==='auto'?'（跟隨主題）':''}</span><div class="text-color-row"><input id="textColor" type="color" value="${style.textColor==='auto'?'#d5dce6':style.textColor}" aria-label="文字顏色" ${mode==='sim'?'disabled':''}><button id="textThemeColor" class="button secondary" ${mode==='sim'?'disabled':''}>使用主題色</button></div></label><label class="text-bold-field"><input id="textBold" type="checkbox" ${style.bold?'checked':''} ${mode==='sim'?'disabled':''}>粗體</label><label class="field"><span>旋轉角度（°）</span><input id="nodeAngle" type="number" min="0" max="359" step="1" value="${n.rotation||0}" ${mode==='sim'?'disabled':''}></label><div class="field-row"><label class="field"><span>X 位置</span><input id="nodeX" type="number" min="-40000" max="40000" value="${n.x}" ${mode==='sim'?'disabled':''}></label><label class="field"><span>Y 位置</span><input id="nodeY" type="number" min="-40000" max="40000" value="${n.y}" ${mode==='sim'?'disabled':''}></label></div><div class="property-actions"><button id="propertyRotate" class="button secondary" ${mode==='sim'?'disabled':''}>旋轉 90°</button><button id="propertyDelete" class="button secondary" ${mode==='sim'?'disabled':''}>刪除文字</button></div>`;
 const update=(key,value)=>{if(mode==='sim')return;change(()=>n[key]=value);};
 $('textContent').onchange=ev=>update('text',ev.target.value);
 $('textSize').onchange=ev=>{const size=Number(ev.target.value);if(Number.isFinite(size)&&size>=8&&size<=72)update('fontSize',size);else renderTextInspector(n);};
 $('textAlign').onchange=ev=>update('textAlign',ev.target.value);
 $('textColor').onchange=ev=>update('textColor',ev.target.value);
 $('textThemeColor').onclick=()=>update('textColor','auto');$('textBold').onchange=ev=>update('bold',ev.target.checked);
 $('nodeAngle').onchange=ev=>{const angle=Number(ev.target.value);if(Number.isFinite(angle))update('rotation',((angle%360)+360)%360);};
 for(const axis of ['X','Y'])$('node'+axis).onchange=ev=>{const value=Number(ev.target.value);if(Number.isFinite(value)&&Math.abs(value)<=40000)update(axis.toLowerCase(),value);else renderTextInspector(n);};
 $('propertyRotate').onclick=rotateSelected;$('propertyDelete').onclick=deleteSelected;
}
function renderInspector(){
 const n=selected?.kind==='node'?nodeById(selected.id):null,e=selected?.kind==='edge'?state.edges.find(e=>e.id===selected.id):null;
 $('inspectorTitle').textContent=n?'元件屬性':e?'油管屬性':'油路概覽';$('inspectorType').textContent=n?'PROPERTIES':e?'PIPE':'OVERVIEW';
 if(n?.type==='text'){renderTextInspector(n);return;}
 if(n){
 const t=n.type==='ground'?{...types.ground,name:n.variant==='sink'?'入土端':'出土端'}:types[n.type],isValve=n.type==='valve',isTank=n.type==='tank',isGround=n.type==='ground',isSource=isFuelSource(n);
 $('inspectorContent').innerHTML=`<div class="selected-type"><span class="component-icon">${thumbnail(n.type,n.variant)}</span><div><strong>${t.name}</strong><small>${esc(n.code)}</small></div></div>${isSource?`<label class="field"><span>${isGround?'端點油品':'油槽油品'}</span><select id="tankFuel" class="fuel-select" aria-label="${isGround?'端點油品':'油槽油品'}" ${mode==='sim'?'disabled':''}>${fuelOptions(n.fuel)}</select></label>`:''}${isGround?`<label class="field"><span>${n.variant==='sink'?'前往站名／油庫':'來自站名'}</span><input id="groundStation" value="${esc(n.station||'')}" maxlength="80" placeholder="${n.variant==='sink'?'例如：台中供油中心':'例如：通霄中繼站'}" ${mode==='sim'?'disabled':''}></label>`:''}${isTank?`<label class="field"><span>油槽容量（公秉）</span><input id="tankCapacity" type="number" min="0" max="1000000000" step="1" placeholder="例如 50000" value="${n.capacity??''}" ${mode==='sim'?'disabled':''}></label>`:''}${n.review||state.draftInfo?`<label class="field"><span>元件種類${state.edges.some(e=>e.from.node===n.id||e.to.node===n.id)?'（先移除接管才能更改）':''}</span><select id="nodeType" class="fuel-select" ${mode==='sim'||state.edges.some(e=>e.from.node===n.id||e.to.node===n.id)?'disabled':''}>${Object.entries(types).map(([key,type])=>`<option value="${key}" ${n.type===key?'selected':''}>${type.name}</option>`).join('')}</select></label>`:''}${n.type==='valve'||n.type==='filter'||n.type==='ground'?`<label class="field"><span>圖示外觀</span><select id="nodeVariant" class="fuel-select" ${mode==='sim'?'disabled':''}>${(n.type==='valve'?[['flanged','法蘭閥'],['motor','M 電動閥'],['round','圓心閥符號'],['riser','立管閥（地面往上）']]:n.type==='ground'?[['rise','出土端'],['sink','入土端']]:[['round','圓形過濾器'],['basket','籃式過濾器']]).map(([value,label])=>`<option value="${value}" ${normalizeVariant(n.type,n.variant)===value?'selected':''}>${label}</option>`).join('')}</select></label>`:''}<p class="transform-hint">拖上方圓柄旋轉、方角縮放；Shift 對齊 15°。油槽的入／出菱形柄可各自調方位。</p><label class="field"><span>元件大小（%）</span><input id="nodeScale" type="number" min="25" max="400" step="1" value="${Math.round(nodeScale(n)*100)}" ${mode==='sim'?'disabled':''}></label>${isTank?`<div class="field-row"><label class="field"><span>入口方位（°）</span><input id="tankInAngle" type="number" min="0" max="359" step="1" value="${normalizeTankPorts(n).inAngle}" ${mode==='sim'?'disabled':''}></label><label class="field"><span>出口方位（°）</span><input id="tankOutAngle" type="number" min="0" max="359" step="1" value="${normalizeTankPorts(n).outAngle}" ${mode==='sim'?'disabled':''}></label></div><p class="connection-detail">0° 向右、90° 向下。入口接收來油；出口由供油開關控制。</p>`:''}<label class="field"><span>旋轉角度（°）</span><input id="nodeAngle" type="number" min="0" max="359" step="1" value="${n.rotation||0}" ${mode==='sim'?'disabled':''}></label>${n.type==='pipe'?`${pipeOrderControls()}<label class="field"><span>油管長度</span><input id="nodeLength" type="number" min="60" max="1600" step="20" value="${pipeLength(n)}" ${mode==='sim'?'disabled':''}></label><label class="field"><span>管線型式</span><select id="nodePipeKind" class="fuel-select" ${mode==='sim'?'disabled':''}>${pipeKindOptions(n.kind||'normal')}</select></label>`:''}<label class="field"><span>元件名稱（可留白）</span><input id="nodeName" value="${esc(n.name)}" maxlength="40" ${mode==='sim'?'disabled':''}></label><label class="field"><span>元件編號（可留白）</span><input id="nodeCode" value="${esc(n.code)}" maxlength="24" ${mode==='sim'?'disabled':''}></label><div class="field-row"><label class="field"><span>X 位置</span><input id="nodeX" type="number" min="-40000" max="40000" value="${n.x}" ${mode==='sim'?'disabled':''}></label><label class="field"><span>Y 位置</span><input id="nodeY" type="number" min="-40000" max="40000" value="${n.y}" ${mode==='sim'?'disabled':''}></label></div>${isValve||isSource?`<div class="property-state"><span>${isValve?'閥門狀態':isGround?'端點來油':'油槽供油'} · ${(isValve?n.open:sourceEnabled(n))?'開啟':'關閉'}</span><button class="switch ${(isValve?n.open:sourceEnabled(n))?'on':''}" id="propertyToggle" role="switch" aria-checked="${!!(isValve?n.open:sourceEnabled(n))}" aria-label="${isValve?'閥門開關':isGround?'端點來油開關':'油槽供油開關'}"></button></div>`:''}<div class="section-title">連通狀態<span style="color:${isValve&&n.open===false?'var(--muted)':fluidColor(flow.activeNodeFuels.get(n.id))}">${isValve&&n.open===false?'閥門關閉':flow.activeNodes.has(n.id)?'● '+fluidText(flow.activeNodeFuels.get(n.id)):'○ 未通油'}</span></div><div class="connection-detail">已連接 ${state.edges.filter(e=>e.from.node===n.id||e.to.node===n.id).length} 段油管<br>旋轉角度 ${n.rotation||0}°</div>${n.review||state.draftInfo?`<div class="review-field"><label class="review-checkbox"><input id="reviewConfirmed" type="checkbox" ${n.review?'':'checked'}>我已確認此元件</label><label class="field"><span>辨識／校正備註</span><textarea id="nodeNote" maxlength="400">${esc(n.note||'')}</textarea></label></div>`:''}<div class="property-actions"><button id="propertyRotate" class="button secondary" ${mode==='sim'?'disabled':''}>${icon('rotate')}旋轉 90°</button><button id="propertyDelete" class="button secondary" ${mode==='sim'?'disabled':''}>${icon('trash')}刪除</button></div><div class="flow-note"><div class="flow-note-title">${icon('info')}操作提示</div><p>${n.type==='ground'?'出土端預設可來油，入土端預設接收管線。可設定站名、油品及端點來油開關；未啟用的端點不會自行供油，但連上其他油源時仍會顯色。':n.type==='cap'?'盲封為封閉末端，只能接一段油管；與油源連通時仍會顯示對應油品顏色。':n.type==='pipe'?'可獨立擺放、調整長度與任意旋轉；兩端可以接管或留空，接上油源後整段會顯色。':n.type==='cross'?'四個接點彼此連通，可從任意方向供油或分流；直接交叉的管線仍不會自動連通。':n.type==='flowmeter'?'流量計可串接於油路，依油源顯色；此工具為通斷示意，不計算實際流量。':isValve?'切換開關後，與油槽斷開的下游油管會變為灰色。若有其他供油路徑，仍會保留對應的油品顏色。':'點選連接工具，再點擊元件的圓形接點，即可建立油管。'}</p></div>`;
 if($('nodeScale'))$('nodeScale').onchange=ev=>{const value=ev.target.valueAsNumber;if(Number.isFinite(value)&&value>=25&&value<=400)change(()=>n.scale=value/100);else renderInspector();};
 for(const [id,key] of [['tankInAngle','inAngle'],['tankOutAngle','outAngle']])if($(id))$(id).onchange=ev=>{const value=ev.target.valueAsNumber;if(Number.isFinite(value))change(()=>n[key]=normalizeAngle(value));else renderInspector();};
 if($('tankCapacity'))$('tankCapacity').onchange=ev=>{const raw=ev.target.value,value=Number(raw);if(raw===''){change(()=>delete n.capacity);}else if(Number.isFinite(value)&&value>=0&&value<=1e9){change(()=>n.capacity=value);}else renderInspector();};
 if($('groundStation'))$('groundStation').onchange=ev=>{const value=ev.target.value.trim();change(()=>n.station=value);};
 if($('tankFuel'))$('tankFuel').onchange=ev=>{const fuel=ev.target.value;change(()=>n.fuel=normalizeFuel(fuel));};
 if($('nodeVariant'))$('nodeVariant').onchange=ev=>{const value=ev.target.value;change(()=>n.variant=normalizeVariant(n.type,value));};
 if($('nodeType'))$('nodeType').onchange=ev=>{const value=ev.target.value;if(!Object.hasOwn(types,value)||state.edges.some(e=>e.from.node===n.id||e.to.node===n.id)){renderInspector();return;}change(()=>{n.type=value;n.variant=normalizeVariant(value,n.variant);if(value==='tank'||value==='ground'){n.enabled=false;n.fuel='fuel';if(value==='ground')n.station='';}if(value==='pipe'){n.length=160;n.kind='normal';}});};
 if($('reviewConfirmed'))$('reviewConfirmed').onchange=ev=>{const checked=ev.target.checked;change(()=>n.review=!checked);};
 if($('nodeNote'))$('nodeNote').onchange=ev=>{const note=ev.target.value;change(()=>n.note=note);};
 $('nodeAngle').onchange=ev=>{const value=Number(ev.target.value);if(Number.isFinite(value))change(()=>n.rotation=((value%360)+360)%360);else renderInspector();};
 if($('nodeLength'))$('nodeLength').onchange=ev=>{const value=Number(ev.target.value);if(Number.isFinite(value)&&value>=60&&value<=1600)change(()=>n.length=Math.round(value));else{renderInspector();notify('油管長度範圍為 60–1600');}};
 if($('nodePipeKind'))$('nodePipeKind').onchange=ev=>{const value=ev.target.value;change(()=>n.kind=Object.hasOwn(pipeKinds,value)?value:'normal');};
 $('nodeName').onchange=(ev)=>{change(()=>n.name=ev.target.value.trim());};$('nodeCode').onchange=(ev)=>{change(()=>n.code=ev.target.value.trim());};
 for(const axis of ['X','Y'])$('node'+axis).onchange=ev=>{const v=Number(ev.target.value);if(Number.isFinite(v)&&Math.abs(v)<=40000)change(()=>n[axis.toLowerCase()]=v);else renderInspector();};
 if($('propertyToggle'))$('propertyToggle').onclick=()=>isValve?toggleValve(n.id):change(()=>n.enabled=!sourceEnabled(n));
 $('propertyRotate').onclick=rotateSelected;$('propertyDelete').onclick=deleteSelected;
 }else if(e){
 const a=nodeById(e.from.node),b=nodeById(e.to.node);
 $('inspectorContent').innerHTML=`<div class="selected-type"><span class="component-icon">${icon('pipe')}</span><div><strong>連接油管</strong><small>${esc(e.id)}</small></div></div>${pipeOrderControls()}<label class="field"><span>管線型式</span><select id="edgeKind" class="fuel-select" aria-label="管線型式" ${mode==='sim'?'disabled':''}>${pipeKindOptions(e.kind||'normal')}</select></label><label class="field"><span>接管方式</span><select id="edgeRouting" class="fuel-select" aria-label="接管方式" ${mode==='sim'?'disabled':''}><option value="orthogonal" ${e.routing!=='free'?'selected':''}>直角接管</option><option value="free" ${e.routing==='free'?'selected':''}>自由斜走</option></select></label>${e.routing==='free'?`<div class="property-actions"><button id="addWaypoint" class="button secondary" ${mode==='sim'?'disabled':''}>＋ 新增轉折</button><button id="removeWaypoint" class="button secondary" ${mode==='sim'||selectedWaypoint?.edge!==e.id?'disabled':''}>刪除轉折</button></div><p class="connection-detail">${(e.waypoints||[]).length} 個轉折點 · 拖曳橘色圓點可調整，選取後按 Delete 刪除。</p>`:''}<div class="section-title">起點元件</div><div class="connection-detail">${esc(a?.name)} / ${e.from.port}</div><div class="section-title">終點元件</div><div class="connection-detail">${esc(b?.name)} / ${e.to.port}</div><div class="property-state"><span>連通狀態</span><strong style="font-size:11px;color:${fluidColor(flow.activeEdgeFuels.get(e.id))}">${flow.activeEdges.has(e.id)?'● '+fluidText(flow.activeEdgeFuels.get(e.id)):'○ 未通油'}</strong></div><div class="property-actions"><button id="propertyDelete" class="button secondary" ${mode==='sim'?'disabled':''}>${icon('trash')}刪除此油管</button></div><div class="flow-note"><div class="flow-note-title">${icon('info')}油管交叉</div><p>跨管在交叉處畫拱橋，地下管以虛線表示。管線交叉互不相通；需要相通時，在畫管模式點既有管線建立分支。顯示層級與型式不改變通斷判斷。</p></div>`;$('propertyDelete').onclick=deleteSelected;$('edgeKind').onchange=ev=>{const kind=ev.target.value;change(()=>e.kind=Object.hasOwn(pipeKinds,kind)?kind:'normal');};$('edgeRouting').onchange=ev=>{const routing=ev.target.value;change(()=>{e.routing=routing==='free'?'free':'orthogonal';e.waypoints||=[];selectedWaypoint=null;});};if($('addWaypoint'))$('addWaypoint').onclick=()=>addWaypoint(e);if($('removeWaypoint'))$('removeWaypoint').onclick=removeWaypoint;
 }else{
 const valves=state.nodes.filter(n=>n.type==='valve'),open=valves.filter(n=>n.open).length;
 $('inspectorContent').innerHTML=`<div class="overview-status"><span class="live-dot"></span><div><strong>即時模擬運作中</strong><small>每次開關，自動更新通油範圍</small></div></div><div class="metrics"><div class="metric"><span>通油管路</span><strong class="orange">${flow.activeEdges.size}<small>/ ${state.edges.length}</small></strong></div><div class="metric"><span>開啟閥門</span><strong>${open}<small>/ ${valves.length}</small></strong></div><div class="metric"><span>元件總數</span><strong>${state.nodes.length}<small>個</small></strong></div><div class="metric"><span>供油來源</span><strong>${state.nodes.filter(n=>isFuelSource(n)&&sourceEnabled(n)).length}<small>處</small></strong></div></div><div class="section-title">油品來源<span>OIL SOURCES</span></div><div class="source-list">${state.nodes.filter(n=>n.type==='tank'||(n.type==='ground'&&(n.variant!=='sink'||n.enabled===true))).map(n=>`<div class="source-row"><label class="fuel-label" for="source-${n.id}"><i class="fuel-dot ${normalizeFuel(n.fuel)}"></i><span>${esc(n.name)}</span></label><select class="fuel-select" id="source-${n.id}" data-source-fuel="${n.id}" aria-label="${esc(n.name)}油品" ${mode==='sim'?'disabled':''}>${fuelOptions(n.fuel,true)}</select></div>`).join('')||'<p class="connection-detail">新增油槽或出土端後可設定油品。</p>'}</div>${[...flow.activeEdgeFuels.values()].some(f=>f.size>1)?'<p class="fuel-label mixed-note">多色管線：多種油源同時連通，未計算混油比例。</p>':''}<div class="section-title">閥門控制<span>${valves.length.toString().padStart(2,'0')} VALVES</span></div><div class="valve-list">${valves.length?valves.map(n=>`<div class="valve-row"><button class="valve-name" data-select="${n.id}" title="選取${esc(n.name)}">${icon('valve')}<span>${esc(n.name)}</span></button><span class="valve-state ${n.open?'on':''}">${n.open?'開啟':'關閉'}</span><button class="switch ${n.open?'on':''}" data-switch="${n.id}" role="switch" aria-checked="${!!n.open}" aria-label="${esc(n.name)}開關"></button></div>`).join(''):'<p class="connection-detail">加入閥門，即可在這裡控制。</p>'}</div><div class="flow-note"><div class="flow-note-title">${icon('spark')}試著關閉主供油閥</div><p>看看橘色油路如何變化。重新開啟閥門，連通的管路就會恢復顏色。</p></div>`;
 $('inspectorContent').querySelectorAll('[data-source-fuel]').forEach(el=>el.onchange=()=>{const n=nodeById(el.dataset.sourceFuel),fuel=el.value;change(()=>n.fuel=normalizeFuel(fuel));});
 $('inspectorContent').querySelectorAll('[data-switch]').forEach(el=>el.onclick=()=>toggleValve(el.dataset.switch));$('inspectorContent').querySelectorAll('[data-select]').forEach(el=>el.onclick=()=>{selected={kind:'node',id:el.dataset.select};render();});
 }
 const pipeTarget=n?.type==='pipe'?{kind:'node',id:n.id}:e?{kind:'edge',id:e.id}:null;
 if(pipeTarget){$('pipeToTop').onclick=()=>changePipeOrder(pipeTarget,'top');$('pipeToBottom').onclick=()=>changePipeOrder(pipeTarget,'bottom');}
}
function render(){renderGraph();renderInspector();projectLibrary?.sync();operationPanel?.sync();}
function toggleValve(id){const n=nodeById(id);if(n?.type==='valve'){change(()=>n.open=!n.open);}}
function rotateSelected(){if(mode==='sim')return;const n=selected?.kind==='node'?nodeById(selected.id):null;if(n)change(()=>n.rotation=((n.rotation||0)+90)%360);}
function deleteSelected(){if(!selected||mode==='sim')return;const s=selected;change(()=>{if(s.kind==='node'){state.nodes=state.nodes.filter(n=>n.id!==s.id);state.edges=state.edges.filter(e=>e.from.node!==s.id&&e.to.node!==s.id);}else state.edges=state.edges.filter(e=>e.id!==s.id);selected=null;selectedWaypoint=null;clearDraft();});}
function setTool(value){tool=value;clearDraft();selectedWaypoint=null;renderGraph();}
function setMode(value){transformControls?.cancel();mode=value;document.body.dataset.workspace=mode==='sim'?'operate':'edit';selected=null;$('editMode').classList.toggle('active',mode==='edit');$('simMode').classList.toggle('active',mode==='sim');$('editMode').setAttribute('aria-pressed',String(mode==='edit'));$('simMode').setAttribute('aria-pressed',String(mode==='sim'));$('newPipeKind').disabled=mode==='sim';$('freeRouteBtn').disabled=mode==='sim';document.querySelectorAll('.component-card').forEach(el=>{el.draggable=mode==='edit';el.disabled=mode==='sim';});setTool('select');render();if(mode==='sim')notify('作業模式：可選作業或調整閥門，管線與元件位置已鎖定');}
function applyView(){const box=$('canvasWrap').getBoundingClientRect();if(!box.width||!box.height)return;view.h=view.w*box.height/box.width;$('canvas').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);$('zoomValue').textContent=Math.round(1200/view.w*100)+'%';transformControls?.render();}
function fit(){
 const box=$('canvasWrap').getBoundingClientRect(),ratio=box.width/box.height;if(!ratio)return;
 if(!state.nodes.length&&!state.reference){view={x:0,y:0,w:1200,h:1200/ratio};applyView();return;}
 const referencePoints=state.reference?[{x:state.reference.x||0,y:state.reference.y||0},{x:(state.reference.x||0)+state.reference.width,y:(state.reference.y||0)+state.reference.height}]:[];
 const points=referencePoints.concat(state.nodes.flatMap(n=>n.type==='text'?textMarkBounds(n).map(p=>({x:n.x+(p.x-n.x)*nodeScale(n),y:n.y+(p.y-n.y)*nodeScale(n)})):n.type==='pipe'?[n,portInfo(n,'in'),portInfo(n,'out')]:[{x:n.x-63*nodeScale(n),y:n.y-76*nodeScale(n)},{x:n.x+63*nodeScale(n),y:n.y+76*nodeScale(n)}]).concat(state.edges.flatMap(e=>e.routing==='free'?e.waypoints||[]:[])));
 const minX=Math.min(...points.map(p=>p.x))-115,maxX=Math.max(...points.map(p=>p.x))+115,minY=Math.min(...points.map(p=>p.y))-170,maxY=Math.max(...points.map(p=>p.y))+175;
 const w=Math.max(maxX-minX,(maxY-minY)*ratio);view={x:(minX+maxX-w)/2,y:(minY+maxY-w/ratio)/2-30,w,h:w/ratio};applyView();
}
function point(event){const p=new DOMPoint(event.clientX,event.clientY);return p.matrixTransform($('canvas').getScreenCTM().inverse());}
function zoom(factor,center){const p=center||{x:view.x+view.w/2,y:view.y+view.h/2};const next=Math.max(250,Math.min(Math.max(40000,view.w),view.w*factor)),k=next/view.w;view.x=p.x-(p.x-view.x)*k;view.y=p.y-(p.y-view.y)*k;view.w=next;applyView();}
function snap(v){return grid?Math.round(v/20)*20:Math.round(v);}
function addNode(type,p,variant,centered=false){if(mode==='sim'){notify('請切換到編輯模式新增元件');return;}if(!types[type])return;if(state.nodes.length>=400){notify('圖面最多支援 400 個元件');return;}if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(centered?p.x:snap(p.x))>40000||Math.abs(centered?p.y:snap(p.y))>40000){notify('這個位置超出繪圖範圍，請將底圖移回中央後再加入元件');return;}const t=type==='ground'?{...types.ground,name:variant==='sink'?'入土端':'出土端'}:variant==='riser'&&type==='valve'?{...types[type],name:'立管閥'}:types[type],index=Math.max(0,...state.nodes.filter(n=>n.type===type).map(n=>Number(n.code?.split('-').pop())||0))+1;const n={id:'n'+crypto.randomUUID(),type,x:centered?p.x:snap(p.x),y:centered?p.y:snap(p.y),name:t.name,code:t.code+'-'+String(index).padStart(2,'0'),rotation:0,...(['valve','filter','ground'].includes(type)?{variant:normalizeVariant(type,variant)}:{}),...(type==='pipe'?{length:160,kind:newPipeKind}:{}),...(type==='valve'?{open:true}:{}),...(type==='tank'?{enabled:true,fuel:'fuel',inAngle:180,outAngle:0}:{}),...(type==='ground'?{enabled:variant!=='sink',fuel:'fuel',station:''}:{}),...(type==='text'?{name:'',code:'',...normalizeTextMark({text:'文字標記'})}:{})};change(()=>{state.nodes.push(n);selected={kind:'node',id:n.id};});notify(`已新增${t.name}`);}
function connectPort(owner,port){
 if(mode==='sim')return;
 const node=nodeById(owner);if(!node)return;
 if(port==='center'){
  port=['in','out'].find(side=>!state.edges.some(e=>[e.from,e.to].some(ep=>ep.node===owner&&ep.port===side))&&!(pendingPort?.node===owner&&pendingPort.port===side));
  if(!port){notify('立管閥兩端都已接管，請先移除要修改的油管');return;}
 }
 if(node.type==='tank'&&state.edges.some(e=>[e.from,e.to].some(ep=>ep.node===owner&&ep.port===port))){notify('這個油槽接管口已有油管；需要分支時可在既有管線上接出');return;}
 const ep={node:owner,port};
 if(node.type==='cap'&&state.edges.some(e=>e.from.node===owner||e.to.node===owner)){notify('盲封只能接一段油管，請先移除原連線');return;}
 if(!pendingPort){beginPipe(ep);return;}
 finishPipe(ep);
}
const svg=$('canvas');svg.dataset.tool='select';
transformControls=setupTransformControls({svg,getMode:()=>mode==='edit'&&!pendingPort&&tool!=='hand'?'edit':'sim',getSelected:()=>selected,getNode:nodeById,onBegin:()=>{const token={history:history.slice(),future:future.slice()};remember();clearDraft();return token;},onUpdate:()=>renderGraph(),onCommit:()=>{render();persist();},onCancel:(_node,token)=>{if(token){history=token.history;future=token.future;}render();}});
svg.addEventListener('pointerdown',ev=>{
 if(ev.button!==0&&ev.button!==1)return;
 canvasPointer=ev.pointerType==='touch'?null:{x:ev.clientX,y:ev.clientY};const p=point(ev);
 // Explicit panning takes priority over every interactive item, including ports.
 if(tool==='hand'||ev.button===1){ev.preventDefault();drag={kind:'pan',clientX:ev.clientX,clientY:ev.clientY,startX:view.x,startY:view.y};svg.setPointerCapture(ev.pointerId);updateCanvasIntent(ev.target);return;}
 const port=ev.target.closest('[data-port]');
 // A started connection stays active until an endpoint, Esc, or an explicit tool change.
 if(mode==='edit'&&pendingPort){
  ev.preventDefault();
  if(port){connectPort(port.dataset.owner,port.dataset.port);return;}
  const pipe=ev.target.closest('[data-edge]');
  if(pipe){const target=pipeTarget(pipe.dataset.edge,p);if(target)finishPipe(target);return;}
  if(!ev.target.closest('[data-node],[data-waypoint]'))addPipeBend({x:p.x,y:p.y,altKey:ev.altKey});
  updateCanvasIntent(ev.target);return;
 }
 const handle=ev.target.closest('[data-waypoint]');
 if(handle&&mode==='edit'){
  ev.preventDefault();const edge=state.edges.find(e=>e.id===handle.dataset.waypointOwner),index=Number(handle.dataset.waypoint),pos=point(ev);if(!edge?.waypoints?.[index])return;
  selected={kind:'edge',id:edge.id};selectedWaypoint={edge:edge.id,index};tool='select';drag={kind:'waypoint',edge:edge.id,index,startX:pos.x,startY:pos.y,x:edge.waypoints[index].x,y:edge.waypoints[index].y,moved:false};svg.setPointerCapture(ev.pointerId);render();return;
 }
 const toggle=ev.target.closest('[data-toggle]');if(toggle){ev.preventDefault();toggleValve(toggle.dataset.toggle);return;}
 if(port&&mode==='edit'){ev.preventDefault();connectPort(port.dataset.owner,port.dataset.port);return;}
 const nEl=ev.target.closest('[data-node]'),eEl=ev.target.closest('[data-edge]');
 if(nEl){
  selectedWaypoint=null;const n=nodeById(nEl.dataset.node);selected={kind:'node',id:n.id};
  if(mode==='sim'){drag={kind:'sim',id:n.id,cx:ev.clientX,cy:ev.clientY};}
  else{tool='select';drag={kind:'node',id:n.id,x:n.x,y:n.y,startX:p.x,startY:p.y,moved:false};}
  svg.setPointerCapture(ev.pointerId);render();return;
 }
 if(eEl){if(mode==='edit'&&tool==='pipe'){const target=pipeTarget(eEl.dataset.edge,p);if(target)beginPipe(target);return;}selectedWaypoint=null;selected={kind:'edge',id:eEl.dataset.edge};if(mode==='edit')tool='select';render();return;}
 if(mode==='edit'&&tool==='pipe'){beginPipe({point:{x:Math.max(-40000,Math.min(40000,snap(p.x))),y:Math.max(-40000,Math.min(40000,snap(p.y)))}});return;}
 selected=null;selectedWaypoint=null;render();
});
svg.addEventListener('pointermove',ev=>{
 canvasPointer=ev.pointerType==='touch'?null:{x:ev.clientX,y:ev.clientY};const p=point(ev);
 if(!drag){if(pendingPort)updateDraft(p);updateCanvasIntent(ev.target);return;}
 if(drag.kind==='pan'){const r=svg.getBoundingClientRect();view.x=drag.startX-(ev.clientX-drag.clientX)*view.w/r.width;view.y=drag.startY-(ev.clientY-drag.clientY)*view.h/r.height;applyView();if(pendingPort)updateDraft(point(ev));}
 if(drag.kind==='waypoint'){
  const edge=state.edges.find(e=>e.id===drag.edge);if(!edge?.waypoints?.[drag.index]){drag=null;return;}
  const dx=p.x-drag.startX,dy=p.y-drag.startY;if(!drag.moved&&Math.hypot(dx,dy)>3){remember();drag.moved=true;}
  if(drag.moved){edge.waypoints[drag.index]={x:Math.max(-40000,Math.min(40000,ev.altKey?Math.round(drag.x+dx):snap(drag.x+dx))),y:Math.max(-40000,Math.min(40000,ev.altKey?Math.round(drag.y+dy):snap(drag.y+dy)))};renderGraph();}
 }
 if(drag.kind==='node'){
 const n=nodeById(drag.id),dx=p.x-drag.startX,dy=p.y-drag.startY;if(!drag.moved&&Math.hypot(dx,dy)>3){remember();drag.moved=true;}
 if(drag.moved){n.x=snap(Math.max(-40000,Math.min(40000,drag.x+dx)));n.y=snap(Math.max(-40000,Math.min(40000,drag.y+dy)));renderGraph();}
 }
});
function endDrag(ev){
 canvasPointer=ev.pointerType==='touch'?null:{x:ev.clientX,y:ev.clientY};
 if(!drag){updateCanvasIntent();return;}
 const d=drag;drag=null;if((d.kind==='node'||d.kind==='waypoint')&&d.moved){render();persist();}
 if(d.kind==='sim'&&Math.hypot(ev.clientX-d.cx,ev.clientY-d.cy)<8)toggleValve(d.id);
 if(svg.hasPointerCapture(ev.pointerId))svg.releasePointerCapture(ev.pointerId);
 canvasPointer=ev.pointerType==='touch'?null:{x:ev.clientX,y:ev.clientY};updateCanvasIntent();
}
svg.addEventListener('pointerup',endDrag);
svg.addEventListener('pointercancel',ev=>{if((drag?.kind==='node'||drag?.kind==='waypoint')&&drag.moved){render();persist();}drag=null;canvasPointer=null;updateCanvasIntent();});
svg.addEventListener('pointerleave',()=>{canvasPointer=null;updateCanvasIntent();});
svg.addEventListener('dblclick',ev=>{if(mode==='sim'||pendingPort||tool==='hand')return;const n=ev.target.closest('[data-node]');if(n&&!ev.target.closest('[data-toggle]'))toggleValve(n.dataset.node);});
svg.addEventListener('contextmenu',ev=>{if(mode==='edit'&&pendingPort){ev.preventDefault();finishPipe();}});
svg.addEventListener('wheel',ev=>{ev.preventDefault();zoom(ev.deltaY>0?1.09:1/1.09,point(ev));},{passive:false});
svg.addEventListener('keydown',ev=>{if(ev.key!=='Enter'&&ev.key!==' ')return;if(pendingPort&&!ev.target.closest('[data-port]')){ev.preventDefault();return;}const handle=ev.target.closest('[data-waypoint]');if(handle&&mode==='edit'){ev.preventDefault();selected={kind:'edge',id:handle.dataset.waypointOwner};selectedWaypoint={edge:handle.dataset.waypointOwner,index:Number(handle.dataset.waypoint)};render();return;}const port=ev.target.closest('[data-port]'),toggle=ev.target.closest('[data-toggle]'),node=ev.target.closest('[data-node]'),edge=ev.target.closest('[data-edge]');ev.preventDefault();if(port)connectPort(port.dataset.owner,port.dataset.port);else if(toggle)toggleValve(toggle.dataset.toggle);else if(node){selectedWaypoint=null;selected={kind:'node',id:node.dataset.node};if(mode==='sim')toggleValve(node.dataset.node);else render();}else if(edge){selectedWaypoint=null;selected={kind:'edge',id:edge.dataset.edge};render();}});
document.querySelectorAll('[data-component]').forEach(el=>{el.addEventListener('dragstart',ev=>{ev.dataTransfer.setData('application/oil-component',el.dataset.component);ev.dataTransfer.setData('application/oil-variant',el.dataset.variant||'');ev.dataTransfer.effectAllowed='copy';});el.onclick=()=>{addNode(el.dataset.component,{x:view.x+view.w/2,y:view.y+view.h/2},el.dataset.variant,true);};});
$('canvasWrap').addEventListener('dragover',ev=>{ev.preventDefault();ev.dataTransfer.dropEffect='copy';});$('canvasWrap').addEventListener('drop',ev=>{ev.preventDefault();addNode(ev.dataTransfer.getData('application/oil-component'),point(ev),ev.dataTransfer.getData('application/oil-variant'));});
for(const t of ['select','pipe','hand'])$(t+'Tool').onclick=()=>{if(mode==='sim'&&t==='pipe'){notify('請切換到編輯模式連接油管');return;}setTool(t);};
$('freeRouteBtn').onclick=()=>{if(mode==='sim')return;newRouting=newRouting==='free'?'orthogonal':'free';draftPointer=null;applyRoutingMode();updateDraft();notify(newRouting==='free'?'自由斜走：接管途中點畫布加入轉折':'已切換為直角接管');};
applyRoutingMode();
$('newPipeKind').onchange=ev=>{newPipeKind=ev.target.value;notify('新增油管：'+pipeKinds[newPipeKind]);};
$('editMode').onclick=()=>setMode('edit');$('simMode').onclick=()=>setMode('sim');$('rotateBtn').onclick=rotateSelected;$('deleteBtn').onclick=deleteSelected;
function undo(){if(!history.length)return;future.push(clone(state));const preserveOperations=!!projectLibrary?.context(),operations=state.operations;state=history.pop();if(preserveOperations){if(operations)state.operations=operations;else delete state.operations;}const name=projectLibrary?.context()?.name;if(name)state.title=name;selected=null;selectedWaypoint=null;clearDraft();render();persist();}
function redo(){if(!future.length)return;history.push(clone(state));const preserveOperations=!!projectLibrary?.context(),operations=state.operations;state=future.pop();if(preserveOperations){if(operations)state.operations=operations;else delete state.operations;}const name=projectLibrary?.context()?.name;if(name)state.title=name;selected=null;selectedWaypoint=null;clearDraft();render();persist();}
$('undoBtn').onclick=undo;$('redoBtn').onclick=redo;
$('gridBtn').onclick=()=>{grid=!grid;$('gridBtn').classList.toggle('active',grid);$('gridBackground').setAttribute('fill',grid?'url(#dots)':'var(--diagram-surface)');notify(grid?'格點吸附已開啟':'格點吸附已關閉');};
$('zoomIn').onclick=()=>zoom(1/1.2);$('zoomOut').onclick=()=>zoom(1.2);$('fitBtn').onclick=fit;
$('allOpenBtn').onclick=()=>{change(()=>state.nodes.filter(n=>n.type==='valve').forEach(n=>n.open=true));notify('所有閥門已開啟');};$('allCloseBtn').onclick=()=>{change(()=>state.nodes.filter(n=>n.type==='valve').forEach(n=>n.open=false));notify('所有閥門已關閉');};
function confirmReplace(title,fn,description,{referenceChoice=false}={}){$('confirmTitle').textContent=title;$('confirmDialog').querySelector('p').textContent=description||'目前設計會被取代，建議先匯出專案保留備份。';$('referenceApplyOptions').hidden=!referenceChoice;$('keepCurrentComponents').checked=true;$('confirmDialog').showModal();$('confirmOk').onclick=()=>{const keep=$('keepCurrentComponents').checked;$('confirmDialog').close();fn(keep);};}
function loadExample(){confirmReplace('載入範例油路？',()=>{projectLibrary?.detach();change(()=>{state=sample();selected=null;pendingPort=null;});setMode('edit');fit();notify('已載入範例，試試關閉主供油閥');});}
$('exampleBtn').onclick=loadExample;$('emptyExample').onclick=loadExample;
function startNewDrawing(){transformControls?.cancel();$('projectLibraryDialog').close();projectLibrary?.detach();change(()=>{state=createBlankDrawing();selected=null;selectedWaypoint=null;drag=null;clearDraft();});pasteSequence=0;setMode('edit');fit();notify('已開啟空白新圖面，可按復原還原剛才的畫布');}
$('clearBtn').onclick=startNewDrawing;$('newDrawingBtn').onclick=startNewDrawing;$('projectLibraryNewBtn').onclick=startNewDrawing;
$('confirmCancel').onclick=()=>$('confirmDialog').close();
for(const id of ['helpBtn','tutorialBtn'])$(id).onclick=()=>$('helpDialog').showModal();for(const id of ['closeHelp','startBtn'])$(id).onclick=()=>$('helpDialog').close();
$('inspectorToggle').onclick=()=>$('inspector').classList.toggle('show');$('closeInspector').onclick=()=>$('inspector').classList.remove('show');
document.addEventListener('keydown',ev=>{
 if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='s'&&!document.querySelector('dialog[open]')){ev.preventDefault();mode==='sim'?$('saveOperationBtn').click():projectLibrary?.open({focusName:true});return;}
 if(/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)||ev.target.isContentEditable||document.querySelector('dialog[open]'))return;
 if((ev.ctrlKey||ev.metaKey)&&['c','v'].includes(ev.key.toLowerCase())){
  ev.preventDefault();if(mode!=='edit'){notify('請切換到編修圖面後複製貼上');return;}
  try{
   if(ev.key.toLowerCase()==='c'){
    if(selected?.kind==='node'){componentClipboard=copyComponent(nodeById(selected.id));}
    else if(selected?.kind==='edge'){const edge=state.edges.find(e=>e.id===selected.id);componentClipboard=copyPipeSegment(edge,edgePoints(edge));}
    else{notify('請先選取元件或一段油管');return;}
    pasteSequence=0;notify('已複製，按 Ctrl+V 貼到畫面中央');
   }else{
    if(!componentClipboard){notify('請先選取元件並按 Ctrl+C');return;}
    transformControls?.cancel();const offset={x:pasteSequence*20,y:pasteSequence*20};
    const options={position:{x:view.x+view.w/2,y:view.y+view.h/2},offset};
    const pasted=componentClipboard.clipboardType==='pipe-segment'?pastePipeSegment(state,componentClipboard,options):pasteComponent(state,componentClipboard,options);
    change(()=>{state=pasted.project;selected={kind:pasted.edgeId?'edge':'node',id:pasted.edgeId||pasted.nodeId};selectedWaypoint=null;clearDraft();tool='select';});pasteSequence++;notify('已貼上，可直接拖曳調整位置');
   }
  }catch(error){notify(error.message);}
  return;
 }
 if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='z'){ev.preventDefault();ev.shiftKey?redo():undo();return;}
 if(ev.key==='Escape'){selected=null;selectedWaypoint=null;setTool('select');renderInspector();return;}
 if(ev.key==='Delete'||ev.key==='Backspace'){ev.preventDefault();if(!removeWaypoint())deleteSelected();}
 if(ev.key.toLowerCase()==='r')rotateSelected();
 if(ev.key.toLowerCase()==='v')setTool('select');if(ev.key.toLowerCase()==='c'&&mode==='edit')setTool('pipe');if(ev.key.toLowerCase()==='h')setTool('hand');
});
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('exportMenu').hidden=true;}
$('exportBtn').onclick=()=>{$('exportMenu').hidden=!$('exportMenu').hidden;};document.addEventListener('click',ev=>{if(!ev.target.closest('.export-wrap'))$('exportMenu').hidden=true;});
const projectFilename=(name,extension)=>`${String(name||'油路設計圖').replace(/[\\/:*?"<>|]/g,'_')}.${extension}`;
$('exportJson').onclick=()=>{download(JSON.stringify({version:1,title:'油路設計圖',...state},null,2),projectFilename(state.title,'json'),'application/json');notify('專案已匯出，可重新匯入繼續編輯');};
$('exportSvg').onclick=()=>{
 const copy=svg.cloneNode(true);
 // Freeze the current palette so the downloaded SVG is self-contained in either theme.
 const originals=[svg,...svg.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];
 const properties=['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','filter','opacity','color','font-family','font-size','font-weight','letter-spacing','paint-order'];
 originals.forEach((original,index)=>{const computed=getComputedStyle(original);for(const property of properties)copies[index].style.setProperty(property,computed.getPropertyValue(property).replace(/url\([\"']?[^)\"']*#([^\"')]+)[\"']?\)/g,'url(#$1)'));});
 copy.querySelectorAll('.port,.pipe-hit,.selection-box,.draft-pipe,.flow-dashes,.standalone-pipe-hit,.text-mark-hit,.text-mark-selection,#waypointLayer,#draftPoints,#transformLayer').forEach(el=>el.remove());
 copy.querySelectorAll('[tabindex]').forEach(el=>el.removeAttribute('tabindex'));
 copy.setAttribute('width','1600');copy.setAttribute('height',Math.round(1600*view.h/view.w));
 const background=document.createElementNS('http://www.w3.org/2000/svg','rect');
 background.setAttribute('x',view.x);background.setAttribute('y',view.y);background.setAttribute('width',view.w);background.setAttribute('height',view.h);
 background.setAttribute('fill',getComputedStyle(document.documentElement).getPropertyValue('--diagram-surface').trim());
 copy.insertBefore(background,copy.querySelector('#gridBackground'));
 download(new XMLSerializer().serializeToString(copy),projectFilename(state.title,'svg'),'image/svg+xml');notify('已匯出目前畫面 SVG 圖檔');
};

function validateProject(input){
 if(!input||!Array.isArray(input.nodes)||!Array.isArray(input.edges))throw Error('檔案須包含 nodes 與 edges 陣列');
 if(input.nodes.length>400||input.edges.length>1600)throw Error('專案最多支援 400 個元件、1600 段油管');
 const safeId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
 const ids=new Set();const nodes=input.nodes.map(n=>{if(!n||!safeId(n.id)||ids.has(n.id)||!Object.hasOwn(types,n.type)||!Number.isFinite(n.x)||!Number.isFinite(n.y)||Math.abs(n.x)>40000||Math.abs(n.y)>40000)throw Error('元件資料不完整或位置超出範圍');ids.add(n.id);return {id:n.id,type:n.type,x:n.x,y:n.y,name:String(n.name??types[n.type].name).slice(0,40),code:String(n.code??types[n.type].code).slice(0,24),note:String(n.note||'').slice(0,400),review:n.review===true,...(['valve','filter','ground'].includes(n.type)?{variant:normalizeVariant(n.type,n.variant)}:{}),rotation:Number.isFinite(n.rotation)?((n.rotation%360)+360)%360:0,scale:nodeScale(n),...(n.type==='tank'?normalizeTankPorts(n):{}),...(n.type==='pipe'?{length:pipeLength(n),kind:Object.hasOwn(pipeKinds,n.kind)?n.kind:'normal',...(n.layer!==undefined?{layer:normalizePipeLayer(n.layer)}:{})}:{}),...(n.type==='valve'?{open:n.open!==false}:{}),...(n.type==='text'?normalizeTextMark(n):{}),...(n.type==='ground'?{enabled:n.enabled===true,fuel:normalizeFuel(n.fuel),station:String(n.station??'').slice(0,80)}:{}),...(n.type==='tank'?{enabled:n.enabled!==false,fuel:normalizeFuel(n.fuel),...(Number.isFinite(n.capacity)&&n.capacity>=0&&n.capacity<=1e9?{capacity:n.capacity}:{})}:{})};});
 const byId=new Map(nodes.map(n=>[n.id,n])),edgeIds=new Set();const edges=input.edges.map(e=>{const valid=ep=>ep&&byId.has(ep.node)&&types[byId.get(ep.node).type].ports.includes(ep.port);if(!e||!safeId(e.id)||edgeIds.has(e.id)||!valid(e.from)||!valid(e.to)||e.from.node===e.to.node)throw Error('油管接點無效或有重複編號');edgeIds.add(e.id);if(e.waypoints!=null&&!Array.isArray(e.waypoints))throw Error('油管轉折點資料無效');const waypoints=e.waypoints||[];if(waypoints.length>100||waypoints.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>40000||Math.abs(p.y)>40000))throw Error('油管轉折點資料無效或超過範圍');return {id:e.id,from:{node:e.from.node,port:e.from.port},to:{node:e.to.node,port:e.to.port},kind:Object.hasOwn(pipeKinds,e.kind)?e.kind:'normal',...(e.layer!==undefined?{layer:normalizePipeLayer(e.layer)}:{}),routing:e.routing==='free'?'free':'orthogonal',waypoints:waypoints.map(p=>({x:p.x,y:p.y}))};});const capConnections=new Map();for(const e of edges){for(const end of [e.from,e.to])if(byId.get(end.node).type==='cap'){const count=(capConnections.get(end.node)||0)+1;if(count>1)throw Error('盲封只能連接一段油管');capConnections.set(end.node,count);}}let reference=null;
 if(input.reference!=null)reference=normalizeReference(input.reference);
 const draftInfo=input.draftInfo&&typeof input.draftInfo==='object'?{kind:'image',title:String(input.draftInfo.title||input.title||'圖片草稿').slice(0,80),notice:String(input.draftInfo.notice||'圖片草稿，請人工核對元件與連線。').slice(0,500),reviewNotes:Array.isArray(input.draftInfo.reviewNotes)?input.draftInfo.reviewNotes.slice(0,20).map(v=>String(v).slice(0,500)):[]}:null;
 const operations=normalizeOperations(input.operations);
 return {nodes,edges,...(operations.length?{operations}:{}),...(reference?{reference}:{}),...(draftInfo?{draftInfo}:{}),...(input.title?{title:String(input.title).slice(0,80)}:{})};
}
$('importBtn').onclick=()=>$('fileInput').click();$('fileInput').onchange=async ev=>{const file=ev.target.files[0];if(!file)return;if(isPdfFile(file)){ev.target.value='';$('imageDialog').showModal();await prepareImage(file);return;}try{if(file.size>6e6)throw Error('專案檔超過 6 MB');const next=validateProject(JSON.parse(await file.text()));confirmReplace('匯入這份油路專案？',()=>{projectLibrary?.detach();change(()=>{state=next;selected=null;pendingPort=null;});setMode('edit');fit();notify('專案已匯入');});}catch(err){notify('匯入失敗：'+(err instanceof SyntaxError?'請選擇有效的 JSON 專案檔':err.message));}ev.target.value='';};
projectLibrary=setupProjectLibrary({
 getProject:()=>state,normalizeProject:validateProject,isOperationMode:()=>mode==='sim',
 onChange:()=>{operationPanel?.refreshDiagrams();},
 onOperationsSaved:operations=>{state.operations=operations;render();persist();},
 setProject:next=>{state=next;history=[];future=[];selected=null;selectedWaypoint=null;drag=null;clearDraft();setMode('sim');fit();persist();},
 setTitle:title=>{state.title=title;projectLibrary?.sync();persist();},
 confirm:(title,description,action)=>confirmReplace(title,action,description),notify,
 downloadProject:(project,name)=>download(JSON.stringify({version:1,...project},null,2),projectFilename(name,'json'),'application/json')
});
operationPanel=setupOperationPanel({getProject:()=>state,getMode:()=>mode,library:projectLibrary,
 apply:next=>{change(()=>{state=next;selected=null;selectedWaypoint=null;clearDraft();});setMode('sim');},
 edit:()=>setMode('edit'),operate:()=>setMode('sim'),confirm:(title,description,action)=>confirmReplace(title,action,description),notify
});
function renderReference(){
 const r=state.reference;
 $('referenceControls').hidden=!r;
 $('refLayoutBtn').disabled=mode!=='edit';$('refLayoutBtn').title=mode==='edit'?'調整底圖尺寸與位置':'請先切換到編修圖面';
 $('referenceLayer').innerHTML=r&&r.visible!==false?`<image class="reference-image" href="${esc(r.dataUrl)}" x="${r.x||0}" y="${r.y||0}" width="${r.width}" height="${r.height}" opacity="${r.opacity??.22}" preserveAspectRatio="none"/>`:'';
 if(r){$('refToggleBtn').textContent=r.visible===false?'顯示底圖':'隱藏底圖';$('refToggleBtn').setAttribute('aria-pressed',String(r.visible!==false));$('refOpacity').value=r.opacity??.22;}
}
function renderDraftInfo(){
 const info=state.draftInfo,remaining=state.nodes.filter(n=>n.review).length;
 $('draftBanner').hidden=!info;
 if(info)$('draftBannerText').textContent=`${info.title||'圖片草稿'} · ${remaining} 個待確認 · 管線請人工核對`;
 const heading=document.querySelector('.canvas-header h1');if(heading?.firstChild?.nodeType===3)heading.firstChild.textContent=(state.title||'油路設計圖')+' ';
}
$('refToggleBtn').onclick=()=>{if(!state.reference)return;state.reference.visible=state.reference.visible===false;renderReference();persist();};
$('refOpacity').oninput=ev=>{if(!state.reference)return;state.reference.opacity=Number(ev.target.value);renderReference();persist();};
$('refRemoveBtn').onclick=()=>{if(state.reference)change(()=>delete state.reference);};
function referenceLayoutValues(){
 const scale=$('referenceScale').valueAsNumber,x=$('referenceX').valueAsNumber,y=$('referenceY').valueAsNumber;
 return {scale,x,y,moveLayout:$('referenceMoveLayout').checked};
}
function updateReferenceSizeInfo(){
 const r=state.reference;if(!r)return;
 const scale=$('referenceScale').valueAsNumber;
 const base=normalizeReference(r);
 $('referenceSizeInfo').textContent=Number.isFinite(scale)?`底圖尺寸：${Math.round(base.baseWidth*scale/100)} × ${Math.round(base.baseHeight*scale/100)} · 保持原圖比例`:'請輸入底圖大小';
 document.querySelectorAll('[data-reference-scale]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.referenceScale)===scale)));
 $('referenceLayoutMessage').textContent='';
}
$('refLayoutBtn').onclick=()=>{
 if(!state.reference||mode!=='edit')return;
 const r=normalizeReference(state.reference);
 $('referenceScale').value=Number((r.width/r.baseWidth*100).toFixed(2));
 $('referenceX').value=r.x;$('referenceY').value=r.y;
 $('referenceMoveLayout').checked=state.nodes.length>0;
 updateReferenceSizeInfo();$('referenceLayoutDialog').showModal();
};
$('referenceScale').oninput=updateReferenceSizeInfo;
for(const axis of ['X','Y'])$('reference'+axis).oninput=()=>{$('referenceLayoutMessage').textContent='';};
$('referenceMoveLayout').onchange=()=>{$('referenceLayoutMessage').textContent='';};
document.querySelectorAll('[data-reference-scale]').forEach(button=>button.onclick=()=>{$('referenceScale').value=button.dataset.referenceScale;updateReferenceSizeInfo();});
for(const id of ['closeReferenceLayout','cancelReferenceLayout'])$(id).onclick=()=>$('referenceLayoutDialog').close();
$('referenceLayoutForm').onsubmit=ev=>{
 ev.preventDefault();if(mode!=='edit'||!state.reference)return;
 try{
  const next=transformReference(state,referenceLayoutValues());
  change(()=>{state=next;selected=null;selectedWaypoint=null;drag=null;clearDraft();});
  $('referenceLayoutDialog').close();fit();notify('已調整底圖，可按復原還原；記得儲存管線圖');
 }catch(error){$('referenceLayoutMessage').textContent=error.message;}
};

$('draftNotesBtn').onclick=()=>{const info=state.draftInfo;if(!info)return;$('draftNotesTitle').textContent=info.title||'圖片草稿核對事項';$('draftNotesList').innerHTML=[info.notice,...(info.reviewNotes||[])].filter(Boolean).map(note=>`<li>${esc(note)}</li>`).join('');$('draftNotesDialog').showModal();};
$('closeDraftNotes').onclick=()=>$('draftNotesDialog').close();
let imageSourceFile=null,imageFile=null,imagePreviewData=null,pendingImageDraft=null,imageJob=null,imageBusy=false,imageReferenceOnly=false;
function imageProgress(progress){$('imageProgressWrap').hidden=false;$('imageProgress').value=Math.round(Math.max(0,Math.min(1,progress.progress||0))*100);$('imageStatus').textContent=progress.message||'正在處理圖片…';}
function setImageBusy(busy){imageBusy=busy;$('imageInput').disabled=busy;$('pdfPage').disabled=busy;$('pdfRotation').disabled=busy;$('recognizeImageBtn').disabled=busy||!imageFile;$('traceOnlyBtn').disabled=busy||!imagePreviewData;$('imageApplyBtn').disabled=busy||!pendingImageDraft;$('cancelImageJob').hidden=!busy;$('imageDropZone').setAttribute('aria-busy',String(busy));}
function displayImageDraft(draft,referenceOnly=false){
 imageReferenceOnly=referenceOnly;
 pendingImageDraft=validateProject({...draft,title:draft.title||draft.draftInfo?.title||'圖片草稿',draftInfo:{...draft.draftInfo,kind:'image'}});
 $('imageResults').hidden=false;$('imageResultSummary').textContent=`${pendingImageDraft.nodes.length} 個元件候選 · 產生後可逐一調整與確認`;
 $('imageCandidates').innerHTML=pendingImageDraft.nodes.slice(0,60).map(n=>`<span class="candidate-chip" title="${esc(n.note||'請核對元件種類與位置')}">${esc(n.code)} · ${types[n.type].name} <small>待確認</small></span>`).join('')||'<p class="draft-note">沒有找到可辨識的元件編號，可保留底圖並從元件庫補上。</p>';
 if(pendingImageDraft.nodes.length>60)$('imageCandidates').insertAdjacentHTML('beforeend',`<span class="candidate-chip">另有 ${pendingImageDraft.nodes.length-60} 個候選</span>`);
 $('imageApplyBtn').textContent=referenceOnly?'套用底圖':pendingImageDraft.nodes.length?'建立元件草稿':'建立底圖草稿';setImageBusy(false);
}
async function prepareImage(file,{page=1,rotation=0}={}){
 imageSourceFile=file;$('pdfControls').hidden=!isPdfFile(file);
 imageJob?.abort();imageFile=null;imagePreviewData=null;pendingImageDraft=null;$('imageResults').hidden=true;$('imagePreviewWrap').hidden=true;
 const controller=new AbortController();imageJob=controller;setImageBusy(true);
 try{const result=await readImage(file,{page,rotation,signal:controller.signal,onProgress:imageProgress});if(controller.signal.aborted)return;imageFile=file;imagePreviewData=result;if(result.pdf){$('pdfPage').max=result.pdf.pageCount;$('pdfPage').value=result.pdf.page;$('pdfPageCount').textContent=`／ ${result.pdf.pageCount} 頁`;$('pdfRotation').value=String(result.pdf.rotation);} $('imagePreview').src=result.reference.dataUrl;$('imagePreviewWrap').hidden=false;$('imageProgressWrap').hidden=true;}
 catch(error){if(error.name!=='AbortError'){imageProgress({progress:0,message:error.message});}}
 finally{if(imageJob===controller){imageJob=null;setImageBusy(false);}}
}
$('imageImportBtn').onclick=()=>$('imageDialog').showModal();
const refreshPdfPreview=()=>{if(!imageSourceFile||!isPdfFile(imageSourceFile)||imageBusy)return;prepareImage(imageSourceFile,{page:$('pdfPage').valueAsNumber,rotation:Number($('pdfRotation').value)});};
$('pdfPage').onchange=refreshPdfPreview;$('pdfRotation').onchange=refreshPdfPreview;
$('closeImageDialog').onclick=()=>$('imageDialog').close();
$('imageDialog').addEventListener('close',()=>imageJob?.abort());
$('imageInput').onchange=ev=>{const file=ev.target.files[0];if(file)prepareImage(file);ev.target.value='';};
$('imageDropZone').addEventListener('dragover',ev=>{ev.preventDefault();});
$('imageDropZone').addEventListener('drop',ev=>{ev.preventDefault();ev.stopPropagation();if(!imageBusy&&ev.dataTransfer.files[0])prepareImage(ev.dataTransfer.files[0]);});
$('cancelImageJob').onclick=()=>{imageJob?.abort();imageProgress({progress:0,message:'已取消，可重新辨識或只載入底圖。'});};
$('traceOnlyBtn').onclick=()=>{if(!imagePreviewData)return;displayImageDraft({nodes:[],edges:[],reference:imagePreviewData.reference,draftInfo:{title:imageFile?.name?.replace(/\.[^.]+$/,'')||'圖片底圖',notice:'已載入參考底圖，請從元件庫拖入元件並人工接管。',reviewNotes:['底圖本身不參與通油判斷；只有編輯器中的元件與油管會參與運算。']}},true);};
$('recognizeImageBtn').onclick=async()=>{
 if(!imageFile||imageBusy)return;const controller=new AbortController();imageJob=controller;pendingImageDraft=null;setImageBusy(true);
 try{const result=await analyzePreparedImage(imagePreviewData,{signal:controller.signal,onProgress:imageProgress});if(controller.signal.aborted)return;displayImageDraft(result);imageProgress({progress:1,message:`辨識完成：${result.nodes.length} 個候選，請建立草稿後核對。`});}
 catch(error){if(error.name!=='AbortError')imageProgress({progress:0,message:error.message});}
 finally{if(imageJob===controller){imageJob=null;setImageBusy(false);}}
};
function loadDraft(draft,keepActive=false){const next=validateProject(draft);if(!keepActive)projectLibrary?.detach();change(()=>{state=next;selected=null;selectedWaypoint=null;clearDraft();});setMode('edit');fit();notify('圖面已套用，可對照底圖編修；按復原可還原');}
$('imageApplyBtn').onclick=()=>{if(!pendingImageDraft)return;const draft=clone(pendingImageDraft),referenceOnly=imageReferenceOnly;$('imageDialog').close();if(referenceOnly){confirmReplace('在目前畫布套用底圖？',keep=>{const next=applyReference(state,draft.reference,{keepComponents:keep,title:draft.title,draftInfo:draft.draftInfo});loadDraft(next,keep);},'選擇是否保留目前的元件與油管；底圖只供對照，不參與通油運算。',{referenceChoice:true});}else confirmReplace('建立圖片草稿？',()=>loadDraft(draft));};
async function offerLinkedDraft(){
 const encoded=new URLSearchParams(location.hash.slice(1)).get('draft');if(!encoded)return;
 try{if(encoded.length>200000)throw Error('草稿連結過長');let b64=encoded.replace(/-/g,'+').replace(/_/g,'/');while(b64.length%4)b64+='=';const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));const text=await new Response(stream).text();if(text.length>6e6)throw Error('草稿超過範圍');const next=validateProject(JSON.parse(text));window.history.replaceState(null,'',location.pathname+location.search);confirmReplace(`載入「${next.title||'圖片草稿'}」？`,()=>loadDraft(next));}
 catch(error){notify('無法讀取草稿連結：'+error.message);}
}

window.addEventListener('hashchange',offerLinkedDraft);
let loaded=false,workingProjectContext=null;try{const raw=localStorage.getItem(STORAGE);if(raw){const parsed=JSON.parse(raw);state=validateProject(parsed);workingProjectContext=parsed._savedDrawing;loaded=true;}}catch{}if(!loaded)state=sample();setMode('sim');if(loaded)projectLibrary.restore(workingProjectContext);
const resizeObserver=new ResizeObserver(()=>{applyView();});resizeObserver.observe($('canvasWrap'));requestAnimationFrame(fit);offerLinkedDraft();
setupFeedback({apiBase:'https://oil-flow-feedback-8c41.sacredzebra19.chatgpt.site',notify});
// Expose serializable diagnostics for local QA without changing project data.
window.oilFlowDiagnostics=()=>({nodes:state.nodes.length,edges:state.edges.length,activeEdges:flow.activeEdges.size,activePorts:[...flow.activePorts],edgeFuels:Object.fromEntries([...flow.activeEdgeFuels].map(([id,fuels])=>[id,[...fuels].sort()])),nodeTypes:Object.fromEntries(state.nodes.map(n=>[n.id,n.type])),nodeFuels:Object.fromEntries([...flow.activeNodeFuels].map(([id,fuels])=>[id,[...fuels].sort()])),pipeKinds:Object.fromEntries(state.edges.map(e=>[e.id,e.kind||'normal'])),edgeRoutes:Object.fromEntries(state.edges.map(e=>[e.id,{routing:e.routing||'orthogonal',waypoints:(e.waypoints||[]).map(p=>({...p}))}])),edgeDirections:Object.fromEntries(flow.edgeDirections),nodeDirections:Object.fromEntries(flow.nodeDirections),nodeGeometry:Object.fromEntries(state.nodes.map(n=>[n.id,{x:n.x,y:n.y,rotation:n.rotation||0,scale:nodeScale(n),...(n.type==='tank'?normalizeTankPorts(n):{}),ports:Object.fromEntries((types[n.type].ports||[]).map(p=>[p,portInfo(n,p)]))}])),selected:selected?{...selected}:null,view:{...view},newRouting,draftWaypointCount:draftWaypoints.length,mode,tool,effectiveTool:$('canvas').dataset.tool,pendingPort:pendingPort?{...pendingPort}:null});

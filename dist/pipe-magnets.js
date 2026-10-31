import {componentPort,nodeScale,normalizeAngle} from './component-geometry.js?v=tank3000-flange-1';

/* Explicit endpoint drags join graph ports; visual crossings never connect. */
const magnetPorts={point:['joint'],tank:['in','out'],ground:['port'],pipe:['in','out'],cap:['in'],
 valve:['in','out'],filter:['in','out'],flowmeter:['in','out'],elbow:['in','out'],
 junction:['in','out','branch'],cross:['in','out','branch','top'],outlet:['in'],text:[]};
const magnetClone=value=>typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
const magnetId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const magnetCoordinate=value=>Number.isFinite(value)&&Math.abs(value)<=40000;
const magnetSame=(a,b)=>a?.node===b?.node&&a?.port===b?.port;
const magnetClamp=value=>Math.max(-40000,Math.min(40000,value));

function magnetProject(project){
 if(!project||!Array.isArray(project.nodes)||!Array.isArray(project.edges)||project.nodes.length>400||project.edges.length>1600)throw new Error('圖面資料無效或已超出數量上限');
 const nodes=new Map(),edges=new Set();
 for(const n of project.nodes){if(!n||!magnetId(n.id)||nodes.has(n.id)||!Object.hasOwn(magnetPorts,n.type)||!magnetCoordinate(n.x)||!magnetCoordinate(n.y))throw new Error('圖面元件資料無效');nodes.set(n.id,n);}
 for(const e of project.edges){if(!e||!magnetId(e.id)||edges.has(e.id)||!magnetEndpoint(nodes,e.from)||!magnetEndpoint(nodes,e.to)||e.from.node===e.to.node)throw new Error('圖面油管接點資料無效');edges.add(e.id);}
 return nodes;
}
function magnetEndpoint(nodes,ep){return !!ep&&nodes.has(ep.node)&&magnetPorts[nodes.get(ep.node).type]?.includes(ep.port);}
function magnetCount(project,ep,ignoreEdgeId){return project.edges.filter(e=>e.id!==ignoreEdgeId&&(magnetSame(e.from,ep)||magnetSame(e.to,ep))).length;}
function magnetTarget(project,nodes,target,{ignoreEdgeId,sourceNodeId,otherNodeId}={}){
 if(!target||!nodes.has(target.node)||target.node===sourceNodeId||target.node===otherNodeId)throw new Error('請選擇另一個元件的接管點');
 const node=nodes.get(target.node);let port=target.port;
 if(node.type==='valve'&&node.variant==='riser'&&port==='center')port=['in','out'].find(p=>!magnetCount(project,{node:node.id,port:p},ignoreEdgeId));
 const ep={node:node.id,port};if(!magnetEndpoint(nodes,ep))throw new Error('這個接管點無法連接');
 const count=magnetCount(project,ep,ignoreEdgeId);
 if(count&&(node.type==='tank'||node.type==='cap'||node.type==='valve'&&node.variant==='riser'))throw new Error('這個接管點已接管，請選擇另一個接點');
 return ep;
}
function assertMagnetEdgeUnique(project,edgeId,from,to){
 if(from.node===to.node)throw new Error('請連接不同的元件');
 if(project.edges.some(e=>e.id!==edgeId&&(magnetSame(e.from,from)&&magnetSame(e.to,to)||magnetSame(e.from,to)&&magnetSame(e.to,from))))throw new Error('這兩個接點已經連接');
}

/** Rebind a free drawn-pipe endpoint, removing only its now-unused point node. */
export function reconnectPipeEndpoint(project,{edgeId,end,target}={}){
 const nodes=magnetProject(project),edge=project.edges.find(e=>e.id===edgeId);
 if(!edge||!['from','to'].includes(end))throw new Error('請先選擇可移動的管線端點');
 const old=edge[end],node=nodes.get(old.node),other=edge[end==='from'?'to':'from'];
 if(node.type!=='point'||magnetCount(project,old)!==1)throw new Error('只有單一管段的自由端可直接改接');
 const ep=magnetTarget(project,nodes,target,{ignoreEdgeId:edge.id,sourceNodeId:node.id,otherNodeId:other.node});
 const from=end==='from'?ep:edge.from,to=end==='to'?ep:edge.to;
 assertMagnetEdgeUnique(project,edge.id,from,to);
 const next=magnetClone(project),changed=next.edges.find(e=>e.id===edge.id);changed[end]={...ep};
 if(!next.edges.some(e=>e.from.node===node.id||e.to.node===node.id))next.nodes=next.nodes.filter(n=>n.id!==node.id);
 return {project:next};
}

/** Resize/turn a standalone pipe around its opposite fixed endpoint. */
export function fitStandalonePipeEndpoint(project,{nodeId,port,targetPosition,target,idFactory}={}){
 const nodes=magnetProject(project),node=nodes.get(nodeId);
 if(node?.type!=='pipe'||!['in','out'].includes(port))throw new Error('請選擇直油管的接點');
 if(magnetCount(project,{node:nodeId,port}))throw new Error('這一端已接管，請先移除原連線');
 let ep;if(target){ep=magnetTarget(project,nodes,target,{sourceNodeId:nodeId});targetPosition=componentPort(nodes.get(ep.node),ep.port);}
 if(!targetPosition||!magnetCoordinate(targetPosition.x)||!magnetCoordinate(targetPosition.y))throw new Error('管端位置超出繪圖範圍');
 const other=componentPort(node,port==='in'?'out':'in'),scale=nodeScale(node);
 const dx=targetPosition.x-other.x,dy=targetPosition.y-other.y,length=Math.hypot(dx,dy)/scale;
 if(!Number.isFinite(length)||length<60-1e-6||length>1600+1e-6)throw new Error('直油管長度須介於 60 至 1600，請調整端點位置');
 const x=(other.x+targetPosition.x)/2,y=(other.y+targetPosition.y)/2;
 if(!magnetCoordinate(x)||!magnetCoordinate(y))throw new Error('元件位置超出繪圖範圍');
 const next=magnetClone(project),changed=next.nodes.find(n=>n.id===nodeId);
 Object.assign(changed,{x,y,length:Math.max(60,Math.min(1600,length)),rotation:normalizeAngle(Math.atan2(port==='in'?-dy:dy,port==='in'?-dx:dx)*180/Math.PI)});
 let edgeId;
 if(ep){
  if(next.edges.length>=1600)throw new Error('圖面最多支援 1600 段油管');
  const from={node:nodeId,port};assertMagnetEdgeUnique(project,null,from,ep);
  if(idFactory!==undefined&&typeof idFactory!=='function')throw new Error('油管編號產生方式無效');
  edgeId=idFactory?idFactory('p'):'p'+crypto.randomUUID();
  if(!magnetId(edgeId)||next.nodes.some(n=>n.id===edgeId)||next.edges.some(e=>e.id===edgeId))throw new Error('新油管編號無效或重複');
  // This explicit zero-length link joins the coincident physical ports in the graph.
  next.edges.push({id:edgeId,from,to:{...ep},routing:'free',waypoints:[],kind:'normal'});
 }
 return {project:next,...(edgeId?{edgeId}:{})};
}

/** Screen-radius snapping is independent of zoom, rotation and component scale. */
export function findMagneticPort(project,{position,sourceNodeId,otherNodeId,ignoreEdgeId,radius=14,screenScale=1,getPortNames}={}){
 const nodes=new Map(project.nodes.map(n=>[n.id,n]));let best=null;
 if(!position||!Number.isFinite(position.x)||!Number.isFinite(position.y)||!Number.isFinite(radius)||radius<=0||!Number.isFinite(screenScale)||screenScale<=0)return null;
 for(const node of project.nodes){
  if(node.id===sourceNodeId||node.id===otherNodeId)continue;
  const ports=getPortNames?.(node)||((node.type==='valve'&&node.variant==='riser')?['center']:magnetPorts[node.type]||[]);
  for(const port of ports){
   let ep;try{ep=magnetTarget(project,nodes,{node:node.id,port},{sourceNodeId,otherNodeId,ignoreEdgeId});}catch{continue;}
   const point=componentPort(node,ep.port);if(!point||!magnetCoordinate(point.x)||!magnetCoordinate(point.y))continue;
   const distance=Math.hypot(position.x-point.x,position.y-point.y)*screenScale;
   if(distance<=radius&&(!best||distance<best.distance))best={...ep,position:{x:point.x,y:point.y},distance};
  }
 }
 return best;
}

/** Only free pipe ends intercept dragging. A stationary click keeps the C workflow. */
export function setupPipeEndpointDrag({svg,getMode,getProject,portInfo=componentPort,getPortNames,getPending=()=>null,
 onPreview=()=>{},onCommit=()=>{},onCancel=()=>{},onClick=()=>{},onStart=()=>{},notify=()=>{}}={}){
 if(!svg||typeof getMode!=='function'||typeof getProject!=='function')throw new Error('管端磁吸尚未連接畫布');
 const namespace='http://www.w3.org/2000/svg';let layer=svg.querySelector('#pipeMagnetLayer');
 if(!layer){layer=document.createElementNS(namespace,'g');layer.id='pipeMagnetLayer';svg.append(layer);}
 let session=null;
 const world=event=>new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
 const scale=()=>{const m=svg.getScreenCTM();return m?Math.max(.000001,Math.hypot(m.a,m.b)):1;};
 function clearHighlight(){svg.querySelectorAll('.magnet-target').forEach(el=>el.classList.remove('magnet-target'));layer.replaceChildren();}
 function render(){
  clearHighlight();if(!session?.target)return;
  const target=session.target,node=getProject().nodes.find(n=>n.id===target.node),position=portInfo(node,target.port),u=1/scale();
  if(!position)return;
  const ring=document.createElementNS(namespace,'circle');ring.setAttribute('class','pipe-magnet-ring');ring.setAttribute('cx',position.x);ring.setAttribute('cy',position.y);ring.setAttribute('r',10*u);ring.setAttribute('vector-effect','non-scaling-stroke');
  ring.dataset.magnetOwner=target.node;ring.dataset.magnetPort=target.port;layer.append(ring);
  for(const el of svg.querySelectorAll('[data-port]'))if(el.dataset.owner===target.node&&(el.dataset.port===target.port||el.dataset.port==='center'))el.classList.add('magnet-target');
 }
 function release(pointerId){try{if(svg.hasPointerCapture(pointerId))svg.releasePointerCapture(pointerId);}catch{}}
 function cancel(){if(!session)return false;const old=session;session=null;release(old.pointerId);clearHighlight();onCancel(old.original);return true;}
 function stop(event){event.preventDefault();event.stopImmediatePropagation();}
 function sourceDescriptor(project,owner,port){
  const node=project.nodes.find(n=>n.id===owner);if(!node)return null;
  if(node.type==='point'){
   const connected=project.edges.filter(e=>e.from.node===owner||e.to.node===owner);if(connected.length!==1)return null;
   const edge=connected[0],end=edge.from.node===owner?'from':'to';
   return {kind:'point',nodeId:owner,port:'joint',edgeId:edge.id,end,otherNodeId:edge[end==='from'?'to':'from'].node};
  }
  if(node.type==='pipe'&&['in','out'].includes(port)&&!magnetCount(project,{node:owner,port}))return {kind:'pipe',nodeId:owner,port};
  return null;
 }
 svg.addEventListener('pointerdown',event=>{
  if(event.button!==0||getMode()!=='edit'||getPending())return;
  const port=event.target.closest('[data-port]');if(!port)return;
  const project=getProject(),info=sourceDescriptor(project,port.dataset.owner,port.dataset.port);if(!info)return;
  stop(event);cancel();onStart(info);
  session={...info,original:magnetClone(project),pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY,previewed:false,moved:false,target:null,next:null};
  svg.setPointerCapture(event.pointerId);
 },true);
 svg.addEventListener('pointermove',event=>{
  if(!session||session.pointerId!==event.pointerId)return;stop(event);
  if(getMode()!=='edit'||getPending()){cancel();return;}
  if(!session.moved&&Math.hypot(event.clientX-session.clientX,event.clientY-session.clientY)<4)return;
  session.moved=true;const position=world(event),p={x:magnetClamp(position.x),y:magnetClamp(position.y)};
  let target=findMagneticPort(session.original,{position:p,sourceNodeId:session.nodeId,otherNodeId:session.otherNodeId,
   ignoreEdgeId:session.edgeId,radius:14,screenScale:scale(),getPortNames});
  let next;
  try{
   if(session.kind==='point'){
    next=magnetClone(session.original);Object.assign(next.nodes.find(n=>n.id===session.nodeId),target?.position||p);
   }else{
    try{next=fitStandalonePipeEndpoint(session.original,{nodeId:session.nodeId,port:session.port,targetPosition:target?.position||p}).project;}
    catch(error){if(!target)throw error;target=null;next=fitStandalonePipeEndpoint(session.original,{nodeId:session.nodeId,port:session.port,targetPosition:p}).project;}
   }
   session.target=target;session.next=next;session.previewed=true;onPreview(next);render();
  }catch{session.target=null;render();}
 },true);
 svg.addEventListener('pointerup',event=>{
  if(!session||session.pointerId!==event.pointerId)return;stop(event);
  const ended=session;session=null;release(ended.pointerId);clearHighlight();
  if(!ended.moved){onClick(ended.nodeId,ended.port);return;}
  if(!ended.previewed){onCancel(ended.original);notify('端點位置無效，請調整管長或放開位置');return;}
  try{
   let next=ended.next,edgeId;
   if(ended.target){
    if(ended.kind==='point')next=reconnectPipeEndpoint(ended.original,{edgeId:ended.edgeId,end:ended.end,target:ended.target}).project;
    else{const result=fitStandalonePipeEndpoint(ended.original,{nodeId:ended.nodeId,port:ended.port,targetPosition:ended.target.position,target:ended.target});next=result.project;edgeId=result.edgeId;}
   }
   onCommit(ended.original,next,{kind:ended.kind,nodeId:ended.nodeId,edgeId:edgeId||ended.edgeId,connected:!!ended.target,target:ended.target});
  }catch(error){onCancel(ended.original);notify(error.message);}
 },true);
 svg.addEventListener('pointercancel',event=>{if(session&&event.pointerId===session.pointerId){stop(event);cancel();}},true);
 svg.addEventListener('lostpointercapture',()=>{if(session)cancel();});
 document.addEventListener('keydown',event=>{if(!session)return;if(event.key==='Escape'){stop(event);cancel();}else if(!['Shift','Alt','Control','Meta'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();}},true);
 window.addEventListener('blur',()=>cancel());
 return {render,cancel,get active(){return !!session;}};
}

import {nodeScale,maxNodeScale,normalizeAngle,normalizeTankPorts} from './component-geometry.js?v=tank3000-flange-1';

/* Editing handles live above the drawing, separate from the oil connection ports. */
const transformNamespace='http://www.w3.org/2000/svg';
const transformFields=['rotation','scale','inAngle','outAngle'];
const transformClamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const transformRound=value=>Math.round(value*1000)/1000;

export function setupTransformControls({svg,getMode,getSelected,getNode,onBegin=()=>{},onUpdate=()=>{},onCommit=()=>{},onCancel=()=>{}}) {
  if(!svg||typeof getMode!=='function'||typeof getSelected!=='function'||typeof getNode!=='function')throw new Error('元件調整控制尚未連接畫布');
  let layer=svg.querySelector('#transformLayer');
  if(!layer){layer=document.createElementNS(transformNamespace,'g');layer.id='transformLayer';svg.append(layer);}
  layer.classList.add('transform-layer');
  let session=null,rendering=false;
  function element(name,attributes={},text) {
    const el=document.createElementNS(transformNamespace,name);
    for(const [key,value] of Object.entries(attributes))el.setAttribute(key,String(value));
    if(text!=null)el.textContent=String(text);
    return el;
  }
  function unit() {
    const matrix=svg.getScreenCTM();
    return matrix?1/Math.max(.0001,Math.hypot(matrix.a,matrix.b)):1;
  }
  function world(event) {
    const matrix=svg.getScreenCTM();
    return matrix?new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()):null;
  }
  function selectedNode() {
    const selected=getSelected();
    return getMode()==='edit'&&selected?.kind==='node'?getNode(selected.id):null;
  }
  function nodeElement(node) {return [...svg.querySelectorAll('[data-node]')].find(el=>el.dataset.node===node.id);}
  function bounds(node) {
    const owner=nodeElement(node),glyph=owner?.querySelector('.node-symbol,.text-mark-content')||owner;
    try{
      const box=glyph.getBBox(),rootMatrix=svg.getScreenCTM(),matrix=glyph.getScreenCTM();
      if(rootMatrix&&matrix&&box.width>=0&&box.height>=0){
        const local=rootMatrix.inverse().multiply(matrix);
        const points=[[box.x,box.y],[box.x+box.width,box.y],[box.x+box.width,box.y+box.height],[box.x,box.y+box.height]]
          .map(([x,y])=>new DOMPoint(x,y).matrixTransform(local));
        if(points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))return {
          left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),
          top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
      }
    }catch{}
    const radius=(node.type==='tank'?50:40)*nodeScale(node);
    return {left:node.x-radius,right:node.x+radius,top:node.y-radius,bottom:node.y+radius};
  }
  function handle(action,node,x,y,label,shape='square',extraClass='') {
    const u=unit(),g=element('g',{'class':'transform-control '+extraClass,'data-transform-action':action,
      'data-transform-owner':node.id,transform:`translate(${x} ${y})`,role:'button',tabindex:0,'aria-label':label});
    g.append(element('title',{},label),element('circle',{'class':'transform-hit',r:11*u}));
    const common={'class':'transform-handle','vector-effect':'non-scaling-stroke'};
    if(shape==='circle')g.append(element('circle',{...common,r:6*u}));
    else if(shape==='diamond')g.append(element('path',{...common,d:`M0 ${-6*u}L${6*u} 0 0 ${6*u} ${-6*u} 0Z`}));
    else g.append(element('rect',{...common,x:-4.5*u,y:-4.5*u,width:9*u,height:9*u,rx:1*u}));
    layer.append(g);return g;
  }
  function release(pointerId) {try{if(svg.hasPointerCapture(pointerId))svg.releasePointerCapture(pointerId);}catch{}}
  function snapshot(node) {
    return Object.fromEntries(transformFields.map(key=>[key,{present:Object.hasOwn(node,key),value:node[key]}]));
  }
  function restore(node,values) {
    for(const key of transformFields){if(values[key].present)node[key]=values[key].value;else delete node[key];}
  }
  function cancel() {
    if(!session)return false;
    const ended=session;session=null;const node=getNode(ended.id);
    if(node&&ended.changed){restore(node,ended.before);onCancel(node,ended.token);onUpdate(node);}
    release(ended.pointerId);render();return true;
  }
  function render() {
    if(rendering)return;
    rendering=true;
    try{
      const node=selectedNode();
      if(session&&(!node||node.id!==session.id)){rendering=false;cancel();return;}
      layer.replaceChildren();
      if(!node||node.type==='point')return;
      const u=unit(),body=bounds(node),padding=12*u;
      const left=body.left-padding,right=body.right+padding,top=body.top-padding,bottom=body.bottom+padding;
      layer.append(element('rect',{'class':'transform-frame',x:left,y:top,width:Math.max(right-left,1),height:Math.max(bottom-top,1),rx:3*u,'vector-effect':'non-scaling-stroke'}));
      const rotationX=node.x,rotationY=top-28*u;
      layer.append(element('path',{'class':'transform-leader',d:`M${rotationX} ${top}V${rotationY}`,'vector-effect':'non-scaling-stroke'}));
      const rotate=handle('rotate',node,rotationX,rotationY,'拖曳旋轉元件；Shift 每次 15°；方向鍵微調','circle','transform-rotate');
      rotate.append(element('text',{'class':'transform-caption',x:12*u,y:4*u,'font-size':10*u},session?.action==='rotate'?`${Math.round(normalizeAngle(node.rotation))}°`:'旋轉'));
      for(const [corner,x,y] of [['nw',left,top],['ne',right,top],['sw',left,bottom],['se',right,bottom]]){
        const control=handle('resize',node,x,y,`拖曳等比例縮放元件（25%～${maxNodeScale(node)*100}%）；方向鍵微調`,'square','transform-resize transform-resize-'+corner);
        if(corner==='se'&&session?.action==='resize')control.append(element('text',{'class':'transform-caption',x:10*u,y:15*u,'font-size':10*u},`${Math.round(nodeScale(node)*100)}%`));
      }
      if(node.type==='tank'){
        const angles=normalizeTankPorts(node);
        // Keep angle handles beyond every resize/rotation target. A rotated
        // tank outlet can lie on the same ray as a corner; overlapping targets
        // would otherwise turn a resize gesture into a nozzle adjustment.
        const mainRadius=Math.max(...[[left,top],[right,top],[left,bottom],[right,bottom],[rotationX,rotationY]]
          .map(([x,y])=>Math.hypot(x-node.x,y-node.y)));
        for(const [port,caption,offset] of [['in','A',26],['out','B',56]]){
          const angle=(angles[port+'Angle']+normalizeAngle(node.rotation))*Math.PI/180;
          const dx=Math.cos(angle),dy=Math.sin(angle),radius=50*nodeScale(node),r=Math.max(radius,mainRadius)+offset*u;
          const x=node.x+dx*r,y=node.y+dy*r;
          layer.append(element('path',{'class':'transform-leader transform-nozzle-leader',d:`M${node.x+dx*radius} ${node.y+dy*radius}L${x} ${y}`,'vector-effect':'non-scaling-stroke'}));
          const control=handle('tank-'+port,node,x,y,`拖曳調整油槽${port==='in'?'接管口 A':'接管口 B'}方位；Shift 每次 15°`,'diamond','transform-nozzle transform-nozzle-'+port);
          control.append(element('text',{'class':'transform-caption',x:dx>=0?10*u:-10*u,y:4*u,'text-anchor':dx>=0?'start':'end','font-size':11*u},caption));
        }
      }
    }finally{rendering=false;}
  }
  function stop(event) {event.preventDefault();event.stopImmediatePropagation();}
  svg.addEventListener('pointerdown',event=>{
    const control=event.target.closest('[data-transform-action]');
    if(!control||!layer.contains(control)||event.button!==0)return;
    const node=selectedNode(),position=world(event);
    if(!node||node.id!==control.dataset.transformOwner||!position)return;
    stop(event);cancel();
    session={id:node.id,action:control.dataset.transformAction,pointerId:event.pointerId,
      before:snapshot(node),rotation:normalizeAngle(node.rotation),scale:nodeScale(node),
      startAngle:Math.atan2(position.y-node.y,position.x-node.x),
      startRadius:Math.max(1,Math.hypot(position.x-node.x,position.y-node.y)),
      clientX:event.clientX,clientY:event.clientY,changed:false,token:undefined};
    svg.setPointerCapture(event.pointerId);
  },true);
  svg.addEventListener('pointermove',event=>{
    if(!session||session.pointerId!==event.pointerId)return;
    stop(event);const node=getNode(session.id),position=world(event);
    if(!node||!position||getMode()!=='edit'){cancel();return;}
    if(!session.changed&&Math.hypot(event.clientX-session.clientX,event.clientY-session.clientY)<2)return;
    let field,value;
    const angle=Math.atan2(position.y-node.y,position.x-node.x);
    if(session.action==='resize'){
      field='scale';value=transformRound(transformClamp(session.scale*Math.hypot(position.x-node.x,position.y-node.y)/session.startRadius,.25,maxNodeScale(node)));
    }else if(session.action==='rotate'){
      field='rotation';value=normalizeAngle(session.rotation+(angle-session.startAngle)*180/Math.PI);
      value=normalizeAngle(event.shiftKey?Math.round(value/15)*15:Math.round(value));
    }else{
      field=session.action==='tank-in'?'inAngle':'outAngle';value=normalizeAngle(angle*180/Math.PI-normalizeAngle(node.rotation));
      value=normalizeAngle(event.shiftKey?Math.round(value/15)*15:Math.round(value));
    }
    const oldValue=field==='scale'?nodeScale(node):field==='rotation'?normalizeAngle(node.rotation):normalizeTankPorts(node)[field];
    if(Math.abs(oldValue-value)<.0001)return;
    if(!session.changed){session.token=onBegin(node);session.changed=true;}
    node[field]=value;onUpdate(node);render();
  },true);
  svg.addEventListener('pointerup',event=>{
    if(!session||session.pointerId!==event.pointerId)return;
    stop(event);const ended=session;session=null;release(ended.pointerId);
    const node=getNode(ended.id);if(node&&ended.changed)onCommit(node,ended.token);render();
  },true);
  svg.addEventListener('pointercancel',event=>{if(session&&session.pointerId===event.pointerId){stop(event);cancel();}},true);
  svg.addEventListener('lostpointercapture',()=>{if(session)cancel();});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&session){stop(event);cancel();return;}
    // Finish or cancel a drag before an editor shortcut can replace its node.
    if(session&&!['Shift','Alt','Control','Meta'].includes(event.key)){event.stopImmediatePropagation();return;}
    const control=event.target.closest?.('[data-transform-action]');
    if(!control||!layer.contains(control)||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    const node=selectedNode();if(!node)return;
    stop(event);const direction=event.key==='ArrowRight'||event.key==='ArrowUp'?1:-1;
    const action=control.dataset.transformAction,field=action==='resize'?'scale':action==='rotate'?'rotation':action==='tank-in'?'inAngle':'outAngle';
    const oldValue=field==='scale'?nodeScale(node):field==='rotation'?normalizeAngle(node.rotation):normalizeTankPorts(node)[field];
    const value=field==='scale'?transformRound(transformClamp(oldValue+direction*.05,.25,maxNodeScale(node))):normalizeAngle(oldValue+direction*(event.shiftKey?15:1));
    if(oldValue===value)return;
    const token=onBegin(node);node[field]=value;onUpdate(node);onCommit(node,token);render();
    [...layer.querySelectorAll('[data-transform-action]')].find(el=>el.dataset.transformAction===action)?.focus();
  },true);
  window.addEventListener('blur',()=>cancel());
  render();
  return {render,cancel,get active(){return !!session;}};
}

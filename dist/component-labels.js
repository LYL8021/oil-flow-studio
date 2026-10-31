import {componentPort,nodeScale,normalizeAngle} from './component-geometry.js';

/* Identifier positions follow the visible glyph; they remain upright while it turns. */
function symbolBounds(node) {
  if (node.type === 'valve') {
    if (node.variant === 'riser') return [-35,-23,23,35];
    return [-36,node.variant === 'motor' ? -43 : -19,36,19];
  }
  const bounds = {
    ground:[-16,-10,16,10], filter:[-36,-22,36,22],
    flowmeter:[-36,-24,36,24], cap:[-28,-22,20,22],
    outlet:[-33,-21,21,21], elbow:[-9,-39,39,9],
    junction:[-33,-7,33,33], cross:[-33,-33,33,33],
    tank:[-50,-46,50,46]
  };
  return bounds[node.type] || [-32,-24,32,24];
}

function glyphBottom(node) {
  if (node.type === 'pipe') {
    const inlet=componentPort(node,'in'),outlet=componentPort(node,'out');
    // A standalone pipe uses the same fixed stroke width as connected pipes.
    return Math.max(inlet?.y-node.y || 0,outlet?.y-node.y || 0)+15;
  }
  const [left,top,right,bottom]=symbolBounds(node),scale=nodeScale(node);
  const radians=normalizeAngle(node.rotation)*Math.PI/180;
  const sin=Math.sin(radians),cos=Math.cos(radians);
  return Math.max(...[[left,top],[right,top],[right,bottom],[left,bottom]]
    .map(([x,y])=>(x*sin+y*cos)*scale));
}

/** Local coordinates for an upright identifier and a separate operation badge. */
export function identifierLayout(node,{operationMode=false}={}) {
  if (!node || node.type === 'text' || node.type === 'point') return null;
  const bottom=glyphBottom(node),y=Math.round((bottom+18)*100)/100;
  const hasIdentifier=String(node.code ?? '').trim().length>0;
  return {x:0,y,anchor:'middle',badgeY:Math.round((
    operationMode && node.type === 'valve' && !hasIdentifier ? bottom+10 : y+10
  )*100)/100};
}

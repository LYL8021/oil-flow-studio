/* Shared geometry for rendered symbols, connection ports and direct manipulation. */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clean = value => Math.abs(value) < 1e-10 ? 0 : value;

export function normalizeAngle(value, fallback = 0) {
  const angle = Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : 0;
  return clean(((angle % 360) + 360) % 360);
}

export function nodeScale(node) {
  if (node?.type === 'point') return 1;
  return Number.isFinite(node?.scale) ? clamp(node.scale, .25, 4) : 1;
}

/** Angles are relative to the tank; rotation moves both independently placed nozzles. */
export function normalizeTankPorts(node) {
  return {inAngle:normalizeAngle(node?.inAngle, 180), outAngle:normalizeAngle(node?.outAngle, 0)};
}

/** Return a connection's world position and outward unit direction, or null. */
export function componentPort(node, port) {
  if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return null;
  let local;
  const ports = {
    point:['joint'], tank:['in','out'], ground:['port'], pipe:['in','out'],
    cap:['in'], outlet:['in'], elbow:['in','out'], valve:['in','out'],
    filter:['in','out'], flowmeter:['in','out'], junction:['in','out','branch'],
    cross:['in','out','branch','top']
  };
  const central = node.type === 'valve' && node.variant === 'riser';
  if (!(central && port === 'center') && !ports[node.type]?.includes(port)) return null;
  if (node.type === 'point' || central) local=[0,0,port === 'in' ? -1 : port === 'out' ? 1 : 0,0];
  else if (node.type === 'tank') {
    const angles=normalizeTankPorts(node), angle=angles[port === 'in' ? 'inAngle' : 'outAngle']*Math.PI/180;
    const dx=clean(Math.cos(angle)),dy=clean(Math.sin(angle));local=[50*dx,50*dy,dx,dy];
  } else if (node.type === 'pipe') {
    const length=Number.isFinite(node.length)?clamp(Math.round(node.length),60,1600):160;
    local=port === 'in'?[-length/2,0,-1,0]:[length/2,0,1,0];
  } else if (node.type === 'cap') local=[-28,0,-1,0];
  else if (node.type === 'ground') local=node.variant === 'sink'?[-36,0,-1,0]:[36,0,1,0];
  else if (node.type === 'outlet') local=[-33,0,-1,0];
  else if (node.type === 'elbow') local=port === 'in'?[0,-32,0,-1]:[32,0,1,0];
  else if (node.type === 'junction' || node.type === 'cross') {
    local=port === 'in'?[-26,0,-1,0]:port === 'out'?[26,0,1,0]:port === 'top'?[0,-26,0,-1]:[0,26,0,1];
  } else local=port === 'in'?[-36,0,-1,0]:[36,0,1,0];
  const rotation=normalizeAngle(node.rotation)*Math.PI/180, cos=Math.cos(rotation),sin=Math.sin(rotation),scale=nodeScale(node);
  const x=(local[0]*cos-local[1]*sin)*scale,y=(local[0]*sin+local[1]*cos)*scale;
  return {x:node.x+Math.round(clean(x)*100)/100,y:node.y+Math.round(clean(y)*100)/100,
    dx:clean(local[2]*cos-local[3]*sin),dy:clean(local[2]*sin+local[3]*cos)};
}

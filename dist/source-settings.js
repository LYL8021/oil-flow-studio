/* Operational source roles are independent of equipment geometry and port IDs. */
const tankPortModes = new Set(['inlet','outlet','closed']);
const groundModes = new Set(['source','receive','idle']);

/** Missing counts belong to existing two-port drawings; C is explicitly enabled. */
export function tankPortCount(node) {
  return node?.portCount === 3 ? 3 : 2;
}

export function tankPortIds(node) {
  return tankPortCount(node) === 3 ? ['in','out','out2'] : ['in','out'];
}

export function normalizeTankPortModes(node) {
  const value=node?.portModes;
  return {in:tankPortModes.has(value?.in)?value.in:'inlet',
    out:tankPortModes.has(value?.out)?value.out:'outlet',
    ...(tankPortCount(node) === 3 ? {out2:tankPortModes.has(value?.out2)?value.out2:'outlet'} : {})};
}

export function normalizeGroundMode(node) {
  return groundModes.has(node?.flowMode)?node.flowMode:node?.enabled===true?'source':'receive';
}

/** A closed tank nozzle or idle station end neither supplies nor receives oil. */
export function inactiveSourcePort(node, port) {
  if(node?.type==='tank')return tankPortIds(node).includes(port)&&normalizeTankPortModes(node)[port]==='closed';
  return node?.type==='ground'&&port==='port'&&normalizeGroundMode(node)==='idle';
}

/** Physical port IDs remain stable when a special operation reverses their role. */
export function sourcePortsForNode(node) {
  if(node?.type==='ground')return normalizeGroundMode(node)==='source'?['port']:[];
  if(node?.type!=='tank'||node.enabled===false)return [];
  const modes=normalizeTankPortModes(node);
  return tankPortIds(node).filter(port=>modes[port]==='outlet');
}

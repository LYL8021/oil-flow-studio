/* Operational source roles are independent of equipment geometry and port IDs. */
const tankPortModes = new Set(['inlet','outlet','closed']);
const groundModes = new Set(['source','receive','idle']);

export function normalizeTankPortModes(node) {
  const value=node?.portModes;
  return {in:tankPortModes.has(value?.in)?value.in:'inlet',
    out:tankPortModes.has(value?.out)?value.out:'outlet'};
}

export function normalizeGroundMode(node) {
  return groundModes.has(node?.flowMode)?node.flowMode:node?.enabled===true?'source':'receive';
}

/** A closed tank nozzle or idle station end neither supplies nor receives oil. */
export function inactiveSourcePort(node, port) {
  if(node?.type==='tank')return ['in','out'].includes(port)&&normalizeTankPortModes(node)[port]==='closed';
  return node?.type==='ground'&&port==='port'&&normalizeGroundMode(node)==='idle';
}

/** Physical port IDs remain stable when a special operation reverses their role. */
export function sourcePortsForNode(node) {
  if(node?.type==='ground')return normalizeGroundMode(node)==='source'?['port']:[];
  if(node?.type!=='tank'||node.enabled===false)return [];
  const modes=normalizeTankPortModes(node);
  return ['in','out'].filter(port=>modes[port]==='outlet');
}

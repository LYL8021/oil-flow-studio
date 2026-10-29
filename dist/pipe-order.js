/* Pipe layers control drawing only; graph endpoints and flow remain unchanged. */
export function normalizePipeLayer(value) {
  return Number.isSafeInteger(value) && Math.abs(value) <= 10000 ? value : 0;
}

function automaticPipeRank(item) {
  return item.kind === 'bridge'
    ? item.group === 'node' ? 3 : 2
    : item.group === 'node' ? 0 : 1;
}

/** Return a stable back-to-front order without modifying the items or their array. */
export function pipeDrawOrder(items) {
  if (!Array.isArray(items)) throw new Error('管段顯示資料無效');
  const indexed = items.map((item, index) => {
    if (!item || (item.group !== 'edge' && item.group !== 'node')) {
      throw new Error('管段顯示資料無效');
    }
    return {item, index};
  });
  indexed.sort((a, b) => normalizePipeLayer(a.item.layer) - normalizePipeLayer(b.item.layer)
    || automaticPipeRank(a.item) - automaticPipeRank(b.item)
    || a.index - b.index);
  return indexed.map(entry => entry.item);
}

/** Move an entire selected pipe above/below the others, preserving all hydraulics. */
export function reorderPipes(project, target, placement) {
  if (!project || !Array.isArray(project.nodes) || !Array.isArray(project.edges)) {
    throw new Error('圖面資料須包含元件與油管');
  }
  if (!target || (target.kind !== 'edge' && target.kind !== 'node')
      || typeof target.id !== 'string' || !target.id) {
    throw new Error('請先選取要調整層級的管段');
  }
  if (placement !== 'top' && placement !== 'bottom') {
    throw new Error('請選擇管段顯示在上層或下層');
  }
  let next;
  try {
    next = typeof structuredClone === 'function'
      ? structuredClone(project) : JSON.parse(JSON.stringify(project));
  } catch {
    throw new Error('圖面資料無法複製，尚未調整管段層級');
  }
  const items = [];
  for (const node of next.nodes) {
    if (!node || typeof node !== 'object') throw new Error('元件資料無效');
    if (node.type === 'pipe') items.push({group:'node', id:node.id, kind:node.kind, layer:node.layer, value:node});
  }
  for (const edge of next.edges) {
    if (!edge || typeof edge !== 'object') throw new Error('油管資料無效');
    items.push({group:'edge', id:edge.id, kind:edge.kind, layer:edge.layer, value:edge});
  }
  const ordered = pipeDrawOrder(items);
  const index = ordered.findIndex(item => item.group === target.kind && item.id === target.id);
  if (index < 0) throw new Error('要調整的管段已不存在，請重新選取');
  const [selected] = ordered.splice(index, 1);
  if (placement === 'top') ordered.push(selected);
  else ordered.unshift(selected);
  if (ordered.length > 10001) throw new Error('管段數量超過可調整範圍');
  ordered.forEach((item, layer) => { item.value.layer = layer; });
  return next;
}

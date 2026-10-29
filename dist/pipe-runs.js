/* Continuous drawing commits one explicit graph change; visual crossings stay separate. */
const runPorts = {
  point: ['joint'], tank: ['out'], valve: ['in', 'out'], elbow: ['in', 'out'],
  filter: ['in', 'out'], flowmeter: ['in', 'out'], pipe: ['in', 'out'],
  cap: ['in'], junction: ['in', 'out', 'branch'],
  cross: ['in', 'out', 'branch', 'top'], outlet: ['in']
};
const validRunId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const runPoint = value => {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)
      || Math.abs(value.x) > 10000 || Math.abs(value.y) > 10000) {
    throw new Error('油管座標無效或超出繪圖範圍');
  }
  return {x: value.x, y: value.y};
};
const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sameRunEnd = (a, b) => a.node === b.node && a.port === b.port;
const copyRunProject = project => typeof structuredClone === 'function'
  ? structuredClone(project) : JSON.parse(JSON.stringify(project));
function cleanRunPath(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 102) {
    throw new Error('油管須有起點與終點，每段最多 100 個轉折點');
  }
  const result = [];
  for (const value of points) {
    const point = runPoint(value);
    if (!result.length || pointDistance(result.at(-1), point) > 1e-8) result.push(point);
  }
  if (result.length < 2) throw new Error('油管長度必須大於零');
  return result;
}

/**
 * points is the complete polyline, including the first and last coordinates.
 * Explicit endpoints are {node,port}, {point:{x,y}}, or {edge,point,path}.
 * The last form splits only the selected pipe; other visual crossings stay isolated.
 */
export function commitPipeRun(project, {start, end, points, kind = 'normal', idFactory} = {}) {
  if (!project || !Array.isArray(project.nodes) || !Array.isArray(project.edges)) {
    throw new Error('圖面資料須包含元件與油管');
  }
  if (project.nodes.length > 400 || project.edges.length > 1600) {
    throw new Error('圖面已超出元件或油管數量上限');
  }
  if (!['normal', 'bridge', 'underground'].includes(kind)) throw new Error('油管型式無效');
  if (idFactory != null && typeof idFactory !== 'function') throw new Error('油管編號產生方式無效');
  if (start?.edge && start.edge === end?.edge) {
    throw new Error('同一段油管上的兩個位置請分次接管');
  }
  let route = cleanRunPath(points);
  const next = copyRunProject(project);
  const nodeMap = new Map(), ids = new Set(), edgeIds = new Set();
  for (const node of next.nodes) {
    if (!node || !validRunId(node.id) || nodeMap.has(node.id) || !Object.hasOwn(runPorts, node.type)) {
      throw new Error('圖面有無效或重複的元件');
    }
    runPoint(node);nodeMap.set(node.id, node);ids.add(node.id);
  }
  const validEndpoint = value => value && nodeMap.has(value.node)
    && runPorts[nodeMap.get(value.node).type].includes(value.port);
  for (const edge of next.edges) {
    if (!edge || !validRunId(edge.id) || edgeIds.has(edge.id)
        || !validEndpoint(edge.from) || !validEndpoint(edge.to)) {
      throw new Error('圖面有無效或重複的油管接點');
    }
    edgeIds.add(edge.id);ids.add(edge.id);
  }
  const freshId = prefix => {
    const id = idFactory ? idFactory(prefix) : prefix + crypto.randomUUID();
    if (!validRunId(id) || ids.has(id)) throw new Error('新油管或接點編號重複，請重試');
    ids.add(id);return id;
  };
  const pointNode = point => {
    const node = {id: freshId('n'), type: 'point', ...runPoint(point), name: '', code: '', rotation: 0};
    next.nodes.push(node);nodeMap.set(node.id, node);
    return {endpoint: {node: node.id, port: 'joint'}, position: {x: node.x, y: node.y}};
  };
  const edgeFromPath = (edge, id, from, to, path) => {
    const cleaned = cleanRunPath(path);
    return {...edge, id, from: {...from}, to: {...to}, routing: 'free',
      waypoints: cleaned.slice(1, -1).map(point => ({...point}))};
  };
  const splitSelectedPipe = descriptor => {
    const edge = next.edges.find(candidate => candidate.id === descriptor.edge);
    if (!edge) throw new Error('要接上的油管已不存在，請重新選擇');
    const target = runPoint(descriptor.point), path = cleanRunPath(descriptor.path);
    let nearest = null;
    for (let index = 0; index < path.length - 1; index++) {
      const a = path[index], b = path[index + 1], dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((target.x-a.x)*dx+(target.y-a.y)*dy)/(dx*dx+dy*dy)));
      const point = {x: a.x + t*dx, y: a.y + t*dy};
      const distance = pointDistance(target, point);
      if (!nearest || distance < nearest.distance) nearest = {point, index, distance};
    }
    if (pointDistance(nearest.point, path[0]) <= .5) return {endpoint: {...edge.from}, position: path[0]};
    if (pointDistance(nearest.point, path.at(-1)) <= .5) return {endpoint: {...edge.to}, position: path.at(-1)};
    const attached = pointNode(nearest.point);
    const left = edgeFromPath(edge, edge.id, edge.from, attached.endpoint,
      [...path.slice(0, nearest.index + 1), nearest.point]);
    const right = edgeFromPath(edge, freshId('p'), attached.endpoint, edge.to,
      [nearest.point, ...path.slice(nearest.index + 1)]);
    const index = next.edges.indexOf(edge);next.edges.splice(index, 1, left, right);
    return attached;
  };
  const resolve = (descriptor, suppliedPosition) => {
    if (!descriptor || typeof descriptor !== 'object') throw new Error('請指定油管起點與終點');
    const forms = Number(Object.hasOwn(descriptor, 'node')) + Number(Object.hasOwn(descriptor, 'edge'))
      + Number(Object.hasOwn(descriptor, 'point') && !Object.hasOwn(descriptor, 'edge'));
    if (forms !== 1) throw new Error('油管接點資料無效');
    if (Object.hasOwn(descriptor, 'edge')) return splitSelectedPipe(descriptor);
    if (Object.hasOwn(descriptor, 'node')) {
      if (!validEndpoint(descriptor)) throw new Error('油管元件接點無效');
      return {endpoint: {node: descriptor.node, port: descriptor.port}, position: runPoint(suppliedPosition)};
    }
    return pointNode(descriptor.point);
  };
  const from = resolve(start, route[0]), to = resolve(end, route.at(-1));
  if (from.endpoint.node === to.endpoint.node) throw new Error('請連接不同的元件或管線接點');
  route = cleanRunPath([from.position, ...route.slice(1, -1), to.position]);
  if (next.edges.some(edge => sameRunEnd(edge.from, from.endpoint) && sameRunEnd(edge.to, to.endpoint)
      || sameRunEnd(edge.to, from.endpoint) && sameRunEnd(edge.from, to.endpoint))) {
    throw new Error('這兩個接點已經連接');
  }
  for (const endpoint of [from.endpoint, to.endpoint]) {
    const node = nodeMap.get(endpoint.node);
    const connected = next.edges.filter(edge => sameRunEnd(edge.from, endpoint) || sameRunEnd(edge.to, endpoint)).length;
    if (node.type === 'cap' && connected) throw new Error('盲封只能連接一段油管');
    if (node.type === 'valve' && node.variant === 'riser' && connected) {
      throw new Error('立管閥這一側已接管，請使用另一側或先移除原油管');
    }
  }
  const edgeId = freshId('p');
  next.edges.push(edgeFromPath({kind}, edgeId, from.endpoint, to.endpoint, route));
  if (next.nodes.length > 400 || next.edges.length > 1600) throw new Error('圖面最多支援 400 個元件、1600 段油管');
  return {project: next, edgeId};
}

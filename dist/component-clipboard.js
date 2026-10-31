import {normalizeTankPortModes} from './source-settings.js?v=source-1';

/* Component copies carry equipment settings, never existing graph connections. */
const clipboardTypes = new Set(['text','point','pipe','cap','flowmeter','tank','ground',
  'valve','elbow','filter','junction','cross','outlet']);
const clipboardId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const clipboardStrings = ['name','code','note','variant','kind','text','textColor','textAlign','fuel','station','flowMode'];
const clipboardBooleans = ['review','open','bold','enabled'];
const clipboardNumbers = ['rotation','scale','inAngle','outAngle','length','layer','fontSize','capacity'];
const clipboardCoordinate = value => Number.isFinite(value) && Math.abs(value) <= 40000;

function clipboardProjectIds(project) {
  const ids = new Set();
  for (const item of [...project.nodes, ...project.edges]) {
    if (!item || !clipboardId(item.id)) throw new Error('圖面有無效的元件或油管編號');
    ids.add(item.id);
  }
  return ids;
}

function clipboardFreshId(prefix, ids, idFactory) {
  let id;
  if (idFactory) id = idFactory(prefix);
  else {
    if (!globalThis.crypto?.randomUUID) throw new Error('目前瀏覽器無法產生新元件編號');
    id = prefix + crypto.randomUUID();
  }
  if (!clipboardId(id) || ids.has(id)) throw new Error('新元件編號重複或無效，請重試');
  ids.add(id);
  return id;
}

function clipboardCloneProject(project) {
  try {
    return typeof structuredClone === 'function' ? structuredClone(project) : JSON.parse(JSON.stringify(project));
  } catch { throw new Error('圖面資料無法複製，尚未貼上元件'); }
}

/** Take a detached snapshot of one component, including intentionally blank labels. */
export function copyComponent(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node) || !clipboardId(node.id)
      || !clipboardTypes.has(node.type) || !clipboardCoordinate(node.x) || !clipboardCoordinate(node.y)) {
    throw new Error('請先選取有效的元件，再複製');
  }
  const result = {id:node.id, type:node.type, x:node.x, y:node.y};
  for (const field of clipboardStrings) {
    if (node[field] === undefined) continue;
    if (typeof node[field] !== 'string') throw new Error('元件文字資料無效，無法複製');
    result[field] = node[field];
  }
  for (const field of clipboardBooleans) {
    if (node[field] === undefined) continue;
    if (typeof node[field] !== 'boolean') throw new Error('元件開關資料無效，無法複製');
    result[field] = node[field];
  }
  for (const field of clipboardNumbers) {
    if (node[field] === undefined) continue;
    if (!Number.isFinite(node[field])) throw new Error('元件幾何資料無效，無法複製');
    result[field] = node[field];
  }
  if (node.type === 'tank' && node.portModes !== undefined) {
    if (!node.portModes || typeof node.portModes !== 'object' || Array.isArray(node.portModes)) {
      throw new Error('油槽接管口用途資料無效，無法複製');
    }
    result.portModes = normalizeTankPortModes(node);
  }
  return result;
}

function clipboardPrefix(value, limit) {
  let result = '';
  for (const character of value) {
    if (result.length + character.length > limit) break;
    result += character;
  }
  return result;
}

function clipboardCode(value, nodes) {
  const original = typeof value === 'string' ? value : '';
  if (!original.trim()) return original;
  const key = code => code.normalize('NFKC').trim().toUpperCase();
  const used = new Set(nodes.map(node => key(String(node.code ?? ''))));
  const code = original.trim(), numeric = /^(.*?)(\d+)$/u.exec(code);
  if (numeric) {
    let next = BigInt(numeric[2]);
    for (let attempt = 0; attempt <= nodes.length; attempt++) {
      next++;
      const suffix = String(next).padStart(numeric[2].length, '0');
      if (suffix.length > 24) break;
      const candidate = clipboardPrefix(numeric[1], 24 - suffix.length) + suffix;
      if (!used.has(key(candidate))) return candidate;
    }
  }
  for (let number = 2; number <= nodes.length + 2; number++) {
    const suffix = '-' + number;
    const candidate = clipboardPrefix(code, 24 - suffix.length) + suffix;
    if (!used.has(key(candidate))) return candidate;
  }
  throw new Error('無法產生新的元件編號，請重試');
}

/** Paste one component atomically; project edges and operation presets stay intact. */
export function pasteComponent(project, clipboard, {position, offset = {x:0,y:0}, idFactory} = {}) {
  if (!project || !Array.isArray(project.nodes) || !Array.isArray(project.edges)) {
    throw new Error('圖面資料須包含元件與油管');
  }
  if (project.nodes.length >= 400 || project.edges.length > 1600) {
    throw new Error('圖面最多支援 400 個元件、1600 段油管');
  }
  if (idFactory !== undefined && typeof idFactory !== 'function') throw new Error('元件編號產生方式無效');
  const copied = copyComponent(clipboard), origin = position ?? copied;
  if (!origin || !clipboardCoordinate(origin.x) || !clipboardCoordinate(origin.y)
      || !offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)
      || !clipboardCoordinate(origin.x + offset.x) || !clipboardCoordinate(origin.y + offset.y)) {
    throw new Error('貼上位置須介於 -40000 至 40000');
  }
  const nodeId = clipboardFreshId('n', clipboardProjectIds(project), idFactory);
  const next = clipboardCloneProject(project);
  const node = {...copied, id:nodeId, x:origin.x + offset.x, y:origin.y + offset.y,
    code:clipboardCode(copied.code, next.nodes)};
  next.nodes.push(node);
  return {project:next, nodeId};
}

function clipboardPipePoints(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 102) {
    throw new Error('油管須有起點與終點，每段最多 100 個轉折點');
  }
  const result = [];
  for (const point of points) {
    if (!point || !clipboardCoordinate(point.x) || !clipboardCoordinate(point.y)) {
      throw new Error('油管座標須介於 -40000 至 40000');
    }
    const previous = result.at(-1);
    if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-8) {
      result.push({x:point.x, y:point.y});
    }
  }
  if (result.length < 2) throw new Error('油管長度必須大於零');
  return result;
}

/** Capture the whole displayed route; equipment endpoints never enter the clipboard. */
export function copyPipeSegment(edge, points) {
  if (!edge || typeof edge !== 'object' || Array.isArray(edge)) throw new Error('請先選取要複製的油管');
  const kind = edge.kind ?? 'normal';
  if (!['normal','bridge','underground'].includes(kind)) throw new Error('油管型式無效，無法複製');
  if (edge.layer !== undefined && (!Number.isSafeInteger(edge.layer) || Math.abs(edge.layer) > 10000)) {
    throw new Error('油管顯示層級無效，無法複製');
  }
  return {clipboardType:'pipe-segment', kind, ...(edge.layer !== undefined ? {layer:edge.layer} : {}),
    points:clipboardPipePoints(points)};
}

/** Paste a disconnected pipe island, retaining its full shape and display settings. */
export function pastePipeSegment(project, clipboard, {position, offset = {x:0,y:0}, idFactory} = {}) {
  if (!project || !Array.isArray(project.nodes) || !Array.isArray(project.edges)) {
    throw new Error('圖面資料須包含元件與油管');
  }
  if (project.nodes.length > 398 || project.edges.length >= 1600) {
    throw new Error('貼上油管需要兩個空白接點；圖面最多支援 400 個元件、1600 段油管');
  }
  if (clipboard?.clipboardType !== 'pipe-segment') throw new Error('請先複製一段油管');
  if (idFactory !== undefined && typeof idFactory !== 'function') throw new Error('元件編號產生方式無效');
  const snapshot = copyPipeSegment(clipboard, clipboard.points), points = snapshot.points;
  const center = {x:(Math.min(...points.map(point => point.x)) + Math.max(...points.map(point => point.x))) / 2,
    y:(Math.min(...points.map(point => point.y)) + Math.max(...points.map(point => point.y))) / 2};
  const target = position ?? center;
  if (!target || !clipboardCoordinate(target.x) || !clipboardCoordinate(target.y)
      || !offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) {
    throw new Error('貼上位置須介於 -40000 至 40000');
  }
  const translated = clipboardPipePoints(points.map(point => ({
    x:point.x + target.x - center.x + offset.x,
    y:point.y + target.y - center.y + offset.y
  })));
  const ids = clipboardProjectIds(project);
  const fromId = clipboardFreshId('n', ids, idFactory), toId = clipboardFreshId('n', ids, idFactory);
  const edgeId = clipboardFreshId('p', ids, idFactory), next = clipboardCloneProject(project);
  next.nodes.push(...[[fromId,translated[0]], [toId,translated.at(-1)]].map(([id,point]) => ({
    id, type:'point', ...point, name:'', code:'', rotation:0
  })));
  next.edges.push({id:edgeId, kind:snapshot.kind, ...(snapshot.layer !== undefined ? {layer:snapshot.layer} : {}),
    from:{node:fromId, port:'joint'}, to:{node:toId, port:'joint'}, routing:'free',
    waypoints:translated.slice(1,-1)});
  return {project:next, edgeId};
}

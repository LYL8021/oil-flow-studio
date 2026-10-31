import {normalizeTankPortModes,normalizeGroundMode} from './source-settings.js?v=source-1';

// Presets describe operational valve and source settings for one fixed diagram.
// They never carry geometry, oil-product changes, or executable actions.
const operationIdPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const operationSignaturePrefix = 'topology-v1:';
const validOperationId = value => typeof value === 'string' && operationIdPattern.test(value);

function operationProblem(code, message) {
  const error = new Error(message);
  error.name = 'OperationError';
  error.code = code;
  return error;
}

function operationName(value) {
  if (typeof value !== 'string') throw operationProblem('invalid-operation', '請輸入作業名稱。');
  const name = value.trim().replace(/\s+/gu, ' ');
  if (!name || Array.from(name).length > 80) throw operationProblem('invalid-operation', '作業名稱需為 1 到 80 個字。');
  return name;
}

function operationNameKey(name) {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function normalizeOperationSources(value) {
  if (!Array.isArray(value) || value.length>400) {
    throw operationProblem('invalid-operation','作業的油源設定無效或超過 400 個。');
  }
  const ids=new Set(), tankModes=new Set(['inlet','outlet','closed']);
  return value.map(source=>{
    if (!source || !validOperationId(source.id) || ids.has(source.id)
        || !['tank','ground'].includes(source.type) || typeof source.enabled!=='boolean') {
      throw operationProblem('invalid-operation','作業的油源編號、種類或啟用狀態無效。');
    }
    ids.add(source.id);
    if(source.type==='tank'){
      if(!source.portModes || typeof source.portModes!=='object' || Array.isArray(source.portModes)
          || !tankModes.has(source.portModes.in) || !tankModes.has(source.portModes.out)) {
        throw operationProblem('invalid-operation','作業的油槽接管口用途無效。');
      }
      return {id:source.id,type:'tank',enabled:source.enabled,
        portModes:{in:source.portModes.in,out:source.portModes.out}};
    }
    if(!['source','receive','idle'].includes(source.flowMode)
        || source.enabled!==(source.flowMode==='source')) {
      throw operationProblem('invalid-operation','作業的出入土端來油模式無效。');
    }
    return {id:source.id,type:'ground',enabled:source.enabled,flowMode:source.flowMode};
  });
}

function sourceState(node) {
  if(node.type==='tank')return {id:node.id,type:'tank',enabled:node.enabled!==false,
    portModes:normalizeTankPortModes(node)};
  const flowMode=normalizeGroundMode(node);
  return {id:node.id,type:'ground',enabled:flowMode==='source',flowMode};
}

function sourceMatches(node,setting) {
  const state=sourceState(node);
  return state.enabled===setting.enabled && (state.type==='tank'
    ? state.portModes.in===setting.portModes.in && state.portModes.out===setting.portModes.out
    : state.flowMode===setting.flowMode);
}

function normalizeOperation(value) {
  if (!value || typeof value !== 'object' || !validOperationId(value.id)) {
    throw operationProblem('invalid-operation', '作業編號無效，請檢查匯入的作業資料。');
  }
  const name = operationName(value.name);
  if (typeof value.signature !== 'string' || !value.signature.startsWith(operationSignaturePrefix) || value.signature.length > 1e6) {
    throw operationProblem('invalid-operation', '作業的管線圖識別資料無效。');
  }
  try {
    const topology = JSON.parse(value.signature.slice(operationSignaturePrefix.length));
    if (!topology || !Array.isArray(topology.nodes) || !Array.isArray(topology.edges)) throw new Error();
  } catch {
    throw operationProblem('invalid-operation', '作業的管線圖識別資料無效。');
  }
  if (!Array.isArray(value.valves) || value.valves.length > 400) {
    throw operationProblem('invalid-operation', '作業最多支援 400 個閥門。');
  }
  const ids = new Set();
  const valves = value.valves.map(valve => {
    if (!valve || !validOperationId(valve.id) || ids.has(valve.id) || typeof valve.open !== 'boolean') {
      throw operationProblem('invalid-operation', '作業的閥門編號重複、無效，或開關狀態不是布林值。');
    }
    ids.add(valve.id);
    return {id:valve.id, open:valve.open};
  });
  const times = {};
  for (const key of ['createdAt', 'updatedAt']) {
    if (value[key] !== undefined) {
      if (!Number.isFinite(value[key]) || value[key] < 0) throw operationProblem('invalid-operation', '作業的儲存時間無效。');
      times[key] = value[key];
    }
  }
  const sources=value.sources===undefined?undefined:normalizeOperationSources(value.sources);
  return {id:value.id, name, valves, ...(sources===undefined?{}:{sources}), signature:value.signature, ...times};
}

export function normalizeOperations(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw operationProblem('invalid-operation', '每張管線圖最多支援 100 項作業。');
  const ids = new Set(), names = new Set();
  return value.map(raw => {
    const operation = normalizeOperation(raw);
    const key = operationNameKey(operation.name);
    if (ids.has(operation.id)) throw operationProblem('invalid-operation', '作業編號重複。');
    if (names.has(key)) throw operationProblem('name-exists', '已有同名作業，請使用另一個名稱。');
    ids.add(operation.id); names.add(key);
    return operation;
  });
}

function operationTopology(project) {
  if (!project || !Array.isArray(project.nodes) || !Array.isArray(project.edges) || project.nodes.length > 400 || project.edges.length > 1600) {
    throw operationProblem('invalid-project', '管線圖的元件或連接資料無效。');
  }
  const nodeIds = new Set(), hydraulicNodeIds = new Set(), edgeIds = new Set();
  const nodes = project.nodes.map(node => {
    if (!node || !validOperationId(node.id) || nodeIds.has(node.id) || typeof node.type !== 'string' || !node.type || node.type.length > 40) {
      throw operationProblem('invalid-project', '管線圖有無效或重複的元件編號。');
    }
    if (node.type === 'valve' && node.open !== undefined && typeof node.open !== 'boolean') {
      throw operationProblem('invalid-project', '目前閥門的開關資料無效。');
    }
    nodeIds.add(node.id);
    if (node.type === 'text') return null;
    hydraulicNodeIds.add(node.id);
    return [node.id, node.type, node.type === 'valve' ? String(node.code ?? '') : ''];
  }).filter(Boolean);
  const edges = project.edges.map(edge => {
    const endpointValid = endpoint => endpoint && hydraulicNodeIds.has(endpoint.node) && typeof endpoint.port === 'string' && endpoint.port.length > 0 && endpoint.port.length <= 100;
    if (!edge || !validOperationId(edge.id) || edgeIds.has(edge.id) || !endpointValid(edge.from) || !endpointValid(edge.to)) {
      throw operationProblem('invalid-project', '管線圖有無效或重複的連接資料。');
    }
    edgeIds.add(edge.id);
    return [edge.id, edge.from.node, edge.from.port, edge.to.node, edge.to.port];
  });
  const byId = (a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  nodes.sort(byId); edges.sort(byId);
  return {nodes, edges};
}

export function topologySignature(project) {
  // Keep the canonical topology itself, so compatibility has no hash collision.
  // Coordinates, display names, oil/source settings, and routing styles are
  // deliberately excluded; annotations have no hydraulic ports and are excluded
  // entirely. Hydraulic component identity, valve codes, and connections stay.
  return operationSignaturePrefix + JSON.stringify(operationTopology(project));
}

export function captureOperation(project, {id, name, createdAt} = {}) {
  const signature = topologySignature(project);
  const now = Date.now();
  const generatedId = globalThis.crypto?.randomUUID?.() || `op_${now.toString(36)}_${Math.random().toString(36).slice(2)}`;
  return normalizeOperation({id:id ?? generatedId, name,
    valves:project.nodes.filter(node => node.type === 'valve').map(node => ({id:node.id, open:node.open !== false})),
    sources:project.nodes.filter(node=>node.type==='tank'||node.type==='ground').map(sourceState),
    signature, createdAt:createdAt ?? now, updatedAt:Math.max(now, createdAt ?? now)});
}

function compatibleOperation(project, value) {
  const operation = normalizeOperation(value);
  if (topologySignature(project) !== operation.signature) {
    throw operationProblem('incompatible', '管線圖的元件、閥門編號或連接已變更，請重新檢查並儲存這項作業。');
  }
  const valves = project.nodes.filter(node => node.type === 'valve');
  const desired = new Map(operation.valves.map(valve => [valve.id, valve.open]));
  if (valves.length !== desired.size || valves.some(valve => !desired.has(valve.id))) {
    throw operationProblem('incompatible', '這項作業沒有完整對應目前的閥門，請重新檢查並儲存。');
  }
  const byId=new Map(project.nodes.map(node=>[node.id,node]));
  const sources=(operation.sources||[]).map(setting=>{
    const node=byId.get(setting.id);
    if(!node || node.type!==setting.type) {
      throw operationProblem('incompatible','這項作業的油源設定無法對應目前元件，請重新檢查並儲存。');
    }
    return {node,setting};
  });
  return {operation, valves, desired, sources};
}

export function applyOperation(project, value) {
  const {desired,sources} = compatibleOperation(project, value);
  let next;
  try { next = structuredClone(project); }
  catch { throw operationProblem('invalid-project', '管線圖資料無法複製，尚未套用作業。'); }
  for (const node of next.nodes) if (node.type === 'valve') node.open = desired.get(node.id);
  const byId=new Map(next.nodes.map(node=>[node.id,node]));
  for(const {setting} of sources){
    const node=byId.get(setting.id);node.enabled=setting.enabled;
    if(setting.type==='tank')node.portModes={...setting.portModes};
    else node.flowMode=setting.flowMode;
  }
  return next;
}

export function operationMatches(project, value) {
  try {
    const {valves, desired,sources} = compatibleOperation(project, value);
    return valves.every(valve => (valve.open !== false) === desired.get(valve.id))
      && sources.every(({node,setting})=>sourceMatches(node,setting));
  } catch { return false; }
}

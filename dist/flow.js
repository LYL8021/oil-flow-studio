/**
 * Determine which ports and fuel types can be reached from enabled oil sources.
 * This is connectivity visualization, not pressure or flow-rate calculation.
 * External pipes are bidirectional; a closed valve separates its two ports.
 */
export function computeFlow(nodes, edges) {
  const portsByType = {
    tank: ['in', 'out'],
    ground: ['port'],
    valve: ['in', 'out'],
    elbow: ['in', 'out'],
    filter: ['in', 'out'],
    flowmeter: ['in', 'out'],
    pipe: ['in', 'out'],
    point: ['joint'],
    cap: ['in'],
    junction: ['in', 'out', 'branch'],
    cross: ['in', 'out', 'branch', 'top'],
    outlet: ['in'],
  };
  const adjacency = new Map();
  const validEdges = [];
  const key = (node, port) => `${node}:${port}`;
  const connect = (a, b) => {
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  };

  for (const node of nodes) {
    for (const port of portsByType[node.type] || []) {
      adjacency.set(key(node.id, port), new Set());
    }
  }

  for (const node of nodes) {
    const ports = portsByType[node.type] || [];
    // Receiving oil never turns a storage tank into a through-pipe. Its outlet
    // is supplied only by the tank's own enabled source or another external path.
    if (node.type === 'tank' || node.type === 'valve' && node.open === false) continue;
    for (let index = 1; index < ports.length; index += 1) {
      connect(key(node.id, ports[0]), key(node.id, ports[index]));
    }
  }

  // Invalid or dangling pipes are ignored, allowing a partially edited drawing.
  for (const edge of edges) {
    if (!edge.from || !edge.to) continue;
    const from = key(edge.from.node, edge.from.port);
    const to = key(edge.to.node, edge.to.port);
    if (!adjacency.has(from) || !adjacency.has(to)) continue;
    connect(from, to);
    validEdges.push({ id: edge.id, from, to });
  }

  // A port may be reached by more than one fuel when sources are interconnected.
  // Track those paths separately instead of choosing the first tank encountered.
  const activePortFuels = new Map();
  const queue = [];
  const sourcePorts = [];
  const reach = (port, fuel) => {
    if (!activePortFuels.has(port)) activePortFuels.set(port, new Set());
    const fuels = activePortFuels.get(port);
    if (fuels.has(fuel)) return;
    fuels.add(fuel);
    queue.push({ port, fuel });
  };
  for (const node of nodes) {
    const tankSource = node.type === 'tank' && node.enabled !== false;
    // Ground endpoints supply only when explicitly enabled; appearance never infers a source.
    const groundSource = node.type === 'ground' && node.enabled === true;
    if (!tankSource && !groundSource) continue;
    const source = key(node.id, groundSource ? 'port' : 'out');
    sourcePorts.push(source);
    // Legacy projects and unrecognized fuel values retain the original fuel oil.
    reach(source, node.fuel === 'diesel' || node.fuel === 'gasoline' ? node.fuel : 'fuel');
  }
  for (let index = 0; index < queue.length; index += 1) {
    const { port, fuel } = queue[index];
    for (const neighbor of adjacency.get(port) || []) {
      reach(neighbor, fuel);
    }
  }

  const activeEdgeFuels = new Map();
  for (const edge of validEdges) {
    const fromFuels = activePortFuels.get(edge.from);
    const toFuels = activePortFuels.get(edge.to);
    if (!fromFuels || !toFuels) continue;
    const fuels = new Set([...fromFuels].filter(fuel => toFuels.has(fuel)));
    if (fuels.size) activeEdgeFuels.set(edge.id, fuels);
  }
  const activeNodeFuels = new Map();
  for (const node of nodes) {
    const fuels = new Set();
    for (const port of portsByType[node.type] || []) {
      for (const fuel of activePortFuels.get(key(node.id, port)) || []) {
        fuels.add(fuel);
      }
    }
    if (fuels.size) activeNodeFuels.set(node.id, fuels);
  }

  // Preserve the original Sets for existing callers and saved-project behavior.
  const activePorts = new Set(activePortFuels.keys());
  const activeEdges = new Set(activeEdgeFuels.keys());
  const activeNodes = new Set(activeNodeFuels.keys());

  // Animation follows enabled sources rather than the order used to draw a pipe.
  // Each source votes separately, including sources of the same fuel. Conflicting
  // votes or equally short paths stay ambiguous; this is not a pressure model.
  const edgeDirections = new Map();
  const nodeDirections = new Map();
  const mergeDirection = (target, id, direction) => {
    if (!target.has(id)) target.set(id, direction);
    else if (target.get(id) !== direction) target.set(id, 'ambiguous');
  };
  const directionBetween = (distances, from, to) => {
    if (!distances.has(from) || !distances.has(to)) return null;
    const difference = distances.get(to) - distances.get(from);
    return difference > 0 ? 'forward' : difference < 0 ? 'reverse' : 'ambiguous';
  };
  const pipeNodes = nodes.filter(node => node.type === 'pipe' && activeNodes.has(node.id));
  for (const source of sourcePorts) {
    const distances = new Map([[source, 0]]);
    const pending = [source];
    for (let index = 0; index < pending.length; index++) {
      const from = pending[index];
      for (const to of adjacency.get(from) || []) {
        if (distances.has(to)) continue;
        distances.set(to, distances.get(from) + 1);
        pending.push(to);
      }
    }
    for (const edge of validEdges) {
      if (!activeEdges.has(edge.id)) continue;
      const direction = directionBetween(distances, edge.from, edge.to);
      if (direction) mergeDirection(edgeDirections, edge.id, direction);
    }
    for (const node of pipeNodes) {
      const direction = directionBetween(distances, key(node.id, 'in'), key(node.id, 'out'));
      if (direction) mergeDirection(nodeDirections, node.id, direction);
    }
  }
  return {
    activeEdges, activeNodes, activePorts,
    activeEdgeFuels, activeNodeFuels, activePortFuels,
    edgeDirections, nodeDirections,
  };
}

/**
 * Determine which ports and fuel types can be reached from enabled tanks.
 * This is connectivity visualization, not pressure or flow-rate calculation.
 * External pipes are bidirectional; a closed valve separates its two ports.
 */
export function computeFlow(nodes, edges) {
  const portsByType = {
    tank: ['out'],
    valve: ['in', 'out'],
    elbow: ['in', 'out'],
    filter: ['in', 'out'],
    flowmeter: ['in', 'out'],
    pipe: ['in', 'out'],
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
    if (node.type === 'valve' && node.open === false) continue;
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
  const reach = (port, fuel) => {
    if (!activePortFuels.has(port)) activePortFuels.set(port, new Set());
    const fuels = activePortFuels.get(port);
    if (fuels.has(fuel)) return;
    fuels.add(fuel);
    queue.push({ port, fuel });
  };
  for (const node of nodes) {
    if (node.type !== 'tank' || node.enabled === false) continue;
    const source = key(node.id, 'out');
    // Legacy projects and unrecognized fuel values retain the original fuel oil.
    reach(source, node.fuel === 'diesel' ? 'diesel' : 'fuel');
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
  return {
    activeEdges, activeNodes, activePorts,
    activeEdgeFuels, activeNodeFuels, activePortFuels,
  };
}

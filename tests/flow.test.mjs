import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A data URL keeps the buildless site's .js source testable without package.json.
const source = await readFile(new URL('../dist/flow.js', import.meta.url), 'utf8');
const { computeFlow } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const pipe = (id, a, b) => {
  const endpoint = value => {
    const [node, port] = value.split(':');
    return { node, port };
  };
  return { id, from: endpoint(a), to: endpoint(b) };
};
const sorted = set => [...set].sort();

test('closing a chain valve drains its downstream pipes but preserves its inlet', () => {
  const nodes = [
    { id: 'tank', type: 'tank' },
    { id: 'v', type: 'valve', open: true },
    { id: 'f', type: 'filter' },
    { id: 'e', type: 'elbow' },
    { id: 'end', type: 'outlet' },
  ];
  const edges = [
    pipe('1', 'tank:out', 'v:in'), pipe('2', 'v:out', 'f:in'),
    pipe('3', 'f:out', 'e:in'), pipe('4', 'e:out', 'end:in'),
  ];
  assert.deepEqual(sorted(computeFlow(nodes, edges).activeEdges), ['1', '2', '3', '4']);
  nodes[1].open = false;
  const closed = computeFlow(nodes, edges);
  assert.deepEqual(sorted(closed.activeEdges), ['1']);
  assert.equal(closed.activePorts.has('v:in'), true);
  assert.equal(closed.activePorts.has('v:out'), false);
  assert.equal(closed.activeNodes.has('v'), true);
  assert.equal(closed.activeNodes.has('f'), false);
});

test('closing one branch leaves the other branch supplied', () => {
  const nodes = [
    { id: 't', type: 'tank' }, { id: 'j', type: 'junction' },
    { id: 'v', type: 'valve', open: false },
    { id: 'a', type: 'outlet' }, { id: 'b', type: 'outlet' },
  ];
  const edges = [
    pipe('source', 't:out', 'j:in'), pipe('a', 'j:out', 'a:in'),
    pipe('to-valve', 'j:branch', 'v:in'), pipe('b', 'v:out', 'b:in'),
  ];
  assert.deepEqual(sorted(computeFlow(nodes, edges).activeEdges), ['a', 'source', 'to-valve']);
});

test('a bypass can supply the far side of a closed valve and cyclic graphs terminate', () => {
  const nodes = [
    { id: 't', type: 'tank' }, { id: 'j1', type: 'junction' },
    { id: 'j2', type: 'junction' }, { id: 'v', type: 'valve', open: false },
    { id: 'f', type: 'filter' }, { id: 'end', type: 'outlet' },
  ];
  const edges = [
    pipe('s', 't:out', 'j1:in'), pipe('v-in', 'j1:out', 'v:in'),
    pipe('v-out', 'v:out', 'j2:in'), pipe('b1', 'j1:branch', 'f:in'),
    pipe('b2', 'f:out', 'j2:branch'), pipe('end', 'j2:out', 'end:in'),
  ];
  const result = computeFlow(nodes, edges);
  assert.equal(result.activeEdges.size, edges.length);
  assert.equal(result.activePorts.has('v:out'), true);
  nodes[3].open = true;
  assert.equal(computeFlow(nodes, edges).activeEdges.size, edges.length);
});

test('multiple sources feed both sides of an isolating valve', () => {
  const nodes = [
    { id: 'a', type: 'tank' }, { id: 'b', type: 'tank' },
    { id: 'v', type: 'valve', open: false },
  ];
  const edges = [pipe('left', 'a:out', 'v:in'), pipe('right', 'b:out', 'v:out')];
  assert.deepEqual(sorted(computeFlow(nodes, edges).activeEdges), ['left', 'right']);
  nodes[1].enabled = false;
  assert.deepEqual(sorted(computeFlow(nodes, edges).activeEdges), ['left']);
  nodes[0].enabled = false;
  const result = computeFlow(nodes, edges);
  assert.equal(result.activeEdges.size, 0);
  assert.equal(result.activeNodes.size, 0);
  assert.equal(result.activePorts.size, 0);
});

test('disconnected islands and dangling pipes remain uncolored', () => {
  const nodes = [
    { id: 't', type: 'tank' }, { id: 'a', type: 'filter' },
    { id: 'b', type: 'outlet' },
  ];
  const edges = [
    pipe('island', 'a:out', 'b:in'), pipe('missing', 't:out', 'gone:in'),
    pipe('bad-port', 't:out', 'a:missing'),
  ];
  const result = computeFlow(nodes, edges);
  assert.equal(result.activeEdges.size, 0);
  assert.deepEqual(sorted(result.activeNodes), ['t']);
});

test('diesel reaches connected devices and pipes as diesel', () => {
  const nodes = [
    { id: 't', type: 'tank', fuel: 'diesel' },
    { id: 'f', type: 'filter' }, { id: 'o', type: 'outlet' },
  ];
  const edges = [pipe('in', 't:out', 'f:in'), pipe('out', 'f:out', 'o:in')];
  const result = computeFlow(nodes, edges);
  assert.deepEqual(sorted(result.activeEdges), ['in', 'out']);
  assert.deepEqual(sorted(result.activeEdgeFuels.get('in')), ['diesel']);
  assert.deepEqual(sorted(result.activeEdgeFuels.get('out')), ['diesel']);
  assert.deepEqual(sorted(result.activeNodeFuels.get('f')), ['diesel']);
  assert.deepEqual(sorted(result.activePortFuels.get('f:out')), ['diesel']);
});

test('legacy and unrecognized tank fuel values preserve fuel oil', () => {
  for (const value of [undefined, null, '', 'unknown', 'fuel']) {
    const nodes = [
      { id: 't', type: 'tank', fuel: value }, { id: 'o', type: 'outlet' },
    ];
    const result = computeFlow(nodes, [pipe('p', 't:out', 'o:in')]);
    assert.deepEqual(sorted(result.activeEdgeFuels.get('p')), ['fuel']);
    assert.deepEqual(sorted(result.activeNodeFuels.get('t')), ['fuel']);
  }
});

test('closing a valve blocks downstream diesel without draining its inlet pipe', () => {
  const nodes = [
    { id: 't', type: 'tank', fuel: 'diesel' },
    { id: 'v', type: 'valve', open: false }, { id: 'o', type: 'outlet' },
  ];
  const edges = [pipe('up', 't:out', 'v:in'), pipe('down', 'v:out', 'o:in')];
  const result = computeFlow(nodes, edges);
  assert.deepEqual(sorted(result.activeEdgeFuels.get('up')), ['diesel']);
  assert.equal(result.activeEdgeFuels.has('down'), false);
  assert.deepEqual(sorted(result.activePortFuels.get('v:in')), ['diesel']);
  assert.equal(result.activePortFuels.has('v:out'), false);
  nodes[1].open = true;
  assert.deepEqual(sorted(computeFlow(nodes, edges).activeEdgeFuels.get('down')), ['diesel']);
});

test('a closed valve keeps fuel oil and diesel on their respective sides', () => {
  const nodes = [
    { id: 'fuel', type: 'tank', fuel: 'fuel' },
    { id: 'diesel', type: 'tank', fuel: 'diesel' },
    { id: 'v', type: 'valve', open: false },
  ];
  const edges = [pipe('left', 'fuel:out', 'v:in'), pipe('right', 'diesel:out', 'v:out')];
  const result = computeFlow(nodes, edges);
  assert.deepEqual(sorted(result.activeEdgeFuels.get('left')), ['fuel']);
  assert.deepEqual(sorted(result.activeEdgeFuels.get('right')), ['diesel']);
  assert.deepEqual(sorted(result.activePortFuels.get('v:in')), ['fuel']);
  assert.deepEqual(sorted(result.activePortFuels.get('v:out')), ['diesel']);
  assert.deepEqual(sorted(result.activeNodeFuels.get('v')), ['diesel', 'fuel']);
});

test('interconnected fuel sources mark shared routes with both fuels independent of node order', () => {
  const nodes = [
    { id: 'fuel', type: 'tank', fuel: 'fuel' },
    { id: 'diesel', type: 'tank', fuel: 'diesel' },
    { id: 'j', type: 'junction' }, { id: 'o', type: 'outlet' },
  ];
  const edges = [
    pipe('a', 'fuel:out', 'j:in'), pipe('b', 'diesel:out', 'j:branch'),
    pipe('shared', 'j:out', 'o:in'),
  ];
  for (const ordered of [nodes, [...nodes].reverse()]) {
    const result = computeFlow(ordered, edges);
    for (const edge of edges) {
      assert.deepEqual(sorted(result.activeEdgeFuels.get(edge.id)), ['diesel', 'fuel']);
    }
    assert.deepEqual(sorted(result.activeNodeFuels.get('o')), ['diesel', 'fuel']);
  }
});

test('disabled sources contribute no fuel while other enabled sources still propagate', () => {
  const nodes = [
    { id: 'fuel', type: 'tank', fuel: 'fuel', enabled: false },
    { id: 'diesel', type: 'tank', fuel: 'diesel', enabled: true },
    { id: 'j', type: 'junction' }, { id: 'o', type: 'outlet' },
  ];
  const edges = [
    pipe('a', 'fuel:out', 'j:in'), pipe('b', 'diesel:out', 'j:branch'),
    pipe('shared', 'j:out', 'o:in'),
  ];
  const result = computeFlow(nodes, edges);
  assert.deepEqual(sorted(result.activeEdgeFuels.get('shared')), ['diesel']);
  assert.deepEqual(sorted(result.activeNodeFuels.get('fuel')), ['diesel']);
  nodes[1].enabled = false;
  const stopped = computeFlow(nodes, edges);
  assert.equal(stopped.activePortFuels.size, 0);
  assert.equal(stopped.activeEdgeFuels.size, 0);
  assert.equal(stopped.activeNodeFuels.size, 0);
  assert.equal(stopped.activeEdges.size, 0);
});

test('a source-connected straight pipe remains colored with its far end unused', () => {
  const nodes = [
    { id: 'tank', type: 'tank', fuel: 'diesel' },
    { id: 'segment', type: 'pipe' },
  ];
  const edges = [pipe('supply', 'tank:out', 'segment:in')];
  const result = computeFlow(nodes, edges);
  assert.deepEqual(sorted(result.activeEdges), ['supply']);
  assert.deepEqual(sorted(result.activeNodeFuels.get('segment')), ['diesel']);
  assert.deepEqual(sorted(result.activePortFuels.get('segment:out')), ['diesel']);
});

test('a valve controls a capped pipe branch for both supported fuel types', () => {
  for (const fuel of ['fuel', 'diesel']) {
    const nodes = [
      { id: 'tank', type: 'tank', fuel },
      { id: 'valve', type: 'valve', open: true },
      { id: 'segment', type: 'pipe' },
      { id: 'blind', type: 'cap' },
    ];
    const edges = [
      pipe('upstream', 'tank:out', 'valve:in'),
      pipe('branch', 'valve:out', 'segment:in'),
      pipe('sealed-end', 'segment:out', 'blind:in'),
    ];
    const open = computeFlow(nodes, edges);
    assert.deepEqual(sorted(open.activeEdges), ['branch', 'sealed-end', 'upstream']);
    assert.deepEqual(sorted(open.activeNodeFuels.get('blind')), [fuel]);
    assert.deepEqual(sorted(open.activeNodeFuels.get('segment')), [fuel]);
    assert.equal(open.activePorts.has('blind:out'), false);
    nodes[1].open = false;
    const closed = computeFlow(nodes, edges);
    assert.deepEqual(sorted(closed.activeEdges), ['upstream']);
    assert.equal(closed.activeNodes.has('segment'), false);
    assert.equal(closed.activeNodes.has('blind'), false);
  }
});

test('unconnected pipe segments and blind flanges remain inactive', () => {
  const nodes = [
    { id: 'tank', type: 'tank' },
    { id: 'segment', type: 'pipe' },
    { id: 'blind', type: 'cap' },
    { id: 'looseCap', type: 'cap' },
  ];
  const edges = [pipe('isolated', 'segment:out', 'blind:in')];
  const result = computeFlow(nodes, edges);
  assert.deepEqual(sorted(result.activeNodes), ['tank']);
  assert.equal(result.activeEdges.size, 0);
  assert.equal(result.activePortFuels.has('looseCap:in'), false);
});

test('a blind flange cannot supply a downstream line through an invalid outlet port', () => {
  const nodes = [
    { id: 'tank', type: 'tank' },
    { id: 'blind', type: 'cap' },
    { id: 'beyond', type: 'pipe' },
  ];
  const edges = [
    pipe('sealed', 'tank:out', 'blind:in'),
    pipe('invalid-outlet', 'blind:out', 'beyond:in'),
  ];
  const result = computeFlow(nodes, edges);
  assert.deepEqual(sorted(result.activeEdges), ['sealed']);
  assert.deepEqual(sorted(result.activeNodes), ['blind', 'tank']);
  assert.equal(result.activePortFuels.has('blind:out'), false);
  assert.equal(result.activeNodeFuels.has('beyond'), false);
});

test('a flowmeter passes diesel to a capped branch and is isolated by an upstream valve', () => {
  const nodes = [
    { id: 'tank', type: 'tank', fuel: 'diesel' },
    { id: 'valve', type: 'valve', open: true },
    { id: 'meter', type: 'flowmeter' },
    { id: 'segment', type: 'pipe' },
    { id: 'blind', type: 'cap' },
  ];
  const edges = [
    pipe('supply', 'tank:out', 'valve:in'),
    pipe('meter-in', 'valve:out', 'meter:in'),
    pipe('meter-out', 'meter:out', 'segment:in'),
    pipe('sealed', 'segment:out', 'blind:in'),
  ];
  const open = computeFlow(nodes, edges);
  assert.deepEqual(sorted(open.activeEdges), ['meter-in', 'meter-out', 'sealed', 'supply']);
  assert.deepEqual(sorted(open.activeNodeFuels.get('meter')), ['diesel']);
  assert.deepEqual(sorted(open.activePortFuels.get('meter:out')), ['diesel']);
  assert.deepEqual(sorted(open.activeNodeFuels.get('blind')), ['diesel']);
  nodes[1].open = false;
  const closed = computeFlow(nodes, edges);
  assert.deepEqual(sorted(closed.activeEdges), ['supply']);
  assert.equal(closed.activeNodes.has('meter'), false);
  assert.equal(closed.activeNodes.has('segment'), false);
  assert.equal(closed.activeNodes.has('blind'), false);
});

test('a four-way junction supplies every branch while one branch valve isolates only its downstream', () => {
  const nodes = [
    { id: 'tank', type: 'tank', fuel: 'fuel' },
    { id: 'cross', type: 'cross' },
    { id: 'right', type: 'outlet' },
    { id: 'top', type: 'outlet' },
    { id: 'valve', type: 'valve', open: true },
    { id: 'bottom', type: 'outlet' },
  ];
  const edges = [
    pipe('supply', 'tank:out', 'cross:in'),
    pipe('right', 'cross:out', 'right:in'),
    pipe('top', 'cross:top', 'top:in'),
    pipe('to-valve', 'cross:branch', 'valve:in'),
    pipe('bottom', 'valve:out', 'bottom:in'),
  ];
  const open = computeFlow(nodes, edges);
  assert.deepEqual(sorted(open.activeEdges), ['bottom', 'right', 'supply', 'to-valve', 'top']);
  for (const port of ['in', 'out', 'branch', 'top']) {
    assert.deepEqual(sorted(open.activePortFuels.get('cross:' + port)), ['fuel']);
  }
  nodes[4].open = false;
  const closed = computeFlow(nodes, edges);
  assert.deepEqual(sorted(closed.activeEdges), ['right', 'supply', 'to-valve', 'top']);
  assert.equal(closed.activeNodes.has('bottom'), false);
  assert.deepEqual(sorted(closed.activeNodeFuels.get('right')), ['fuel']);
  assert.deepEqual(sorted(closed.activeNodeFuels.get('top')), ['fuel']);
});

test('diesel entering the top of a four-way junction reaches the other three directions', () => {
  const nodes = [
    { id: 'tank', type: 'tank', fuel: 'diesel' },
    { id: 'cross', type: 'cross' },
    { id: 'left', type: 'cap' },
    { id: 'right', type: 'outlet' },
    { id: 'bottom', type: 'pipe' },
  ];
  const edges = [
    pipe('supply', 'tank:out', 'cross:top'),
    pipe('left', 'cross:in', 'left:in'),
    pipe('right', 'cross:out', 'right:in'),
    pipe('bottom', 'cross:branch', 'bottom:in'),
  ];
  const result = computeFlow(nodes, edges);
  assert.deepEqual(sorted(result.activeEdges), ['bottom', 'left', 'right', 'supply']);
  for (const edge of edges) assert.deepEqual(sorted(result.activeEdgeFuels.get(edge.id)), ['diesel']);
  assert.deepEqual(sorted(result.activePortFuels.get('bottom:out')), ['diesel']);
});

test('crossing pipe geometry does not connect independent fuel routes without a four-way junction', () => {
  const nodes = [
    { id: 'fuel', type: 'tank', fuel: 'fuel', x: 0, y: 50 },
    { id: 'fuelEnd', type: 'outlet', x: 100, y: 50 },
    { id: 'diesel', type: 'tank', fuel: 'diesel', x: 50, y: 0 },
    { id: 'dieselEnd', type: 'outlet', x: 50, y: 100 },
  ];
  const edges = [
    pipe('horizontal', 'fuel:out', 'fuelEnd:in'),
    pipe('vertical', 'diesel:out', 'dieselEnd:in'),
  ];
  const result = computeFlow(nodes, edges);
  assert.deepEqual(sorted(result.activeEdgeFuels.get('horizontal')), ['fuel']);
  assert.deepEqual(sorted(result.activeEdgeFuels.get('vertical')), ['diesel']);
});

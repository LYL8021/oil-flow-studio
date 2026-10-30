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

test('an explicit pipe point supplies three or four connected branches from its single joint', () => {
  for (const branchCount of [3, 4]) {
    const nodes = [
      { id: 'source', type: 'tank', fuel: 'diesel' },
      { id: 'joint', type: 'point', x: 200, y: 200 },
      ...Array.from({ length: branchCount }, (_, index) => ({ id: 'end' + index, type: 'outlet' })),
    ];
    const edges = [
      pipe('feed', 'source:out', 'joint:joint'),
      ...Array.from({ length: branchCount }, (_, index) => pipe('branch' + index, 'joint:joint', 'end' + index + ':in')),
    ];
    const result = computeFlow(nodes, edges);
    assert.equal(result.activeEdges.size, branchCount + 1);
    assert.deepEqual(sorted(result.activePortFuels.get('joint:joint')), ['diesel']);
    for (const edge of edges) assert.deepEqual(sorted(result.activeEdgeFuels.get(edge.id)), ['diesel']);
  }
});

test('closing a valve isolates every branch behind a pipe point while retaining its upstream color', () => {
  const nodes = [
    { id: 'source', type: 'tank', fuel: 'fuel' },
    { id: 'v', type: 'valve', open: false },
    { id: 'joint', type: 'point' },
    { id: 'end1', type: 'outlet' }, { id: 'end2', type: 'cap' },
  ];
  const edges = [
    pipe('feed', 'source:out', 'v:in'), pipe('downstream', 'v:out', 'joint:joint'),
    pipe('branch1', 'joint:joint', 'end1:in'), pipe('branch2', 'joint:joint', 'end2:in'),
  ];
  const closed = computeFlow(nodes, edges);
  assert.deepEqual(sorted(closed.activeEdges), ['feed']);
  assert.deepEqual(sorted(closed.activePortFuels.get('v:in')), ['fuel']);
  assert.equal(closed.activeNodeFuels.has('joint'), false);
  assert.equal(closed.activePortFuels.has('v:out'), false);
  nodes[1].open = true;
  assert.equal(computeFlow(nodes, edges).activeEdges.size, 4);
});

test('coincident pipe points do not connect their independent fuel routes', () => {
  const nodes = [
    { id: 'source', type: 'tank', fuel: 'fuel' },
    { id: 'supplied', type: 'point', x: 100, y: 100 },
    { id: 'isolated', type: 'point', x: 100, y: 100 },
    { id: 'end1', type: 'outlet' }, { id: 'end2', type: 'outlet' },
  ];
  const edges = [
    pipe('feed', 'source:out', 'supplied:joint'), pipe('first', 'supplied:joint', 'end1:in'),
    pipe('second', 'isolated:joint', 'end2:in'),
  ];
  const result = computeFlow(nodes, edges);
  assert.deepEqual(sorted(result.activeEdges), ['feed', 'first']);
  assert.equal(result.activePorts.has('isolated:joint'), false);
  assert.equal(result.activeNodeFuels.has('end2'), false);
});

test('a riser valve keeps coincident inlet and outlet logically separate when closed', () => {
  const nodes = [
    { id: 'source', type: 'tank', fuel: 'diesel' },
    { id: 'v', type: 'valve', variant: 'riser', open: false, x: 100, y: 100 },
    { id: 'joint', type: 'point', x: 100, y: 100 },
    { id: 'end', type: 'outlet' },
  ];
  const edges = [
    pipe('feed', 'source:out', 'v:in'), pipe('riser-out', 'v:out', 'joint:joint'),
    pipe('branch', 'joint:joint', 'end:in'),
  ];
  const closed = computeFlow(nodes, edges);
  assert.deepEqual(sorted(closed.activeEdges), ['feed']);
  assert.deepEqual(sorted(closed.activePortFuels.get('v:in')), ['diesel']);
  assert.equal(closed.activePorts.has('v:out'), false);
  assert.equal(closed.activeNodeFuels.has('joint'), false);
  nodes[1].open = true;
  const opened = computeFlow(nodes, edges);
  assert.deepEqual(sorted(opened.activeEdges), ['branch', 'feed', 'riser-out']);
  assert.deepEqual(sorted(opened.activeNodeFuels.get('end')), ['diesel']);
});


test('an enabled ground rise supplies fuel through a valve to a passive ground sink', () => {
  for (const fuel of ['fuel', 'diesel']) {
    const nodes = [
      { id: 'upstream', type: 'ground', variant: 'rise', enabled: true, fuel },
      { id: 'v', type: 'valve', open: true },
      { id: 'downstream', type: 'ground', variant: 'sink', enabled: false, fuel: fuel === 'fuel' ? 'diesel' : 'fuel' },
    ];
    const edges = [pipe('up', 'upstream:port', 'v:in'), pipe('down', 'v:out', 'downstream:port')];
    const opened = computeFlow(nodes, edges);
    assert.deepEqual(sorted(opened.activeEdges), ['down', 'up']);
    assert.deepEqual(sorted(opened.activeNodeFuels.get('downstream')), [fuel]);
    assert.deepEqual(sorted(opened.activePortFuels.get('upstream:port')), [fuel]);
    nodes[1].open = false;
    const closed = computeFlow(nodes, edges);
    assert.deepEqual(sorted(closed.activeEdges), ['up']);
    assert.deepEqual(sorted(closed.activePortFuels.get('v:in')), [fuel]);
    assert.equal(closed.activePorts.has('v:out'), false);
    assert.equal(closed.activeNodes.has('downstream'), false);
    nodes[0].enabled = false;
    const stopped = computeFlow(nodes, edges);
    assert.equal(stopped.activeEdges.size, 0);
    assert.equal(stopped.activePorts.size, 0);
    assert.equal(stopped.activeNodes.size, 0);
  }
});

test('neither ground appearance nor a truthy non-boolean value creates a supply source', () => {
  for (const variant of ['rise', 'sink']) {
    for (const enabled of [undefined, false, null, 0, 1, 'true', 'false']) {
      const nodes = [
        { id: 'ground', type: 'ground', variant, enabled, fuel: 'diesel' },
        { id: 'end', type: 'outlet' },
      ];
      const result = computeFlow(nodes, [pipe('line', 'ground:port', 'end:in')]);
      assert.equal(result.activeEdges.size, 0);
      assert.equal(result.activePorts.size, 0);
      assert.equal(result.activeNodes.size, 0);
    }
  }
});

test('explicitly enabled ground endpoints can supply in either visual direction with legacy fuel fallback', () => {
  for (const variant of ['rise', 'sink']) {
    for (const fuel of [undefined, null, 'unknown', 'fuel', 'diesel']) {
      const nodes = [
        { id: 'ground', type: 'ground', variant, enabled: true, fuel },
        { id: 'end', type: 'cap' },
      ];
      const result = computeFlow(nodes, [pipe('line', 'ground:port', 'end:in')]);
      assert.deepEqual(sorted(result.activeEdgeFuels.get('line')), [fuel === 'diesel' ? 'diesel' : 'fuel']);
      assert.equal(result.activePorts.has('ground:in'), false);
      assert.equal(result.activePorts.has('ground:out'), false);
    }
  }
});

test('ground and tank sources combine fuels while a disabled ground source remains a passive endpoint', () => {
  const nodes = [
    { id: 'tank', type: 'tank', fuel: 'fuel' },
    { id: 'ground', type: 'ground', variant: 'rise', enabled: true, fuel: 'diesel' },
    { id: 'joint', type: 'point' },
    { id: 'sink', type: 'ground', variant: 'sink', enabled: false, fuel: 'diesel' },
  ];
  const edges = [
    pipe('tank-feed', 'tank:out', 'joint:joint'),
    pipe('ground-feed', 'ground:port', 'joint:joint'),
    pipe('delivery', 'joint:joint', 'sink:port'),
  ];
  const mixed = computeFlow(nodes, edges);
  for (const edge of edges) assert.deepEqual(sorted(mixed.activeEdgeFuels.get(edge.id)), ['diesel', 'fuel']);
  assert.deepEqual(sorted(mixed.activeNodeFuels.get('sink')), ['diesel', 'fuel']);
  nodes[1].enabled = false;
  const tankOnly = computeFlow(nodes, edges);
  for (const edge of edges) assert.deepEqual(sorted(tankOnly.activeEdgeFuels.get(edge.id)), ['fuel']);
  assert.deepEqual(sorted(tankOnly.activeNodeFuels.get('ground')), ['fuel']);
  nodes[0].enabled = false;
  const stopped = computeFlow(nodes, edges);
  assert.equal(stopped.activeEdges.size, 0);
  assert.equal(stopped.activePorts.size, 0);
});


test('gasoline from a tank or ground source is isolated downstream by a closed valve', () => {
  for (const type of ['tank', 'ground']) {
    const sourcePort = type === 'tank' ? 'out' : 'port';
    const nodes = [
      { id: 'source', type, enabled: true, fuel: 'gasoline', variant: 'rise' },
      { id: 'v', type: 'valve', variant: 'riser', open: true },
      { id: 'filter', type: 'filter' },
      { id: 'sink', type: 'ground', variant: 'sink', enabled: false },
    ];
    const edges = [
      pipe('up', 'source:' + sourcePort, 'v:in'),
      pipe('filtered', 'v:out', 'filter:in'),
      pipe('delivery', 'filter:out', 'sink:port'),
    ];
    const opened = computeFlow(nodes, edges);
    for (const edge of edges) assert.deepEqual(sorted(opened.activeEdgeFuels.get(edge.id)), ['gasoline']);
    assert.deepEqual(sorted(opened.activeNodeFuels.get('sink')), ['gasoline']);
    nodes[1].open = false;
    const closed = computeFlow(nodes, edges);
    assert.deepEqual(sorted(closed.activeEdges), ['up']);
    assert.deepEqual(sorted(closed.activePortFuels.get('v:in')), ['gasoline']);
    assert.equal(closed.activePorts.has('v:out'), false);
    assert.equal(closed.activeNodes.has('filter'), false);
    assert.equal(closed.activeNodes.has('sink'), false);
  }
});

test('overlapping independent gasoline, diesel and fuel-oil graphs retain their own fuels', () => {
  const fuels = ['gasoline', 'diesel', 'fuel'];
  const nodes = fuels.flatMap((fuel, index) => [
    { id: 'source' + index, type: index === 1 ? 'ground' : 'tank', enabled: true, fuel, x: 0, y: 0 },
    { id: 'end' + index, type: 'point', x: 100, y: 100 },
  ]);
  const edges = fuels.map((fuel, index) => pipe('route' + index,
    'source' + index + (index === 1 ? ':port' : ':out'), 'end' + index + ':joint'));
  const result = computeFlow(nodes, edges);
  for (let index = 0; index < fuels.length; index++) {
    assert.deepEqual(sorted(result.activeEdgeFuels.get('route' + index)), [fuels[index]]);
    assert.deepEqual(sorted(result.activeNodeFuels.get('end' + index)), [fuels[index]]);
  }
});

test('gasoline can share a reachable route with either existing fuel without losing its identity', () => {
  for (const otherFuel of ['fuel', 'diesel']) {
    const nodes = [
      { id: 'gas', type: 'ground', variant: 'rise', enabled: true, fuel: 'gasoline' },
      { id: 'other', type: 'tank', fuel: otherFuel },
      { id: 'joint', type: 'point' },
      { id: 'end', type: 'outlet' },
    ];
    const edges = [
      pipe('gas-feed', 'gas:port', 'joint:joint'), pipe('other-feed', 'other:out', 'joint:joint'),
      pipe('shared', 'joint:joint', 'end:in'),
    ];
    const expected = ['gasoline', otherFuel].sort();
    const mixed = computeFlow(nodes, edges);
    for (const edge of edges) assert.deepEqual(sorted(mixed.activeEdgeFuels.get(edge.id)), expected);
    assert.deepEqual(sorted(mixed.activeNodeFuels.get('end')), expected);
    nodes[0].enabled = false;
    const remaining = computeFlow(nodes, edges);
    assert.deepEqual(sorted(remaining.activeEdgeFuels.get('shared')), [otherFuel]);
    assert.deepEqual(sorted(remaining.activeNodeFuels.get('gas')), [otherFuel]);
    nodes[1].enabled = false;
    assert.equal(computeFlow(nodes, edges).activeEdges.size, 0);
  }
});

test('a common route tracks all three fuels and removes only each disabled supply', () => {
  const nodes = [
    { id: 'gas', type: 'tank', fuel: 'gasoline' },
    { id: 'diesel', type: 'ground', variant: 'rise', enabled: true, fuel: 'diesel' },
    { id: 'fuel', type: 'tank', fuel: 'fuel' },
    { id: 'joint', type: 'point' },
    { id: 'sink', type: 'ground', variant: 'sink', enabled: false },
  ];
  const edges = [
    pipe('gas-feed', 'gas:out', 'joint:joint'), pipe('diesel-feed', 'diesel:port', 'joint:joint'),
    pipe('fuel-feed', 'fuel:out', 'joint:joint'), pipe('shared', 'joint:joint', 'sink:port'),
  ];
  const all = computeFlow(nodes, edges);
  for (const edge of edges) assert.deepEqual(sorted(all.activeEdgeFuels.get(edge.id)), ['diesel', 'fuel', 'gasoline']);
  assert.deepEqual(sorted(all.activeNodeFuels.get('sink')), ['diesel', 'fuel', 'gasoline']);
  nodes[0].enabled = false;
  const withoutGas = computeFlow(nodes, edges);
  assert.deepEqual(sorted(withoutGas.activeEdgeFuels.get('shared')), ['diesel', 'fuel']);
  nodes[1].enabled = false;
  const fuelOnly = computeFlow(nodes, edges);
  assert.deepEqual(sorted(fuelOnly.activeEdgeFuels.get('shared')), ['fuel']);
  nodes[2].enabled = false;
  const stopped = computeFlow(nodes, edges);
  assert.equal(stopped.activeEdges.size, 0);
  assert.equal(stopped.activeNodes.size, 0);
  assert.equal(stopped.activePorts.size, 0);
});

test('source-based directions reverse drawn endpoints without changing reachable oil', () => {
  const nodes=[{id:'t',type:'tank',fuel:'diesel'},{id:'v',type:'valve',open:true},{id:'o',type:'outlet'}];
  const forward=[pipe('up','t:out','v:in'),pipe('down','v:out','o:in')];
  const reversed=[pipe('up','v:in','t:out'),pipe('down','o:in','v:out')];
  const a=computeFlow(nodes,forward),b=computeFlow(nodes,reversed);
  assert.deepEqual([...a.edgeDirections],[['up','forward'],['down','forward']]);
  assert.deepEqual([...b.edgeDirections],[['up','reverse'],['down','reverse']]);
  assert.deepEqual(sorted(a.activeEdges),sorted(b.activeEdges));
  assert.deepEqual(sorted(a.activeEdgeFuels.get('down')),sorted(b.activeEdgeFuels.get('down')));
  nodes[1].open=false;
  const closed=computeFlow(nodes,reversed);
  assert.deepEqual([...closed.edgeDirections],[['up','reverse']]);
  assert.equal(closed.activeNodes.has('v'),true);
  assert.equal(closed.activePorts.has('v:out'),false);
});

test('enabled ground supplies direct every branch away from the real source', () => {
  const nodes=[{id:'g',type:'ground',variant:'rise',enabled:true,fuel:'gasoline'},
    {id:'j',type:'point'},{id:'a',type:'outlet'},{id:'b',type:'ground',variant:'sink',enabled:false}];
  const edges=[pipe('feed','j:joint','g:port'),pipe('left','a:in','j:joint'),pipe('right','j:joint','b:port')];
  const result=computeFlow(nodes,edges);
  assert.deepEqual([...result.edgeDirections],[['feed','reverse'],['left','reverse'],['right','forward']]);
  assert.deepEqual(sorted(result.activeEdgeFuels.get('right')),['gasoline']);
  nodes[0].enabled=false;
  assert.equal(computeFlow(nodes,edges).edgeDirections.size,0);
});

test('a standalone pipe direction follows its supplied end independently of external edge order', () => {
  const nodes=[{id:'t',type:'tank'},{id:'p',type:'pipe'},{id:'c',type:'cap'},{id:'island',type:'pipe'}];
  const edges=[pipe('feed','t:out','p:out'),pipe('tail','p:in','c:in')];
  let result=computeFlow(nodes,edges);
  assert.equal(result.nodeDirections.get('p'),'reverse');
  assert.equal(result.nodeDirections.has('island'),false);
  assert.deepEqual([...result.edgeDirections],[['feed','forward'],['tail','forward']]);
  edges[0]=pipe('feed','p:out','t:out');
  result=computeFlow(nodes,edges);
  assert.equal(result.edgeDirections.get('feed'),'reverse');
  assert.equal(result.nodeDirections.get('p'),'reverse');
  nodes[0].enabled=false;
  assert.equal(computeFlow(nodes,edges).nodeDirections.size,0);
});

test('opposing supplies stay ambiguous even when they contain the same fuel', () => {
  for(const secondFuel of ['fuel','diesel']){
    const nodes=[{id:'a',type:'tank',fuel:'fuel'},{id:'p',type:'pipe'},{id:'b',type:'tank',fuel:secondFuel}];
    const edges=[pipe('left','a:out','p:in'),pipe('right','p:out','b:out')];
    const both=computeFlow(nodes,edges);
    assert.deepEqual([...both.edgeDirections],[['left','ambiguous'],['right','ambiguous']]);
    assert.equal(both.nodeDirections.get('p'),'ambiguous');
    nodes[2].enabled=false;
    const onlyA=computeFlow(nodes,edges);
    assert.deepEqual([...onlyA.edgeDirections],[['left','forward'],['right','forward']]);
    assert.equal(onlyA.nodeDirections.get('p'),'forward');
  }
});

test('supplies can agree on a common outgoing branch while opposing on feeder lines', () => {
  const nodes=[{id:'a',type:'tank'},{id:'b',type:'ground',enabled:true,fuel:'diesel'},
    {id:'j',type:'point'},{id:'o',type:'outlet'}];
  const edges=[pipe('a-feed','a:out','j:joint'),pipe('b-feed','b:port','j:joint'),pipe('shared','j:joint','o:in')];
  const result=computeFlow(nodes,edges);
  assert.equal(result.edgeDirections.get('a-feed'),'ambiguous');
  assert.equal(result.edgeDirections.get('b-feed'),'ambiguous');
  assert.equal(result.edgeDirections.get('shared'),'forward');
  assert.deepEqual(sorted(result.activeEdgeFuels.get('shared')),['diesel','fuel']);
});

test('balanced cycle paths do not invent a unique direction between equal-distance ports', () => {
  const nodes=[{id:'t',type:'tank'},{id:'a',type:'point'},{id:'b',type:'point'},{id:'c',type:'point'}];
  const edges=[pipe('feed','t:out','a:joint'),pipe('ab','a:joint','b:joint'),
    pipe('ac','a:joint','c:joint'),pipe('bc','b:joint','c:joint')];
  let result=computeFlow(nodes,edges);
  assert.equal(result.edgeDirections.get('feed'),'forward');
  assert.equal(result.edgeDirections.get('ab'),'forward');
  assert.equal(result.edgeDirections.get('ac'),'forward');
  assert.equal(result.edgeDirections.get('bc'),'ambiguous');
  result=computeFlow(nodes,edges.filter(edge=>edge.id!=='ac'));
  assert.equal(result.edgeDirections.get('bc'),'forward');
});

test('independent crossing geometry and inactive islands do not alter source directions', () => {
  const nodes=[{id:'a',type:'tank',x:0,y:50},{id:'endA',type:'point',x:100,y:50},
    {id:'b',type:'ground',enabled:true,x:50,y:0},{id:'endB',type:'point',x:50,y:100},
    {id:'u',type:'point'},{id:'v',type:'point'}];
  const edges=[pipe('horizontal','a:out','endA:joint'),pipe('vertical','endB:joint','b:port'),
    pipe('island','u:joint','v:joint'),pipe('invalid','a:out','b:missing')];
  const result=computeFlow(nodes,edges);
  assert.deepEqual([...result.edgeDirections],[['horizontal','forward'],['vertical','reverse']]);
  assert.equal(result.edgeDirections.has('island'),false);
  assert.equal(result.edgeDirections.has('invalid'),false);
});

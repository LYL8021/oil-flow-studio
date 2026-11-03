import test from 'node:test';
import assert from 'node:assert/strict';
import {tankPortCount,tankPortIds,normalizeTankPortModes,sourcePortsForNode,inactiveSourcePort} from '../dist/source-settings.js';
import {componentPort,normalizeTankPorts,TANK_PORT_RADIUS} from '../dist/component-geometry.js';
import {computeFlow} from '../dist/flow.js';
import {captureOperation,normalizeOperations,topologySignature,operationMatches,applyOperation} from '../dist/operations.js';
import {copyComponent,pasteComponent} from '../dist/component-clipboard.js';

const line=(id,from,fromPort,to,toPort)=>({id,from:{node:from,port:fromPort},to:{node:to,port:toPort}});
const sorted=values=>[...values].sort();
const triple=extra=>({id:'tank',type:'tank',x:100,y:200,portCount:3,enabled:true,fuel:'fuel',
  portModes:{in:'inlet',out:'outlet',out2:'outlet'},...extra});

test('one inlet and two outlets supply independent branches and closing one valve only isolates its downstream pipe',()=>{
  const nodes=[triple(),{id:'incoming',type:'ground',flowMode:'source',fuel:'diesel'},
    {id:'b',type:'valve',open:true},{id:'c',type:'valve',open:true},{id:'endB',type:'cap'},{id:'endC',type:'cap'}];
  const edges=[line('receive','incoming','port','tank','in'),line('b-up','tank','out','b','in'),
    line('b-down','b','out','endB','in'),line('c-up','tank','out2','c','in'),line('c-down','c','out','endC','in')];
  let flow=computeFlow(nodes,edges);
  assert.equal(flow.activeEdges.size,5);
  assert.deepEqual(sorted(flow.activePortFuels.get('tank:in')),['diesel']);
  for(const id of ['b-up','b-down','c-up','c-down'])assert.deepEqual(sorted(flow.activeEdgeFuels.get(id)),['fuel']);
  assert.equal(flow.edgeDirections.get('c-up'),'forward');
  nodes.find(node=>node.id==='c').open=false;flow=computeFlow(nodes,edges);
  assert.deepEqual(sorted(flow.activeEdges),['b-down','b-up','c-up','receive']);
  assert.equal(flow.activeEdges.has('c-down'),false);
  nodes[0].enabled=false;flow=computeFlow(nodes,edges);
  assert.deepEqual(sorted(flow.activeEdges),['receive'],'incoming fuel cannot bypass the tank into either outlet');
});

test('all three tank roles can reverse or close independently without connecting through the tank',()=>{
  const tank=triple({portModes:{in:'inlet',out:'outlet',out2:'inlet'}});
  const nodes=[tank,{id:'a',type:'ground',flowMode:'source',fuel:'diesel'},
    {id:'c',type:'ground',flowMode:'source',fuel:'gasoline'},{id:'b',type:'cap'}];
  const edges=[line('a-in','a','port','tank','in'),line('c-in','c','port','tank','out2'),line('b-out','tank','out','b','in')];
  let flow=computeFlow(nodes,edges);
  assert.deepEqual(sorted(flow.activeEdgeFuels.get('a-in')),['diesel']);
  assert.deepEqual(sorted(flow.activeEdgeFuels.get('c-in')),['gasoline']);
  assert.deepEqual(sorted(flow.activeEdgeFuels.get('b-out')),['fuel']);
  tank.portModes.out2='closed';flow=computeFlow(nodes,edges);
  assert.equal(inactiveSourcePort(tank,'out2'),true);
  assert.equal(flow.activeEdges.has('c-in'),false);assert.equal(flow.activePorts.has('tank:out2'),false);
  tank.portModes={in:'outlet',out:'outlet',out2:'outlet'};
  assert.deepEqual(sourcePortsForNode(tank),['in','out','out2']);
  tank.portModes={in:'inlet',out:'inlet',out2:'inlet'};
  assert.deepEqual(sourcePortsForNode(tank),[]);
});

test('legacy two-port tanks do not acquire a hidden third connection or change their serialized geometry',()=>{
  const tank={id:'old',type:'tank',x:0,y:0,portModes:{in:'inlet',out:'outlet',out2:'outlet'},out2Angle:30};
  assert.equal(tankPortCount(tank),2);assert.deepEqual(tankPortIds(tank),['in','out']);
  assert.deepEqual(normalizeTankPortModes(tank),{in:'inlet',out:'outlet'});
  assert.deepEqual(normalizeTankPorts(tank),{inAngle:180,outAngle:0});
  assert.equal(componentPort(tank,'out2'),null);
  const result=computeFlow([tank,{id:'cap',type:'cap'}],[line('invalid-c','old','out2','cap','in')]);
  assert.equal(result.activeEdges.size,0);assert.equal(result.activeNodes.has('cap'),false);
  assert.deepEqual(normalizeTankPortModes({portCount:3}),{in:'inlet',out:'outlet',out2:'outlet'});
});

test('the third short nozzle follows its own angle, overall rotation and 3000 percent scale',()=>{
  const tank=triple({x:2000,y:3000,scale:30,rotation:30,inAngle:180,outAngle:0,out2Angle:60});
  const c=componentPort(tank,'out2');
  assert.deepEqual(c,{x:2000,y:4420,dx:0,dy:1});
  assert.ok(Math.abs(Math.hypot(c.x-tank.x,c.y-tank.y)-TANK_PORT_RADIUS*30)<1e-8);
  const originalA=componentPort(tank,'in'),originalB=componentPort(tank,'out');
  tank.out2Angle=240;
  assert.deepEqual(componentPort(tank,'out2'),{x:2000,y:1580,dx:0,dy:-1});
  assert.deepEqual(componentPort(tank,'in'),originalA);assert.deepEqual(componentPort(tank,'out'),originalB);
  assert.deepEqual(normalizeTankPorts(triple({out2Angle:-90})),{inAngle:180,outAngle:0,portCount:3,out2Angle:270});
});

test('three-port operations preserve C settings and geometry while retaining exact legacy operation compatibility',()=>{
  const legacy={nodes:[{id:'t',type:'tank',x:0,y:0},{id:'v',type:'valve',code:'V1',open:true}],
    edges:[line('e','t','out','v','in')]};
  const signature='topology-v1:{"nodes":[["t","tank",""],["v","valve","V1"]],"edges":[["e","t","out","v","in"]]}';
  assert.equal(topologySignature(legacy),signature);
  const old=captureOperation(legacy,{id:'old',name:'原作業'});
  assert.deepEqual(old.sources[0].portModes,{in:'inlet',out:'outlet'});
  assert.equal(operationMatches(legacy,old),true);
  legacy.nodes[0].portCount=3;
  assert.equal(operationMatches(legacy,old),false);assert.throws(()=>applyOperation(legacy,old),{code:'incompatible'});

  const graph={nodes:[triple({out2Angle:33,rotation:17,scale:3,portModes:{in:'outlet',out:'inlet',out2:'closed'}})],edges:[]};
  const captured=captureOperation(graph,{id:'three',name:'特殊作業'}),normalized=normalizeOperations(JSON.parse(JSON.stringify([captured])))[0];
  assert.deepEqual(normalized.sources[0].portModes,{in:'outlet',out:'inlet',out2:'closed'});
  graph.nodes[0].portModes.out2='outlet';graph.nodes[0].fuel='diesel';
  assert.equal(operationMatches(graph,captured),false);
  const applied=applyOperation(graph,normalized);
  assert.equal(applied.nodes[0].portModes.out2,'closed');assert.equal(applied.nodes[0].fuel,'diesel');
  assert.equal(applied.nodes[0].out2Angle,33);assert.equal(applied.nodes[0].rotation,17);assert.equal(applied.nodes[0].scale,3);
  assert.equal(applied.nodes[0].portCount,3);assert.equal(operationMatches(applied,normalized),true);
  const incomplete=structuredClone(normalized);delete incomplete.sources[0].portModes.out2;
  assert.throws(()=>applyOperation(graph,incomplete),{code:'incompatible'});
});

test('copy and paste keep all third-port settings without sharing identity, roles or connections',()=>{
  const tank=triple({code:'TK-01',scale:30,rotation:90,out2Angle:270,
    portModes:{in:'inlet',out:'outlet',out2:'closed'}});
  const clipboard=copyComponent(tank),graph={nodes:[tank],edges:[]};
  const pasted=pasteComponent(graph,clipboard,{position:{x:5000,y:4000},idFactory:()=> 'copy'});
  const copy=pasted.project.nodes.find(node=>node.id==='copy');
  assert.equal(copy.portCount,3);assert.equal(copy.out2Angle,270);assert.equal(copy.portModes.out2,'closed');
  assert.deepEqual(componentPort(copy,'out2'),{x:6420,y:4000,dx:1,dy:0});
  assert.equal(copy.code,'TK-02');assert.deepEqual(pasted.project.edges,[]);assert.equal(graph.nodes.length,1);
  copy.portModes.out2='outlet';assert.equal(tank.portModes.out2,'closed');assert.equal(clipboard.portModes.out2,'closed');
  assert.throws(()=>copyComponent({...tank,portCount:2.5}),/接管口數量/);
});

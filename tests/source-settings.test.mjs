import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTankPortModes,normalizeGroundMode,sourcePortsForNode,inactiveSourcePort} from '../dist/source-settings.js';

test('legacy source settings retain existing tank and ground behavior',()=>{
 assert.deepEqual(normalizeTankPortModes({type:'tank'}),{in:'inlet',out:'outlet'});
 assert.deepEqual(sourcePortsForNode({type:'tank'}),['out']);
 assert.deepEqual(sourcePortsForNode({type:'tank',enabled:false}),[]);
 assert.equal(normalizeGroundMode({enabled:true,variant:'sink'}),'source');
 assert.equal(normalizeGroundMode({enabled:false,variant:'rise'}),'receive');
 assert.equal(normalizeGroundMode({variant:'rise'}),'receive');
 assert.deepEqual(sourcePortsForNode({type:'ground',enabled:true}),['port']);
});

test('tank nozzles independently receive, supply or close without changing physical identity',()=>{
 const tank={type:'tank',enabled:true,portModes:{in:'outlet',out:'outlet'}};
 assert.deepEqual(sourcePortsForNode(tank),['in','out']);
 tank.portModes.out='inlet';assert.deepEqual(sourcePortsForNode(tank),['in']);
 tank.portModes.in='inlet';assert.deepEqual(sourcePortsForNode(tank),[]);
 tank.portModes.in='closed';assert.equal(inactiveSourcePort(tank,'in'),true);
 assert.equal(inactiveSourcePort(tank,'out'),false);
 tank.enabled=false;tank.portModes.out='outlet';assert.deepEqual(sourcePortsForNode(tank),[]);
 assert.deepEqual(normalizeTankPortModes({portModes:{in:'invalid',out:'closed'}}),{in:'inlet',out:'closed'});
});

test('explicit station-end mode is authoritative independently of rise/sink glyph or legacy flag',()=>{
 for(const variant of ['rise','sink']){
  assert.deepEqual(sourcePortsForNode({type:'ground',variant,enabled:false,flowMode:'source'}),['port']);
  assert.deepEqual(sourcePortsForNode({type:'ground',variant,enabled:true,flowMode:'receive'}),[]);
  assert.deepEqual(sourcePortsForNode({type:'ground',variant,enabled:true,flowMode:'idle'}),[]);
  assert.equal(inactiveSourcePort({type:'ground',variant,flowMode:'idle'},'port'),true);
  assert.equal(inactiveSourcePort({type:'ground',variant,flowMode:'receive'},'port'),false);
 }
 assert.deepEqual(sourcePortsForNode({type:'valve',enabled:true}),[]);
});

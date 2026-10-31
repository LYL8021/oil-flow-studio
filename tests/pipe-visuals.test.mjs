import test from 'node:test';
import assert from 'node:assert/strict';
import {pipeBorderDashes} from '../dist/pipe-visuals.js';
import {pipePath} from '../dist/pipes.js';

const route=[{x:0,y:0},{x:100,y:0}];

test('equipment ends retain the full crossing underlay while pipe joins clip only its ends',()=>{
 assert.equal(pipeBorderDashes(route),null);
 assert.equal(pipeBorderDashes(route,{startJoin:true}),'0 0.2 0.8 2');
 assert.equal(pipeBorderDashes(route,{endJoin:true}),'0 0 0.8 2');
 assert.equal(pipeBorderDashes(route,{startJoin:true,endJoin:true}),'0 0.2 0.6 2');
});

test('branches and reversed traversal use complete route length without changing geometry',()=>{
 const points=[{x:0,y:0},{x:50,y:0},{x:50,y:50}],before=structuredClone(points);
 assert.equal(pipeBorderDashes(points,{startJoin:true,endJoin:true}),'0 0.2 0.6 2');
 assert.equal(pipeBorderDashes([...points].reverse(),{startJoin:true,endJoin:true}),'0 0.2 0.6 2');
 assert.deepEqual(points,before);
 const crossing=[[{x:50,y:-100},{x:50,y:100}]],path=pipePath(route,crossing);
 assert.match(path,/C/);
 pipeBorderDashes(route,{startJoin:true,endJoin:true});
 assert.equal(pipePath(route,crossing),path,'the same bridge path must be rendered for line and border');
});

test('short connected segments have no underlay end seam and never produce invalid dash values',()=>{
 for(const points of [[],[{x:0,y:0}],[{x:0,y:0},{x:0,y:0}],[{x:0,y:0},{x:12,y:0}]]){
  assert.equal(pipeBorderDashes(points,{startJoin:true,endJoin:true}),'0 2');
 }
 assert.equal(pipeBorderDashes(route,{startJoin:true,inset:0}),null);
 assert.throws(()=>pipeBorderDashes(route,{startJoin:1}),/無效/);
 assert.throws(()=>pipeBorderDashes(route,{startJoin:true,inset:-1}),/無效/);
 assert.throws(()=>pipeBorderDashes([{x:NaN,y:0}],{endJoin:true}),/座標/);
});

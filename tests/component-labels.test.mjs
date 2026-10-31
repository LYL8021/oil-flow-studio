import test from 'node:test';
import assert from 'node:assert/strict';
import {identifierLayout} from '../dist/component-labels.js';
import {referenceSymbol} from '../dist/symbols.js';
import {componentPort} from '../dist/component-geometry.js';

test('compact ground symbol and its saved logical port remain aligned',()=>{
 for(const [variant,position,path] of [['rise',16,'M16 0H-8'],['sink',-16,'M-16 0H8']]){
  assert.ok(referenceSymbol('ground',{variant}).includes(`d="${path}"`));
  assert.equal(componentPort({type:'ground',variant,x:0,y:0},'port').x,position);
  assert.deepEqual(identifierLayout({type:'ground',variant}),{x:0,y:28,anchor:'middle',badgeY:38});
 }
});

test('identifiers remain close below rotated and scaled visible equipment',()=>{
 assert.equal(identifierLayout({type:'valve'}).y,37);
 assert.equal(identifierLayout({type:'valve',rotation:90}).y,54);
 assert.equal(identifierLayout({type:'valve',rotation:90,scale:2}).y,90);
 assert.equal(identifierLayout({type:'valve',variant:'motor',rotation:180}).y,61);
 assert.equal(identifierLayout({type:'cross'}).anchor,'middle');
 assert.equal(identifierLayout({type:'cross'}).y,51);
 assert.equal(identifierLayout({type:'valve',variant:'riser'}).y,53);
});

test('standalone pipe identifiers follow transformed ends without scaling pipe thickness',()=>{
 const pipe={type:'pipe',x:10,y:20,length:240};
 assert.equal(identifierLayout(pipe).y,33);
 assert.equal(identifierLayout({...pipe,rotation:90,scale:2}).y,273);
 assert.equal(identifierLayout({...pipe,rotation:270,scale:.5}).y,93);
});

test('operation badges sit after identifiers while blank codes leave no empty label gap',()=>{
 const node={type:'valve',code:'V-01'};
 assert.equal(identifierLayout(node,{operationMode:true}).badgeY,47);
 assert.equal(identifierLayout({...node,code:''},{operationMode:true}).badgeY,29);
 assert.equal(identifierLayout({type:'text'}),null);
 assert.equal(identifierLayout({type:'point'}),null);
});

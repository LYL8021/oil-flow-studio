import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTextMark, textMarkMarkup, textMarkBounds} from '../dist/text-marks.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('annotations preserve explicit blank, whitespace and multiple lines without mutating the node', () => {
  const node = {text:'通霄 → 日南\n\n  12 吋\r\n備註', fontSize:22, textColor:'#Ab12Cd', textAlign:'end', bold:true, x:10};
  const before = structuredClone(node);
  assert.deepEqual(normalizeTextMark(node), {text:node.text,fontSize:22,textColor:'#Ab12Cd',textAlign:'end',bold:true});
  assert.equal(normalizeTextMark({text:''}).text,'');
  assert.equal(normalizeTextMark({text:'  '}).text,'  ');
  assert.equal(normalizeTextMark({}).text,'文字標記');
  assert.equal(normalizeTextMark({text:'A\u0000B\u000bC\nD\tE'}).text,'ABC\nD\tE');
  assert.equal(Array.from(normalizeTextMark({text:'🛢'.repeat(2001)}).text).length,2000);
  textMarkMarkup(node);textMarkBounds(node);
  assert.deepEqual(node,before);
});

test('style normalization rejects unsafe colors and coercions and clamps finite font sizes', () => {
  for (const fontSize of [NaN, Infinity, '24', null]) assert.equal(normalizeTextMark({fontSize}).fontSize,18);
  assert.equal(normalizeTextMark({fontSize:1}).fontSize,8);
  assert.equal(normalizeTextMark({fontSize:500}).fontSize,72);
  assert.equal(normalizeTextMark({fontSize:20.5}).fontSize,20.5);
  for(const textColor of ['red','#abc','url(javascript:alert(1))','" onload="alert(1)','auto',null])assert.equal(normalizeTextMark({textColor}).textColor,'auto');
  assert.equal(normalizeTextMark({textColor:'#aBc012'}).textColor,'#aBc012');
  for(const textAlign of ['left','right','middle" onload="1',null])assert.equal(normalizeTextMark({textAlign}).textAlign,'start');
  assert.equal(normalizeTextMark({bold:'true'}).bold,false);
  assert.equal(normalizeTextMark({bold:1}).bold,false);
});

test('markup escapes text and keeps untrusted input out of SVG attributes and elements', () => {
  const markup=textMarkMarkup({text:'<script>alert("x")</script>\nA & B \'備註\'',textColor:'" onload="evil',textAlign:'start" evil="1'});
  assert.doesNotMatch(markup,/<script|onload=|evil=/);
  assert.match(markup,/&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(markup,/A &amp; B &#39;備註&#39;/);
  assert.match(markup,/fill="var\(--diagram-label\)"/);
  assert.match(markup,/text-anchor="start"/);
  assert.equal((markup.match(/<tspan /g)||[]).length,2);
  assert.match(markup,/dy="25\.2"/);
});

test('blank marks remain clickable, and multiline/CJK bounds reflect their size', () => {
  const blank=textMarkMarkup({text:''});
  assert.match(blank,/class="text-mark-hit"[^>]*width="30"/);
  assert.match(blank,/<tspan x="0" y="0"><\/tspan>/);
  const single=textMarkBounds({text:'國際',fontSize:20}), ascii=textMarkBounds({text:'ii',fontSize:20});
  assert.ok(single[1].x-single[0].x > ascii[1].x-ascii[0].x);
  const multi=textMarkBounds({text:'國際\n管線',fontSize:20});
  near(multi[2].y-multi[1].y-(single[2].y-single[1].y),28);
});

test('start, center and end alignment shift the local clickable box consistently', () => {
  const start=textMarkBounds({text:'供油',fontSize:20,textAlign:'start'});
  const middle=textMarkBounds({text:'供油',fontSize:20,textAlign:'middle'});
  const end=textMarkBounds({text:'供油',fontSize:20,textAlign:'end'});
  near(start[0].x,-6);near(middle[0].x,-26);near(end[0].x,-46);
  assert.match(textMarkMarkup({text:'供油',textAlign:'middle',bold:true}),/text-anchor="middle"[^>]*font-weight="700"/);
});

test('world bounds rotate around the annotation origin and translate without changing dimensions', () => {
  const node={text:'管線\n方向',fontSize:20,x:100,y:200,rotation:90};
  const local=textMarkBounds({...node,x:0,y:0,rotation:0}), rotated=textMarkBounds(node);
  for(let index=0;index<4;index++) {
    near(rotated[index].x,100-local[index].y);
    near(rotated[index].y,200+local[index].x);
  }
  const invalid=textMarkBounds({text:'test',x:Infinity,y:NaN,rotation:'90'});
  assert.equal(invalid.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)),true);
  assert.equal(textMarkBounds({text:'test',rotation:Number.MAX_VALUE}).every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)),true);
});

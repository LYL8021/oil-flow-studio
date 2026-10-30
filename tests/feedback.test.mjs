import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFeedbackItem,normalizeFeedbackPage,feedbackCsv,feedbackText} from '../dist/feedback.js';

const item={id:'abc',name:'同仁',title:'調整接點',category:'idea',body:'第一行\n第二行',createdAt:Date.UTC(2026,9,30,0,0)};

test('shared feedback pages validate records and pagination without replacing real content',()=>{
 const page=normalizeFeedbackPage({items:[item],total:3,nextCursor:'1793318400000.abc'});
 assert.deepEqual(page.items,[item]);assert.equal(page.total,3);assert.ok(page.nextCursor);
 assert.notEqual(page.items[0],item);
 for(const bad of [{items:[item],total:0},{items:[item,item],total:2},{items:[item],total:1,nextCursor:''},{items:[{...item,createdAt:'not-a-date'}],total:1}])assert.throws(()=>normalizeFeedbackPage(bad),/留言資料/);
 assert.throws(()=>normalizeFeedbackItem({...item,category:'<script>'}),/留言資料/);
 // Server limits count Unicode characters, including non-BMP characters.
 assert.equal(normalizeFeedbackItem({...item,title:'🛢'.repeat(80)}).title,'🛢'.repeat(80));
 assert.throws(()=>normalizeFeedbackItem({...item,title:'🛢'.repeat(81)}),/留言資料/);
});

test('CSV retains multiline quotes and Chinese while neutralizing spreadsheet formulas',()=>{
 const csv=feedbackCsv([{...item,name:'=CMD()',title:' \t+SUM(1,1)',body:'備註 "引號"\n下一行'}, {...item,id:'two',name:'@帳號',title:'-2+3',body:'\t內容'}]);
 assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/"'=CMD\(\)"/);assert.match(csv,/"' \t\+SUM\(1,1\)"/);
 assert.match(csv,/備註 ""引號""\n下一行/);assert.match(csv,/"'@帳號"/);assert.match(csv,/"'-2\+3"/);assert.match(csv,/"'\t內容"/);
 assert.match(csv,/2026\/10\/30/);
});

test('copied aggregation includes anonymous authors, all categories and complete body text',()=>{
 const text=feedbackText([{...item,name:''},{...item,id:'two',category:'bug',title:'另一個問題'}]);
 assert.match(text,/1\. 調整接點/);assert.match(text,/功能建議 · 匿名/);assert.match(text,/第一行\n第二行/);assert.match(text,/2\. 另一個問題/);assert.match(text,/問題回報/);
});

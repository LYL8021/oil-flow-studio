import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {access, stat} from 'node:fs/promises';
import {runImport, IMPORT_SOURCE, exportSource, createWranglerExecutor, snapshotChunks} from '../server/cloudflare/import-source.mjs';
import {createD1SnapshotStore} from '../server/d1-snapshots.js';

const drawingId='11111111-1111-4111-8111-111111111111';
const feedbackId='22222222-2222-4222-8222-222222222222';
function fixture({large=false}={}) {
  const p={title:'日南「共用」😀',nodes:[{id:'tank',type:'tank',x:100,y:120,scale:30,rotation:45,
    fuel:'diesel',enabled:true,inAngle:210,outAngle:15,portModes:{in:'outlet',out:'outlet'},name:'',code:''},
    {id:'valve',type:'valve',x:300,y:120,open:true,variant:'riser',name:'',code:'RN-G2'}],
    edges:[{id:'edge',from:{node:'tank',port:'out'},to:{node:'valve',port:'in'},routing:'free',kind:'underground',layer:2,waypoints:[{x:200,y:80}]}],
    reference:{dataUrl:'data:image/png;base64,'+'YWJj'.repeat(large?600000:18000),width:200,height:120,baseWidth:200,baseHeight:120,x:20,y:30,opacity:.22,visible:true},
    operations:[{id:'op',name:'停止輸送',valves:[{id:'valve',open:false}],sources:[{id:'tank',type:'tank',enabled:false,portModes:{in:'inlet',out:'inlet'}}],signature:'topology-v1:{"nodes":[],"edges":[]}'}],note:'跨行\n完整字元😀𠮷'};
  const meta={id:drawingId,name:p.title,createdAt:100,updatedAt:200,nodeCount:2,edgeCount:1,operationCount:1,revision:1};
  const first={...meta,project:structuredClone(p)};p.nodes[1].open=false;p.nodes[0].portModes.in='closed';
  const latest={...meta,revision:2,updatedAt:300,project:p};
  const comment={id:feedbackId,name:'同仁',title:"'; DROP TABLE feedback; --",category:'idea',body:'原有留言\n<iframe>😀',createdAt:150};
  return {first,latest,comment};
}
function source(data=fixture(),{change=false,paginate=false}={}) {
  const calls=[];let headCalls=0;
  const fetcher=async(url,options={})=>{
    assert.ok(url.startsWith(IMPORT_SOURCE+'/'));assert.ok(options.method==null||options.method==='GET');calls.push(url);
    const u=new URL(url),path=u.pathname,meta=record=>Object.fromEntries(Object.entries(record).filter(([key])=>key!=='project'));
    let result;
    if(path==='/api/drawings'){headCalls++;result={items:[meta(change&&headCalls>1?{...data.latest,revision:3}:data.latest)],total:1,nextCursor:null};}
    else if(path==='/api/feedback')result={items:[data.comment],total:1,nextCursor:null};
    else if(path===`/api/drawings/${drawingId}`)result=data.latest;
    else if(path===`/api/drawings/${drawingId}/revisions`){
      const cursor=u.searchParams.get('cursor');
      result=paginate?{items:[meta(cursor?data.first:data.latest)],total:2,nextCursor:cursor?null:'1'}:{items:[meta(data.latest),meta(data.first)],total:2,nextCursor:null};
    }else if(path===`/api/drawings/${drawingId}/revisions/1`)result=data.first;
    else if(path===`/api/drawings/${drawingId}/revisions/2`)result=data.latest;
    else throw Error('Unexpected source path');
    return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
  };
  return {fetcher,calls,data};
}
async function target() {
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  for(const file of ['../server/feedback-schema.sql','../server/drawings-schema.sql','../server/d1-snapshots-schema.sql','../server/cloudflare/migrations/0004_cloud_import.sql'])db.exec(await readFile(new URL(file,import.meta.url),'utf8'));
  const sql=async text=>/^SELECT\b/.test(text.trim())?db.prepare(text).all(): (db.exec(text),[]);
  const DB={prepare(query){const wrap=values=>({bind(...args){return wrap(args);},async first(){return db.prepare(query).get(...values)||null;},async all(){return {results:db.prepare(query).all(...values)};}});return wrap([]);},async batch(){throw Error('Import verification must not mutate snapshots');}};
  return {db,sql,snapshots:createD1SnapshotStore(DB)};
}

test('CI import preserves all full historical drawings, Unicode chunks, identifiers and timestamps in real SQLite',async()=>{
  const t=await target(),s=source(fixture({large:true}),{paginate:true});
  try{
    const result=await runImport({sql:t.sql,fetcher:s.fetcher,now:()=>1000});
    assert.deepEqual({...result,checksum:null},{status:'imported',feedback:1,drawings:1,revisions:2,checksum:null});
    const drawing=t.db.prepare('SELECT * FROM drawings').get();assert.equal(drawing.id,drawingId);assert.equal(drawing.revision,2);assert.equal(drawing.created_at,100);assert.equal(drawing.updated_at,300);
    for(const record of [s.data.first,s.data.latest]){
      const saved=t.db.prepare('SELECT * FROM drawing_revisions WHERE revision=?').get(record.revision);
      assert.equal(saved.created_at,record.createdAt);assert.equal(saved.updated_at,record.updatedAt);
      assert.deepEqual(await (await t.snapshots.get(saved.object_key)).json(),record.project);
      assert.ok(saved.request_id.match(/^[0-9a-f-]{36}$/));
    }
    const comment=t.db.prepare('SELECT * FROM feedback').get();assert.equal(comment.id,feedbackId);assert.equal(comment.title,s.data.comment.title);assert.equal(comment.created_at,150);
    assert.ok(t.db.prepare('SELECT COUNT(*) n FROM drawing_snapshot_chunks').get().n>100,'large snapshots must not live in one D1 row');
    assert.equal(t.db.prepare('SELECT status FROM cloud_import_state').get().status,'completed');
    assert.ok(s.calls.some(url=>url.includes('cursor=1')),'history pagination must be traversed');
  }finally{t.db.close();}
});

test('completed imports never contact the old service again and preserve later user edits',async()=>{
  const t=await target(),s=source();
  try{
    await runImport({sql:t.sql,fetcher:s.fetcher});
    t.db.exec("UPDATE feedback SET body='後續使用者變更'");
    const result=await runImport({sql:t.sql,fetcher:async()=>{throw Error('Old subscription has ended');}});
    assert.equal(result.status,'already-imported');assert.equal(t.db.prepare('SELECT body FROM feedback').get().body,'後續使用者變更');
  }finally{t.db.close();}
});

test('unknown target data is rejected before network access and cannot be overwritten',async()=>{
  const t=await target();
  try{
    t.db.exec("INSERT INTO feedback VALUES ('owner-row','','既有資料','idea','保留',100)");
    await assert.rejects(runImport({sql:t.sql,fetcher:async()=>{throw Error('must not fetch');}}),/not empty/);
    assert.equal(t.db.prepare('SELECT body FROM feedback').get().body,'保留');assert.equal(t.db.prepare('SELECT COUNT(*) n FROM cloud_import_state').get().n,0);
  }finally{t.db.close();}
});

test('interrupted imports resume only exact matching staged rows; changed data is never replaced',async()=>{
  const t=await target(),s=source();let fail=true;
  try{
    const partial=async text=>{
      if(fail&&text.startsWith('INSERT INTO feedback')){fail=false;await t.sql(text.split(';')[0]+';');throw Error('ambiguous D1 failure');}
      return t.sql(text);
    };
    await assert.rejects(runImport({sql:partial,fetcher:s.fetcher}),/ambiguous/);
    assert.equal(t.db.prepare('SELECT status FROM cloud_import_state').get().status,'importing');
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM feedback').get().n,1);
    const result=await runImport({sql:t.sql,fetcher:s.fetcher});assert.equal(result.status,'imported');
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM feedback').get().n,1);assert.equal(t.db.prepare('SELECT COUNT(*) n FROM drawing_revisions').get().n,2);
  }finally{t.db.close();}
  const t2=await target(),s2=source();
  try{
    await assert.rejects(runImport({sql:async text=>{if(text.startsWith('INSERT INTO feedback'))throw Error('interrupted');return t2.sql(text);},fetcher:s2.fetcher}));
    t2.db.exec("INSERT INTO feedback VALUES ('unexpected','','額外資料','idea','不可覆寫',100)");
    await assert.rejects(runImport({sql:t2.sql,fetcher:s2.fetcher}),/unknown or different/);
    assert.equal(t2.db.prepare('SELECT body FROM feedback').get().body,'不可覆寫');
  }finally{t2.db.close();}
});

test('changing source metadata fails before importing any record or claiming ownership',async()=>{
  const t=await target(),s=source(fixture(),{change:true});
  try{
    await assert.rejects(runImport({sql:t.sql,fetcher:s.fetcher}),/Source changed/);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM cloud_import_state').get().n,0);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM feedback').get().n,0);
    assert.equal(t.db.prepare('SELECT COUNT(*) n FROM drawings').get().n,0);
  }finally{t.db.close();}
});

test('UTF8 import chunks and private Wrangler files obey SQL limits, hide failures and clean up',async()=>{
  const input='😀𠮷日南\n'.repeat(20000);assert.equal(snapshotChunks(input).join(''),input);
  for(const chunk of snapshotChunks(input))assert.ok(Buffer.byteLength(chunk,'utf8')<=32768);
  let fileSeen;
  const executor=createWranglerExecutor({directory:'/workspace/shared/oil-flow-studio/server/cloudflare',execute:async(_command,args,options)=>{
    assert.equal(args.includes('--command'),false);assert.equal(options.encoding,'utf8');
    fileSeen=args[args.indexOf('--file')+1];assert.match(fileSeen,/oil-cloud-import-/);
    assert.equal((await stat(fileSeen)).mode&0o777,0o600);assert.equal(await readFile(fileSeen,'utf8'),'INSERT INTO test VALUES (1);');
    return {stdout:'[{"success":true,"results":[{"value":1}]}]'};
  }});
  assert.deepEqual(await executor('INSERT INTO test VALUES (1);'),[{value:1}]);await assert.rejects(access(fileSeen));
  const reader=createWranglerExecutor({execute:async(_command,args)=>{
    assert.equal(args.includes('--file'),false);assert.equal(args[args.indexOf('--command')+1],'SELECT 1;');
    return {stdout:'[{"success":true,"results":[{"value":1}]}]'};
  }});
  assert.deepEqual(await reader('SELECT 1;'),[{value:1}]);
  const failure=createWranglerExecutor({execute:async()=>{throw Error('PRIVATE TOKEN AND USER DRAWING');}});
  await assert.rejects(failure('SELECT 1;'),error=>!error.message.includes('PRIVATE')&&/database operation failed/.test(error.message));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../server/feedback-worker.js';

const ORIGIN='https://oil-flow-studio.vercel.app';
const BASE='https://feedback.example.test';
const id=n=>`${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const schema=name=>readFileSync(new URL('../server/'+name,import.meta.url),'utf8');

function storage(){
  const sql=new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  sql.exec(schema('feedback-schema.sql'));
  sql.exec(schema('drawings-schema.sql'));
  const statements=[];
  const DB={prepare(query){
    statements.push(query);
    assert.doesNotMatch(query,/\b(?:CREATE|ALTER|DROP)\b/i,'requests must never migrate the database');
    assert.ok(!query.includes(';'),'one SQL statement per D1 prepare');
    const statement=sql.prepare(query);
    const prepared=values=>({
      bind(...parameters){return prepared(parameters);},
      async all(){return {success:true,results:statement.all(...values)};},
      async first(){return statement.get(...values)||null;},
      async run(){return this.execute();},
      execute(){const r=statement.run(...values);return {success:true,meta:{changes:Number(r.changes)}};}
    });
    return prepared([]);
  },async batch(batch){
    sql.exec('BEGIN');
    try{const results=batch.map(s=>s.execute());sql.exec('COMMIT');return results;}
    catch(error){sql.exec('ROLLBACK');throw error;}
  }};
  const objects=new Map();
  const BUCKET={async put(key,value){objects.set(key,typeof value==='string'?value:await new Response(value).text());return {key};},
    async get(key){const value=objects.get(key);return value===undefined?null:{text:async()=>value,json:async()=>JSON.parse(value)};},
    async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);}};
  return {sql,DB,BUCKET,objects,statements,env:{DB,BUCKET},close:()=>sql.close()};
}

function drawing(){
  const nodes=[
    {id:'tank1',type:'tank',x:100,y:200,scale:30,rotation:45,inAngle:15,outAngle:155,portModes:{in:'outlet',out:'outlet'},enabled:true,fuel:'diesel',code:'',name:'',capacity:50000},
    {id:'valve1',type:'valve',x:500,y:200,open:false,variant:'riser',rotation:90,scale:1,name:'',code:'V-01'},
    {id:'ground1',type:'ground',variant:'sink',x:600,y:200,flowMode:'receive',enabled:false,fuel:'gasoline',station:'王田',name:'',code:''}
  ];
  const edges=[{id:'e1',from:{node:'tank1',port:'out'},to:{node:'valve1',port:'in'},kind:'bridge',routing:'free',layer:4,waypoints:[{x:320,y:200},{x:350,y:280}]},
    {id:'e2',from:{node:'valve1',port:'out'},to:{node:'ground1',port:'port'},kind:'underground',routing:'orthogonal',waypoints:[]}];
  return {title:'輸王田',nodes,edges,reference:{dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',width:1000,height:1000,baseWidth:1000,baseHeight:1000,x:0,y:0,visible:true,opacity:.22},
    operations:[{id:'op1',name:'停止供油',signature:'topology-v1:'+JSON.stringify({nodes:[['ground1','ground',''],['tank1','tank',''],['valve1','valve','V-01']],edges:[['e1','tank1','out','valve1','in'],['e2','valve1','out','ground1','port']]}),
      valves:[{id:'valve1',open:false}],sources:[{id:'tank1',type:'tank',enabled:true,portModes:{in:'outlet',out:'outlet'}},{id:'ground1',type:'ground',enabled:false,flowMode:'receive'}],createdAt:100,updatedAt:200}],
    draftInfo:{kind:'image',title:'日南參考',notice:'請人工核對',reviewNotes:['A／B 口方向已確認']}};
}

function request(path='/api/drawings',{method='GET',body,origin=ORIGIN,headers={}}={}){
  return new Request(BASE+path,{method,headers:{...(origin?{Origin:origin}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
    ...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
}
const input=(n,overrides={})=>({requestId:id(n),name:'輸王田',project:drawing(),...overrides});
async function fetchJson(db,path='/api/drawings',options={}){
  const response=await worker.fetch(request(path,options),db.env);
  const data=await response.json();return {response,data};
}
async function create(db,n=1,overrides={}){
  const result=await fetchJson(db,'/api/drawings',{method:'POST',body:input(n,overrides)});
  assert.equal(result.response.status,201,JSON.stringify(result.data));return result.data.item;
}
const update=(db,item,n,overrides={})=>fetchJson(db,'/api/drawings',{method:'POST',body:input(n,{id:item.id,expectedRevision:item.revision,name:item.name,...overrides})});

test('drawings persist in shared storage across independent readers with complete geometry, background and operations',async()=>{
  const db=storage();
  try{
    const saved=await create(db);
    assert.equal(saved.name,'輸王田');assert.equal(saved.revision,1);
    assert.deepEqual(saved.project,drawing());
    const listed=await fetchJson(db);
    assert.equal(listed.response.status,200);assert.equal(listed.data.total,1);assert.equal(listed.data.nextCursor,null);
    assert.equal(listed.data.items[0].id,saved.id);assert.equal(listed.data.items[0].nodeCount,3);
    assert.equal(listed.data.items[0].edgeCount,2);assert.equal(listed.data.items[0].operationCount,1);
    assert.equal(listed.data.items[0].project,undefined,'list responses carry metadata rather than every full image');
    const independent=await fetchJson(db,'/api/drawings/'+saved.id);
    assert.equal(independent.response.status,200);assert.deepEqual(independent.data.project,drawing());
    assert.equal(independent.response.headers.get('Cache-Control'),'no-store');
    assert.equal(independent.response.headers.get('Access-Control-Allow-Origin'),ORIGIN);
    assert.equal(db.objects.size,1);
  }finally{db.close();}
});

test('optimistic updates keep immutable historical snapshots and reject stale writers atomically',async()=>{
  const db=storage();
  try{
    const first=await create(db);
    const a=drawing(),b=drawing();a.nodes[0].x=350;b.nodes[0].x=900;
    const results=await Promise.all([update(db,first,2,{project:a}),update(db,first,3,{project:b})]);
    assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);
    const conflict=results.find(r=>r.response.status===409);assert.equal(conflict.data.code,'conflict');
    const winner=results.find(r=>r.response.status===200).data.item;
    assert.equal(winner.revision,2);
    const current=await fetchJson(db,'/api/drawings/'+first.id);
    assert.deepEqual(current.data.project,winner.project);
    const old=await fetchJson(db,`/api/drawings/${first.id}/revisions/1`);
    assert.deepEqual(old.data.project,drawing());assert.equal(old.data.revision,1);
    const history=await fetchJson(db,`/api/drawings/${first.id}/revisions`);
    assert.deepEqual(history.data.items.map(v=>v.revision),[2,1]);assert.equal(history.data.total,2);
    assert.equal(db.objects.size,2,'the losing writer leaves neither a live nor historical file');
    const noExpected=await fetchJson(db,'/api/drawings',{method:'POST',body:input(4,{id:first.id})});
    assert.equal(noExpected.response.status,400);
  }finally{db.close();}
});

test('identical create retries are idempotent while a reused request ID cannot change data',async()=>{
  const db=storage();
  try{
    const results=await Promise.all([fetchJson(db,'/api/drawings',{method:'POST',body:input(1)}),fetchJson(db,'/api/drawings',{method:'POST',body:input(1)})]);
    assert.deepEqual(results.map(r=>r.response.status).sort(),[200,201]);
    assert.deepEqual(results.map(r=>r.data.item.id),[id(1),id(1)]);
    assert.equal((await fetchJson(db)).data.total,1);assert.equal(db.objects.size,1);
    const reused=await fetchJson(db,'/api/drawings',{method:'POST',body:input(1,{name:'不應覆寫'})});
    assert.equal(reused.response.status,409);
    assert.equal((await fetchJson(db,'/api/drawings/'+id(1))).data.name,'輸王田');
    const raced=await Promise.all(['甲圖','乙圖'].map(name=>fetchJson(db,'/api/drawings',{method:'POST',body:input(4,{name})})));
    assert.deepEqual(raced.map(r=>r.response.status).sort(),[201,409]);
    const accepted=raced.find(r=>r.response.status===201).data.item;
    const read=await fetchJson(db,'/api/drawings/'+accepted.id);
    assert.equal(read.response.status,200);assert.equal(read.data.name,accepted.name);
    assert.deepEqual(read.data.project,accepted.project,'a racing reused ID must never replace the winning file contents');
    assert.equal(db.objects.size,2);
  }finally{db.close();}
});

test('a request ID collision across different drawings rolls back the losing metadata update and history', {timeout:5000}, async()=>{
  const db=storage();
  try{
    const first=await create(db,1),second=await create(db,2,{name:'第二張'}),batch=db.DB.batch;
    let arrivals=0,release;
    const barrier=new Promise(resolve=>{release=resolve;});
    db.DB.batch=async statements=>{
      if(++arrivals===2)release();
      await barrier;
      return batch(statements);
    };
    const a=drawing(),b=drawing();a.nodes[0].x=1200;b.nodes[0].x=2400;
    const responses=await Promise.all([update(db,first,8,{project:a}),update(db,second,8,{project:b})]);
    assert.equal(arrivals,2,'both requests pass preliminary deduplication before either SQL transaction starts');
    assert.deepEqual(responses.map(r=>r.response.status).sort(),[200,409]);
    const winnerIndex=responses.findIndex(r=>r.response.status===200),loserIndex=1-winnerIndex;
    const initial=[first,second],accepted=responses[winnerIndex].data.item;
    const winner=await fetchJson(db,'/api/drawings/'+initial[winnerIndex].id);
    assert.equal(winner.data.revision,2);assert.deepEqual(winner.data.project,accepted.project);
    assert.equal((await fetchJson(db,`/api/drawings/${initial[winnerIndex].id}/revisions`)).data.total,2);
    const loser=await fetchJson(db,'/api/drawings/'+initial[loserIndex].id);
    assert.equal(loser.data.revision,1);assert.deepEqual(loser.data.project,drawing());
    assert.equal((await fetchJson(db,`/api/drawings/${initial[loserIndex].id}/revisions`)).data.total,1);
    assert.equal(db.objects.size,3,'only two original snapshots and the accepted update remain');
  }finally{db.close();}
});

test('retrying a lost update response after newer revisions returns that exact accepted revision',async()=>{
  const db=storage();
  try{
    const first=await create(db),project=drawing();project.nodes[1].open=true;
    const accepted=await update(db,first,2,{project});assert.equal(accepted.response.status,200);
    const third=await update(db,accepted.data.item,3,{name:'輸王田新版'});assert.equal(third.response.status,200);
    const retry=await update(db,first,2,{project});assert.equal(retry.response.status,200);
    assert.equal(retry.data.duplicate,true);assert.equal(retry.data.item.revision,2);
    assert.deepEqual(retry.data.item.project,project);
    const latest=await fetchJson(db,'/api/drawings/'+first.id);assert.equal(latest.data.revision,3);
    assert.equal(latest.data.name,'輸王田新版');
    const createRetry=await fetchJson(db,'/api/drawings',{method:'POST',body:input(1)});
    assert.equal(createRetry.response.status,200);assert.equal(createRetry.data.duplicate,true);
    assert.equal(createRetry.data.item.revision,1);assert.deepEqual(createRetry.data.item.project,drawing());
  }finally{db.close();}
});

test('normalized names remain unique and a failed rename preserves both drawings and revision history',async()=>{
  const db=storage();
  try{
    const first=await create(db,1,{name:' ＲＮ  圖面 '}),second=await create(db,2,{name:'第二張'});
    assert.equal(first.name,'ＲＮ 圖面');
    const collision=await createCollision();
    assert.equal(collision.response.status,409);assert.equal(collision.data.code,'name-exists');
    const rename=await update(db,second,4,{name:'rn 圖面'});
    assert.equal(rename.response.status,409);assert.equal(rename.data.code,'name-exists');
    assert.equal((await fetchJson(db,'/api/drawings/'+second.id)).data.name,'第二張');
    assert.equal((await fetchJson(db,`/api/drawings/${second.id}/revisions`)).data.total,1);
    assert.equal(db.objects.size,2);
    async function createCollision(){return fetchJson(db,'/api/drawings',{method:'POST',body:input(3,{name:'rn 圖面'})});}
  }finally{db.close();}
});

test('file and database failures never report a successful save or damage the last accepted snapshot',async()=>{
  const db=storage();
  try{
    const first=await create(db),realPut=db.BUCKET.put,realBatch=db.DB.batch;
    db.BUCKET.put=async()=>{throw Error('private R2 failure details');};
    const r2Failure=await update(db,first,2);
    assert.equal(r2Failure.response.status,503);assert.doesNotMatch(JSON.stringify(r2Failure.data),/private R2/);
    assert.equal((await fetchJson(db,'/api/drawings/'+first.id)).data.revision,1);
    db.BUCKET.put=realPut;db.DB.batch=async()=>{throw Error('private D1 failure details');};
    const dbFailure=await update(db,first,3);
    assert.equal(dbFailure.response.status,503);assert.doesNotMatch(JSON.stringify(dbFailure.data),/private D1/);
    db.DB.batch=realBatch;
    assert.equal((await fetchJson(db,'/api/drawings/'+first.id)).data.revision,1);
    assert.equal((await fetchJson(db,`/api/drawings/${first.id}/revisions`)).data.total,1);
    assert.equal(db.objects.size,1);
    db.objects.clear();
    const missingFile=await fetchJson(db,'/api/drawings/'+first.id);
    assert.equal(missingFile.response.status,503);
    const unavailable=await worker.fetch(request(),{});assert.equal(unavailable.status,503);
  }finally{db.close();}
});

test('ambiguous database response loss is resolved from committed history without deleting a referenced file',async()=>{
  const db=storage();
  try{
    const first=await create(db),batch=db.DB.batch;
    db.DB.batch=async commands=>{await batch(commands);throw Error('response lost after commit');};
    const response=await update(db,first,2);
    assert.equal(response.response.status,200,JSON.stringify(response.data));
    assert.equal(response.data.item.revision,2);
    assert.equal(db.objects.size,2);
    assert.equal((await fetchJson(db,`/api/drawings/${first.id}/revisions/2`)).response.status,200);
  }finally{db.close();}
});

test('invalid graphs, reference URLs and malformed or oversized requests are rejected before any storage write',async()=>{
  const db=storage();
  try{
    const withOperation=patch=>({...drawing(),operations:[{...drawing().operations[0],...patch}]});
    const invalidProjects=[null,{},[],{nodes:[],edges:null},{nodes:Array(401).fill(drawing().nodes[0]),edges:[]},
      {...drawing(),nodes:[...drawing().nodes,drawing().nodes[0]]},
      {...drawing(),nodes:[{...drawing().nodes[0],id:'<unsafe>',x:0,y:0}]},
      {...drawing(),nodes:[{...drawing().nodes[0],x:40001}]},
      {...drawing(),nodes:[{...drawing().nodes[0],type:'script'}]},
      {...drawing(),edges:[{...drawing().edges[0],from:{node:'absent',port:'out'}}]},
      {...drawing(),edges:[{...drawing().edges[0],to:{node:'valve1',port:'not-a-port'}}]},
      {...drawing(),edges:[{...drawing().edges[0],waypoints:[{x:0,y:40001}]}]},
      {...drawing(),reference:{...drawing().reference,dataUrl:'javascript:alert(1)'}},
      {...drawing(),reference:{...drawing().reference,dataUrl:'https://external.example/private.png'}},
      {...drawing(),reference:{...drawing().reference,dataUrl:'data:image/svg+xml;base64,PHN2Zy8+'}},
      {...drawing(),reference:{...drawing().reference,width:30001}},
      {...drawing(),reference:{...drawing().reference,baseWidth:0}},
      {...drawing(),reference:{...drawing().reference,baseWidth:3001}},
      {...drawing(),reference:{...drawing().reference,baseHeight:500}},
      withOperation({signature:'topology-v1:{broken'}),
      withOperation({signature:'topology-v1:[]'}),
      withOperation({signature:'topology-v1:'+JSON.stringify({nodes:[],edges:null})}),
      withOperation({valves:[{id:'valve1',open:false},{id:'valve1',open:true}]}),
      withOperation({sources:[drawing().operations[0].sources[0],drawing().operations[0].sources[0]]}),
      withOperation({createdAt:-1}),withOperation({updatedAt:-1}),withOperation({createdAt:'100'}),
      {...drawing(),operations:[{...drawing().operations[0],name:'RN 圖面'}, {...drawing().operations[0],id:'op2',name:'ＲＮ  圖面'}]}];
    const invalid=[input(1,{requestId:'bad'}),input(1,{name:''}),input(1,{name:'字'.repeat(81)}),input(1,{name:'bad\u0000name'}),
      input(1,{id:'bad',expectedRevision:1}),input(1,{id:id(10),expectedRevision:0}),
      ...invalidProjects.map(project=>input(1,{project}))];
    for(const body of invalid){const result=await fetchJson(db,'/api/drawings',{method:'POST',body});assert.equal(result.response.status,400,JSON.stringify(body).slice(0,160));}
    assert.equal((await fetchJson(db,'/api/drawings',{method:'POST',body:'{broken'})).response.status,400);
    assert.equal((await fetchJson(db,'/api/drawings',{method:'POST',body:'{}',headers:{'Content-Type':'text/plain'}})).response.status,415);
    assert.equal((await fetchJson(db,'/api/drawings',{method:'POST',body:'{}',headers:{'Content-Length':String(24*1024*1024+1)}})).response.status,413);
    const oversize=JSON.stringify({extra:'a'.repeat(24*1024*1024)});
    assert.equal((await fetchJson(db,'/api/drawings',{method:'POST',body:oversize})).response.status,413);
    assert.equal((await fetchJson(db)).data.total,0);assert.equal(db.objects.size,0);
  }finally{db.close();}
});

test('drawing and revision pagination is bounded and traverses without duplicate records',async()=>{
  const db=storage();
  try{
    const first=await create(db,1),second=await create(db,2,{name:'日南'}),third=await create(db,3,{name:'王田'});
    const one=await fetchJson(db,'/api/drawings?limit=2');
    assert.equal(one.data.total,3);assert.equal(one.data.items.length,2);assert.ok(one.data.nextCursor);
    const two=await fetchJson(db,'/api/drawings?limit=2&cursor='+encodeURIComponent(one.data.nextCursor));
    assert.equal(two.data.items.length,1);assert.equal(two.data.nextCursor,null);
    assert.deepEqual(new Set([...one.data.items,...two.data.items].map(v=>v.id)),new Set([first.id,second.id,third.id]));
    let last=first;
    for(let n=4;n<=6;n++){const r=await update(db,last,n);assert.equal(r.response.status,200);last=r.data.item;}
    const history1=await fetchJson(db,`/api/drawings/${first.id}/revisions?limit=2`);
    assert.deepEqual(history1.data.items.map(v=>v.revision),[4,3]);assert.ok(history1.data.nextCursor);
    const history2=await fetchJson(db,`/api/drawings/${first.id}/revisions?limit=2&cursor=${history1.data.nextCursor}`);
    assert.deepEqual(history2.data.items.map(v=>v.revision),[2,1]);assert.equal(history2.data.nextCursor,null);
    for(const query of ['limit=0','limit=101','limit=x','cursor=broken'])assert.equal((await fetchJson(db,'/api/drawings?'+query)).response.status,400);
    for(const query of ['limit=0','limit=101','cursor=broken','cursor=-1'])assert.equal((await fetchJson(db,`/api/drawings/${first.id}/revisions?${query}`)).response.status,400);
    assert.equal((await fetchJson(db,`/api/drawings/${id(99)}`)).response.status,404);
    assert.equal((await fetchJson(db,`/api/drawings/${first.id}/revisions/99`)).response.status,404);
  }finally{db.close();}
});

test('CORS and read-only history methods are enforced and existing feedback retains its records',async()=>{
  const db=storage();
  try{
    for(const origin of [ORIGIN,BASE,'null','http://localhost:4173','http://127.0.0.1:4173']){
      const r=await fetchJson(db,'/api/drawings',{origin});assert.equal(r.response.status,200);assert.equal(r.response.headers.get('Access-Control-Allow-Origin'),origin);
    }
    for(const origin of ['https://evil.test','https://oil-flow-studio.vercel.app.evil.test']){
      const r=await fetchJson(db,'/api/drawings',{origin,method:'POST',body:input(1)});assert.equal(r.response.status,403);assert.equal(r.response.headers.get('Access-Control-Allow-Origin'),null);
    }
    const preflight=await worker.fetch(request('/api/drawings',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST'}}),db.env);
    assert.equal(preflight.status,204);assert.match(preflight.headers.get('Access-Control-Allow-Methods'),/POST/);
    assert.match(preflight.headers.get('Access-Control-Allow-Headers'),/Content-Type/i);
    const saved=await create(db);
    assert.equal((await fetchJson(db,`/api/drawings/${saved.id}/revisions`,{method:'POST',body:{}})).response.status,405);
    const feedback=await fetchJson(db,'/api/feedback',{method:'POST',body:{requestId:id(80),title:'請保留留言',name:'同仁',body:'原本的修改建議仍然可用',category:'idea'}});
    assert.equal(feedback.response.status,201);
    assert.equal((await fetchJson(db,'/api/feedback')).data.items[0].body,'原本的修改建議仍然可用');
  }finally{db.close();}
});

test('maintenance-only deletion removes selected snapshots without deleting other drawings or feedback',async()=>{
  const db=storage(),secret='unit-test-runtime-only-secret';
  try{
    const first=await create(db,1),second=await create(db,2,{name:'保留圖面'});
    await update(db,first,3);
    const path='/api/drawings/'+first.id;
    assert.equal((await fetchJson(db,path,{method:'DELETE'})).response.status,403);
    db.env.FEEDBACK_ADMIN_KEY=secret;
    assert.equal((await fetchJson(db,path,{method:'DELETE',headers:{Authorization:'Bearer wrong'}})).response.status,403);
    const removed=await fetchJson(db,path,{method:'DELETE',headers:{Authorization:'Bearer '+secret}});
    assert.equal(removed.response.status,200);assert.deepEqual(removed.data,{id:first.id,deleted:true});
    assert.equal((await fetchJson(db,path)).response.status,404);
    assert.equal((await fetchJson(db,'/api/drawings/'+second.id)).response.status,200);
    assert.equal(db.objects.size,1);
    assert.equal((await fetchJson(db,path,{method:'DELETE',headers:{Authorization:'Bearer '+secret}})).response.status,404);
  }finally{db.close();}
});

// One-time owner-account import. Source data and SQL never go into Git or logs.
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, writeFile, rm, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const IMPORT_SOURCE = 'https://oil-flow-feedback-8c41.sacredzebra19.chatgpt.site';
const MIGRATION = 'sites-to-owner-d1-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META = ['id','name','revision','createdAt','updatedAt','nodeCount','edgeCount','operationCount'];
const FEEDBACK = ['id','name','title','category','body','createdAt'];
const MAX_BYTES = 24 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const TABLES = {
  feedback:{keys:['id'],columns:['id','name','title','category','body','created_at']},
  drawings:{keys:['id'],columns:['id','name','name_key','revision','created_at','updated_at','node_count','edge_count','operation_count','object_key']},
  drawing_revisions:{keys:['drawing_id','revision'],columns:['drawing_id','revision','name','created_at','updated_at','node_count','edge_count','operation_count','object_key','request_id','request_hash']},
  drawing_snapshot_objects:{keys:['object_key'],columns:['object_key','byte_length','chunk_count','created_at']},
  drawing_snapshot_chunks:{keys:['object_key','chunk_index'],columns:['object_key','chunk_index','body']}
};

function stop(message) { throw new Error(message); }
const plain = value => value && typeof value==='object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const stable = value => JSON.stringify(sortValue(value));
function sortValue(value) {
  if(Array.isArray(value))return value.map(sortValue);
  if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortValue(value[key])]));
  return value;
}
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
const fields = (value,names) => Object.fromEntries(names.map(key=>[key,value[key]]));
const same = (a,b) => stable(a)===stable(b);
const nameKey = value => value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
function metadata(value) {
  if(!plain(value)||!UUID.test(value.id||'')||typeof value.name!=='string'||!value.name.trim()
      ||Array.from(value.name).length>80||!integer(value.revision)||value.revision<1
      ||!integer(value.createdAt)||!integer(value.updatedAt)||value.updatedAt<value.createdAt
      ||['nodeCount','edgeCount','operationCount'].some(key=>!integer(value[key])))stop('Invalid source drawing metadata; import stopped.');
  return fields(value,META);
}
function feedback(value) {
  if(!plain(value)||!UUID.test(value.id||'')||!['idea','bug','ui','other'].includes(value.category)
      ||!integer(value.createdAt)||['name','title','body'].some(key=>typeof value[key]!=='string')
      ||!value.title.trim()||Array.from(value.title).length>80||Array.from(value.body).length>3000)stop('Invalid source feedback; import stopped.');
  return fields(value,FEEDBACK);
}
function project(value,meta) {
  if(!plain(value)||!Array.isArray(value.nodes)||!Array.isArray(value.edges)
      ||value.nodes.length!==meta.nodeCount||value.edges.length!==meta.edgeCount
      ||(value.operations?.length||0)!==meta.operationCount
      ||Buffer.byteLength(stable(value),'utf8')>MAX_BYTES)stop('Invalid or oversized source snapshot; import stopped.');
  return value;
}
function unique(items,key,label) {
  const keys=new Set();for(const item of items){const id=key(item);if(keys.has(id))stop('Duplicate '+label+' in source; import stopped.');keys.add(id);}
  return items;
}
function ordered(items,key) { return [...items].sort((a,b)=>String(key(a)).localeCompare(String(key(b)))); }

async function readSource(fetcher,path) {
  let response;
  try{response=await fetcher(IMPORT_SOURCE+path,{headers:{Accept:'application/json','User-Agent':USER_AGENT,
    Origin:'https://oil-flow-studio.vercel.app'},signal:AbortSignal.timeout(45000)});}catch{stop('Unable to read existing shared service; no cutover was performed.');}
  if(!response.ok)stop('Existing shared service returned an error; import stopped.');
  try {
    const text=await response.text();if(Buffer.byteLength(text,'utf8')>MAX_BYTES+1024*1024)stop('Source response is too large.');
    return JSON.parse(text);
  }catch{stop('Existing shared service returned invalid data; import stopped.');}
}
async function collect(fetcher,path,limit) {
  const items=[],seen=new Set();let cursor=null;
  do {
    const page=await readSource(fetcher,path+'?limit='+limit+(cursor?'&cursor='+encodeURIComponent(cursor):''));
    if(!plain(page)||!Array.isArray(page.items)||!integer(page.total)||page.total<page.items.length
        ||(page.nextCursor!=null&&(typeof page.nextCursor!=='string'||page.nextCursor.length>200)))stop('Invalid source pagination; import stopped.');
    items.push(...page.items);cursor=page.nextCursor||null;
    if(cursor){if(seen.has(cursor)||seen.size>=10000)stop('Repeated source cursor; import stopped.');seen.add(cursor);}
    else if(items.length!==page.total)stop('Source changed during pagination; import stopped.');
  }while(cursor);
  return items;
}
const headList = items => ordered(unique(items.map(metadata),x=>x.id,'drawing'),x=>x.id);
const feedbackList = items => ordered(unique(items.map(feedback),x=>x.id,'feedback'),x=>x.id);

export async function exportSource(fetcher=fetch) {
  const heads=headList(await collect(fetcher,'/api/drawings',100));
  const comments=feedbackList(await collect(fetcher,'/api/feedback',200));
  const drawings=[];let totalBytes=0;
  for(const head of heads){
    const history=unique((await collect(fetcher,'/api/drawings/'+head.id+'/revisions',100)).map(metadata),x=>x.revision,'revision')
      .sort((a,b)=>a.revision-b.revision);
    if(history.length!==head.revision||history.some((v,i)=>v.id!==head.id||v.revision!==i+1))stop('Incomplete source history; import stopped.');
    const versions=[];
    for(const meta of history){
      const record=await readSource(fetcher,'/api/drawings/'+head.id+'/revisions/'+meta.revision);
      if(!same(metadata(record),meta))stop('Source history changed during export; retry after writes are paused.');
      const snapshot=project(record.project,meta);totalBytes+=Buffer.byteLength(stable(snapshot),'utf8');
      if(totalBytes>256*1024*1024)stop('Source exceeds the bounded one-time importer; use the private migration tools.');
      versions.push({...meta,project:snapshot});
    }
    const current=await readSource(fetcher,'/api/drawings/'+head.id),latest=versions.at(-1);
    if(!latest||!same(metadata(current),head)||!same(metadata(latest),head)||!same(project(current.project,head),latest.project))stop('Source drawing changed during export; retry after writes are paused.');
    drawings.push({...head,versions});
  }
  if(!same(heads,headList(await collect(fetcher,'/api/drawings',100)))
      ||!same(comments,feedbackList(await collect(fetcher,'/api/feedback',200))))stop('Source changed during export; retry after writes are paused.');
  const bundle={source:IMPORT_SOURCE,feedback:comments,drawings};
  return {...bundle,checksum:hash(bundle)};
}

function requestId(value) {
  const namespace=Buffer.from('6ba7b8119dad11d180b400c04fd430c8','hex');
  const b=createHash('sha1').update(namespace).update(value).digest().subarray(0,16);
  b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');
}
export function snapshotChunks(text) {
  const bytes=Buffer.from(text,'utf8'),parts=[];
  for(let start=0;start<bytes.length;){let end=Math.min(bytes.length,start+32768);
    if(end<bytes.length)while(end>start&&(bytes[end]&192)===128)end--;
    parts.push(bytes.subarray(start,end).toString('utf8'));start=end;
  }
  return parts.length?parts:[''];
}
export function buildImportRows(bundle) {
  const rows=Object.fromEntries(Object.keys(TABLES).map(table=>[table,[]]));
  for(const item of bundle.feedback)rows.feedback.push({id:item.id,name:item.name,title:item.title,category:item.category,body:item.body,created_at:item.createdAt});
  for(const drawing of bundle.drawings){
    const keys=[];
    for(const version of drawing.versions){
      const text=stable(version.project),key=`migration/cloudflare-ci/${drawing.id}/${version.revision}/${hash(version.project)}.json`;
      const chunks=snapshotChunks(text);keys.push(key);
      rows.drawing_snapshot_objects.push({object_key:key,byte_length:Buffer.byteLength(text,'utf8'),chunk_count:chunks.length,created_at:version.updatedAt});
      chunks.forEach((body,chunk_index)=>rows.drawing_snapshot_chunks.push({object_key:key,chunk_index,body}));
      rows.drawing_revisions.push({drawing_id:drawing.id,revision:version.revision,name:version.name,created_at:version.createdAt,updated_at:version.updatedAt,
        node_count:version.nodeCount,edge_count:version.edgeCount,operation_count:version.operationCount,object_key:key,
        request_id:requestId(IMPORT_SOURCE+'/api/drawings/'+drawing.id+'/revisions/'+version.revision),request_hash:hash({source:IMPORT_SOURCE,version})});
    }
    rows.drawings.push({id:drawing.id,name:drawing.name,name_key:nameKey(drawing.name),revision:drawing.revision,created_at:drawing.createdAt,updated_at:drawing.updatedAt,
      node_count:drawing.nodeCount,edge_count:drawing.edgeCount,operation_count:drawing.operationCount,object_key:keys.at(-1)});
  }
  return rows;
}
export function sqlValue(value) {
  if(value===null)return 'NULL';
  if(typeof value==='string')return "CAST(X'"+Buffer.from(value,'utf8').toString('hex')+"' AS TEXT)";
  if(Number.isSafeInteger(value))return String(value);
  stop('Invalid SQL value; import stopped.');
}
function insert(table,row) {
  const columns=TABLES[table].columns;
  const statement=`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(key=>sqlValue(row[key])).join(',')});`;
  if(Buffer.byteLength(statement,'utf8')>=100000)stop('Import statement exceeds D1 limits; import stopped.');
  return statement;
}
const rowKey = (table,row) => stable(TABLES[table].keys.map(key=>row[key]));

async function readTarget(sql) {
  const result={};
  for(const [table,{columns}] of Object.entries(TABLES)){
    result[table]=await sql('SELECT '+columns.join(',')+' FROM '+table+';');
    if(!Array.isArray(result[table]))stop('Invalid target database response; import stopped.');
  }
  return result;
}
function compareTarget(actual,desired,{complete=false}={}) {
  const missing={};
  for(const table of Object.keys(TABLES)){
    const want=new Map(desired[table].map(row=>[rowKey(table,row),row]));
    const seen=new Set();
    for(const row of actual[table]){
      const key=rowKey(table,row),expected=want.get(key);
      if(!expected||seen.has(key)||!same(fields(row,TABLES[table].columns),expected))stop('Target contains unknown or different data; import stopped without overwriting it.');
      seen.add(key);
    }
    missing[table]=desired[table].filter(row=>!seen.has(rowKey(table,row)));
    if(complete&&missing[table].length)stop('Target verification found incomplete imported data; import stopped.');
  }
  return missing;
}
async function state(sql) {
  const rows=await sql('SELECT * FROM cloud_import_state WHERE migration_id='+sqlValue(MIGRATION)+';');
  if(!Array.isArray(rows)||rows.length>1)stop('Invalid import marker; import stopped.');
  return rows[0]||null;
}

export async function runImport({sql,fetcher=fetch,now=()=>Date.now()}={}) {
  if(typeof sql!=='function')stop('An authenticated database executor is required.');
  let marker=await state(sql);
  if(marker&&marker.source_origin!==IMPORT_SOURCE)stop('Target belongs to another import; import stopped.');
  if(marker&&(!/^[0-9a-f]{64}$/.test(marker.source_checksum)||!['feedback_count','drawing_count','revision_count'].every(key=>integer(marker[key]))))stop('Invalid import marker; preserve the target and inspect before continuing.');
  if(marker?.status==='completed')return {status:'already-imported',feedback:marker.feedback_count,drawings:marker.drawing_count,revisions:marker.revision_count};
  if(!marker&&Object.values(await readTarget(sql)).some(rows=>rows.length))stop('Target is not empty; import stopped without changing existing data.');
  const bundle=await exportSource(fetcher),desired=buildImportRows(bundle);
  const counts={feedback:bundle.feedback.length,drawings:bundle.drawings.length,revisions:desired.drawing_revisions.length};
  if(marker&&(marker.status!=='importing'||marker.source_checksum!==bundle.checksum))stop('Source differs from an interrupted import; preserve both copies and inspect before continuing.');
  if(!marker){
    if(Object.values(await readTarget(sql)).some(rows=>rows.length))stop('Target changed during export; import stopped.');
    const conditions=Object.keys(TABLES).map(table=>'NOT EXISTS (SELECT 1 FROM '+table+')').join(' AND ');
    await sql('INSERT INTO cloud_import_state (migration_id,source_origin,source_checksum,status,feedback_count,drawing_count,revision_count,started_at,completed_at) SELECT '
      +[MIGRATION,IMPORT_SOURCE,bundle.checksum,'importing',counts.feedback,counts.drawings,counts.revisions,now(),null].map(sqlValue).join(',')+' WHERE '+conditions+';');
    marker=await state(sql);
    if(!marker||marker.source_checksum!==bundle.checksum||marker.status!=='importing')stop('Unable to establish import ownership; import stopped.');
  }
  const missing=compareTarget(await readTarget(sql),desired);
  // Preserve FK ordering. Headers/chunks precede public drawings and history.
  const order=['feedback','drawing_snapshot_objects','drawing_snapshot_chunks','drawings','drawing_revisions'];
  const statements=order.flatMap(table=>missing[table].map(row=>insert(table,row)));
  if(statements.length)await sql(statements.join('\n'));
  compareTarget(await readTarget(sql),desired,{complete:true});
  await sql('UPDATE cloud_import_state SET status=\'completed\',completed_at='+sqlValue(now())
    +' WHERE migration_id='+sqlValue(MIGRATION)+' AND source_checksum='+sqlValue(bundle.checksum)+' AND status=\'importing\';');
  marker=await state(sql);
  if(marker?.status!=='completed'||marker.source_checksum!==bundle.checksum)stop('Import completion could not be confirmed; keep the existing service active.');
  return {status:'imported',...counts,checksum:bundle.checksum};
}

export function createWranglerExecutor({execute=promisify(execFile),directory=dirname(fileURLToPath(import.meta.url))}={}) {
  return async text=>{
    const temporary=await mkdtemp(join(tmpdir(),'oil-cloud-import-'));
    try{
      await chmod(temporary,0o700);const file=join(temporary,'query.sql');
      // D1 --file uses the atomic import API and returns only an import summary,
      // even for SELECTs. Read-only statements contain fixed table/column names
      // and our constant marker ID, so --command can safely return their rows.
      // Actual imported names, comments, snapshots and SQL always use a private file.
      const readOnly=/^SELECT\b/.test(text.trim());
      if(!readOnly)await writeFile(file,text,{mode:0o600});
      const input=readOnly?['--command',text]:['--file',file];
      let stdout;
      try{({stdout}=await execute(process.platform==='win32'?'npx.cmd':'npx',['--yes','wrangler@4','d1','execute','DB','--remote','--json','--config',join(directory,'wrangler.jsonc'),...input],
        {cwd:directory,encoding:'utf8',maxBuffer:64*1024*1024,env:process.env}));}
      catch{stop('Cloudflare database operation failed. Private SQL and data are withheld; keep the existing service active and inspect the target before retrying.');}
      let responses;try{responses=JSON.parse(stdout);}catch{stop('Cloudflare returned an invalid database response; import stopped.');}
      if(!Array.isArray(responses)||responses.some(r=>r.success===false||!Array.isArray(r.results)))stop('Cloudflare database operation was not confirmed; import stopped.');
      return responses.flatMap(r=>r.results);
    }finally{await rm(temporary,{recursive:true,force:true});}
  };
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  runImport({sql:createWranglerExecutor()}).then(result=>console.log(JSON.stringify(result)))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}

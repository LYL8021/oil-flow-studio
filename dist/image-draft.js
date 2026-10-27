/* Local OCR creates a reviewable placement draft, never inferred hydraulic links. */
let ocrLibraryPromise;
const MAX_FILE_BYTES=15*1024*1024;
const MAX_REFERENCE_CHARS=2*1024*1024;
const REVIEW_NOTE='依編號推測，請確認符號與位置';
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function abortError(){
 const error=new Error('已取消圖片辨識');error.name='AbortError';return error;
}
function checkAbort(signal){if(signal?.aborted)throw abortError();}
function progressHandler(callback){
 let last=0;
 return (progress,message,status='')=>{last=Math.max(last,clamp(Number(progress)||0,0,1));try{callback?.({progress:last,message,status});}catch{}};
}
function abortable(promise,signal){
 if(!signal)return promise;
 return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(abortError());return;}
  const abort=()=>{cleanup();reject(abortError());};
  const cleanup=()=>signal.removeEventListener('abort',abort);
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
 });
}

/** Load only a local PNG/JPEG/WebP and return a serializable reference plus its canvas. */
export async function readImage(file,{onProgress,signal}={}){
 checkAbort(signal);
 if(!file||typeof file.size!=='number'||typeof file.arrayBuffer!=='function')throw new Error('請選擇 PNG、JPG 或 WebP 圖片');
 const mime=String(file.type||'').toLowerCase();
 if(!/^image\/(png|jpeg|webp)$/.test(mime)&&!(mime===''&&/\.(png|jpe?g|webp)$/i.test(file.name||'')))throw new Error('僅支援 PNG、JPG 或 WebP 圖片');
 if(file.size>MAX_FILE_BYTES)throw new Error('圖片超過 15 MB，請先縮小後再匯入');
 if(!file.size)throw new Error('圖片檔案是空的');
 if(typeof document==='undefined')throw new Error('圖片功能需要在瀏覽器中開啟');
 const report=progressHandler(onProgress);report(.02,'讀取圖片…','reading image');
 let bitmap,url;
 try{
  if(typeof createImageBitmap==='function'){
   const decoding=createImageBitmap(file);Promise.resolve(decoding).then(decoded=>{if(signal?.aborted)decoded.close?.();}).catch(()=>{});bitmap=await abortable(decoding,signal);
  }else{
   url=URL.createObjectURL(file);
   bitmap=await abortable(new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('無法讀取圖片，請換一張 PNG、JPG 或 WebP'));img.src=url;}),signal);
  }
  checkAbort(signal);
  const width=bitmap.width||bitmap.naturalWidth,height=bitmap.height||bitmap.naturalHeight;
  if(!width||!height||width*height>100000000)throw new Error('圖片尺寸過大或無法讀取，請先縮小後再匯入');
  const scale=Math.min(1,2000/width,1600/height,Math.sqrt(3000000/(width*height)));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('目前瀏覽器無法建立圖片畫布');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  checkAbort(signal);report(.09,'整理底圖與辨識尺寸…','preparing image');
  let dataUrl=canvas.toDataURL('image/webp',.82);
  if(dataUrl.length>MAX_REFERENCE_CHARS)dataUrl=canvas.toDataURL('image/webp',.60);
  if(dataUrl.length>MAX_REFERENCE_CHARS)dataUrl=canvas.toDataURL('image/jpeg',.58);
  return {reference:{dataUrl,width:canvas.width,height:canvas.height,visible:true,opacity:.22},imageWidth:canvas.width,imageHeight:canvas.height,canvas};
 }catch(error){
  if(error?.name==='AbortError')throw error;
  if(error instanceof Error&&error.message&&/[\u3400-\u9fff]/.test(error.message))throw error;
  throw new Error('無法讀取這張圖片，請改用 PNG、JPG 或 WebP');
 }finally{bitmap?.close?.();if(url)URL.revokeObjectURL(url);}
}

function normalizeText(value){
 return String(value||'').normalize('NFKC').toUpperCase().replace(/[‐‑‒–—―−_]/g,'-').replace(/[\s\[\](){}:;,.·|\/\\]+/g,'').replace(/^["'`]+|["'`]+$/g,'');
}
function parseCode(text){
 let value=normalizeText(text);if(value.length>30)return null;
 // A trailing OCR I/L/O is corrected only after an explicit equipment prefix.
 value=value.replace(/^(RN-?(?:FIL|FLT|FM|FI|TK|DB|DF|BF|[DVFCGPXTE])-?)([0-9OIL]+)$/,(all,prefix,number)=>prefix+number.replace(/O/g,'0').replace(/[IL]/g,'1'));
 let match=value.match(/^RN-?(FIL|FLT|FM|FI|TK|DB|DF|BF|[DVFCGPXTE])-?(\d{1,3}[A-Z]?)$/);
 if(match)return {code:`RN-${match[1]}${match[2]}`,prefix:match[1],rn:true};
 match=value.match(/^(FIL|FLT|FM|FI|TK|DB|DF|BF|[DVFCGPXTE])-?(\d{1,3}[A-Z]?)$/);
 if(match)return {code:`${match[1]}-${match[2]}`,prefix:match[1],rn:false};
 return null;
}
function guessType(tag){
 if(tag.prefix==='TK')return 'tank';
 if(tag.prefix==='FM'||tag.prefix==='FI')return 'flowmeter';
 if(tag.prefix==='FIL'||tag.prefix==='FLT'||(!tag.rn&&tag.prefix==='F'))return 'filter';
 if(tag.prefix==='BF')return 'cap';
 if(tag.prefix==='P')return 'pipe';
 if(tag.prefix==='X')return 'cross';
 if(tag.prefix==='T')return 'junction';
 if(tag.prefix==='E')return 'elbow';
 return 'valve';
}
function ocrWords(data){
 const source=data?.data||data||{};
 if(Array.isArray(source.words)&&source.words.length)return source.words;
 const words=[];
 const readLine=line=>{if(Array.isArray(line?.words))words.push(...line.words);else if(line?.text&&line?.bbox)words.push(line);};
 for(const line of source.lines||[])readLine(line);
 if(!words.length)for(const block of source.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[])readLine(line);
 return words;
}
function wordBox(word,width,height){
 const box=word?.bbox||word?.box;if(!box)return null;
 const x0=Number(box.x0??box.left),y0=Number(box.y0??box.top),x1=Number(box.x1??(x0+Number(box.width))),y1=Number(box.y1??(y0+Number(box.height)));
 if(![x0,y0,x1,y1].every(Number.isFinite)||x1<=x0||y1<=y0)return null;
 const clipped={x0:clamp(x0,0,width),y0:clamp(y0,0,height),x1:clamp(x1,0,width),y1:clamp(y1,0,height)};return clipped.x1>clipped.x0&&clipped.y1>clipped.y0?clipped:null;
}
function unionBox(a,b){return {x0:Math.min(a.x0,b.x0),y0:Math.min(a.y0,b.y0),x1:Math.max(a.x1,b.x1),y1:Math.max(a.y1,b.y1)};}

// Optional conservative alignment: require both bow-tie diagonals and end plates.
function nearbyValve(box,image){
 if(!image?.data||!image.width||!image.height)return null;
 const {data,width,height}=image;
 const dark=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=width||y>=height)return false;const i=(y*width+x)*4;return (data[i]+data[i+1]+data[i+2])<330;};
 const near=(x,y)=>dark(x,y)||dark(x-1,y)||dark(x+1,y)||dark(x,y-1)||dark(x,y+1);
 const labelHeight=box.y1-box.y0,cx=(box.x0+box.x1)/2,cy=(box.y0+box.y1)/2;
 const half=clamp(labelHeight,10,22),sizes=[.8,1,1.25].map(scale=>({w:half*scale,h:half*.65*scale}));
 const ranges=[{x0:cx-45,x1:cx+45,y0:box.y0-85,y1:box.y0-9},{x0:box.x0-85,x1:box.x0-12,y0:cy-27,y1:cy+27}];
 let best=null;
 for(const range of ranges)for(let y=Math.max(4,range.y0);y<Math.min(height-4,range.y1);y+=3)for(let x=Math.max(4,range.x0);x<Math.min(width-4,range.x1);x+=3){
  if(!near(x,y))continue;
  for(const size of sizes){
   let diagonals=0,plates=0;
   for(const side of [-1,1])for(const vertical of [-1,1])for(const step of [.35,.65,1])if(near(x+side*size.w*step,y+vertical*size.h*step))diagonals++;
   if(diagonals<9)continue;
   for(const side of [-1,1])for(const vertical of [-.45,.45])if(near(x+side*size.w,y+vertical*size.h))plates++;
   if(plates<3)continue;
   const score=diagonals+plates-Math.hypot(x-cx,y-(box.y0-30))*.025;
   if(!best||score>best.score)best={x,y,score};
  }
 }
 return best&&{x:Math.round(best.x),y:Math.round(best.y)};
}

/** Pure postprocessing for tests and review: tags suggest components, never pipes. */
export function draftFromOcr(data,width,height,imageData){
 const w=Number.isFinite(width)&&width>0?Math.min(10000,Math.round(width)):1200,h=Number.isFinite(height)&&height>0?Math.min(10000,Math.round(height)):800;
 const words=ocrWords(data).slice(0,12000).map(word=>({text:String(word.text||''),confidence:word.confidence==null?75:clamp(Number(word.confidence)||0,0,100),box:wordBox(word,w,h)})).filter(word=>word.box&&word.text.trim()&&word.confidence>=15);
 const lines=[];
 for(const word of words.sort((a,b)=>(a.box.y0+a.box.y1-b.box.y0-b.box.y1)||a.box.x0-b.box.x0)){
  const cy=(word.box.y0+word.box.y1)/2,height=word.box.y1-word.box.y0;
  let line=lines.find(line=>Math.abs(line.cy-cy)<=Math.max(height,line.height)*.5);
  if(!line){line={cy,height,words:[]};lines.push(line);}line.words.push(word);
 }
 const tags=new Map();let duplicates=0;
 for(const line of lines){
  line.words.sort((a,b)=>a.box.x0-b.box.x0);const candidates=[];
  for(let start=0;start<line.words.length;start++){
   let text='',box=null,confidence=100;
   for(let end=start;end<Math.min(start+6,line.words.length);end++){
    const word=line.words[end];if(end>start&&word.box.x0-line.words[end-1].box.x1>Math.max(18,line.height*1.7))break;
    text+=word.text;box=box?unionBox(box,word.box):word.box;confidence=Math.min(confidence,word.confidence);
    const tag=parseCode(text);if(tag)candidates.push({...tag,box:{...box},confidence,start,end});
   }
  }
  // Prefer the complete RN tag over its overlapping D1/DF1 word fragments.
  const occupied=new Set();
  candidates.sort((a,b)=>Number(b.rn)-Number(a.rn)||(b.end-b.start)-(a.end-a.start)||b.code.length-a.code.length||b.confidence-a.confidence);
  for(const candidate of candidates){
   let overlaps=false;for(let i=candidate.start;i<=candidate.end;i++)if(occupied.has(i)){overlaps=true;break;}
   if(overlaps)continue;for(let i=candidate.start;i<=candidate.end;i++)occupied.add(i);
   const existing=tags.get(candidate.code);
   if(existing){if(Math.abs(existing.box.x0-candidate.box.x0)>4||Math.abs(existing.box.y0-candidate.box.y0)>4)duplicates++;if(existing.confidence>=candidate.confidence)continue;}
   tags.set(candidate.code,candidate);
  }
 }
 const ordered=[...tags.values()].sort((a,b)=>a.box.y0-b.box.y0||a.box.x0-b.box.x0).slice(0,400);
 const nodes=ordered.map((tag,index)=>{
  const type=guessType(tag),aligned=type==='valve'&&index<80?nearbyValve(tag.box,imageData):null;
  const position=aligned||{x:Math.round((tag.box.x0+tag.box.x1)/2),y:Math.round(tag.box.y0-30)};
  return {id:`img-${String(index+1).padStart(3,'0')}`,type,x:clamp(position.x,0,w),y:clamp(position.y,0,h),rotation:0,name:tag.code,code:tag.code.slice(0,24),review:true,note:REVIEW_NOTE,ocrConfidence:Math.round(tag.confidence),...(type==='valve'?{open:true}:{}),...(type==='tank'?{enabled:false,fuel:'fuel'}:{}),...(type==='pipe'?{length:160,kind:'normal'}:{})};
 });
 const reviewNotes=nodes.length?['種類與位置是依設備編號推測，請逐一確認。','尚未建立任何油管連線，請依底圖手動接管。']:['可保留底圖，手動放置元件並描繪管線。'];
 if(ordered.some(tag=>tag.rn&&tag.prefix==='F'))reviewNotes.push('RN-F 編號可能有多種含義，目前暫列閥門，請確認實際符號。');
 if(ordered.some(tag=>tag.confidence<55))reviewNotes.push('部分編號辨識信心偏低，請對照底圖修正文字。');
 if(nodes.some(node=>node.type==='tank'))reviewNotes.push('辨識出的油槽已暫停供油，確認油品與連線後再開啟。');
 if(duplicates)reviewNotes.push('相同編號出現在多處時僅保留一個元件，請檢查是否遺漏。');
 if(tags.size>400)reviewNotes.push('辨識超過 400 個編號，初稿僅保留前 400 個。');
 return {nodes,edges:[],draftInfo:{title:nodes.length?`已建立 ${nodes.length} 個待確認元件`:'底圖已載入',notice:nodes.length?'已依圖片編號建立可編輯初稿；元件種類、位置與管路都需要人工確認。':'未找到可定位的設備編號，已保留底圖供手動描圖。',reviewNotes},imageWidth:w,imageHeight:h};
}

function assetFolder(){
 const configured=globalThis.OIL_OCR_BASE;
 return configured?new URL(String(configured).replace(/\/?$/,'/'),globalThis.location?.href||import.meta.url):new URL('./vendor/ocr/',import.meta.url);
}
async function loadOcr(){
 if(globalThis.Tesseract?.createWorker)return globalThis.Tesseract;
 if(!ocrLibraryPromise){
  ocrLibraryPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('tesseract.min.js',assetFolder()).href;script.async=true;script.onload=()=>globalThis.Tesseract?.createWorker?resolve(globalThis.Tesseract):reject(new Error('文字辨識引擎未正確載入'));script.onerror=()=>{script.remove();reject(new Error('無法載入本機文字辨識引擎，可先使用「只載入底圖」手動描圖'));};document.head.append(script);}).catch(error=>{ocrLibraryPromise=null;throw error;});
 }
 return ocrLibraryPromise;
}
function preprocess(canvas){
 const processed=document.createElement('canvas');processed.width=canvas.width;processed.height=canvas.height;
 const context=processed.getContext('2d',{willReadFrequently:true});context.drawImage(canvas,0,0);
 const image=context.getImageData(0,0,processed.width,processed.height),pixels=image.data;
 let borderDark=0,borderCount=0;
 const sample=(x,y)=>{const i=(y*image.width+x)*4;if((pixels[i]*.299+pixels[i+1]*.587+pixels[i+2]*.114)<95)borderDark++;borderCount++;};
 for(let step=0;step<40;step++){const x=Math.floor(step*(image.width-1)/39),y=Math.floor(step*(image.height-1)/39);sample(x,0);sample(x,image.height-1);sample(0,y);sample(image.width-1,y);}
 const invert=borderDark/borderCount>.65;
 for(let i=0;i<pixels.length;i+=4){let value=pixels[i]*.299+pixels[i+1]*.587+pixels[i+2]*.114;if(invert)value=255-value;value=value<145?0:255;pixels[i]=pixels[i+1]=pixels[i+2]=value;pixels[i+3]=255;}
 context.putImageData(image,0,0);return {canvas:processed,imageData:image};
}

/** OCR and image content stay in this browser; only same-site engine assets load. */
export async function analyzeImage(file,{onProgress,signal}={}){
 const report=progressHandler(onProgress);checkAbort(signal);
 if(globalThis.location?.protocol==='file:')throw new Error('離線單檔版無法載入辨識引擎，請使用線上版辨識，或選「只載入底圖」手動描圖');
 const image=await readImage(file,{onProgress:event=>report(event.progress,event.message,event.status),signal});
 report(.12,'整理文字對比，保留原始底圖…','preprocessing image');
 const input=preprocess(image.canvas);checkAbort(signal);
 report(.16,'載入瀏覽器文字辨識引擎…','loading engine');
 const library=await abortable(loadOcr(),signal);checkAbort(signal);
 let worker,finished=false,termination;
 const terminate=()=>{if(!worker)return Promise.resolve();if(!termination)termination=Promise.resolve(worker.terminate()).catch(()=>{});return termination;};
 const abort=()=>{void terminate();};signal?.addEventListener('abort',abort,{once:true});
 try{
  const folder=assetFolder();
  const logger=event=>{
   const status=event?.status||'',value=Number(event?.progress)||0;
   if(status==='recognizing text')report(.48+value*.45,'辨識設備編號…',status);
   else if(status==='loading language traineddata')report(.30+value*.13,'載入編號文字資料…',status);
   else if(status==='initializing api')report(.44+value*.03,'準備辨識設備編號…',status);
   else if(status==='initializing tesseract')report(.25+value*.04,'初始化文字辨識…',status);
   else report(.18+value*.05,'載入文字辨識核心…',status);
  };
  const creation=library.createWorker('eng',1,{workerPath:new URL('worker.min.js',folder).href,corePath:folder.href,langPath:folder.href.replace(/\/$/,''),gzip:true,workerBlobURL:false,logger});
  Promise.resolve(creation).then(created=>{worker=created;if(finished||signal?.aborted)void terminate();}).catch(()=>{});
  worker=await abortable(creation,signal);checkAbort(signal);
  await abortable(worker.setParameters({tessedit_pageseg_mode:'11',preserve_interword_spaces:'1'}),signal);
  const result=await abortable(worker.recognize(input.canvas,{}, {text:true,blocks:true}),signal);checkAbort(signal);
  report(.95,'建立待確認元件，保留圖片作為底圖…','creating draft');
  const draft=draftFromOcr(result.data,image.imageWidth,image.imageHeight,input.imageData);checkAbort(signal);
  report(1,draft.nodes.length?`已建立 ${draft.nodes.length} 個待確認元件`:'未找到設備編號，可保留底圖手動描圖','complete');
  return {...draft,reference:image.reference};
 }catch(error){
  if(error?.name==='AbortError'||signal?.aborted)throw abortError();
  throw new Error('圖片辨識未完成，可改用「只載入底圖」手動描圖；請確認線上版的辨識引擎已載入',{cause:error});
 }finally{finished=true;signal?.removeEventListener('abort',abort);await terminate();}
}

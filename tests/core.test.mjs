import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import sharp from 'sharp';
import {Store} from '../server/store.mjs';
import {Assets} from '../server/assets.mjs';
import {Auth,memoryVault} from '../server/auth.mjs';
import {Jobs} from '../server/jobs.mjs';
import {consumeResponseStream} from '../server/ai.mjs';
import {Naver,postIdentity,editorMatches} from '../server/naver.mjs';
import {newProject,keywordReport,draftWarnings,photoGroups,validateNaverUrl} from '../shared/domain.mjs';
const {BrowserBridge,snapshotClipboard}=createRequire(import.meta.url)('../desktop/browser.cjs');

async function context(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemonhouse-test-'));const store=new Store(dir);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});return {store,dir};}
function stream(events){const bytes=new TextEncoder().encode(events.map(e=>`event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join(''));return new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=13)c.enqueue(bytes.slice(i,i+13));c.close();}});}
function multipart(data,name='photo.jpg'){const boundary='test-lemon';const req=Readable.from([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),data,Buffer.from(`\r\n--${boundary}--\r\n`)]);req.headers={'content-type':`multipart/form-data; boundary=${boundary}`};return req;}
function pdfFixture(){
  const content='BT /F1 16 Tf 40 720 Td (Living room: white wall finish and oak cabinet. Kitchen: recessed ceiling light.) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 7 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,'<< /Length 28 >>\nstream\n0.9 0.8 0.5 rg 0 0 600 800 re f\nendstream'];
  let text='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(text);
}

test('본문 키워드는 제목·태그를 제외하고 포함 관계 충돌을 표시한다',()=>{
  const p={...newProject(),title:'해운대 인테리어',tags:['해운대'],blocks:[{kind:'heading',text:'해운대 인테리어'},{kind:'text',text:'해운대 인테리어\n해운대'}],keywords:[{term:'해운대',min:1,max:2},{term:'해운대 인테리어',min:3,max:4}]};
  const report=keywordReport(p);assert.equal(report[0].count,3);assert.equal(report[1].count,2);assert.equal(report[0].collision,true);
});
test('게시글 번호는 담당 블로그 주소에서만 확인하고 누락된 본문·사진 배치를 거부한다',()=>{
  assert.equal(postIdentity('https://blog.naver.com/PostList.naver?logNo=123&blogId=assigned','assigned'),'123');
  assert.equal(postIdentity('https://blog.naver.com/other/123','assigned'),'');
  assert.equal(postIdentity('https://evil.test/assigned/123','assigned'),'');
  const p={title:'원고',blocks:[{kind:'text',text:'지금 같이 살펴보실까요?'},{kind:'photos',assetIds:['a','b']}]};
  assert(editorMatches(p,{title:'원고',text:'지금 같이 살펴보실까요?',photoBlocks:[2]}));
  assert(!editorMatches(p,{title:'원고',text:'지금 같이 ',photoBlocks:[2]}));
  assert(!editorMatches(p,{title:'원고',text:'지금 같이 살펴보실까요?',photoBlocks:[1,1]}));
  assert(editorMatches({...p,blocks:[{kind:'text',text:'첫 문단\n\n둘째 문단'},{kind:'photos',assetIds:['a','b']}]},{title:'원고',text:'첫 문단\n\u200B\n둘째 문단',photoBlocks:[2]}));
});
test('예약 결과는 목록의 유일한 제목·시각과 실제 본문·사진·공개 범위를 함께 검증한다',async t=>{
  const {store}=await context(t);const p={title:'예약 원고',scheduleAt:'2026-10-06T05:00:00.000Z',visibility:'private',blocks:[{kind:'text',text:'확인할 본문'},{kind:'photos',assetIds:['a','b']}],tags:['인테리어']};
  const state={body:'확인할 본문',copies:1,private:true,date:'2026. 10. 06',finalClicks:0};
  const labels=['예약','비공개','전체공개'].map(text=>({textContent:text,get control(){return {checked:text==='예약'||(text==='비공개'?state.private:!state.private)};}}));
  const document={querySelectorAll:selector=>selector.includes('article_button')?Array.from({length:state.copies},()=>({innerText:'예약 원고\n2026.10.06 14:00'})):selector==='label'?labels:selector==='input'?[{get value(){return state.date;}}]:selector==='select'?['시간','분'].map((kind,i)=>({getBoundingClientRect:()=>({width:100}),getAttribute:()=>`예약 발행 ${kind} 선택`,selectedOptions:[{textContent:i?'00':'14'}]})):selector.includes('se-title-text')?[{textContent:p.title}]:selector.includes('se-component.se-text')?[{get innerText(){return state.body;}}]:selector.includes('se-component.se-image')?[{querySelectorAll:()=>[{},{}]}]:[],querySelector:()=>({parentElement:{parentElement:{innerText:'#인테리어'}}})};
  const bridge={exclusive:fn=>fn(),goto:async()=>{},waitFor:async()=>{},status:async()=>({connected:true,canWrite:true}),click:async selector=>{if(selector.includes('confirm_btn'))state.finalClicks++;},evaluate:async(fn,arg)=>vm.runInNewContext(`(${fn.toString()})(argument)`,{document,argument:arg,location:{href:'https://blog.naver.com/assigned/postwrite'}})};
  const naver=new Naver(store,{},bridge);assert.equal((await naver.confirmSchedule(p,'assigned')).verification,'naver-reservation-list-and-editor');assert.equal(state.finalClicks,0);
  state.copies=2;await assert.rejects(naver.confirmSchedule(p,'assigned'),/하나로/);state.copies=1;
  state.private=false;await assert.rejects(naver.confirmSchedule(p,'assigned'),/공개 범위/);state.private=true;
  state.date='2026. 10. 07';await assert.rejects(naver.confirmSchedule(p,'assigned'),/시각/);assert.equal(state.finalClicks,0);
});
test('예약 결과 재확인은 기존 요청만 완료로 기록하고 재발행하지 않는다',async t=>{
  const {store}=await context(t),p=store.createProject();const next=store.updateProject(p.id,{title:'예약 확인',scheduleAt:'2026-10-06T05:00:00.000Z',blocks:[{kind:'text',text:'본문'}]});store.put('settings','main',{...store.get('settings','main'),blogId:'assigned'});
  const naver=new Naver(store,{}, {exclusive:fn=>fn()});const key=naver.fingerprint(next,[],'assigned');store.put('publish',key,{fingerprint:key,projectId:p.id,status:'uncertain',postId:'123'});
  naver.publish=()=>{throw new Error('재제출하면 안 됨');};naver.confirmSchedule=async()=>({verification:'naver-reservation-list-and-editor'});
  const result=await naver.verifyPublish(p.id);assert.equal(result.verified,true);assert.equal(result.url,'https://blog.naver.com/assigned/123');assert.equal(store.get('project',p.id).draftStatus,'scheduled');
});
test('예약 시각 이후에도 목록에 남거나 본문·사진·공개 범위가 다르면 실제 발행으로 표시하지 않는다',async t=>{
  const {store}=await context(t),p=store.createProject();const project=store.updateProject(p.id,{title:'예약 발행 확인',visibility:'private',draftStatus:'scheduled',scheduleAt:'2020-01-01T00:00:00.000Z',blocks:[{kind:'text',text:'확인할 본문'},{kind:'photos',assetIds:['a']},{kind:'photos',assetIds:['b','c']}]});store.put('settings','main',{...store.get('settings','main'),blogId:'assigned'});
  const state={reserved:true,text:'확인할 본문',private:true,groups:[1,2],finalClicks:0};
  const root={querySelector:()=>({innerText:project.title}),get innerText(){return state.text;},querySelectorAll:()=>state.groups.map(count=>({parentElement:{closest:()=>null},querySelectorAll:()=>Array.from({length:count},()=>({}))}))};
  const document={querySelector:selector=>selector.includes('reserve_btn')?{textContent:'예약 발행 1건'}:selector==='.se-main-container'?root:selector==='.se-title-text'?{innerText:project.title}:selector==='.se_publishDate'?{parentElement:{get innerText(){return state.private?'작성자 · 2020.1.1.9:00 · 비공개':'작성자 · 2020.1.1.9:00';}},textContent:'2020.1.1.9:00',getAttribute:()=>''}:null,querySelectorAll:()=>[{get innerText(){return state.reserved?project.title:'다른 예약 글';}}]};
  const bridge={exclusive:fn=>fn(),goto:async()=>{},waitFor:async()=>{},click:async selector=>{if(selector.includes('confirm_btn'))state.finalClicks++;},evaluate:async(fn,arg)=>vm.runInNewContext(`(${fn.toString()})(argument)`,{document,argument:arg})};
  const naver=new Naver(store,{},bridge),key=naver.fingerprint(project,[],'assigned');store.put('publish',key,{fingerprint:key,projectId:p.id,status:'completed',scheduled:true,postId:'123'});
  await assert.rejects(naver.verifyPublish(p.id),/아직 네이버 예약 목록/);state.reserved=false;state.text='누락';await assert.rejects(naver.verifyPublish(p.id),/제목·본문·사진/);state.text='확인할 본문';state.groups=[3];await assert.rejects(naver.verifyPublish(p.id),/제목·본문·사진/);state.groups=[1,2];state.private=false;await assert.rejects(naver.verifyPublish(p.id),/공개 범위/);state.private=true;
  assert.equal(store.get('project',p.id).draftStatus,'scheduled');const result=await naver.verifyPublish(p.id);assert.equal(result.deliveryVerified,true);assert.equal(store.get('project',p.id).draftStatus,'published');assert.equal(state.finalClicks,0);
});
test('서로 다른 공간을 같은 그룹으로 지정해도 합치지 않고 배치 변경을 감지한다',()=>{
  const p={...newProject(),original:{name:'A'},target:{name:'B'},title:'추천',blocks:[{kind:'text',text:'본문'},{kind:'photos',assetIds:['a','b']}],keywords:[],facts:[]};
  const assets=[{id:'a',role:'photo',space:'거실',group:'one',order:0,status:'ready'},{id:'b',role:'photo',space:'주방',group:'one',order:1,status:'ready'}];
  assert.equal(photoGroups(assets).length,2);assert(draftWarnings(p,assets).some(w=>w.includes('사진 순서와 묶음')));
});
test('허용된 네이버 주소만 받아 외부 요청과 위장 주소를 거부한다',()=>{
  assert.equal(validateNaverUrl('https://blog.naver.com/lemonhouse8/224391021069','blog'),'https://blog.naver.com/lemonhouse8/224391021069');
  for(const url of ['https://blog.naver.com.evil.test/a','http://blog.naver.com/a','https://x:y@blog.naver.com/a','https://localhost:4317'])assert.throws(()=>validateNaverUrl(url));
});
test('스트림 완료 이후에만 생성 결과를 반환하고 끊긴 응답과 한도 실패를 구분한다',async()=>{
  const events=[{type:'response.output_text.delta',delta:'{"문장":"테스트"}'},{type:'response.completed',response:{usage:{input_tokens:10}}}];
  const result=await consumeResponseStream(stream(events));assert.equal(result.text,'{"문장":"테스트"}');assert.equal(result.usage.input_tokens,10);
  await assert.rejects(consumeResponseStream(stream(events.slice(0,1))),/완료 전에 끊겼/);
  await assert.rejects(consumeResponseStream(stream([events[0],{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}])),e=>e.status===429);
  await assert.rejects(consumeResponseStream(stream([{type:'response.incomplete'}])),/끝까지 생성되지/);
});
test('공식 OAuth는 계정별 PKCE·state·nonce와 직접 요금제 사용 권한을 요청한다',async t=>{
  const {store}=await context(t),auth=new Auth(store,memoryVault());const first=new URL(auth.begin('http://127.0.0.1:4317'));
  assert.equal(first.origin,'https://auth.openai.com');assert.equal(first.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(first.searchParams.get('code_challenge_method'),'S256');assert(first.searchParams.get('scope').includes('chatgpt.tokens.use.direct'));assert.equal(first.searchParams.get('resource'),'https://api.openai.com/v1');
  const second=new URL(auth.begin('http://127.0.0.1:4317'));assert.notEqual(first.searchParams.get('state'),second.searchParams.get('state'));assert.notEqual(first.searchParams.get('code_challenge'),second.searchParams.get('code_challenge'));
  await assert.rejects(auth.callback({state:first.searchParams.get('state'),code:'invalid'}),/일치하지/);
});
test('사진 원본 바이트를 보존하고 분석용 사본만 줄이며 이미지로 위장한 파일을 거부한다',async t=>{
  const {store}=await context(t),service=new Assets(store),p=store.createProject();const data=await sharp({create:{width:4000,height:3000,channels:3,background:'#cbb68f'}}).jpeg({quality:98}).toBuffer();
  const a=await service.upload(multipart(data),p.id,'photo');await service.queue;const ready=store.asset(a.id);
  assert.equal(ready.status,'ready');assert.deepEqual(await fs.readFile(service.resolve(ready.originalPath)),data);const preview=await sharp(service.resolve(ready.previewPath)).metadata();assert.equal(preview.width,1024);assert(ready.previewBytes<ready.bytes);
  const legacyPath=`${ready.id}/original`;await fs.copyFile(service.resolve(ready.originalPath),service.resolve(legacyPath));const uploadPath=await service.originalForUpload({...ready,originalPath:legacyPath});assert.equal(path.extname(uploadPath),'.jpg');assert.deepEqual(await fs.readFile(uploadPath),data);
  await assert.rejects(service.upload(multipart(Buffer.from('<script>bad</script>'),'fake.jpg'),p.id,'photo'),/JPG, PNG/);
  await assert.rejects(service.upload(multipart(data),p.id,'wrong-role'),/첨부 영역/);
});
test('PDF는 텍스트 페이지와 스캔 페이지를 분리하고 페이지 근거와 원본을 보존한다',async t=>{
  const {store}=await context(t),service=new Assets(store),p=store.createProject(),data=pdfFixture();const a=await service.upload(multipart(data,'원본 시공내역.pdf'),p.id,'construction');await service.queue;const ready=store.asset(a.id);
  assert.equal(ready.filename,'원본 시공내역.pdf');
  assert.equal(ready.status,'ready',ready.warning);assert.equal(ready.pages.length,2);assert.match(ready.pages[0].text,/white wall finish/);assert.equal(ready.pages[0].scanned,false);assert.equal(ready.pages[1].scanned,true);assert(ready.pages[1].imageUrl);assert.deepEqual(await fs.readFile(service.resolve(ready.originalPath)),data);
});
test('원고 버전 충돌을 막고 재시작하면 진행 중 작업을 복구 대상으로 표시한다',async t=>{
  const {store}=await context(t),p=store.createProject();store.saveProject({...p,title:'수정'},p.revision);assert.throws(()=>store.saveProject(p,p.revision),/다른 화면/);
  store.put('job','interrupted',{id:'interrupted',kind:'publish',status:'running',projectId:p.id});const reopened=new Store(store.dir);assert.equal(reopened.get('job','interrupted').status,'uncertain');reopened.close();
});
test('동시에 같은 원고를 처리하지 않으며 무료 한도 초과를 별도 상태로 보관한다',async t=>{
  const {store}=await context(t),jobs=new Jobs(store),p=store.createProject();let done;const job=jobs.start(p.id,'analyze',()=>new Promise((_,reject)=>{done=reject;}));
  await new Promise(r=>setTimeout(r,5));assert.throws(()=>jobs.start(p.id,'generate',async()=>({})),/진행 중/);done(Object.assign(new Error('한도'),{status:429}));await new Promise(r=>setTimeout(r,15));assert.equal(store.get('job',job.id).status,'limited');
});
test('결과가 불명확한 발행 요청은 중복 제출하지 않는다',async t=>{
  const {store}=await context(t),p=store.createProject();const next=store.updateProject(p.id,{original:{...p.original,name:'원본'},target:{...p.target,name:'대상'},title:'추천글',blocks:[{kind:'text',text:'대상에 디자인을 추천합니다.'}],keywords:[]});store.put('settings','main',{...store.get('settings','main'),blogId:'assigned-blog'});
  const naver=new Naver(store,{}, {exclusive(){throw new Error('다시 제출하면 안 됨');}});const key=naver.fingerprint(next,[],'assigned-blog');store.put('publish',key,{status:'uncertain'});await assert.rejects(naver.publish(p.id,()=>{},{confirmReviewed:true}),e=>e.status===409&&e.uncertain);
});

test('편집기 준비는 최종 발행을 누르지 않으며 수동 변경된 글을 자동 덮어쓰지 않는다',async t=>{
  const {store}=await context(t),p=store.createProject();store.updateProject(p.id,{original:{...p.original,name:'원본'},target:{...p.target,name:'대상'},title:'기능 확인용 원고',blocks:[{kind:'text',text:'대상에 디자인을 제안합니다.'}],keywords:[]});store.put('settings','main',{...store.get('settings','main'),blogId:'assigned-blog'});
  const state={title:'',body:'',panel:false,navigations:0,finalClicks:0};
  const labels=['전체공개','비공개'].map(text=>({textContent:text,control:{checked:text==='전체공개'},click(){for(const l of labels)l.control.checked=l===this;}}));
  const title={get innerText(){return state.title;},get textContent(){return state.title;}},main={get innerText(){return state.body;}};
  const selection={removeAllRanges(){},addRange(){}},editable={focus(){}};
  const document={querySelector:selector=>selector.includes('카테고리 목록 버튼')?{textContent:'추천 인테리어'}:selector.includes('se-title-text')?title:selector.includes('se-document')?main:selector.includes('confirm_btn')&&state.panel?{}:null,querySelectorAll:selector=>selector==='label'?labels:selector.includes('se-title-text')?[{textContent:state.title}]:selector.includes('se-component.se-text')?(state.body?[{textContent:state.body,innerText:state.body}]:[]):selector.includes('se-text-paragraph')?(state.body?[{textContent:state.body}]:[]):selector.includes('contenteditable')?[editable]:[],createRange:()=>({selectNodeContents(){},collapse(){}}),getSelection:()=>selection};
  const bridge={window:{isDestroyed:()=>false},exclusive:fn=>fn(),goto:async()=>{state.navigations++;},waitFor:async()=>{},status:async()=>({connected:true,canWrite:true}),evaluate:async(fn,arg)=>vm.runInNewContext(`(${fn.toString()})(argument)`,{document,argument:arg}),text:async(_,text)=>{state.title=text;},focusText:async()=>{},key:async()=>{},pasteHtml:async()=>{state.body='대상에 디자인을 제안합니다.';},click:async selector=>{if(selector.includes('publish_btn'))state.panel=true;if(selector.includes('confirm_btn'))state.finalClicks++;},reveal(){}};
  const naver=new Naver(store,{},bridge);
  const prepared=await naver.publish(p.id,()=>{},{prepareOnly:true});assert.equal(prepared.status,'prepared');assert.equal(state.finalClicks,0);
  await naver.publish(p.id,()=>{},{prepareOnly:true});assert.equal(state.navigations,1);assert.equal(state.finalClicks,0);
  state.body='네이버에서 직접 고친 본문';
  await assert.rejects(naver.publish(p.id,()=>{},{confirmReviewed:true}),/기존 작성 중인 글/);assert.equal(state.finalClicks,0);assert.equal(state.body,'네이버에서 직접 고친 본문');
});
test('네이버 로그인은 안쪽 블로그 프레임의 최신 글쓰기 링크로도 판별한다',async()=>{
  const frame=links=>({executeJavaScript:source=>vm.runInNewContext(source,{location:{href:'https://blog.naver.com/PostList.naver?blogId=dochchan'},document:{querySelectorAll:()=>links,querySelector:()=>null}})});
  const bridge=new BrowserBridge();bridge.window={isDestroyed:()=>false,webContents:{mainFrame:{framesInSubtree:[frame([]),frame([{href:'https://blog.naver.com/dochchan/postwrite',textContent:'글쓰기'}])]},session:{cookies:{get:async()=>[{name:'NID_AUT',domain:'.naver.com'},{name:'NID_SES',domain:'.naver.com'}]}}}};
  const status=await bridge.status('dochchan');assert.equal(status.connected,true);assert.equal(status.canWrite,true);assert.equal(status.blogId,'dochchan');
  const other=await bridge.status('different-blog');assert.equal(other.connected,true);assert.equal(other.canWrite,false);
  bridge.window=null;assert.equal((await bridge.status('dochchan')).connected,false);
});
test('공개 블로그의 글쓰기 링크만으로 로그인 완료를 표시하지 않는다',async()=>{
  const frame={executeJavaScript:async()=>({blogId:'dochchan',connected:true,canWrite:true,loginPage:false})};
  const bridge=new BrowserBridge();bridge.window={isDestroyed:()=>false,webContents:{mainFrame:{framesInSubtree:[frame]},session:{cookies:{get:async()=>[]}}}};
  const result=await bridge.status('dochchan');assert.equal(result.connected,false);assert.equal(result.canWrite,false);assert.equal(result.saved,false);
});
test('저장된 네이버 계정은 창을 닫거나 앱을 재시작해도 복구되고 계정마다 글쓰기 권한을 구분한다',async()=>{
  const vault=memoryVault();const cookies=[{name:'NID_AUT',value:'test-only-not-a-real-credential',domain:'.naver.com',expirationDate:Date.now()/1000+3600},{name:'NID_SES',value:'test-only-not-a-real-credential',domain:'.naver.com'}];
  const frame={executeJavaScript:source=>vm.runInNewContext(source,{location:{href:'https://blog.naver.com/dochchan'},document:{querySelectorAll:()=>[{href:'https://blog.naver.com/dochchan/postwrite',textContent:'글쓰기'}],querySelector:()=>null}})};
  const bridge=new BrowserBridge({vault});bridge.window={isDestroyed:()=>false,webContents:{mainFrame:{framesInSubtree:[frame]},session:{cookies:{get:async()=>cookies}}}};
  assert.equal((await bridge.status('dochchan')).saved,true);bridge.window=null;assert.equal((await bridge.status('dochchan')).connected,true);
  const reopened=new BrowserBridge({vault});assert.equal((await reopened.status('dochchan')).canWrite,true);assert.equal((await reopened.status('different-blog')).canWrite,false);
  vault.remove('naver');assert.equal((await new BrowserBridge({vault}).status()).connected,false);
});
test('계정 변경은 이전 연결을 지우고 새 로그인 창을 열며 작업 중에는 거부한다',async()=>{
  const vault=memoryVault();vault.set('naver',{cookies:[{name:'NID_AUT'},{name:'NID_SES'}],blogId:'old-blog',canWrite:true});
  const bridge=new BrowserBridge({vault});const urls=[];let clearOptions;
  bridge.window={isDestroyed:()=>false,show(){},loadURL:async url=>urls.push(url),webContents:{mainFrame:{framesInSubtree:[]},session:{cookies:{get:async()=>[]},clearStorageData:async options=>{clearOptions=options;}}}};
  const result=await bridge.changeAccount();assert.equal(result.connected,false);assert.equal(vault.get('naver'),undefined);assert.equal(bridge.credentials,null);assert.deepEqual(urls,['about:blank','https://blog.naver.com/MyBlog.naver']);assert.ok(clearOptions.storages.includes('cookies'));
  bridge.busy=true;await assert.rejects(bridge.changeAccount(),e=>e.status===409);
});

test('네이버 이동 중 이전 글을 읽지 않고 주소에 맞는 프레임을 기다린다',async()=>{
  const frame=url=>({executeJavaScript:source=>vm.runInNewContext(source,{location:{href:url},document:{querySelector:()=>({})}})});
  const old=frame('https://blog.naver.com/PostView.naver?logNo=111'),current=frame('https://blog.naver.com/PostView.naver?logNo=222');
  const bridge=new BrowserBridge();bridge.window={isDestroyed:()=>false,webContents:{mainFrame:{framesInSubtree:[old,current]},getURL:()=> 'https://blog.naver.com/test/222'}};
  assert.equal(await bridge.waitFor('.se-main-container',100,{urlContains:'222'}),current);
  assert.equal(await bridge.frame('.se-main-container','333'),null);
  bridge.window.webContents.mainFrame.framesInSubtree=[];
  await assert.rejects(bridge.waitFor('.se-main-container',1),e=>e.status===422);
  bridge.window.webContents.getURL=()=> 'https://nid.naver.com/nidlogin.login';
  await assert.rejects(bridge.waitFor('.se-main-container',1),e=>e.status===401);
});

test('정상적인 네이버 리디렉션은 계속 기다리고 네트워크 오류는 숨기지 않는다',async()=>{
  const bridge=new BrowserBridge();bridge.window={isDestroyed:()=>false,loadURL:async()=>{throw Object.assign(new Error('redirect'),{errno:-3});}};
  await bridge.goto('https://blog.naver.com/test/222');
  bridge.window.loadURL=async()=>{throw Object.assign(new Error('connection failed'),{errno:-105});};
  await assert.rejects(bridge.goto('https://blog.naver.com/test/222'),/connection failed/);
});
test('네이버 버튼이 화면에 표시되기 전에 존재해도 표시 완료까지 기다린다',async()=>{
  let observations=0,clicks=0;const button={textContent:'예약발행',getAttribute:()=>null,getBoundingClientRect:()=>({width:++observations>1?100:0}),click:()=>{clicks++;}};
  const document={querySelector:()=>button,querySelectorAll:()=>[button]},frame={executeJavaScript:source=>vm.runInNewContext(source,{document,location:{href:'https://blog.naver.com/assigned/postwrite'}})};
  const bridge=new BrowserBridge();bridge.window={isDestroyed:()=>false,webContents:{mainFrame:{framesInSubtree:[frame]}}};
  await bridge.click('button');assert.equal(clicks,1);assert(observations>1);
});

test('본문 붙여넣기 전에 클립보드의 모든 형식을 복원 가능한 사본으로 보관한다',async()=>{
  let current={'text/plain':new Blob(['원래 내용']),'text/html':new Blob(['<b>원래 내용</b>']),'image/png':new Blob([new Uint8Array([1,2,3])])};
  const readItem={types:Object.keys(current),getType:async type=>current[type]};class Item{constructor(data){this.data=data;}}
  const saved=await snapshotClipboard({read:async()=>[readItem]},Item);
  current={'text/plain':new Blob(['새 원고'])};
  assert(saved[0] instanceof Item);assert.notEqual(saved[0],readItem);assert.equal(await saved[0].data['text/plain'].text(),'원래 내용');assert.equal(await saved[0].data['text/html'].text(),'<b>원래 내용</b>');assert.deepEqual(new Uint8Array(await saved[0].data['image/png'].arrayBuffer()),new Uint8Array([1,2,3]));
});

test('운영체제 클립보드에 빈 형식 항목이 있어도 본문 입력을 막지 않는다',async()=>{
  class Item{constructor(data){assert(Object.keys(data).length);this.data=data;}}
  const empty={types:[],getType:async()=>{throw new Error('빈 형식은 읽지 않습니다.');}};
  const text={types:['text/plain'],getType:async()=>new Blob(['원래 내용'])};
  assert.deepEqual(await snapshotClipboard({read:async()=>[empty]},Item),[]);
  const saved=await snapshotClipboard({read:async()=>[empty,text]},Item);
  assert.equal(saved.length,1);assert.equal(await saved[0].data['text/plain'].text(),'원래 내용');
});

test('파일 미리보기 처리가 끝나도 처리 도중 정한 공간·묶음·순서를 보존한다',async t=>{
  const {store}=await context(t),service=new Assets(store),p=store.createProject();let start,resume;const began=new Promise(r=>{start=r;}),gate=new Promise(r=>{resume=r;}),processPdf=service.processPdf.bind(service);
  service.processPdf=async a=>{start();await gate;await processPdf(a);};
  const a=await service.upload(multipart(pdfFixture(),'scope.pdf'),p.id,'construction');await began;
  store.put('asset',a.id,{...store.get('asset',a.id),space:'거실',group:'chosen',order:7,excluded:true});resume();await service.queue;
  const ready=store.asset(a.id);assert.equal(ready.status,'ready');assert.equal(ready.space,'거실');assert.equal(ready.group,'chosen');assert.equal(ready.order,7);assert.equal(ready.excluded,true);
});

test('평형 조회는 타입의 면적이 먼저 도착해도 해당 도면이 준비될 때까지 기다린다',async t=>{
  const {store}=await context(t);let reads=0,picked=false;const control={get checked(){return picked;}};
  const label={textContent:'120.1C㎡',innerText:'120.1C㎡',control,getAttribute:()=>null,click(){picked=true;}};
  const originalLabel={textContent:'119.98A㎡',innerText:'119.98A㎡',getAttribute:()=>null,control:{get checked(){return !picked;}}};
  const root={get innerText(){return '경상남도 창원시 마산회원구 양덕서로 30\n'+(picked?'공급면적 120.1C㎡ 전용면적 84.89㎡':'공급면적 119.98A㎡ 전용면적 84.99㎡');},querySelectorAll:s=>s==='h2,h3'?[{innerText:'메트로시티'}]:s==='img'?[{alt:'평면도',src:++reads<4?'https://landthumb-phinf.pstatic.net/previous-A.jpg':'https://landthumb-phinf.pstatic.net/selected-C.jpg',currentSrc:'https://landthumb-phinf.pstatic.net/previous-A.jpg'}]:[originalLabel,label]};
  const document={querySelector:()=>root,querySelectorAll:()=>[originalLabel,label],getElementById:()=>null};
  const bridge={exclusive:fn=>fn(),goto:async()=>{},waitFor:async()=>{},click:async(selector)=>{assert.equal(selector,'[role="tab"]');return true;},evaluate:async(fn,arg)=>vm.runInNewContext(`(${fn.toString()})(argument)`,{document,argument:arg})};
  const result=await new Naver(store,{},bridge).readComplex('https://fin.land.naver.com/complexes/25924','120.1C㎡');assert(reads>=4);assert.equal(result.selectedType,'120.1C㎡');assert.equal(result.exclusiveArea,'84.89');assert.equal(result.images[0].url,'https://landthumb-phinf.pstatic.net/selected-C.jpg');
});

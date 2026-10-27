import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import sharp from 'sharp';
import vm from 'node:vm';
import {createServer} from '../server/index.mjs';

async function setup(t,bridge=null){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-construction-'));
  await fs.mkdir(path.join(dir,'construction'),{recursive:true});
  await fs.writeFile(path.join(dir,'construction','cafe.config.json'),JSON.stringify({cafeId:'123456',ai:{provider:'codex'}}));
  const runtime=await createServer({dataDir:dir,port:0,bridge});
  t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  const initial=await fetch(runtime.url+'/api/bootstrap'),bootstrap=await initial.json(),cookie=initial.headers.get('set-cookie').split(';')[0];
  const headers={cookie,'X-Lemon-CSRF':bootstrap.csrf,Origin:runtime.url};
  const request=(route,body,method=body===undefined?'GET':'POST')=>fetch(runtime.url+route,{method,headers:{...headers,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
  return {dir,runtime,bootstrap,headers,request};
}

test('공사전·공사중 연결은 스튜디오 CSRF와 내부 포트 인증을 유지한다',async t=>{
  const {runtime,request,headers,bootstrap}=await setup(t);
  const screen=await request('/construction'),html=await screen.text();
  assert.equal(screen.status,200);assert.ok(html.includes(JSON.stringify(bootstrap.csrf)));assert.ok(!html.includes('__LEMON_CSRF__'));
  const during=await (await request('/construction?kind=during')).text();assert.match(during,/<h1>공사중 작성 · 카페/);assert.ok(during.includes('var selectedKind = "during"'));assert(!during.includes('__CONSTRUCTION_'));
  let response=await fetch(runtime.url+'/api/cafe/settings',{method:'PUT',headers:{...headers,'X-Lemon-CSRF':'wrong','Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,403);assert.equal(runtime.construction.child,null);
  response=await fetch(runtime.url+'/api/cafe/settings',{method:'PUT',headers:{...headers,Origin:'https://external.invalid','Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,403);
  const status=await (await request('/api/cafe/status')).json();assert.equal(status.setup.cafeId,true);assert.equal(status.busy,false);
  const {port}=await runtime.construction.start();
  response=await fetch(`http://127.0.0.1:${port}/api/cafe/jobs`);assert.equal(response.status,403);
  response=await request('/api/cafe/settings',{phone:'',homepage:'https://example.com'},'PUT');assert.equal(response.status,200);
  assert.equal((await response.json()).homepage,'https://example.com');
  runtime.jobs.active.set('naver-task',{kind:'prepare'});
  response=await request('/api/cafe/chrome/open',{});assert.equal(response.status,409);
  runtime.jobs.active.clear();runtime.construction.browserBusy=true;
  response=await request('/api/naver/login',{});assert.equal(response.status,409);
  runtime.construction.browserBusy=false;
});

test('두 공사 콘텐츠의 사진·수정 원고는 분리 저장되고 엔진 재시작 후에도 유지된다',async t=>{
  const a=await setup(t),b=await setup(t);
  const image=await sharp({create:{width:100,height:80,channels:3,background:'#ddd'}}).jpeg().toBuffer();
  const ids=[];
  for(const kind of ['before','during']){
    const form=new FormData();for(const [key,value]of Object.entries({kind,sido:'서울',gu:'마포구',apt:'검증 아파트',size:'34',memo:'자동화 연결 확인용'}))form.append(key,value);
    form.append('photos',new Blob([image],{type:'image/jpeg'}),'현장 사진.jpg');
    const response=await a.request('/api/cafe/jobs',form);assert.equal(response.status,200);const {id}=await response.json();ids.push(id);
    const saved=await (await a.request('/api/cafe/jobs/'+id)).json();assert.equal(saved.분류,kind);assert.deepEqual(saved.photos,['현장 사진.jpg']);
    assert.ok(saved.titles.every(title=>!title.includes('34평')));
    const draft={intro:'검증 인사말',sections:[{space:'거실',photos:saved.photos,text:'수정한 현장 설명',layout:'individual'}],outro:'검증 마무리'};
    const edited=await a.request('/api/cafe/jobs/'+id,{title:`[테스트] ${kind}`,draft,tags:['현장확인']},'PUT');assert.equal(edited.status,200);
    assert.ok((await edited.json()).blocks.some(block=>block.text==='수정한 현장 설명'));
    const photo=await a.request('/api/cafe/jobs/'+id+'/photo/'+encodeURIComponent(saved.photos[0]));assert.deepEqual(Buffer.from(await photo.arrayBuffer()),image);
    for(const options of [{mode:'publish',confirm:true,dryRun:false},{mode:'draft',confirm:true},{dryRun:false}]){
      const refused=await a.request('/api/cafe/jobs/'+id+'/publish',options);assert.equal(refused.status,400);assert.match((await refused.json()).error,/임시등록/);
    }
  }
  assert.equal((await (await b.request('/api/cafe/jobs')).json()).length,0);
  assert.equal((await b.request('/api/cafe/jobs/'+ids[0])).status,404);
  const oldChild=a.runtime.construction.child,exited=once(oldChild,'exit');oldChild.kill();await exited;
  const list=await (await a.request('/api/cafe/jobs')).json();assert.equal(list.length,2);
  const reopened=await (await a.request('/api/cafe/jobs/'+ids[0])).json();assert.equal(reopened.draft.sections[0].text,'수정한 현장 설명');
  assert.equal((await (await a.request('/api/bootstrap')).json()).projects.length,a.bootstrap.projects.length);
});

test('임시등록 버튼 표시만으로 성공 처리하지 않고 완료 안내가 있어야 저장을 확인한다',async()=>{
  const module={exports:{}};
  vm.runInNewContext(await fs.readFile('server/construction/cafe/editor.js','utf8'),{module,exports:module.exports,require:name=>name==='path'?path:{},Date,Set,console});
  const {saveDraft}=module.exports._t;
  function page(text,dialog=''){
    const listeners=new Map(),button={count:async()=>1,isVisible:async()=>true,scrollIntoViewIfNeeded:async()=>{},click:async()=>listeners.get('dialog')?.({message:()=>dialog})};
    return {locator:()=>({first:()=>button}),on:(event,callback)=>listeners.set(event,callback),off:event=>listeners.delete(event),evaluate:async()=>text,waitForTimeout:async()=>{}};
  }
  await assert.rejects(saveDraft(page('임시등록 0 등록'),()=>{}),/완료 안내를 확인하지 못했습니다/);
  await saveDraft(page('임시등록 1 등록','임시등록되었습니다.'),()=>{});
  await saveDraft(page('임시 저장이 완료되었습니다.'),()=>{});
  await assert.rejects(module.exports.publish({mode:'publish'}),/임시등록만 지원/);
});

test('스튜디오의 기존 네이버 연결을 메모리로만 공유하고 계정 변경도 반영한다',async t=>{
  let cookies=['NID_AUT','NID_SES'].map(name=>({name,value:'test-only',domain:'.naver.com',path:'/',secure:true,httpOnly:true,expires:-1,sameSite:'Lax'})),opened=0;
  const {dir,request}=await setup(t,{naverCookies:async()=>cookies,status:async()=>({available:true,connected:true}),open:async()=>{opened++;}});
  let status=await (await request('/api/cafe/status')).json();assert.equal(status.chrome.loggedIn,true);
  await assert.rejects(fs.access(path.join(dir,'construction/auth/cafe-cookies.json')),/ENOENT/);
  cookies=[];status=await (await request('/api/cafe/status')).json();assert.equal(status.chrome.loggedIn,false);
  const login=await request('/api/cafe/chrome/open',{});assert.equal(login.status,200);assert.equal(opened,1);
  const hidden=await request('/api/cafe/session',{cookies:[]});assert.equal(hidden.status,404);
});

test('카페 API의 가운데점 표기를 실제 게시판 이름으로 복원하고 두 지역을 모두 연결한다',async()=>{
  const module={exports:{}},board={menuId:1,name:'수원&middot;동탄 공사중 현장'};
  const data={all:[board],byRegion:{'수원&middot;동탄':board}};
  vm.runInNewContext(await fs.readFile('server/construction/cafe/boards.js','utf8'),{module,exports:module.exports,require:name=>name==='fs'?{readFileSync:()=>JSON.stringify(data)}:name==='path'?path:{DATA_DIR:'/unused'},Set,console});
  const boards=module.exports.load();assert.equal(boards.all[0].name,'수원·동탄 공사중 현장');
  assert.equal(module.exports.pick('경기','수원시').name,'수원·동탄 공사중 현장');
  assert.equal(module.exports.pick('경기','동탄').menuId,1);
});

test('화면 준비는 등록 없이 편집기를 남기고 임시등록 모드는 저장 후 닫는다',async()=>{
  let saved=0,closed=0,visible;
  const page={on(){},goto:async()=>{},waitForTimeout:async()=>{},url:()=> 'https://cafe.naver.com/ca-fe/articles/write',bringToFront:async()=>{},evaluate:async()=>({image:0,collage:0,map:0,line:0,video:0}),screenshot:async()=>{},close:async()=>{closed++;}};
  const context={cookies:async()=>[{name:'NID_AUT'},{name:'NID_SES'}],newPage:async()=>page},module={exports:{}};
  const sandbox=vm.createContext({module,exports:module.exports,require:name=>name==='path'?path:name==='./chrome'?{withContext:(fn,options)=>{visible=options.visible;return fn(context);}}:name==='./jobs'?{photoDir:()=>'/unused',dir:()=>'/unused'}:{},Date,Set,console});
  vm.runInContext(await fs.readFile('server/construction/cafe/editor.js','utf8'),sandbox);
  sandbox.saved=()=>{saved++;};
  vm.runInContext('pick=async()=>({click:async()=>{},fill:async()=>{}});dismissLayers=normalizeBody=stylePhone=centerComponents=async()=>{};ensureBoard=async()=>true;saveDraft=async()=>saved();',sandbox);
  const input={job:{id:'cafe-1',board:{menuId:1,name:'테스트'},title:'테스트',tags:[]},blocks:[]};
  assert.equal((await module.exports.publish({...input,mode:'prepare'})).prepared,true);
  assert.equal(visible,true);assert.equal(saved,0);assert.equal(closed,0);
  assert.equal((await module.exports.publish({...input,mode:'draft'})).draft,true);
  assert.equal(visible,false);assert.equal(saved,1);assert.equal(closed,1);
});

test('검토 창은 보이는 상태로 유지하고 저장·오류일 때 브라우저를 정리한다',async()=>{
  const launches=[];let closed=0;
  const cookies=['NID_AUT','NID_SES'].map(name=>({name,value:'test',domain:'.naver.com'}));
  const context={addCookies:async()=>{},cookies:async()=>cookies},browser={newContext:async()=>context,close:async()=>{closed++;}};
  const module={exports:{}};
  vm.runInNewContext(await fs.readFile('server/construction/cafe/chrome.js','utf8'),{module,exports:module.exports,require:name=>name==='path'?path:name==='playwright'?{chromium:{launch:async options=>{launches.push(options);return browser;}}}:name==='./config'?{CHROME_PROFILE:'/unused'}:{},Date,Set,console,process:{env:{}}});
  module.exports.useStudioCookies(cookies);
  await module.exports.withContext(async()=>({prepared:true}),{visible:true});assert.equal(launches[0].headless,false);assert.equal(closed,0);
  await module.exports.withContext(async()=>({draft:true}));assert.equal(launches[1].headless,true);assert.equal(closed,1);
  await assert.rejects(module.exports.withContext(async()=>{throw Error('입력 실패');},{visible:true}),/입력 실패/);assert.equal(closed,2);
});

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {Store} from '../server/store.mjs';import {AI} from '../server/ai.mjs';import {Naver} from '../server/naver.mjs';import {cafeImageUrl} from '../server/cafe-images.mjs';import {templateFields,cafeScopeCurrent,cafeScopeSignature} from '../shared/template-fields.mjs';
import {templateSourceSignature,sourceSignature} from '../shared/sources.mjs';import {newProject} from '../shared/domain.mjs';
const {BrowserBridge}=createRequire(import.meta.url)('../desktop/browser.cjs');
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
test('참고글 전체를 읽는 동안 편집기 준비가 기다리고 실패 뒤에도 다음 작업을 실행한다',async()=>{
  const bridge=new BrowserBridge(),gate=deferred(),calls=[],naver=new Naver({}, {},bridge);
  naver.readPostPage=async url=>{calls.push(url);if(url.endsWith('/1'))await gate.promise;return {url};};
  const reading=naver.readPosts(['https://blog.naver.com/example/1','https://blog.naver.com/example/2']);await tick();
  const preparing=bridge.exclusive(async()=>{calls.push('prepare');});await tick();assert.deepEqual(calls,['https://blog.naver.com/example/1']);
  gate.resolve();await Promise.all([reading,preparing]);assert.deepEqual(calls,['https://blog.naver.com/example/1','https://blog.naver.com/example/2','prepare']);assert.equal(bridge.busy,false);
  await assert.rejects(bridge.exclusive(()=>{throw Error('조회 실패');}),/조회 실패/);await bridge.exclusive(()=>calls.push('retry'));assert.equal(calls.at(-1),'retry');
});
test('대기 중인 준비 작업의 취소와 시간 초과는 네이버를 열지 않고 다음 작업을 막지 않는다',async()=>{
  const bridge=new BrowserBridge(),gate=deferred(),calls=[],controller=new AbortController();
  const running=bridge.exclusive(()=>gate.promise);await tick();
  const cancelled=bridge.exclusive(()=>calls.push('cancelled'),{signal:controller.signal});controller.abort(new Error('사용자가 중단'));await assert.rejects(cancelled,/사용자가 중단/);
  await assert.rejects(bridge.exclusive(()=>calls.push('expired'),{waitMs:10}),/대기 시간이 초과/);
  const next=bridge.exclusive(()=>calls.push('next'));gate.resolve();await Promise.all([running,next]);assert.deepEqual(calls,['next']);assert.equal(bridge.busy,false);
});
test('페이지 열기가 응답하지 않아도 제한 시간 뒤 잠금을 풀고 재시도할 수 있다',async()=>{
  const bridge=new BrowserBridge();let stopped=0;
  bridge.window={isDestroyed:()=>false,loadURL:()=>new Promise(()=>{}),webContents:{stop:()=>{stopped++;}}};
  await assert.rejects(bridge.exclusive(()=>bridge.open('https://blog.naver.com/example',{visible:false,loadTimeout:10})),/페이지를 여는 시간이 초과/);
  assert.equal(stopped,1);assert.equal(bridge.busy,false);await bridge.exclusive(()=>{});
});
test('카페 이미지 주소는 HTTPS 네이버 CDN만 허용한다',()=>{
  assert.equal(cafeImageUrl('https://cafefiles.pstatic.net/a.jpg'),'https://cafefiles.pstatic.net/a.jpg');
  for(const url of ['http://cafefiles.pstatic.net/a.jpg','https://127.0.0.1/a.jpg','https://cafefiles.pstatic.net.evil.test/a.jpg','https://user@cafefiles.pstatic.net/a.jpg','https://cafefiles.pstatic.net:8443/a.jpg'])assert.throws(()=>cafeImageUrl(url));
});
test('카페의 요청한 글 번호를 기다리고 사진 목록이 안정된 다음 원문을 읽는다',async()=>{
  let observations=0;const checks=[];
  const bridge={goto:async()=>{},waitFor:async(_,timeout,options)=>checks.push(options),evaluate:async(_,arg,options)=>{checks.push(options);return {text:'공사범위가 포함된 카페 본문',images:++observations<3?['loading.jpg']:['ready.jpg','scope.jpg']};}};
  const result=await new Naver({}, {},bridge).readPostPage('https://cafe.naver.com/example/17729');
  assert(checks.every(c=>c.urlContains==='17729'));assert.equal(observations,6);assert.deepEqual(result.images,['ready.jpg','scope.jpg']);assert.equal(result.formatProfile,null);
});
test('공사범위라는 파일명의 원본 이미지는 현장 사진 분석 없이 곧바로 전사한다',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-named-scope-')),store=new Store(dir);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
  const p=store.createProject('case');store.updateProject(p.id,{cafeUrl:'https://cafe.naver.com/example/123',sourceText:'카페 본문'});
  const url='https://cafefiles.pstatic.net/'+encodeURIComponent('공사범위.png'),pixels=[],ai=new AI(store,{}, {},{readPost:async()=>({images:['https://cafefiles.pstatic.net/photo.jpg',url]})});
  ai.cafeImage=async(u,edge)=>(pixels.push([u,edge]),'data:image/jpeg;base64,AA');let calls=0;
  ai.call=async(instructions)=>{calls++;assert(instructions.includes('그대로 전사'));return {location:'',area:'',concept:'',scopeProject:'',scopeCopyright:'',rows:[{label:'조명',value:'주방등, 식탁등 교체',field:'other'}],warnings:[]};};
  await ai.readCafeScope(p.id);assert.equal(calls,1);assert.deepEqual(pixels,[[url,2400]]);assert.equal(store.get('project',p.id).cafeScope.rows[0].value,'주방등, 식탁등 교체');
});
test('공사범위 사진의 제품명과 전체 행을 보존하며 본문에만 있는 시공 항목을 섞지 않는다',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-scope-')),store=new Store(dir);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
  let p=store.createProject('case');p=store.updateProject(p.id,{cafeUrl:'https://cafe.naver.com/example/123',sourceText:'화장실 전체를 철거하고 새 타일을 추천드립니다.',original:{...p.original,name:'시공 현장'}});
  const urls=['https://cafefiles.pstatic.net/photo.jpg','https://cafefiles.pstatic.net/scope1.jpg','https://cafefiles.pstatic.net/scope2.jpg'],reads=[],pixels=[];
  const ai=new AI(store,{}, {},{readPost:async url=>(reads.push(url),{text:p.sourceText,images:urls})});ai.cafeImage=async(url,edge)=>(pixels.push([url,edge]),'data:image/jpeg;base64,AA');let calls=0;
  const rows=[{label:'욕실',value:'대림 양변기, 샤워기',field:'other'},{label:'가구',value:'페트 싱크대',field:'other'},{label:'조명',value:'전체 기구류 교체, 식탁등, 베란다 등 교체',field:'other'},{label:'도장',value:'베란다 세라믹 탄성코트',field:'other'},{label:'도배',value:'전체 개나리 로하스 실크벽지',field:'wall'},{label:'목공',value:'몰딩, 걸레받이',field:'other'},{label:'필름',value:'샤시, 방문, 철제 중문, 팬트리 도어',field:'other'},{label:'기타',value:'방충망 교체',field:'other'}];
  ai.call=async(instructions,content)=>{calls++;assert(content.every(c=>c.type==='input_image'||c.type==='input_text'));return calls===1?{images:[1,2]}:{location:'이미지 원문 현장명',area:'',concept:'',scopeProject:'',scopeCopyright:'',rows,warnings:[]};};
  await ai.readCafeScope(p.id);p=store.get('project',p.id);const fields=templateFields(p,[]);assert.equal(fields.wall,'전체 개나리 로하스 실크벽지');assert.equal(fields.other,rows.filter(r=>r.field==='other').map(r=>r.label==='기타'?r.value:`${r.label} · ${r.value}`).join('\n'));assert(!fields.other.includes('타일'));assert.deepEqual(p.cafeScope.rows,rows);
  assert.deepEqual(pixels.filter(r=>r[1]===2400).map(r=>r[0]),urls.slice(1));await ai.readCafeScope(p.id);assert.equal(calls,2);assert.equal(reads.length,1);
  p=store.updateProject(p.id,{cafeUrl:'https://cafe.naver.com/example/456'});assert.equal(templateFields(p,[]).other,'');ai.browser.readPost=async()=>({text:'본문만 있습니다.',images:[]});await assert.rejects(ai.readCafeScope(p.id),/첨부 사진을 읽지 못/);assert.equal(calls,2);assert.equal(store.get('project',p.id).cafeScope.signature,p.cafeScope.signature);
});
test('원본 공사범위의 벽면·바닥·그 외 칸은 항목명을 중복하지 않고 내용 그대로 채운다',()=>{
  const p={original:{name:'현장',region:'',type:'',supplyArea:''},concept:'',manualWork:'',facts:[],cafeUrl:'https://cafe.naver.com/example/123',sourceText:'본문'};
  p.cafeScope={signature:JSON.stringify([p.cafeUrl,p.sourceText]),location:'경상남도 양산시 물금읍 삽량로 30',area:'11PY',concept:'화이트 우드',scopeProject:'',scopeCopyright:'',rows:[{label:'벽면',value:'실크벽지',field:'wall'},{label:'그 외',value:'욕실, 싱크대, 조명, 세라믹 탄성코트, 몰딩/걸레받이, 필름, 기타',field:'other'}]};
  const fields=templateFields(p,[]);assert.equal(fields.wall,'실크벽지');assert.equal(fields.floor,'');assert.equal(fields.other,p.cafeScope.rows[1].value);assert.equal(fields.concept,'화이트 우드');assert.equal(fields.area,'11PY');
});
test('하단 문구가 누락된 이전 분석은 다시 읽고 프로젝트 번호·저작권을 그대로 저장한다',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-scope-footer-')),store=new Store(dir);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
  let p=store.createProject('case');p=store.updateProject(p.id,{cafeUrl:'https://cafe.naver.com/example/123',sourceText:'본문',templateEdits:{coverTitle:'수정한 표지',scopeProject:'직접 수정한 하단'}});
  p=store.updateProject(p.id,{cafeScope:{signature:cafeScopeSignature(p),location:'',area:'',concept:'',rows:[{label:'벽면',value:'이전 분석',field:'wall'}],warnings:[]}});assert.equal(cafeScopeCurrent(p),false);
  const original={location:'원문 위치',area:'11PY',concept:'화이트 우드',scopeProject:'Project No. 12AB3456_7890C1234',scopeCopyright:'ⓒ 2025. LEMONHOUSE ALL rights reserved.',rows:[{label:'벽면',value:'실크벽지',field:'wall'}],warnings:[]};
  let reads=0,calls=0;const ai=new AI(store,{}, {},{readPost:async()=>{reads++;return {images:['https://cafefiles.pstatic.net/'+encodeURIComponent('공사범위.png')]};}});ai.cafeImage=async()=> 'data:image/jpeg;base64,AA';
  ai.call=async(instructions,_,{schema})=>{calls++;assert.match(instructions,/하단.*scopeProject.*scopeCopyright/);assert(schema.shape.scopeProject);assert(schema.shape.scopeCopyright);return original;};
  await ai.readCafeScope(p.id);p=store.get('project',p.id);assert(cafeScopeCurrent(p));assert.equal(p.cafeScope.scopeProject,original.scopeProject);assert.equal(p.cafeScope.scopeCopyright,original.scopeCopyright);assert.deepEqual(p.templateEdits,{coverTitle:'수정한 표지',scopeProject:'직접 수정한 하단'});
  assert.equal(templateFields(p,[]).scopeProject,'직접 수정한 하단');assert.equal(templateFields({...p,templateEdits:{}},[]).scopeProject,original.scopeProject);assert.equal(templateFields(p,[]).scopeCopyright,original.scopeCopyright);
  await ai.readCafeScope(p.id);assert.equal(reads,1);assert.equal(calls,1);
  p.cafeUrl='https://cafe.naver.com/example/456';assert.equal(templateFields({...p,templateEdits:{}},[]).scopeProject,'');assert.equal(templateFields({...p,templateEdits:{}},[]).scopeCopyright,'');
});
test('공사범위 사진의 빈칸은 본문·현장 정보로 채우지 않고 직접 입력한 값은 보존한다',()=>{
  const p=newProject('blank-scope','case');p.original={...p.original,name:'현장',type:'34평'};p.concept='본문의 콘셉트';p.sourceText='본문';p.cafeUrl='https://cafe.naver.com/example/123';
  p.cafeScope={signature:JSON.stringify([p.cafeUrl,p.sourceText]),location:'',area:'',concept:'',scopeProject:'',scopeCopyright:'',rows:[]};
  const fields=templateFields(p,[]);for(const key of ['location','area','concept','wall','floor','other','scopeProject','scopeCopyright'])assert.equal(fields[key],'');
  p.templateEdits={location:'직접 확인한 위치',area:'사용자 입력 면적',concept:'직접 쓴 콘셉트'};assert.deepEqual(Object.fromEntries(Object.keys(p.templateEdits).map(key=>[key,templateFields(p,[])[key]])),p.templateEdits);
});
test('분석 기록만 바뀌면 이미지를 다시 요구하지 않고 실제 문구·사진·카페 변경은 감지한다',()=>{
  const p=newProject('image-state','case');p.original={...p.original,name:'현장'};p.coverTemplateId='cover';p.scopeTemplateId='scope';p.sourceText='본문';p.cafeUrl='https://cafe.naver.com/example/123';
  p.cafeScope={signature:JSON.stringify([p.cafeUrl,p.sourceText]),location:'원문 위치',area:'11PY',concept:'화이트 우드',scopeProject:'',scopeCopyright:'',rows:[{label:'벽면',value:'실크벽지',field:'wall'}],checkedAt:'first',warnings:[]};
  const assets=[{id:'photo',role:'photo',order:0,hash:'one'}],signature=templateSourceSignature(p,assets);
  p.cafeScope={...p.cafeScope,checkedAt:'later',warnings:['확인 메모']};p.facts=[{id:'fact',space:'거실',item:'시공 확인',confirmed:true}];p.sourceReview={signature:sourceSignature(p,assets),siteInfo:[{field:'concept',value:'본문에서 분석한 콘셉트',uncertain:false}],cafeFacts:[],conflicts:[]};
  assert.equal(templateSourceSignature(p,assets),signature);
  p.templateEdits={scopeCopyright:'© 수정한 문구'};assert.notEqual(templateSourceSignature(p,assets),signature);p.templateEdits={};
  assets[0].hash='two';assert.notEqual(templateSourceSignature(p,assets),signature);assets[0].hash='one';
  p.cafeUrl='https://cafe.naver.com/example/456';assert.notEqual(templateSourceSignature(p,assets),signature);
});

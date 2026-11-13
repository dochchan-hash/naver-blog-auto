import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {AI} from '../server/ai.mjs';
import {newProject,photoGroups,draftWarnings,moveDraftBlocks} from '../shared/domain.mjs';
import {photoDropPatches} from '../shared/photo-layout.mjs';
import {sourceSignature,sourceReviewCurrent,resolvedSourceEvidence,draftSourceSignature} from '../shared/sources.mjs';
const photos=()=>['a','b','c','d'].map((id,order)=>({id,projectId:'p',role:'photo',space:'거실',group:'',order,excluded:false,hash:id,status:'ready',analysis:{description:'밝은 거실'}}));
const apply=(assets,patches)=>assets.map(a=>({...a,...patches.find(p=>p.id===a.id)}));
test('원고 드래그는 선택한 여러 종류의 항목을 원래 순서와 내용 그대로 함께 이동한다',()=>{
  const blocks=['heading','photos','text','quote','divider','map','video'].map((kind,i)=>({id:String(i),kind,text:'원고 '+i,assetIds:kind==='photos'?['photo']:undefined}));
  const original=structuredClone(blocks),ids=items=>items.map(b=>b.id);
  assert.deepEqual(ids(moveDraftBlocks(blocks,'1','6','after',['3','1'])),['0','2','4','5','6','1','3']);
  assert.deepEqual(ids(moveDraftBlocks(blocks,'6','0','before',['6','4'])),['4','6','0','1','2','3','5']);
  assert.deepEqual(ids(moveDraftBlocks(blocks,'2','0','before',['1','3'])),['2','0','1','3','4','5','6']);
  assert.deepEqual(blocks,original);
  const moved=moveDraftBlocks(blocks,'1','6','after',['1','3']);
  for(const b of blocks)assert.equal(moved.find(x=>x.id===b.id),b);
  for(const [source,target,side,selected]of [['1','3','after',['1','3']],['0','0','before',[]],['0','1','before',[]],['unknown','0','after',[]],['0','unknown','after',[]],['0','1','invalid',[]]])assert.equal(moveDraftBlocks(blocks,source,target,side,selected),blocks);
});
function fixture(){
  const p={...newProject('p'),sourceText:'거실 바닥은 폴리싱 타일로 마감했습니다. 주방에는 간접조명을 설치했습니다.',original:{name:'원본',region:'창원',type:'84A'},target:{name:'추천',region:'창원',type:'84B'},facts:[{id:'floor',space:'거실',item:'강마루 바닥 시공',sourceAssetId:'doc',sourceLabel:'공사범위.jpg',uncertain:false,confirmed:false}],keywords:[]};
  const assets=[{id:'doc',role:'construction',hash:'document',projectId:'p',status:'ready'},...photos()];
  p.sourceReview={signature:sourceSignature(p,assets),checkedAt:'2026-10-05',warnings:[],cafeFacts:[{space:'거실',item:'폴리싱 타일 바닥',evidence:'거실 바닥은 폴리싱 타일로 마감했습니다.',uncertain:false},{space:'주방',item:'주방 간접조명 설치',evidence:'주방에는 간접조명을 설치했습니다.',uncertain:false}],conflicts:[{id:'different-floor',space:'거실',topic:'바닥 자재',constructionFactIds:['floor'],cafeFactIndexes:[0],reason:'자재가 다름',decision:'pending',customText:''}]};
  return {p,assets};
}
async function context(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-workflow-')),store=new Store(dir);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});return store;}

test('사진 드래그는 묶음을 만들고 확장하며 한 장을 빼면 남은 한 장도 단독으로 정리한다',()=>{
  const originals=photos();let a=apply(originals,photoDropPatches(originals,'a','b','group',()=> 'bundle'));
  assert.deepEqual(photoGroups(a).map(g=>g.assets.map(a=>a.id)),[['b','a'],['c'],['d']]);
  a=apply(a,photoDropPatches(a,'c','b','group'));assert.deepEqual(photoGroups(a)[0].assets.map(a=>a.id),['b','a','c']);
  a=apply(a,photoDropPatches(a,'b','','ungroup'));assert.equal(a.find(a=>a.id==='b').group,'');
  a=apply(a,photoDropPatches(a,'c','d','before'));assert.equal(a.find(a=>a.id==='a').group,'');assert.equal(a.find(a=>a.id==='c').group,'');
  assert.deepEqual(originals,photos(),'원본 목록과 해시를 변경하지 않는다');
  assert.throws(()=>photoDropPatches([{...originals[0],space:'주방'},originals[1]],'a','b','group'),/같은 공간/);
  assert.throws(()=>photoDropPatches([originals[0],{...originals[1],projectId:'other'}],'a','b','group'),/같은 추천글/);
});

test('사진의 앞뒤 순서가 바뀌면 이전 원고의 발행을 막는다',()=>{
  const {p}=fixture(),assets=photos().slice(0,2);p.sourceText='';p.sourceReview=null;p.title='추천 원고';p.blocks=[{kind:'heading',space:'거실',text:'거실'},{kind:'photos',space:'거실',assetIds:['a']},{kind:'photos',space:'거실',assetIds:['b']},{kind:'text',space:'거실',text:'원고'}];
  assert.equal(draftWarnings(p,assets).length,0);
  const moved=apply(assets,photoDropPatches(assets,'b','a','before'));assert(draftWarnings(p,moved).some(w=>w.includes('사진 순서')));
});

test('자료 차이의 여섯 처리 방식은 선택한 근거만 전달하고 충돌 문구를 제외하고 나머지 원문을 전달한다',()=>{
  for(const decision of ['pending','construction','cafe','both','exclude','custom']){
    const {p,assets}=fixture();p.sourceReview.conflicts[0].decision=decision;p.sourceReview.conflicts[0].customText='실제 확인한 바닥은 장판';
    const result=resolvedSourceEvidence(p,assets),text=JSON.stringify(result.facts);
    assert.match(result.cafeText,/주방에는 간접조명/);assert.match(text,/주방 간접조명/);
    assert.equal(text.includes('강마루'),['construction','both'].includes(decision),decision);
    assert.equal(text.includes('폴리싱'),['cafe','both'].includes(decision),decision);
    assert.equal(text.includes('장판'),decision==='custom');
    assert.equal(result.pending.length,decision==='pending'?1:0);
    if(decision==='both')assert(result.facts.some(f=>f.disputed));
  }
});

test('자료 수정은 비교 결과를 무효화하고 반영 방식 수정은 이전 원고를 무효화한다',()=>{
  const {p,assets}=fixture();p.sourceReview.conflicts[0].decision='exclude';p.draftSourceSignature=draftSourceSignature(p,assets);
  assert(sourceReviewCurrent(p,assets));p.sourceReview.conflicts[0].decision='construction';
  assert(sourceReviewCurrent(p,assets));assert.notEqual(draftSourceSignature(p,assets),p.draftSourceSignature);
  assert(draftWarnings(p,assets).some(w=>w.includes('반영 방식')));
  p.sourceText+=' 내용을 수정했습니다.';assert(!sourceReviewCurrent(p,assets));assert(draftWarnings(p,assets).some(w=>w.includes('차이를 다시 확인')));
});

test('원문 근거 없는 카페 추출은 확인 대상으로 남기고 재분석은 기존 선택과 캐시를 유지한다',async t=>{
  const store=await context(t),{p,assets}=fixture();delete p.sourceReview;store.put('project',p.id,p);assets.forEach(a=>store.put('asset',a.id,a));
  const ai=new AI(store,{}, {},{});let calls=0;
  ai.call=async()=>{calls++;return {cafeFacts:[{space:'거실',item:'타일 바닥',evidence:'거실 바닥은 폴리싱 타일로 마감했습니다.',uncertain:false},{space:'욕실',item:'욕실 방수',evidence:'원문에 없는 인용',uncertain:false}],conflicts:[{space:'거실',topic:'바닥',constructionFactIds:['floor'],cafeFactIndexes:[0],reason:'바닥이 다름'}],warnings:[]};};
  await ai.checkSources(p.id);let checked=store.get('project',p.id);assert.equal(checked.sourceReview.cafeFacts[1].uncertain,true);assert.equal(checked.sourceReview.warnings.length,1);
  checked.sourceReview.conflicts[0].decision='cafe';store.saveProject(checked,checked.revision);await ai.checkSources(p.id);assert.equal(calls,1);assert.equal(store.get('project',p.id).sourceReview.conflicts[0].decision,'cafe');
  store.updateProject(p.id,{sourceReview:null});await ai.checkSources(p.id);assert.equal(calls,1,'동일 자료 비교는 저장된 분석을 재사용한다');
});

test('실제 생성 경로는 제외한 자재를 제거하고 파일·카페·사진의 나머지 정보를 함께 사용한다',async t=>{
  const store=await context(t),{p,assets}=fixture();p.sourceReview.conflicts[0].decision='exclude';store.put('project',p.id,p);assets[0].analysis={facts:p.facts};assets.forEach(a=>store.put('asset',a.id,a));store.put('style','main',{rules:'추천글 작성',status:'analyzed',referenceUrls:[]});
  const ai=new AI(store,{}, {},{});let received;
  ai.call=async(instructions,content)=>{const input=JSON.parse(content[0].text);if(instructions.includes('공간별 시공 분류')){assert(!JSON.stringify(input).includes('강마루'));assert(!JSON.stringify(input).includes('폴리싱'));return {items:[{space:'공통',item:'주방 간접조명',sourceIds:['fact:0'],photoIds:[]}],warnings:[]};}if(instructions.includes('본문 시공 대조'))return {checks:[{workId:'work-1',blockId:input.blocks.find(b=>b.text.includes('주방 간접조명')).id,quote:'주방 간접조명을 추천합니다.'}],issues:[]};received=input;return {title:'추천 원고',intro:'안녕하세요. 주방 간접조명을 추천합니다.',sections:[{space:'거실',text:'밝은 분위기를 추천합니다.'}],outro:'문의하세요',tags:[],warnings:[]};};
  const result=await ai.generate(p.id,()=>{});assert.match(received.cafeSource,/주방에는 간접조명/);assert(!JSON.stringify(received).includes('강마루'));assert(!JSON.stringify(received).includes('폴리싱'));assert(JSON.stringify(received).includes('주방 간접조명'));assert.equal(received.photos.length,4);
  assert.equal(result.project.draftSourceSignature,draftSourceSignature(result.project,store.assets(p.id)));assert.deepEqual(result.project.blocks.filter(b=>b.kind==='photos').map(b=>b.assetIds),[['a'],['b'],['c'],['d']]);
});

test('AI 요청은 엄격한 응답 형식을 전달하고 스트리밍된 줄바꿈·한글 원고를 복원한다',async t=>{
  const store=await context(t),ai=new AI(store,{token:async()=> 'test-only-token',modelCache:[{id:'test-only-model'}]}, {},{});
  const {z}=await import('zod');let payload;
  t.mock.method(globalThis,'fetch',async(_,options)=>{payload=JSON.parse(options.body);const value={rules:'거실은 밝게\n다음 문장은 자연스럽게',warnings:[]};const events=[{type:'response.output_text.delta',delta:JSON.stringify(value)},{type:'response.completed',response:{usage:{input_tokens:1,output_tokens:1}}}];const bytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=17)c.enqueue(bytes.slice(i,i+17));c.close();}}),{status:200});});
  const result=await ai.call('JSON으로 원고를 작성하세요',[{type:'input_text',text:'시험 자료'}],{schema:z.object({rules:z.string(),warnings:z.array(z.string()).default([])})});
  assert.equal(result.rules,'거실은 밝게\n다음 문장은 자연스럽게');assert.equal(payload.text.format.type,'json_schema');assert.equal(payload.text.format.strict,true);assert.equal(payload.text.format.schema.additionalProperties,false);assert.deepEqual(payload.text.format.schema.required,['rules','warnings']);assert.equal(payload.text.format.schema.properties.warnings.default,undefined);
});

test('사진 배치 반영은 문장 수정을 보존하지만 자료 선택 변경까지 승인하지 않는다',async()=>{
  const {refreshedPhotoLayoutSignature}=await import('../shared/sources.mjs');const {p,assets}=fixture();p.sourceReview.conflicts[0].decision='exclude';p.draftSourceSignature=draftSourceSignature(p,assets);
  const changed=apply(assets,photoDropPatches(assets,'b','c','group',()=> 'new-group'));
  assert.equal(refreshedPhotoLayoutSignature(p,changed),draftSourceSignature(p,changed));
  p.sourceReview.conflicts[0].decision='construction';assert.equal(refreshedPhotoLayoutSignature(p,changed),p.draftSourceSignature);
});

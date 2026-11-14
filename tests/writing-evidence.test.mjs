import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {Store} from '../server/store.mjs';
import {AI} from '../server/ai.mjs';
import {COMPLETION_FORMAT} from '../shared/format.mjs';
import {resolvedSourceEvidence,missingWorkItems} from '../shared/sources.mjs';
import {createServer} from '../server/index.mjs';
import {localApi} from '../scripts/local-api.mjs';

async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-work-evidence-')),store=new Store(dir);
 t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
 const p=store.createProject('completion');store.updateProject(p.id,{original:{...p.original,name:'확인 현장'},keywords:[],facts:[{id:'wall',space:'거실',item:'석고 1P 후 실크벽지 도배',sourceLabel:'공사범위',confirmed:false,uncertain:false}],blocks:[{id:'old',kind:'text',text:'직접 작성한 원고'}]});
 store.put('style','completion',{rules:'마감 전용 규칙',status:'edited',referenceUrls:[],formatProfile:COMPLETION_FORMAT});
 store.put('asset','photo',{id:'photo',projectId:p.id,role:'photo',space:'거실',order:0,status:'ready',hash:'photo',analysis:{description:'천장 실링팬과 밝은 벽이 보입니다.'}});
 const ai=new AI(store,{}, {},{});ai.analyzeMaterials=async()=>{};return {store,p,ai};
}
const testImage=()=> 'data:image/png;base64,'+createCanvas(900,500).toBuffer('image/png').toString('base64');
const draft=text=>({title:'시공 현장',intro:'현장을 소개합니다.',sections:[{space:'거실',text,points:[]}],outro:'감사합니다.',tags:[],warnings:[]});

test('실제 작업 설명 사이에 섞인 미시공 소품 분위기 문장도 대조 후 제거한다',async t=>{
 const {ai,p}=await fixture(t);let writes=0,audits=0;
 ai.call=async(instructions,content)=>{
  const input=JSON.parse(content[0].text);
  if(instructions.startsWith('공간별 시공 분류'))return {items:[{space:'거실',item:'석고 1P 후 실크벽지 도배',sourceIds:['fact:0'],photoIds:[]}],warnings:[]};
  if(instructions.startsWith('본문 시공 대조')){
   audits++;assert.match(instructions,/모든 문장이.*확인된 작업/);assert.match(instructions,/관계없는 가구·소품/);
   const block=input.blocks.find(b=>b.space==='거실'&&b.role==='body');return {checks:[{workId:'work-1',blockId:block.id,quote:'석고 1P 후 실크벽지로 도배'}],issues:block.text.includes('소품')?['거실: 시공하지 않은 소품으로 아늑함을 연출했다는 문장은 시공 근거가 없습니다.']:[]};
  }
  writes++;assert.match(instructions,/마감 시공 근거 우선 규칙/);assert.match(instructions,/일부가 올바르더라도/);
  return draft('석고 1P 후 실크벽지로 도배해 고른 벽면을 완성했습니다.'+(writes===1?' 소품과 창가 가구로 아늑함을 연출해 보세요.':' 고른 바탕과 정돈된 벽면의 차분한 분위기를 느껴보세요.'));
 };
 const {project}=await ai.generate(p.id,()=>{});assert.equal(writes,2);assert.equal(audits,2);assert(!project.blocks.some(b=>b.text?.includes('소품')));assert(project.blocks.some(b=>b.text?.includes('벽면의 차분한 분위기')));
});

test('분위기 설명만으로 끝내지 않고 공간별 시공 분류 후 누락을 보완해 실제 본문 근거를 저장한다',async t=>{
 const {ai,p}=await fixture(t);let plans=0,writes=0,audits=0;
 ai.call=async(instructions,content)=>{
  const input=JSON.parse(content[0].text);
  if(instructions.includes('공간별 시공 분류')){plans++;assert.equal(writes,0);return {items:[{space:'거실',item:'석고 1P 후 실크벽지 도배',sourceIds:['fact:0'],photoIds:['photo']}],warnings:[]};}
  if(instructions.includes('본문 시공 대조')){audits++;const block=input.blocks.find(b=>b.text.includes('석고 1P'));return {checks:block?[{workId:'work-1',blockId:block.id,quote:'석고 1P 후 실크벽지로 도배'}]:[],issues:[]};}
  assert.equal(plans,1,'시공 분류가 글쓰기보다 먼저여야 합니다.');assert(input.workPlan?.items.length||input.context?.workPlan?.items.length);
  writes++;return draft(writes===1?'밝은 색감이 편안함을 더합니다.':'석고 1P 후 실크벽지로 도배해 벽면을 정돈했습니다. 차분한 마감을 연출해 보세요.');
 };
 const {project}=await ai.generate(p.id,()=>{});assert.equal(plans,1);assert.equal(writes,2);assert.equal(audits,2);assert.equal(project.workPlan.items.length,1);assert.equal(project.workPlan.checks.length,1);assert(project.blocks.some(b=>b.text?.includes('석고 1P')));
});

test('누락이 계속되거나 검사가 실패하면 사용자가 작성한 원고를 보존한다',async t=>{
 const {ai,p,store}=await fixture(t);ai.call=async instructions=>instructions.includes('공간별 시공 분류')?{items:[{space:'거실',item:'석고 1P 후 실크벽지 도배',sourceIds:['fact:0'],photoIds:['photo']}],warnings:[]}:instructions.includes('본문 시공 대조')?{checks:[],issues:[]}:draft('밝고 편안한 공간입니다.');
 await assert.rejects(ai.generate(p.id,()=>{}),/시공.*누락|누락.*시공/);assert.equal(store.get('project',p.id).blocks[0].text,'직접 작성한 원고');
});

test('원문에 없는 세부 제품명·위치는 확인 경고로 남기고 실제 시공이 반영되면 원고를 보존한다',async t=>{
 const {ai,p}=await fixture(t);let writes=0;
 ai.call=async(instructions,content)=>{const input=JSON.parse(content[0].text);if(instructions.includes('공간별 시공 분류'))return {items:[{space:'거실',item:'석고 1P 후 실크벽지 도배',sourceIds:['fact:0'],photoIds:[]}],warnings:[]};if(instructions.includes('본문 시공 대조'))return {checks:[{workId:'work-1',blockId:input.blocks.find(b=>b.space==='거실').id,quote:'석고 1P 후 실크벽지로 도배했습니다.'}],issues:[],warnings:['원문에 세부 제품명은 없어 추가 확인이 필요합니다.']};writes++;return draft('석고 1P 후 실크벽지로 도배했습니다. 정돈된 벽면을 연출해 보세요.');};
 const {project}=await ai.generate(p.id,()=>{});assert.equal(writes,1);assert.equal(project.draftStatus,'review');assert(project.generationWarnings.some(w=>w.includes('세부 제품명')));assert.equal(project.workPlan.checks.length,1);
});

test('분류는 원본 이미지의 누락·불명확한 부분을 다시 확인하고 같은 자료는 재사용한다',async t=>{
 const {ai,p,store}=await fixture(t);store.put('asset','scope',{id:'scope',projectId:p.id,role:'construction',status:'ready',hash:'source',mime:'image/jpeg'});let images=0,calls=0;
 ai.assets.imageData=async()=>{images++;return testImage();};
 ai.call=async(instructions,content)=>{calls++;assert(instructions.includes('하단 공간별 상세 메모'));assert(instructions.includes('확인된 작업만'));assert(content.some(c=>c.type==='input_image'&&c.detail==='high'));return {items:[{space:'거실',item:'석고 1P 후 실크벽지 도배',sourceIds:['fact:0','document:scope'],photoIds:['photo']},{space:'거실',item:'실링팬 설치',sourceIds:['document:scope'],photoIds:['photo']},{space:'거실',item:'밝은 벽과 큰 창이 보입니다.',sourceIds:['photo:photo-1'],photoIds:['photo-1']}],warnings:['실링팬 제품명은 확인이 필요합니다.']};};
 const project=store.get('project',p.id),assets=store.assets(p.id),evidence=resolvedSourceEvidence(project,assets),plan=await ai.planWork(project,assets,evidence,['거실'],()=>{});
 assert.equal(plan.items[1].item,'실링팬 설치');assert.equal(plan.items.length,2);assert.equal(plan.observations.length,1);assert.equal(plan.warnings.length,1);assert.deepEqual(await ai.planWork(project,assets,evidence,['거실'],()=>{}),plan);assert.equal(images,1);assert.equal(calls,1);
 await ai.planWork({...project,manualWork:'추가로 확인한 현관 필름'},assets,evidence,['거실'],()=>{}).then(()=>assert.fail('직접 입력 근거를 누락하면 실패해야 합니다.'),e=>assert.match(e.message,/빠짐없이 분류/));
});

test('허구의 본문 인용·다른 공간의 인용·해제된 포인트는 반영 완료로 인정하지 않는다',()=>{
 const plan={items:[{id:'work-1',space:'주방',item:'일자 싱크대 설치'}],checks:[{workId:'work-1',blockId:'living',quote:'일자 싱크대'}]},blocks=[{id:'living',kind:'text',space:'거실',text:'일자 싱크대 설치'},{id:'kitchen',kind:'text',space:'주방',text:'밝은 주방입니다.'}];
 assert.equal(missingWorkItems(plan,blocks).length,1);plan.checks=[{workId:'work-1',blockId:'kitchen',quote:'일자 싱크대 설치'}];assert.equal(missingWorkItems(plan,blocks).length,1);plan.checks=[{workId:'work-1',blockId:'disabled-point',quote:'일자 싱크대 설치'}];assert.equal(missingWorkItems(plan,blocks).length,1);
 blocks[1].text='일자 싱크대 설치로 조리 공간을 정돈해 보세요.';plan.checks=[{workId:'work-1',blockId:'kitchen',quote:'일자 싱크대 설치'}];assert.equal(missingWorkItems(plan,blocks).length,0);
});

test('시공 분류·본문 근거는 원고 저장·재조회에도 보존되고 잘못된 인용 형식은 거부한다',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-work-api-')),runtime=await createServer({dataDir:dir,port:0});t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});const {request}=await localApi(runtime.url);
 const p=await request('/projects','POST',{postType:'completion'}),workPlan={signature:'source',items:[{id:'work-1',space:'거실',item:'석고 보강',sourceIds:['manual'],photoIds:[]}],warnings:[],checks:[{workId:'work-1',blockId:'body',quote:'석고로 보강했습니다.'}],checkedAt:'2026-10-31'};
 const saved=await request('/projects/'+p.id,'PUT',{...p,workPlan,blocks:[{id:'body',kind:'text',space:'거실',text:'벽을 석고로 보강했습니다.'}]});assert.deepEqual(saved.workPlan,workPlan);assert.deepEqual((await request('/bootstrap')).projects.find(x=>x.id===p.id).workPlan,workPlan);
 await assert.rejects(request('/projects/'+p.id,'PUT',{...saved,workPlan:{...workPlan,checks:[{workId:'work-1',blockId:'body',quote:''}]}}));assert.deepEqual(runtime.store.get('project',p.id).workPlan,workPlan);
});

test('이전 자동 시공 분석은 한 번 보완하되 사용자가 확인·수정한 내용은 덮어쓰지 않는다',async t=>{
 const {ai,p,store}=await fixture(t),old={id:'old-fact',space:'거실',item:'실링팬 — 제품명 확인 필요',uncertain:true,confirmed:false,sourceAssetId:'scope',sourceLabel:'공사범위'};
 store.updateProject(p.id,{facts:[old]});store.put('asset','scope',{id:'scope',projectId:p.id,role:'construction',filename:'공사범위.jpg',mime:'image/jpeg',status:'ready',hash:'scope',analysis:{facts:[old]}});let calls=0;ai.assets.imageData=async()=>testImage();ai.call=async instructions=>{calls++;assert(instructions.includes('제품명만 불명확하면'));return {facts:[{space:'거실',item:'실링팬 설치',uncertain:false},{space:'거실',item:'실링팬 제품명 확인 필요',uncertain:true}],warnings:[]};};
 ai.analyzeMaterials=AI.prototype.analyzeMaterials;await ai.analyzeMaterials(p.id,()=>{});assert.equal(calls,1);assert.equal(store.get('asset','scope').analysis.version,5);assert(store.get('project',p.id).facts.some(f=>f.item==='실링팬 설치'&&!f.uncertain));await ai.analyzeMaterials(p.id,()=>{});assert.equal(calls,1);
 const current=store.get('project',p.id),asset=store.get('asset','scope');store.put('asset','scope',{...asset,analysis:{...asset.analysis,version:3}});store.updateProject(p.id,{facts:current.facts.map((f,i)=>i?f:{...f,item:'사용자가 확인한 실링팬',confirmed:true})});await ai.analyzeMaterials(p.id,()=>{});assert.equal(calls,1);assert.equal(store.get('project',p.id).facts[0].item,'사용자가 확인한 실링팬');
});

test('작은 글씨 문서는 겹치는 확대 구간으로 마지막 행까지 읽고 원본 데이터는 보존한다',async t=>{
 const {ai}=await fixture(t),canvas=createCanvas(900,500),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,900,500);ctx.fillStyle='#00cc00';ctx.fillRect(0,490,900,10);const original=canvas.toBuffer('image/png'),data='data:image/png;base64,'+original.toString('base64');ai.assets.imageData=async()=>data;
 const content=await ai.documentContent({}),images=content.filter(c=>c.type==='input_image');assert.equal(images.length,2);assert(content.some(c=>c.text?.includes('겹치는 행')));const last=await loadImage(Buffer.from(images.at(-1).image_url.split(',')[1],'base64'));assert.equal(last.width,1800);const view=createCanvas(last.width,last.height),paint=view.getContext('2d');paint.drawImage(last,0,0);assert(paint.getImageData(10,last.height-2,1,1).data[1]>150);assert.deepEqual(canvas.toBuffer('image/png'),original);
});

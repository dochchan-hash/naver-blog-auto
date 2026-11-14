import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {writePsdBuffer} from 'ag-psd';
import {createCanvas} from '@napi-rs/canvas';
import {Store} from '../server/store.mjs';
import {AI} from '../server/ai.mjs';
import {createServer} from '../server/index.mjs';
import {localApi} from '../scripts/local-api.mjs';
import {newProject,completionBlocks,photoLayoutBlocks,completionPointSpaces} from '../shared/domain.mjs';
import {COMPLETION_FORMAT} from '../shared/format.mjs';

const slot=(id,space,enabled=true)=>({id,name:space+' 포인트',position:'space',space,enabled,templateId:'psd',text:'수정한 문구',photoIds:[]});
const result={title:'현장 마감',intro:'현장을 소개합니다.',sections:['거실','주방'].map(space=>({space,text:space+'의 직접 작성한 종합 설명입니다.',points:[{title:space+' 시공 포인트',text:space+' 포인트의 별도 설명입니다.'}]})),outro:'관심 가져주셔서 감사합니다.',tags:[],warnings:[]};
const photos=['거실','주방'].map((space,i)=>({id:'photo'+i,projectId:'p',role:'photo',space,status:'ready',order:i}));

test('해제·제거·미등록 포인트는 생성과 재배치에서 제외하고 일반 공간 설명을 보존한다',()=>{
 const p={...newProject('p','completion'),completionTemplates:[slot('living','거실'),slot('kitchen','주방')]};
 const full=completionBlocks(p,photos,result,COMPLETION_FORMAT);assert.equal(full.filter(b=>b.formatRole==='point').length,2);
 for(const templates of [[slot('living','거실'),slot('kitchen','주방',false)],[slot('living','거실')],[slot('living','거실'),{...slot('kitchen','주방'),templateId:''}]]){
  const next={...p,completionTemplates:templates,blocks:full};assert.deepEqual(completionPointSpaces(next),['거실']);
  for(const blocks of [completionBlocks(next,photos,result,COMPLETION_FORMAT),photoLayoutBlocks(next,photos)]){
   assert.deepEqual(blocks.filter(b=>['point','pointBody'].includes(b.formatRole)).map(b=>b.space),['거실','거실']);
   assert.equal(blocks.find(b=>b.kind==='text'&&b.space==='주방'&&!b.formatRole).text,result.sections[1].text);
   assert.deepEqual(blocks.filter(b=>b.kind==='photos').flatMap(b=>b.assetIds),photos.map(a=>a.id));
  }
 }
 const none=completionBlocks({...p,completionTemplates:[]},photos,result,COMPLETION_FORMAT);assert(!none.some(b=>['point','pointBody'].includes(b.formatRole)));
 const duplicate={...p,completionTemplates:[slot('old','거실',false),slot('new','거실')]};assert.deepEqual(completionPointSpaces(duplicate),['거실']);assert.equal(completionBlocks(duplicate,photos,result,COMPLETION_FORMAT).filter(b=>b.formatRole==='point').length,1);
});

test('실제 원고 생성 경로에 선택된 공간만 전달하고 AI가 반환한 미사용 포인트도 본문에 넣지 않는다',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-points-')),store=new Store(dir);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
 const p=store.createProject('completion');store.updateProject(p.id,{original:{...p.original,name:'테스트 현장'},keywords:[],completionTemplates:[slot('living','거실'),slot('kitchen','주방',false)]});
 store.put('style','completion',{rules:'카페 마감의 서식을 사용합니다.',status:'edited',referenceUrls:[],formatProfile:COMPLETION_FORMAT});for(const photo of photos)store.put('asset',photo.id,{...photo,projectId:p.id});
 const ai=new AI(store,{},{},{});ai.analyzeMaterials=async()=>{};ai.call=async(instructions,content)=>{assert.match(instructions,/pointSpaces에 없는 공간은 points를 반드시 빈 배열/);assert.deepEqual(JSON.parse(content[0].text).pointSpaces,['거실']);return structuredClone(result);};
 ai.planWork=async()=>({signature:'points-fixture',items:['거실','주방'].map((space,i)=>({id:'work-'+i,space,item:'확인된 시공',sourceIds:['manual'],photoIds:[]})),warnings:[]});ai.checkWork=async()=>({checks:[],issues:[],warnings:[],missing:[]});
 const {project}=await ai.generate(p.id,()=>{});assert.deepEqual(project.blocks.filter(b=>b.formatRole==='point').map(b=>b.space),['거실']);assert.equal(project.blocks.find(b=>b.kind==='text'&&b.space==='주방'&&!b.formatRole).text,result.sections[1].text);
});

test('한 PSD를 여러 자리에 적용하고 체크 해제·공간 변경·기존 미사용 본문 저장을 API로 반영한다',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-duplicate-')),runtime=await createServer({dataDir:dir,port:0});t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});const {request}=await localApi(runtime.url);let p=await request('/projects','POST',{postType:'completion'});
 const canvas=createCanvas(100,100);canvas.getContext('2d').fillStyle='#ddccaa';canvas.getContext('2d').fillRect(0,0,100,100);const form=new FormData();form.append('file',new Blob([writePsdBuffer({width:100,height:100,canvas,children:[{name:'원본 배경',canvas}]})]),'공사범위.psd');const psd=await request(`/projects/${p.id}/assets?role=template`,'POST',form);
 p=runtime.store.get('project',p.id);const templates=[{...slot('living','거실'),templateId:psd.id},{...slot('kitchen','주방'),templateId:psd.id}];p=await request(`/projects/${p.id}`,'PUT',{...p,completionTemplates:templates,keywords:[]});await runtime.templates.render(p.id,()=>{});p=runtime.store.get('project',p.id);
 const outputs=runtime.store.assets(p.id).filter(a=>a.templateOutput==='completion');assert.equal(outputs.length,2);assert.notEqual(outputs[0].id,outputs[1].id);assert.equal(runtime.store.assets().filter(a=>a.role==='template').length,1);
 p=await request(`/projects/${p.id}`,'PUT',{...p,blocks:completionBlocks(p,runtime.store.assets(p.id),result,COMPLETION_FORMAT)});const full=p.blocks;
 p=await request(`/projects/${p.id}`,'PUT',{...p,completionTemplates:templates.map(s=>s.space==='주방'?{...s,enabled:false}:s)});assert.deepEqual(p.blocks.filter(b=>b.formatRole==='point').map(b=>b.space),['거실']);assert.equal(p.blocks.find(b=>b.kind==='text'&&b.space==='주방'&&!b.formatRole).text,result.sections[1].text);assert(runtime.store.get('asset',outputs.find(a=>a.templateSlotId==='kitchen').id).excluded);
 p=await request(`/projects/${p.id}`,'PUT',{...p,completionTemplates:p.completionTemplates.map(s=>({...s,enabled:false})),blocks:full});assert(!p.blocks.some(b=>['point','pointBody'].includes(b.formatRole)));
 const ordinary=p.blocks; p=await request(`/projects/${p.id}`,'PUT',{...p,blocks:[...ordinary,...full.filter(b=>['point','pointBody'].includes(b.formatRole))]});assert.deepEqual(p.blocks,ordinary);
 p=await request(`/projects/${p.id}`,'PUT',{...p,completionTemplates:[{...templates[0],space:'안방'}],blocks:full});assert(!p.blocks.some(b=>['point','pointBody'].includes(b.formatRole)));
});

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {writePsdBuffer} from 'ag-psd';import {createCanvas,loadImage} from '@napi-rs/canvas';
import {readCompletionTemplate,compileCompletionTemplate,renderCompletionLayout} from '../server/completion-templates.mjs';
import {Jobs} from '../server/jobs.mjs';
import {renderCompletionImage} from '../server/completion-worker.mjs';
import {completionSignature} from '../shared/completion-templates.mjs';import {newProject,draftWarnings} from '../shared/domain.mjs';
import {createServer} from '../server/index.mjs';import {localApi} from '../scripts/local-api.mjs';

function source(blendMode='normal'){
  const canvas=createCanvas(320,160),base=createCanvas(80,80),sample=createCanvas(80,80);base.getContext('2d').beginPath();base.getContext('2d').arc(40,40,39,0,Math.PI*2);base.getContext('2d').fill();sample.getContext('2d').fillStyle='red';sample.getContext('2d').fillRect(0,0,80,80);
  const board=(left,name)=>({name,artboard:{rect:{left,top:0,right:left+150,bottom:150}},children:[{name:'사진 클리핑',left:left+20,top:20,canvas:base,blendMode},{name:'원본 예시 사진',left:left+20,top:20,canvas:sample,clipping:true}]});
  return writePsdBuffer({width:320,height:160,canvas,children:[board(0,'세로형'),board(170,'정방형')]});
}
async function temp(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-completion-psd-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('PSD의 모든 아트보드를 분리하고 클리핑마스크 밖은 보존하며 예시 사진은 복제하지 않는다',async t=>{
  assert.throws(()=>readCompletionTemplate(source('multiply')),/일반 혼합/);
  const dir=await temp(t),folder=path.join(dir,'template');await fs.mkdir(folder);const layouts=await compileCompletionTemplate(readCompletionTemplate(source()),folder,'표지.psd');
  assert.equal(layouts.length,2);assert.deepEqual(layouts.map(l=>l.elements.filter(e=>e.kind==='photo').length),[1,1]);assert(!layouts.some(l=>l.elements.some(e=>e.name==='원본 예시 사진')));
  const p=newProject('p','completion'),slot={id:'s',templateId:'template',position:'cover',space:'거실',text:'',photoIds:[]},template={id:'template',layouts};
  const blank=await renderCompletionLayout(template,slot,p,[],rel=>path.join(dir,rel));assert.equal(blank.missing.length,1);
  const picture=createCanvas(200,80),c=picture.getContext('2d');c.fillStyle='red';c.fillRect(0,0,100,80);c.fillStyle='blue';c.fillRect(100,0,100,80);await fs.writeFile(path.join(dir,'photo.png'),picture.toBuffer('image/png'));
  const assets=[{id:'photo',projectId:'p',role:'photo',originalPath:'photo.png',status:'ready',hash:'original'}],id=layouts[0].elements[0].id,edited={...slot,edits:{[id]:{photoId:'photo',cropX:-100}}};
  const output=await renderCompletionLayout(template,edited,p,assets,rel=>path.join(dir,rel)),image=await loadImage(output.buffer),result=createCanvas(150,150),ctx=result.getContext('2d');ctx.drawImage(image,0,0);const pixel=(x,y)=>[...ctx.getImageData(x,y,1,1).data];
  assert.equal(output.missing.length,0);assert(pixel(60,60)[2]>220);assert(pixel(21,21).slice(0,3).every(n=>n>235));
  const replacement=await renderCompletionLayout({...template,layouts:layouts.map(l=>({...l,elements:l.elements.map(e=>({...e,kind:'image'}))}))},edited,p,assets,rel=>path.join(dir,rel));ctx.drawImage(await loadImage(replacement.buffer),0,0);assert(pixel(60,60)[2]>220);assert(pixel(21,21).slice(0,3).every(n=>n>235));
  const signature=completionSignature(edited,assets);assert.notEqual(completionSignature({...edited,edits:{[id]:{photoId:'photo',cropX:100}}},assets),signature);assert.notEqual(completionSignature(edited,[{...assets[0],hash:'changed'}]),signature);
  const moved=await renderCompletionLayout(template,{...edited,layoutId:layouts[1].id,edits:{[layouts[1].elements[0].id]:{photoId:'photo'}},overlays:[{id:'extra',text:'',x:0,y:0,width:15,height:15,fontSize:12,backgroundColor:'#00ff00'}]},p,assets,rel=>path.join(dir,rel));ctx.drawImage(await loadImage(moved.buffer),0,0);assert(pixel(5,5)[1]>235&&pixel(5,5)[0]<25);
});
test('실제 API에서 사진 선택·레이어 편집·JPG·자동 표지 삽입과 경계 검사를 확인한다',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-completion-api-')),runtime=await createServer({dataDir:dir,port:0});t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});const {request}=await localApi(runtime.url);let p=await request('/projects','POST',{postType:'completion'});
  const form=new FormData();form.append('file',new Blob([source()]),'마감 표지.psd');const template=await request(`/projects/${p.id}/assets?role=template`,'POST',form);assert.equal(template.layouts.length,2);
  p=runtime.store.get('project',p.id);const originalSlot=p.completionTemplates.find(s=>s.templateId===template.id);p=await request(`/projects/${p.id}`,'PUT',{...p,original:{...p.original,name:'새 현장'},title:'테스트',blocks:[{id:'intro',kind:'text',text:'본문'}],keywords:[]});
  runtime.auth.status=()=>({connected:true});let generated=false;runtime.ai.generate=async()=>{generated=true;return {project:runtime.store.get('project',p.id)};};
  const blocked=await request(`/projects/${p.id}/tasks/generate`,'POST',{expectedRevision:p.revision});while(runtime.jobs.active.has(blocked.id))await new Promise(r=>setImmediate(r));assert.equal(runtime.store.get('job',blocked.id).status,'failed');assert.match(runtime.store.get('job',blocked.id).message,/수정 변경하기/);assert.equal(generated,false);
  await runtime.templates.render(p.id,()=>{},{slotId:originalSlot.id});let output=runtime.store.assets(p.id).find(a=>a.templateSlotId===originalSlot.id);assert.equal(output.excluded,true);assert.equal(output.templateIncomplete.length,1);assert(!runtime.store.get('project',p.id).coverAssetId);
  const photoCanvas=createCanvas(180,180);photoCanvas.getContext('2d').fillStyle='#0066cc';photoCanvas.getContext('2d').fillRect(0,0,180,180);const photoForm=new FormData();photoForm.append('file',new Blob([photoCanvas.toBuffer('image/jpeg')]),'원본.jpg');const photo=await request(`/projects/${p.id}/assets?role=template-photo`,'POST',photoForm);await runtime.assets.queue;assert.equal(photo.role,'template-photo');
  p=runtime.store.get('project',p.id);const slot={...originalSlot,layoutId:template.layouts[0].id,edits:{[template.layouts[0].elements[0].id]:{photoId:photo.id,zoom:1.5,cropY:40}}};p=await request(`/projects/${p.id}`,'PUT',{...p,completionTemplates:p.completionTemplates.map(s=>s.id===slot.id?slot:s)});
  await runtime.templates.render(p.id,()=>{},{slotId:slot.id});p=runtime.store.get('project',p.id);output=runtime.store.assets(p.id).find(a=>a.templateSlotId===slot.id);assert.equal(output.excluded,false);assert.equal(p.coverAssetId,output.id);const preview=await loadImage(await fs.readFile(runtime.assets.resolve(output.previewPath)));assert.equal(preview.width,150);assert.equal(preview.height,150);assert.equal(output.previewBytes,(await fs.stat(runtime.assets.resolve(output.previewPath))).size);assert.equal(p.blocks[0].assetIds[0],output.id);assert.equal(output.templateSignature,completionSignature(slot,runtime.store.assets(p.id)));assert(!draftWarnings(p,runtime.store.assets(p.id)).some(w=>w.includes('변경 내용을 적용하고')));
  const ready=await request(`/projects/${p.id}/tasks/generate`,'POST',{expectedRevision:p.revision});while(runtime.jobs.active.has(ready.id))await new Promise(r=>setImmediate(r));assert.equal(runtime.store.get('job',ready.id).status,'completed');assert.equal(generated,true);
  const foreign=runtime.store.createProject();runtime.store.put('asset','foreign',{id:'foreign',projectId:foreign.id,role:'photo'});
  for(const replacement of [{layoutId:'other'}, {edits:{missing:{text:'bad'}}},{edits:{[template.layouts[0].elements[0].id]:{photoId:'foreign'}}},{edits:{[template.layouts[0].elements[0].id]:{zoom:100}}}])await assert.rejects(request(`/projects/${p.id}`,'PUT',{...p,completionTemplates:[{...slot,...replacement}]}));
  const saved=runtime.store.get('project',p.id);assert.equal(saved.completionTemplates.find(s=>s.id===slot.id).edits[template.layouts[0].elements[0].id].cropY,40);
  const fresh=await request('/projects','POST',{postType:'completion'});assert.equal(fresh.completionTemplates.find(s=>s.position==='cover').templateId,template.id);
});

test('분리한 PSD 처리 실패는 원래 오류로 반환하고 다음 작업을 막지 않는다',async()=>{
  for(let i=0;i<2;i++)await assert.rejects(renderCompletionImage({template:{layouts:[]},slot:{photoIds:[]},project:{},assets:[],root:os.tmpdir(),edge:1024}),error=>error.status===400&&/레이아웃/.test(error.message));
});

test('사용하지 않는 템플릿은 원고에서 빠지고 원본 템플릿은 수정 없이 생성하며 순서·재선택을 저장한다',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-completion-toggle-')),runtime=await createServer({dataDir:dir,port:0});t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});const {request}=await localApi(runtime.url);let p=await request('/projects','POST',{postType:'completion'});
 const canvas=createCanvas(180,180),c=canvas.getContext('2d');c.fillStyle='#ddccaa';c.fillRect(0,0,180,180);const bytes=writePsdBuffer({width:180,height:180,canvas,children:[{name:'기존 안내문',canvas}]}),form=new FormData();form.append('file',new Blob([bytes]),'공사범위.psd');const template=await request(`/projects/${p.id}/assets?role=template`,'POST',form);
 p=runtime.store.get('project',p.id);const original=p.completionTemplates.find(s=>s.templateId===template.id),unused={...original,id:'unused',name:'미사용 시공 전후',position:'beforeAfter',enabled:false};p=await request(`/projects/${p.id}`,'PUT',{...p,original:{...p.original,name:'테스트'},completionTemplates:[original,unused]});runtime.auth.status=()=>({connected:true});let generated=0;runtime.ai.generate=async()=>{generated++;return {project:runtime.store.get('project',p.id)};};
 const job=await request(`/projects/${p.id}/tasks/generate`,'POST',{expectedRevision:p.revision});while(runtime.jobs.active.has(job.id))await new Promise(r=>setImmediate(r));assert.equal(runtime.store.get('job',job.id).status,'completed');assert.equal(generated,1);const output=runtime.store.assets(p.id).find(a=>a.templateSlotId===original.id);assert(output&&!output.excluded);assert(!runtime.store.assets(p.id).some(a=>a.templateSlotId===unused.id));
 p=runtime.store.get('project',p.id);p=await request(`/projects/${p.id}`,'PUT',{...p,title:'원고',blocks:[{id:'image',kind:'photos',space:'공사범위',assetIds:[output.id]},{id:'intro',kind:'text',formatRole:'intro',text:'인사말'}],completionTemplates:[{...unused},{...original,enabled:false}]});assert(runtime.store.get('asset',output.id).excluded);assert(!p.blocks.some(b=>b.assetIds?.includes(output.id)));assert(!draftWarnings(p,runtime.store.assets(p.id)).some(w=>w.includes('변경 내용을 적용하고')));
 const stale=p;p=await request(`/projects/${p.id}`,'PUT',{...p,completionTemplates:[unused,{...original,enabled:true}]});assert(!runtime.store.get('asset',output.id).excluded);assert.equal(runtime.store.get('asset',output.id).order,1);assert(p.blocks.some(b=>b.assetIds?.includes(output.id)));await assert.rejects(request(`/projects/${p.id}`,'PUT',{...stale,completionTemplates:[original,unused]}),/다른 화면/);assert.equal(runtime.store.get('asset',output.id).order,1);
});
test('PSD 처리 중단은 자식 작업을 중단하고 취소 상태로 남긴다',async()=>{
  const records=new Map(),jobs=new Jobs({put:(_,id,value)=>records.set(id,structuredClone(value))}),started=Promise.withResolvers();
  const job=jobs.start('test','templates',()=>{const pending=renderCompletionImage({template:{layouts:[]},slot:{photoIds:[]},project:{},assets:[],root:os.tmpdir(),edge:1024});started.resolve();return pending;});
  await started.promise;jobs.cancel(job.id);while(jobs.active.has(job.id))await new Promise(resolve=>setImmediate(resolve));
  assert.equal(records.get(job.id).status,'cancelled');assert.match(records.get(job.id).message,/중단/);
});

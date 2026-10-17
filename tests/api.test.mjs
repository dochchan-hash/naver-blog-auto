import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createServer} from '../server/index.mjs';

test('실제 API에서 저장·전송·원본 조회와 요청 보호를 확인한다',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemonhouse-api-'));const runtime=await createServer({dataDir:path.join(dir,'.local'),port:0});t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  const init=await fetch(`${runtime.url}/api/bootstrap`),data=await init.json();const cookie=init.headers.get('set-cookie').split(';')[0];const headers={cookie,'X-Lemon-CSRF':data.csrf,'Content-Type':'application/json',Origin:runtime.url};const p=data.projects[0];
  let res=await fetch(`${runtime.url}/api/projects/${p.id}`,{method:'PUT',headers,body:JSON.stringify({...p,target:{...p.target,name:'시험 추천 현장'}})});assert.equal(res.status,200);const saved=await res.json();assert.equal(saved.revision,1);
  res=await fetch(`${runtime.url}/api/projects/${p.id}`,{method:'PUT',headers,body:JSON.stringify(p)});assert.equal(res.status,409);
  res=await fetch(`${runtime.url}/api/projects`,{method:'POST',headers:{...headers,'X-Lemon-CSRF':'wrong'},body:'{}'});assert.equal(res.status,403);
  res=await fetch(`${runtime.url}/api/projects`,{method:'POST',headers:{...headers,Origin:'https://external.invalid'},body:'{}'});assert.equal(res.status,403);
  const bytes=await sharp({create:{width:2000,height:1200,channels:3,background:'#dddddd'}}).jpeg().toBuffer();const form=new FormData();form.append('file',new Blob([bytes],{type:'image/jpeg'}),'현장 사진.jpg');
  res=await fetch(`${runtime.url}/api/projects/${p.id}/assets?role=photo`,{method:'POST',headers:{cookie,'X-Lemon-CSRF':data.csrf,Origin:runtime.url},body:form});assert.equal(res.status,201);const asset=await res.json();await runtime.assets.queue;
  res=await fetch(`${runtime.url}${asset.originalUrl}`,{headers:{cookie}});assert.deepEqual(Buffer.from(await res.arrayBuffer()),bytes);
  res=await fetch(`${runtime.url}/api/assets/${asset.id}/preview`,{headers:{cookie}});assert.equal(res.status,200);assert.equal((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width,1024);
  const ready=runtime.store.get('asset',asset.id);runtime.store.put('asset',asset.id,{...ready,pages:[{page:1,imagePath:ready.previewPath}]});
  res=await fetch(`${runtime.url}/api/assets/${asset.id}/page/1`,{headers:{cookie}});assert.equal(res.status,200);assert.equal((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width,1024);
  res=await fetch(`${runtime.url}/api/assets/${asset.id}/page/2`,{headers:{cookie}});assert.equal(res.status,404);
  const before=runtime.store.get('asset',asset.id);res=await fetch(`${runtime.url}/api/assets/batch`,{method:'PATCH',headers,body:JSON.stringify([{id:asset.id,space:'거실'},{id:'missing',space:'주방'}])});assert.equal(res.status,404);assert.equal(runtime.store.get('asset',asset.id).space,before.space);
  const foreign=runtime.store.createProject();res=await fetch(`${runtime.url}/api/projects/${foreign.id}`,{method:'PUT',headers,body:JSON.stringify({...foreign,blocks:[{id:'block',kind:'photos',assetIds:[asset.id]}]})});assert.equal(res.status,400);
  res=await fetch(`${runtime.url}/api/projects/${p.id}/tasks/generate`,{method:'POST',headers,body:'{}'});assert.equal(res.status,401);assert.equal(runtime.store.get('project',p.id).blocks.length,0);
});

test('선택한 타입·도면·자료 처리 방식은 저장 후 복구되고 다른 현장의 도면은 거부한다',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemonhouse-types-'));const runtime=await createServer({dataDir:dir,port:0});t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  const init=await fetch(runtime.url+'/api/bootstrap'),data=await init.json(),cookie=init.headers.get('set-cookie').split(';')[0];const headers={cookie,'X-Lemon-CSRF':data.csrf,'Content-Type':'application/json',Origin:runtime.url};let p=data.projects[0];
  runtime.store.put('asset','plan',{id:'plan',projectId:p.id,role:'floorplan-original'});
  const details={name:'조회 단지',region:'창원',url:'https://fin.land.naver.com/complexes/25924',text:'네이버 단지 정보',types:['119.98A㎡','120.1C㎡'],images:[],supplyArea:'120.1',exclusiveArea:'84.99',selectedType:'120.1C㎡',notice:'타입 확인'};
  p={...p,original:{...p.original,...details,type:'120.1C㎡',sourceUrl:details.url,details,floorplanAssetId:'plan'},facts:[{id:'fact',space:'거실',item:'강마루',sourceLabel:'공사범위',confirmed:false,uncertain:false}],sourceReview:{signature:'stored',checkedAt:'2026-10-05',cafeFacts:[{space:'거실',item:'타일',evidence:'타일',uncertain:false}],conflicts:[{id:'conflict',space:'거실',topic:'바닥',constructionFactIds:['fact'],cafeFactIndexes:[0],reason:'자재 차이',decision:'exclude',customText:''}],warnings:[]}};
  let res=await fetch(runtime.url+`/api/projects/${p.id}`,{method:'PUT',headers,body:JSON.stringify(p)});assert.equal(res.status,200);p=await res.json();
  const reopened=(await (await fetch(runtime.url+'/api/bootstrap',{headers:{cookie}})).json()).projects.find(x=>x.id===p.id);assert.equal(reopened.original.type,'120.1C㎡');assert.equal(reopened.original.details.types.length,2);assert.equal(reopened.original.floorplanAssetId,'plan');assert.equal(reopened.sourceReview.conflicts[0].decision,'exclude');
  res=await fetch(runtime.url+`/api/projects/${p.id}`,{method:'PUT',headers,body:JSON.stringify({...p,target:{...p.target,floorplanAssetId:'plan'}})});assert.equal(res.status,400);
  const wrong=structuredClone(p);wrong.sourceReview.conflicts[0].cafeFactIndexes=[5];res=await fetch(runtime.url+`/api/projects/${p.id}`,{method:'PUT',headers,body:JSON.stringify(wrong)});assert.equal(res.status,400);
});

test('네이버 준비는 화면에서 저장한 버전과 일치하는 원고의 수정 순서를 사용한다',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemonhouse-revision-')),changes=[],runtime=await createServer({dataDir:dir,port:0,bridge:{},onJob:job=>changes.push(job)});
  t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  const init=await fetch(runtime.url+'/api/bootstrap'),data=await init.json(),cookie=init.headers.get('set-cookie').split(';')[0],headers={cookie,'X-Lemon-CSRF':data.csrf,'Content-Type':'application/json',Origin:runtime.url},p=data.projects[0];
  const blocks=[{id:'quote',kind:'quote',text:'현관',space:'현관'},{id:'intro',kind:'text',text:'직접 옮긴 도입'},{id:'description',kind:'text',space:'현관',text:'직접 수정한 설명'},{id:'divider',kind:'divider'}];
  const response=await fetch(runtime.url+`/api/projects/${p.id}`,{method:'PUT',headers,body:JSON.stringify({...p,blocks})}),saved=await response.json();assert.equal(response.status,200);
  let received;runtime.naver.publish=async id=>{received=runtime.store.get('project',id);return {prepared:true};};
  const prepare=expectedRevision=>fetch(runtime.url+`/api/projects/${p.id}/tasks/prepare`,{method:'POST',headers,body:JSON.stringify({expectedRevision})});
  let result=await prepare(p.revision);assert.equal(result.status,409);assert.equal(received,undefined);assert.match((await result.json()).error,/저장된 원고가 일치하지/);
  result=await prepare(saved.revision);assert.equal(result.status,202);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(received.blocks,blocks);assert.equal(received.revision,saved.revision);assert.equal(changes.at(-1).status,'completed');
});

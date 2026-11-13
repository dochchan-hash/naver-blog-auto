import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {AI} from '../server/ai.mjs';
import {createServer} from '../server/index.mjs';
import {SPACES,photoSpaces,spaceLabel,photoLayoutBlocks} from '../shared/domain.mjs';
import sharp from 'sharp';

test('추가 공간을 포함해 사진을 분석하고 분석 도중 수정한 공간·묶음을 보존한다',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-updates-')),store=new Store(dir);
  t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
  assert.deepEqual(SPACES,['현관','거실','주방','보조주방','주방베란다','안방','안방욕실','작은방1','작은방2','공용욕실','작은방3','파우더룸','거실베란다','2층','기타']);
  const p=store.createProject();
  const photo={id:'photo',projectId:p.id,role:'photo',status:'ready',space:'미분류',hash:'one',filename:'작은방2.jpg',group:''};store.put('asset',photo.id,photo);
  const ai=new AI(store,{}, {imageData:async()=> 'data:image/jpeg;base64,AA'},{});
  ai.call=async()=>({space:'작은방2',description:'밝은 작은방',uncertain:false});
  await ai.analyzeAsset(photo);assert.equal(store.get('asset','photo').space,'작은방2');
  store.put('asset','photo',{...photo,hash:'two'});
  ai.call=async()=>{store.put('asset','photo',{...store.get('asset','photo'),space:'안방',spaceManual:true,group:'user-group'});return {space:'작은방1',description:'방',uncertain:true};};
  await ai.analyzeAsset(store.asset('photo'));
  assert.equal(store.get('asset','photo').space,'안방');assert.equal(store.get('asset','photo').group,'user-group');
});

test('보관함 제목 수정·삭제와 링크 변경 초기화를 API에서 검증한다',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-updates-api-')),runtime=await createServer({dataDir:dir,port:0});
  t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  const init=await fetch(runtime.url+'/api/bootstrap'),data=await init.json();
  const headers={cookie:init.headers.get('set-cookie').split(';')[0],'X-Lemon-CSRF':data.csrf,'Content-Type':'application/json'};
  const p=data.projects[0];let res=await fetch(runtime.url+`/api/projects/${p.id}`,{method:'PUT',headers,body:JSON.stringify({...p,name:'수정한 보관함 제목'})});assert.equal(res.status,200);assert.equal((await res.json()).name,'수정한 보관함 제목');
  runtime.auth.status=()=>({connected:true,models:[]});
  runtime.ai.call=async()=>({space:'안방욕실',description:'안방에 연결된 욕실',uncertain:false});
  const photoBytes=await sharp({create:{width:64,height:64,channels:3,background:'#dddddd'}}).jpeg().toBuffer(),form=new FormData();
  form.append('file',new Blob([photoBytes],{type:'image/jpeg'}),'안방욕실.jpg');
  const uploadHeaders={cookie:headers.cookie,'X-Lemon-CSRF':data.csrf};
  res=await fetch(runtime.url+`/api/projects/${p.id}/assets?role=photo`,{method:'POST',headers:uploadHeaders,body:form});assert.equal(res.status,201);const photo=await res.json();
  await runtime.assets.queue;await runtime.ai.photoQueue;assert.equal(runtime.store.asset(photo.id).space,'안방욕실');
  res=await fetch(runtime.url+'/api/assets/batch',{method:'PATCH',headers,body:JSON.stringify([{id:photo.id,space:'공용욕실'}])});assert.equal(res.status,200);assert.equal(runtime.store.asset(photo.id).spaceManual,true);
  runtime.store.put('asset','attached',{id:'attached',projectId:p.id,role:'photo',space:'거실'});
  res=await fetch(runtime.url+`/api/projects/${p.id}`,{method:'DELETE',headers});assert.equal(res.status,200);assert.equal(runtime.store.get('project',p.id),null);assert.equal(runtime.store.get('asset','attached'),null);assert.equal(runtime.store.list('project').length,1);
  runtime.store.put('style','main',{name:'스타일',rules:'저장된 규칙',status:'analyzed',referenceUrls:['https://blog.naver.com/ref/123'],analyzedAt:'old',referenceEvidence:[{url:'old'}]});
  res=await fetch(runtime.url+'/api/style',{method:'PUT',headers,body:JSON.stringify({name:'스타일',rules:'저장된 규칙',referenceUrls:['https://blog.naver.com/ref/456']})});assert.equal(res.status,200);const style=await res.json();assert.equal(style.status,'reference');assert.equal(style.analyzedAt,undefined);assert.equal(style.referenceEvidence,undefined);
});

test('추천글·시공사례·마감 모두 추가 공간을 저장·분석하고 원고 사진 배치에 유지한다',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-spaces-')),runtime=await createServer({dataDir:dir,port:0});
  t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  const init=await fetch(runtime.url+'/api/bootstrap'),data=await init.json(),headers={cookie:init.headers.get('set-cookie').split(';')[0],'X-Lemon-CSRF':data.csrf,Origin:runtime.url,'Content-Type':'application/json'};
  const added=['보조주방','주방베란다','작은방3','파우더룸','거실베란다','2층','기타'];
  assert.deepEqual(added.map(spaceLabel),['보조주방','주방베란다','작은방3','안방 파우더룸','거실 베란다','2층','기타']);
  runtime.assets.imageData=async()=> 'data:image/jpeg;base64,AA';
  for(const type of ['recommendation','case','completion']){
    const p=runtime.store.createProject(type),spaces=photoSpaces(p);
    assert.equal(new Set(spaces).size,spaces.length);
    for(const [order,space]of added.entries()){
      assert(spaces.includes(space));
      const id=type+'-'+order;
      runtime.store.put('asset',id,{id,projectId:p.id,role:'photo',status:'ready',space:'거실',order,hash:id,filename:space+'.jpg',excluded:false,group:''});
      const res=await fetch(runtime.url+'/api/assets/batch',{method:'PATCH',headers,body:JSON.stringify([{id,space}])});
      assert.equal(res.status,200);assert.equal(runtime.store.asset(id).space,space);
      runtime.ai.call=async(_,__,options)=>options.schema.parse({space,description:'확인한 공간',uncertain:false});
      await runtime.ai.analyzeAsset(runtime.store.asset(id));
      assert.equal(runtime.store.asset(id).space,space);
    }
    const assets=runtime.store.assets(p.id),blocks=photoLayoutBlocks({...p,blocks:[{id:'closing',kind:'text',formatRole:'closing',text:'마무리'}]},assets);
    assert.deepEqual(blocks.filter(b=>b.kind==='photos').flatMap(b=>b.assetIds).sort(),assets.map(a=>a.id).sort());
    for(const space of added)assert(blocks.some(b=>b.space===space&&['heading','quote'].includes(b.kind)));
  }
});

test('네이버 연결 확인이 끝나지 않아도 완료된 작업 상태를 조회한다',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-updates-poll-'));
  const runtime=await createServer({dataDir:dir,port:0,bridge:{status:()=>new Promise(()=>{})}});
  t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  runtime.store.put('job','done',{id:'done',status:'completed',projectId:runtime.store.list('project')[0].id});
  const response=await fetch(runtime.url+'/api/bootstrap',{signal:AbortSignal.timeout(2000)});assert.equal(response.status,200);assert.equal((await response.json()).jobs[0].status,'completed');
});

test('읽지 못한 참고 링크는 이전 분석을 성공으로 덮어쓰지 않는다',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-updates-style-')),store=new Store(dir);
  t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
  store.put('style','main',{name:'스타일',rules:'기존 규칙',status:'reference',referenceUrls:['https://blog.naver.com/ref/123']});
  const ai=new AI(store,{}, {},{readPost:async()=>({text:''})});
  ai.call=async()=>{throw new Error('빈 원문으로 AI를 호출하면 안 됩니다.');};
  await assert.rejects(ai.analyzeStyle(()=>{}),/본문을 충분히 읽지 못했습니다/);assert.equal(store.get('style','main').status,'reference');
});

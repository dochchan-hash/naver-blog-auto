import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createServer} from '../server/index.mjs';
import {localApi} from '../scripts/local-api.mjs';
import {photoGroups} from '../shared/domain.mjs';

async function setup(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-photo-groups-')),runtime=await createServer({dataDir:dir,port:0});
 t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
 return {...runtime,...await localApi(runtime.url)};
}

test('세 콘텐츠의 최초 업로드 분류와 수동 분석 모두 같은 공간을 순서대로 자동 묶고 재분석은 편집값을 보존한다',async t=>{
 const r=await setup(t),groups=[];r.auth.status=()=>({connected:true});let calls=0;
 r.ai.call=async(_,content,{schema})=>{calls++;return schema.parse({space:content.at(-1).text.includes('주방')?'주방':'거실',description:'확인한 공간',uncertain:false});};
 const bytes=await sharp({create:{width:32,height:32,channels:3,background:'#cccccc'}}).jpeg().toBuffer();
 for(const postType of ['recommendation','case','completion']){
  const p=await r.request('/projects','POST',{postType}),names=['거실1','주방1','거실2','거실3','주방2'],ids=[];
  for(const name of names){const form=new FormData();form.append('file',new Blob([bytes,postType+name]),name+'.jpg');const a=await r.request(`/projects/${p.id}/assets?role=photo&classify=${postType==='case'?'false':'true'}`,'POST',form);ids.push(a.id);}
  await r.assets.queue;await r.ai.photoQueue;if(postType==='case')await r.ai.analyzeMaterials(p.id,()=>{});
  const all=r.store.assets(p.id),grouped=photoGroups(all);
  assert.equal(grouped.length,2);assert.deepEqual(grouped.map(g=>g.assets.map(a=>a.filename)),[['거실1.jpg','거실2.jpg','거실3.jpg'],['주방1.jpg','주방2.jpg']]);
  assert.deepEqual([...all].sort((a,b)=>a.order-b.order).map(a=>a.id),ids);groups.push(grouped[0].assets[0].group);
  await r.request('/assets/batch','PATCH',[{id:ids[2],group:'',order:20},{id:ids[4],space:'안방',group:''}]);
  const snapshot=JSON.stringify(r.store.assets(p.id)),priorCalls=calls;
  for(const id of ids)await r.ai.analyzeAsset(r.store.asset(id));
  assert.equal(JSON.stringify(r.store.assets(p.id)),snapshot);assert.equal(calls,priorCalls);assert.equal(r.store.asset(ids[2]).group,'');assert.equal(r.store.asset(ids[4]).space,'안방');
 }
 assert.equal(new Set(groups).size,3);
});

test('분류 도중 선택한 단독 배치·순서·공간과 기존 묶음·제외 사진·템플릿 원본은 자동 묶음에서 보존한다',async t=>{
 const r=await setup(t),p=r.store.createProject('completion');r.assets.imageData=async()=> 'data:image/jpeg;base64,AA';
 const photo=(id,patch={})=>{const value={id,projectId:p.id,role:'photo',status:'ready',space:'미분류',hash:id,filename:id+'.jpg',group:'',order:0,excluded:false,...patch};r.store.put('asset',id,value);return r.store.asset(id);};
 let finish,started;const ready=new Promise(resolve=>started=resolve);
 r.ai.call=async()=>{started();return new Promise(resolve=>finish=resolve);};
 const pending=r.ai.analyzeAsset(photo('pending'));await ready;
 await r.request('/assets/batch','PATCH',[{id:'pending',group:'',order:12}]);finish({space:'거실',description:'사진',uncertain:false});await pending;
 assert.equal(r.store.asset('pending').space,'거실');assert.equal(r.store.asset('pending').group,'');assert.equal(r.store.asset('pending').order,12);assert.equal(r.store.asset('pending').layoutManual,true);
 r.ai.call=async()=>({space:'거실',description:'사진',uncertain:false});
 const manual=photo('manual');await r.request('/assets/batch','PATCH',[{id:manual.id,space:'안방'}]);await r.ai.analyzeAsset(manual);assert.equal(r.store.asset('manual').space,'안방');assert.equal(r.store.asset('manual').group,'');
 for(const [id,patch]of [['grouped',{group:'user-group'}],['excluded',{excluded:true}],['existing',{space:'거실',analysis:{space:'거실',description:'기존 분석'}}]]){
  const a=photo(id,patch);await r.ai.analyzeAsset(a);assert.equal(r.store.asset(id).group,a.group);assert.equal(r.store.asset(id).order,a.order);
 }
 const source=photo('source');r.ai.call=async()=>{r.store.put('asset',source.id,{...r.store.get('asset',source.id),role:'template-photo'});return {space:'거실',description:'사진',uncertain:false};};
 await r.ai.analyzeAsset(source);assert.equal(r.store.asset(source.id).role,'template-photo');assert.equal(r.store.asset(source.id).group,'');
});

test('미리보기 처리 도중 직접 바꾼 분류·배치 표시도 보존해 첫 분석이 덮어쓰지 않는다',async t=>{
 const r=await setup(t),p=r.store.createProject(),id='processing',folder=r.assets.resolve(id);await fs.mkdir(folder);
 await sharp({create:{width:32,height:32,channels:3,background:'#cccccc'}}).jpeg().toFile(path.join(folder,'original.jpg'));
 r.store.put('asset',id,{id,projectId:p.id,role:'photo',mime:'image/jpeg',originalPath:id+'/original.jpg',status:'processing',space:'미분류',group:'',order:0,excluded:false,hash:id});
 const pending=r.assets.process(id);r.store.put('asset',id,{...r.store.get('asset',id),space:'안방',spaceManual:true,layoutManual:true,order:12});await pending;
 assert.equal(r.store.asset(id).status,'ready');assert.equal(r.store.asset(id).spaceManual,true);assert.equal(r.store.asset(id).layoutManual,true);
 r.ai.call=async()=>({space:'거실',description:'사진',uncertain:false});await r.ai.analyzeAsset(r.store.asset(id));
 assert.equal(r.store.asset(id).space,'안방');assert.equal(r.store.asset(id).group,'');assert.equal(r.store.asset(id).order,12);
});

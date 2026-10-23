import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {writePsdBuffer} from 'ag-psd';
import {createCanvas} from '@napi-rs/canvas';
import {createServer} from '../server/index.mjs';
import {localApi} from '../scripts/local-api.mjs';
import {COMPLETION_SPACES,draftWarnings,exportHtml,missingSpaceDescriptions,postLabel,postSite,postSpaces,photoLayoutBlocks} from '../shared/domain.mjs';
import {COMPLETION_FORMAT,blockTextStyles} from '../shared/format.mjs';

async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-cafe-completion-')),runtime=await createServer({dataDir:dir,port:0});
  t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  return {...runtime,...await localApi(runtime.url)};
}
test('마감은 세 번째 종류로 생성하고 기존 추천글·시공사례·스타일을 보존한다',async t=>{
  const {request,store}=await fixture(t),rec=store.list('project')[0],c=await request('/projects','POST',{postType:'case'}),p=await request('/projects','POST',{postType:'completion'});
  assert.equal(postLabel(p),'마감');assert.equal(postSite(p),p.original);assert.deepEqual(postSpaces(p),COMPLETION_SPACES);assert.equal(p.completionTemplates.length,5);
  const init=await request('/bootstrap');assert.equal(init.projects.length,3);assert.equal(init.projects.find(a=>a.id===rec.id).postType,'recommendation');assert.equal(init.projects.find(a=>a.id===c.id).postType,'case');assert.equal(init.completionStyle.referenceUrls.length,2);
  const styles=[init.style,init.caseStyle];await request('/style?postType=completion','PUT',{name:'마감 전용',referenceUrls:['https://cafe.naver.com/fmbsno1/18124'],rules:'마감 전용 규칙'});
  const after=await request('/bootstrap');assert.deepEqual([after.style,after.caseStyle],styles);assert.equal(after.completionStyle.name,'마감 전용');
  await assert.rejects(request('/style?postType=completion','PUT',{name:'잘못된 링크',referenceUrls:['https://blog.naver.com/a/123'],rules:'규칙'}),/네이버 HTTPS/);
  await assert.rejects(request('/style?postType=case','PUT',{name:'시공사례',referenceUrls:['https://cafe.naver.com/fmbsno1/18124'],rules:'규칙'}),/네이버 HTTPS/);
});
test('마감 PSD 여러 개를 원본·미리보기로 보관하고 선택·문구는 저장되며 사진 영역의 오첨부를 거부한다',async t=>{
  const {request,store}=await fixture(t),p=await request('/projects','POST',{postType:'completion'});
  const canvas=createCanvas(320,180);canvas.getContext('2d').fillRect(0,0,320,180);
  const bytes=writePsdBuffer({width:320,height:180,canvas,children:[{name:'새로운 마감 양식',canvas,left:0,top:0}]});
  const upload=async(name,role='template')=>{const form=new FormData();form.append('file',new Blob([bytes],{type:'image/vnd.adobe.photoshop'}),name);return request(`/projects/${p.id}/assets?role=${role}`,'POST',form);};
  const first=await upload('마감 표지.psd'),second=await upload('마감 포인트.psd');
  assert.notEqual(first.id,second.id);assert.equal(first.templateKind,'completion');assert.equal(first.projectId,'completion-templates');assert.equal(first.status,'ready');assert(store.get('asset',first.id).previewPath);assert.equal(store.get('templates','main'),null);
  const current=store.get('project',p.id),slots=current.completionTemplates.map((s,i)=>i? s:{...s,templateId:first.id,text:'현장명 · 수정 문구'});const saved=await request(`/projects/${p.id}`,'PUT',{...current,completionTemplates:slots});assert.equal(saved.completionTemplates[0].text,'현장명 · 수정 문구');
  await assert.rejects(upload('사진이 아닌 PSD.psd','photo'),/PSD/);assert.equal(store.get('project',p.id).completionTemplates.length,5);
  const foreign=store.createProject();store.put('asset','foreign',{id:'foreign',projectId:foreign.id,role:'photo'});
  await assert.rejects(request(`/projects/${p.id}`,'PUT',{...saved,completionTemplates:[{...slots[0],photoIds:['foreign']}]}),/현재 마감글의 사진/);
  await assert.rejects(request(`/projects/${p.id}`,'PUT',{...saved,completionTemplates:[slots[0],slots[0]]}),/중복/);
});
test('카페 참고글 두 편의 서식을 마감 스타일에만 새로 적용한다',async t=>{
  const {ai,store}=await fixture(t),before=store.get('style','main');let read=0;
  ai.browser.readPosts=async urls=>{assert.equal(urls.length,2);assert(urls.every(u=>u.startsWith('https://cafe.naver.com/')));read++;return urls.map(url=>({url,title:'카페 마감 예시',text:'확인한 시공내용',formatProfile:COMPLETION_FORMAT}));};
  await ai.refreshFormat(()=>{},'completion');assert.equal(read,1);assert.equal(store.get('style','completion').formatEvidence.length,2);assert.equal(store.get('style','completion').formatEvidence[0].text,'확인한 시공내용');assert.deepEqual(store.get('style','completion').formatProfile,COMPLETION_FORMAT);assert.deepEqual(store.get('style','main'),before);
});
test('88장 마감 원고는 특수 이미지·모든 공간·번호별 포인트·왼쪽 정렬을 끝까지 유지한다',async t=>{
  const {store,ai}=await fixture(t),p=store.createProject('completion');store.updateProject(p.id,{original:{...p.original,name:'테스트 시공 현장'},keywords:[],manualWork:'거실 천장 간접조명 시공'});
  store.put('style','completion',{name:'마감',referenceUrls:[],rules:'카페 마감',status:'edited',formatProfile:COMPLETION_FORMAT});
  const photoSpaces=['표지','공사범위','시공전후',...COMPLETION_SPACES,'마무리'];
  for(let i=0;i<88;i++){const space=i<photoSpaces.length?photoSpaces[i]:COMPLETION_SPACES[i%COMPLETION_SPACES.length];store.put('asset','photo-'+i,{id:'photo-'+i,projectId:p.id,role:'photo',space,spaceManual:true,order:i,status:'ready',excluded:false,hash:String(i),analysis:{description:'확인한 현장 사진'}});}
  ai.analyzeMaterials=async()=>{};ai.call=async(instructions,content)=>{assert.match(instructions,/네이버 카페 마감/);assert(!instructions.includes('추천드립니다, ~해보세요')); assert.equal(JSON.parse(content[0].text).original.name,'테스트 시공 현장');return {title:'테스트 마감',intro:'완료된 현장을 소개합니다.',sections:COMPLETION_SPACES.map(space=>({space,text:'밝은 마감이 공간에 편안함을 더합니다.',points:space==='거실'?[{title:'간접조명',text:'천장 간접조명으로 은은한 빛을 더했습니다.'}]:[]})),outro:'공간 소개를 마칩니다.\n감사합니다.',tags:['마감'],warnings:[]};};
  const {project}=await ai.generate(p.id,()=>{}),photos=project.blocks.filter(b=>b.kind==='photos').flatMap(b=>b.assetIds);
  assert.equal(photos.length,88);assert.equal(new Set(photos).size,88);assert.deepEqual(missingSpaceDescriptions(project,store.assets(p.id)),[]);assert(!draftWarnings(project,store.assets(p.id)).some(w=>/추천 현장|사진 순서/.test(w)));
  assert.equal(project.blocks.find(b=>b.space==='거실'&&b.kind==='quote').variant,'quotation_line');assert.equal(project.blocks.filter(b=>b.kind==='text'&&b.formatRole==='point').length,1);assert.equal(blockTextStyles({kind:'text',formatRole:'point'},COMPLETION_FORMAT)[0].color,'#ff5f45');
  const html=exportHtml(project,store.assets(p.id));assert.match(html,/text-align:left/);assert.match(html,/BEFORE &amp; AFTER/);assert(!html.includes('INTERIOR PLAN'));assert.equal(project.blocks.at(-1).space,'마무리');const refreshed=photoLayoutBlocks(project,store.assets(p.id));assert.deepEqual(refreshed.map(b=>({...b,id:''})),project.blocks.map(b=>({...b,id:''})));
});
test('마감은 블로그 자동 입력·등록·예약 결과 기록 경로로 보내지 않는다',async t=>{
  const {request,store,naver}=await fixture(t),p=store.createProject('completion');naver.publish=()=>assert.fail('마감에 블로그 입력을 실행하면 안 됩니다.');
  for(const kind of ['publish','verify'])await assert.rejects(request(`/projects/${p.id}/tasks/${kind}`,'POST',{expectedRevision:p.revision}),/카페 편집기/);
  naver.requireBridge=()=>({});let prepared=false;naver.prepareCafe=async id=>{assert.equal(id,p.id);prepared=true;return {prepared:true,destination:'cafe'};};
  await assert.rejects(request(`/projects/${p.id}/tasks/prepare`,'POST',{expectedRevision:p.revision+1}),/최신 원고/);
  const job=await request(`/projects/${p.id}/tasks/prepare`,'POST',{expectedRevision:p.revision});assert.equal(job.kind,'prepare');
  while(!prepared)await new Promise(r=>setImmediate(r));
  await assert.rejects(request(`/projects/${p.id}/publish-result`,'POST',{url:'https://blog.naver.com/assigned/123',scheduled:false}),/블로그 등록 결과/);
  const saved=await request(`/projects/${p.id}`,'PUT',{...p,publishMode:'automatic'});assert.equal(saved.publishMode,'review');
});

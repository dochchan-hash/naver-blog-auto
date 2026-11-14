import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {AI} from '../server/ai.mjs';
import {keywordReport} from '../shared/domain.mjs';
import {REFERENCE_FORMAT,CASE_FORMAT,COMPLETION_FORMAT} from '../shared/format.mjs';

async function fixture(t,postType){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-keywords-')),store=new Store(dir);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
 const p=store.createProject(postType),keywords=[{term:'파크타운서안',min:4,max:6},{term:'파크타운서안 인테리어',min:3,max:4}];
 store.updateProject(p.id,{original:{...p.original,name:postType==='recommendation'?'원본단지':'파크타운'},target:{...p.target,name:'파크타운'},keywords,title:'직접 작성한 제목',blocks:[{id:'old',kind:'text',text:'직접 수정한 기존 원고'}]});
 store.put('style',postType==='case'?'case':postType==='completion'?'completion':'main',{status:'edited',referenceUrls:[],rules:'이 콘텐츠의 시공 사실과 서식을 유지합니다.',formatProfile:postType==='case'?CASE_FORMAT:postType==='completion'?COMPLETION_FORMAT:REFERENCE_FORMAT});
 store.put('asset','photo',{id:'photo',projectId:p.id,role:'photo',space:'거실',status:'ready',order:0,hash:'photo'});
 const ai=new AI(store,{}, {},{});ai.analyzeMaterials=async()=>{};
 if(postType==='completion'){ai.planWork=async()=>({signature:'keyword-fixture',items:[{id:'work-1',space:'거실',item:'확인한 벽면 마감',sourceIds:['manual'],photoIds:[]}],warnings:[]});ai.checkWork=async()=>({checks:[],issues:[],warnings:[],missing:[]});}
 return {store,p,ai,keywords};
}
const result=valid=>({title:'파크타운서안 인테리어',summary:'밝고 편안한 공간',intro:valid?'파크타운서안 인테리어를 소개합니다.':'시공한 공간을 소개합니다.',sections:[{space:'거실',text:valid?'파크타운서안 인테리어는 밝은 마감이 돋보입니다.':'밝은 마감이 편안한 분위기를 만듭니다.',points:[]}],outro:valid?'파크타운서안 인테리어를 살펴보았습니다. 파크타운서안의 생활 공간에 어울리는 마감입니다.':'관심 가져주셔서 감사합니다.',tags:['파크타운서안'],warnings:[]});

for(const postType of ['recommendation','case','completion']){
 test(`${postType}: 축약 현장명과 상세 검색어를 구분하고 본문 0회면 횟수를 보완한다`,async t=>{
  const {store,p,ai,keywords}=await fixture(t,postType);let calls=0;
  ai.call=async(instructions,content)=>{
   assert.match(instructions,/사용자가 직접 지정한 본문 검색어/);assert.match(instructions,/축약된 단지명/);assert.match(instructions,/min~max/);
   const input=JSON.parse(content[0].text);assert.deepEqual((input.context||input).keywords,keywords);
   if(calls++)assert.deepEqual(input.keywordCounts.map(k=>k.count),[0,0]);return result(calls>1);
  };
  const {project}=await ai.generate(p.id,()=>{});assert.equal(calls,2);assert.deepEqual(keywordReport(project).map(k=>k.count),[4,3]);assert(keywordReport(project).every(k=>k.ok));assert.equal(project.original.name,postType==='recommendation'?'원본단지':'파크타운');assert.equal(store.get('project',p.id).title,project.title);
 });
 test(`${postType}: 제목·태그에만 키워드가 있으면 완료 처리하지 않고 기존 원고를 보존한다`,async t=>{
  const {store,p,ai}=await fixture(t,postType),before=store.get('project',p.id);let calls=0;ai.call=async()=>{calls++;return result(false);};
  await assert.rejects(ai.generate(p.id,()=>{}),e=>/본문 키워드 목표/.test(e.message)&&/파크타운서안 0회\(목표 4~6회\)/.test(e.message));assert.equal(calls,3);assert.deepEqual(store.get('project',p.id),before);
 });
}

test('서로 포함된 검색어의 불가능한 목표는 AI 호출 전에 안내한다',async t=>{
 const {store,p,ai,keywords}=await fixture(t,'case');store.updateProject(p.id,{keywords:[keywords[0],{...keywords[1],min:7,max:8}]});let calls=0;ai.call=async()=>{calls++;return result(true);};
 await assert.rejects(ai.generate(p.id,()=>{}),/키워드 목표가 서로 충돌/);assert.equal(calls,0);assert.equal(store.get('project',p.id).blocks[0].text,'직접 수정한 기존 원고');
});

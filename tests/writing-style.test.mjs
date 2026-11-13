import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {AI} from '../server/ai.mjs';
import {writingReference} from '../server/writing-style.mjs';
import {styleKey} from '../shared/domain.mjs';
import {REFERENCE_FORMAT,CASE_FORMAT} from '../shared/format.mjs';

const body='벽면 마감과 수납 구성, 조명의 위치를 함께 살펴 공간의 특징과 사용 편의를 설명합니다. '.repeat(12);
const article=(url,postType)=>({url,title:'예시 현장',text:'시작 인사\n거실\n'+body+'\n마무리 안내',formatProfile:postType==='case'?CASE_FORMAT:REFERENCE_FORMAT,referenceBlocks:[{kind:'text',text:'시작 인사'},{kind:'quote',text:'LIVING ROOM\n거실 인테리어'},{kind:'text',text:body},{kind:'divider',text:''},{kind:'text',text:'마무리 안내'}]});
const output=()=>({title:'새로운 인테리어',summary:'밝은 마감의 조화',intro:'시작 인사',sections:[{space:'거실',text:body}],outro:'마무리 안내',tags:[],warnings:[]});
async function fixture(t,postType='case'){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-writing-style-')),store=new Store(dir);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
 const p=store.createProject(postType),key=styleKey(postType),url='https://blog.naver.com/example/123';
 store.updateProject(p.id,{original:{...p.original,name:'실제 현장'},target:{...p.target,name:'추천 대상'},keywords:[],blocks:[{id:'old',kind:'text',text:'기존에 직접 작성한 원고'}],facts:[{id:'f',space:'거실',item:'확인된 필름 마감',sourceLabel:'공사 내역',uncertain:false,confirmed:true}],workPlan:{signature:'old',items:[],checks:[],warnings:[],checkedAt:'old'}});
 store.put('asset','photo',{id:'photo',projectId:p.id,role:'photo',space:'거실',order:0,status:'ready',hash:'photo',analysis:{description:'확인한 현장 사진'}});
 store.put('style',key,{name:postType,rules:postType+' 전용 규칙',status:'edited',referenceUrls:[url],formatProfile:postType==='case'?CASE_FORMAT:REFERENCE_FORMAT,referenceEvidence:[article(url,postType)]});
 const ai=new AI(store,{}, {},{});ai.analyzeMaterials=async()=>{};ai.planWork=ai.checkWork=async()=>assert.fail('마감 전용 시공 분류·대조를 다른 콘텐츠에 적용하면 안 됩니다.');return {store,p,ai,key,url};
}

for(const type of ['recommendation','case'])test(`${type}는 마감의 시공 분류·강제 나열을 사용하지 않고 자기 예시 분량·서식을 사용한다`,async t=>{
 const {ai,p,store}=await fixture(t,type);let writes=0;
 ai.call=async(instructions,content)=>{const input=JSON.parse(content[0].text);assert(!JSON.stringify(input).includes('completion 전용 규칙'));assert(!instructions.startsWith('예시 문체 대조'));
 writes++;assert.equal(input.workPlan,undefined);assert.equal(input.pointSpaces,undefined);assert.match(instructions,new RegExp(type+' 전용 규칙'));assert(!instructions.includes('workPlan.items'));assert.equal(input.writingReference.examples.length,1);assert(input.writingReference.targets.거실.max>315);return output();};
 const {project}=await ai.generate(p.id,()=>{});assert.equal(writes,1);assert.equal(project.workPlan,undefined);assert.equal(project.formatProfile.postType,type);assert.equal(project.blocks.find(b=>b.space==='거실'&&b.kind==='text').text,body);assert.equal(store.get('style',type==='case'?'case':'main').rules,type+' 전용 규칙');
});

test('오래된 분석에 원문이 없으면 모든 현재 링크를 다시 읽고 규칙은 보존하며 재사용한다',async t=>{
 const {ai,p,store,key,url}=await fixture(t);const s=store.get('style',key);store.put('style',key,{...s,referenceEvidence:[{url,characters:1000}],formatEvidence:[{url,formatProfile:CASE_FORMAT}]});let reads=0;
 ai.browser.readPost=async requested=>{reads++;assert.equal(requested,url);return article(url,'case');};ai.call=async()=>output();
 await ai.generate(p.id,()=>{});await ai.generate(p.id,()=>{});assert.equal(reads,1);assert.equal(store.get('style',key).rules,'case 전용 규칙');assert.equal(store.get('style',key).formatEvidence[0].text,article(url,'case').text);
});

test('예시와 분량·말투가 달라도 주관적인 재검사로 막거나 다시 쓰지 않고 원고를 완성한다',async t=>{
 const {ai,p}=await fixture(t);
 for(const text of ['확인한 마감을 소개합니다.',body.repeat(5),'조명을 배치해 보세요.\n수납을 정리해 주세요.\n밝게 연출해 보세요.']){
  let calls=0;ai.call=async(instructions)=>{assert(!instructions.startsWith('예시 문체 대조'));calls++;return {...output(),intro:'인사',sections:[{space:'거실',text}],outro:'감사합니다.'};};
  const {project}=await ai.generate(p.id,()=>{});assert.equal(calls,1);assert.equal(project.blocks.find(b=>b.space==='거실'&&b.kind==='text').text,text);
 }
});

test('분량은 현재 콘텐츠의 모든 링크로 계산하고 다른 콘텐츠·삭제한 링크·지도·태그는 섞지 않는다',()=>{
 const urls=['https://blog.naver.com/a/1','https://blog.naver.com/a/2','https://blog.naver.com/a/3'];const examples=urls.map(url=>article(url,'case'));examples[1].referenceBlocks[2].text=body.repeat(2);examples[2].referenceBlocks[2].text=body.repeat(3);
 const style={referenceUrls:urls,referenceEvidence:[...examples,article('https://blog.naver.com/removed/4','case')],formatEvidence:[{...article(urls[0],'case'),formatProfile:{postType:'completion'}}]};
 const ref=writingReference(style,'case',['거실']);assert.equal(ref.measurements.length,3);const n=body.replace(/\s/g,'').length;assert.deepEqual(ref.targets.거실,{min:n,target:n*2,max:n*3});assert.equal(ref.examples.length,2);
});

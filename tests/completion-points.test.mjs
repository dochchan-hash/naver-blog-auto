import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {AI} from '../server/ai.mjs';
import {completionPointTemplates,completionSignature} from '../shared/completion-templates.mjs';
import {missingSpaceDescriptions,publicationBlocks} from '../shared/domain.mjs';
import {missingWorkItems} from '../shared/sources.mjs';
import {COMPLETION_FORMAT} from '../shared/format.mjs';

const points=[{title:'3연동 중문',text:'3연동 중문을 설치해 현관과 실내를 구분했습니다.'},{title:'행잉형 신발장',text:'행잉형 신발장을 설치해 하부 공간을 확보했습니다.'}];
const result=()=>({title:'현관 시공 마감',intro:'완성한 현장을 소개합니다.',sections:[{space:'현관',text:'3연동 중문과 행잉형 신발장으로 출입 공간을 정리했습니다.',points:structuredClone(points)}],outro:'감사합니다.',tags:[],warnings:[]});
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-template-points-')),store=new Store(dir);
  t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
  const p=store.createProject('completion'),slot={id:'point-slot',name:'현관 포인트',position:'space',space:'현관',templateId:'psd',layoutId:'layout',text:'1. 3연동 중문\n2. 행잉형 신발장',photoIds:['source']};
  const template={id:'psd',role:'template',templateKind:'completion',layouts:[{id:'layout',elements:[{id:'point',kind:'text',binding:'point',text:'1. 기본 항목'}]}]};
  store.updateProject(p.id,{original:{...p.original,name:'현재 현장'},keywords:[],completionTemplates:[slot]});
  store.put('style','completion',{rules:'저장한 마감 예시의 말투로 설명합니다.',referenceUrls:[],status:'edited',formatProfile:COMPLETION_FORMAT});
  store.put('asset','psd',template);
  store.put('asset','source',{id:'source',projectId:p.id,role:'template-photo',space:'안방',status:'ready',hash:'source'});
  store.put('asset','normal',{id:'normal',projectId:p.id,role:'photo',space:'현관',status:'ready',hash:'normal',order:1});
  store.put('asset','output',{id:'output',projectId:p.id,role:'photo',templateOutput:'completion',templateSlotId:slot.id,space:'현관',status:'ready',hash:'output',order:0,templateSignature:completionSignature(slot,store.assets(p.id))});
  const images=[],ai=new AI(store,{}, {imageData:async a=>{images.push(a.id);return 'data:image/jpeg;base64,AA';}},{});
  ai.analyzeMaterials=async()=>{};
  ai.planWork=async()=>({items:[{id:'work-1',space:'현관',item:'3연동 중문과 행잉형 신발장 설치',sourceIds:['manual'],photoIds:[]}],warnings:[],signature:''});
  return {store,p:store.get('project',p.id),slot,template,ai,images};
}

test('실제 PSD의 기본·수정 문구와 번호를 읽고 숨김·체크 해제·오래된 미리보기를 구분한다',async t=>{
  const {store,p,slot}=await fixture(t),assets=store.assets();
  assert.deepEqual(completionPointTemplates(p,assets),[{id:slot.id,space:'현관',points:points.map((p,i)=>({number:i+1,title:p.title})),outputId:'output'}]);
  const edited={...slot,edits:{point:{text:'2. 슬라이딩 중문\n4. 행잉형\n신발장'}}};
  const refs=completionPointTemplates({...p,completionTemplates:[edited]},assets);
  assert.deepEqual(refs[0].points,[{number:2,title:'슬라이딩 중문'},{number:4,title:'행잉형 신발장'}]);assert.equal(refs[0].outputId,undefined);
  assert.deepEqual(completionPointTemplates({...p,completionTemplates:[{...slot,text:''}]},assets)[0].points,[{number:1,title:'기본 항목'}]);
  assert.deepEqual(completionPointTemplates({...p,completionTemplates:[{...slot,edits:{point:{visible:false}}}]},assets)[0].points,[]);
  assert.deepEqual(completionPointTemplates({...p,completionTemplates:[{...slot,enabled:false}]},assets),[]);
  assert.deepEqual(completionPointTemplates({...p,postType:'case'},assets),[]);
});

test('다른 시공 포인트를 반환해도 템플릿의 제목·순서로 보완하고 완성 이미지 한 장만 참고한다',async t=>{
  const {store,p,ai,images}=await fixture(t);let writes=0,audits=0;
  ai.call=async(instructions,content)=>{
    const input=JSON.parse(content[0].text);
    if(instructions.startsWith('본문 시공 대조')){audits++;assert.deepEqual(input.pointTemplates[0].points,points.map((p,i)=>({number:i+1,title:p.title})));const body=input.blocks.find(b=>b.space==='현관'&&b.role==='body');return {checks:[{workId:'work-1',blockId:body.id,quote:body.text}],issues:[],warnings:[]};}
    const context=input.context||input;assert.deepEqual(context.expectedSpaces,['현관']);assert.deepEqual(context.pointTemplates[0].points,points.map((p,i)=>({number:i+1,title:p.title})));
    assert.equal(content.filter(c=>c.type==='input_image').length,1);assert.equal(content.find(c=>c.type==='input_image').detail,'low');
    const value=result();if(!writes++)value.sections[0].points=[{title:'페트신발장 1300L',text:'신발장을 설치했습니다.'}];else assert.match(input.pointIssues.join(' '),/템플릿/);return value;
  };
  const {project}=await ai.generate(p.id,()=>{});assert.equal(writes,2);assert.equal(audits,1);assert.deepEqual(images,['output']);
  assert.deepEqual(project.blocks.filter(b=>b.formatRole==='point').map(b=>b.text),['1. 3연동 중문','2. 행잉형 신발장']);
  assert.deepEqual(project.blocks.filter(b=>b.formatRole==='pointBody').map(b=>b.text),points.map(p=>p.text));
  assert(!project.blocks.some(b=>b.assetIds?.includes('source')));
  const call=ai.call;
  ai.call=async(instructions,content)=>instructions.startsWith('본문 시공 대조')?call(instructions,content):
    {...result(),sections:[{...result().sections[0],points:[{title:'다른 공사',text:'다른 설명'}]}]};
  const {project:partial}=await ai.generate(p.id,()=>{});
  assert(!partial.blocks.some(b=>b.formatRole==='point'||b.formatRole==='pointBody'));
  assert(partial.blocks.some(b=>b.assetIds?.includes('output')));
  assert(partial.generationWarnings.some(w=>w.includes('포인트 설명은 제외')));
});

test('제목만 맞고 설명이 다른 포인트도 기존 시공 대조에서 보완한다',async t=>{
  const {p,ai}=await fixture(t);let writes=0,audits=0;
  ai.call=async(instructions,content)=>{
    const input=JSON.parse(content[0].text);
    if(instructions.startsWith('본문 시공 대조')){assert.match(instructions,/제목만 맞고 설명이 다른/);const body=input.blocks.find(b=>b.space==='현관'&&b.role==='body');return {checks:[{workId:'work-1',blockId:body.id,quote:body.text}],issues:audits++?[]:['현관 1번 중문 포인트에 신발장 설명이 붙었습니다.'],warnings:[]};}
    const value=result();if(!writes++)value.sections[0].points[0].text=points[1].text;else assert.match(input.workIssues[0],/중문/);return value;
  };
  const {project}=await ai.generate(p.id,()=>{});assert.equal(writes,2);assert.equal(audits,2);assert.equal(project.blocks.find(b=>b.formatRole==='pointBody').text,points[0].text);
});

for(const disputed of [false,true])test(`공용부 조명은 거실 천장과 커튼박스를 함께 반영하고 검증 후에도 저장한다${disputed?' · 미확인 시공 제외':''}`,async t=>{
  const {ai,store,p,slot}=await fixture(t);
  const living={...slot,space:'거실',text:'1. 우물천장 간접조명\n2. 벽 도배\n3. 커튼 박스 간접조명'};
  store.updateProject(p.id,{completionTemplates:[living],facts:[{id:'scope',space:'공용부',item:'간접조명 구성',sourceLabel:'공사범위',confirmed:true,uncertain:false}]});
  store.put('asset','normal',{...store.get('asset','normal'),space:'거실'});
  store.put('asset','output',{...store.get('asset','output'),space:'거실',templateSignature:completionSignature(living,store.assets(p.id))});
  store.put('asset','entry',{id:'entry',projectId:p.id,role:'photo',space:'현관',status:'ready',hash:'entry'});
  ai.planWork=AI.prototype.planWork;
  const ceiling='거실 우물천장 테두리 간접조명 구성',curtain='거실 창가 커튼 박스 간접조명 구성',unknown='거실 벽 전체 도배';
  let plans=0,writes=0,audits=0;
  ai.call=async(instructions,content)=>{
    const input=JSON.parse(content[0].text);
    if(instructions.startsWith('공간별 시공 분류')){
      plans++;
      assert.match(instructions,/공용부는 거실/);
      assert.match(instructions,/우물천장 테두리와 창가 커튼박스에 각각/);
      assert(content.some(c=>c.type==='input_image'));
      assert.equal(input.pointTemplates[0].imageHash,'output');
      return {items:[ceiling,curtain,...(disputed?[unknown]:[])].map(item=>({space:'거실',item,sourceIds:['fact:0'],photoIds:[]})),warnings:[]};
    }
    if(instructions.startsWith('본문 시공 대조')){
      audits++;
      assert.match(instructions,/한 위치가 분류됐다는 이유로 다른 위치를 배제하지/);
      assert.equal(input.facts[0].space,'공용부');assert(content.some(c=>c.type==='input_image'));
      const body=input.blocks.find(b=>b.space==='거실'&&b.role==='body');
      return {checks:input.workPlan.filter(w=>w.item!==unknown).map(w=>({workId:w.id,blockId:body.id,quote:w.item})),
        issues:disputed?['벽 도배는 공사범위에서 확인되지 않습니다.']:[],
        unsafeBlockIds:disputed?[body.id,input.blocks.find(b=>b.role==='pointBody'&&b.text===unknown).id]:[],
        unconfirmedWorkIds:disputed?[input.workPlan.find(w=>w.item===unknown).id]:[]};
    }
    writes++;
    return {...result(),sections:[{space:'거실',text:[ceiling,curtain,...(disputed?[unknown]:[])].join('. '),points:[
      {title:'우물천장 간접조명',text:ceiling},...(disputed?[{title:'벽 도배',text:unknown}]:[]),{title:'커튼 박스 간접조명',text:curtain}
    ]}]};
  };
  const {project}=await ai.generate(p.id,()=>{}),assets=store.assets(p.id),blocks=publicationBlocks(project,assets);
  assert.equal(plans,1);assert.equal(writes,disputed?3:1);assert.equal(audits,writes);
  assert.deepEqual(blocks.filter(b=>b.formatRole==='point').map(b=>b.text),['1. 우물천장 간접조명','3. 커튼 박스 간접조명']);
  assert(blocks.some(b=>b.space==='거실'&&!b.formatRole&&b.text?.includes(curtain)));
  assert(!blocks.some(b=>b.text?.includes('벽')));
  assert(blocks.some(b=>b.assetIds?.includes('entry')));
  assert.deepEqual(missingSpaceDescriptions(project,assets),[]);
  assert.deepEqual(missingWorkItems(project.workPlan,project.blocks),[]);
  assert.deepEqual(project.workPlan.items.map(w=>w.item),[ceiling,curtain]);
});

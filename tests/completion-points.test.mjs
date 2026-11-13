import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {AI} from '../server/ai.mjs';
import {completionPointTemplates,completionSignature} from '../shared/completion-templates.mjs';
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
  ai.analyzeMaterials=async()=>{};ai.planWork=async()=>({items:[],warnings:[],signature:''});
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
    if(instructions.startsWith('본문 시공 대조')){audits++;assert.deepEqual(input.pointTemplates[0].points,points.map((p,i)=>({number:i+1,title:p.title})));return {checks:[],issues:[],warnings:[]};}
    const context=input.context||input;assert.deepEqual(context.expectedSpaces,['현관']);assert.deepEqual(context.pointTemplates[0].points,points.map((p,i)=>({number:i+1,title:p.title})));
    assert.equal(content.filter(c=>c.type==='input_image').length,1);assert.equal(content.find(c=>c.type==='input_image').detail,'low');
    const value=result();if(!writes++)value.sections[0].points=[{title:'페트신발장 1300L',text:'신발장을 설치했습니다.'}];else assert.match(input.pointIssues.join(' '),/템플릿/);return value;
  };
  const {project}=await ai.generate(p.id,()=>{});assert.equal(writes,2);assert.equal(audits,1);assert.deepEqual(images,['output']);
  assert.deepEqual(project.blocks.filter(b=>b.formatRole==='point').map(b=>b.text),['1. 3연동 중문','2. 행잉형 신발장']);
  assert.deepEqual(project.blocks.filter(b=>b.formatRole==='pointBody').map(b=>b.text),points.map(p=>p.text));
  assert(!project.blocks.some(b=>b.assetIds?.includes('source')));
  const saved=structuredClone(store.get('project',p.id).blocks);ai.call=async()=>({...result(),sections:[{space:'현관',text:'공간 설명',points:[{title:'다른 공사',text:'다른 설명'}]}]});
  await assert.rejects(ai.generate(p.id,()=>{}),/포인트의 항목·제목·순서가 템플릿과 다릅니다/);assert.deepEqual(store.get('project',p.id).blocks,saved);
});

test('제목만 맞고 설명이 다른 포인트도 기존 시공 대조에서 보완한다',async t=>{
  const {p,ai}=await fixture(t);let writes=0,audits=0;
  ai.call=async(instructions,content)=>{
    const input=JSON.parse(content[0].text);
    if(instructions.startsWith('본문 시공 대조')){assert.match(instructions,/제목만 맞고 설명이 다른/);return {checks:[],issues:audits++?[]:['현관 1번 중문 포인트에 신발장 설명이 붙었습니다.'],warnings:[]};}
    const value=result();if(!writes++)value.sections[0].points[0].text=points[1].text;else assert.match(input.workIssues[0],/중문/);return value;
  };
  const {project}=await ai.generate(p.id,()=>{});assert.equal(writes,2);assert.equal(audits,2);assert.equal(project.blocks.find(b=>b.formatRole==='pointBody').text,points[0].text);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {AI} from '../server/ai.mjs';
import {keywordReport} from '../shared/domain.mjs';
import {REFERENCE_FORMAT,CASE_FORMAT,COMPLETION_FORMAT} from '../shared/format.mjs';

async function fixture(t,postType,area=34){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-area-')),store=new Store(dir);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});const p=store.createProject(postType),term=`테스트아파트 ${area}평`;
 store.updateProject(p.id,{original:{...p.original,name:postType==='recommendation'?'원본단지':'테스트아파트',supplyArea:'103.3㎡',exclusiveArea:'84.5㎡'},target:{...p.target,name:'테스트아파트'},keywords:[{term,min:1,max:2}],title:'직접 수정한 제목',blocks:[{id:'old',kind:'text',text:'직접 수정한 기존 원고'}]});
 store.put('style',postType==='case'?'case':postType==='completion'?'completion':'main',{status:'edited',referenceUrls:[],rules:'현장을 소개합니다.',formatProfile:postType==='case'?CASE_FORMAT:postType==='completion'?COMPLETION_FORMAT:REFERENCE_FORMAT});store.put('asset','photo',{id:'photo',projectId:p.id,role:'photo',status:'ready',space:'거실',order:0});
 const ai=new AI(store,{},{},{});ai.analyzeMaterials=async()=>{};
 const result=()=>({title:'테스트아파트, 밝고 편안한 인테리어',summary:'밝은 마감과 편안한 공간',intro:`${term} 인테리어를 소개합니다.`,sections:[{space:'거실',text:'밝은 마감과 조명이 편안한 분위기를 만듭니다.',points:[]}],outro:'관심 가져주셔서 감사합니다.',tags:['인테리어'],warnings:[]});return {store,p,ai,term,result};
}

for(const [postType,area]of [['recommendation',24],['case',34],['completion',50]]){
 test(`${postType}: 제곱미터 표기를 보완하고 사용자가 지정한 ${area}평 키워드는 그대로 유지한다`,async t=>{
  const {store,p,ai,term,result}=await fixture(t,postType,area);let calls=0;
  ai.call=async(instructions,content)=>{assert.match(instructions,/평형과 공급\/전용 면적을 기본적으로 생략/);assert.match(instructions,/입력된 숫자와 띄어쓰기까지 그대로/);assert.match(instructions,/특정 평수를 고정하거나 예시 숫자를 원고에 넣지 마세요/);const input=JSON.parse(content[0].text);assert.equal((input.context||input).keywords[0].term,term);if(calls++)assert.equal(input.invalidAreaNotation,true);return calls===1?{...result(),title:'테스트아파트 103.3m2 인테리어'}:result();};
  const {project}=await ai.generate(p.id,()=>{});assert.equal(calls,2);assert.equal(project.title,result().title);assert.equal(keywordReport(project)[0].count,1);assert.equal(project.keywords[0].term,term);assert.equal(project.original.supplyArea,'103.3㎡');assert.equal(store.get('project',p.id).original.exclusiveArea,'84.5㎡');
 });
 test(`${postType}: 금지 표기가 계속 남으면 완료 처리하지 않고 기존 원고를 보존한다`,async t=>{
  const {store,p,ai,result}=await fixture(t,postType,area),before=store.get('project',p.id);let calls=0;ai.call=async()=>{calls++;return {...result(),intro:result().intro+' 공급면적은 103.3㎡입니다.'};};await assert.rejects(ai.generate(p.id,()=>{}),/면적 표기를 정리하지 못했습니다/);assert.equal(calls,3);assert.deepEqual(store.get('project',p.id),before);
 });
}

test('m2·m²·㎡·제곱미터·PY 등 표기 변형을 보완하며 임의로 평수 환산하지 않는다',async t=>{
 const {p,ai,result}=await fixture(t,'case');for(const unit of ['m2','m²','㎡','M2','m^2','제곱미터','평방미터','sqm','PY','평형','평대']){let calls=0;ai.call=async()=>++calls===1?{...result(),title:`테스트아파트 103.3${unit}`} :result();const {project}=await ai.generate(p.id,()=>{});assert.equal(calls,2,unit);assert.equal(project.title,result().title);assert(!project.title.includes('31평'));}
});

test('인용구·포인트·질문 답변·마무리·태그도 면적 표기 검사를 통과해야 한다',async t=>{
 const confirmedPlan={signature:'area-fixture',items:[{id:'work-1',space:'거실',item:'확인된 간접조명 설치',sourceIds:['manual'],photoIds:[]}],warnings:[]};
 const {store,p,ai,result}=await fixture(t,'completion');store.updateProject(p.id,{questionQuote:'end',questionQuoteCount:1,completionTemplates:[{id:'point',position:'space',space:'거실',templateId:'psd',text:'',photoIds:[]}]});
 ai.planWork=async()=>confirmedPlan;ai.checkWork=async()=>({checks:[],issues:[],warnings:[],missing:[]});
 const base=()=>({...result(),sections:[{...result().sections[0],points:[{title:'조명',text:'간접조명으로 은은한 분위기를 더합니다.'}]}],questionAnswers:[{question:'어떤 조명이 어울리나요?',answer:'공간의 마감과 조명 밝기를 함께 살펴보세요.'}]});
 for(const set of [r=>r.sections[0].text='103.3㎡ 공간입니다.',r=>r.sections[0].points[0].title='103.3m² 포인트',r=>r.sections[0].points[0].text='103.3m2 공간의 조명입니다.',r=>r.questionAnswers[0].question='103.3㎡에는 어떤 조명이 어울리나요?',r=>r.questionAnswers[0].answer='103.3m2에 맞춰 조명을 선택합니다.',r=>r.outro='103.3㎡ 현장을 살펴보았습니다.',r=>r.tags=['103.3㎡']]){let calls=0;ai.call=async()=>{const r=base();if(++calls===1)set(r);return r;};await ai.generate(p.id,()=>{});assert.equal(calls,2);}
 const c=await fixture(t,'case');let calls=0;c.ai.call=async()=>++calls===1?{...c.result(),summary:'103.3㎡를 살린 인테리어'}:c.result();await c.ai.generate(c.p.id,()=>{});assert.equal(calls,2);
});

test('제곱미터를 요구하는 키워드는 호출 전에 안내하고 사용자 입력을 임의 변경하지 않는다',async t=>{
 const {store,p,ai}=await fixture(t,'case');store.updateProject(p.id,{keywords:[{term:'테스트아파트 103.3㎡',min:1,max:2}]});const before=store.get('project',p.id);ai.call=async()=>assert.fail('표기 충돌은 AI 호출 전에 확인해야 합니다.');await assert.rejects(ai.generate(p.id,()=>{}),/키워드의 면적 표기/);assert.deepEqual(store.get('project',p.id),before);
});

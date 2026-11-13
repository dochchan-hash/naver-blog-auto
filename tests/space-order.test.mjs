import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {AI} from '../server/ai.mjs';
import {newProject,postSpaces,postSpaceOrder,photoLayoutBlocks,draftWarnings,styleKey} from '../shared/domain.mjs';
import {REFERENCE_FORMAT,CASE_FORMAT,COMPLETION_FORMAT,referenceStructure} from '../shared/format.mjs';

const headings=blocks=>blocks.filter(b=>b.space&&['heading','quote'].includes(b.kind)).map(b=>b.space);
const expected={
  recommendation:['현관','거실','거실베란다','주방','보조주방','주방베란다','안방','파우더룸','안방욕실','작은방1','작은방2','작은방3','2층','기타','공용욕실'],
  case:['현관','거실','거실베란다','주방','보조주방','주방베란다','안방','파우더룸','드레스룸','안방베란다','안방욕실','작은방1','작은방2','작은방3','2층','기타','복도','알파룸','공용욕실'],
  completion:['현관','복도','거실','거실베란다','주방','보조주방','주방베란다','안방','파우더룸','드레스룸','안방베란다','안방욕실','작은방1','작은방2','작은방3','알파룸','베란다','2층','기타','공용욕실']
};

for(const postType of Object.keys(expected))test(`${postType} 실제 생성 경로에서 부속 공간과 공용욕실 순서를 맞춘다`,async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-space-order-')),store=new Store(dir);
  t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
  const p=store.createProject(postType),profile=postType==='case'?CASE_FORMAT:postType==='completion'?COMPLETION_FORMAT:REFERENCE_FORMAT;
  store.updateProject(p.id,{original:{...p.original,name:'원본단지'},target:{...p.target,name:'추천단지'},keywords:[],category:'시공사례'});
  const style={rules:'현재 콘텐츠의 저장된 말투와 서식',status:'edited',referenceUrls:[],formatProfile:profile};store.put('style',styleKey(postType),style);
  const photos=postSpaces(p).toReversed().map((space,order)=>({id:space,projectId:p.id,role:'photo',space,status:'ready',hash:space,order}));
  for(const photo of photos)store.put('asset',photo.id,photo);
  const before=store.assets(p.id),ai=new AI(store,{}, {},{});
  ai.analyzeMaterials=async()=>{};
  ai.planWork=async()=>({signature:'sample',items:[],warnings:[],observations:[]});
  ai.checkWork=async()=>({checks:[],issues:[],warnings:[],missing:[]});
  ai.call=async(_,content)=>{
    const input=JSON.parse(content[0].text);assert.deepEqual(input.context?.expectedSpaces||input.expectedSpaces,expected[postType]);
    return {title:'시공 현장 소개',summary:'현장 콘셉트',intro:'인사말',sections:photos.map(p=>({space:p.space,text:p.space+'의 확인된 시공 설명',points:[]})),outro:'마무리',tags:[],warnings:[]};
  };
  const {project}=await ai.generate(p.id,()=>{});
  assert.deepEqual(headings(project.blocks),expected[postType]);
  assert.deepEqual(headings(photoLayoutBlocks(project,before)),expected[postType]);
  assert(!draftWarnings(project,before).some(w=>w.includes('사진 순서')));
  assert.deepEqual(store.get('style',styleKey(postType)),style);
  assert.deepEqual(store.assets(p.id),before);
});

test('저장된 예시에 부속 공간이 없거나 뒤에 있어도 연결된 공간 뒤에 두며 입력은 보존한다',()=>{
  const profile={...CASE_FORMAT,spaceOrder:['주방','거실','안방','공용욕실','드레스룸','안방욕실','파우더룸','안방베란다','거실베란다','주방베란다']},before=structuredClone(profile);
  const p=newProject('p','case'),order=postSpaceOrder(p,profile);
  assert.deepEqual(order.slice(0,11),['주방','보조주방','주방베란다','거실','거실베란다','안방','파우더룸','드레스룸','안방베란다','안방욕실','현관']);
  assert.equal(order.at(-1),'공용욕실');assert.deepEqual(profile,before);
  const blocks=profile.spaceOrder.flatMap(space=>[{id:space+'-h',kind:'heading',space,text:space},{id:space+'-p',kind:'photos',space,assetIds:[space]},{id:space+'-t',kind:'text',space,text:'직접 쓴 '+space}]);
  const original=structuredClone(blocks),result=referenceStructure({blocks},profile);
  assert.deepEqual(headings(result),order.filter(s=>profile.spaceOrder.includes(s)));
  assert.deepEqual(result.toSorted((a,b)=>a.id.localeCompare(b.id)),blocks.toSorted((a,b)=>a.id.localeCompare(b.id)));assert.deepEqual(blocks,original);
});

for(const postType of ['case','completion'])test(`${postType} 사진 배치 반영으로 새 공간을 넣을 때 설명·사진을 함께 제자리에 삽입한다`,()=>{
  const p=newProject('layout',postType),profile=postType==='case'?CASE_FORMAT:COMPLETION_FORMAT;
  const original=['거실','주방','안방','안방욕실','공용욕실'].flatMap(space=>[{id:space+'-h',kind:'quote',space,text:space},{id:space+'-t',kind:'text',space,text:'직접 수정한 '+space}]);
  p.formatProfile=profile;p.blocks=[{id:'intro',kind:'text',formatRole:'intro',text:'인사'},...original,{id:'closing',kind:'text',formatRole:'closing',text:'끝인사'},{id:'divider',kind:'divider'}];
  const spaces=['공용욕실','드레스룸','안방욕실','안방베란다','거실','거실베란다','안방','파우더룸','주방','주방베란다'];
  const assets=spaces.map((space,order)=>({id:space,role:'photo',space,order,status:'ready'})),before=structuredClone(p);
  const result=photoLayoutBlocks(p,assets);
  assert.deepEqual(headings(result),['거실','거실베란다','주방','주방베란다','안방','파우더룸','드레스룸','안방베란다','안방욕실','공용욕실']);
  for(const block of original)assert.deepEqual(result.find(b=>b.id===block.id),block);
  assert.deepEqual(result.filter(b=>b.kind==='photos').flatMap(b=>b.assetIds).sort(),spaces.toSorted());
  assert(result.findIndex(b=>b.id==='closing')>result.findIndex(b=>b.space==='공용욕실'));
  assert.deepEqual(p,before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../server/store.mjs';
import {AI} from '../server/ai.mjs';
import {COMPLETION_FORMAT} from '../shared/format.mjs';
import {missingSpaceDescriptions,photoLayoutBlocks,publicationBlocks} from '../shared/domain.mjs';
import {missingWorkItems} from '../shared/sources.mjs';

const intro='안녕하세요, 인테리어의 현명한 선택! 레몬하우스 인사드립니다 :)\n오늘은 따뜻한 색감과 정돈된 수납으로 아늑함을 담아낸 현장을 소개해 드릴게요. 화이트와 우드가 어우러진 공간을 지금 함께 구경해 보실까요?';
const common='현장 전체 창호는 KCC 제품으로 교체하고 문과 문틀은 총 5세트를 시공했습니다. 탄성 도장은 현장 전체 3개소에 2회 진행했습니다.';
const items=['KCC 창호 전체 교체','문·문틀 총 5세트 시공','전체 3개소 탄성 도장 2회'];
const result=()=>({title:'따뜻한 화이트 우드 인테리어',intro,commonWork:common,sections:[{space:'거실',text:'거실은 우드 톤의 수납장으로 정리해 아늑한 분위기를 더했습니다.',points:[]}],outro:'함께 둘러봐 주셔서 감사합니다.',tags:[],warnings:[]});
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-completion-intro-')),store=new Store(dir);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
  const p=store.createProject('completion');store.updateProject(p.id,{original:{...p.original,name:'테스트 현장'},keywords:[],concept:'따뜻한 화이트 우드',facts:items.map((item,i)=>({id:'f'+i,space:'공통',item,sourceLabel:'공사범위',confirmed:true,uncertain:false}))});
  store.put('style','completion',{rules:'친근한 인사와 현장 매력 소개 후 함께 구경하자는 말로 시작합니다.',status:'edited',referenceUrls:[],formatProfile:COMPLETION_FORMAT});
  for(const [order,space]of ['공사범위','시공전후','거실'].entries())store.put('asset','photo'+order,{id:'photo'+order,projectId:p.id,role:'photo',space,order,status:'ready',hash:'hash'+order,...(space!=='거실'?{templateOutput:'completion'}:{analysis:{description:'화이트와 우드 톤이 보이는 거실'}})});
  const ai=new AI(store,{},{},{});ai.analyzeMaterials=async()=>{};return {p,store,ai};
}

for(const repair of [false,true])test(`마감의 친근한 인사말을 유지하고 공통 시공은 공사범위 뒤 본문에서 누락 대조한다${repair?' · 누락 보완':''}`,async t=>{
  const {p,store,ai}=await fixture(t);let writes=0,audits=0;
  ai.call=async(instructions,content)=>{
    const input=JSON.parse(content[0].text);
    if(instructions.includes('공간별 시공 분류')){assert.match(instructions,/공통으로 분류했다는 이유만으로/);return {items:[...items.map((item,i)=>({space:'공통',item,sourceIds:['fact:'+i],photoIds:[]})),{space:'거실',item:'사진의 우드 수납장',sourceIds:['photo:photo-1'],photoIds:['photo-1']}],warnings:[]};}
    if(instructions.startsWith('본문 시공 대조')){
      audits++;assert.match(instructions,/인사말.*전부 포함할 필요가 없습니다/);assert.match(instructions,/인사말로 옮기라고 요구하지 마세요/);
      const body=input.blocks.find(b=>b.space==='공통'&&b.role==='body');
      return {checks:body?items.map((_,i)=>({workId:'work-'+(i+1),blockId:body.id,quote:common})):[],issues:[],warnings:[]};
    }
    writes++;assert.match(instructions,/친근한 브랜드 인사/);assert.match(instructions,/commonWork에 자연스러운 설명문/);assert(!instructions.includes('도입/마무리에 자연스럽게 넣으세요'));
    const context=input.context||input;assert.equal(context.photos.find(p=>p.space==='거실').description,'화이트와 우드 톤이 보이는 거실');assert.match(instructions,/마감 공간 설명 작성 기준/);assert.match(instructions,/집에 들어서는 첫 순간부터/);assert.match(instructions,/근거 없는 작업으로 분량을 채우지/);
    if(writes>1){assert.equal(input.previous.intro,intro);assert.match(input.request,/인사말을 공사내역 나열로 바꾸지 마세요/);}
    const value=result();if(repair&&writes===1)value.commonWork='';return value;
  };
  const {project}=await ai.generate(p.id,()=>{}),blocks=project.blocks,opening=blocks.find(b=>b.formatRole==='intro'),shared=blocks.find(b=>b.space==='공통');
  assert.equal(opening.text,intro);assert(!/KCC|5세트|3개소|2회/.test(opening.text));assert.equal(shared.text,common);
  assert(blocks.findIndex(b=>b.space==='공사범위'&&b.kind==='photos')<blocks.indexOf(shared));assert(blocks.indexOf(shared)<blocks.findIndex(b=>b.text==='BEFORE & AFTER'));
  assert.equal(writes,repair?2:1);assert.equal(audits,repair?2:1);assert.equal(project.workPlan.checks.length,3);
  assert(!blocks.some(b=>b.space==='거실'&&b.kind==='text'),'사진 관찰만 있는 거실은 공통 공사로 설명을 만들지 않습니다.');
  const rearranged=photoLayoutBlocks(project,store.assets(p.id));assert.equal(rearranged.filter(b=>b.space==='공통').length,1);assert.equal(rearranged.find(b=>b.space==='공통').id,shared.id);
  assert(rearranged.findIndex(b=>b.space==='공사범위')<rearranged.findIndex(b=>b.space==='공통'));assert(rearranged.findIndex(b=>b.space==='공통')<rearranged.findIndex(b=>b.text==='BEFORE & AFTER'));
  assert.deepEqual(missingWorkItems(project.workPlan,rearranged),[]);
});

test('공통 시공과 공간별 시공이 함께 있어도 사진만 있는 공간을 생략하거나 비워 반환하면 바로 완성한다',async t=>{
  const {p,store,ai}=await fixture(t);
  for(const [order,space] of ['현관','현관','복도','작은방1','주방'].entries()){
    const id='extra'+order;store.put('asset',id,{id,projectId:p.id,role:'photo',space,order:10+order,status:'ready',hash:id});
  }
  const kitchen='주방 타일 교체';
  store.updateProject(p.id,{facts:[...store.get('project',p.id).facts,{id:'kitchen',space:'주방',item:kitchen,sourceLabel:'공사범위',confirmed:true,uncertain:false}]});
  let writes=0,omitKitchen=false;
  ai.call=async(instructions,content)=>{
    const input=JSON.parse(content[0].text);
    if(instructions.startsWith('공간별 시공 분류')){
      return {items:[...items.map((item,i)=>({space:'공통',item,sourceIds:['fact:'+i],photoIds:[]})),{space:'주방',item:kitchen,sourceIds:['fact:3'],photoIds:[]}],warnings:[]};
    }
    if(instructions.startsWith('본문 시공 대조')){
      const commonBlock=input.blocks.find(b=>b.space==='공통');
      const kitchenBlock=input.blocks.find(b=>b.space==='주방');
      return {checks:input.workPlan.map(work=>{
        const block=work.space==='공통'?commonBlock:kitchenBlock;
        return block?{workId:work.id,blockId:block.id,quote:block.text}:null;
      }).filter(Boolean),issues:[]};
    }
    writes++;
    assert.deepEqual(new Set((input.context||input).photoOnlySpaces),new Set(['현관','복도','작은방1','거실']));
    return {...result(),sections:[
      {space:'복도',text:'',points:[]},
      {space:'작은방1',text:'시공 근거가 없는 설명',points:[]},
      ...(!omitKitchen?[{space:'주방',text:kitchen,points:[]}]:[])
    ]};
  };
  const {project}=await ai.generate(p.id,()=>{}),assets=store.assets(p.id);
  assert.equal(writes,1,'사진만 있는 공간 때문에 재작성하지 않습니다.');
  assert.deepEqual(missingSpaceDescriptions(project,assets),[]);
  for(const blocks of [project.blocks,photoLayoutBlocks(project,assets),publicationBlocks(project,assets)]){
    assert.deepEqual(blocks.filter(b=>b.space==='현관'&&b.kind==='photos').flatMap(b=>b.assetIds),['extra0','extra1']);
    assert.deepEqual(blocks.filter(b=>b.kind==='text'&&['현관','복도','작은방1','거실','주방'].includes(b.space)).map(b=>b.text),[kitchen]);
    assert(blocks.some(b=>b.space==='공통'&&b.text===common));
  }
  omitKitchen=true;
  const {project:recovered}=await ai.generate(p.id,()=>{});
  assert(recovered.blocks.some(b=>b.space==='주방'&&b.kind==='text'&&b.text===kitchen));
  assert(recovered.generationWarnings.some(w=>w.includes('확인된 시공 항목으로 정리')));
});

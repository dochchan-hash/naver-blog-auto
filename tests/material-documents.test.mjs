import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {utils,write} from 'xlsx';
import sharp from 'sharp';
import {createServer} from '../server/index.mjs';
import {localApi} from '../scripts/local-api.mjs';
import {Store} from '../server/store.mjs';
import {AI} from '../server/ai.mjs';
import {draftSourceSignature,sourceSignature,materialReferences} from '../shared/sources.mjs';
import {COMPLETION_FORMAT,REFERENCE_FORMAT,CASE_FORMAT} from '../shared/format.mjs';
import {photoLayoutBlocks,missingSpaceDescriptions,publicationBlocks} from '../shared/domain.mjs';

const workbook=bookType=>{
  const b=utils.book_new();utils.book_append_sheet(b,utils.aoa_to_sheet([['공간','공사내용','수량'],['거실','실크벽지 도배',2]]),'공사범위');
  const second=utils.aoa_to_sheet([['공간','상세메모'],['현관','방화문 필름\n몰딩 리폼'],['수량',2]]);second.B3={t:'n',v:2,f:'1+1'};utils.book_append_sheet(b,second,'추가 내역');
  return write(b,{type:'buffer',bookType});
};
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-material-')),runtime=await createServer({dataDir:dir,port:0});t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});return {...runtime,...await localApi(runtime.url)};}
async function upload(runtime,p,role,bytes,name){const form=new FormData();form.append('file',new Blob([bytes]),name);const a=await runtime.request(`/projects/${p.id}/assets?role=${role}&classify=false`,'POST',form);await runtime.assets.queue;return runtime.store.asset(a.id);}

test('자재선정지 PDF의 텍스트를 읽고 원본을 보관한다',async t=>{
  const r=await fixture(t),p=r.store.createProject('completion'),content='BT /F1 16 Tf 40 720 Td (Material reference only. Living room wall: white silk wallpaper, selection pending.) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let text='%PDF-1.4\n';const offsets=[];for(const [i,obj]of objects.entries()){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
  const xref=Buffer.byteLength(text);text+=`xref\n0 6\n0000000000 65535 f \n${offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes=Buffer.from(text),a=await upload(r,p,'material-selection',bytes,'자재선정지.pdf');assert.equal(a.status,'ready');assert.equal(a.pages.length,1);assert.match(a.pages[0].text,/selection pending/);assert((await fs.readFile(r.assets.resolve(r.store.get('asset',a.id).originalPath))).equals(bytes));
});

for(const format of ['xlsx','biff8'])test(`${format} 공사범위와 자재선정지의 모든 시트를 읽고 사진 업로드는 거부한다`,async t=>{
  const r=await fixture(t),p=r.store.createProject('completion'),bytes=workbook(format),name=format==='xlsx'?'공사범위.xlsx':'공사범위.xls';
  for(const role of ['construction','material-selection']){
    const a=await upload(r,p,role,bytes,name);assert.equal(a.status,'ready');assert.equal(a.pages.length,2);assert.match(a.pages[0].text,/거실\t실크벽지 도배\t2/);assert.match(a.pages[1].text,/방화문 필름/);assert.match(a.pages[1].text,/몰딩 리폼/);assert.match(a.pages[1].text,/수량\t2/);assert.equal(a.previewUrl,`/api/assets/${a.id}/preview`);
    assert((await fs.readFile(r.assets.resolve(r.store.get('asset',a.id).originalPath))).equals(bytes));
  }
  await assert.rejects(upload(r,p,'photo',bytes,name),/엑셀은 공사범위 또는 자재선정지/);
  await assert.rejects(upload(r,p,'floorplan-original',bytes,name),/엑셀은 공사범위 또는 자재선정지/);
});

for(const encoding of ['utf8','utf16le','utf16be'])test(`HTML 표를 XLS로 내보낸 파일은 긴 스타일·여러 표·한글을 보존한다 · ${encoding}`,async t=>{
  const r=await fixture(t),p=r.store.createProject('completion');
  const html='<style>'+'.num { mso-number-format:0; }'.repeat(3500)+'</style><table><tr><th>현장</th><th>공사범위</th></tr><tr><td>가상 현장</td><td>확인된 내역</td></tr></table><table><tr><th>공간</th><th>시공내역</th></tr><tr><td>거실</td><td>실크벽지 도배</td></tr><tr><td>현관</td><td>방화문 필름</td></tr></table>';
  const bytes=Buffer.from((encoding!=='utf8'?'\ufeff':'')+html,encoding==='utf16be'?'utf16le':encoding);if(encoding==='utf16be')bytes.swap16();
  for(const role of ['construction','material-selection']){
    const a=await upload(r,p,role,bytes,'공사범위_테스트.xls');assert.equal(a.status,'ready');assert.equal(a.pages.length,2);assert.match(a.pages[0].text,/가상 현장/);assert.match(a.pages[1].text,/실크벽지 도배/);assert.match(a.pages[1].text,/방화문 필름/);assert((await fs.readFile(r.assets.resolve(r.store.get('asset',a.id).originalPath))).equals(bytes));
  }
  await assert.rejects(upload(r,p,'photo',bytes,'공사범위.xls'),/엑셀은 공사범위 또는 자재선정지/);
});

test('XML Spreadsheet 형식 XLS는 모든 시트를 읽고 일반 HTML·XML·텍스트의 이름만 바꾼 파일은 거부한다',async t=>{
  const r=await fixture(t),p=r.store.createProject('completion'),a=await upload(r,p,'construction',workbook('xlml'),'공사범위.xls');assert.equal(a.status,'ready');assert.equal(a.pages.length,2);assert.match(a.pages[0].text,/실크벽지 도배/);
  for(const text of ['공사범위 메모','<html><body>문서 이름만 엑셀</body></html>','<?xml version="1.0"?><root>일반 문서</root>'])await assert.rejects(upload(r,p,'construction',Buffer.from(text),'변경.xls'),/파일을 선택/);
});

test('선정지 JPG는 원본·미리보기를 보관하고 가짜 엑셀·손상된 통합문서는 시공 근거로 쓰지 않는다',async t=>{
  const r=await fixture(t),p=r.store.createProject(),jpg=await sharp({create:{width:30,height:30,channels:3,background:'#ddd'}}).jpeg().toBuffer();
  assert.equal((await upload(r,p,'material-selection',jpg,'자재선정지.jpg')).status,'ready');
  await assert.rejects(upload(r,p,'construction',Buffer.from('공사내용이라는 일반 글자'),'가짜.xlsx'),/파일을 선택/);
  const broken=await upload(r,p,'material-selection',Buffer.from([80,75,3,4,1,2,3,4]),'손상.xlsx');assert.equal(broken.status,'error');assert.match(broken.warning,/원본은 저장되었습니다/);assert.equal(materialReferences([broken]).length,0);
});

test('자재선정지 분석은 공사범위 사실·템플릿 값·카페 대조 결과에 섞이지 않는다',async t=>{
  const r=await fixture(t),p=r.store.createProject('completion');
  const scope=await upload(r,p,'construction',workbook('xlsx'),'범위.xlsx'),selection=await upload(r,p,'material-selection',workbook('xlsx'),'선정.xlsx');
  r.ai.call=async(instructions,content)=>{
    assert(content.every(c=>c.type==='input_text'),'셀 텍스트를 다시 이미지로 분석하지 않습니다.');
    return {facts:[{space:'거실',item:instructions.includes('보조 참고용')?'원목마루 선정 예정':'실크벽지 도배',uncertain:false}],warnings:[]};
  };
  await r.ai.analyzeMaterials(p.id,()=>{});const current=r.store.get('project',p.id),assets=r.store.assets(p.id);
  assert(current.facts.length>0);assert(current.facts.every(f=>f.sourceAssetId===scope.id));assert(!current.facts.some(f=>f.item.includes('원목마루')));
  const refs=materialReferences(assets);assert.equal(refs.length,1);assert(refs[0].items.every(f=>f.item==='원목마루 선정 예정'));
  const without=assets.filter(a=>a.id!==selection.id);assert.equal(sourceSignature(current,assets),sourceSignature(current,without));assert.notEqual(draftSourceSignature(current,assets),draftSourceSignature(current,without));
  const facts=structuredClone(current.facts);await r.ai.analyzeMaterials(p.id,()=>{});assert.deepEqual(r.store.get('project',p.id).facts,facts,'캐시 재사용 시에도 선정지를 시공내역으로 승격하지 않습니다.');
});

for(const postType of ['recommendation','case','completion'])test(`${postType} 선정지는 후순위 문맥에만 넣고 기존 콘텐츠 문체·시공근거를 유지한다`,async t=>{
  const r=await fixture(t),p=r.store.createProject(postType),format=postType==='completion'?COMPLETION_FORMAT:postType==='case'?CASE_FORMAT:REFERENCE_FORMAT;
  r.store.updateProject(p.id,{original:{...p.original,name:'원본단지'},target:{...p.target,name:'추천단지'},keywords:[],facts:[{id:'wall',space:'거실',item:'실크벽지 도배',sourceLabel:'공사범위',confirmed:true,uncertain:false}]});
  r.store.put('style',postType==='recommendation'?'main':postType,{rules:'저장된 콘텐츠 말투',referenceUrls:[],status:'edited',formatProfile:format});
  r.store.put('asset','photo',{id:'photo',projectId:p.id,role:'photo',status:'ready',space:'거실',order:0,hash:'photo',analysis:{description:'가구와 소품이 놓여 있습니다.'}});
  r.store.put('asset','ref',{id:'ref',projectId:p.id,role:'material-selection',status:'ready',filename:'선정지.jpg',hash:'ref',analysis:{facts:[{space:'거실',item:'원목마루 선정 예정'}]}});
  r.ai.analyzeMaterials=async()=>{};
  r.ai.call=async(instructions,content)=>{
    const input=JSON.parse(content[0].text);
    if(instructions.startsWith('공간별 시공 분류')){assert(!input.materialReferences);return {items:[{space:'거실',item:'실크벽지 도배',sourceIds:['fact:0'],photoIds:[]}],warnings:[]};}
    if(instructions.startsWith('본문 시공 대조'))return {checks:[{workId:'work-1',blockId:input.blocks.find(b=>b.space==='거실'&&b.role==='body').id,quote:'실크벽지로 도배'}],issues:[]};
    const context=input.context||input;assert.equal(context.materialReferences[0].items[0].item,'원목마루 선정 예정');assert.equal(context.facts[0].item,'실크벽지 도배');assert.match(instructions,/공사범위보다 후순위|공사범위의 작업.*우선/);assert.equal(instructions.includes('[마감 시공 근거 우선 규칙]'),postType==='completion');
    return {title:'인테리어 소개',summary:'정돈한 벽면',intro:'안녕하세요.',sections:[{space:'거실',text:'실크벽지로 도배해 벽면을 정돈했습니다.',points:[]}],outro:'감사합니다.',tags:[],warnings:[]};
  };
  const {project}=await r.ai.generate(p.id,()=>{});assert(project.blocks.some(b=>b.text?.includes('실크벽지로 도배')));assert(!project.blocks.some(b=>b.text?.includes('원목마루')));assert(!publicationBlocks(project,r.store.assets(p.id)).some(b=>b.assetIds?.includes('ref')));
});

test('마감은 두 문서가 모두 없어도 정상 생성하며 확인되지 않은 분위기 문장을 사진만으로 바꾸고 사진 배치를 보존한다',async t=>{
  const r=await fixture(t),p=r.store.createProject('completion');r.store.updateProject(p.id,{original:{...p.original,name:'확인 현장'},keywords:[]});r.store.put('style','completion',{rules:'친근한 소개',referenceUrls:[],status:'edited',formatProfile:COMPLETION_FORMAT});
  for(let i=0;i<4;i++)r.store.put('asset','photo'+i,{id:'photo'+i,projectId:p.id,role:'photo',status:'ready',space:'거실',order:i,hash:'p'+i,analysis:{description:'확인된 시공은 없습니다.'}});
  r.ai.analyzeMaterials=async()=>{};r.ai.call=async()=>({title:'현장 소개',intro:'안녕하세요. 현장을 함께 살펴보세요.',sections:[{space:'거실',text:'기존 가구와 소품이 아늑한 분위기를 만듭니다.',points:[]}],outro:'감사합니다.',tags:[],warnings:[]});
  const {project}=await r.ai.generate(p.id,()=>{}),assets=r.store.assets(p.id);assert(!project.blocks.some(b=>b.text?.includes('소품')));assert(project.generationWarnings.some(w=>w.includes('확인된 시공내역이 없어 사진만')));assert.equal(project.blocks.filter(b=>b.kind==='photos').flatMap(b=>b.assetIds).length,4);assert.deepEqual(missingSpaceDescriptions(project,assets),[]);
  const layout=photoLayoutBlocks(project,assets);assert.equal(layout.filter(b=>b.kind==='photos').flatMap(b=>b.assetIds).length,4);assert.deepEqual(layout.filter(b=>b.kind==='photos').map(b=>b.assetIds.length),[1,3]);
});

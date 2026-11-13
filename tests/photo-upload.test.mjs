import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {photoUploadBlocks} from '../shared/photo-layout.mjs';
import {Naver,editorMatches} from '../server/naver.mjs';
import {editorFormatIssue} from '../shared/format.mjs';
import {exportHtml} from '../shared/domain.mjs';

test('사진 묶음은 10장씩 나누며 문단·사진 순서·슬라이드 형식과 원본을 유지한다',()=>{
 for(const size of [0,1,9,10,11,20,21,60]){
  const original=[{id:'before',kind:'text',text:'앞 문단'},{id:'photos',kind:'photos',space:'거실',layout:'slide',assetIds:Array.from({length:size},(_,i)=>'p'+i)},{id:'after',kind:'text',text:'뒤 문단'}],snapshot=structuredClone(original),parts=photoUploadBlocks(original),photos=parts.filter(b=>b.kind==='photos');
  assert(photos.every(b=>b.assetIds.length<=10));assert.deepEqual(photos.flatMap(b=>b.assetIds),original[1].assetIds);assert(photos.every(b=>b.space==='거실'&&b.layout==='slide'));assert.equal(parts[0],original[0]);assert.equal(parts.at(-1),original.at(-1));assert.equal(photos[0].id,'photos');assert.equal(new Set(parts.map(b=>b.id)).size,parts.length);assert.deepEqual(original,snapshot);assert.deepEqual(photoUploadBlocks(parts),parts);
 }
});

for(const postType of ['recommendation','case','completion'])for(const layout of [undefined,'collage','slide'])test(`${postType} ${layout||'기본'}: 23장 묶음을 10·10·3장으로 올린 뒤 본문을 계속 작성한다`,async()=>{
 const ids=Array.from({length:23},(_,i)=>'p'+i),assets=ids.map(id=>({id,projectId:'p',role:'photo',originalPath:id})),events=[],groups=[],blocks=[{id:'photo',kind:'photos',space:'거실',layout,assetIds:ids},{id:'after',kind:'text',text:'사진 다음 설명'}],project={id:'p',postType,blocks};let count=0,pending=[];
 const bridge={appendParagraph:async()=>events.push('paragraph'),evaluate:async(fn,arg)=>{
   const source=fn.toString();if(source.includes('input[type='))return true;
   if(source.includes('se-l-'))return groups.at(-1)?.length===arg.count&&arg.layout===layout;
   if(pending.length){groups.push(pending);count+=pending.length;events.push('uploaded');pending=[];}return count;
 },upload:async files=>{assert(files.length<=10);assert.equal(pending.length,0);pending=files;events.push([...files]);},click:async(selector,options)=>{if(selector==='button,label')assert.equal(options.text,layout==='slide'?'슬라이드':'콜라주');return false;}};
 const naver=new Naver({assets:()=>assets,get:(kind,id)=>assets.find(a=>a.id===id)},{originalForUpload:async a=>a.originalPath},bridge);naver.pasteParagraphs=async b=>events.push(b.text);
 await naver.writeBlocks(project,()=>{});
 assert.deepEqual(groups.map(g=>g.length),[10,10,3]);assert.deepEqual(groups.flat(),ids);assert.equal(events.at(-1),'사진 다음 설명');assert.equal(events.filter(e=>e==='uploaded').length,3);assert.deepEqual(blocks[0].assetIds,ids);
});

test('분할한 사진 묶음으로 서식과 완료를 검사하며 10장 이후 사진 누락·잘못된 레이아웃은 거부한다',()=>{
 const ids=Array.from({length:21},(_,i)=>'p'+i),project={title:'검증',blocks:[{id:'all',kind:'photos',space:'거실',layout:'slide',assetIds:ids}]},components=[10,10,1].map(photoCount=>({class:'se-component '+(photoCount>1?'se-imageGroup se-l-slide':'se-image'),photoCount})),state={title:project.title,text:'',photoBlocks:[10,10,1],components,paragraphs:[]};
 assert(editorMatches(project,state));assert.equal(editorFormatIssue(project,state),'');assert(!editorMatches(project,{...state,photoBlocks:[10,10]}));assert.match(editorFormatIssue(project,{...state,components:components.slice(0,2)}),/순서/);assert.match(editorFormatIssue(project,{...state,components:[components[0],{...components[1],class:'se-component se-imageGroup se-l-collage'},components[2]]}),/슬라이드/);
 const html=exportHtml({...project,tags:[]},ids.map(id=>({id,space:'거실',originalUrl:'/photo/'+id})));assert.deepEqual([...html.matchAll(/<div style="display:flex[^>]*>(.*?)<\/div>/g)].map(m=>[...m[1].matchAll(/<img /g)].length),[10,10,1]);
});

test('네이버에서 공사범위와 표지 원본을 1:1로 묶고 왼쪽 사진을 대표로 지정한 뒤 공간 사진을 올린다',async()=>{
 const ids=Array.from({length:20},(_,i)=>'p'+i),project={id:'p',postType:'case',templatePhotoId:'raw',blocks:[{id:'cover',kind:'photos',space:'표지',assetIds:['cover']},{id:'plan',kind:'photos',space:'도면',assetIds:['scope']},{id:'all',kind:'photos',space:'거실',assetIds:['raw',...ids]}]},assets=['cover','raw','scope',...ids].map(id=>({id,projectId:'p',role:id==='raw'?'template-photo':'photo',templateOutput:id==='scope'?'scope':undefined,status:'ready'}));let count=0;const uploads=[];
 const bridge={appendParagraph:async()=>{},evaluate:async fn=>fn.toString().includes('se-l-')||fn.toString().includes('input[type=')?true:count,upload:async files=>{uploads.push(files);count+=files.length;},click:async()=>false};
 const naver=new Naver({assets:()=>assets,get:(kind,id)=>assets.find(a=>a.id===id)},{originalForUpload:async a=>a.id,planPhotoForUpload:async a=>`square-${a.id}`},bridge);
 const marked=[];naver.verifyPlanCollage=async(...args)=>marked.push(args);
 await naver.writeBlocks(project,()=>{});
 assert.deepEqual(uploads,[['cover'],['square-raw','square-scope'],ids.slice(0,10),ids.slice(10)]);assert.deepEqual(marked,[[1,true]]);
});

test('왼쪽 대표사진 버튼이 뒤늦게 나타나도 활성화하고 클릭한 뒤 실제 선택 상태를 확인한다',async()=>{
 let representative=1,activated=false;
 const calls=[];
 const modules=[0,1].map(i=>({dataset:{},querySelector:selector=>selector==='img'?{naturalWidth:300,naturalHeight:200,getBoundingClientRect:()=>({width:100,height:100})}:i===0&&!activated?null:{classList:{contains:()=>representative===i},getAttribute:()=>null,matches:()=>false,click:()=>assert.fail('실제 버튼 클릭 경로를 사용해야 합니다.')}}));
 const group={querySelectorAll:()=>modules,matches:selector=>selector==='.se-imageGroup.se-l-collage'};
 const bridge={evaluate:async(fn,arg)=>vm.runInNewContext(`(${fn.toString()})(arg)`,{arg,document:{querySelectorAll:()=>[{},group]}}),clickVerifiedButton:async selector=>{assert.equal(modules[0].dataset.lemonPlanPhoto,'true');calls.push(selector);if(selector.endsWith(' .se-image-resource'))activated=true;else representative=0;}};
 const result=await new Naver({}, {},bridge).verifyPlanCollage(1,true);
 assert.deepEqual(calls,['[data-lemon-plan-photo] .se-image-resource','[data-lemon-plan-photo] button.se-set-rep-image-button']);assert.equal(result.square,true);assert.deepEqual(Array.from(result.representative),[true,false]);
});

test('빠진 원본은 업로드 전에 거부하고 중간 업로드 실패 시 다음 묶음을 진행하지 않는다',async()=>{
 const ids=Array.from({length:21},(_,i)=>'p'+i),project={id:'p',postType:'case',blocks:[{kind:'photos',assetIds:ids}]},assets=ids.map(id=>({id,projectId:'p',role:'photo'}));let uploads=0,count=0;
 const bridge={appendParagraph:async()=>{},evaluate:async(fn,arg)=>fn.toString().includes('se-l-')?true:fn.toString().includes('input[type=')?true:count,upload:async files=>{if(++uploads===2)throw Error('업로드 실패');count+=files.length;},click:async()=>false},store={assets:()=>assets,get:(kind,id)=>assets.find(a=>a.id===id)},naver=new Naver(store,{originalForUpload:async a=>a.id},bridge);
 await assert.rejects(naver.writeBlocks(project,()=>{}),/업로드 실패/);assert.equal(uploads,2);assert.equal(count,10);
 assets.splice(0,1);uploads=0;await assert.rejects(naver.writeBlocks(project,()=>{}),/원본/);assert.equal(uploads,0);
});

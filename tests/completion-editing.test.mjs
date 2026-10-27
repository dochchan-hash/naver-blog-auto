import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createCanvas,loadImage} from '@napi-rs/canvas';import {writePsdBuffer} from 'ag-psd';
import {completionRows,completionBands,completionPhotos,completionMarkers,completionPan,completionSignature} from '../shared/completion-templates.mjs';
import {completionBlocks,newProject,photoLayoutBlocks,draftWarnings} from '../shared/domain.mjs';import {COMPLETION_FORMAT} from '../shared/format.mjs';
import {renderCompletionLayout} from '../server/completion-templates.mjs';import {createServer} from '../server/index.mjs';import {localApi} from '../scripts/local-api.mjs';
const photo=(id,x,y,w=100,h=100)=>({id,name:id+' A',kind:'photo',x,y,width:w,height:h,file:'mask.png',opacity:1});
const layout={id:'main',position:'beforeAfter',width:200,height:330,elements:[photo('a',0,0),photo('b',100,0),photo('c',0,110),photo('d',100,110),photo('e',0,220),photo('f',100,220)]};
test('공간 삭제는 전·후 칸을 함께 빼고 다음 공간을 올리며 사진 인덱스를 바꾸지 않는다',()=>{
 const slot={position:'beforeAfter',photoIds:['1','2','3','4','5','6'],removedRows:['c']};
 assert.equal(completionRows(layout).length,3);assert.deepEqual(completionBands(slot,layout).map(b=>[b.y,b.top,b.height]),[[0,0,110],[220,110,110]]);assert.deepEqual(completionPhotos(slot,layout).map(p=>p.id),['1','2','5','6']);
 assert.deepEqual(completionPhotos({...slot,removedRows:[]},layout).map(p=>p.id),['1','2','3','4','5','6']);assert.equal(completionPhotos({...slot,edits:{a:{photoId:''}}},layout)[0].id,'');
 const crop=completionPan({zoom:2},photo('p',0,0),{width:200,height:100},500,-500);assert.deepEqual(crop,{cropX:100,cropY:-100});assert.deepEqual(completionPan({},photo('p',0,0),{width:100,height:100},30,30),{cropX:60,cropY:60});
});
test('비포애프터 JPG도 공간을 압축하고 포인트 번호 1~5를 사진 안에 합성한다',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-editing-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'template'));
 const mask=createCanvas(100,100);mask.getContext('2d').fillRect(0,0,100,100);await fs.writeFile(path.join(dir,'template/mask.png'),mask.toBuffer('image/png'));
 const assets=['red','green','blue'].map((color,i)=>({id:color,projectId:'p',role:'photo',status:'ready',originalPath:color+'.png',hash:color}));
 for(const asset of assets){const image=createCanvas(100,100),c=image.getContext('2d');c.fillStyle=asset.id;c.fillRect(0,0,100,100);await fs.writeFile(path.join(dir,asset.originalPath),image.toBuffer('image/png'));}
 const project=newProject('p','completion'),slot={id:'s',position:'beforeAfter',photoIds:['red','red','green','green','blue','blue'],removedRows:['c']},template={id:'template',layouts:[layout]},rendered=await renderCompletionLayout(template,slot,project,assets,p=>path.join(dir,p)),image=await loadImage(rendered.buffer),sample=createCanvas(200,220),c=sample.getContext('2d');c.drawImage(image,0,0);
 assert.equal(image.height,220);assert.equal(rendered.missing.length,0);assert(c.getImageData(50,50,1,1).data[0]>220);assert(c.getImageData(50,160,1,1).data[2]>220);
  const shifted=await renderCompletionLayout(template,{...slot,edits:{a:{cropX:100}}},project,assets,p=>path.join(dir,p));c.drawImage(await loadImage(shifted.buffer),0,0);assert(c.getImageData(25,50,1,1).data[1]>230);assert(c.getImageData(75,50,1,1).data[0]>220&&c.getImageData(75,50,1,1).data[1]<40);
 const pointLayout={...layout,position:'space',height:330,elements:[photo('point',0,0,200,330)]},point={id:'point',position:'space',photoIds:['blue'],markers:[1,2,3,4,5].map((number,i)=>({number,x:25,y:10+i*55}))};
 const numbered=await renderCompletionLayout({id:'template',layouts:[pointLayout]},point,project,assets,p=>path.join(dir,p));const n=await loadImage(numbered.buffer),nc=createCanvas(200,330).getContext('2d');nc.drawImage(n,0,0);for(const m of point.markers){const pixel=nc.getImageData(m.x+5,m.y+13,1,1).data;assert(pixel[0]>200&&pixel[2]<90);}
 assert.equal(completionMarkers(point,pointLayout).length,5);assert.notEqual(completionSignature(project,point,assets),completionSignature(project,{...point,markers:point.markers.slice(0,4)},assets));
});
test('60장 한 공간도 첫 사진 한 장·설명·최대 10장씩 슬라이드로 나누며 모두 한 번씩 쓴다',()=>{
 const p={...newProject('p','completion'),completionTemplates:[{id:'point',position:'space',space:'거실',templateId:'psd',photoIds:[]}],keywords:[],original:{name:'테스트 현장'},formatProfile:COMPLETION_FORMAT},assets=[{id:'point',role:'photo',templateSlotId:'point',space:'거실',order:0,status:'ready'},...Array.from({length:60},(_,i)=>({id:'p'+i,role:'photo',space:'거실',group:'all',order:i+1,status:'ready'}))];
 p.blocks=completionBlocks(p,assets,{intro:'인사',sections:[{space:'거실',points:[{title:'포인트',text:'검은 설명'}],text:'공간 설명'}],outro:'마무리'},COMPLETION_FORMAT);
 const blocks=p.blocks.filter(b=>b.space==='거실'),summary=blocks.findIndex(b=>b.kind==='text'&&!b.formatRole);assert.deepEqual(blocks.slice(0,5).map(b=>b.formatRole||b.kind),['quote','photos','point','pointBody','photos']);assert.deepEqual(blocks[summary-1].assetIds,['p0']);assert.equal(blocks[summary-1].layout,undefined);assert(blocks.slice(summary+1).every(b=>b.layout==='slide'&&b.assetIds.length<=10));
 const ids=p.blocks.filter(b=>b.kind==='photos').flatMap(b=>b.assetIds);assert.equal(ids.length,61);assert.equal(new Set(ids).size,61);assert(!draftWarnings(p,assets).some(w=>w.includes('사진 순서')));assert.deepEqual(photoLayoutBlocks(p,assets).map(b=>({...b,id:''})),p.blocks.map(b=>({...b,id:''})));
});

for(const count of [1,2,3,11,12,21])test(`마감 ${count}장: 묶음과 관계없이 첫 사진 단독·기존 설명·나머지 슬라이드 순서를 유지한다`,()=>{
 const p=newProject('p','completion'),assets=Array.from({length:count},(_,i)=>({id:'p'+i,role:'photo',space:'거실',group:i<2?'first':'rest',order:i,status:'ready'})).reverse(),original=structuredClone(assets);
 const result={intro:'인사',sections:[{space:'거실',text:'직접 수정한 공간 설명'}],outro:'마무리'},expected=completionBlocks(p,assets,result,COMPLETION_FORMAT);
 const legacy=expected.filter(b=>b.kind!=='photos'),heading=legacy.findIndex(b=>b.space==='거실');legacy.splice(heading+1,0,{id:'old-collage',kind:'photos',space:'거실',layout:'collage',assetIds:original.slice().reverse().map(a=>a.id)});
 for(const blocks of [expected,photoLayoutBlocks({...p,blocks:legacy},assets)]){
  const space=blocks.filter(b=>b.space==='거실'),photos=space.filter(b=>b.kind==='photos');assert.deepEqual(space.slice(0,3).map(b=>b.kind),['quote','photos','text']);assert.equal(space[2].text,result.sections[0].text);assert.deepEqual(photos[0].assetIds,['p0']);assert.equal(photos[0].layout,undefined);
  assert.deepEqual(photos.flatMap(b=>b.assetIds),Array.from({length:count},(_,i)=>'p'+i));assert(photos.slice(1).every(b=>b.assetIds.length<=10&&b.layout===(b.assetIds.length>1?'slide':undefined)));assert.equal(photos.length,1+Math.ceil((count-1)/10));
 }
 assert.deepEqual(assets,original);
});
test('사진 직접 첨부는 AI 자동 분석 없이 등록하고 공간·번호·다른 현장·레이어 경계를 검사한다',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-editing-api-')),runtime=await createServer({dataDir:path.join(dir,'.local'),port:0});t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});const {request}=await localApi(runtime.url);let p=await request('/projects','POST',{postType:'completion'});let calls=0;runtime.auth.status=()=>({connected:true});runtime.ai.analyzeAsset=async()=>{calls++;};
 const mask=createCanvas(100,100);mask.getContext('2d').fillRect(0,0,100,100);const bytes=writePsdBuffer({width:200,height:330,children:layout.elements.map(e=>({name:e.name,left:e.x,top:e.y,canvas:mask}))});const form=new FormData();form.append('file',new Blob([bytes]),'비포애프터.psd');const template=await request('/projects/'+p.id+'/assets?role=template','POST',form),image=new FormData();image.append('file',new Blob([mask.toBuffer('image/png')]),'사진.png');const asset=await request('/projects/'+p.id+'/assets?role=photo&classify=false','POST',image);await runtime.assets.queue;await runtime.ai.photoQueue;assert.equal(calls,0);
 p=runtime.store.get('project',p.id);const slot={...p.completionTemplates.find(s=>s.templateId===template.id),photoIds:Array(6).fill(asset.id),removedRows:[template.layouts[0].elements[2].id]};p=await request('/projects/'+p.id,'PUT',{...p,completionTemplates:[slot]});assert.equal(p.completionTemplates[0].removedRows.length,1);
 await assert.rejects(request('/projects/'+p.id,'PUT',{...p,completionTemplates:[{...slot,removedRows:completionRows(template.layouts[0]).map(r=>r.id)}]}),/한 개 이상/);
 for(const markers of [[{number:6,x:0,y:0}],[{number:1,x:190,y:0}],[{number:1,x:0,y:0},{number:1,x:5,y:5}]])await assert.rejects(request('/projects/'+p.id,'PUT',{...p,completionTemplates:[{...slot,position:'space',markers}]}));
 const response=await fetch(runtime.url+'/api/assets/'+template.id+'/element/'+template.layouts[0].elements[0].id);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal((await fetch(runtime.url+'/api/assets/'+template.id+'/element/not-a-layer')).status,404);assert.equal((await fetch(runtime.url+'/api/template-font/500')).status,200);
});

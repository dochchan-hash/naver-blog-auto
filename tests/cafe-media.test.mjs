import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {completionBlocks,completionMediaBlocks,photoLayoutBlocks,newProject} from '../shared/domain.mjs';
import {COMPLETION_FORMAT,editorFormatIssue} from '../shared/format.mjs';
import {createServer} from '../server/index.mjs';
import {localApi} from '../scripts/local-api.mjs';
import {Naver} from '../server/naver.mjs';

test('카페는 인사 뒤 지도, 마지막 안내 사진 앞 동영상을 놓고 사진 재배치에도 보존한다',()=>{
 const p={...newProject('media','completion'),original:{name:'현장 단지',region:'서울'},title:'마감 제목',completionVideoId:'video'},assets=[{id:'photo',role:'photo',space:'거실',order:0},{id:'last',role:'photo',space:'마무리',order:1},{id:'video',role:'video',status:'ready',filename:'현장.mp4'}];
 const blocks=completionBlocks(p,assets,{intro:'인사',sections:[{space:'거실',text:'공간 설명',points:[]}],outro:'마무리',phone:'1644-0402'},COMPLETION_FORMAT);
 assert.equal(blocks[1].kind,'map');assert.equal(blocks[1].text,'현장 단지 서울');assert.equal(blocks.at(-2).kind,'video');assert.equal(blocks.at(-1).space,'마무리');
 p.blocks=blocks;assert.deepEqual(completionMediaBlocks(p,assets),blocks);assert.deepEqual(photoLayoutBlocks(p,assets).map(b=>({...b,id:''})),blocks.map(b=>({...b,id:''})));
 assert(!completionMediaBlocks({...p,completionVideoId:''},assets).some(b=>b.kind==='video'));assert.equal(completionMediaBlocks({...p,postType:'case'},assets),blocks);
});
test('포인트 사이 실제 빈 줄과 지도·동영상의 순서를 확인한다',()=>{
 const blocks=[{kind:'map',text:'현장'},{kind:'text',formatRole:'point',text:'1. 조명'},{kind:'text',formatRole:'pointBody',text:'첫 설명'},{kind:'text',formatRole:'point',text:'2. 가구'},{kind:'text',formatRole:'pointBody',text:'둘째 설명'},{kind:'video',text:'현장 영상'}];
 const project={postType:'completion',blocks},span=(text,style)=>({text,fontFamily:style.fontFamily,fontWeight:String(style.fontWeight),fontSize:style.fontSize+'px',color:style.color,backgroundColor:style.backgroundColor});
 const paragraphs=blocks.filter(b=>b.kind==='text').map(b=>({align:'left',spans:[span(b.text,b.formatRole==='point'?COMPLETION_FORMAT.textStyles.point[0]:COMPLETION_FORMAT.body)]}));
 const components=blocks.map(b=>({class:'se-component '+(b.kind==='map'?'se-placesMap':b.kind==='video'?'se-video':'se-text'),text:b.text})),state={components,paragraphs};
 assert.match(editorFormatIssue(project,state),/번호 사이/);paragraphs.splice(2,0,{blank:true,align:'left',spans:[]});assert.equal(editorFormatIssue(project,state),'');
 components.reverse();assert.match(editorFormatIssue(project,state),/순서/);
});
test('동영상은 카페에만 첨부하고 다른 원고의 파일·사진칸 혼용을 거부한다',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cafe-media-')),r=await createServer({dataDir:dir,port:0});t.after(async()=>{await r.close();await fs.rm(dir,{recursive:true,force:true});});
 const {request}=await localApi(r.url),p=await request('/projects','POST',{postType:'completion'}),bytes=Buffer.from('000000206674797069736f6d00000000','hex');
 const upload=(id,role,data=bytes)=>{const form=new FormData();form.append('file',new Blob([data]),'sample.mp4');return request(`/projects/${id}/assets?role=${role}`,'POST',form);};
 const video=await upload(p.id,'video');assert.equal(video.mime,'video/mp4');assert.equal(video.status,'ready');assert.equal(video.previewBytes,undefined);
 await assert.rejects(upload(p.id,'photo'),/동영상은/);await assert.rejects(upload(p.id,'video',Buffer.from('not a video')),/MP4/);
 const blog=await request('/projects','POST',{postType:'case'});await assert.rejects(upload(blog.id,'video'),/카페 마감/);
 const saved=await request('/projects/'+p.id,'PUT',{...p,blocks:[{id:'v',kind:'video',assetIds:[video.id],text:'영상 제목'}]});assert.equal(saved.blocks[0].text,'영상 제목');
 const other=await request('/projects','POST',{postType:'completion'});await assert.rejects(request('/projects/'+other.id,'PUT',{...other,blocks:saved.blocks}),/다른 원고/);
 await assert.rejects(request('/projects/'+saved.id,'PUT',{...saved,blocks:[{id:'m',kind:'map',text:' '}]}),/지도 검색어/);
});
test('포인트 간 빈 문단은 네이버 실제 입력에서도 추가한다',async()=>{
 const events=[],bridge={appendParagraph:async()=>events.push('append'),key:async key=>events.push(key),click:async()=>{}},naver=new Naver({assets:()=>[]},{},bridge);naver.pasteParagraphs=async b=>events.push(b.text);
 await naver.writeBlocks({id:'p',postType:'completion',blocks:[{kind:'text',formatRole:'point',text:'1. 조명'},{kind:'text',formatRole:'pointBody',text:'첫 설명'},{kind:'text',formatRole:'point',text:'2. 가구'}]},()=>{});
 assert.deepEqual(events,['append','1. 조명','append','첫 설명','append','Return','2. 가구']);
});
test('동영상 제목·정보는 각각 입력하고 키 이벤트로 확정한 뒤 완료한다',async()=>{
 const reads=[0,true,true,true,false,true,'짧은 영상 제목'],calls=[],bridge={frame:async()=>true,evaluate:async(fn,arg,options)=>{if(options?.userGesture)calls.push('done');return reads.shift();},click:async selector=>calls.push(selector),upload:async(files,trigger)=>{assert.deepEqual(files,['/original.mp4']);await trigger();},text:async(selector,text)=>calls.push([selector,text]),key:async key=>calls.push(key),clickNative:async selector=>calls.push(selector)};
 const naver=new Naver({get:()=>({id:'v',projectId:'p',role:'video',status:'ready',filename:'v.mp4',originalPath:'original.mp4'})},{resolve:()=>'/original.mp4'},bridge);
 naver.setVideoTags=async tags=>assert.deepEqual(tags,['게시글태그']);naver.verifyVideoTags=async tags=>assert.deepEqual(tags,['게시글태그']);
 await naver.insertVideo({kind:'video',assetIds:['v'],text:'짧은 영상 제목'},'p',['게시글태그']);assert(calls.includes('done'));assert.equal(calls.filter(c=>c==='.nvu_btn_submit').length,2);assert.equal(calls.filter(c=>c==='End').length,2);assert(!calls.includes('button'));assert(calls.some(c=>Array.isArray(c)&&c[0].includes('description')&&c[1]==='짧은 영상 제목'));
});

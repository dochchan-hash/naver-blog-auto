import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {AI} from '../server/ai.mjs';
import {Naver} from '../server/naver.mjs';
import {createServer} from '../server/index.mjs';
import {localApi} from '../scripts/local-api.mjs';
import {newProject,postVideoBlocks,photoLayoutBlocks} from '../shared/domain.mjs';
import {REFERENCE_FORMAT,CASE_FORMAT,COMPLETION_FORMAT} from '../shared/format.mjs';

for(const postType of ['recommendation','case','completion']){
 test(`${postType}: 영상 선택·교체·해제와 사진 재배치가 본문·영상 제목을 유지한다`,()=>{
  const project={...newProject('p',postType),title:'새 제목',completionVideoId:'v',blocks:[{id:'intro',kind:'text',text:'직접 쓴 인사'},{id:'space',kind:'quote',space:'거실',text:'거실'},{id:'body',kind:'text',space:'거실',text:'직접 쓴 설명'},{id:'last',kind:'photos',space:'마무리',assetIds:['last']}]},assets=[{id:'photo',role:'photo',space:'거실',order:0},{id:'last',role:'photo',space:'마무리',order:1},...['v','v2'].map(id=>({id,role:'video',status:'ready',filename:id+'.mp4'}))];
  const before=structuredClone(project),blocks=postVideoBlocks(project,assets);assert.deepEqual(project,before);assert.equal(blocks.at(postType==='completion'?-2:-1).text,'새 제목');assert.equal(blocks.filter(b=>b.kind==='video').length,1);
  const custom=blocks.map(b=>b.kind==='video'?{...b,text:'직접 수정한 영상 제목'}:b);assert.deepEqual(postVideoBlocks(project,assets,custom),custom);assert(!postVideoBlocks({...project,completionVideoId:''},assets,custom).some(b=>b.kind==='video'));
  const replaced=postVideoBlocks({...project,completionVideoId:'v2'},assets,custom).find(b=>b.kind==='video');assert.equal(replaced.text,'새 제목');assert.deepEqual(replaced.assetIds,['v2']);
  const relayout=photoLayoutBlocks({...project,blocks:custom},assets);assert.equal(relayout.find(b=>b.kind==='video').text,'직접 수정한 영상 제목');assert.equal(relayout.at(postType==='completion'?-2:-1).kind,'video');assert.equal(relayout.find(b=>b.id==='body').text,'직접 쓴 설명');
 });
 test(`${postType}: AI 원고 생성 후 하단 영상이 들어가며 사진·영상은 별도로 취급한다`,async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-video-ai-')),store=new Store(dir);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});
  const p=store.createProject(postType);store.updateProject(p.id,{original:{...p.original,name:'실제 현장'},target:{...p.target,name:'추천 현장'},completionVideoId:'v',keywords:[]});store.put('style',postType==='completion'?'completion':postType==='case'?'case':'main',{status:'edited',rules:'현재 콘텐츠의 규칙',referenceUrls:[],formatProfile:postType==='completion'?COMPLETION_FORMAT:postType==='case'?CASE_FORMAT:REFERENCE_FORMAT});
  store.put('asset','photo',{id:'photo',projectId:p.id,role:'photo',status:'ready',space:'거실',order:0,hash:'photo'});store.put('asset','v',{id:'v',projectId:p.id,role:'video',status:'ready',filename:'현장.mp4',hash:'video'});
  const ai=new AI(store,{}, {},{});ai.analyzeMaterials=async()=>{};ai.call=async(_,content)=>{const input=JSON.parse(content[0].text);assert.equal(input.photos.length,1);return {title:'새로 작성한 제목',summary:'현장 콘셉트',intro:'안녕하세요.',sections:[{space:'거실',text:'편안한 생활 공간입니다.',points:[]}],outro:'감사합니다.',tags:['인테리어'],warnings:[]};};
  const {project}=await ai.generate(p.id,()=>{});assert.equal(project.blocks.at(-1).kind,'video');assert.equal(project.blocks.at(-1).text,project.title);assert.deepEqual(project.blocks.at(-1).assetIds,['v']);
 });
 test(`${postType}: 영상 태그가 입력 한도를 넘으면 원고를 전송하기 전에 안내한다`,async()=>{
  const project={...newProject('p',postType),blocks:[{kind:'video',assetIds:['v']}],tags:Array.from({length:11},(_,i)=>'태그'+i)};let called=false;
  const naver=new Naver({get:kind=>kind==='project'?project:{blogId:'assigned'},assets:()=>[]},{},{exclusive:()=>{called=true;throw Error('전송 금지');}});
  await assert.rejects(postType==='completion'?naver.prepareCafe(project.id,()=>{}):naver.publish(project.id,()=>{},{prepareOnly:true}),/최대 10개/);assert.equal(called,false);
 });
 test(`${postType}: 네이버 입력은 본문 뒤 영상에 게시글 태그 전체를 전달한다`,async()=>{
  const tags=['파크타운서안','인테리어','레몬하우스'],calls=[],project={id:'p',postType,tags,blocks:[{kind:'text',text:'마무리 인사'},{kind:'video',assetIds:['v'],text:'현장 영상'}]},bridge={appendParagraph:async()=>{},click:async()=>{}};
  const naver=new Naver({assets:()=>[]},{},bridge);naver.pasteParagraphs=async b=>calls.push(b.text);naver.insertVideo=async(b,id,videoTags)=>calls.push({title:b.text,id,tags:videoTags});await naver.writeBlocks(project,()=>{});
  assert.deepEqual(calls,['마무리 인사',{title:'현장 영상',id:'p',tags}]);
 });
}

test('세 콘텐츠 모두 MP4·MOV를 원본으로 첨부하고 다른 원고·잘못된 종류는 거부한다',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-video-api-')),runtime=await createServer({dataDir:dir,port:0});t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});const {request}=await localApi(runtime.url);let analyses=0;runtime.ai.analyzeAsset=async()=>{analyses++;};
 const upload=(id,role='video',hex='000000206674797069736f6d00000000')=>{const form=new FormData();form.append('file',new Blob([Buffer.from(hex,'hex')]),'현장.mp4');return request(`/projects/${id}/assets?role=${role}`,'POST',form);};
 for(const postType of ['recommendation','case','completion']){
  const p=await request('/projects','POST',{postType}),video=await upload(p.id);assert.equal(video.status,'ready');assert.equal(video.previewBytes,undefined);assert.equal(video.mime,'video/mp4');const saved=await request('/projects/'+p.id,'PUT',{...p,completionVideoId:video.id,blocks:[{id:'video',kind:'video',assetIds:[video.id],text:'현장 소개'}]});assert.equal(saved.completionVideoId,video.id);
  const other=await request('/projects','POST',{postType});await assert.rejects(request('/projects/'+other.id,'PUT',{...other,completionVideoId:video.id}),/현재 원고/);await assert.rejects(request('/projects/'+other.id,'PUT',{...other,blocks:saved.blocks}),/다른 원고/);await assert.rejects(upload(p.id,'photo'),/동영상은/);
  const mov=await upload(p.id,'video','00000020667479707174202000000000');assert.equal(mov.mime,'video/quicktime');
  if(postType!=='completion')await assert.rejects(request('/projects/'+p.id,'PUT',{...saved,blocks:[...saved.blocks,{id:'map',kind:'map',text:'지도'}]}),/지도는 카페/);
 }
 assert.equal(analyses,0);
});

test('영상 태그를 각각 확정하고 정보창을 다시 열어 게시글 태그와 정확히 대조한다',async()=>{
 const calls=[],state={tags:[],input:'',open:false},bridge={frame:async()=>state.open?{}:null,click:async selector=>{calls.push(selector);if(selector==='.nvu_btn_close')state.open=false;},text:async(_,tag)=>{state.input=tag;},key:async key=>{if(key==='Return'){state.tags.push(state.input);state.input='';}},evaluate:async()=>{},clickNative:async selector=>{calls.push(selector);if(selector.includes('se-video-meta-toolbar-button'))state.open=true;},waitFor:async()=>{}};
 const naver=new Naver({}, {},bridge);naver.videoTags=async()=>structuredClone(state);await naver.setVideoTags(['#인테리어','레몬 하우스','인테리어']);assert.deepEqual(state.tags,['인테리어','레몬하우스']);await naver.verifyVideoTags(['레몬하우스','인테리어']);assert(calls.includes('.nvu_btn_close'));
 state.tags=['인테리어'];await assert.rejects(naver.verifyVideoTags(['레몬하우스','인테리어']),/저장된 영상 태그/);await assert.rejects(naver.setVideoTags(['가'.repeat(21)]),/20자/);
});

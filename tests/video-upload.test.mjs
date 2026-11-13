import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {Naver} from '../server/naver.mjs';
import {Jobs} from '../server/jobs.mjs';
const {BrowserBridge}=createRequire(import.meta.url)('../desktop/browser.cjs');

test('영상 업로드가 3분을 넘고 프레임이 잠깐 사라져도 완료 버튼 활성화까지 기다린다',async t=>{
 let time=0,reads=0;t.mock.method(Date,'now',()=>time+=61000);const messages=[];
 const naver=new Naver({}, {},{evaluate:async(fn,arg,options)=>{assert.equal(options.readOnly,true);assert.equal(options.selector,'.nvu_btn_submit');if(++reads===1)throw Object.assign(Error('네이버 화면을 읽을 수 없습니다.'),{status:422});return reads>=4;}});
 await naver.waitVideoUpload(patch=>messages.push(patch.message));assert.equal(reads,4);assert(time>180000);assert(messages[0].includes('업로드·변환'));
});

test('영상 업로드 대기는 유한하며 연결 종료·읽기 오류·사용자 중단을 구별한다',async t=>{
 let time=0;t.mock.method(Date,'now',()=>time+=1800000);
 await assert.rejects(new Naver({}, {},{evaluate:async()=>false}).waitVideoUpload(),/30분/);
 for(const error of [Object.assign(Error('창 닫힘'),{status:401}),Error('잘못된 화면 처리')])await assert.rejects(new Naver({}, {},{evaluate:async()=>{throw error;}}).waitVideoUpload(),error);
 await assert.rejects(new Naver({}, {},{window:{webContents:{getURL:()=> 'https://nid.naver.com/nidlogin.login'}},evaluate:async()=>{throw Object.assign(Error('화면을 읽을 수 없음'),{status:422});}}).waitVideoUpload(),error=>error.status===401);
 t.mock.restoreAll();const records=new Map(),store={put:(_,id,value)=>records.set(id,{...value})},jobs=new Jobs(store);let first;
 const started=new Promise(resolve=>first=resolve),naver=new Naver({}, {},{evaluate:async()=>{first();return false;}}),job=jobs.start('p','prepare',update=>naver.waitVideoUpload(update));
 await started;jobs.cancel(job.id);while(jobs.active.has(job.id))await new Promise(r=>setTimeout(r,20));assert.equal(records.get(job.id).status,'cancelled');
});

test('업로드 완료 후 한 번만 완료를 누르고 마지막 사진·게시글 태그·임시저장으로 이어간다',async()=>{
 const events=[],assets=[{id:'v',projectId:'p',role:'video',status:'ready',filename:'현장.mp4',originalPath:'video.mp4'},{id:'last',projectId:'p',role:'photo',originalPath:'closing.jpg'}];let done=false,photoCount=0,cardReads=0;
 const bridge={appendParagraph:async()=>{},evaluate:async(fn,arg,options)=>{
  const code=fn.toString();if(code.includes('lemonVideoUpload'))return true;
  if(code.includes('#nvu_inp_box_title'))return true;
  if(code.includes('===before+1')){const document={querySelectorAll:()=>done?[{textContent:++cardReads>1?'현장 영상':''}]:[]};return Function('document','arg','return ('+code+')(arg)')(document,arg);}
  if(code.includes('se-component.se-video')&&code.includes('textContent'))return '현장 영상';
  if(code.includes('se-component.se-video'))return 0;
  if(code.includes('se-component.se-image img'))return photoCount;
  if(code.includes('input[type='))return false;
  if(code.includes('lemonCafeDraft'))return true;
  if(code.includes('[role="alert"]'))return '';
 },upload:async(files,trigger)=>{if(trigger)await trigger();if(files[0]==='closing.jpg'){assert(cardReads>=2);photoCount=1;events.push('last-image');}else events.push('video-upload');},click:async selector=>assert.notEqual(selector,'.nvu_btn_submit'),clickVerifiedButton:async selector=>{assert.equal(selector,'.nvu_btn_submit.nvu_btn_type2');assert(!done);done=true;events.push('complete');},clickNative:async selector=>{if(selector.includes('lemon-cafe-draft'))events.push('draft');},key:async()=>{},text:async()=>{},watchDialog:async()=>({message:'임시등록되었습니다.',close:()=>events.push('watch-closed')})};
 const naver=new Naver({get:(_,id)=>assets.find(a=>a.id===id),assets:()=>assets},{resolve:path=>path,originalForUpload:async a=>a.originalPath},bridge);
 naver.setVideoTags=async tags=>{assert.deepEqual(tags,['태그']);events.push('video-tags');};naver.verifyVideoTags=async()=>events.push('verify-video-tags');naver.waitVideoUpload=async()=>{};
 const p={id:'p',postType:'completion',tags:['태그'],blocks:[{kind:'video',text:'현장 영상',assetIds:['v']},{kind:'photos',space:'마무리',assetIds:['last']}]};
 await naver.writeBlocks(p,()=>{});events.push('post-tags');await naver.saveCafeDraft();
 assert.deepEqual(events,['video-upload','video-tags','complete','verify-video-tags','last-image','post-tags','draft','watch-closed']);
});

test('완료 버튼이 업로드 중 비활성화되어 있으면 ready로 처리하지 않는다',async()=>{
 const bridge=new BrowserBridge(),frame={executeJavaScript:async source=>{const document={querySelector:selector=>selector==='.nvu_btn_submit'?{getBoundingClientRect:()=>({width:100}),matches:()=>true}:{}};return Function('document','location','return '+source)(document,{href:'https://cafe.naver.com/editor'});}};
 bridge.window={isDestroyed:()=>false,webContents:{mainFrame:{...frame,framesInSubtree:[frame]}}};assert.equal(await new Naver({}, {},bridge).videoReady(),false);
});

test('활성 버튼 클릭이 한 번 무시되면 같은 업로드 창에서 완료만 재시도하고 재업로드하지 않는다',async t=>{
 let clock=0,uploads=0,clicks=0;const phases=[];
 t.mock.method(Date,'now',()=>clock+=1000);
 const asset={projectId:'p',role:'video',status:'ready',filename:'v.mp4',originalPath:'v.mp4'};
 const bridge={evaluate:async fn=>fn.toString().includes('lemonVideoUpload')?true:0,click:async()=>{},upload:async()=>uploads++,text:async()=>{},key:async()=>{},clickVerifiedButton:async selector=>{assert.equal(selector,'.nvu_btn_submit.nvu_btn_type2');clicks++;}};
 const naver=new Naver({get:()=>asset},{resolve:x=>x},bridge);
 naver.setVideoTags=naver.verifyVideoTags=async()=>{};
 naver.waitVideoUpload=async(update,phase)=>phases.push(phase);
 naver.videoReady=async phase=>{assert.equal(phase,'submit');return true;};
 naver.readEditor=async fn=>fn.toString().includes('===before+1')?clicks===2:0;
 await naver.insertVideo({assetIds:['v'],text:'영상'},'p',['태그']);
 assert.equal(uploads,1);assert.equal(clicks,2);assert.deepEqual(phases,['uploaded','submit','submit']);
});

for(const postType of ['recommendation','case','completion'])test(postType+'는 업로드 완료·네이버 활성 표시가 태그 입력 후 3초 연속 유지될 때만 완료를 누른다',async t=>{
 const asset={id:'v',projectId:'p',role:'video',status:'ready',filename:'영상.mp4',originalPath:'original.mp4'};
 const readings=[['업로드 중',true],['업로드 완료',false],['업로드 완료',true],['업로드 완료',false],...Array.from({length:4},()=>['업로드 완료',true])];
 const calls=[];let time=0,checks=0;
 t.mock.method(Date,'now',()=>time);
 const bridge={click:async()=>{},upload:async()=>{},text:async()=>{},key:async()=>{},clickVerifiedButton:async selector=>{
   assert.equal(selector,'.nvu_btn_submit.nvu_btn_type2');
   assert.equal(checks,readings.length);calls.push('complete');
 },evaluate:async(fn,phase)=>{
   const code=fn.toString();
   if(code.includes('lemonVideoUpload'))return true;
   if(code.includes('===before+1'))return calls.includes('complete');
   if(!code.includes('.nvu_state'))return 0;
   const [status,active]=phase==='uploaded'?['업로드 완료',false]:readings[checks++];
   time+=1000;
   const uploadStatus={textContent:status,getClientRects:()=>[{}]};
   const done={getBoundingClientRect:()=>({width:100}),closest:()=>null,matches:selector=>selector==='.nvu_btn_type2'&&active};
   const document={querySelector:selector=>selector==='.nvu_btn_submit'?done:{},querySelectorAll:()=>[uploadStatus]};
   return Function('document','phase','return ('+code+')(phase)')(document,phase);
 }};
 const naver=new Naver({get:kind=>kind==='project'?{postType}:asset},{resolve:value=>value},bridge);
 naver.setVideoTags=async()=>calls.push('video-tags');
 naver.verifyVideoTags=async()=>calls.push('verify-tags');
 await naver.insertVideo({kind:'video',assetIds:['v'],text:'현장 영상'},'p',['태그']);
 assert.deepEqual(calls,['video-tags','complete','verify-tags']);
});

test('임시저장 버튼 표시와 이전 안내만으로 성공 처리하지 않고 한 번만 요청한다',async t=>{
 let time=0;t.mock.method(Date,'now',()=>time+=20001);let clicked=0,closed=0;
 const naver=new Naver({}, {},{evaluate:async fn=>fn.toString().includes('lemonCafeDraft')?true:'임시등록되었습니다.',clickNative:async()=>clicked++,watchDialog:async()=>({message:'',close:()=>closed++})});
 await assert.rejects(naver.saveCafeDraft(),/임시등록 목록/);assert.equal(clicked,1);assert.equal(closed,1);
});

test('임시저장 확인창만 수락하고 기존 디버거 연결과 다른 확인창은 유지한다',async()=>{
 for(const alreadyAttached of [true,false]){
  const commands=[],debuggerApi=new EventEmitter();let attached=alreadyAttached;
  Object.assign(debuggerApi,{isAttached:()=>attached,attach:()=>attached=true,detach:()=>attached=false,sendCommand:async(...args)=>commands.push(args)});
  const bridge=new BrowserBridge();bridge.window={webContents:{debugger:debuggerApi}};
  const watcher=await bridge.watchDialog(/임시등록되었습니다/);debuggerApi.emit('message',null,'Page.javascriptDialogOpening',{message:'다른 확인이 필요합니다.'});assert.equal(watcher.message,'');
  debuggerApi.emit('message',null,'Page.javascriptDialogOpening',{message:'임시등록되었습니다.'});assert.equal(watcher.message,'임시등록되었습니다.');assert.equal(commands.filter(c=>c[0]==='Page.handleJavaScriptDialog').length,1);
  watcher.close();assert.equal(attached,alreadyAttached);assert.equal(debuggerApi.listenerCount('message'),0);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {AI,consumeResponseStream} from '../server/ai.mjs';
import {Store} from '../server/store.mjs';
import {Jobs} from '../server/jobs.mjs';
import {COMPLETION_FORMAT} from '../shared/format.mjs';

const encode=events=>new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
const completed=value=>[{type:'response.output_text.delta',delta:JSON.stringify(value)},{type:'response.completed',response:{usage:{input_tokens:2,output_tokens:3}}}];
const response=events=>new Response(encode(events),{headers:{'Content-Type':'text/event-stream'}});
const broken=()=>{let chunk=0;return new Response(new ReadableStream({pull(c){if(!chunk++)c.enqueue(encode([{type:'response.output_text.delta',delta:'{"partial":'}]));else c.error(Object.assign(new TypeError('terminated'),{cause:{code:'UND_ERR_SOCKET'}}));}}));};
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-connection-')),store=new Store(dir);t.after(async()=>{store.close();await fs.rm(dir,{recursive:true,force:true});});return {store,ai:new AI(store,{token:async()=> 'test-token',modelCache:[{id:'test-model'}]},{},{})};}

test('완료 응답 뒤 연결이 끊겨도 완성된 응답을 버리지 않는다',async()=>{
 let read=0;const body=new ReadableStream({pull(c){if(!read++)c.enqueue(encode(completed({ok:true})));else c.error(new TypeError('terminated'));}});
 assert.equal((await consumeResponseStream(body)).text,'{"ok":true}');
});
test('완료 이벤트를 받으면 서버의 연결 종료를 기다리지 않고 해제한다',{timeout:1000},async()=>{
 let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(encode(completed({ok:true})));},cancel(){cancelled=true;}});
 assert.equal((await consumeResponseStream(body)).text,'{"ok":true}');assert(cancelled);
});
test('실제 HTTP 소켓이 응답 중 닫혀도 그 요청만 재시도하며 부분 원고는 섞지 않는다',async t=>{
 const {store,ai}=await fixture(t),realFetch=globalThis.fetch;let requests=0,signals=[],bodies=[];
 const server=createServer((req,res)=>{requests++;req.resume();res.writeHead(200,{'Content-Type':'text/event-stream'});if(requests===1){res.write(encode([{type:'response.output_text.delta',delta:'{"partial":'}]));setTimeout(()=>res.destroy(),15);}else res.end(encode(completed({ok:true})));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 t.mock.method(globalThis,'fetch',(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');signals.push(options.signal);bodies.push(options.body);return realFetch('http://127.0.0.1:'+server.address().port,options);});
 assert.deepEqual(await ai.call('가상 자료',[{type:'input_text',text:'가상 검증'}]),{ok:true});assert.equal(requests,2);assert.equal(signals[0],signals[1]);assert.equal(bodies[0],bodies[1]);assert.equal(store.list('usage').length,1);
});
test('정상 EOF라도 완료 이벤트가 없으면 부분 결과를 쓰지 않고 재시도한다',async t=>{
 const {ai,store}=await fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>++calls===1?response([{type:'response.output_text.delta',delta:'{"partial":'}]):response(completed({ok:true})));
 assert.deepEqual(await ai.call('검증',[]),{ok:true});assert.equal(calls,2);assert.equal(store.list('usage').length,1);
});
test('반복 연결 끊김은 세 번까지만 시도하고 terminated 대신 복구 안내를 준다',async t=>{
 const {ai,store}=await fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return broken();});
 await assert.rejects(ai.call('검증',[]),e=>e.status===502&&/연결이 반복해서 끊겨/.test(e.message)&&!/terminated/.test(e.message));assert.equal(calls,3);assert.equal(store.list('usage').length,0);
});
test('재시도 대기 중에도 원래 요청 제한 시간이 지나면 즉시 끝낸다',async t=>{
 const {ai}=await fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return broken();});
 await assert.rejects(ai.call('검증',[],{timeoutMs:40}),e=>e.status===504&&/대기 시간/.test(e.message));assert.equal(calls,1);
});
test('사용자 중단은 재시도 대기까지 취소하며 네트워크 오류로 바꾸지 않는다',async t=>{
 const {ai,store}=await fixture(t),jobs=new Jobs(store);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return broken();});
 const job=jobs.start(store.createProject().id,'generate',()=>ai.call('검증',[]));
 while(!calls)await new Promise(r=>setTimeout(r,5));jobs.cancel(job.id);
 while(jobs.active.size)await new Promise(r=>setTimeout(r,5));const saved=store.get('job',job.id);assert.equal(saved.status,'cancelled');assert.match(saved.message,/중단했습니다/);assert.equal(calls,1);assert.equal(store.list('usage').length,0);
});
test('권한·한도·HTTP 오류와 명시적 생성 실패·손상 응답은 자동 재요청하지 않는다',async t=>{
 const {ai}=await fixture(t);
 for(const make of [()=>new Response('',{status:401}),()=>new Response('',{status:403}),()=>new Response('',{status:429}),()=>new Response('',{status:500}),()=>response([{type:'response.incomplete'}]),()=>response([{type:'response.failed',response:{error:{code:'rate_limit'}}}]),()=>new Response('data: not-json\n\n')]){
  let calls=0;const mock=t.mock.method(globalThis,'fetch',async()=>{calls++;return make();});await assert.rejects(ai.call('검증',[]));assert.equal(calls,1);mock.mock.restore();
 }
});
for(const persistent of [false,true])test(`마감 95% 대조 중 연결 끊김 · ${persistent?'재시도 소진 시 기존 원고 보존':'대조만 재시도하고 작성 완료'}`,async t=>{
 const {store,ai}=await fixture(t),p=store.createProject('completion'),old=[{id:'old',kind:'text',text:'보존할 기존 원고'}];
 store.updateProject(p.id,{original:{...p.original,name:'가상 현장'},keywords:[],completionTemplates:[],blocks:old,title:'기존 제목'});
 store.put('style','completion',{rules:'시공 근거로 설명합니다.',referenceUrls:[],status:'edited',formatProfile:COMPLETION_FORMAT});
 store.put('asset','photo',{id:'photo',projectId:p.id,role:'photo',status:'ready',space:'거실',order:0,hash:'fake',analysis:{description:'가상 벽면'}});
 ai.analyzeMaterials=async()=>{};ai.planWork=async()=>({signature:'test',items:[{id:'work-1',space:'거실',item:'실크벽지 도배',sourceIds:['manual'],photoIds:['photo']}],warnings:[],checks:[],checkedAt:''});
 let drafts=0,checks=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');const payload=JSON.parse(options.body);
  if(payload.instructions.startsWith('본문 시공 대조')){checks++;if(persistent||checks===1)return broken();const input=JSON.parse(payload.input[0].content[0].text),b=input.blocks.find(b=>b.space==='거실'&&b.role==='body');return response(completed({checks:[{workId:'work-1',blockId:b.id,quote:'실크벽지 도배로 벽면을 정돈했습니다.'}],issues:[],warnings:[]}));}
  drafts++;return response(completed({title:'새 마감글',intro:'안녕하세요.',commonWork:'',sections:[{space:'거실',text:'실크벽지 도배로 벽면을 정돈했습니다.',points:[]}],outro:'감사합니다.',tags:[],warnings:[]}));
 });
 if(persistent){await assert.rejects(ai.generate(p.id,()=>{}),/연결이 반복해서 끊겨/);assert.equal(store.get('project',p.id).title,'기존 제목');assert.deepEqual(store.get('project',p.id).blocks,old);assert.equal(checks,3);}
 else{const {project}=await ai.generate(p.id,()=>{});assert.equal(project.title,'새 마감글');assert.equal(project.workPlan.checks.length,1);assert.equal(checks,2);}
 assert.equal(drafts,1);
});

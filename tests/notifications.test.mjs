import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {Jobs} from '../server/jobs.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('창이 최소화되어도 시작·25% 단위 진행·완료 알림을 보내고 클릭하면 복원한다',async()=>{
  const notifications=[],actions=[];class Notification extends EventEmitter{static isSupported(){return true;}constructor(options){super();this.options=options;notifications.push(this);}show(){}}
  const module={exports:{}};vm.runInNewContext(await fs.readFile('desktop/notifications.cjs','utf8'),{module,require:()=>({Notification}),console});
  const notify=module.exports.jobNotifications(()=>({isDestroyed:()=>false,isMinimized:()=>true,restore:()=>actions.push('restore'),show:()=>actions.push('show'),focus:()=>actions.push('focus')}));
  const jobs=new Jobs({put(){}},notify);let finish;const job=jobs.start('p','prepare',update=>{for(const progress of [5,25,26,49,50,75,80,100])update({progress,message:`본문 입력 ${progress}`});return new Promise(resolve=>finish=resolve);});await tick();
  assert.deepEqual(notifications.map(n=>n.options.title.match(/(\d+)%/)?.[1]),['0','25','50','75']);assert(notifications.every(n=>n.options.silent));finish({prepared:true});await tick();
  assert.match(notifications.at(-1).options.title,/완료/);assert.match(notifications.at(-1).options.body,/최종 발행은 하지 않았습니다/);assert.equal(notifications.at(-1).options.silent,false);assert(notifications.every(n=>n.options.id===job.id));notifications.at(-1).emit('click');assert.deepEqual(actions,['restore','show','focus']);
});
test('시스템이 알림을 차단해도 같은 진행 알림을 반복하지 않으며 실패 이유와 검토 필요를 구분한다',async()=>{
  const notifications=[];class Notification extends EventEmitter{static isSupported(){return true;}constructor(options){super();this.options=options;notifications.push(this);}show(){}}
  const module={exports:{}};vm.runInNewContext(await fs.readFile('desktop/notifications.cjs','utf8'),{module,require:()=>({Notification}),console:{error(){}}});const notify=module.exports.jobNotifications(()=>null);
  const job={id:'blocked',kind:'generate',status:'running',progress:50,message:'작성 중'};notify(job);notifications[0].emit('failed',{},'Windows 알림 차단');notify({...job,progress:51});assert.equal(notifications.length,1);
  notify({...job,status:'failed',message:'사용량 제한으로 작성하지 못했습니다.'});assert.match(notifications.at(-1).options.title,/실패/);assert.equal(notifications.at(-1).options.body,'사용량 제한으로 작성하지 못했습니다.');
  notify({...job,id:'review',status:'completed',result:{needsReview:true}});assert.match(notifications.at(-1).options.title,/원고 확인 필요/);assert.match(notifications.at(-1).options.body,/검토가 필요한 항목/);
  notify({...job,id:'cafe-draft',kind:'prepare',status:'completed',result:{draftSaved:true}});assert.match(notifications.at(-1).options.body,/카페에 임시저장했습니다/);assert.match(notifications.at(-1).options.body,/최종 등록은 하지 않았습니다/);
});
test('실패 이유와 중단·검토 필요 상태를 완료와 구분하며 알림 오류는 작업을 실패시키지 않는다',async()=>{
  const changes=[],store={put(_,id,value){this.saved={...value};}};const jobs=new Jobs(store,job=>changes.push(job));jobs.start('p','generate',async()=>{throw Error('사용량 제한으로 원고 작성 실패');});await tick();assert.equal(changes.at(-1).status,'failed');assert.match(changes.at(-1).message,/사용량 제한/);
  let finish;const job=jobs.start('p','analyze',()=>new Promise(resolve=>finish=resolve));await tick();jobs.cancel(job.id);finish({});await tick();assert.deepEqual(changes.slice(-2).map(j=>j.status),['cancelling','cancelled']);
  const original=console.error;console.error=()=>{};try{const broken=new Jobs(store,()=>{throw Error('알림 표시 실패');});broken.start('p','format',async()=>({ok:true}));await tick();assert.equal(store.saved.status,'completed');}finally{console.error=original;}
});

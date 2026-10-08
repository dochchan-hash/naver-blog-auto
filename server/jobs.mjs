import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const jobSignal=()=>context.getStore()?.signal;
export function checkCancelled(){jobSignal()?.throwIfAborted();}
export class Jobs {
  constructor(store){this.store=store;this.active=new Map();this.controllers=new Map();}
  cancel(id){const job=this.active.get(id),controller=this.controllers.get(id);if(!job||!controller)throw Object.assign(new Error('이미 종료된 작업입니다.'),{status:409});if(job.cancellable===false)throw Object.assign(new Error('네이버에 등록 요청을 보낸 뒤에는 중단할 수 없습니다. 등록 결과를 확인합니다.'),{status:409});job.status='cancelling';job.message='중단 요청을 처리합니다. 저장된 자료와 기존 원고는 유지합니다.';job.updatedAt=new Date().toISOString();this.store.put('job',id,job);controller.abort(Object.assign(new Error('작업을 중단했습니다. 저장된 자료로 다시 시작할 수 있습니다.'),{cancelled:true}));return job;}
  start(projectId,kind,task){
    if([...this.active.values()].some(j=>j.projectId===projectId))throw Object.assign(new Error('이 원고의 작업이 진행 중입니다. 완료 후 다시 시도해 주세요.'),{status:409});
    const id=randomUUID(),now=new Date().toISOString(),controller=new AbortController();
    const job={id,projectId,kind,status:'running',message:'작업을 시작합니다.',progress:0,createdAt:now,updatedAt:now,cancellable:true};
    this.active.set(id,job);this.controllers.set(id,controller);this.store.put('job',id,job);
    const write=patch=>{Object.assign(job,patch,{updatedAt:new Date().toISOString()});this.store.put('job',id,job);};
    const update=patch=>{controller.signal.throwIfAborted();write(patch);};
    Promise.resolve().then(()=>context.run({signal:controller.signal},async()=>{checkCancelled();const result=await task(update);checkCancelled();return result;})).then(result=>write({status:'completed',progress:100,result,message:'완료되었습니다.'})).catch(error=>write({status:controller.signal.aborted?'cancelled':error.status===429?'limited':error.status===401?'login_required':error.uncertain?'uncertain':'failed',message:controller.signal.aborted?controller.signal.reason.message:error.message,progress:job.progress})).finally(()=>{this.active.delete(id);this.controllers.delete(id);});
    return job;
  }
}

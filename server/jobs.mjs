import {randomUUID} from 'node:crypto';
export class Jobs {
  constructor(store){this.store=store;this.active=new Map();}
  start(projectId,kind,task) {
    const busy=[...this.active.values()].find(j=>j.projectId===projectId);
    if(busy)throw Object.assign(new Error('이 원고의 작업이 진행 중입니다. 완료 후 다시 시도해 주세요.'),{status:409});
    const id=randomUUID(),now=new Date().toISOString();
    const job={id,projectId,kind,status:'running',message:'작업을 시작합니다.',progress:0,createdAt:now,updatedAt:now};
    this.active.set(id,job);this.store.put('job',id,job);
    const update=patch=>{Object.assign(job,patch,{updatedAt:new Date().toISOString()});this.store.put('job',id,job);};
    Promise.resolve().then(()=>task(update)).then(result=>update({status:'completed',progress:100,result,message:'완료되었습니다.'})).catch(error=>update({status:error.status===429?'limited':error.status===401?'login_required':error.uncertain?'uncertain':'failed',message:error.message,progress:job.progress})).finally(()=>this.active.delete(id));
    return job;
  }
}

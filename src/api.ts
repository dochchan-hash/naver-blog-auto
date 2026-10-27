import type {Bootstrap,Project,Role,Asset,Settings,Style,PostType,Job,ComplexDetails} from '../shared/model';
let csrf='';
let bootstrapRequest:Promise<Bootstrap>|null=null;
async function request<T>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(`/api${path}`,{...options,credentials:'same-origin',signal:AbortSignal.timeout(300000),headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),'X-Lemon-CSRF':csrf,...options.headers}});
  if(!response.ok){const body=await response.json().catch(()=>({error:'작업을 완료하지 못했습니다.'}));throw new Error(body.error);}
  return response.json();
}
export const api={
  bootstrap:()=>{if(!bootstrapRequest)bootstrapRequest=request<Bootstrap>('/bootstrap').then(data=>{csrf=data.csrf;return data;}).finally(()=>{bootstrapRequest=null;});return bootstrapRequest;},
  deleteProject:(id:string)=>request<{ok:boolean}>(`/projects/${id}`,{method:'DELETE'}),
  createProject:(postType:PostType='recommendation')=>request<Project>('/projects',{method:'POST',body:JSON.stringify({postType})}),
  saveProject:(p:Project)=>request<Project>(`/projects/${p.id}`,{method:'PUT',body:JSON.stringify(p)}),
  upload:(id:string,role:Role,file:File,onProgress:(value:number)=>void,classify=true)=>new Promise<Asset>((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('POST',`/api/projects/${id}/assets?role=${role}&classify=${classify}`);xhr.setRequestHeader('X-Lemon-CSRF',csrf);
    xhr.timeout=300000;xhr.ontimeout=()=>reject(new Error('파일 전송 시간이 초과되었습니다. 다시 첨부해 주세요.'));
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(Math.round(e.loaded/e.total*100));};
    xhr.onerror=()=>reject(new Error('파일 전송이 중단되었습니다. 다시 첨부해 주세요.'));
    xhr.onload=()=>{let data;try{data=JSON.parse(xhr.responseText);}catch{return reject(new Error('파일 전송 결과를 확인하지 못했습니다.'));}if(xhr.status<200||xhr.status>=300)reject(new Error(data.error));else resolve(data);};
    const form=new FormData();form.append('file',file);xhr.send(form);
  }),
  patchAssets:(patches:Partial<Asset>[])=>request<{assets:Asset[]}>('/assets/batch',{method:'PATCH',body:JSON.stringify(patches)}),
  saveSettings:(settings:Settings)=>request<Settings>('/settings',{method:'PUT',body:JSON.stringify(settings)}),
  saveStyle:(style:Style,postType:PostType='recommendation')=>request<Style>(`/style?postType=${postType}`,{method:'PUT',body:JSON.stringify(style)}),
  authStart:(newAccount=false)=>request<{url:string;opened:boolean}>('/auth/start',{method:'POST',body:JSON.stringify({newAccount})}),
  authModels:()=>request<{models:{id:string;name:string}[]}>('/auth/models',{method:'POST'}),
  authDisconnect:()=>request<Bootstrap['auth']>('/auth/disconnect',{method:'POST'}),
  login:()=>request<Bootstrap['browser']>('/naver/login',{method:'POST'}),
  naverStatus:()=>request<Bootstrap['browser']>('/naver/status',{method:'POST'}),
  changeNaverAccount:()=>request<Bootstrap['browser']>('/naver/change-account',{method:'POST'}),
  readPost:(url:string)=>request<{text:string;title:string;url:string}>('/naver/read-post',{method:'POST',body:JSON.stringify({url})}),
  search:(query:string,region='')=>request<{results:{name:string;key?:string;url?:string;label?:string;address?:string;region?:string;suggested?:boolean}[]}>('/naver/search',{method:'POST',body:JSON.stringify({query,region})}),
  selectComplex:(key:string)=>request<ComplexDetails>('/naver/select-complex',{method:'POST',body:JSON.stringify({key})}),
  complex:(url:string,type='')=>request<ComplexDetails>('/naver/complex',{method:'POST',body:JSON.stringify({url,type})}),
  floorplan:(projectId:string,role:Role,url:string)=>request<Asset>('/naver/floorplan',{method:'POST',body:JSON.stringify({projectId,role,url})}),
  cancelJob:(id:string)=>request<Job>(`/jobs/${id}/cancel`,{method:'POST'}),
  task:(id:string,kind:string,confirmReviewed:boolean,expectedRevision:number,templateSlotId?:string)=>request<Job>(`/projects/${id}/tasks/${kind}`,{method:'POST',body:JSON.stringify({confirmReviewed,expectedRevision,...(templateSlotId?{templateSlotId}:{})})}),
  refreshFormat:(postType:PostType='recommendation')=>request<Job>('/style/format',{method:'POST',body:JSON.stringify({postType})}),
  analyzeStyle:(postType:PostType='recommendation')=>request<Job>('/style/analyze',{method:'POST',body:JSON.stringify({postType})}),
  recordPublish:(id:string,url:string,scheduled:boolean,scheduleAt:string)=>request<Project>(`/projects/${id}/publish-result`,{method:'POST',body:JSON.stringify({url,scheduled,scheduleAt})}),
};

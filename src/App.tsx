import {useCallback,useEffect,useRef,useState} from 'react';
import {House,Plus,Settings2,ChevronRight,Check,LoaderCircle,X,FolderOpen,BookOpen,CloudOff} from 'lucide-react';
import type {Bootstrap,Project,Phase,Asset,Role} from '../shared/model';
import {api} from './api';
import {Button,Notice} from './components/Common';
import {SiteStep} from './components/Sites';
import {AssetsStep} from './components/Assets';
import {WriteStep} from './components/Write';
import {PublishStep} from './components/Publish';
import Preview from './components/Preview';
import SettingsPanel from './components/Settings';
const steps:{id:Phase;label:string}[]=[{id:'site',label:'현장 정보·도면'},{id:'assets',label:'사진 첨부·배치'},{id:'write',label:'원고 작성'},{id:'publish',label:'발행'}];
const statusLabel:Record<string,string>={empty:'작성 전',generated:'초안 생성',edited:'수정 중',review:'검토 필요',published:'발행 완료',scheduled:'예약 등록'};
export default function App(){
  const [data,setData]=useState<Bootstrap|null>(null),[project,setProject]=useState<Project|null>(null),[settingsOpen,setSettingsOpen]=useState(false),[message,setMessage]=useState(''),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
  const [uploading,setUploading]=useState<{filename:string;progress:number;index:number;total:number}|null>(null);
  const current=useRef<Project|null>(null),dirty=useRef(false),savePromise=useRef<Promise<void>|null>(null),seenJobs=useRef(new Set<string>());
  const notify=useCallback((message:string)=>setMessage(message),[]);
  const update=useCallback((patch:Partial<Project>)=>{if(!current.current)return;current.current={...current.current,...patch};dirty.current=true;setProject(current.current);},[]);
  const save=useCallback(async()=>{
    if(savePromise.current)await savePromise.current;
    if(!dirty.current||!current.current)return;
    const snapshot=current.current;setSaving(true);setSaveError('');
    const work=(async()=>{try{const saved=await api.saveProject(snapshot);if(current.current?.id!==saved.id)return;const unchanged=current.current===snapshot;current.current=unchanged?saved:{...current.current,revision:saved.revision,updatedAt:saved.updatedAt};dirty.current=!unchanged;setProject(current.current);setData(prev=>prev?{...prev,projects:prev.projects.map(p=>p.id===saved.id?saved:p)}:prev);}catch(e){setSaveError((e as Error).message);throw e;}finally{setSaving(false);savePromise.current=null;}})();savePromise.current=work;await work;
  },[]);
  const refresh=useCallback(async()=>{
    const next=await api.bootstrap();setData(next);
    if(!current.current){const id=localStorage.getItem('lemonhouse-project');current.current=next.projects.find(p=>p.id===id)||next.projects[0];setProject(current.current);}
    else if(!dirty.current&&!savePromise.current){const fresh=next.projects.find(p=>p.id===current.current!.id);if(fresh&&fresh.revision!==current.current.revision){current.current=fresh;setProject(fresh);}}
    for(const job of next.jobs){const key=job.id+job.status;if(!['running','queued'].includes(job.status)&&!seenJobs.current.has(key)){seenJobs.current.add(key);if(Date.now()-Date.parse(job.updatedAt)<15000){if(job.status!=='completed')notify(job.message);else if(job.kind==='generate')notify('추천글을 작성했습니다. 사진과 시공내용을 확인해 주세요.');else if(job.kind==='prepare')notify('네이버 편집기에 준비했습니다. 최종 발행은 하지 않았습니다.');else if(['publish','verify'].includes(job.kind))notify('네이버 등록 결과를 확인했습니다.');}}}
  },[notify]);
  useEffect(()=>{refresh().catch(e=>notify(e.message));const id=setInterval(()=>{refresh().catch(()=>{});},2500);return()=>clearInterval(id);},[refresh,notify]);
  useEffect(()=>{if(!dirty.current)return;const id=setTimeout(()=>{save().catch(()=>{});},650);return()=>clearTimeout(id);},[project,save]);
  useEffect(()=>{const before=(e:BeforeUnloadEvent)=>{if(dirty.current||saving||uploading){e.preventDefault();}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before);},[saving,uploading]);
  const switchProject=async(p:Project)=>{try{await save();if(dirty.current)await save();current.current=p;dirty.current=false;setProject(p);localStorage.setItem('lemonhouse-project',p.id);}catch(e){notify((e as Error).message);}};
  const create=async()=>{try{await save();if(dirty.current)await save();const p=await api.createProject();current.current=p;dirty.current=false;setProject(p);await refresh();localStorage.setItem('lemonhouse-project',p.id);}catch(e){notify((e as Error).message);}};
  const go=async(phase:Phase)=>{if(!current.current)return;update({phase});try{await save();if(dirty.current)await save();}catch(e){notify((e as Error).message);}};
  const task=async(kind:string,confirmed=false)=>{try{await save();if(dirty.current)await save();if(!current.current)return;const job=await api.task(current.current.id,kind,confirmed);setData(prev=>prev?{...prev,jobs:[job,...prev.jobs]}:prev);if(['generate','compare','analyze'].includes(kind)&&!data?.auth.connected)setSettingsOpen(true);}catch(e){notify((e as Error).message);if(/ChatGPT|계정/.test((e as Error).message))setSettingsOpen(true);}};
  const patchAssets=async(patches:Partial<Asset>[])=>{try{await save();const res=await api.patchAssets(patches);setData(prev=>prev?{...prev,assets:res.assets}:prev);}catch(e){notify((e as Error).message);}};
  const upload=async(files:File[],role:Role)=>{
    if(uploading||!current.current)return;const id=current.current.id;
    try{await save();for(let i=0;i<files.length;i++){const file=files[i];setUploading({filename:file.name,progress:0,index:i+1,total:files.length});try{await api.upload(id,role,file,progress=>setUploading({filename:file.name,progress,index:i+1,total:files.length}));await refresh();}catch(e){notify(`${file.name}: ${(e as Error).message}`);}}}finally{setUploading(null);}
  };
  if(!data||!project)return <div className="app-loading"><div className="brand-mark"><House size={24}/></div><h1>레몬하우스 스튜디오</h1><p>{message||'작업 공간을 준비하고 있습니다.'}</p>{!message?<LoaderCircle className="spin"/>:<Button onClick={()=>refresh().catch(e=>notify(e.message))}>다시 연결</Button>}</div>;
  const selectedAssets=data.assets.filter(a=>a.projectId===project.id),activeJob=data.jobs.find(j=>j.projectId===project.id&&['running','queued'].includes(j.status));const busy=!!activeJob;
  const showPreview=['write','publish'].includes(project.phase),stepIndex=steps.findIndex(s=>s.id===(project.phase==='compare'?'site':project.phase));
  const props={project,update,notify,go,assets:selectedAssets,onFiles:upload,task,refresh,busy,uploading};
  return <div className="app-shell"><aside className="sidebar"><a className="brand" href="#" onClick={e=>e.preventDefault()}><span className="brand-mark"><House size={23}/></span><span><strong>LEMON HOUSE</strong><small>블로그 스튜디오</small></span></a><div className="workspace-label">내 작업 공간<span>LOCAL</span></div><Button className="new-project" onClick={create} disabled={busy||!!uploading}><Plus size={17}/>새 추천글 작성</Button><div className="nav-section-label"><FolderOpen size={13}/>추천글 보관함<span>{data.projects.length}</span></div><nav className="project-list" aria-label="저장된 추천글">{data.projects.map(p=><button key={p.id} className={p.id===project.id?'selected':''} onClick={()=>switchProject(p)} disabled={busy||!!uploading}><BookOpen size={16}/><div><strong>{p.target.name||p.name}</strong><small>{statusLabel[p.draftStatus]||'작성 중'} · {new Date(p.updatedAt).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'})}</small></div>{p.id===project.id?<ChevronRight size={14}/>:null}</button>)}</nav><div className="sidebar-bottom"><div className="local-note"><CloudOff size={17}/><div><strong>이 컴퓨터에 저장</strong><small>원본 사진과 원고를 보관합니다.</small></div></div><button className="settings-link" onClick={()=>setSettingsOpen(true)}><Settings2 size={17}/>계정과 작성 스타일</button></div></aside>
    <main className="main-workspace"><header className="topbar"><div className="breadcrumb">블로그 스튜디오<ChevronRight size={13}/><strong>추천글 작성</strong></div><div className="top-actions"><span className={`save-state ${saveError?'error':''}`}>{saveError?'저장 확인 필요':saving||dirty.current?<><LoaderCircle size={13} className="spin"/>저장 중</>:<><Check size={14}/>자동 저장됨</>}</span><button className={`account-chip ${data.auth.connected?'connected':''}`} onClick={()=>setSettingsOpen(true)}><span className="status-dot"/>{data.auth.connected?'AI 연결됨':'AI 계정 연결'}<ChevronRight size={13}/></button></div></header>
      <div className="workspace-heading"><div><span className="eyebrow">RECOMMENDATION STUDIO</span><h1>{project.target.name?`${project.target.name} 추천글`:'새로운 인테리어 추천글'}</h1><p>현장의 사진과 시공내용을, 레몬하우스다운 이야기로.</p></div><span className="draft-badge">{statusLabel[project.draftStatus]||'작성 중'}</span></div>
      <nav className="stepper" aria-label="작성 단계">{steps.map((step,i)=><button key={step.id} className={`${i===stepIndex?'current':''} ${i<stepIndex?'past':''}`} disabled={busy||!!uploading} onClick={()=>go(step.id)}><span className="step-number">{i<stepIndex?<Check size={13}/>:i+1}</span><span>{step.label}</span>{i<steps.length-1?<ChevronRight size={15} className="step-chevron"/>:null}</button>)}</nav>
      {saveError?<div className="global-error"><Notice tone="warning">{saveError}<Button className="secondary small" onClick={()=>save().catch(()=>{})}>다시 저장</Button></Notice></div>:null}
      {activeJob?<div className="job-progress" role="status"><LoaderCircle size={18} className="spin"/><div><strong>{activeJob.message}</strong><progress max={100} value={activeJob.progress}/></div><span>{activeJob.progress}%</span></div>:null}
      <div className={`workspace-body ${showPreview?'with-preview':''}`}><div className="work-content"><fieldset disabled={busy||!!uploading} className="work-fieldset">{['site','compare'].includes(project.phase)?<SiteStep key={project.id} {...props}/>:project.phase==='assets'?<AssetsStep {...props} patchAssets={patchAssets} uploading={uploading}/>:project.phase==='write'?<WriteStep {...props} save={save}/>:<PublishStep {...props} data={data} openSettings={()=>setSettingsOpen(true)} save={save}/>}</fieldset></div>{showPreview?<Preview project={project} assets={selectedAssets}/>:null}</div>
    </main>{settingsOpen?<SettingsPanel data={data} onClose={()=>setSettingsOpen(false)} notify={notify} refresh={refresh}/>:null}
    {message?<div className="toast" role="status"><span>{message}</span><button aria-label="알림 닫기" onClick={()=>setMessage('')}><X size={17}/></button></div>:null}
  </div>;
}

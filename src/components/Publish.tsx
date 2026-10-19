import {useEffect,useState} from 'react';
import {Send,Clock,CheckCircle2,ExternalLink,ShieldCheck,FileCheck} from 'lucide-react';
import type {Project,Asset,Bootstrap} from '../../shared/model';
import {draftWarnings,postSite} from '../../shared/domain.mjs';
import {CafePublish} from './CafePublish';
import {api} from '../api';
import {Field,SectionTitle,Button,Notice} from './Common';
type Props={project:Project;assets:Asset[];update:(patch:Partial<Project>)=>void;task:(kind:string,confirmed?:boolean)=>void;notify:(s:string)=>void;data:Bootstrap;openSettings:()=>void;busy:boolean;save:()=>Promise<void>;refresh:()=>Promise<void>;};
export function PublishStep({project,assets,update,task,notify,data,openSettings,busy,save,refresh}:Props){
  const [reviewed,setReviewed]=useState(false),[resultUrl,setResultUrl]=useState('');
  const reviewKey=JSON.stringify([project.id,project.title,project.blocks,project.tags,project.scheduleAt,project.visibility,project.category,data.settings.blogId]);
  useEffect(()=>setReviewed(false),[reviewKey]);
  useEffect(()=>setResultUrl(''),[project.id]);
  const blogId=data.settings.blogId||(data.browser.connected&&data.browser.canWrite?data.browser.blogId:'')||'';
  const warnings=draftWarnings(project,assets);const newest=data.jobs.find(j=>j.projectId===project.id&&['publish','verify'].includes(j.kind));
  const result=(newest?.result||data.jobs.find(j=>j.projectId===project.id&&['publish','verify'].includes(j.kind)&&j.status==='completed'&&j.result)?.result) as {url?:string;scheduled?:boolean;deliveryVerified?:boolean}|undefined;
  const kstInput=project.scheduleAt?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(project.scheduleAt)).replace(' ','T'):'';
  const record=async()=>{try{await save();await api.recordPublish(project.id,resultUrl,!!project.scheduleAt,project.scheduleAt);await refresh();notify('직접 확인한 등록 결과를 기록했습니다.');}catch(e){notify((e as Error).message);}};
  if(project.postType==='completion')return <CafePublish project={project} assets={assets} update={update} save={save} notify={notify}/>;
  return <><SectionTitle eyebrow="04 · 네이버 발행" title="마지막으로 확인하고 발행" description="담당 블로그와 사진·원고를 확인해 주세요."/>
    <section className="card"><div className="publish-target"><span className="naver-icon">N</span><div><small>발행할 담당 블로그</small><h3>{blogId||'블로그 연결이 필요합니다'}</h3></div><Button className="secondary small" onClick={openSettings}>연결 설정</Button></div>
      <div className="publish-summary"><div><small>{project.postType==='case'?'시공 현장':'추천 대상'}</small><strong>{postSite(project).name||'미입력'}</strong></div><div><small>현장 사진</small><strong>{project.blocks.filter(b=>b.kind==='photos').reduce((n,b)=>n+(b.assetIds?.length||0),0)}장</strong></div><div><small>원고 상태</small><strong>{project.draftStatus==='published'?'발행 완료':project.draftStatus==='scheduled'?'예약 등록됨':'발행 준비'}</strong></div></div>
      <Field label="발행 방식"><select value={project.publishMode} onChange={e=>update({publishMode:e.target.value as Project['publishMode']})}><option value="review">미리보기 검토 후 발행</option><option value="automatic">검사 통과 후 자동 발행</option></select></Field>
      {project.postType==='case'?<Field label="시공사례 카테고리" hint="담당 블로그에 있는 평형 카테고리를 선택하세요."><select value={project.category||''} onChange={e=>update({category:e.target.value})}><option value="">카테고리 선택</option>{['10PY','20PY','30PY','40PY','50PY~'].map(c=><option key={c}>{c}</option>)}</select></Field>:null}
      <Field label="공개 범위"><select value={project.visibility||'public'} onChange={e=>update({visibility:e.target.value as Project['visibility']})}><option value="public">전체 공개</option><option value="private">비공개 · 본인만 확인</option></select></Field>
      <div className="publish-timing"><button className={!project.scheduleAt?'selected':''} onClick={()=>update({scheduleAt:''})}><Send size={18}/><strong>즉시 발행</strong><small>작업 완료 후 바로 등록</small></button><button className={project.scheduleAt?'selected':''} onClick={()=>update({scheduleAt:new Date(Math.ceil((Date.now()+3600000)/600000)*600000).toISOString()})}><Clock size={18}/><strong>예약 발행</strong><small>네이버 예약 기능에 등록</small></button></div>
      {project.scheduleAt?<Field label="예약 날짜와 시각" hint="한국 표준시 · 네이버 예약은 10분 단위"><input type="datetime-local" step={600} value={kstInput} onChange={e=>{if(e.target.value){const parsed=new Date(e.target.value+':00+09:00');if(!Number.isNaN(parsed.getTime()))update({scheduleAt:parsed.toISOString()});}}}/></Field>:null}
    </section>
    <section className="card"><SectionTitle title="발행 전 확인"/><div className="checklist"><div><CheckCircle2 size={17}/>사진은 원본 파일로 전달합니다.</div><div><CheckCircle2 size={17}/>{project.postType==='case'?'실제 현장에 확인된 시공 내용을 소개합니다.':'원본 시공 현장과 추천 현장을 구분합니다.'}</div><div><CheckCircle2 size={17}/>등록 결과를 확인해야 완료로 표시합니다.</div></div>
      {warnings.length?<Notice tone="warning"><strong>확인이 필요합니다</strong><ul>{warnings.map(w=><li key={w}>{w}</li>)}</ul></Notice>:<Notice tone="success"><ShieldCheck size={17}/>원고의 기본 검사를 통과했습니다.</Notice>}
      {!data.browser.verified?<Notice>이 컴퓨터에서 실제 네이버 발행을 아직 검증하지 않았습니다. 편집기 화면이 바뀌거나 등록 결과가 불명확하면 원고를 보존하고 확인을 요청합니다.</Notice>:null}
      <label className="check-row review-checkbox"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>담당 블로그, 본문, 사진 묶음과 예약 시각을 확인했습니다.</label>
      <Button className="secondary full" busy={busy} disabled={!project.title||!project.blocks.length||!blogId||!data.browser.available} onClick={()=>task('prepare')}>네이버 편집기에 준비하고 확인</Button>
      <Button className="primary full large" busy={busy} disabled={!!warnings.length||!reviewed||!blogId||!data.browser.available} onClick={()=>task('publish',true)}>{project.scheduleAt?<Clock size={17}/>:<Send size={17}/>}네이버에 {project.scheduleAt?'예약 등록':'발행'}하기</Button>
      {project.scheduleAt&&newest?.status!=='completed'&&data.jobs.some(j=>j.projectId===project.id&&j.kind==='publish'&&j.status==='uncertain')?<><Notice tone="warning">이 원고의 예약 등록 결과를 다시 확인할 수 있습니다. 같은 글을 재발행하지 않습니다.</Notice><Button className="secondary full" busy={busy} onClick={()=>task('verify')}>네이버 예약 결과 다시 확인</Button></>:null}
    </section>
    {result?.url?<section className="card success-card"><FileCheck size={26}/><h3>{result.deliveryVerified?'예약 글의 실제 발행을 확인했습니다':result.scheduled?'예약 등록을 확인했습니다':'게시글 등록을 확인했습니다'}</h3><a href={result.url} target="_blank" rel="noreferrer" className="button secondary">네이버에서 확인<ExternalLink size={15}/></a>{result.scheduled&&!result.deliveryVerified&&Date.now()>=Date.parse(project.scheduleAt)?<Button className="secondary" busy={busy} onClick={()=>task('verify')}>예약 글 실제 발행 확인</Button>:null}</section>:null}
    <details className="card"><summary>네이버에서 직접 등록한 결과 기록</summary><p>자동화가 멈춘 뒤 열린 편집기에서 직접 발행했다면, 게시글 주소를 입력해 중복 등록을 방지할 수 있습니다.</p><Field label="담당 블로그의 게시글 주소"><input type="url" value={resultUrl} onChange={e=>setResultUrl(e.target.value)} placeholder="https://blog.naver.com/담당아이디/게시글번호"/></Field><Button className="secondary" onClick={record} disabled={!resultUrl}>직접 확인한 결과 기록</Button></details>
  </>;
}

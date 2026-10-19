import {FileText,Sparkles} from 'lucide-react';
import type {Project,Asset,Role,SourceConflict} from '../../shared/model';
import {sourceReviewCurrent,needsSourceCheck} from '../../shared/sources.mjs';
import {Field,SectionTitle,Button,Notice,Dropzone,bytes} from './Common';
type Props={project:Project;assets:Asset[];update:(patch:Partial<Project>)=>void;task:(kind:string)=>void;busy:boolean;};
export function SourceDifferences({project,assets,update,task,busy}:Props){
  const review=project.sourceReview,current=sourceReviewCurrent(project,assets);
  if(!needsSourceCheck(project,assets))return null;
  const select=(id:string,patch:Partial<SourceConflict>)=>{if(review)update({sourceReview:{...review,conflicts:review.conflicts.map(c=>c.id===id?{...c,...patch}:c)},draftStatus:project.blocks.length?'review':project.draftStatus});};
  return <section className="card source-differences"><SectionTitle title="공사범위와 마감글 대조" description="내용이 다른 항목은 사용할 내용을 선택할 수 있습니다." action={<Button className="secondary small" busy={busy} onClick={()=>task('analyze')}><Sparkles size={15}/>{current?'다시 확인':'자료 함께 확인'}</Button>}/>
    {!current?<Notice>공사범위 파일과 카페 마감글을 함께 분석해 주세요. 자료를 수정했다면 이전 선택도 다시 확인합니다.</Notice>:<>
      {review!.conflicts.length?review!.conflicts.map(c=><article className="source-conflict" key={c.id}><h3>{c.space} · {c.topic}</h3><p>{c.reason}</p><div className="conflict-pair"><div><strong>공사범위 파일</strong>{c.constructionFactIds.map(id=>{const f=project.facts.find(f=>f.id===id);return f?<p key={id}>{f.item}<small>{f.sourceLabel}</small></p>:null;})}</div><div><strong>카페 마감글</strong>{c.cafeFactIndexes.map(i=>{const f=review!.cafeFacts[i];return f?<p key={i}>{f.item}<small>“{f.evidence}”</small></p>:null;})}</div></div>
        <Field label={`${c.topic} 반영 방식`}><select value={c.decision} disabled={busy} onChange={e=>select(c.id,{decision:e.target.value as SourceConflict['decision']})}><option value="pending">선택 전 · 해당 항목 보류</option><option value="construction">공사범위 파일 내용으로 작성</option><option value="cafe">카페 마감글 내용으로 작성</option><option value="both">두 자료의 차이를 구분해 작성</option><option value="exclude">해당 항목을 글에서 제외</option><option value="custom">내가 확인한 내용으로 수정</option></select></Field>
        {c.decision==='custom'?<Field label="확인한 시공내용"><textarea rows={3} value={c.customText} onChange={e=>select(c.id,{customText:e.target.value})} placeholder="실제 시공한 내용으로 적어 주세요."/></Field>:null}
        {c.decision==='both'?<Notice>파일과 마감글의 표현 차이를 출처별로 설명합니다. 두 내용을 모두 시공했다고 단정하지 않습니다.</Notice>:null}
      </article>):<Notice tone="success">두 자료에서 명확히 서로 다른 시공 항목을 찾지 못했습니다.</Notice>}
      {review!.warnings.map((w,i)=><Notice tone="warning" key={i}>{w}</Notice>)}
      {review!.conflicts.length?<small className="source-choice-hint">선택한 내용은 다음 원고 생성에 반영됩니다. 보류한 항목은 제외해 초안을 작성하며, 자동 발행은 선택을 마칠 때까지 멈춥니다.</small>:null}
    </>}
  </section>;
}
export function ConstructionSources({project,assets,update,task,busy,onFiles,disabled}:{project:Project;assets:Asset[];update:Props['update'];task:Props['task'];busy:boolean;onFiles:(files:File[],role:Role)=>void;disabled:boolean;}){
  const materials=assets.filter(a=>a.role==='construction');
  return <><section className="card"><SectionTitle title={project.postType==='completion'?'현장의 공사범위 파일':'원본 현장의 공사범위 파일'} description={project.postType==='completion'?'PDF·JPG의 시공내역과 직접 확인한 공사내용, 현장 사진을 근거로 작성합니다.':'PDF·JPG의 시공내용을 카페 마감글, 현장 사진과 함께 확인합니다.'} action={<Button className="secondary small" busy={busy} disabled={!assets.some(a=>['photo','construction'].includes(a.role)&&a.status==='ready')} onClick={()=>task('analyze')}><Sparkles size={15}/>첨부자료 분석</Button>}/>
    <Dropzone role="construction" title="공사범위 PDF·JPG를 여기에 놓아주세요" description="글쓰기 근거 · 원본 보관 · 분석용 사본만 축소" accept="application/pdf,image/jpeg" onFiles={onFiles} disabled={disabled}/>
    {materials.length?<div className="material-list">{materials.map(a=><div className="material-row" key={a.id}><div className="file-icon"><FileText size={20}/></div><div><strong>{a.filename}</strong><small>{bytes(a.bytes)} · {a.pages?`${a.pages.length}쪽 · `:''}{a.status==='ready'?(a.analysis?'분석 완료':'분석 준비됨'):'처리 중'}</small>{a.warning?<small className="warning-text">{a.warning}</small>:null}</div><a href={a.originalUrl} className="button secondary small">원본 보기</a></div>)}</div>:null}
    {project.facts.length?<details className="construction-facts"><summary>읽은 시공 항목 확인·수정 ({project.facts.length}개)</summary><div className="facts-list">{project.facts.map(f=><div className={`fact-row ${f.uncertain&&!f.confirmed?'uncertain':''}`} key={f.id}><Field label="공간"><input value={f.space} onChange={e=>update({facts:project.facts.map(x=>x.id===f.id?{...x,space:e.target.value,confirmed:true}:x)})}/></Field><div><input aria-label="시공 항목" value={f.item} onChange={e=>update({facts:project.facts.map(x=>x.id===f.id?{...x,item:e.target.value,confirmed:true}:x)})}/><small>{f.sourceLabel}{f.uncertain&&!f.confirmed?' · 내용 확인 필요':''}</small></div><label className="check-row"><input type="checkbox" checked={f.confirmed} onChange={e=>update({facts:project.facts.map(x=>x.id===f.id?{...x,confirmed:e.target.checked}:x)})}/>확인</label></div>)}</div></details>:null}
    <Notice>텍스트 PDF는 글자를 우선 읽습니다. 사진·스캔 문서는 읽을 수 있는 축소본으로 분석하고 결과를 저장해 다시 사용합니다.</Notice>
  </section><SourceDifferences project={project} assets={assets} update={update} task={task} busy={busy}/></>;
}

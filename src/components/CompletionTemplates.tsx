import {useState} from 'react';
import type {Asset,CompletionTemplate,Project,Role} from '../../shared/model';
import {postSpaces} from '../../shared/domain.mjs';
import {Button,Dropzone,Field,Notice,SectionTitle} from './Common';

const positions={cover:'표지',scope:'공사범위',beforeAfter:'BEFORE & AFTER',space:'공간별 포인트',closing:'마무리'};
type Props={project:Project;assets:Asset[];update:(patch:Partial<Project>)=>void;onFiles:(files:File[],role:Role)=>void;busy:boolean;};
function TemplateSlot({slot,assets,project,onApply,onRemove,disabled}:{slot:CompletionTemplate;assets:Asset[];project:Project;onApply:(slot:CompletionTemplate)=>void;onRemove:()=>void;disabled:boolean}){
  const [draft,setDraft]=useState(slot),[applied,setApplied]=useState(false);
  const change=(patch:Partial<CompletionTemplate>)=>{setDraft(p=>({...p,...patch}));setApplied(false);};
  const template=assets.find(a=>a.id===draft.templateId),photos=assets.filter(a=>a.projectId===project.id&&a.role==='photo'&&!a.excluded&&!a.templateOutput);
  return <article className="completion-template-slot"><div className="form-grid"><div>{template?<><img className="completion-template-preview" loading="lazy" src={template.previewUrl} alt={`${draft.name} 원본 PSD 미리보기`}/><small>원본 PSD 미리보기 · 교체 결과는 실제 양식 확인 후 연결합니다.</small></>:<div className="empty-state"><strong>{positions[draft.position]}</strong><p>출근 후 PSD 파일을 등록해 주세요.</p></div>}</div><div>
    <Field label="템플릿 이름"><input value={draft.name} onChange={e=>change({name:e.target.value})}/></Field>
    <Field label="삽입 위치"><select value={draft.position} onChange={e=>change({position:e.target.value as CompletionTemplate['position']})}>{Object.entries(positions).map(([value,name])=><option value={value} key={value}>{name}</option>)}</select></Field>
    {draft.position==='space'?<Field label="공간"><select value={draft.space} onChange={e=>change({space:e.target.value})}>{postSpaces(project).map((space:string)=><option key={space}>{space}</option>)}</select></Field>:null}
    <Field label="사용할 PSD"><select value={draft.templateId} onChange={e=>change({templateId:e.target.value})}><option value="">나중에 등록</option>{assets.filter(a=>a.role==='template'&&a.templateKind==='completion').map(a=><option key={a.id} value={a.id}>{a.filename}</option>)}</select></Field>
    <Field label="이미지에 들어갈 문구 · 시공내용"><textarea rows={4} value={draft.text} onChange={e=>change({text:e.target.value})} placeholder="현장명·공사범위·공간별 시공 포인트를 입력하세요."/></Field>
    <details><summary>이 템플릿에 사용할 사진 {draft.photoIds.length}장</summary><div className="completion-photo-picker">{photos.map(a=><label key={a.id}><img src={a.previewUrl} alt={a.filename} loading="lazy"/><input type="checkbox" checked={draft.photoIds.includes(a.id)} onChange={e=>change({photoIds:e.target.checked?[...draft.photoIds,a.id]:draft.photoIds.filter(id=>id!==a.id)})}/>{a.filename}</label>)}</div>{!photos.length?<p>현장 사진을 먼저 첨부해 주세요.</p>:null}</details>
    <div className="button-row"><Button className="primary" disabled={disabled} onClick={()=>{onApply(draft);setApplied(true);}}>수정 변경하기</Button><Button className="text-button" disabled={disabled} onClick={onRemove}>항목 제거</Button></div>{applied?<p role="status">문구·사진 선택을 저장했습니다. PSD 자동 교체는 실제 템플릿 확인 후 적용됩니다.</p>:null}
  </div></div></article>;
}
export function CompletionTemplates({project,assets,update,onFiles,busy}:Props){
  const slots=project.completionTemplates||[];
  return <section className="card"><SectionTitle title="마감 이미지·PSD 템플릿" description="표지·공사범위·시공 전후·공간 포인트·마무리를 여러 개 등록하고 문구와 사진을 준비하세요."/>
    <Notice>아직 마감용 PSD 원본을 받기 전입니다. 입력한 문구·사진 선택은 ‘수정 변경하기’로 저장합니다. 실제 파일을 받으면 레이어 위치에 맞춰 자동 편집·완성 JPG 미리보기를 연결합니다.</Notice>
    <Dropzone role="template" title="마감 PSD 템플릿 등록" description="여러 PSD를 순서대로 등록할 수 있습니다. 시공사례용 템플릿과 별도로 보관합니다." accept=".psd,image/vnd.adobe.photoshop" onFiles={onFiles} disabled={busy}/>
    {slots.map(slot=><TemplateSlot key={slot.id+slot.templateId} slot={slot} project={project} assets={assets} disabled={busy} onApply={next=>update({completionTemplates:slots.map(s=>s.id===slot.id?next:s)})} onRemove={()=>update({completionTemplates:slots.filter(s=>s.id!==slot.id)})}/>)}
    <Button className="secondary full" disabled={busy||slots.length>=100} onClick={()=>update({completionTemplates:[...slots,{id:crypto.randomUUID(),name:'새 마감 템플릿',position:'space',space:'거실',templateId:'',text:'',photoIds:[]}]})}>템플릿 자리 추가</Button>
  </section>;
}

import type {Asset,Project,Role} from '../../shared/model';
import {templateFields,cafeScopeCurrent} from '../../shared/template-fields.mjs';
import {templateSourceSignature} from '../../shared/sources.mjs';
import {SectionTitle,Button,Notice,Dropzone,Field} from './Common';
type Props={project:Project;assets:Asset[];update:(patch:Partial<Project>)=>void;onFiles:(files:File[],role:Role)=>void;task:(kind:string)=>void;busy:boolean;};
const fields={cover:[['coverTitle','표지 현장명'],['coverConcept','표지 문구 · 콘셉트']],scope:[['location','현장 위치 · 이름'],['area','면적'],['concept','콘셉트'],['wall','벽면 · 도배'],['floor','바닥'],['other','기타 공사범위'],['scopeProject','하단 프로젝트 문구'],['scopeCopyright','하단 저작권 문구']]} as const;
export function TemplateEditor({project,assets,update,onFiles,task,busy}:Props){
  const templates=assets.filter(a=>a.role==='template'),photos=assets.filter(a=>a.role==='photo'&&!a.templateOutput&&!a.excluded&&a.status==='ready'),values=templateFields(project,assets);
  const edit=(key:keyof NonNullable<Project['templateEdits']>,value:string)=>update({templateEdits:{...project.templateEdits,[key]:value}});
  const reset=(kind:'cover'|'scope')=>{const edits={...project.templateEdits};for(const [key] of fields[kind])delete edits[key];update({templateEdits:edits});};
  return <section className="card template-editor">
    <SectionTitle title="표지와 공사범위 미리보기" description="문구를 수정한 뒤 ‘수정 변경하기’를 누르면 미리보기와 JPG에 함께 적용됩니다."/>
    {!project.original.name.trim()?<Field label="시공 현장명"><input value={project.original.name} onChange={e=>update({original:{...project.original,name:e.target.value}})} placeholder="아파트명 또는 현장명"/></Field>:null}
    {project.templateWarning?<Notice tone="warning">{project.templateWarning}</Notice>:null}
    {cafeScopeCurrent(project)&&project.cafeScope?.warnings.length?<Notice tone="warning">{project.cafeScope.warnings.join(' · ')}</Notice>:null}
    {(['cover','scope'] as const).map(kind=>{const image=assets.find(a=>a.templateOutput===kind&&!a.excluded&&a.status==='ready'),current=image?.templateSignature===templateSourceSignature(project,assets);return <div className="template-edit-card" key={kind}>
      <div className="template-image-preview"><strong>{kind==='cover'?'표지':'공사범위 · INTERIOR PLAN'}</strong>{image?<><img src={image.previewUrl} alt={image.filename}/>{!current?<Notice>변경 내용을 이미지에 반영해야 합니다. ‘수정 변경하기’를 누르면 JPG를 내려받을 수 있습니다.</Notice>:null}<a className="button secondary small" href={current?image.originalUrl:undefined} aria-disabled={!current} download>JPG 내려받기</a></>:<Notice>{kind==='cover'?'사진을 첨부한 뒤 시작 버튼을 눌러 주세요.':'카페 마감글 도입부의 공사범위 사진을 읽어 채웁니다.'}</Notice>}</div>
      <div className="template-fields">{kind==='cover'?<Field label="표지에 사용할 사진"><select value={project.templatePhotoId||photos[0]?.id||''} onChange={e=>update({templatePhotoId:e.target.value})}>{!photos.length?<option value="">현장 사진을 첨부하세요</option>:null}{photos.map(a=><option key={a.id} value={a.id}>{a.filename}</option>)}</select></Field>:<p>카페에 첨부된 공사범위 사진의 항목명과 내용을 그대로 채웁니다. 아래에서 수정한 뒤 ‘수정 변경하기’를 눌러 주세요.</p>}
        {fields[kind].map(([key,label])=><Field key={key} label={label}>{['wall','floor','other'].includes(key)?<textarea rows={key==='other'?4:2} value={values[key]} maxLength={key==='other'?12000:2000} onChange={e=>edit(key,e.target.value)}/>:<input value={values[key]} maxLength={key==='area'?100:300} onChange={e=>edit(key,e.target.value)}/>}</Field>)}
        <Button className="secondary small" onClick={()=>reset(kind)} disabled={busy}>{kind==='cover'?'현장 정보로 되돌리기':'카페 원본 내용으로 되돌리기'}</Button>
      </div>
    </div>;})}
    <Button className="primary full" busy={busy} disabled={!project.original.name.trim()||!project.coverTemplateId||!photos.length} onClick={()=>task('templates')}>{assets.some(a=>a.templateOutput==='cover'&&a.status==='ready')?'수정 변경하기':'표지·공사범위 만들기 시작'}</Button>
    <Notice>완성한 표지는 글의 첫 사진으로, 공사범위는 INTERIOR PLAN에 자동으로 들어갑니다. 포토샵을 실행할 필요가 없습니다.</Notice>
    <details className="template-settings" open={!project.coverTemplateId}><summary>등록된 PSD 템플릿 확인 · 교체</summary>
      <div className="form-grid">{(['cover','scope'] as const).map(kind=><Field key={kind} label={kind==='cover'?'표지 템플릿':'공사범위 템플릿'}><select value={project[`${kind}TemplateId`]||''} onChange={e=>update({[`${kind}TemplateId`]:e.target.value})}><option value="">{kind==='cover'?'템플릿을 선택하세요':'사용하지 않음'}</option>{templates.filter(t=>t.templateKind===kind).map(t=><option key={t.id} value={t.id}>{t.filename}</option>)}</select></Field>)}</div>
      <Dropzone compact role="template" title="다른 PSD 템플릿으로 교체" description="제공해 주신 두 템플릿은 이미 등록되어 있습니다." accept=".psd,image/vnd.adobe.photoshop" onFiles={onFiles} disabled={busy}/>
    </details>
  </section>;
}

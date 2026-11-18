import {useEffect,useState} from 'react';
import type {Asset,Project,Role} from '../../shared/model';
import {api,type CoverFrame} from '../api';
import {templateFields,cafeScopeCurrent} from '../../shared/template-fields.mjs';
import {caseCoverPhotos,templateSourceSignature} from '../../shared/sources.mjs';
import {SectionTitle,Button,Notice,Dropzone,Field} from './Common';
type Props={project:Project;assets:Asset[];update:(patch:Partial<Project>)=>void;onFiles:(files:File[],role:Role)=>Promise<Asset[]>|void;task:(kind:string)=>void;busy:boolean;};
const fields={cover:[['coverTitle','표지 현장명'],['coverConcept','표지 문구 · 콘셉트']],scope:[['location','현장 위치 · 이름'],['area','면적'],['concept','콘셉트'],['wall','벽면 · 도배'],['floor','바닥'],['other','기타 공사범위'],['scopeProject','하단 프로젝트 문구'],['scopeCopyright','하단 저작권 문구']]} as const;
const defaultCrop={zoom:1,x:0,y:0};
function appliedCoverTemplate(image?:Asset){
  try{return JSON.parse(image?.templateSignature||'null')?.cover;}catch{return undefined;}
}
export function TemplateEditor({project,assets,update,onFiles,task,busy}:Props){
  const templates=assets.filter(a=>a.role==='template'),photos=caseCoverPhotos(assets) as Asset[],values=templateFields(project,assets);
  const coverTemplate=templates.find(a=>a.id===project.coverTemplateId&&a.templateKind==='cover'),coverTemplateId=coverTemplate?.id;
  const [frameResult,setFrameResult]=useState<{id:string;frame?:CoverFrame}|null>(null);
  useEffect(()=>{
    if(!coverTemplateId)return;
    let active=true;
    api.coverFrame(coverTemplateId).then(frame=>{if(active)setFrameResult({id:coverTemplateId,frame});},()=>{if(active)setFrameResult({id:coverTemplateId});});
    return()=>{active=false;};
  },[coverTemplateId]);
  const frame=frameResult&&frameResult.id===coverTemplateId?frameResult.frame:undefined;
  const selectedPhoto=photos.find(a=>a.id===(project.templatePhotoId||project.coverAssetId))||photos.find(a=>a.status==='ready')||photos[0];
  const crop=project.caseCoverCrop||defaultCrop;
  const editCrop=(key:keyof typeof crop,value:number)=>update({caseCoverCrop:{...crop,zoom:key!=='zoom'&&value!==0&&crop.zoom===1?1.1:crop.zoom,[key]:value}});
  const x=(100-crop.x)/2,y=(100-crop.y)/2;
  const signature=templateSourceSignature(project,assets);
  const uploadCover=async(file:File)=>{
    const uploaded=await onFiles([file],'template-photo');
    const photo=uploaded?.find(asset=>asset.role==='template-photo');
    if(photo)update({templatePhotoId:photo.id,caseCoverCrop:undefined});
  };
  const edit=(key:keyof NonNullable<Project['templateEdits']>,value:string)=>update({templateEdits:{...project.templateEdits,[key]:value}});
  const reset=(kind:'cover'|'scope')=>{const edits={...project.templateEdits};for(const [key] of fields[kind])delete edits[key];update({templateEdits:edits});};
  return <section className="card template-editor">
    <SectionTitle title="표지와 공사범위 미리보기" description="표지 사진의 위치와 확대는 바로 미리 볼 수 있습니다. 문구와 JPG는 ‘수정 변경하기’를 눌러 반영하세요."/>
    {!project.original.name.trim()?<Field label="시공 현장명"><input value={project.original.name} onChange={e=>update({original:{...project.original,name:e.target.value}})} placeholder="아파트명 또는 현장명"/></Field>:null}
    {project.templateWarning?<Notice tone="warning">{project.templateWarning}</Notice>:null}
    {cafeScopeCurrent(project)&&project.cafeScope?.warnings.length?<Notice tone="warning">{project.cafeScope.warnings.join(' · ')}</Notice>:null}
    {(['cover','scope'] as const).map(kind=>{
      const image=assets.find(a=>a.templateOutput===kind&&!a.excluded&&a.status==='ready'),current=image?.templateSignature===signature;
      const live=kind==='cover'&&frame&&selectedPhoto?.status==='ready'&&selectedPhoto.previewUrl&&coverTemplate;
      const base=live&&(current||appliedCoverTemplate(image)===coverTemplate.id)?image:coverTemplate;
      return <div className="template-edit-card" key={kind}>
      <div className="template-image-preview"><strong>{kind==='cover'?'표지':'공사범위 · INTERIOR PLAN'}</strong>
        {live&&base?<div className="case-cover-live" style={{aspectRatio:frame.width/frame.height,maxWidth:520*frame.width/frame.height}}>
          <img src={base.templateOutput?base.originalUrl:base.previewUrl} alt="시공사례 표지 미리보기"/>
          <div className="case-cover-live-photo" style={{left:`${100*frame.photo.x/frame.width}%`,top:`${100*frame.photo.y/frame.height}%`,width:`${100*frame.photo.width/frame.width}%`,height:`${100*frame.photo.height/frame.height}%`}}>
            <img src={selectedPhoto.originalUrl} alt="" style={{width:`${100*crop.zoom}%`,height:`${100*crop.zoom}%`,left:`${(1-crop.zoom)*x}%`,top:`${(1-crop.zoom)*y}%`,objectPosition:`${x}% ${y}%`,opacity:current?0:1}}/>
          </div>
        </div>:image?<img src={image.originalUrl} alt={image.filename}/>:<Notice>{kind==='cover'?'표지 PSD와 현장 사진을 선택해 주세요.':'카페 마감글 도입부의 공사범위 사진을 읽어 채웁니다.'}</Notice>}
        {kind==='cover'&&frameResult&&frameResult.id===coverTemplateId&&!frameResult.frame?<Notice tone="warning">표지의 사진 영역을 읽지 못했습니다. PSD를 다시 선택해 주세요.</Notice>:null}
        {image?<>{!current?<Notice>‘수정 변경하기’를 누르면 변경 내용이 JPG에 적용됩니다.</Notice>:null}<a className="button secondary small" href={current?image.originalUrl:undefined} aria-disabled={!current} download>JPG 내려받기</a></>:null}
      </div>
      <div className="template-fields">{kind==='cover'?<>
        <Field label="표지에 사용할 사진"><select value={selectedPhoto?.id||''} onChange={e=>update({templatePhotoId:e.target.value,caseCoverCrop:undefined})} disabled={busy}>{!photos.length?<option value="">현장 사진을 첨부하세요</option>:null}{photos.map(a=><option key={a.id} value={a.id}>{a.filename}{a.status==='processing'?' · 처리 중':''}</option>)}</select></Field>
        <Field label="표지 사진 첨부" hint="표지에 선택한 원본은 템플릿 제작에만 사용합니다."><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void uploadCover(file);}}/></Field>
        <fieldset className="case-cover-crop" disabled={busy||!selectedPhoto}>
          <legend>표지 사진 조정</legend>
          <Field label={`사진 확대 (${Math.round(crop.zoom*100)}%)`}><input aria-label="표지 사진 확대" type="range" min={1} max={3} step={0.05} value={crop.zoom} onChange={e=>editCrop('zoom',Number(e.target.value))}/></Field>
          <Field label="좌우 위치"><input aria-label="표지 사진 좌우 위치" type="range" min={-100} max={100} value={crop.x} onChange={e=>editCrop('x',Number(e.target.value))}/></Field>
          <Field label="상하 위치" hint="100%에서 위치를 옮기면 사진을 110%로 확대해 빈 여백이 생기지 않게 합니다."><input aria-label="표지 사진 상하 위치" type="range" min={-100} max={100} value={crop.y} onChange={e=>editCrop('y',Number(e.target.value))}/></Field>
          <Button className="secondary small" onClick={()=>update({caseCoverCrop:undefined})}>사진 위치·확대 초기화</Button>
        </fieldset>
      </>:<p>카페에 첨부된 공사범위 사진의 항목명과 내용을 그대로 채웁니다. 아래에서 수정한 뒤 ‘수정 변경하기’를 눌러 주세요.</p>}
        {fields[kind].map(([key,label])=><Field key={key} label={label}>{['wall','floor','other'].includes(key)?<textarea rows={key==='other'?4:2} value={values[key]} maxLength={key==='other'?12000:2000} onChange={e=>edit(key,e.target.value)}/>:<input value={values[key]} maxLength={key==='area'?100:300} onChange={e=>edit(key,e.target.value)}/>}</Field>)}
        <Button className="secondary small" onClick={()=>reset(kind)} disabled={busy}>{kind==='cover'?'현장 정보로 되돌리기':'카페 원본 내용으로 되돌리기'}</Button>
      </div>
    </div>;})}
    <Button className="primary full" busy={busy} disabled={!project.original.name.trim()||!project.coverTemplateId||selectedPhoto?.status!=='ready'} onClick={()=>task('templates')}>{assets.some(a=>a.templateOutput==='cover'&&a.status==='ready')?'수정 변경하기':'표지·공사범위 만들기 시작'}</Button>
    <Notice>완성한 표지는 글의 첫 사진으로, 공사범위는 INTERIOR PLAN에 자동으로 들어갑니다. 포토샵을 실행할 필요가 없습니다.</Notice>
    <details className="template-settings" open={!project.coverTemplateId}><summary>등록된 PSD 템플릿 확인 · 교체</summary>
      <div className="form-grid">{(['cover','scope'] as const).map(kind=><Field key={kind} label={kind==='cover'?'표지 템플릿':'공사범위 템플릿'}><select value={project[`${kind}TemplateId`]||''} onChange={e=>update({[`${kind}TemplateId`]:e.target.value})}><option value="">{kind==='cover'?'템플릿을 선택하세요':'사용하지 않음'}</option>{templates.filter(t=>t.templateKind===kind).map(t=><option key={t.id} value={t.id}>{t.filename}</option>)}</select></Field>)}</div>
      <Dropzone compact role="template" title="다른 PSD 템플릿으로 교체" description="제공해 주신 두 템플릿은 이미 등록되어 있습니다." accept=".psd,image/vnd.adobe.photoshop" onFiles={onFiles} disabled={busy}/>
    </details>
  </section>;
}

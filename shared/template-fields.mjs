import {sourceReviewCurrent} from './sources.mjs';
export const cafeScopeSignature=project=>JSON.stringify([project.cafeUrl,project.sourceText]);
export const cafeScopeCurrent=project=>!!project.cafeScope&&project.cafeScope.signature===cafeScopeSignature(project)&&typeof project.cafeScope.scopeProject==='string'&&typeof project.cafeScope.scopeCopyright==='string';
export function templateFields(project,assets){
  const site=project.original,py=String(site.type).match(/(\d+(?:\.\d+)?)\s*(?:평|PY)/i)?.[1];
  const info=Object.fromEntries((sourceReviewCurrent(project,assets)?project.sourceReview.siteInfo||[]:[]).filter(f=>!f.uncertain).map(f=>[f.field,f.value]));
  const scope=cafeScopeCurrent(project)?project.cafeScope:null;
  const area=py?`${py}PY`:Number(site.supplyArea)>0?`${Math.round(Number(site.supplyArea)/3.305785)}PY`:scope?.area||info.area||'';
  const title=site.name.trim().startsWith(site.region.trim())?site.name.trim():[site.region,site.name].filter(Boolean).join(' '),location=info.location||title,concept=project.concept||scope?.concept||info.concept||'';
  const rows=scope?.rows||[],value=field=>rows.filter(r=>r.field===field).map(r=>field==='other'&&!/^(?:그\s*외|기타)$/.test(r.label)?`${r.label} · ${r.value}`:r.value).join('\n');
  return {coverTitle:[title,area].filter(Boolean).join(' '),coverConcept:concept||'레몬하우스 인테리어 시공사례',location:scope?.location??location,area:scope?.area??area,concept:scope?.concept??concept,wall:value('wall'),floor:value('floor'),other:value('other'),scopeProject:scope?.scopeProject??'',scopeCopyright:scope?.scopeCopyright??'',...project.templateEdits};
}

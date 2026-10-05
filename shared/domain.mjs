import {needsSourceCheck,sourceReviewCurrent,resolvedSourceEvidence,unresolvedConstructionFacts,draftSourceSignature} from './sources.mjs';
import {formatFor,textCss} from './format.mjs';
export const SPACES = ['표지', '현관', '거실', '주방', '안방', '작은방', '욕실', '기타'];
export const PHASES = ['site', 'compare', 'assets', 'write', 'publish'];
const REFERENCE_URLS = ['224391021069','224386470907','224386525358','224385704870','224385749437'].map(id => `https://blog.naver.com/lemonhouse8/${id}`);
export const DEFAULT_STYLE = {
  name: '레몬하우스 인테리어 추천', referenceUrls: REFERENCE_URLS, status: 'reference',
  rules: '가운데 정렬. 표지 사진 1장 → 친근한 브랜드 인사와 추천 대상 소개 → 아파트명 인테리어 추천 인용구 → 현관·거실·주방·안방·작은방·욕실 순서로 사진 묶음 먼저, 공간명과 설명 다음 → 마무리와 문의 안내 → 태그. 자료가 없는 공간은 생략. 공간 설명은 시공 요소 → 디자인 또는 생활 효과 → 부드러운 권유로 연결. 연출해 보세요, 추천드립니다, 좋을 것 같습니다 등 친근한 권유형. 도입과 마무리는 짧은 줄바꿈, 공간 설명은 자연스럽게 이어지는 문장. 사진마다 캡션을 붙이지 않고 공간별 종합 설명. 분량은 근거의 양에 맞춰 조절. 이전 글의 아파트명, 지역, 오타, 편집 메모, 잘못된 태그를 복제하지 않기. 실제 원본 현장의 디자인을 추천 대상 아파트에 제안하며 대상에서 시공한 것으로 표현하지 않기. 마무리에 디자인 제안이며 실제 현장과 차이가 있을 수 있다는 안내 포함.',
};
export const DEFAULT_SETTINGS = {blogId: '', brand: '레몬하우스', phone: '1644-0402', model: '', analysisModel: '', photoEdge: 1024};
function emptySite() { return {name:'', region:'', type:'', supplyArea:'', exclusiveArea:'', sourceUrl:''}; }
export function newProject(id = crypto.randomUUID()) {
  const now = new Date().toISOString();
  return {id, revision:0, name:'새 추천글', phase:'site', original:emptySite(), target:emptySite(), manualWork:'', cafeUrl:'', sourceText:'', concept:'', keywords:[{term:'',min:7,max:8}], title:'', blocks:[], tags:[], facts:[], comparison:null, publishMode:'review',visibility:'public', scheduleAt:'', updatedAt:now, createdAt:now, draftStatus:'empty', generationWarnings:[]};
}
export function bodyText(project) { return project.blocks.filter(b => ['text','heading','quote'].includes(b.kind)).map(b => b.text || '').join('\n'); }
export function countOccurrences(text, term) {
  if (!term.trim()) return 0;
  let count=0, pos=0;
  while ((pos=text.indexOf(term, pos)) !== -1) { count++; pos += term.length; }
  return count;
}
export function keywordReport(project) {
  const text = bodyText(project);
  const active = project.keywords.filter(k => k.term.trim());
  return active.map(k => {
    const count = countOccurrences(text,k.term);
    const collision = active.some(o => o.term !== k.term && o.term.includes(k.term) && o.min > k.max);
    return {...k,count,ok:count>=k.min&&count<=k.max,collision};
  });
}
export function escapeHtml(value='') { return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function parseJsonOutput(text) {
  const clean=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try { return JSON.parse(clean); } catch { throw Object.assign(new Error('AI 결과 형식을 읽을 수 없습니다. 자료는 저장되어 있습니다. 다시 생성하거나 직접 수정해 주세요.'),{status:422}); }
}
export function validateNaverUrl(raw, kind='any') {
  let url;
  try { url=new URL(raw); } catch { throw Object.assign(new Error('올바른 네이버 링크를 입력해 주세요.'),{status:400}); }
  const hosts = kind==='blog' ? ['blog.naver.com','m.blog.naver.com'] : kind==='cafe' ? ['cafe.naver.com','m.cafe.naver.com'] : ['blog.naver.com','m.blog.naver.com','cafe.naver.com','m.cafe.naver.com','land.naver.com','fin.land.naver.com','new.land.naver.com'];
  if (url.protocol!=='https:' || url.username || url.password || (url.port&&url.port!=='443') || !hosts.includes(url.hostname)) throw Object.assign(new Error('지원하는 네이버 HTTPS 링크만 사용할 수 있습니다.'),{status:400});
  return url.toString();
}
export function photoGroups(assets) {
  const groups=[]; const byId=new Map();
  for (const asset of assets.filter(a=>a.role==='photo'&&!a.excluded).sort((a,b)=>a.order-b.order)) {
    const key=asset.group?`${asset.space}:${asset.group}`:asset.id;
    if(!byId.has(key)){ const g={id:key,space:asset.space,assets:[]};groups.push(g);byId.set(key,g); }
    byId.get(key).assets.push(asset);
  }
  return groups;
}
export function draftWarnings(project,assets) {
  const warnings=[];
  if(!project.original.name.trim()||!project.target.name.trim())warnings.push('원본 현장과 추천 현장을 입력해 주세요.');
  if([project.original,project.target].some(site=>site.details&&!site.type))warnings.push('조회한 아파트의 실제 평형·타입을 선택해 주세요.');
  if(!project.title.trim()||!bodyText(project).trim())warnings.push('제목과 본문이 필요합니다.');
  const byId=new Map(assets.map(a=>[a.id,a])); const seen=new Set();
  for(const block of project.blocks.filter(b=>b.kind==='photos')){
    if(!block.assetIds?.length)warnings.push('빈 사진 묶음이 있습니다.');
    for(const id of block.assetIds||[]){const a=byId.get(id);if(!a||a.role!=='photo'||a.excluded)warnings.push('본문에 사용할 수 없는 사진이 있습니다.');if(seen.has(id))warnings.push('같은 사진이 본문에 중복 배치되어 있습니다.');seen.add(id);}
  }
  const groups=photoGroups(assets);const intended=SPACES.flatMap(space=>groups.filter(g=>g.space===space).map(g=>g.assets.map(a=>a.id).join(',')));
  const actual=project.blocks.filter(b=>b.kind==='photos').map(b=>(b.assetIds||[]).join(','));
  if(JSON.stringify(intended)!==JSON.stringify(actual))warnings.push('변경한 사진 순서와 묶음을 원고에 반영해 주세요.');
  if(assets.some(a=>a.role==='photo'&&!a.excluded&&a.status!=='ready'))warnings.push('사용할 사진의 처리가 끝나지 않았습니다.');
  if(unresolvedConstructionFacts(project,assets).length)warnings.push('시공내역에 확인이 필요한 항목이 있습니다.');
  if(needsSourceCheck(project,assets)&&!sourceReviewCurrent(project,assets))warnings.push('공사범위 파일과 마감글의 차이를 다시 확인해 주세요.');
  if(resolvedSourceEvidence(project,assets).pending.length)warnings.push('자료가 다른 항목의 반영 방식을 선택해 주세요.');
  if(project.draftSourceSignature&&project.draftSourceSignature!==draftSourceSignature(project,assets))warnings.push('현장·자료 또는 반영 방식이 바뀌었습니다. 선택한 내용으로 원고를 다시 생성해 주세요.');
  if(keywordReport(project).some(k=>!k.ok))warnings.push('설정한 키워드 목표 횟수를 확인해 주세요.');
  if(project.scheduleAt&&new Date(project.scheduleAt).getUTCMinutes()%10!==0)warnings.push('예약 시각은 10분 단위로 선택해 주세요.');
  if(/\(표지\)|\[(?:사진|단독\s*이미지|\d+\s*장\s*콜라주)\]|\buncertain\b|TODO|현장\s*[AB]/i.test(bodyText(project)))warnings.push('본문에 편집 메모가 남아 있습니다.');
  return [...new Set(warnings)];
}
export function paragraphHtml(block,format) {
  const text=escapeHtml(block.text).replace(/\n/g,'<br/>');
  const style=block.kind==='heading'?format.heading:block.kind==='quote'?format.quote:format.body;
  return `<p style="text-align:${style.align};margin:20px 0;${textCss(style)}"><span style="${textCss(style)}">${style.fontWeight>=600?`<b>${text}</b>`:text}</span></p>`;
}
export function exportHtml(project, assets) {
  const byId = new Map(assets.map(a=>[a.id,a]));
  const format=formatFor(project);
  const blocks=project.blocks.map(b=>{
    if(b.kind==='divider')return `<hr data-naver-variant="${format.dividerVariant}" style="${format.dividerVariant==='line6'?"width:44px;height:44px;background:transparent url(https://editor-static.pstatic.net/v/basic/1.78.1/img/se-sp-viewer.ee5afa38.png) -422px -46px / 466px 418px":"width:80px;border-top:1px solid #ddd"};margin:36px auto;border:0"/>`;
    if(b.kind==='photos')return `<div style="display:flex;gap:4px;margin:20px 0">${(b.assetIds||[]).map(id=>{const a=byId.get(id);return a?`<img src="${escapeHtml(a.originalUrl)}" alt="${escapeHtml(a.space)}" style="width:${100/(b.assetIds?.length||1)}%;object-fit:contain"/>`:'';}).join('')}</div>`;
    const paragraph=paragraphHtml(b,format),style=format.quote;
    if(b.kind==='quote')return `<blockquote data-naver-variant="${format.quoteVariant}" style="position:relative;max-width:460px;text-align:${style.align};border:0;margin:36px auto;padding:38px 36px;${textCss(style)}">${format.quoteVariant==='quotation_corner'?'<span aria-hidden="true" style="position:absolute;top:0;left:0;width:26px;height:26px;border-top:6px solid #4a4a4a;border-left:6px solid #4a4a4a"></span><span aria-hidden="true" style="position:absolute;bottom:0;right:0;width:26px;height:26px;border-bottom:6px solid #4a4a4a;border-right:6px solid #4a4a4a"></span>':''}${paragraph}</blockquote>`;
    return paragraph;
  }).join('\n');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"/><title>${escapeHtml(project.title)}</title><body><article style="max-width:860px;margin:auto;color:#222"><h1>${escapeHtml(project.title)}</h1>${blocks}<p>${project.tags.map(t=>`#${escapeHtml(t)}`).join(' ')}</p></article></body></html>`;
}

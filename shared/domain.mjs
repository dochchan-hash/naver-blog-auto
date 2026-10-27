import {needsSourceCheck,sourceReviewCurrent,resolvedSourceEvidence,unresolvedConstructionFacts,draftSourceSignature,templateSourceSignature} from './sources.mjs';
import {formatFor,textCss,blockTextStyles,blockTextLines,referenceSpaceOrder,referenceStructure,referenceValue} from './format.mjs';
import {completionSignature} from './completion-templates.mjs';
import {photoUploadBlocks} from './photo-layout.mjs';
export const SPACES = ['현관', '거실', '주방', '안방', '안방욕실', '작은방1', '작은방2', '공용욕실'];
export const PHASES = ['site', 'compare', 'assets', 'write', 'publish'];
const REFERENCE_URLS = ['224391021069','224386470907','224386525358','224385704870','224385749437'].map(id => `https://blog.naver.com/lemonhouse8/${id}`);
export const DEFAULT_STYLE = {
  name: '레몬하우스 인테리어 추천', referenceUrls: REFERENCE_URLS, status: 'reference',
  rules: '가운데 정렬. 표지 사진 1장 → 친근한 브랜드 인사와 추천 대상 소개 → 아파트명 인테리어 추천 인용구 → 현관·거실·주방·안방·안방욕실·작은방1·작은방2·공용욕실 순서로 사진 묶음 먼저, 공간명과 설명 다음 → 마무리와 문의 안내 → 태그. 자료가 없는 공간은 생략. 공간 설명은 시공 요소 → 디자인 또는 생활 효과 → 부드러운 권유로 연결. 연출해 보세요, 추천드립니다, 좋을 것 같습니다 등 친근한 권유형. 도입과 마무리는 짧은 줄바꿈, 공간 설명은 자연스럽게 이어지는 문장. 사진마다 캡션을 붙이지 않고 공간별 종합 설명. 분량은 근거의 양에 맞춰 조절. 이전 글의 아파트명, 지역, 오타, 편집 메모, 잘못된 태그를 복제하지 않기. 실제 원본 현장의 디자인을 추천 대상 아파트에 제안하며 대상에서 시공한 것으로 표현하지 않기. 마무리에 디자인 제안이며 실제 현장과 차이가 있을 수 있다는 안내 포함.',
};
export const DEFAULT_SETTINGS = {blogId: '', brand: '레몬하우스', phone: '1644-0402', model: '', analysisModel: '', photoEdge: 1024};
function emptySite() { return {name:'', region:'', type:'', supplyArea:'', exclusiveArea:'', sourceUrl:''}; }
export const CASE_SPACES=[...SPACES,'복도','알파룸','드레스룸'];
export const DEFAULT_CASE_STYLE={name:'레몬하우스 시공사례',referenceUrls:['224418954497','224408307594','224406227010','224405900018','224403861966'].map(id=>`https://blog.naver.com/link_design_studio/${id}`),status:'reference',rules:'실제로 시공한 한 현장의 시공사례를 소개합니다. 편집한 표지 → 콘셉트를 소개하는 인용구 → 브랜드 인사와 현장 소개 → INTERIOR PLAN 도면 이미지 → 공간별 영문·한글 제목 인용구 → 사진 묶음 → 확인된 시공 설명 → 마무리 → 구분선 → 브랜드·문의 연락처 순서입니다. 본문은 왼쪽 정렬, 나눔바른고딕 15px, 공간 제목은 밑줄형 인용구로 영문 나눔명조 19px와 한글 나눔고딕 13px를 사용합니다. 사진이 있는 공간만 쓰며 실제 시공 요소와 디자인 효과를 설명하고 다양한 제안 어미를 섞습니다. 참고글의 현장명·오타·편집 메모는 복사하지 않습니다.'};
export const COMPLETION_SPACES=['현관','복도','거실','주방','주방베란다','안방','파우더룸','드레스룸','안방베란다','안방욕실','작은방1','작은방2','작은방3','공용욕실','알파룸','베란다'];
export const DEFAULT_COMPLETION_STYLE={name:'레몬하우스 카페 마감',referenceUrls:['18233','18192'].map(id=>`https://cafe.naver.com/fmbsno1/${id}`),status:'reference',rules:'네이버 카페에 실제 공사 완료 현장을 소개하는 마감 게시글입니다. 표지 → 브랜드 인사와 현장 소개 → 확인한 현장 지도 → line5 구분선 → 공사범위 → 가운데 모서리형 BEFORE & AFTER 인용구와 시공 전후 이미지 → 공간별 왼쪽 세로선 인용구 제목 → 공간 포인트 이미지와 번호 사이 빈 줄 한 줄을 둔 시공 포인트 설명 → 공간별 첫 현장 사진 1장 단독 → 공간 종합 설명 → 나머지 현장 사진 슬라이드 → 왼쪽 마무리 인사 → 가운데 주황색 굵은 19px 연락처 → line5 구분선 → 현장 동영상과 제목 → 제공된 마무리 자료 순서입니다. 본문은 왼쪽 정렬 15px 검정, 공간 제목은 왼쪽 정렬 19px 세로선 인용구, 구분선은 line5를 사용합니다. 확인된 시공내역만 사용하고 각 공간 설명은 최대 7줄입니다. 다양한 자연스러운 권유와 설명 어미를 섞습니다. 사진이 있는 공간만 쓰고 다른 현장명·주소·오타는 복사하지 않습니다.'};
export function styleKey(postType){return postType==='completion'?'completion':postType==='case'?'case':'main';}
export function postLabel(project){return project.postType==='completion'?'마감':project.postType==='case'?'시공사례':'추천글';}
export function postSite(project){return project.postType&&project.postType!=='recommendation'?project.original:project.target;}
export function postSpaces(project){return project.postType==='completion'?COMPLETION_SPACES:project.postType==='case'?CASE_SPACES:SPACES;}
export function photoSpaces(project){return [...postSpaces(project),...(project.postType==='case'?['표지','도면']:project.postType==='completion'?['표지','공사범위','시공전후','마무리']:[])];}
export function publicationCategory(project){return project.postType==='case'?project.category||'':'추천 인테리어';}
export function newProject(id = crypto.randomUUID(),postType='recommendation') {
  const now = new Date().toISOString();
  return {id, revision:0,postType,...(postType==='case'?{category:''}:{}),...(postType==='completion'?{cafeTargetUrl:'https://cafe.naver.com/fmbsno1',cafeBoardUrl:'',completionTemplates:[['표지','cover'],['공사범위','scope'],['시공 전후','beforeAfter'],['공간별 포인트','space'],['마무리','closing']].map(([name,position],i)=>({id:id+'-template-'+i,name,position,space:'거실',templateId:'',text:'',photoIds:[]}))}:{}), name:`새 ${postLabel({postType})}`, phase:'site', original:emptySite(), target:emptySite(), manualWork:'', cafeUrl:'', sourceText:'', concept:'', keywords:[{term:'',min:7,max:8}], title:'', blocks:[], tags:[], facts:[], comparison:null, questionQuote:'none',publishMode:'review',visibility:'public', scheduleAt:'', updatedAt:now, createdAt:now, draftStatus:'empty', generationWarnings:[]};
}
export function bodyText(project) { return project.blocks.filter(b => ['text','heading','quote'].includes(b.kind)).map(b => b.text || '').join('\n'); }
function countOccurrences(text, term) {
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
function escapeHtml(value='') { return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
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
export function photoGroups(assets,coverId='',templatePhotoId='') {
  const groups=[]; const byId=new Map();
  const photo=assets.find(a=>a.id===templatePhotoId&&a.role==='photo'&&!a.excluded&&!a.templateOutput),scope=assets.find(a=>a.templateOutput==='scope'&&a.role==='photo'&&!a.excluded);
  for (const asset of assets.filter(a=>a.role==='photo'&&!a.excluded&&a.id!==coverId).sort((a,b)=>Number(!!b.templateSlotId)-Number(!!a.templateSlotId)||a.order-b.order)) {
    if(photo&&scope&&asset.id===scope.id)continue;
    const key=asset.group?`${asset.space}:${asset.group}`:asset.id;
    if(!byId.has(key)){ const g={id:key,space:asset.space,assets:[]};groups.push(g);byId.set(key,g); }
    byId.get(key).assets.push(asset);
  }
  return photo&&scope?[{id:'interior-plan',space:'도면',assets:[photo,scope]},...groups]:groups;
}
export function isPlanCollage(project,block,assets){return project.postType==='case'&&block.kind==='photos'&&block.space==='도면'&&block.assetIds?.length===2&&block.assetIds[0]===project.templatePhotoId&&assets.some(a=>a.id===block.assetIds[1]&&a.templateOutput==='scope'&&!a.excluded);}
export function photoLayoutBlocks(project,assets,createId=()=>crypto.randomUUID()){
  if(project.postType==='completion')return completionPhotoLayout(project,assets,createId);
  const groups=photoGroups(assets,project.coverAssetId,project.postType==='case'?project.templatePhotoId:''),format=formatFor(project),blocks=[],used=new Set();
  const add=space=>{if(used.has(space))return;used.add(space);groups.filter(g=>g.space===space).forEach(g=>blocks.push({id:createId(),kind:'photos',space,assetIds:g.assets.map(a=>a.id)}));};
  if(project.coverAssetId)blocks.push({id:createId(),kind:'photos',space:'표지',assetIds:[project.coverAssetId]});else add('표지');
  for(const b of project.blocks.filter(b=>b.kind!=='photos')){blocks.push(b);if(project.postType==='case'&&b.text==='INTERIOR PLAN')add('도면');if(b.space&&['heading','quote'].includes(b.kind))add(b.space);}
  const newBlocks=[];
  for(const space of [...new Set([...referenceSpaceOrder(format),...postSpaces(project)])])if(!used.has(space)&&groups.some(g=>g.space===space)){
    newBlocks.push({id:createId(),kind:format.headingKind==='quote'?'quote':'heading',variant:format.headingKind==='quote'?referenceValue(format.headingVariants,space)||format.headingQuoteVariant||format.quoteVariant:undefined,space,text:project.postType==='case'?`${({현관:'ENTRANCE',거실:'LIVING ROOM',주방:'KITCHEN',안방욕실:'BATH',공용욕실:'BATH',알파룸:'ALPHA ROOM',복도:'HALLWAY',드레스룸:'DRESS ROOM'})[space]||'ROOM'}\n${space} 인테리어`:space});
    for(const g of groups.filter(g=>g.space===space))newBlocks.push({id:createId(),kind:'photos',space,assetIds:g.assets.map(a=>a.id)});
    newBlocks.push({id:createId(),kind:'text',space,text:''});
  }
  const last=blocks.reduce((last,b,i)=>b.space&&['heading','quote'].includes(b.kind)?i:last,-1),outro=blocks.findIndex((b,i)=>i>last&&b.kind==='divider');
  blocks.splice(outro<0?blocks.length:outro,0,...newBlocks);
  return postVideoBlocks(project,assets,referenceStructure({...project,blocks},format),createId);
}
function completionSpacePhotos(groups){
  const points=groups.filter(g=>g.assets.some(a=>a.templateSlotId)),all=groups.filter(g=>!points.includes(g)).flatMap(g=>g.assets),space=groups[0]?.space;
  const representative=all.length?[{space,assets:[all[0]]}]:[];
  const slides=[];for(let i=1;i<all.length;i+=10)slides.push({space,assets:all.slice(i,i+10),layout:all.length-i>1?'slide':undefined});
  return {points,representative,slides};
}
export function completionPointSpaces(project){
  return [...new Set((project.completionTemplates||[]).filter(s=>s.position==='space'&&s.enabled!==false&&s.templateId).map(s=>s.space))];
}
export function completionBlocks(project,assets,result,profile,createId=()=>crypto.randomUUID()){
  const groups=photoGroups(assets,project.coverAssetId),pointSpaces=completionPointSpaces(project),blocks=[];
  const add=block=>blocks.push({id:createId(),...block});
  const photos=(g,layout)=>add({kind:'photos',space:g.space,assetIds:g.assets.map(a=>a.id),...(g.assets.length>1?{layout:layout==='slide'?'slide':'collage'}:{})});
  const cover=assets.find(a=>a.id===project.coverAssetId&&!a.excluded);
  if(cover)photos({space:'표지',assets:[cover]});else groups.filter(g=>g.space==='표지').forEach(g=>photos(g));
  add({kind:'text',formatRole:'intro',text:result.intro.split(/\r?\n/).filter(line=>!/^\s*BEFORE\s*&\s*AFTER\s*$/i.test(line)).join('\n').trim()});
  add({kind:'divider',variant:profile.dividerVariant});
  for(const space of ['공사범위','시공전후']){
    const selected=groups.filter(g=>g.space===space);
    if(space==='시공전후'&&selected.length)add({kind:'quote',text:'BEFORE & AFTER',variant:profile.quoteVariant});
    selected.forEach(g=>photos(g));
  }
  const questions=result.questionAnswers?.length?result.questionAnswers:result.questionAnswer?[result.questionAnswer]:[];let questionIndex=0,written=0;
  const addQuestion=()=>{const q=questions[questionIndex++];if(q){add({kind:'quote',text:q.question,variant:profile.quoteVariant});add({kind:'text',text:q.answer});}};
  const total=result.sections.filter(s=>groups.some(g=>g.space===s.space)).length;
  for(const space of [...new Set([...referenceSpaceOrder(profile),...COMPLETION_SPACES])]){
    const selected=groups.filter(g=>g.space===space);if(!selected.length)continue;
    const section=result.sections.find(s=>s.space===space);if(!section?.text.trim())throw new Error(space+' 설명이 비어 있습니다. 기존 원고는 보존했습니다.');
    add({kind:'quote',space,text:({파우더룸:'안방 파우더룸',드레스룸:'안방 드레스룸',주방베란다:'주방 베란다',안방베란다:'안방 베란다',안방욕실:'안방 욕실',공용욕실:'공용 욕실',작은방1:'작은방 1',작은방2:'작은방 2',작은방3:'작은방 3'})[space]||space,variant:referenceValue(profile.headingVariants,space)||profile.headingQuoteVariant});
    const {points,representative,slides}=completionSpacePhotos(selected);
    points.forEach(g=>photos(g));
    for(const [i,p]of (pointSpaces.includes(space)?section.points||[]:[]).entries()){
      add({kind:'text',formatRole:'point',space,text:(i+1)+'. '+p.title.replace(/^\s*\d+[.)]\s*/, '')});
      add({kind:'text',formatRole:'pointBody',space,text:p.text});
    }
    representative.forEach(g=>photos(g,g.layout));
    add({kind:'text',space,text:section.text});
    slides.forEach(g=>photos(g,g.layout));
    written++;if(project.questionQuote==='middle')while(questionIndex<questions.length&&written>=Math.max(1,Math.ceil((questionIndex+1)*total/(questions.length+1))))addQuestion();
  }
  if(project.questionQuote==='end')while(questionIndex<questions.length)addQuestion();
  const contact=String(result.phone||'').replace(/[\s()-]/g,''),outro=result.outro.split(/\r?\n/).filter(line=>!contact||line.replace(/^\s*T(?:el)?\.?\s*/i,'').replace(/[\s()-]/g,'')!==contact).join('\n').trim();
  add({kind:'text',formatRole:'closing',text:outro});
  if(result.phone)add({kind:'text',formatRole:'contact',text:'T.'+result.phone});
  add({kind:'divider',variant:profile.dividerVariant});
  groups.filter(g=>g.space==='마무리').forEach(g=>photos(g));
  return completionMediaBlocks({...project,title:result.title||project.title},assets,blocks,createId);
}
export function completionMediaBlocks(project,assets,blocks=project.blocks,createId=()=>crypto.randomUUID()){
  if(project.postType!=='completion')return blocks;
  const oldMap=blocks.find(b=>b.kind==='map'),result=blocks.filter(b=>b.kind!=='map');
  const query=oldMap?.text||[project.original?.name,project.original?.region].filter(Boolean).join(' ');
  const intro=result.findIndex(b=>b.formatRole==='intro');
  if(query&&intro>=0)result.splice(intro+1,0,{id:oldMap?.id||createId(),kind:'map',text:query});
  return postVideoBlocks(project,assets,result,createId);
}
export function postVideoBlocks(project,assets,blocks=project.blocks,createId=()=>crypto.randomUUID()){
  const oldVideo=blocks.find(b=>b.kind==='video'),result=blocks.filter(b=>b.kind!=='video');
  const video=assets.find(a=>a.id===(project.completionVideoId??oldVideo?.assetIds?.[0])&&a.role==='video'&&!a.excluded&&a.status==='ready');
  if(video){const closing=project.postType==='completion'?result.findIndex(b=>b.kind==='photos'&&b.space==='마무리'):-1;result.splice(closing<0?result.length:closing,0,{id:oldVideo?.id||createId(),kind:'video',assetIds:[video.id],text:oldVideo?.assetIds?.[0]===video.id&&oldVideo.text||project.title||video.filename.replace(/\.[^.]+$/,'')});}
  return result;
}
function completionPhotoLayout(project,assets,createId){
  const pointSpaces=completionPointSpaces(project),groups=photoGroups(assets,project.coverAssetId),blocks=project.blocks.filter(b=>b.kind!=='photos'&&(!['point','pointBody'].includes(b.formatRole)||pointSpaces.includes(b.space))),used=new Set(),result=[];
  const photo=g=>({id:createId(),kind:'photos',space:g.space,assetIds:g.assets.map(a=>a.id),...(g.layout?{layout:g.layout}:{})});
  const selected=space=>groups.filter(g=>g.space===space);
  const cover=assets.find(a=>a.id===project.coverAssetId&&!a.excluded);
  result.push(...(cover?[photo({space:'표지',assets:[cover]})]:selected('표지').map(photo)));
  const plans=selected('공사범위').map(photo),before=selected('시공전후').map(photo);let plansAdded=false;
  const addPlans=()=>{if(plansAdded)return;plansAdded=true;result.push(...plans);if(before.length)result.push({id:createId(),kind:'quote',text:'BEFORE & AFTER',variant:'quotation_corner'},...before);};
  for(const [i,block]of blocks.entries()){
    if(block.text==='BEFORE & AFTER'&&block.kind==='quote'){addPlans();continue;}
    if(block.formatRole==='closing'){
      addPlans();for(const space of [...new Set(groups.map(g=>g.space))].filter(s=>COMPLETION_SPACES.includes(s)&&!used.has(s))){const p=completionSpacePhotos(selected(space));used.add(space);result.push({id:createId(),kind:'quote',space,text:space,variant:'quotation_line'},...p.points.map(photo),...p.representative.map(photo),{id:createId(),kind:'text',space,text:''},...p.slides.map(photo));}
    }
    if(block.space&&['quote','heading'].includes(block.kind))addPlans();
    result.push(block);
    if(!COMPLETION_SPACES.includes(block.space))continue;
    const p=completionSpacePhotos(selected(block.space)),following=blocks.slice(i+1).filter(b=>b.space===block.space);
    if(['quote','heading'].includes(block.kind)){used.add(block.space);result.push(...p.points.map(photo));if(!following.some(b=>['point','pointBody'].includes(b.formatRole)))result.push(...p.representative.map(photo));}
    if(['point','pointBody'].includes(block.formatRole)&&!following.some(b=>['point','pointBody'].includes(b.formatRole)))result.push(...p.representative.map(photo));
    if(block.kind==='text'&&!['point','pointBody'].includes(block.formatRole)&&!following.some(b=>b.kind==='text'&&!['point','pointBody'].includes(b.formatRole)))result.push(...p.slides.map(photo));
  }
  addPlans();result.push(...selected('마무리').map(photo));return completionMediaBlocks(project,assets,result,createId);
}
export function missingSpaceDescriptions(project,assets){
  return [...new Set(photoGroups(assets,project.coverAssetId,project.postType==='case'?project.templatePhotoId:'').map(g=>g.space))].filter(s=>postSpaces(project).includes(s)).filter(space=>{
    const start=project.blocks.findIndex(b=>b.space===space&&['heading','quote'].includes(b.kind));
    const end=project.blocks.findIndex((b,i)=>i>start&&(b.kind==='divider'||b.space&&b.space!==space&&['heading','quote'].includes(b.kind)));
    return start<0||!project.blocks.slice(start,end<0?undefined:end).some(b=>b.kind==='text'&&b.space===space&&b.text?.trim());
  });
}
export function draftWarnings(project,assets) {
  const warnings=[];
  if(project.postType==='completion')for(const slot of project.completionTemplates||[]){if(slot.enabled!==false&&slot.templateId&&!assets.some(a=>a.templateSlotId===slot.id&&!a.excluded&&!a.templateIncomplete?.length&&a.templateSignature===completionSignature(slot,assets)))warnings.push(`${slot.name} 변경 내용을 적용하고 사진칸을 채워 주세요.`);}
  if(project.templateWarning)warnings.push(project.templateWarning);
  if(!project.original.name.trim()||(!project.postType||project.postType==='recommendation')&&!project.target.name.trim())warnings.push(project.postType&&project.postType!=='recommendation'?'시공 현장을 입력해 주세요.':'원본 현장과 추천 현장을 입력해 주세요.');
  if((project.postType&&project.postType!=='recommendation'?[project.original]:[project.original,project.target]).some(site=>site.details&&!site.type))warnings.push('조회한 아파트의 실제 평형·타입을 선택해 주세요.');
  if(project.postType==='case'&&!publicationCategory(project))warnings.push('시공사례의 발행 카테고리를 선택해 주세요.');
  if(project.postType==='case'&&project.coverTemplateId){const signature=templateSourceSignature(project,assets);if(['cover',...(project.scopeTemplateId?['scope']:[])].some(kind=>!assets.some(a=>a.templateOutput===kind&&!a.excluded&&a.templateSignature===signature&&a.status==='ready')))warnings.push('현장명·사진·시공내용이 바뀌었습니다. 템플릿 이미지를 다시 만들어 주세요.');}
  if(!project.title.trim()||!bodyText(project).trim())warnings.push('제목과 본문이 필요합니다.');
  if(project.coverAssetId&&!assets.some(a=>a.id===project.coverAssetId&&a.role==='photo'&&!a.excluded))warnings.push('표지로 선택한 사진을 확인하거나 다른 사진을 선택해 주세요.');
  const byId=new Map(assets.map(a=>[a.id,a])); const seen=new Set();
  for(const block of project.blocks.filter(b=>b.kind==='photos')){
    if(!block.assetIds?.length)warnings.push('빈 사진 묶음이 있습니다.');
    for(const id of block.assetIds||[]){const a=byId.get(id);if(!a||a.role!=='photo'||a.excluded)warnings.push('본문에 사용할 수 없는 사진이 있습니다.');if(isPlanCollage(project,block,assets)&&id===project.templatePhotoId)continue;if(seen.has(id))warnings.push('같은 사진이 본문에 중복 배치되어 있습니다.');seen.add(id);}
  }
  const groups=photoGroups(assets,project.coverAssetId,project.postType==='case'?project.templatePhotoId:'');const order=[...new Set([...(project.postType==='case'?['도면']:project.postType==='completion'?[...(!project.coverAssetId?['표지']:[]),'공사범위','시공전후']:[]),...referenceSpaceOrder(formatFor(project)),...postSpaces(project),...(project.postType==='completion'?['마무리']:[])])];const intended=[...(project.coverAssetId?[project.coverAssetId]:[]),...order.flatMap(space=>groups.filter(g=>g.space===space).map(g=>g.assets.map(a=>a.id).join(',')))];
  const actual=project.blocks.filter(b=>b.kind==='photos').map(b=>(b.assetIds||[]).join(','));
  if(JSON.stringify(project.postType==='completion'?intended.flatMap(g=>g.split(',')):intended)!==JSON.stringify(project.postType==='completion'?actual.flatMap(g=>g.split(',')):actual))warnings.push('변경한 사진 순서와 묶음을 원고에 반영해 주세요.');
  warnings.push(...missingSpaceDescriptions(project,assets).map(space=>`${space} 공간 설명을 작성해 주세요.`));
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
  const styles=blockTextStyles(block,format);
  const paragraph=(text,style)=>`<p style="text-align:${style.align};margin:20px 0;${textCss(style)}"><span style="${textCss(style)}">${style.fontWeight>=600?`<b>${text}</b>`:text}</span></p>`;
  if(styles.every(s=>JSON.stringify(s)===JSON.stringify(styles[0])))return paragraph(escapeHtml(block.text).replace(/\n/g,'<br/>'),styles[0]);
  return blockTextLines(block,format).map(({text,style})=>paragraph(escapeHtml(text)||'<br/>',style)).join('');
}
export function exportHtml(project, assets) {
  const byId = new Map(assets.map(a=>[a.id,a]));
  const format=formatFor(project);
  const content=photoUploadBlocks(project.blocks),blocks=content.map((b,i)=>{
    if(b.kind==='map')return `<p style="margin:24px 0">현장 지도: ${escapeHtml(b.text)}</p>`;
    if(b.kind==='video'){const a=byId.get(b.assetIds?.[0]);return a?`<figure><video controls preload="metadata" src="${escapeHtml(a.originalUrl)}" style="width:100%"></video><figcaption>${escapeHtml(b.text)}</figcaption></figure>`:'';}
    const pointGap=project.postType==='completion'&&b.formatRole==='point'&&content[i-1]?.formatRole==='pointBody';
    if(b.kind==='divider'){const variant=b.variant||format.dividerVariant,sprites={line3:'width:238px;height:9px;background-position:-102px -350px',line4:'width:192px;height:23px;background-position:-92px -306px',line6:'width:44px;height:44px;background-position:-422px -46px'};return `<hr data-naver-variant="${variant}" style="margin:36px auto;border:0;${sprites[variant]?`background-image:url(https://editor-static.pstatic.net/v/basic/1.78.1/img/se-sp-viewer.ee5afa38.png);background-size:466px 418px;${sprites[variant]}`:'width:100%;height:1px;background:#ddd'}"/>`;}
    if(b.kind==='photos')return `<div style="display:flex;gap:4px;margin:20px 0;${b.layout==='slide'?'overflow-x:auto;scroll-snap-type:x mandatory':''}">${(b.assetIds||[]).map(id=>{const a=byId.get(id);return a?`<img src="${escapeHtml(a.originalUrl)}" alt="${escapeHtml(a.space)}" style="width:${b.layout==='slide'?100:100/(b.assetIds?.length||1)}%;${b.layout==='slide'?'flex:0 0 100%;scroll-snap-align:start;':''}${isPlanCollage(project,b,assets)?'aspect-ratio:1;object-fit:cover':'object-fit:contain'}"/>`:'';}).join('')}</div>`;
    const paragraph=paragraphHtml(b,format),style=blockTextStyles(b,format)[0];
    if(b.kind==='quote'){const variant=b.variant||format.quoteVariant;return `<blockquote data-naver-variant="${variant}" style="position:relative;max-width:${variant==='quotation_line'?'none':'460px'};text-align:${style.align};border:0;margin:36px auto;padding:${variant==='quotation_underline'?'0 0 18px;border-bottom:1px solid #333':variant==='quotation_line'?'10px 20px;border-left:6px solid #515151':'38px 36px'};${textCss(style)}">${variant==='quotation_corner'?'<span aria-hidden="true" style="position:absolute;top:0;left:0;width:26px;height:26px;border-top:6px solid #4a4a4a;border-left:6px solid #4a4a4a"></span><span aria-hidden="true" style="position:absolute;bottom:0;right:0;width:26px;height:26px;border-bottom:6px solid #4a4a4a;border-right:6px solid #4a4a4a"></span>':''}${paragraph}</blockquote>`;}
    return (pointGap?'<p aria-hidden="true">&nbsp;</p>':'')+paragraph;
  }).join('\n');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"/><title>${escapeHtml(project.title)}</title><body><article style="max-width:860px;margin:auto;color:#222"><h1>${escapeHtml(project.title)}</h1>${blocks}<p>${project.tags.map(t=>`#${escapeHtml(t)}`).join(' ')}</p></article></body></html>`;
}

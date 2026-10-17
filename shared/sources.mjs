import {templateFields} from './template-fields.mjs';
export function sourceSignature(project,assets){
  return JSON.stringify({cafeUrl:project.cafeUrl,sourceText:project.sourceText,files:assets.filter(a=>a.role==='construction'&&!a.excluded).map(a=>({id:a.id,hash:a.hash})).sort((a,b)=>a.id.localeCompare(b.id)),facts:project.facts.map(f=>({id:f.id,space:f.space,item:f.item,sourceAssetId:f.sourceAssetId,uncertain:f.uncertain,confirmed:f.confirmed}))});
}
export function templateSourceSignature(project,assets){
  const photos=assets.filter(a=>a.role==='photo'&&!a.excluded&&!a.templateOutput).sort((a,b)=>a.order-b.order),photo=photos.find(a=>a.id===(project.templatePhotoId||project.coverAssetId))||photos[0];
  const plan=assets.find(a=>a.id===project.original.floorplanAssetId);
  const fields=templateFields(project,assets);
  return JSON.stringify({cafe:[project.cafeUrl,project.sourceText],fields:project.scopeTemplateId?fields:{coverTitle:fields.coverTitle,coverConcept:fields.coverConcept},photo:photo?.id,photoHash:photo?.hash,cover:project.coverTemplateId,scope:project.scopeTemplateId,plan:plan?.hash});
}
export function needsSourceCheck(project,assets){return !!project.sourceText.trim()&&(project.postType==='case'||assets.some(a=>a.role==='construction'&&!a.excluded));}
export function sourceReviewCurrent(project,assets){return !!project.sourceReview&&project.sourceReview.signature===sourceSignature(project,assets);}
export function draftSourceSignature(project,assets){return JSON.stringify({source:sourceSignature(project,assets),decisions:sourceReviewCurrent(project,assets)?project.sourceReview.conflicts.map(c=>({id:c.id,decision:c.decision,text:c.customText})):null,original:[project.original.name,project.original.region,project.original.type,project.original.supplyArea,project.original.exclusiveArea,project.original.floorplanAssetId],target:[project.target.name,project.target.region,project.target.type,project.target.supplyArea,project.target.exclusiveArea,project.target.floorplanAssetId],...(project.coverAssetId?{coverAssetId:project.coverAssetId}:{}),...(project.questionQuote&&project.questionQuote!=='none'?{questions:{position:project.questionQuote,count:project.questionQuoteCount||1}}:{}),manual:project.manualWork,concept:project.concept,comparison:project.comparison?.reviewed?project.comparison:null,photos:assets.filter(a=>a.role==='photo'&&!a.excluded).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id)).map(a=>({id:a.id,hash:a.hash,space:a.space,group:a.group,order:a.order}))});}
export function refreshedPhotoLayoutSignature(project,assets){
  if(!project.draftSourceSignature)return undefined;
  const signature=draftSourceSignature(project,assets);
  try{const previous=JSON.parse(project.draftSourceSignature),current=JSON.parse(signature);if(JSON.stringify({...previous,photos:null})===JSON.stringify({...current,photos:null}))return signature;}catch{}
  return project.draftSourceSignature;
}
export function resolvedSourceEvidence(project,assets){
  const review=sourceReviewCurrent(project,assets)?project.sourceReview:null;
  if(!review)return {facts:project.facts.filter(f=>!f.uncertain||f.confirmed),cafeText:project.sourceText,pending:[],reviewed:false};
  const fileIds=new Set(review.conflicts.flatMap(c=>c.constructionFactIds)),cafeIds=new Set(review.conflicts.flatMap(c=>c.cafeFactIndexes));
  const facts=project.facts.filter(f=>!fileIds.has(f.id)&&(!f.uncertain||f.confirmed));
  review.cafeFacts.filter((f,i)=>!cafeIds.has(i)&&!f.uncertain).forEach(f=>facts.push({...f,sourceLabel:'카페 마감글',source:'cafe'}));
  for(const c of review.conflicts){
    const file=project.facts.filter(f=>c.constructionFactIds.includes(f.id)),cafe=c.cafeFactIndexes.map(i=>review.cafeFacts[i]).filter(Boolean);
    if(c.decision==='construction')facts.push(...file.filter(f=>!f.uncertain||f.confirmed));
    if(c.decision==='cafe')facts.push(...cafe.filter(f=>!f.uncertain).map(f=>({...f,sourceLabel:'카페 마감글',source:'cafe'})));
    if(c.decision==='custom'&&c.customText.trim())facts.push({space:c.space,item:c.customText.trim(),sourceLabel:'사용자가 자료 차이를 확인하고 수정한 내용',source:'user'});
    if(c.decision==='both')facts.push({space:c.space,item:`공사범위 자료에는 ${file.map(f=>f.item).join(' / ')}로 적혀 있고, 카페 마감글에는 ${cafe.map(f=>f.item).join(' / ')}로 적혀 있습니다.`,sourceLabel:'두 자료의 차이를 구분하여 반영',disputed:true});
  }
  const pending=review.conflicts.filter(c=>c.decision==='pending'||c.decision==='custom'&&!c.customText.trim());
  let cafeText=project.sourceText;for(const c of review.conflicts)if(!['cafe','both'].includes(c.decision))for(const i of c.cafeFactIndexes){const quote=review.cafeFacts[i]?.evidence;if(quote)cafeText=cafeText.split(quote).join('[자료 차이 검토에 따라 이 항목은 원문 참고에서 제외됨]');}
  return {facts,cafeText,pending,reviewed:true};
}
export function unresolvedConstructionFacts(project,assets){
  const review=sourceReviewCurrent(project,assets)?project.sourceReview:null;
  const omitted=new Set(review?.conflicts.filter(c=>['pending','exclude','cafe','custom','both'].includes(c.decision)).flatMap(c=>c.constructionFactIds)||[]);
  return project.facts.filter(f=>f.uncertain&&!f.confirmed&&!omitted.has(f.id));
}

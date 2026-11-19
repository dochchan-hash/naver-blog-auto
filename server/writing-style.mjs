import {COMPLETION_SPACES} from '../shared/domain.mjs';

export const COMPLETION_GROUNDING_RULES='[마감 시공 근거 우선 규칙] 이 규칙은 과거 예문·말투 지침보다 우선합니다. 공간 설명의 모든 소재는 해당 공간에서 확인된 실제 시공내역이어야 합니다. 먼저 실제 작업을 언급하고 그 작업으로 생긴 분위기·디자인/생활 효과·변화·제안으로 연결하세요. 사진에서 보기 좋다는 이유만으로 미시공 가구·소품·기존 배치·창·분위기에 별도 설명이나 제안을 붙이지 마세요. 기존 요소를 유지했다는 작업도 확인된 경우에만 설명합니다. 작업 설명 일부가 올바르더라도 근거 없는 다른 대상의 분위기 문장을 끼워 넣지 마세요. 자재선정지는 보조 참고이며 공사범위보다 후순위입니다. 실제 사용 여부·적용 공간이 확인되지 않은 선정 자재는 본문에 쓰지 않습니다. photoOnlySpaces에 지정된 공간은 sections에서 생략하고 사진만 배치합니다. 사진 관찰이나 공통 시공만 있는 공간에 개별 작업을 배정하지 마세요. 공사범위/선정지 미첨부는 오류가 아니며 직접 확인한 공사내용·카페 원문 등 남은 실제 시공 근거만 사용합니다. 단순 사진 관찰을 새 시공으로 바꾸지 마세요. 인사말의 친근한 현장 소개와 콘텐츠 고유 말투·서식은 유지합니다.';

export const COMPLETION_DESCRIPTION_RULES=`[마감 공간 설명 작성 기준]
사용자가 직접 작성한 공간 설명을 최신 문체 기준으로 삼습니다. sections.text는 시공 항목 두세 개와 분위기만 요약하는 짧은 캡션이 아니라 대표 사진 뒤에서 읽는 충분한 공간 종합 설명입니다. 공간의 첫인상·매력으로 시작하고, 실제 작업마다 기존 유지/교체·리폼 방식과 확인된 색·형태·마감을 구체적으로 풀어 그 작업이 만드는 정돈감·조도·수납·생활 효과로 연결합니다. 마지막 한 문장에만 권유를 붙이지 말고 완료형 설명과 ‘만들어 보세요’, ‘연출해 보세요’ 같은 제안을 문맥에 맞게 섞습니다. 분량은 아래 예문의 전개와 현재 공간의 근거량을 참고하며 문장 수나 글자 수로 제한하지 않습니다.
공간 고유 시공뿐 아니라 전체 도배·몰딩·걸레받이·바닥·조명 등 공통 마감도 그 공간에 적용된 근거가 있으면 함께 설명합니다. 공통 본문에 썼다는 이유로 관련 공간에서 모두 생략하지 않습니다. 전체 수량을 방마다 배분하거나 타일 바닥을 강마루로, 타일 벽을 도배 벽으로 바꾸지 않습니다. 사진은 보이는 형태·색·마감 경계의 근거이며 브랜드·공법·새 시공 여부는 공사내역에서 확인합니다. 근거 없는 작업으로 분량을 채우지 않습니다. 포인트 설명과 동일 문장을 복사하지 않고 공간 전체의 완성 흐름으로 종합합니다.
사용자 예문의 전개 참고(대괄호는 현재 현장의 확인된 값으로 바꿉니다):
집에 들어서는 첫 순간부터 정갈하고 화사한 기운을 선사하는 [현장명] 인테리어 현관 공간입니다. 기존 신발장 틀은 유지하면서 깔끔한 화이트 톤 신발장 가구 도어 교체를 진행해 새 가구처럼 매끈한 정면 라인을 완성했답니다. 입구의 방화문 필름 작업과 상부 몰딩 필름 리폼을 거쳐 톤을 정돈하고, 벽면 전체에는 맑은 실크벽지 도배로 깨끗한 바탕을 만들어 보세요. 실내 디딤판을 지나 이어지는 바닥면은 안락한 강마루와 정갈한 걸레받이 마감으로 깔끔하게 연출하고, 천장 매립 조명으로 밝은 조도로 공간을 밝혀주어 미니멀한 매력이 돋보이는 첫인상을 연출해 보세요!
이 예문은 설명 순서·구체성·호흡·말투의 기준입니다. 기존 틀 유지, 화이트, 필름, 실크벽지, 강마루, 걸레받이, 매립 조명도 현재 현장의 근거가 있는 경우만 사용합니다. 모든 공간을 현관처럼 쓰거나 같은 첫 문장을 반복하지 않습니다. 다른 현장명·평수·시공 내역을 복사하지 않으며 키워드·면적 표기 규칙은 유지합니다.`;

const count=text=>String(text||'').replace(/[\s\u200B\uFEFF]/g,'').length;
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const spaceName=text=>String(text||'').split(/\r?\n/).map(t=>t.replace(/[\s\u200B\uFEFF]/g,'').replace(/^\d+[.)]/,'').replace(/(?:인테리어|공간|추천)+$/,'').replace(/^안방(파우더룸|드레스룸)$/,'$1')).find(t=>[...COMPLETION_SPACES,'작은방','욕실'].includes(t));
const alias=space=>/^작은방\d$/.test(space)?'작은방':space==='공용욕실'?'욕실':space;

export function writingReference(style,postType,expectedSpaces=[]){
  const sources=[];
  for(const url of new Set(style.referenceUrls||[])){
    const collections=style.formatCheckedAt>style.analyzedAt?[style.formatEvidence,style.referenceEvidence]:[style.referenceEvidence,style.formatEvidence];
    const evidence=collections.flatMap(c=>c||[]).filter(e=>e.url===url&&(!e.formatProfile?.postType||e.formatProfile.postType===postType));
    const blocks=evidence.find(e=>e.referenceBlocks?.length)?.referenceBlocks||[];
    const text=evidence.find(e=>count(e.text))?.text||blocks.filter(b=>['text','quote','heading'].includes(b.kind)).map(b=>b.text).join('\n');
    if(!count(text))continue;
    const parts={intro:[],outro:[]};let role='intro';
    for(const b of blocks){
      const heading=['quote','heading'].includes(b.kind)||b.kind==='text'&&count(b.text)<30?spaceName(b.text):null;
      if(heading){role=heading;parts[role]||=[];continue;}
      if(b.kind==='divider'&&role!=='intro'){role='outro';continue;}
      if(b.kind!=='text')continue;
      for(const line of String(b.text||'').split(/\r?\n/).filter(t=>count(t))){
        if(/^(?:이상으로|지금까지 소개|함께 살펴봐 주셔서)/.test(line.trim()))role='outro';
        if(/^(?:T[.．]?\s*[\d-]+|\d{3,4}[-–]\d{4}|인테리어의 현명한 선택|©)/i.test(line.trim())||line.trim().toUpperCase()==='INTERIOR PLAN')continue;
        (parts[role]||=[]).push(line);
      }
    }
    sources.push({url,title:evidence.find(e=>e.title)?.title||'',text,characters:count(text),parts:Object.fromEntries(Object.entries(parts).filter(([,lines])=>lines.length).map(([key,lines])=>[key,count(lines.join(''))]))});
  }
  const sizes=sources.flatMap(s=>Object.entries(s.parts).filter(([key])=>!['intro','outro'].includes(key)).map(([,n])=>n));
  const targets={};
  for(const key of ['intro',...expectedSpaces,'outro']){
    const values=sources.map(s=>s.parts[key]||s.parts[alias(key)]).filter(Boolean);
    if(!values.length&&!['intro','outro'].includes(key))values.push(...sizes);
    if(values.length){const typical=median(values);targets[key]={min:Math.min(...values),target:typical,max:Math.max(...values)};}
  }
  const sorted=[...sources].sort((a,b)=>a.characters-b.characters),selected=[sorted[Math.floor(sorted.length/2)],sources.at(-1)].filter((s,i,a)=>s&&a.indexOf(s)===i);
  return {postType,measurements:sources.map(({url,characters,parts})=>({url,characters,parts})),targets,examples:selected.map(({url,title,text})=>({url,title,text}))};
}

export const COMPLETION_SCOPE_RULES='공용부는 거실 등 세대 내부 공용 공간을 포함합니다. 공용부 간접조명 같은 범위 단위 공사는 같은 공간의 사진이나 사용자 확인으로 실제 설치 위치가 확인되면 그 위치까지 연결하세요. 예를 들어 공용부 간접조명이 공사범위에 있고 거실 사진에 우물천장 테두리와 창가 커튼박스에 각각 조명이 보인다면, 두 위치를 별개의 근거 있는 설명으로 인정하세요. 한 위치가 분류됐다는 이유로 다른 위치를 배제하지 마세요. 포인트 제목이나 사진만으로 공사 여부를 확정하지 말고, 공사범위와 실제 사진 또는 직접 확인이 함께 뒷받침하는 항목을 사용하세요. 공용부라는 말만으로 사진이나 직접 근거가 없는 다른 공간에 시공을 배정하지 마세요.';

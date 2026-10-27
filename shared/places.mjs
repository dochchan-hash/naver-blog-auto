export const addressKey=value=>String(value||'').replace(/(서울|부산|대구|인천|광주|대전|울산|세종)(?:특별자치|특별|광역)?시/g,'$1').replace(/경기도/g,'경기').replace(/충청북도/g,'충북').replace(/충청남도/g,'충남').replace(/전라북도|전북특별자치도/g,'전북').replace(/전라남도/g,'전남').replace(/경상북도/g,'경북').replace(/경상남도/g,'경남').replace(/강원특별자치도|강원도/g,'강원').replace(/제주특별자치도|제주도/g,'제주').replace(/[\s,.·()]/g,'').toLowerCase();
export const placeName=value=>addressKey(String(value||'').replace(/^(?:\S+(?:동|읍|면|리)\s+)+/,'').replace(/아파트|\bapt\b/gi,''));
export function nameDistance(a,b){
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+Number(a[i-1]!==b[j-1]));row=next;}
  return row[b.length];
}
export function relatedPlace(a,b){
  a=placeName(a);b=placeName(b);if(Math.min(a.length,b.length)<2)return a===b&&!!a;
  const numbers=s=>s.match(/\d+/g)?.join(',');if(numbers(a)&&numbers(b)&&numbers(a)!==numbers(b))return false;
  if(a.includes(b)||b.includes(a))return true;
  const [short,long]=a.length<=b.length?[a,b]:[b,a];
  return short.length>=4&&Array.from({length:long.length-short.length+1},(_,i)=>long.slice(i,i+short.length)).some(part=>nameDistance(short,part)<=Math.max(1,Math.floor(short.length*.2)));
}
export function nameQueries(name){
  const clean=String(name||'').replace(/\s*(?:아파트|apt)$/i,'').replace(/\s+/g,' ').trim(),core=placeName(clean);
  return [...new Set([clean,core,...(core.length>2?[core.slice(0,-1),core.slice(0,Math.max(2,core.length-2)),core.slice(0,Math.max(2,Math.floor(core.length/2)))]:[])].filter(Boolean))];
}
export function mapTarget(query,site={}){
  if(typeof site==='string')site={name:site};
  const words=query.trim().split(/\s+/),start=words.findIndex(w=>/^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종)(?:(?:특별자치|특별|광역)?시)?|경기도?|강원(?:특별자치도|도)?|충청[남북]도|전라[남북]도|경상[남북]도|충[남북]|전[남북]|경[남북]|제주(?:특별자치도|도)?)$/.test(w));
  const name=start>0?words.slice(0,start).join(' '):query.trim(),known=relatedPlace(name,site.name);
  return {name:known?(site.details?.name||site.name):name,address:start>0?words.slice(start).join(' '):known?site.region||'':'',aliases:known?[name,site.name]:[]};
}
export function mapQueries(target){
  const names=[...new Set([target.name,...target.aliases||[]].flatMap(n=>[nameQueries(n)[0],placeName(n)]))];
  return [...new Set([...names,target.address,...nameQueries(target.name).slice(2)].filter(Boolean))];
}
export function chooseMapPlace(target,list){
  const names=[target.name,...target.aliases||[]],tokens=target.address?.trim().split(/\s+/).map(addressKey).filter(Boolean)||[];
  const candidates=list.filter(p=>!/(관리사무소|복지관|중개|부동산|경로당|어린이집|유치원|주차장|상가|입구|후문|정문|놀이터)/.test(p.name)&&names.some(n=>relatedPlace(n,p.name))&&tokens.every(t=>/^\d+(?:-\d+)?$/.test(t)?new RegExp('(?:^|\\D)'+t+'(?!\\d)').test(addressKey(p.address||p.text)):addressKey(p.address||p.text).includes(t)));
  const exact=candidates.filter(p=>names.some(n=>placeName(n)===placeName(p.name)));
  return exact.length===1?exact[0]:candidates.length===1?candidates[0]:null;
}
// BrowserBridge와 Playwright가 같은 실제 지도 결과 행을 읽는다.
export function readMapPlaces(){
  const input=document.querySelector('input[placeholder="장소명을 입력하세요."],.se-popup-placesMap input.react-autosuggest__input');
  if(!input)return {list:[],empty:false};
  const root=input.closest('.se-popup-placesMap')||document;
  const rows=[...root.querySelectorAll('li.se-place-map-search-result-item')];
  const elements=rows.length?rows:[...root.querySelectorAll('a')].filter(a=>a.closest('[class*="place"],[class*="map"]'));
  const list=elements.filter(e=>e.getBoundingClientRect().width&&e.textContent.trim()).map((e,index)=>{
    e.dataset.lemonPlaceIndex=String(index);
    return {index,name:(e.querySelector('.se-place-map-search-result-title,strong,[class*="name"]')?.textContent||'').trim(),address:(e.querySelector('.se-place-map-search-result-address,[class*="address"]')?.textContent||'').trim(),text:e.textContent.trim()};
  }).filter(p=>p.name);
  return {list,empty:/검색 결과가 없습니다/.test(root.innerText||'')};
}

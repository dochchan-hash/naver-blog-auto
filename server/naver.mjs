import {createHash,randomUUID} from 'node:crypto';
import {validateNaverUrl,draftWarnings,publicationCategory,paragraphHtml,missingSpaceDescriptions,isPlanCollage} from '../shared/domain.mjs';
import {checkCancelled,jobSignal} from './jobs.mjs';
import {readPublicationSettings} from '../shared/naver-controls.mjs';
import {photoUploadBlocks} from '../shared/photo-layout.mjs';
import {readReferenceFormat,formatFor,editorFormatMatches,editorFormatIssue,blockTextStyles,blockTextLines} from '../shared/format.mjs';
const fail=(message,status=422)=>Object.assign(new Error(message),{status});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const complexName=t=>t.replace(/\s*(?:아파트|apt)$/i,'').replace(/\s/g,'').toLowerCase();
function nameDistance(a,b){
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+Number(a[i-1]!==b[j-1]));row=next;}
  return row[b.length];
}
const cleanTags=tags=>[...new Set(tags.map(t=>t.replace(/^#/,'').replace(/\s/g,'')).filter(Boolean))];
const checkedVideoTags=tags=>{const wanted=cleanTags(tags);if(wanted.length>10||wanted.some(t=>t.length>20))throw fail('동영상 태그를 게시글과 동일하게 넣으려면 태그를 최대 10개·하나당 20자로 입력해 주세요.',400);return wanted;};
const kstMinute=iso=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)).replaceAll('-','.');
export function postIdentity(url,blogId){try{const u=new URL(url);if(u.origin!=='https://blog.naver.com')return '';const parts=u.pathname.split('/');if(parts[1]===blogId&&/^\d+$/.test(parts[2]||''))return parts[2];return u.searchParams.get('blogId')===blogId&&/^\d+$/.test(u.searchParams.get('logNo')||'')?u.searchParams.get('logNo'):'';}catch{return '';}}
export function editorMatches(project,state){const normalize=t=>(t||'').replace(/[\s\u200B\uFEFF]/g,'');return state.title===project.title&&JSON.stringify(state.photoBlocks)===JSON.stringify(photoUploadBlocks(project.blocks).filter(b=>b.kind==='photos').map(b=>b.assetIds.length))&&project.blocks.filter(b=>['text','heading','quote'].includes(b.kind)).every(b=>normalize(state.text).includes(normalize(b.text)));}
export function selectMapPlace(query){
  if(!document.querySelector('input[placeholder="장소명을 입력하세요."]'))return null;
  const normal=s=>s.replace(/경기도/g,'경기').replace(/(서울|부산|대구|인천|광주|대전|울산)(?:특별|광역)시/g,'$1').replace(/[\s,.·()]/g,'').toLowerCase(),q=normal(query),tokens=query.split(/\s+/).filter(Boolean);
  const links=[...document.querySelectorAll('a')].filter(a=>a.getBoundingClientRect().width&&a.textContent.trim()&&a.closest('[class*="place"],[class*="map"]'));
  const candidates=links.map(a=>({a,name:a.querySelector('strong')?.textContent?.trim()||a.querySelector('[class*="name"]')?.textContent?.trim()||'',text:a.textContent.trim()})).filter(v=>v.name&&tokens.every(t=>normal(v.text).includes(normal(t))));
  const exact=candidates.filter(v=>normal(v.name)===q||tokens.some(t=>normal(t)===normal(v.name)));
  const match=exact.length===1?exact[0]:candidates.length===1?candidates[0]:null;
  if(!match)return null;match.a.dataset.lemonPlace='true';return {name:match.name,text:match.text};
}
export class Naver {
  constructor(store,assets,bridge){Object.assign(this,{store,assets,bridge});this.searches=new Map();}
  requireBridge(){if(!this.bridge)throw fail('네이버 작업은 데스크톱 실행 프로그램에서 사용할 수 있습니다.',503);return this.bridge;}
  exclusive(fn){return this.requireBridge().exclusive(fn,{signal:jobSignal()});}
  rememberBlog(status){
    const settings=this.store.get('settings','main');
    if(!settings.blogId&&status.connected&&status.canWrite&&/^[a-zA-Z0-9_-]{2,40}$/.test(status.blogId||''))this.store.put('settings','main',{...settings,blogId:status.blogId});
    return status;
  }
  async status(){if(!this.bridge)return {available:false,connected:false,verified:false};const blogId=this.store.get('settings','main').blogId;const status=await this.bridge.status(blogId);this.cachedStatus={...status,verified:status.verified||this.store.list('publish').some(p=>p.blogId===blogId&&p.status==='completed'&&p.verified)};return this.rememberBlog(this.cachedStatus);}
  async checkConnection(){const bridge=this.requireBridge();return this.exclusive(async()=>{const id=this.store.get('settings','main').blogId;await bridge.open(id?`https://blog.naver.com/${id}`:'https://blog.naver.com/MyBlog.naver',{visible:false});let status;const start=Date.now();do{await pause(500);status=await bridge.status(id,{verify:true});if(status.connected&&status.canWrite&&status.blogId)break;}while(Date.now()-start<6000);if(!status.connected)bridge.reveal();this.cachedStatus=status;return this.rememberBlog(status);});}
  async changeAccount(){const result=await this.requireBridge().changeAccount();this.store.put('settings','main',{...this.store.get('settings','main'),blogId:''});this.cachedStatus=result;return result;}
  login(blogId=''){if(blogId&&!/^[a-zA-Z0-9_-]{2,40}$/.test(blogId))throw fail('블로그 아이디를 확인해 주세요.',400);const bridge=this.requireBridge();if(bridge.window&&!bridge.window.isDestroyed()){bridge.reveal();return bridge;}return bridge.open(blogId?`https://blog.naver.com/${blogId}`:'https://blog.naver.com/MyBlog.naver');}
  async readPost(url){
    validateNaverUrl(url);return this.exclusive(()=>this.readPostPage(url));
  }
  async readPosts(urls,onRead=()=>{}){
    urls.forEach(url=>validateNaverUrl(url));
    return this.exclusive(async()=>{const sources=[];for(let i=0;i<urls.length;i++){checkCancelled();onRead(i);sources.push(await this.readPostPage(urls[i]));}return sources;});
  }
  async readPostPage(url){
      const bridge=this.requireBridge();
      await bridge.goto(url);
      const isCafe=url.includes('cafe.naver.com'),selectors=isCafe?'.se-main-container, .ContentRenderer, #article-area':'.se-main-container';
      const parsed=new URL(url),postId=parsed.pathname.match(/\/(\d+)\/?$/)?.[1]||parsed.searchParams.get(isCafe?'articleid':'logNo')||'';
      await bridge.waitFor(selectors,18000,{urlContains:postId});
      let result,previous='',stable=0;
      const until=Date.now()+8000;
      do{checkCancelled();result=await bridge.evaluate(()=>{
        const root=document.querySelector('.se-main-container,.ContentRenderer,#article-area');
        const text=root?.innerText||'';
        const photoGroups=[...root?.querySelectorAll('.se-imageGroup,.se-image')||[]].filter(el=>!el.parentElement?.closest('.se-imageGroup')).map(el=>({count:el.querySelectorAll('img').length,layout:el.className,ratios:[...el.querySelectorAll('img')].map(img=>{const r=img.getBoundingClientRect();return r.height?r.width/r.height:0;})}));
        const imageUrls=el=>[...new Set([...el?.querySelectorAll('img')||[]].map(img=>img.getAttribute('data-original')||img.getAttribute('data-src')||img.currentSrc||img.src).filter(Boolean).map(src=>{try{return new URL(src,document.baseURI).href;}catch{return '';}}).filter(src=>/^https:\/\/[^/]+\.pstatic\.net\//.test(src)))];
        const images=imageUrls(root),components=[...root?.querySelectorAll('.se-component')||[]].filter(c=>!c.parentElement?.closest('.se-component'));
        // 지도 타일과 인용구 종류에 영향받지 않도록 대표사진 다음 사진을 읽습니다.
        const scopePhoto=components.filter(c=>c.matches('.se-image,.se-imageGroup'))[1];
        const scopeImages=imageUrls(scopePhoto).slice(0,1);
        return {title:document.title,text,photoGroups,images,scopeImages};
      },null,{selector:selectors,urlContains:postId,readOnly:true});
        const signature=JSON.stringify([result.text,isCafe&&result.scopeImages?.length?result.scopeImages:result.images]);stable=signature===previous?stable+1:0;previous=signature;
        if(stable>=3)break;await pause(300);
      }while(Date.now()<until);
      if(!result.text.trim())throw fail('게시글 본문을 읽지 못했습니다. 로그인 권한을 확인하거나 본문을 직접 입력해 주세요.');
      const reference=postId?await bridge.evaluate(readReferenceFormat,{withEvidence:true,postType:isCafe?'completion':undefined},{selector:selectors,urlContains:postId,readOnly:true}):null;
      return {...result,url,formatProfile:reference?.formatProfile||null,referenceBlocks:reference?.blocks||[]};
  }
  async searchComplex(query){
    this.requireBridge();if(!query.trim())throw fail('아파트명을 입력해 주세요.',400);
    return this.exclusive(()=>this.searchCandidates(query));
  }
  async searchCandidates(query){
      const bridge=this.requireBridge(),keyword=query.trim().replace(/\s*(?:아파트|apt)$/i,'').replace(/\s+/g,' ').trim();
      if(!keyword)throw fail('아파트명을 입력해 주세요.',400);
      if(keyword.length>100)throw fail('아파트명은 100자 이내로 입력해 주세요.',400);
      await bridge.goto('https://fin.land.naver.com/home');
      await bridge.click('button',{text:'단지, 주소, 지하철, 초등학교 검색'});
      const selector='#header-search';
      await bridge.waitFor(selector);let state,search=keyword;
      for(let attempt=0;attempt<3;attempt++){
      await bridge.text(selector,search);const started=Date.now(),until=started+12000;
      do{checkCancelled();state=await bridge.evaluate(keyword=>{
        const normalize=t=>t.replace(/\s+/g,' ').trim();
        const compact=t=>normalize(t).replace(/\s/g,'').toLowerCase(),input=document.querySelector('#header-search'),root=input?.parentElement?.parentElement;
        const list=input?.value===keyword?[...root?.querySelectorAll('button')||[]].filter(b=>b.getBoundingClientRect().width>0).map(b=>({name:normalize(b.innerText),complexName:normalize(b.querySelector('[class*="SearchResultList"][class*="__name"]')?.textContent||''),address:normalize(b.querySelector('[class*="SearchResultList"][class*="__address"]')?.textContent||'')})).filter(x=>x.complexName&&x.address&&/^(?:아파트|재건축|오피스텔|주상복합|연립|빌라|도시형생활주택)\s/.test(x.name)&&compact(x.name).includes(compact(keyword))):[];
        return {list,empty:input?.value===keyword&&/검색 결과가 없습니다/.test(root?.innerText||'')};
      },search,{selector,readOnly:true});if(state.list.length||state.empty&&Date.now()-started>=2000)break;await pause(250);}while(Date.now()<until);
      const next=attempt===0?complexName(keyword).slice(0,-1):complexName(keyword).slice(0,2);
      if(state.list.length||!state.empty||complexName(keyword).length<=2||next===search)break;
      search=next;
      }
      const list=state.list;
      list.sort((a,b)=>nameDistance(complexName(keyword),complexName(a.complexName))-nameDistance(complexName(keyword),complexName(b.complexName)));
      const seen=new Set();const unique=list.filter(x=>{if(seen.has(x.name))return false;seen.add(x.name);return true;}).map(x=>{const key=randomUUID();this.searches.set(key,{query:search,label:x.name,complexName:x.complexName});return {...x,key,label:x.name,suggested:complexName(x.complexName)!==complexName(keyword)};});
      if(!unique.length)throw fail(state.empty?`‘${query}’에 해당하는 단지를 네이버에서 찾지 못했습니다. 아파트명과 차수를 확인해 주세요.`:'네이버 단지 검색 결과가 준비되지 않았습니다. 잠시 후 다시 조회해 주세요.');
      return unique;
  }
  async selectComplex(key){
    const choice=this.searches.get(key);if(!choice)throw fail('검색 결과가 만료되었습니다. 단지를 다시 검색해 주세요.',400);
    const bridge=this.requireBridge();return this.exclusive(async()=>{
      await this.searchCandidates(choice.query);
      const clicked=await bridge.evaluate(label=>{const root=document.querySelector('#header-search')?.parentElement?.parentElement;const b=[...root?.querySelectorAll('button')||[]].find(b=>b.getBoundingClientRect().width>0&&b.innerText.replace(/\s+/g,' ').trim()===label);if(!b)return false;b.click();return true;},choice.label,{selector:'#header-search'});
      if(!clicked)throw fail('검색 결과가 바뀌었습니다. 단지를 다시 선택해 주세요.');
      const until=Date.now()+12000;let url;
      do{checkCancelled();url=await bridge.evaluate(name=>{const root=document.querySelector('main,[role="main"],#content')||document.body;return [...root.querySelectorAll('a[href*="/complexes/"]')].find(a=>a.getBoundingClientRect().width>0&&a.textContent.replace(/\s/g,'')===name.replace(/\s/g,''))?.href;},choice.complexName,{readOnly:true});if(url)break;await pause(250);}while(Date.now()<until);
      if(!url)throw fail('단지 상세 주소를 확인하지 못했습니다. 네이버 창에서 상세 링크를 복사해 입력해 주세요.');
      return this.complexDetails(url);
    });
  }
  async readComplex(url,type=''){return this.exclusive(()=>this.complexDetails(url,type));}
  async editorFormatting(){
    return this.requireBridge().evaluate(()=>({
      paragraphs:[...document.querySelectorAll('.se-component.se-text .se-text-paragraph,.se-component.se-quotation .se-text-paragraph')].map(p=>{
        const nodes=[...p.querySelectorAll('.__se-node')].filter(s=>s.textContent.replace(/[\u200B\uFEFF\s]/g,''));
        return {text:p.textContent,blank:!!p.closest('.se-component.se-text')&&!nodes.length,align:getComputedStyle(p).textAlign,spans:nodes.map(s=>{const cs=getComputedStyle(s.querySelector('b,strong')||s);return {text:s.textContent,fontSize:cs.fontSize,fontWeight:cs.fontWeight,backgroundColor:getComputedStyle(s).backgroundColor,color:cs.color,fontFamily:cs.fontFamily};})};
      }),
      components:[...document.querySelectorAll('.se-component')].map(c=>{
        const section=c.querySelector('.se-section-horizontalLine'),line=section?.querySelector('hr')?.getBoundingClientRect(),content=c.querySelector('.se-component-content')?.getBoundingClientRect();
        return {class:c.className,text:[...c.querySelectorAll('.se-text-paragraph .__se-node')].map(e=>e.textContent).join('\n'),photoCount:c.querySelectorAll('img').length,...(section?{align:section.className.match(/se-section-align-(left|center|right)/)?.[1]||getComputedStyle(section).textAlign,centered:!!line&&!!content&&Math.abs(line.left+line.width/2-content.left-content.width/2)<2}:{})};
      })
    }),null,{selector:'.se-component'});
  }
  async pasteParagraphs(block,project){
    const bridge=this.requireBridge(),format=formatFor(project),styles=blockTextStyles(block,format),first=styles[0];
    const paragraphs=styles.every(s=>s.fontFamily===first.fontFamily&&s.align===first.align)?[{text:block.text,html:paragraphHtml(block,format),style:first}]:blockTextLines(block,format).map(({text,style})=>({text,style,html:paragraphHtml({kind:'text',text},{body:style})}));
    for(const [i,p]of paragraphs.entries()){
      checkCancelled();
      if(i){await bridge.key('End');await bridge.key('Return');}
      if(!p.text)continue;
      if(block.kind!=='quote'){
        await bridge.click('button[title="서체 변경"],button[aria-label="서체 변경"],button[data-name="font-family"]:not([data-role="option"])');
        await bridge.click(`button[data-role="option"][data-value="${p.style.fontFamily}"]`);
        await bridge.click('button[data-name="align-drop-down-with-justify"]:not([data-role="option"])');
        await bridge.click(`button[data-name="align-drop-down-with-justify"][data-role="option"][data-value="${p.style.align}"]`);
      }
      await bridge.pasteHtml(p.html);
    }
  }
  async insertStructure(block,project){
    const bridge=this.requireBridge(),format=formatFor(project),quote=block.kind==='quote',name=quote?'quotation':'horizontal-line',variant=block.variant||(quote?format.quoteVariant:format.dividerVariant);
    const component=quote?'.se-component.se-quotation':'.se-component.se-horizontalLine';
    const before=await bridge.evaluate(selector=>document.querySelectorAll(selector).length,component,{selector:'.se-component'});
    await bridge.click(`button[data-name="${name}"].se-document-toolbar-select-option-button`);
    await bridge.click(`button[data-name="${name}"][data-role="option"][data-value="${variant}"]`);
    await bridge.waitFor(`${component}.se-l-${variant}`);
    if(typeof before==='number'){
      const until=Date.now()+10000;let added=false;
      do{checkCancelled();added=await bridge.evaluate(({component,before,variant})=>{const nodes=[...document.querySelectorAll(component)];return nodes.length>before&&nodes.at(-1).classList.contains('se-l-'+variant);},{component,before,variant},{selector:'.se-component'});if(added)break;await pause(100);}while(Date.now()<until);
      if(!added)throw fail('새 인용구·구분선 생성이 완료되지 않았습니다. 현재 입력한 원고는 편집기에 보존했습니다.');
    }
    if(!quote){
      await bridge.evaluate(()=>{document.querySelectorAll('[data-lemon-divider]').forEach(e=>delete e.dataset.lemonDivider);[...document.querySelectorAll('.se-component.se-horizontalLine')].at(-1).dataset.lemonDivider='true';},null,{selector:'.se-component'});
      if(bridge.clickNative)await bridge.clickNative('[data-lemon-divider="true"] .se-component-content');
      await bridge.click('button[data-name="align"][data-value="center"]');
    }else{
      await bridge.evaluate(()=>{document.querySelectorAll('[data-lemon-quote],[data-lemon-cite]').forEach(e=>{delete e.dataset.lemonQuote;delete e.dataset.lemonCite;});const c=[...document.querySelectorAll('.se-component.se-quotation')].at(-1);const p=[...c.querySelectorAll('.se-quote .se-text-paragraph')].at(-1);p.dataset.lemonQuote='true';},null,{selector:'.se-component'});
      await bridge.focusText('[data-lemon-quote="true"]',{last:false});await bridge.key('End');
      const [main,...caption]=block.space&&variant==='quotation_underline'?(block.text||'').split('\n'):[block.text];
      if(caption.length){
        const styles=blockTextStyles(block,format);await bridge.pasteHtml(paragraphHtml({kind:'text',text:main},{body:styles[0]}));
        await bridge.evaluate(()=>{const c=document.querySelector('[data-lemon-quote="true"]').closest('.se-component');const p=c.querySelector('.se-cite .se-text-paragraph');if(!p)throw new Error('공간 제목의 한글 입력란을 찾지 못했습니다.');p.dataset.lemonCite='true';},null,{selector:'.se-component'});
        await bridge.focusText('[data-lemon-cite="true"]',{last:false});
        await bridge.pasteHtml(paragraphHtml({kind:'text',text:caption.join('\n')},{body:styles[1]||styles[0]}));
      }else await this.pasteParagraphs(block,project);
      if(typeof before==='number'){
        const until=Date.now()+5000;let written=false;do{written=await bridge.evaluate(text=>{const c=document.querySelector('[data-lemon-quote="true"]')?.closest('.se-component');const normal=s=>s.replace(/[\s\u200B\uFEFF]/g,'');return !!c&&normal([...c.querySelectorAll('.se-quote .__se-node,.se-cite .__se-node')].map(e=>e.textContent).join('')).includes(normal(text));},block.text,{selector:'.se-component'});if(written)break;await pause(100);}while(Date.now()<until);
        if(!written)throw fail(`인용구 '${block.text}'의 입력을 확인하지 못했습니다. 현재 원고는 편집기에 보존했습니다.`);
      }
    }
  }
  async complexDetails(url,type=''){
    const parsed=new URL(validateNaverUrl(url));if(!['fin.land.naver.com','new.land.naver.com'].includes(parsed.hostname)||!parsed.pathname.startsWith('/complexes/'))throw fail('네이버 부동산 단지 상세 링크를 입력해 주세요.',400);
    const bridge=this.requireBridge();
      if(parsed.hostname==='fin.land.naver.com')parsed.searchParams.set('tab','complex-info');
      await bridge.goto(parsed.href);await bridge.waitFor('button',18000,{urlContains:parsed.hostname});
      const started=Date.now();let ready=false;
      while(Date.now()-started<12000){await bridge.click('[role="tab"]',{text:'단지정보',optional:true});ready=await bridge.evaluate(()=>Boolean(document.querySelector('img[alt*="평면"],input[type="radio"],[role="radio"]'))&&/공급면적/.test((document.querySelector('main,[role="main"],#content,#container')||document.body).innerText));if(ready)break;await pause(250);}
      if(!ready)throw fail('단지정보 화면을 찾지 못했습니다. 네이버 상세 링크를 확인하거나 도면을 직접 첨부해 주세요.');
      await bridge.waitFor('img[alt*="평면"],input[type="radio"],[role="radio"]');
      const readDetails=()=>bridge.evaluate(()=>{
        const root=document.querySelector('main,[role="main"],#content,#container')||document.body;
        const headings=[...root.querySelectorAll('h2,h3')].map(e=>e.innerText.trim()).filter(Boolean);
        const images=[...root.querySelectorAll('img')].filter(img=>/평면|평형|floor|plan/i.test(img.alt+' '+img.src)).map(img=>({label:img.alt||'도면',url:img.src||img.currentSrc}));
        const types=[...root.querySelectorAll('label,[role="radio"],option')].map(e=>e.innerText.trim()).filter(t=>/^\d+(?:\.\d+)?[A-Z]?\s*(?:㎡|평)$/.test(t));
        const text=root.innerText;const supply=text.match(/공급면적\s*([\d.]+)([A-Z]?)㎡/),exclusive=text.match(/전용면적\s*([\d.]+)([A-Z]?)㎡/);
        const selected=[...root.querySelectorAll('label,[role="radio"]')].find(e=>{const control=e.control||document.getElementById(e.htmlFor)||e.querySelector('input');return control?.checked||e.getAttribute('aria-checked')==='true';});
        return {name:headings[0]||document.title,text,images,types:[...new Set(types)],supplyArea:supply?.[1]||'',exclusiveArea:exclusive?.[1]||'',selectedType:selected?.textContent.replace(/\s/g,'')||(supply?`${supply[1]}${supply[2]}㎡`:'')};
      });
      let data;const baselineStarted=Date.now();
      do{await pause(250);data=await readDetails();if(data.images.length&&data.supplyArea&&data.exclusiveArea)break;}while(Date.now()-baselineStarted<10000);
      const previousImages=JSON.stringify(data.images.map(img=>img.url));
      const changedType=!!type&&data.selectedType.replace(/\s/g,'')!==type.replace(/\s/g,'');
      if(type){const picked=await bridge.evaluate(type=>{const radios=[...document.querySelectorAll('label,[role="radio"]')];const el=radios.find(e=>e.textContent.replace(/\s/g,'')===type.replace(/\s/g,''));if(!el)return false;el.click();return true;},type);if(!picked)throw fail('선택한 평형·타입을 찾지 못했습니다. 네이버 화면을 확인해 주세요.');}
      const readStarted=Date.now();let imagesUpdated=!changedType;
      do{await pause(250);data=await readDetails();imagesUpdated=!changedType||JSON.stringify(data.images.map(img=>img.url))!==previousImages;
      if(data.images.length&&imagesUpdated&&data.supplyArea&&data.exclusiveArea&&(!type||data.selectedType.replace(/\s/g,'')===type.replace(/\s/g,'')&&Number(data.supplyArea)===parseFloat(type)))break;
      }while(Date.now()-readStarted<10000);
      if(!data.supplyArea||!data.exclusiveArea||type&&data.selectedType.replace(/\s/g,'')!==type.replace(/\s/g,'')||type&&Number(data.supplyArea)!==parseFloat(type))throw fail('선택한 타입의 면적 정보를 확인하지 못했습니다. 다른 타입의 도면은 연결하지 않았습니다. 다시 조회해 주세요.');
      if(!imagesUpdated)data.images=[];
      const firstLine=data.text.split('\n').find(line=>/(?:시|군|구)\s.*(?:동|읍|면|로|길)/.test(line));
      return {...data,region:firstLine||'',url,notice:data.images.length?'평형·타입별로 도면이 다릅니다. 선택한 타입과 면적을 확인해 주세요.':'선택한 타입의 도면을 조회하지 못했습니다. 다시 조회하거나 도면 파일을 직접 첨부해 주세요.'};
  }
  async importFloorplan(projectId,role,imageUrl){
    const u=new URL(imageUrl);const allowed=['landthumb-phinf.pstatic.net','land-phinf.pstatic.net','dbscthumb-phinf.pstatic.net','img.land.naver.com'];
    if(u.protocol!=='https:'||!allowed.includes(u.hostname)||u.username||u.password||u.port)throw fail('지원하는 네이버 도면 이미지 주소를 확인해 주세요.',400);
    u.searchParams.delete('type');
    const response=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)throw fail('도면을 불러오지 못했습니다. 도면 파일을 직접 첨부해 주세요.');
    const bytes=await response.arrayBuffer();if(bytes.byteLength>20*1024*1024)throw fail('도면을 직접 파일로 첨부해 주세요.');
    const {Readable}=await import('node:stream');const boundary=`lemon-${randomUUID()}`;
    const req=Readable.from([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="naver-floorplan.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),Buffer.from(bytes),Buffer.from(`\r\n--${boundary}--\r\n`)]);req.headers={'content-type':`multipart/form-data; boundary=${boundary}`};
    return this.assets.upload(req,projectId,role);
  }
  fingerprint(project,assets,blogId){return createHash('sha256').update(JSON.stringify({blogId,title:project.title,blocks:project.blocks,tags:project.tags,scheduleAt:project.scheduleAt,photos:assets.filter(a=>a.role==='photo'&&!a.excluded).map(a=>a.hash),...(project.visibility==='private'?{visibility:'private'}:{}),...(project.postType==='case'?{postType:'case',category:publicationCategory(project)}:{})})).digest('hex');}
  async setVisibility(visibility){
    const bridge=this.requireBridge(),label=visibility==='private'?'비공개':'전체공개';
    const selected=await bridge.evaluate(text=>{const l=[...document.querySelectorAll('label')].find(e=>e.textContent.replace(/\s/g,'')===text);const r=l&&(l.control||document.getElementById(l.htmlFor)||l.querySelector('input'));if(!r||r.disabled)return false;if(!r.checked)l.click();return true;},label);
    if(!selected)throw fail('네이버 공개 범위 선택란을 찾지 못했습니다.');await pause(100);
    const checked=await bridge.evaluate(text=>{const l=[...document.querySelectorAll('label')].find(e=>e.textContent.replace(/\s/g,'')===text);return !!(l&&(l.control||document.getElementById(l.htmlFor)||l.querySelector('input')))?.checked;},label);
    if(!checked)throw fail('네이버 공개 범위가 요청과 일치하지 않습니다. 최종 발행하지 않았습니다.');
  }
  async setPlanCollage(){
    const imageIndex=await this.requireBridge().evaluate(()=>{const c=[...document.querySelectorAll('.se-component.se-imageGroup')].at(-1);return c?.querySelectorAll('img').length===2?[...document.querySelectorAll('.se-component.se-image img,.se-component.se-imageGroup img')].indexOf(c.querySelector('img')):-1;},null,{selector:'.se-title-text'});
    if(imageIndex<0)throw fail('표지 원본·공사범위 사진 묶음을 찾지 못했습니다.');
    await this.setCoverSquare(imageIndex);
  }
  async setCoverSquare(imageIndex){
    const bridge=this.requireBridge();checkCancelled();bridge.reveal?.();
    const loadingUntil=Date.now()+30000;let loaded=false;do{checkCancelled();loaded=await bridge.evaluate(index=>{const image=[...document.querySelectorAll('.se-component.se-image img,.se-component.se-imageGroup img')][index];return !!image?.complete&&image.naturalWidth>0;},imageIndex,{selector:'.se-title-text'});if(loaded)break;await pause(250);}while(Date.now()<loadingUntil);
    if(!loaded)throw fail('표지 사진이 아직 로딩되지 않았습니다. 네이버 화면에서 사진을 확인해 주세요.');
    const marked=await bridge.evaluate(index=>{document.querySelectorAll('[data-lemon-cover]').forEach(e=>delete e.dataset.lemonCover);const image=[...document.querySelectorAll('.se-component.se-image img,.se-component.se-imageGroup img')][index];const component=image?.closest('.se-component');if(!component)return false;component.dataset.lemonCover='true';const el=image.closest('.se-module-image')||image;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect(),options={bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0};for(const type of ['mousedown','mouseup','click'])el.dispatchEvent(new MouseEvent(type,options));return true;},imageIndex,{selector:'.se-title-text'});
    if(!marked)throw fail('표지 사진을 네이버 편집기에서 찾지 못했습니다.');
    if(bridge.clickNative)await bridge.clickNative('[data-lemon-cover="true"] .se-image-resource');
    // SmartEditor needs its image selection synchronized before crop and representative controls.
    await bridge.evaluate(()=>{const el=document.querySelector('[data-lemon-cover="true"] img');if(!el)return;const r=el.getBoundingClientRect(),options={bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0,buttons:1};el.dispatchEvent(new PointerEvent('pointerdown',options));el.dispatchEvent(new MouseEvent('mousedown',options));el.dispatchEvent(new MouseEvent('mouseup',{...options,buttons:0}));el.click();},null,{selector:'.se-title-text'});
    await pause(300);
    const needsRepresentative=await bridge.evaluate(()=>!!document.querySelector('[data-lemon-cover="true"] button.se-set-rep-image-button:not(.se-is-selected)'),null,{selector:'.se-title-text'});
    if(needsRepresentative)await bridge.click('[data-lemon-cover="true"] button.se-set-rep-image-button');
    const cropClick=selector=>bridge.clickNative?bridge.clickNative(selector):bridge.click(selector);
    await bridge.click('button[data-name="image-edit-right-label"],button[data-name="image-edit"]');await bridge.waitFor('button.npe_btn_crop');
    await pause(2000);checkCancelled();
    const start=Date.now();let ready=false;do{checkCancelled();ready=await bridge.evaluate(()=>!!document.querySelector('.npe_control_crop')?.getBoundingClientRect().width,null,{selector:'button.npe_btn_crop'});if(ready)break;await cropClick('button.npe_btn_crop');await pause(750);}while(Date.now()-start<30000);
    if(!ready)throw fail('사진 비율 조정 메뉴를 열지 못했습니다. 표지 사진은 원본으로 보존했습니다.');
    await pause(2500);checkCancelled();
    await cropClick('button[data-crop="1:1"]');await pause(1500);checkCancelled();
    let selected=await bridge.evaluate(()=>document.querySelector('button[data-crop="1:1"]')?.classList.contains('on'),null,{selector:'button.npe_btn_crop'});
    if(!selected){await cropClick('button[data-crop="1:1"]');await pause(300);selected=await bridge.evaluate(()=>document.querySelector('button[data-crop="1:1"]')?.classList.contains('on'),null,{selector:'button.npe_btn_crop'});}
    if(!selected)throw fail('사진 편집창에서 1:1 비율 선택을 확인하지 못했습니다.');
    await cropClick('.npe_control_crop button.npe_crop_btn.npe_btn_confirm');await pause(500);await cropClick('button.npe_btn_submit');
    const until=Date.now()+45000;let square=false;do{checkCancelled();square=await bridge.evaluate(index=>{const done=document.querySelector('button.npe_btn_submit');if(done?.getBoundingClientRect().width)return false;const image=document.querySelector('[data-lemon-cover="true"] img')||[...document.querySelectorAll('.se-component.se-image img,.se-component.se-imageGroup img')][index];if(!image||!image.complete||!image.naturalWidth)return false;image.closest('.se-component').dataset.lemonCover='true';return Math.abs(image.naturalWidth/image.naturalHeight-1)<.01;},imageIndex,{selector:'.se-title-text'});if(square)break;const editing=await bridge.evaluate(()=>{const button=document.querySelector('button.npe_btn_submit');return !!button&&!button.disabled&&button.getBoundingClientRect().width>0&&!document.querySelector('.npe_control_crop')?.getBoundingClientRect().width;});if(editing)await bridge.click('button.npe_btn_submit');await pause(500);}while(Date.now()<until);
    if(!square)throw fail('표지의 1:1 비율 적용 결과를 확인하지 못했습니다. 최종 발행하지 않았습니다.');
  }
  async verifyPlanCollage(project,assets){
    const blocks=photoUploadBlocks(project.blocks).filter(b=>b.kind==='photos'),index=blocks.findIndex(b=>isPlanCollage(project,b,assets));if(index<0)return;
    const state=await this.requireBridge().evaluate(index=>{const c=[...document.querySelectorAll('.se-component.se-image,.se-component.se-imageGroup')][index],images=[...c?.querySelectorAll('.se-module-image')||[]];return {collage:!!c?.matches('.se-imageGroup.se-l-collage'),ratios:images.map(m=>{const r=m.querySelector('img').getBoundingClientRect();return r.width/r.height;}),representative:images.map(m=>!!m.querySelector('.se-set-rep-image-button.se-is-selected'))};},index,{selector:'.se-title-text'});
    if(!state.collage||state.ratios.length!==2||state.ratios.some(r=>!Number.isFinite(r)||Math.abs(r-1)>.02)||!state.representative[0]||state.representative[1])throw fail('공사범위 콜라주의 1:1 비율·원본 사진 순서·대표사진 지정을 확인하지 못했습니다. 최종 발행하지 않았습니다.');
    return state;
  }
  async setCategory(category='추천 인테리어'){
    if(!category)throw fail('발행 카테고리를 선택해 주세요.',400);
    const bridge=this.requireBridge(),selector='button[aria-label="카테고리 목록 버튼"]';
    const current=await bridge.evaluate(selector=>document.querySelector(selector)?.textContent.trim(),selector,{selector:'.se-title-text'});
    if(current===category)return;
    await bridge.click(selector);
    const start=Date.now();let selected=false;
    do{checkCancelled();selected=await bridge.evaluate(category=>{const el=[...document.querySelectorAll('label')].find(e=>e.getAttribute('for')?.endsWith('_'+category))||[...document.querySelectorAll('[role="option"],button,a,label')].find(e=>e.getBoundingClientRect().width>0&&e.textContent.replace('하위 카테고리','').replace(/\s+/g,' ').trim()===category);if(!el)return false;el.click();return true;},category);if(selected)break;await pause(150);}while(Date.now()-start<4000);
    await pause(100);const chosen=await bridge.evaluate(selector=>document.querySelector(selector)?.textContent.replace('하위 카테고리','').trim(),selector);
    if(!selected||chosen!==category)throw fail(category+' 카테고리를 선택하지 못했습니다. 담당 블로그의 카테고리를 확인해 주세요.');
  }
  async setTags(tags){
    const bridge=this.requireBridge(),wanted=cleanTags(tags);
    const selector='#tag-input,input.tag_input,input[placeholder*="태그"]',cafe=await bridge.evaluate(()=>!!document.querySelector('.tag_inner input.tag_input'));
    if(wanted.length>(cafe?10:30))throw fail(cafe?'카페 태그는 최대 10개입니다.':'네이버 태그는 최대 30개입니다.',400);
    if(cafe&&wanted.some(t=>t.length>20))throw fail('카페 태그는 하나당 최대 20자입니다.',400);
    const exists=tag=>bridge.evaluate(({tag,selector})=>{const input=document.querySelector(selector),root=input?.closest('.tag_inner,[class*="tag_textarea"]')||input?.parentElement?.parentElement;return !!root&&[...root.querySelectorAll('[id^="tag-item-"],.tag_text,span[class*="tag_text"],span[class*="tag_name"]')].some(e=>e.textContent.replace(/^#/,'').replace(/\s/g,'')===tag)&&!input.value;},{tag,selector});
    await pause(400);
    for(const tag of wanted){
      checkCancelled();if(await exists(tag))continue;await bridge.text(selector,tag);
      await bridge.evaluate(selector=>{const el=document.querySelector(selector);el?.focus();for(const type of ['keydown','keypress','keyup'])el?.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,charCode:type==='keypress'?13:0,bubbles:true,cancelable:true}));},selector,{selector});
      if(!await exists(tag)){await bridge.evaluate(selector=>document.querySelector(selector)?.focus(),selector,{selector});await bridge.key('Return');}
      const start=Date.now();while(!await exists(tag)){if(Date.now()-start>2500)throw fail('태그를 등록하지 못했습니다: '+tag+'. 입력란에 글자만 남아 있는지 확인해 주세요.');await pause(100);}
    }
  }
  async verifyPanel(project){
    const state=await this.requireBridge().evaluate(readPublicationSettings,null,{selector:'button[class*="confirm_btn"]'});
    if(state.category!==publicationCategory(project))throw fail('카테고리가 '+publicationCategory(project)+'로 설정되지 않았습니다. 최종 발행하지 않았습니다.');
    if(project.scheduleAt&&(!state.reserved||state.time!==kstMinute(project.scheduleAt)))throw fail('네이버 예약 시각이 프로그램 설정과 일치하지 않습니다. 최종 발행하지 않았습니다.');
    if(!project.scheduleAt&&state.reserved)throw fail('즉시 발행 대신 예약이 선택되어 있습니다. 최종 발행하지 않았습니다.');
    const clean=t=>t.replace(/^#/,'').replace(/\s/g,'');
    if(project.tags.some(t=>state.tagList.length?!state.tagList.map(clean).includes(clean(t)):!state.tags.replace(/\s/g,'').includes(clean(t)))||state.inputTag)throw fail('해시태그 등록을 모두 확인하지 못했습니다. 최종 발행하지 않았습니다.');
    return state;
  }
  async setSchedule(iso){
    const bridge=this.requireBridge();const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(iso));const value=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    if(Number(value.minute)%10!==0)throw fail('네이버 예약 발행은 10분 단위입니다. 예약 시각을 조정해 주세요.',400);
    const selected=await bridge.evaluate(()=>{const el=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='예약');if(!el)return false;el.click();return true;});
    if(!selected)throw fail('네이버 예약 선택란을 찾지 못했습니다.');
    await bridge.waitFor('select[aria-label*="예약"],select');

    const date=await bridge.evaluate(()=>{const el=[...document.querySelectorAll('input')].find(e=>/^\d{4}\.\s*\d{2}\.\s*\d{2}/.test(e.value));if(!el)return '';el.click();return el.value;});
    if(!date)throw fail('예약 날짜 선택란을 찾지 못했습니다.');
    let month=(Number(date.slice(0,4))*12+Number(date.match(/\.\s*(\d{2})/)?.[1]))-1;const target=Number(value.year)*12+Number(value.month)-1;
    if(Math.abs(target-month)>24)throw fail('예약 날짜가 지원 범위를 벗어납니다. 네이버 화면에서 확인해 주세요.');
    while(month!==target){await bridge.click('button',{text:month<target?'다음 달':'이전 달'});month+=month<target?1:-1;await pause(80);}
    const picked=await bridge.evaluate(day=>{const button=[...document.querySelectorAll('table button')].find(b=>b.textContent.trim()===String(Number(day))&&!b.disabled);if(!button)return false;button.click();return true;},value.day);
    if(!picked)throw fail('선택한 예약 날짜를 네이버에서 사용할 수 없습니다.');
    const times=await bridge.evaluate(({hour,minute})=>{
      const selects=[...document.querySelectorAll('select')].filter(e=>e.getBoundingClientRect().width>0);const h=selects.find(e=>/hour_option|예약.*시간/.test(e.className+' '+(e.getAttribute('aria-label')||'')))||selects.find(e=>e.options.length===24);const m=selects.find(e=>/minute_option|예약.*분/.test(e.className+' '+(e.getAttribute('aria-label')||'')))||selects.find(e=>[...e.options].map(o=>o.textContent.trim()).join(',')==='00,10,20,30,40,50');
      for(const [el,text]of [[h,hour],[m,minute]]){const option=el&&[...el.options].find(o=>o.textContent.trim()===text);if(!option)return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(el,option.value);el.dispatchEvent(new Event('change',{bubbles:true}));}return true;
    },value);
    if(!times)throw fail('예약 시각 입력을 완료하지 못했습니다.');
    const checked=await bridge.evaluate(({year,month,day,hour,minute})=>{
      const date=[...document.querySelectorAll('input')].find(e=>/^\d{4}\.\s*\d{2}\.\s*\d{2}/.test(e.value));const expected=`${year}.${month}.${day}`;const chosen=[...document.querySelectorAll('select')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.selectedOptions[0]?.textContent.trim());return date?.value.replace(/\s/g,'').startsWith(expected)&&chosen.includes(hour)&&chosen.includes(minute);
    },value);
    if(!checked)throw fail('예약 날짜와 시각이 요청과 일치하지 않습니다. 네이버 화면에서 확인해 주세요.');
  }
  async confirmSchedule(project,blogId,update=()=>{}){
    const bridge=this.requireBridge();update({message:'네이버 예약 목록에서 등록된 원고와 시각을 확인합니다.',progress:95});
    await bridge.goto(`https://blog.naver.com/${encodeURIComponent(blogId)}/postwrite`);await bridge.waitFor('.se-title-text');
    const account=await bridge.status(blogId,{verify:true});if(!account.connected||!account.canWrite)throw fail('예약 목록을 확인할 담당 계정에 다시 로그인해 주세요.',401);
    await bridge.waitFor('button[class*="reserve_btn"]');await bridge.click('button[class*="reserve_btn"]');await bridge.waitFor('button[class*="article_button"]');
    const matches=await bridge.evaluate(({title,time})=>[...document.querySelectorAll('button[class*="article_button"]')].filter(b=>b.innerText.replace(/\s+/g,' ').trim()===`${title} ${time}`).length,{title:project.title,time:kstMinute(project.scheduleAt)},{selector:'button[class*="article_button"]'});
    if(matches!==1)throw fail('제목과 시각이 일치하는 예약 글을 하나로 확인하지 못했습니다. 기존 요청은 다시 제출하지 않았습니다.');
    await bridge.click('button[class*="article_button"]',{text:project.title});
    let state;const start=Date.now();
    while(Date.now()-start<15000){state=await bridge.evaluate(()=>({url:location.href,title:[...document.querySelectorAll('.se-title-text .__se-node')].map(e=>e.textContent).join('').trim(),text:[...document.querySelectorAll('.se-component.se-text,.se-component.se-quotation')].map(e=>e.innerText).join('\n'),photoBlocks:[...document.querySelectorAll('.se-component.se-image,.se-component.se-imageGroup')].map(g=>g.querySelectorAll('img').length)}),null,{selector:'.se-title-text'});if(editorMatches(project,state))break;await pause(250);}
    if(!editorMatches(project,state))throw fail('예약 글의 본문 또는 사진 배치가 현재 원고와 다릅니다. 등록 완료로 표시하지 않았습니다.');
    await bridge.click('button[class*="publish_btn"]');await bridge.waitFor('button[class*="confirm_btn"]');
    const settings=await bridge.evaluate(()=>{const checked=text=>{const l=[...document.querySelectorAll('label')].find(e=>e.textContent.replace(/\s/g,'')===text);return !!(l&&(l.control||document.getElementById(l.htmlFor)||l.querySelector('input')))?.checked;};const date=[...document.querySelectorAll('input')].find(e=>/^\d{4}\.\s*\d{2}\.\s*\d{2}/.test(e.value))?.value.replace(/\s/g,'');const selects=[...document.querySelectorAll('select')].filter(e=>e.getBoundingClientRect().width>0);const h=selects.find(e=>/예약.*시간/.test((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('title')||'')))||selects.find(e=>e.options.length===24);const m=selects.find(e=>/예약.*분/.test((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('title')||'')))||selects.find(e=>[...e.options].map(o=>o.textContent.trim()).join(',')==='00,10,20,30,40,50');const hour=h?.selectedOptions[0]?.textContent.trim(),minute=m?.selectedOptions[0]?.textContent.trim();return {reserved:checked('예약'),private:checked('비공개'),public:checked('전체공개'),time:date&&hour&&minute?`${date} ${hour}:${minute}`:'',tags:document.querySelector('input[placeholder*="태그"]')?.parentElement?.parentElement?.innerText||''};},null,{selector:'button[class*="confirm_btn"]'});
    if(!settings.reserved)throw fail('예약 글의 발행 시간에서 예약 선택을 확인하지 못했습니다.');
    if(settings.time!==kstMinute(project.scheduleAt))throw fail(`예약 글의 시각이 현재 원고와 다릅니다. 확인된 시각: ${settings.time||'읽기 실패'}`);
    if(!settings[project.visibility==='private'?'private':'public'])throw fail('예약 글의 공개 범위가 현재 원고와 다릅니다.');
    if(!project.tags.every(t=>settings.tags.replace(/\s/g,'').includes(t.replace(/\s/g,''))))throw fail('예약 글의 태그를 모두 확인하지 못했습니다.');
    return {postId:postIdentity(state.url,blogId),verification:'naver-reservation-list-and-editor',scheduleAt:project.scheduleAt,visibility:project.visibility||'public'};
  }
  async verifyPublish(projectId,update=()=>{}){
    const bridge=this.requireBridge(),project=this.store.get('project',projectId),blogId=this.store.get('settings','main').blogId,key=this.fingerprint(project,this.store.assets(projectId),blogId),record=this.store.get('publish',key);
    if(record?.status==='completed'){
      if(!record.scheduled||record.deliveryVerified||Date.now()<Date.parse(project.scheduleAt))return record;
      const postId=record.postId||postIdentity(record.url,blogId);if(!postId)throw fail('예약 글의 게시글 번호를 확인하지 못했습니다. 네이버에서 실제 게시글 주소를 확인해 주세요.');
      return this.exclusive(async()=>{
        update({message:'예약 목록에서 빠지고 실제 게시글로 발행되었는지 확인합니다.',progress:10});
        await bridge.goto(`https://blog.naver.com/${blogId}/postwrite`);await bridge.waitFor('.se-title-text');await bridge.click('.se-popup-button-cancel',{optional:true});
        await bridge.click('button[class*="reserve_btn"]');
        const reserve=await bridge.evaluate(()=>({count:Number(document.querySelector('button[class*="reserve_btn"]')?.textContent.match(/\d+/)?.[0]),titles:[...document.querySelectorAll('button[class*="article_button"]')].map(e=>e.innerText)}),null,{selector:'.se-title-text'});
        if(reserve.count>0){await bridge.waitFor('button[class*="article_button"]');reserve.titles=await bridge.evaluate(()=>[...document.querySelectorAll('button[class*="article_button"]')].map(e=>e.innerText),null,{selector:'.se-title-text'});}
        if(!Number.isFinite(reserve.count)||reserve.titles.length!==reserve.count)throw fail('예약 목록을 완전히 읽지 못했습니다. 실제 발행 완료로 표시하지 않았습니다.');
        if(reserve.titles.some(t=>t.replace(/\s/g,'').includes(project.title.replace(/\s/g,''))))throw fail('아직 네이버 예약 목록에 있는 글입니다. 실제 발행 완료로 표시하지 않았습니다.');
        const url=`https://blog.naver.com/${blogId}/${postId}`;await bridge.goto(url);await bridge.waitFor('.se-main-container',18000,{urlContains:postId});
        const state=await bridge.evaluate(()=>{const root=document.querySelector('.se-main-container'),date=document.querySelector('.se_publishDate');return {title:document.querySelector('.se-title-text')?.innerText.replace(/[\u200B\uFEFF]/g,'').trim()||'',text:root.innerText,photoBlocks:[...root.querySelectorAll('.se-imageGroup,.se-image')].filter(e=>!e.parentElement?.closest('.se-imageGroup')).map(e=>e.querySelectorAll('img').length),header:date?.parentElement?.innerText||'',date:date?.textContent.trim()||'',dateTitle:date?.getAttribute('title')||''};},null,{selector:'.se-main-container',urlContains:postId});
        if(!editorMatches(project,state))throw fail('실제 게시글의 제목·본문·사진 배치가 저장한 원고와 다릅니다.');
        if(!state.header||(project.visibility==='private')!==state.header.includes('비공개'))throw fail('실제 게시글의 공개 범위를 확인하지 못했습니다.');
        const completed={...record,deliveryVerified:true,deliveryCheckedAt:new Date().toISOString(),publicationDate:state.date,publicationDateTitle:state.dateTitle,publicationHeader:state.header,verification:'naver-published-article-and-no-reservation',url};
        this.store.put('publish',key,completed);this.store.updateProject(projectId,{draftStatus:'published'});bridge.reveal?.();return completed;
      });
    }
    if(!record||!['uncertain','submitting'].includes(record.status))throw fail('다시 확인할 발행 요청이 없습니다.',400);
    if(!project.scheduleAt)throw fail('즉시 발행 결과는 네이버 게시글 주소를 확인한 뒤 직접 기록해 주세요.',400);
    return this.exclusive(async()=>{const evidence=await this.confirmSchedule(project,blogId,update);const postId=evidence.postId||record.postId;const completed={...record,...evidence,postId,status:'completed',verified:true,scheduled:true,url:postId?`https://blog.naver.com/${blogId}/${postId}`:`https://blog.naver.com/${blogId}/postwrite`,completedAt:new Date().toISOString()};this.store.put('publish',key,completed);this.store.updateProject(projectId,{draftStatus:'scheduled'});bridge.publishVerified=true;return completed;});
  }
  async prepareCafe(projectId,update){
    const bridge=this.requireBridge(),project=this.store.get('project',projectId),assets=this.store.assets(projectId);
    if(project?.postType!=='completion')throw fail('마감 원고에서 카페 입력을 실행해 주세요.',400);
    if(project.blocks.some(b=>b.kind==='video'))checkedVideoTags(project.tags);
    const templateWarnings=draftWarnings(project,assets).filter(w=>w.includes('변경 내용을 적용하고'));if(templateWarnings.length)throw fail(templateWarnings.join('\n'),400);
    validateNaverUrl(project.cafeTargetUrl,'cafe');if(project.cafeBoardUrl)validateNaverUrl(project.cafeBoardUrl,'cafe');
    if(!project.original.name.trim()||!project.title.trim()||!project.blocks.length)throw fail('시공 현장과 원고를 작성한 뒤 카페에서 확인해 주세요.',400);
    const missing=missingSpaceDescriptions(project,assets);if(missing.length)throw fail(`${missing.join('·')} 공간 설명이 비어 있습니다.`,400);
    return this.exclusive(async()=>{try{
      if(bridge.window&&!bridge.window.isDestroyed()&&await bridge.frame('textarea[placeholder*="제목"],.se-title-text')){
        const occupied=await bridge.evaluate(()=>!!document.querySelector('textarea[placeholder*="제목"]')?.value.trim()||[...document.querySelectorAll('.se-component .__se-node')].some(e=>e.textContent.replace(/[\s\u200B\uFEFF]/g,''))||!!document.querySelector('.se-component.se-image,.se-component.se-imageGroup'),null,{selector:'textarea[placeholder*="제목"],.se-title-text'});
        if(occupied)throw fail('네이버 편집기에 작성 중인 글이 있습니다. 해당 글을 보관하고 새 글을 연 뒤 다시 시도해 주세요.');
      }
      const readCafeId=()=>bridge.evaluate(()=>{
        const id=url=>{try{const u=new URL(url,location.href);return u.hostname==='cafe.naver.com'?(u.pathname.match(/\/cafes\/(\d+)/)?.[1]||u.searchParams.get('search.clubid')||u.searchParams.get('clubid')||''):'';}catch{return '';}};
        return id(location.href)||[...document.querySelectorAll('a[href]')].map(a=>id(a.href)).find(Boolean)||'';
      });
      update({message:'대상 카페와 게시판을 확인합니다.',progress:3});
      await bridge.goto(project.cafeTargetUrl);await bridge.waitFor('a[href*="/cafes/"],a[href*="clubid="]');
      const cafeId=await readCafeId();if(!cafeId)throw fail('대상 카페를 확인하지 못했습니다. 카페 주소를 확인해 주세요.');
      if(project.cafeBoardUrl){await bridge.goto(project.cafeBoardUrl);await bridge.waitFor('a[href*="/cafes/"],a[href*="clubid="]');if(await readCafeId()!==cafeId)throw fail('대상 게시판이 선택한 카페와 다릅니다.',400);}
      const until=Date.now()+12000;let entry=false;
      do{checkCancelled();const state=await bridge.evaluate(()=>{
        const visible=e=>e.getBoundingClientRect().width>0;
        const button=[...document.querySelectorAll('a,button')].find(e=>visible(e)&&/^(?:카페\s*)?글쓰기$/.test(e.textContent.replace(/\s+/g,' ').trim()));
        if(button)button.dataset.lemonCafeWrite='true';
        return {entry:!!button,login:[...document.querySelectorAll('a[href*="nidlogin"]')].some(visible)};
      });
        entry=state.entry;if(entry)break;if(state.login){await bridge.click('a[href*="nidlogin"]');throw fail('카페 글쓰기 권한이 있는 네이버 계정으로 연결 창에서 로그인해 주세요.',401);}await pause(250);
      }while(Date.now()<until);
      if(!entry)throw fail('카페 글쓰기 버튼이 없습니다. 가입 상태와 게시판 쓰기 권한을 확인해 주세요.');
      await bridge.clickNative('[data-lemon-cafe-write="true"]');
      await bridge.waitFor('textarea[placeholder*="제목"]');await bridge.waitFor('.se-component');bridge.reveal?.();
      const readEditor=()=>bridge.evaluate(()=>({url:location.href,title:document.querySelector('textarea[placeholder*="제목"]')?.value.trim()||'',text:[...document.querySelectorAll('.se-component.se-text .__se-node,.se-component.se-quotation .__se-node')].map(e=>e.textContent).join('\n'),photoBlocks:[...document.querySelectorAll('.se-component.se-image,.se-component.se-imageGroup')].map(g=>g.querySelectorAll('img').length)}),null,{selector:'textarea[placeholder*="제목"]'});
      const existing=await readEditor();if(!existing.url.includes(`/cafes/${cafeId}/`)||!/(?:articles\/write|ArticleWrite)/i.test(existing.url))throw fail('선택한 카페의 새 글쓰기 화면을 확인하지 못했습니다.');
      if(existing.title||existing.text.replace(/[\s\u200B\uFEFF]/g,'')||existing.photoBlocks.length)throw fail('카페 편집기에 작성 중인 글이 있습니다. 기존 원고는 보존했습니다.');
      await bridge.text('textarea[placeholder*="제목"]',project.title);await this.writeBlocks(project,update);
      update({message:'카페에 입력된 원고와 사진·서식을 확인합니다.',progress:85});
      const state=await readEditor(),formatting=await this.editorFormatting(),issue=!editorMatches(project,state)?'제목·본문·사진 개수가 다릅니다.':editorFormatIssue(project,formatting);
      if(issue){this.store.put('editor-check',project.id,{checkedAt:new Date().toISOString(),issue,state,formatting,blocks:project.blocks});throw fail('카페 입력 결과가 미리보기와 다릅니다: '+issue+' 입력한 글은 보존했습니다.');}
      if(project.tags.length){update({message:'카페 태그를 입력하고 확인합니다.',progress:90});await this.setTags(project.tags);}
      const result={prepared:true,destination:'cafe',maps:formatting.components.filter(c=>c.class.includes('se-placesMap')).length,videos:formatting.components.filter(c=>c.class.includes('se-video')).length,url:state.url,title:state.title,photos:state.photoBlocks.reduce((n,c)=>n+c,0),photoBlocks:state.photoBlocks,revision:project.revision};
      update({message:'카페 편집기에 원고를 준비했습니다. 등록은 하지 않았습니다.',progress:100});return result;
    }finally{bridge.reveal?.();}});
  }
  async insertMap(block,siteName=''){
    const bridge=this.requireBridge(),query=block.text?.trim();if(!query)throw fail('현장 지도 검색어를 입력해 주세요.',400);
    const before=await bridge.evaluate(()=>document.querySelectorAll('.se-component.se-placesMap').length,null,{selector:'.se-component'});
    await bridge.click('button[aria-label="장소 추가"],button[data-name="map"]');
    await bridge.text('input[placeholder="장소명을 입력하세요."]',siteName&&query.startsWith(siteName+' ')?siteName:query);await bridge.key('Return');
    const until=Date.now()+12000;let chosen;
    do{checkCancelled();chosen=await bridge.evaluate(selectMapPlace,query,{selector:'input[placeholder="장소명을 입력하세요."]'});if(chosen)break;await pause(250);}while(Date.now()<until);
    if(!chosen)throw fail('현장 지도를 하나로 확인하지 못했습니다. 원고의 지도 검색어에 정확한 아파트명·주소를 입력해 주세요. 현재 글은 보존했습니다.');
    await bridge.click('[data-lemon-place="true"]');await bridge.click('button.se-place-add-button');await bridge.click('button.se-popup-button-confirm');
    const end=Date.now()+10000;let inserted=false;
    do{checkCancelled();inserted=await bridge.evaluate(({before,name})=>{const maps=[...document.querySelectorAll('.se-component.se-placesMap')];return maps.length===before+1&&maps.at(-1).textContent.replace(/\s/g,'').includes(name.replace(/\s/g,''));},{before,name:chosen.name},{selector:'.se-component'});if(inserted)break;await pause(250);}while(Date.now()<end);
    if(!inserted)throw fail('현장 지도 삽입을 확인하지 못했습니다. 현재 글은 보존했습니다.');
    await this.centerMedia('se-placesMap');
  }
  async videoTags(){
    return this.requireBridge().evaluate(()=>{const input=document.querySelector('input.nvu_tag_inp'),list=input?.closest('ul');if(!list)throw new Error('영상 태그 목록을 찾지 못했습니다.');return {tags:[...list.children].filter(e=>!e.querySelector('input')).map(e=>{const copy=e.cloneNode(true);copy.querySelectorAll('button').forEach(b=>b.remove());return copy.textContent.trim();}),input:input.value};},null,{selector:'input.nvu_tag_inp'});
  }
  async setVideoTags(tags){
    const bridge=this.requireBridge(),wanted=checkedVideoTags(tags);
    for(const tag of wanted){
      checkCancelled();if((await this.videoTags()).tags.includes(tag))continue;
      await bridge.click('#nvu_inp_box_tag');await bridge.text('input.nvu_tag_inp',tag);await bridge.key('End');await bridge.key('Return');
      const until=Date.now()+3000;let state;
      do{checkCancelled();state=await this.videoTags();if(state.tags.includes(tag)&&!state.input)break;await pause(100);}while(Date.now()<until);
      if(!state.tags.includes(tag)||state.input)throw fail('영상 태그를 등록하지 못했습니다: '+tag+'. 현재 원고는 보존했습니다.');
    }
    const state=await this.videoTags();if(state.input||JSON.stringify([...state.tags].sort())!==JSON.stringify(wanted.sort()))throw fail('영상 태그가 게시글 태그와 다릅니다. 현재 원고는 보존했습니다.');
  }
  async verifyVideoTags(tags){
    const bridge=this.requireBridge();
    await bridge.evaluate(()=>{document.querySelectorAll('[data-lemon-video]').forEach(e=>delete e.dataset.lemonVideo);[...document.querySelectorAll('.se-component.se-video')].at(-1).dataset.lemonVideo='true';},null,{selector:'.se-component'});
    await bridge.clickNative('[data-lemon-video="true"] .se-component-content');await bridge.click('button',{text:'정보 편집'});await bridge.waitFor('input.nvu_tag_inp');
    const state=await this.videoTags();if(state.input||JSON.stringify([...state.tags].sort())!==JSON.stringify(cleanTags(tags).sort()))throw fail('저장된 영상 태그가 게시글 태그와 다릅니다. 현재 원고는 보존했습니다.');
    await bridge.click('.nvu_btn_close');
  }
  async insertVideo(block,projectId,tags=[]){
    const bridge=this.requireBridge(),asset=this.store.get('asset',block.assetIds?.[0]);
    if(!asset||asset.projectId!==projectId||asset.role!=='video'||asset.status!=='ready'||asset.excluded)throw fail('첨부한 현장 동영상을 확인해 주세요.',400);
    checkedVideoTags(tags);
    const before=await bridge.evaluate(()=>document.querySelectorAll('.se-component.se-video').length,null,{selector:'.se-component'});
    await bridge.click('button[aria-label="동영상 추가"],button[data-name="video"]');
    const popupUntil=Date.now()+10000;let button=false;
    do{checkCancelled();button=await bridge.evaluate(()=>{const b=[...document.querySelectorAll('button,label')].find(e=>e.getBoundingClientRect().width&&e.textContent.replace(/\s/g,'')==='동영상추가');if(b)b.dataset.lemonVideoUpload='true';return !!b;});if(button)break;await pause(200);}while(Date.now()<popupUntil);
    if(!button)throw fail('네이버 동영상 추가 창을 확인하지 못했습니다.');
    await bridge.upload([this.assets.resolve(asset.originalPath)],()=>bridge.click('[data-lemon-video-upload="true"]'));
    const until=Date.now()+180000;let ready=false;
    do{checkCancelled();ready=await bridge.evaluate(()=>{const done=document.querySelector('.nvu_btn_submit');return !!document.querySelector('#nvu_inp_box_title')&&!!done?.getBoundingClientRect().width&&!done.matches('[disabled],[aria-disabled="true"],.nvu_btn_disabled');},null,{selector:'.nvu_btn_submit'});if(ready)break;await pause(500);}while(Date.now()<until);
    if(!ready)throw fail('동영상 업로드 시간이 초과되었습니다. 네이버 업로드 창과 파일 용량을 확인해 주세요.');
    await bridge.text('#nvu_inp_box_title',(block.text||asset.filename).slice(0,40));await bridge.key('End');
    await bridge.text('#nvu_inp_box_description',(block.text||asset.filename).slice(0,300));await bridge.key('End');
    await this.setVideoTags(tags);
    await bridge.key('Tab');
    await bridge.evaluate(()=>document.querySelector('.nvu_btn_submit').focus(),null,{selector:'.nvu_btn_submit',userGesture:true});await bridge.clickNative('.nvu_btn_submit');
    const end=Date.now()+180000;let inserted=false;
    do{checkCancelled();inserted=await bridge.evaluate(before=>document.querySelectorAll('.se-component.se-video').length===before+1,before,{selector:'.se-component'});if(inserted)break;if(await bridge.frame('.nvu_btn_submit'))await bridge.clickNative('.nvu_btn_submit');await pause(500);}while(Date.now()<end);
    if(!inserted)throw fail('동영상 카드 생성 완료를 확인하지 못했습니다. 현재 글은 보존했습니다.');
    const text=await bridge.evaluate(()=>[...document.querySelectorAll('.se-component.se-video')].at(-1)?.textContent||'',null,{selector:'.se-component'});
    if(!text.replace(/\s/g,'').includes((block.text||asset.filename).slice(0,40).replace(/\s/g,'')))throw fail('동영상 제목을 확인하지 못했습니다. 현재 글은 보존했습니다.');
    await this.verifyVideoTags(tags);
  }
  async centerMedia(className){
    const bridge=this.requireBridge();await bridge.evaluate(className=>{document.querySelectorAll('[data-lemon-media]').forEach(e=>delete e.dataset.lemonMedia);[...document.querySelectorAll('.se-component.'+className)].at(-1).dataset.lemonMedia='true';},className,{selector:'.se-component'});
    await bridge.clickNative('[data-lemon-media="true"] .se-component-content');await bridge.click('button[data-name="align"][data-value="center"]');
  }
  async writeBlocks(project,update){
    const bridge=this.requireBridge(),projectId=project.id,assets=this.store.assets(projectId),blocks=photoUploadBlocks(project.blocks);
    for(let i=0;i<blocks.length;i++){
      checkCancelled();const block=blocks[i];update({progress:10+Math.round(i/blocks.length*65),message:`본문 입력 ${i+1}/${blocks.length}`});
      if(block.kind==='map'||block.kind==='video'){
        await bridge.appendParagraph();
        if(block.kind==='map')await this.insertMap(block,project.original?.name?.trim());else await this.insertVideo(block,projectId,project.tags||[]);
      }else if(block.kind==='photos'){
        const ids=block.assetIds||[],files=[];for(const id of ids){const a=this.store.get('asset',id);if(!a||a.role!=='photo'||a.projectId!==projectId)throw fail('사진 원본을 확인할 수 없습니다.');files.push(await this.assets.originalForUpload(a));}
        const before=await bridge.evaluate(()=>document.querySelectorAll('.se-component.se-image img,.se-component.se-imageGroup img').length,null,{selector:'.se-component'});
        if(bridge.appendParagraph)await bridge.appendParagraph();else{await bridge.focusText('.se-component.se-text .se-text-paragraph');await bridge.key('Return');}
        const input=await bridge.evaluate(()=>!!document.querySelector('input[type="file"][accept*=".jpg"]'),null,{selector:'.se-component'});
        await bridge.upload(files,input?null:()=>bridge.click('button[data-name="image"],button.se-image-toolbar-button,button[aria-label="사진 추가"]'));
        const start=Date.now();let count=before;
        while(Date.now()-start<90000){checkCancelled();
          const modal=await bridge.click('button,label',{text:files.length>1?(block.layout==='slide'?'슬라이드':'콜라주'):'개별 사진',optional:true});if(modal)await bridge.click('button',{text:'확인',optional:true});
          count=await bridge.evaluate(()=>document.querySelectorAll('.se-component.se-image img,.se-component.se-imageGroup img').length,null,{selector:'.se-component'});if(count>=before+files.length)break;await pause(500);
        }
        if(count<before+files.length)throw fail('사진 업로드 완료를 확인하지 못했습니다. 원본 파일과 네이버 용량 제한을 확인해 주세요.');
        if(project.postType!=='case'&&project.postType!=='completion'&&block.space==='표지'&&ids.length===1){const coverIndex=await bridge.evaluate(()=>document.querySelectorAll('.se-component.se-image img,.se-component.se-imageGroup img').length-1,null,{selector:'.se-component'});await this.setCoverSquare(coverIndex);}
        if(files.length>1){
          const grouped=await bridge.evaluate(({count,layout})=>{const group=[...document.querySelectorAll('.se-component.se-imageGroup')].at(-1);return group?.querySelectorAll('img').length===count&&(!layout||group.classList.contains('se-l-'+layout));},{count:files.length,layout:block.layout},{selector:'.se-component'});
          if(!grouped)throw fail('사진은 입력되었지만 묶음 배치를 확인하지 못했습니다. 열린 편집기에서 묶음을 확인해 주세요.');
          if(isPlanCollage(project,block,assets))await this.setPlanCollage();
        }
      }else{
        if(bridge.appendParagraph)await bridge.appendParagraph();else{await bridge.focusText('.se-component.se-text .se-text-paragraph');await bridge.key('Return');}
        if(block.kind==='quote'||block.kind==='divider')await this.insertStructure(block,project);
        else{
          if(block.kind==='text'&&(block.formatRole==='closing'||project.postType==='completion'&&block.formatRole==='point'&&blocks[i-1]?.formatRole==='pointBody'))await bridge.key('Return');
          if(block.kind==='text')for(const name of ['bold','italic','underline','strikethrough'])await bridge.click(`button[data-name="${name}"].se-is-selected`,{optional:true});
          await this.pasteParagraphs(block,project);
        }
      }
    }
  }
  async publish(projectId,update,{confirmReviewed=false,prepareOnly=false}={}){
    if(this.store.get('project',projectId)?.postType==='completion')throw fail('마감글은 네이버 카페 작성 흐름을 사용해 주세요.',400);
    const bridge=this.requireBridge(),project=this.store.get('project',projectId),assets=this.store.assets(projectId),settings=this.store.get('settings','main');
    if(project.blocks.some(b=>b.kind==='video'))checkedVideoTags(project.tags);
    if(!/^[a-zA-Z0-9_-]{2,40}$/.test(settings.blogId))throw fail('설정에서 담당 블로그 아이디를 입력해 주세요.',400);
    const warnings=draftWarnings(project,assets);if(warnings.length&&!prepareOnly)throw fail(warnings.join('\n'),400);
    if(prepareOnly&&project.postType==='case'&&warnings.some(w=>w.includes('템플릿 이미지를 다시')))throw fail('현장명·사진·시공내용에 맞게 템플릿 이미지를 다시 만들어 주세요.',400);
    const missing=missingSpaceDescriptions(project,assets);if(prepareOnly&&missing.length)throw fail(`${missing.join('·')} 공간 설명이 비어 있습니다. 원고를 다시 생성하거나 설명을 작성해 주세요.`,400);
    if(prepareOnly&&(!project.original.name.trim()||project.postType!=='case'&&!project.target.name.trim()||!project.title.trim()||!project.blocks.length))throw fail('현장 정보와 원고를 작성한 뒤 편집기에서 확인해 주세요.',400);
    if(project.publishMode==='review'&&!confirmReviewed&&!prepareOnly)throw fail('미리보기 확인 후 발행 버튼을 눌러 주세요.',400);
    if(project.scheduleAt&&new Date(project.scheduleAt).getTime()<=Date.now())throw fail('예약 시각은 현재보다 이후여야 합니다.',400);
    const fingerprint=this.fingerprint(project,assets,settings.blogId),prior=this.store.get('publish',fingerprint);
    if(prior?.status==='completed')return prior;
    if(prior&&['submitting','uncertain'].includes(prior.status))throw Object.assign(fail('이 원고의 발행 결과가 불명확합니다. 네이버에서 기존 등록 여부를 확인하고 결과를 기록해 주세요.',409),{uncertain:true});
    return this.exclusive(async()=>{
      const readEditor=()=>bridge.evaluate(()=>({title:[...document.querySelectorAll('.se-title-text .__se-node')].map(e=>e.textContent).join('').trim(),text:[...document.querySelectorAll('.se-component.se-text,.se-component.se-quotation')].map(e=>e.innerText).join('\n'),photos:document.querySelectorAll('.se-component.se-image img,.se-component.se-imageGroup img').length,groups:[...document.querySelectorAll('.se-component.se-imageGroup')].map(g=>g.querySelectorAll('img').length),photoBlocks:[...document.querySelectorAll('.se-component.se-image,.se-component.se-imageGroup')].map(g=>g.querySelectorAll('img').length),photoSources:[...document.querySelectorAll('.se-component.se-image img,.se-component.se-imageGroup img')].map(i=>i.currentSrc||i.src),tagText:document.querySelector('input[placeholder*="태그"]')?.parentElement?.parentElement?.innerText||'',inputs:[...document.querySelectorAll('input,select')].filter(e=>e.getBoundingClientRect().width>0||['radio','checkbox'].includes(e.type)).map(e=>({type:e.type,value:e.value,checked:e.checked})),panel:!!document.querySelector('button[class*="confirm_btn"]')}),null,{selector:'.se-title-text'});
      const proof=state=>createHash('sha256').update(JSON.stringify({...state,text:state.text.replace(/\s+/g,' ').trim()})).digest('hex');
      let resume=false;
      if(prior?.status==='prepared'&&bridge.window&&!bridge.window.isDestroyed()){
        const state=await readEditor().catch(()=>null);
        resume=!!state?.panel&&proof(state)===prior.editorProof&&(!bridge.appendParagraph||editorFormatMatches(project,await this.editorFormatting()));
      }
      const now=new Date().toISOString();this.store.put('publish',fingerprint,{fingerprint,projectId,blogId:settings.blogId,status:'preparing',createdAt:now});
      try{
        if(!resume){
        update({message:'담당 블로그 편집기를 엽니다.',progress:5});
        await bridge.goto(`https://blog.naver.com/${encodeURIComponent(settings.blogId)}/postwrite`);
        await bridge.waitFor('.se-title-text');
        bridge.reveal?.();
        await pause(2500);await bridge.click('.se-popup-button-cancel',{optional:true});await pause(300);
        const account=await bridge.status(settings.blogId,{verify:true});if(!account.connected||!account.canWrite)throw fail('저장된 계정의 글쓰기 권한을 확인하지 못했습니다. 네이버 연결 창에서 다시 로그인해 주세요.',401);
        const existing=await bridge.evaluate(()=>({title:[...document.querySelectorAll('.se-title-text .__se-node')].map(e=>e.textContent).join('').trim(),body:[...document.querySelectorAll('.se-component.se-text .__se-node')].map(e=>e.textContent.trim()).join('')}),null,{selector:'.se-title-text'});
        if(existing.title||existing.body)throw fail('네이버 편집기에 기존 작성 중인 글이 있습니다. 브라우저에서 보관하거나 새 글을 열고 다시 시도해 주세요.');
        await bridge.text('.se-title-text',project.title);
        await this.writeBlocks(project,update);
        update({message:'네이버에 입력된 제목·본문·사진을 확인합니다.',progress:80});
        const check=await readEditor();
        const expectedPhotos=project.blocks.filter(b=>b.kind==='photos').reduce((n,b)=>n+(b.assetIds?.length||0),0);
        if(check.photos!==expectedPhotos||!editorMatches(project,check))throw fail('네이버 입력 결과가 미리보기와 일치하지 않습니다. 브라우저에서 확인해 주세요.');
        if(bridge.appendParagraph&&!editorFormatMatches(project,await this.editorFormatting()))throw fail('네이버에 입력된 순서나 본문·공간명·인용구·구분선 서식이 원본과 다릅니다. 최종 발행하지 않았습니다.');
        await bridge.click('button.publish_btn__m9KHH,button[class*="publish_btn"]');
        await bridge.waitFor('input[class*="tag"],input[placeholder*="태그"],button[class*="confirm_btn"]');
        }
        const account=await bridge.status(settings.blogId,{verify:true});if(!account.connected||!account.canWrite)throw fail('담당 블로그 계정과 글쓰기 권한을 다시 확인해 주세요.',401);
        const planCollage=await this.verifyPlanCollage(project,assets);
        await this.setVisibility(project.visibility||'public');
        await this.setCategory(publicationCategory(project));await this.setTags(project.tags);
        if(project.scheduleAt)await this.setSchedule(project.scheduleAt);else await bridge.click('label',{text:'현재'});
        const publicationSettings=await this.verifyPanel(project);
        if(prepareOnly){
          const state=await readEditor();if(!state.panel)throw fail('네이버 발행 설정 화면을 확인하지 못했습니다.');
          const prepared={fingerprint,projectId,blogId:settings.blogId,status:'prepared',prepared:true,editorProof:proof(state),title:project.title,photos:state.photos,groups:state.groups,planCollage,publicationSettings,visibility:project.visibility||'public',scheduled:!!project.scheduleAt,scheduleAt:project.scheduleAt,warnings,createdAt:now};
          this.store.put('publish',fingerprint,prepared);bridge.reveal?.();update({message:'네이버 편집기에 원고를 준비했습니다. 최종 발행은 하지 않았습니다.',progress:100});return prepared;
        }
        update({cancellable:false});checkCancelled();
        const record={fingerprint,projectId,blogId:settings.blogId,visibility:project.visibility||'public',status:'submitting',createdAt:now};this.store.put('publish',fingerprint,record);
        update({message:'발행 요청 후 등록 결과를 확인합니다.',progress:90});
        await bridge.click('button[class*="confirm_btn"]');
        let postUrl='',scheduleConfirmed=false,evidence={};const start=Date.now();
        while(Date.now()-start<45000){
          const snapshots=await bridge.snapshot();const submitted=snapshots.find(s=>postIdentity(s.url,settings.blogId)&&!s.url.includes('postwrite'));
          if(submitted){record.postId=postIdentity(submitted.url,settings.blogId);this.store.put('publish',fingerprint,record);}
          if(project.scheduleAt&&submitted){evidence=await this.confirmSchedule(project,settings.blogId,update);scheduleConfirmed=true;postUrl=`https://blog.naver.com/${settings.blogId}/${evidence.postId||record.postId}`;break;}
          const entry=snapshots.find(s=>postIdentity(s.url,settings.blogId)&&s.text.includes(project.title));
          if(entry){postUrl=`https://blog.naver.com/${settings.blogId}/${postIdentity(entry.url,settings.blogId)}`;break;}
          await pause(500);
        }
        if(!postUrl&&!scheduleConfirmed)throw Object.assign(fail('발행 요청 후 등록 결과를 확인하지 못했습니다. 중복 발행을 막기 위해 네이버에서 등록 여부를 확인해 주세요.'),{uncertain:true});
        const completed={...record,...evidence,postId:evidence.postId||record.postId,status:'completed',verified:true,url:postUrl||`https://blog.naver.com/${settings.blogId}`,scheduled:!!project.scheduleAt,scheduleAt:project.scheduleAt,completedAt:new Date().toISOString()};this.store.put('publish',fingerprint,completed);this.store.updateProject(projectId,{draftStatus:project.scheduleAt?'scheduled':'published'});bridge.publishVerified=true;return completed;
      }catch(e){bridge.reveal?.();const record=this.store.get('publish',fingerprint);this.store.put('publish',fingerprint,{...record,status:record?.status==='submitting'?'uncertain':'needs_review',message:e.message});if(record?.status==='submitting')e.uncertain=true;throw e;}
    });
  }
}

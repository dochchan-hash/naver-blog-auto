import {createHash,randomUUID} from 'node:crypto';
import {validateNaverUrl,draftWarnings,paragraphHtml} from '../shared/domain.mjs';
import {readReferenceFormat,formatFor,editorFormatMatches} from '../shared/format.mjs';
const fail=(message,status=422)=>Object.assign(new Error(message),{status});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const kstMinute=iso=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)).replaceAll('-','.');
export function postIdentity(url,blogId){try{const u=new URL(url);if(u.origin!=='https://blog.naver.com')return '';const parts=u.pathname.split('/');if(parts[1]===blogId&&/^\d+$/.test(parts[2]||''))return parts[2];return u.searchParams.get('blogId')===blogId&&/^\d+$/.test(u.searchParams.get('logNo')||'')?u.searchParams.get('logNo'):'';}catch{return '';}}
export function editorMatches(project,state){const normalize=t=>(t||'').replace(/[\s\u200B\uFEFF]/g,'');return state.title===project.title&&JSON.stringify(state.photoBlocks)===JSON.stringify(project.blocks.filter(b=>b.kind==='photos').map(b=>b.assetIds.length))&&project.blocks.filter(b=>['text','heading','quote'].includes(b.kind)).every(b=>normalize(state.text).includes(normalize(b.text)));}
export class Naver {
  constructor(store,assets,bridge){Object.assign(this,{store,assets,bridge});this.searches=new Map();}
  requireBridge(){if(!this.bridge)throw fail('네이버 작업은 데스크톱 실행 프로그램에서 사용할 수 있습니다.',503);return this.bridge;}
  async status(){if(!this.bridge)return {available:false,connected:false,verified:false};const blogId=this.store.get('settings','main').blogId;const status=await this.bridge.status(blogId);return {...status,verified:status.verified||this.store.list('publish').some(p=>p.blogId===blogId&&p.status==='completed'&&p.verified)};}
  async checkConnection(){const bridge=this.requireBridge();return bridge.exclusive(async()=>{const id=this.store.get('settings','main').blogId;await bridge.open(id?`https://blog.naver.com/${id}`:'https://blog.naver.com/MyBlog.naver',{visible:false});let status;const start=Date.now();do{await pause(500);status=await bridge.status(id,{verify:true});if(status.connected)break;}while(Date.now()-start<6000);if(!status.connected)bridge.reveal();return status;});}
  async changeAccount(){const result=await this.requireBridge().changeAccount();this.store.put('settings','main',{...this.store.get('settings','main'),blogId:''});return result;}
  login(blogId=''){if(blogId&&!/^[a-zA-Z0-9_-]{2,40}$/.test(blogId))throw fail('블로그 아이디를 확인해 주세요.',400);const bridge=this.requireBridge();if(bridge.window&&!bridge.window.isDestroyed()){bridge.reveal();return bridge;}return bridge.open(blogId?`https://blog.naver.com/${blogId}`:'https://blog.naver.com/MyBlog.naver');}
  async readPost(url){
    validateNaverUrl(url);const bridge=this.requireBridge();
    return bridge.exclusive(async()=>{
      await bridge.goto(url);
      const selectors=url.includes('cafe.naver.com')?'.se-main-container, .ContentRenderer, #article-area':'.se-main-container';
      const postId=!url.includes('cafe.naver.com')?(new URL(url).pathname.match(/\/(\d+)\/?$/)?.[1]||new URL(url).searchParams.get('logNo')||''):'';
      await bridge.waitFor(selectors,18000,{urlContains:postId});
      const result=await bridge.evaluate(()=>{
        const root=document.querySelector('.se-main-container,.ContentRenderer,#article-area');
        const text=root?.innerText||'';
        const photoGroups=[...root?.querySelectorAll('.se-imageGroup,.se-image')||[]].filter(el=>!el.parentElement?.closest('.se-imageGroup')).map(el=>({count:el.querySelectorAll('img').length,layout:el.className}));
        const sample=root?.querySelector('.se-text-paragraph');const css=sample?getComputedStyle(sample):null;
        return {title:document.title,text,photoGroups,format:css?{align:css.textAlign,fontSize:css.fontSize,lineHeight:css.lineHeight}:null};
      },null,{selector:selectors,urlContains:postId});
      if(!result.text.trim())throw fail('게시글 본문을 읽지 못했습니다. 로그인 권한을 확인하거나 본문을 직접 입력해 주세요.');
      const formatProfile=postId?await bridge.evaluate(readReferenceFormat,null,{selector:selectors,urlContains:postId}):null;
      return {...result,url,formatProfile};
    });
  }
  async searchComplex(query){
    const bridge=this.requireBridge();if(!query.trim())throw fail('아파트명과 지역을 입력해 주세요.',400);
    return bridge.exclusive(()=>this.searchCandidates(query));
  }
  async searchCandidates(query){
      const bridge=this.requireBridge();
      await bridge.goto('https://fin.land.naver.com/home');
      await bridge.click('button',{text:'단지, 주소, 지하철, 초등학교 검색'});
      const selector='input[placeholder*="검색"],input[placeholder*="단지"],input[type="search"]';
      await bridge.waitFor(selector);await bridge.text(selector,query);
      await pause(1200);
      const list=await bridge.evaluate(()=>{
        const normalize=t=>t.replace(/\s+/g,' ').trim();
        return [...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0).map(b=>({name:normalize(b.innerText)})).filter(x=>/^(?:아파트|오피스텔|주상복합|연립|빌라)\s+\S/.test(x.name)&&x.name.length>8);
      },null);
      const seen=new Set();const unique=list.filter(x=>{if(seen.has(x.name))return false;seen.add(x.name);return true;}).map(x=>{const key=randomUUID();this.searches.set(key,{query,label:x.name});return {...x,key,label:x.name};});
      if(!unique.length)throw fail('자동 검색 결과를 읽지 못했습니다. 열린 네이버 화면에서 단지를 선택한 뒤 단지 링크를 입력하거나 도면을 직접 첨부해 주세요.');
      return unique;
  }
  async selectComplex(key){
    const choice=this.searches.get(key);if(!choice)throw fail('검색 결과가 만료되었습니다. 단지를 다시 검색해 주세요.',400);
    const bridge=this.requireBridge();return bridge.exclusive(async()=>{
      await this.searchCandidates(choice.query);
      const clicked=await bridge.evaluate(label=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.replace(/\s+/g,' ').trim()===label);if(!b)return false;b.click();return true;},choice.label);
      if(!clicked)throw fail('검색 결과가 바뀌었습니다. 단지를 다시 선택해 주세요.');
      await pause(1000);
      const url=await bridge.evaluate(label=>[...document.querySelectorAll('a[href*="/complexes/"]')].find(a=>a.textContent.trim().length>1&&label.includes(a.textContent.trim()))?.href,choice.label);
      if(!url)throw fail('단지 상세 주소를 확인하지 못했습니다. 네이버 창에서 상세 링크를 복사해 입력해 주세요.');
      return this.complexDetails(url);
    });
  }
  async readComplex(url,type=''){return this.requireBridge().exclusive(()=>this.complexDetails(url,type));}
  async editorFormatting(){
    return this.requireBridge().evaluate(()=>({paragraphs:[...document.querySelectorAll('.se-component.se-text .se-text-paragraph,.se-component.se-quotation .se-text-paragraph')].filter(p=>p.textContent.replace(/[\u200B\uFEFF\s]/g,'')).map(p=>({text:p.textContent,align:getComputedStyle(p).textAlign,spans:[...p.querySelectorAll('.__se-node')].filter(s=>s.textContent.replace(/[\u200B\uFEFF\s]/g,'')).map(s=>{const cs=getComputedStyle(s.querySelector('b,strong')||s);return {text:s.textContent,fontSize:cs.fontSize,fontWeight:cs.fontWeight,backgroundColor:getComputedStyle(s).backgroundColor,color:cs.color,fontFamily:cs.fontFamily};})})),components:[...document.querySelectorAll('.se-component')].map(c=>({class:c.className,text:[...c.querySelectorAll('.se-text-paragraph .__se-node')].map(e=>e.textContent).join('\n'),photoCount:c.querySelectorAll('img').length}))}),null,{selector:'.se-title-text'});
  }
  async insertStructure(block,project){
    const bridge=this.requireBridge(),format=formatFor(project),quote=block.kind==='quote',name=quote?'quotation':'horizontal-line',variant=quote?format.quoteVariant:format.dividerVariant;
    await bridge.click(`button[data-name="${name}"].se-document-toolbar-select-option-button`);
    await bridge.click(`button[data-name="${name}"][data-role="option"][data-value="${variant}"]`);
    const component=quote?'.se-component.se-quotation':'.se-component.se-horizontalLine';
    await bridge.waitFor(`${component}.se-l-${variant}`);
    if(quote){
      await bridge.focusText('.se-component.se-quotation .se-quote .se-text-paragraph');
      await bridge.pasteHtml(paragraphHtml(block,format));
      await bridge.key('ArrowDown',{modifiers:[process.platform==='darwin'?'meta':'control']});await bridge.key('ArrowDown');
    }
  }
  async complexDetails(url,type=''){
    const parsed=new URL(validateNaverUrl(url));if(!['fin.land.naver.com','new.land.naver.com'].includes(parsed.hostname)||!parsed.pathname.startsWith('/complexes/'))throw fail('네이버 부동산 단지 상세 링크를 입력해 주세요.',400);
    const bridge=this.requireBridge();
      await bridge.goto(url);await bridge.waitFor('button',18000,{urlContains:parsed.hostname});
      const started=Date.now();let ready=false;
      while(Date.now()-started<12000){ready=await bridge.click('[role="tab"],button',{text:'단지정보',optional:true});if(ready)break;await pause(250);}
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
  fingerprint(project,assets,blogId){return createHash('sha256').update(JSON.stringify({blogId,title:project.title,blocks:project.blocks,tags:project.tags,scheduleAt:project.scheduleAt,photos:assets.filter(a=>a.role==='photo'&&!a.excluded).map(a=>a.hash),...(project.visibility==='private'?{visibility:'private'}:{})})).digest('hex');}
  async setVisibility(visibility){
    const bridge=this.requireBridge(),label=visibility==='private'?'비공개':'전체공개';
    const selected=await bridge.evaluate(text=>{const l=[...document.querySelectorAll('label')].find(e=>e.textContent.replace(/\s/g,'')===text);const r=l&&(l.control||document.getElementById(l.htmlFor)||l.querySelector('input'));if(!r||r.disabled)return false;if(!r.checked)l.click();return true;},label);
    if(!selected)throw fail('네이버 공개 범위 선택란을 찾지 못했습니다.');await pause(100);
    const checked=await bridge.evaluate(text=>{const l=[...document.querySelectorAll('label')].find(e=>e.textContent.replace(/\s/g,'')===text);return !!(l&&(l.control||document.getElementById(l.htmlFor)||l.querySelector('input')))?.checked;},label);
    if(!checked)throw fail('네이버 공개 범위가 요청과 일치하지 않습니다. 최종 발행하지 않았습니다.');
  }
  async setSchedule(iso){
    const bridge=this.requireBridge();const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date(iso));const value=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    if(Number(value.minute)%10!==0)throw fail('네이버 예약 발행은 10분 단위입니다. 예약 시각을 조정해 주세요.',400);
    const selected=await bridge.evaluate(()=>{const el=[...document.querySelectorAll('label')].find(l=>l.textContent.trim()==='예약');if(!el)return false;el.click();return true;});
    if(!selected)throw fail('네이버 예약 선택란을 찾지 못했습니다.');
    await bridge.waitFor('select[aria-label*="예약"],select');
    const dateSelector='input[readonly],input[class*="date"]';
    const date=await bridge.evaluate(()=>{const el=[...document.querySelectorAll('input')].find(e=>/^\d{4}\.\s*\d{2}\.\s*\d{2}/.test(e.value));if(!el)return '';el.click();return el.value;});
    if(!date)throw fail('예약 날짜 선택란을 찾지 못했습니다.');
    let month=(Number(date.slice(0,4))*12+Number(date.match(/\.\s*(\d{2})/)?.[1]))-1;const target=Number(value.year)*12+Number(value.month)-1;
    if(Math.abs(target-month)>24)throw fail('예약 날짜가 지원 범위를 벗어납니다. 네이버 화면에서 확인해 주세요.');
    while(month!==target){await bridge.click('button',{text:month<target?'다음 달':'이전 달'});month+=month<target?1:-1;await pause(80);}
    const picked=await bridge.evaluate(day=>{const button=[...document.querySelectorAll('table button')].find(b=>b.textContent.trim()===String(Number(day))&&!b.disabled);if(!button)return false;button.click();return true;},value.day);
    if(!picked)throw fail('선택한 예약 날짜를 네이버에서 사용할 수 없습니다.');
    const times=await bridge.evaluate(({hour,minute})=>{
      const selects=[...document.querySelectorAll('select')].filter(e=>e.getBoundingClientRect().width>0);const h=selects.find(e=>/예약.*시간/.test(e.getAttribute('aria-label')||''))||selects.find(e=>e.options.length===24);const m=selects.find(e=>/예약.*분/.test(e.getAttribute('aria-label')||''))||selects.find(e=>[...e.options].map(o=>o.textContent.trim()).join(',')==='00,10,20,30,40,50');
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
      return bridge.exclusive(async()=>{
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
    return bridge.exclusive(async()=>{const evidence=await this.confirmSchedule(project,blogId,update);const postId=evidence.postId||record.postId;const completed={...record,...evidence,postId,status:'completed',verified:true,scheduled:true,url:postId?`https://blog.naver.com/${blogId}/${postId}`:`https://blog.naver.com/${blogId}/postwrite`,completedAt:new Date().toISOString()};this.store.put('publish',key,completed);this.store.updateProject(projectId,{draftStatus:'scheduled'});bridge.publishVerified=true;return completed;});
  }
  async publish(projectId,update,{confirmReviewed=false,prepareOnly=false}={}){
    const bridge=this.requireBridge(),project=this.store.get('project',projectId),assets=this.store.assets(projectId),settings=this.store.get('settings','main');
    if(!/^[a-zA-Z0-9_-]{2,40}$/.test(settings.blogId))throw fail('설정에서 담당 블로그 아이디를 입력해 주세요.',400);
    const warnings=draftWarnings(project,assets);if(warnings.length&&!prepareOnly)throw fail(warnings.join('\n'),400);
    if(prepareOnly&&(!project.original.name.trim()||!project.target.name.trim()||!project.title.trim()||!project.blocks.length))throw fail('현장 정보와 원고를 작성한 뒤 편집기에서 확인해 주세요.',400);
    if(project.publishMode==='review'&&!confirmReviewed&&!prepareOnly)throw fail('미리보기 확인 후 발행 버튼을 눌러 주세요.',400);
    if(project.scheduleAt&&new Date(project.scheduleAt).getTime()<=Date.now())throw fail('예약 시각은 현재보다 이후여야 합니다.',400);
    const fingerprint=this.fingerprint(project,assets,settings.blogId),prior=this.store.get('publish',fingerprint);
    if(prior?.status==='completed')return prior;
    if(prior&&['submitting','uncertain'].includes(prior.status))throw Object.assign(fail('이 원고의 발행 결과가 불명확합니다. 네이버에서 기존 등록 여부를 확인하고 결과를 기록해 주세요.',409),{uncertain:true});
    return bridge.exclusive(async()=>{
      const readEditor=()=>bridge.evaluate(()=>({title:[...document.querySelectorAll('.se-title-text .__se-node')].map(e=>e.textContent).join('').trim(),text:[...document.querySelectorAll('.se-component.se-text,.se-component.se-quotation')].map(e=>e.innerText).join('\n'),photos:document.querySelectorAll('.se-component.se-image img,.se-component.se-imageGroup img').length,groups:[...document.querySelectorAll('.se-component.se-imageGroup')].map(g=>g.querySelectorAll('img').length),photoBlocks:[...document.querySelectorAll('.se-component.se-image,.se-component.se-imageGroup')].map(g=>g.querySelectorAll('img').length),photoSources:[...document.querySelectorAll('.se-component.se-image img,.se-component.se-imageGroup img')].map(i=>i.currentSrc||i.src),tagText:document.querySelector('input[placeholder*="태그"]')?.parentElement?.parentElement?.innerText||'',inputs:[...document.querySelectorAll('input,select')].filter(e=>e.getBoundingClientRect().width>0||['radio','checkbox'].includes(e.type)).map(e=>({type:e.type,value:e.value,checked:e.checked})),panel:!!document.querySelector('button[class*="confirm_btn"]')}),null,{selector:'.se-title-text'});
      const proof=state=>createHash('sha256').update(JSON.stringify({...state,text:state.text.replace(/\s+/g,' ').trim()})).digest('hex');
      let resume=false;
      if(prior?.status==='prepared'&&bridge.window&&!bridge.window.isDestroyed()){
        const state=await readEditor().catch(()=>null);
        resume=!!state?.panel&&proof(state)===prior.editorProof;
      }
      const now=new Date().toISOString();this.store.put('publish',fingerprint,{fingerprint,projectId,blogId:settings.blogId,status:'preparing',createdAt:now});
      try{
        if(!resume){
        update({message:'담당 블로그 편집기를 엽니다.',progress:5});
        await bridge.goto(`https://blog.naver.com/${encodeURIComponent(settings.blogId)}/postwrite`);
        await bridge.waitFor('.se-title-text');
        bridge.reveal?.();
        await pause(1000);await bridge.click('.se-popup-button-cancel',{optional:true});
        const account=await bridge.status(settings.blogId,{verify:true});if(!account.connected||!account.canWrite)throw fail('저장된 계정의 글쓰기 권한을 확인하지 못했습니다. 네이버 연결 창에서 다시 로그인해 주세요.',401);
        const existing=await bridge.evaluate(()=>({title:[...document.querySelectorAll('.se-title-text .__se-node')].map(e=>e.textContent).join('').trim(),body:[...document.querySelectorAll('.se-component.se-text .__se-node')].map(e=>e.textContent.trim()).join('')}),null,{selector:'.se-title-text'});
        if(existing.title||existing.body)throw fail('네이버 편집기에 기존 작성 중인 글이 있습니다. 브라우저에서 보관하거나 새 글을 열고 다시 시도해 주세요.');
        await bridge.text('.se-title-text',project.title);
        for(let i=0;i<project.blocks.length;i++){
          const block=project.blocks[i];update({progress:10+Math.round(i/project.blocks.length*65),message:`본문 입력 ${i+1}/${project.blocks.length}`});
          if(block.kind==='photos'){
            const ids=block.assetIds||[],files=[];for(const id of ids){const a=this.store.get('asset',id);if(!a||a.role!=='photo'||a.projectId!==projectId)throw fail('사진 원본을 확인할 수 없습니다.');files.push(await this.assets.originalForUpload(a));}
            const before=await bridge.evaluate(()=>document.querySelectorAll('.se-component.se-image img,.se-component.se-imageGroup img').length,null,{selector:'.se-title-text'});
            if(bridge.appendParagraph)await bridge.appendParagraph();else{await bridge.focusText('.se-component.se-text .se-text-paragraph');await bridge.key('Return');}
            const input=await bridge.evaluate(()=>!!document.querySelector('input[type="file"][accept*=".jpg"]'),null,{selector:'.se-title-text'});
            await bridge.upload(files,input?null:()=>bridge.click('button[data-name="image"],button.se-image-toolbar-button,button[aria-label="사진 추가"]'));
            const start=Date.now();let count=before;
            while(Date.now()-start<90000){
              const modal=await bridge.click('button,label',{text:files.length>1?'콜라주':'개별 사진',optional:true});if(modal)await bridge.click('button',{text:'확인',optional:true});
              count=await bridge.evaluate(()=>document.querySelectorAll('.se-component.se-image img,.se-component.se-imageGroup img').length,null,{selector:'.se-title-text'});if(count>=before+files.length)break;await pause(500);
            }
            if(count<before+files.length)throw fail('사진 업로드 완료를 확인하지 못했습니다. 원본 파일과 네이버 용량 제한을 확인해 주세요.');
            if(files.length>1){
              const grouped=await bridge.evaluate(expected=>[...document.querySelectorAll('.se-component.se-imageGroup')].at(-1)?.querySelectorAll('img').length===expected,files.length,{selector:'.se-title-text'});
              if(!grouped)throw fail('사진은 입력되었지만 묶음 배치를 확인하지 못했습니다. 열린 편집기에서 묶음을 확인해 주세요.');
            }
          }else{
            if(bridge.appendParagraph)await bridge.appendParagraph();else{await bridge.focusText('.se-component.se-text .se-text-paragraph');await bridge.key('Return');}
            if(block.kind==='quote'||block.kind==='divider')await this.insertStructure(block,project);
            else{
              if(block.kind==='text')for(const name of ['bold','italic','underline','strikethrough'])await bridge.click(`button[data-name="${name}"].se-is-selected`,{optional:true});
              await bridge.pasteHtml(paragraphHtml(block,formatFor(project)));
            }
          }
        }
        update({message:'네이버에 입력된 제목·본문·사진을 확인합니다.',progress:80});
        const check=await readEditor();
        const expectedPhotos=project.blocks.filter(b=>b.kind==='photos').reduce((n,b)=>n+(b.assetIds?.length||0),0);
        if(check.photos!==expectedPhotos||!editorMatches(project,check))throw fail('네이버 입력 결과가 미리보기와 일치하지 않습니다. 브라우저에서 확인해 주세요.');
        if(bridge.appendParagraph&&!editorFormatMatches(project,await this.editorFormatting()))throw fail('네이버에 입력된 순서나 본문·공간명·인용구·구분선 서식이 원본과 다릅니다. 최종 발행하지 않았습니다.');
        await bridge.click('button.publish_btn__m9KHH,button[class*="publish_btn"]');
        await bridge.waitFor('input[class*="tag"],input[placeholder*="태그"],button[class*="confirm_btn"]');
        await this.setVisibility(project.visibility||'public');
        if(project.tags.length){
          const selector='input[class*="tag"],input[placeholder*="태그"]';
          const tagFrame=await bridge.frame(selector);if(!tagFrame)throw fail('태그 입력란을 찾지 못했습니다.');
          for(const tag of project.tags){await bridge.text(selector,tag);bridge.window.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});bridge.window.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});await pause(100);}
        }
        if(project.scheduleAt)await this.setSchedule(project.scheduleAt);
        }
        const account=await bridge.status(settings.blogId,{verify:true});if(!account.connected||!account.canWrite)throw fail('담당 블로그 계정과 글쓰기 권한을 다시 확인해 주세요.',401);
        await this.setVisibility(project.visibility||'public');
        if(prepareOnly){
          const state=await readEditor();if(!state.panel)throw fail('네이버 발행 설정 화면을 확인하지 못했습니다.');
          const prepared={fingerprint,projectId,blogId:settings.blogId,status:'prepared',prepared:true,editorProof:proof(state),title:project.title,photos:state.photos,groups:state.groups,visibility:project.visibility||'public',scheduled:!!project.scheduleAt,scheduleAt:project.scheduleAt,warnings,createdAt:now};
          this.store.put('publish',fingerprint,prepared);bridge.reveal?.();update({message:'네이버 편집기에 원고를 준비했습니다. 최종 발행은 하지 않았습니다.',progress:100});return prepared;
        }
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

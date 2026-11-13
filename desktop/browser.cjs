const {BrowserWindow,clipboard,ClipboardItem,shell}=require('electron');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function snapshotClipboard(api=clipboard,Item=ClipboardItem){const items=await api.read();return Promise.all(items.filter(item=>item.types.length).map(async item=>new Item(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));}
class BrowserBridge {
  constructor({vault}={}){this.window=null;this.busy=false;this.publishVerified=false;this.vault=vault;this.credentials=vault?.get('naver')||null;this.expectedBlogId='';this.captureTimer=null;}
  get available(){return true;}
  async open(url='https://blog.naver.com/MyBlog.naver',{visible=true,loadTimeout=30000}={}){
    if(!this.window||this.window.isDestroyed()){
      this.window=new BrowserWindow({width:1180,height:860,show:visible,title:'네이버 · 레몬하우스 스튜디오',webPreferences:{partition:'persist:naver',nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
      if(this.credentials){for(const cookie of this.credentials.cookies||[]){const protocol=cookie.secure?'https':'http';const domain=cookie.domain.replace(/^\./,'');const {hostOnly,session,...value}=cookie;try{await this.window.webContents.session.cookies.set({...value,url:`${protocol}://${domain}${cookie.path||'/'}`});}catch{}}}
      this.window.webContents.setWindowOpenHandler(({url})=>{if(this.allowed(url)){this.window.loadURL(url);return {action:'deny'};}if(/^https:\/\//.test(url))shell.openExternal(url);return {action:'deny'};});
      this.window.webContents.on('will-prevent-unload',event=>{event.preventDefault();});
      this.window.webContents.on('will-navigate',(event,url)=>{if(!this.allowed(url)){event.preventDefault();}});
      const remember=()=>{clearTimeout(this.captureTimer);this.captureTimer=setTimeout(()=>this.status(this.expectedBlogId).catch(()=>{}),600);};
      this.window.webContents.on('did-finish-load',remember);this.window.webContents.on('did-frame-finish-load',remember);
      this.cookieListener=(event,cookie,cause,removed)=>{if(!removed&&/^NID_/.test(cookie.name))remember();};
      const session=this.window.webContents.session;session.cookies.on('changed',this.cookieListener);
      const window=this.window;window.on('close',()=>{this.publishVerified=false;});
      this.window.on('closed',()=>{clearTimeout(this.captureTimer);session.cookies.off('changed',this.cookieListener);this.window=null;});
    }
    if(visible)this.window.show();if(url){
      const window=this.window,signal=this.operationSignal;let timer,closed,abort;
      const interrupted=new Promise((_,reject)=>{
        const stop=error=>{try{window.webContents?.stop?.();}catch{}reject(error);};
        timer=setTimeout(()=>stop(new Error('네이버 페이지를 여는 시간이 초과되었습니다. 네트워크와 로그인 상태를 확인한 뒤 다시 시도해 주세요.')),loadTimeout);
        closed=()=>stop(new Error('네이버 창이 닫혀 작업을 중단했습니다. 준비 버튼으로 다시 열 수 있습니다.'));
        abort=()=>stop(signal.reason);window.once?.('closed',closed);
        if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
      });
      try{await Promise.race([window.loadURL(url),interrupted]);}catch(error){if(error.errno!==-3&&error.code!=='ERR_ABORTED')throw error;}
      finally{clearTimeout(timer);window.off?.('closed',closed);signal?.removeEventListener('abort',abort);}
    }return this;
  }
  allowed(url){try{const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='naver.com'||u.hostname.endsWith('.naver.com'));}catch{return false;}}
  async goto(url){if(!this.allowed(url))throw new Error('네이버 HTTPS 화면만 열 수 있습니다.');await this.open(url,{visible:false});}
  async captureLogin(status){
    if(this.switching||!this.vault||!status.connected||!this.window)return;
    const cookies=(await this.window.webContents.session.cookies.get({})).filter(c=>(c.domain==='naver.com'||c.domain.endsWith('.naver.com'))&&/^NID_/.test(c.name));
    if(!cookies.some(c=>c.name==='NID_AUT')||!cookies.some(c=>c.name==='NID_SES'))return;
    const next={cookies,blogId:status.canWrite?status.blogId:this.credentials?.blogId||status.blogId||'',canWrite:status.canWrite||!!this.credentials?.canWrite,lastVerifiedAt:new Date().toISOString()};
    this.vault.set('naver',next);this.credentials=next;
  }
  savedStatus(expectedBlogId){
    const cookies=this.credentials?.cookies||[];const saved=['NID_AUT','NID_SES'].every(name=>cookies.some(c=>c.name===name&&(!c.expirationDate||c.expirationDate*1000>Date.now())));const canWrite=saved&&this.credentials.canWrite&&(!expectedBlogId||this.credentials.blogId===expectedBlogId);
    return {available:true,connected:saved,saved,open:false,canWrite:!!canWrite,blogId:this.credentials?.blogId||'',lastVerifiedAt:this.credentials?.lastVerifiedAt,verified:this.publishVerified,reason:saved?'저장된 네이버 계정으로 작성할 수 있습니다.':'네이버 계정을 처음 연결해 주세요.'};
  }
  async naverCookies(){
    const cookies=this.window&&!this.window.isDestroyed()?await this.window.webContents.session.cookies.get({}):this.credentials?.cookies||[];
    return cookies.filter(c=>/(^|\.)naver\.com$/.test(c.domain)&&/^NID_/.test(c.name)&&(!c.expirationDate||c.expirationDate*1000>Date.now())).map(c=>({name:c.name,value:c.value,domain:c.domain,path:c.path||'/',secure:!!c.secure,httpOnly:!!c.httpOnly,expires:c.expirationDate||-1,sameSite:({no_restriction:'None',lax:'Lax',strict:'Strict'})[c.sameSite]||'Lax'}));
  }
  async changeAccount(){
    if(this.busy)throw Object.assign(new Error('진행 중인 네이버 작업이 끝난 뒤 계정을 변경해 주세요.'),{status:409});
    this.busy=true;this.switching=true;
    try{await this.open(null,{visible:false});clearTimeout(this.captureTimer);this.expectedBlogId='';this.credentials=null;this.vault?.remove('naver');await this.window.loadURL('about:blank');await this.window.webContents.session.clearStorageData({storages:['cookies','localstorage','indexdb','serviceworkers']});await this.open('https://blog.naver.com/MyBlog.naver');return await this.status('',{verify:true});}
    finally{this.switching=false;this.busy=false;}
  }
  reveal(){if(this.window&&!this.window.isDestroyed()){this.window.show();this.window.focus();}}
  async exclusive(fn,{signal,waitMs=120000}={}){
    let timer,abort,started=false,waitingError;
    const waiting=new Promise((_,reject)=>{
      const stop=error=>{waitingError=error;reject(error);};
      timer=setTimeout(()=>stop(Object.assign(new Error('앞선 네이버 작업의 대기 시간이 초과되었습니다. 진행 중인 작업을 중단한 뒤 다시 시도해 주세요.'),{status:409})),waitMs);
      abort=()=>{if(!started)stop(signal.reason||new Error('네이버 작업 대기를 중단했습니다.'));};
      if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    });
    const queued=(this.queue||Promise.resolve()).then(async()=>{
      started=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(waitingError)throw waitingError;
      signal?.throwIfAborted();
      if(this.busy)throw Object.assign(new Error('네이버 계정 변경이 진행 중입니다. 완료 후 다시 시도해 주세요.'),{status:409});
      this.busy=true;this.operationSignal=signal;try{return await fn();}finally{this.busy=false;this.operationSignal=undefined;}
    });
    this.queue=queued.catch(()=>{});
    try{return await Promise.race([queued,waiting]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async frame(selector,urlContains=''){
    if(!this.window||this.window.isDestroyed())throw Object.assign(new Error('설정에서 네이버 연결을 열고 로그인해 주세요.'),{status:401});
    this.operationSignal?.throwIfAborted();
    for(const f of this.window.webContents.mainFrame.framesInSubtree){try{if(urlContains&&f.url&&!f.url.includes(urlContains))continue;if(await this.readFrame(f,`Boolean(document.querySelector(${JSON.stringify(selector)})) && location.href.includes(${JSON.stringify(urlContains)})`))return f;}catch(error){if(this.operationSignal?.aborted)throw error;}}
    return null;
  }
  async readFrame(frame,source,timeout=5000){
    const signal=this.operationSignal,window=this.window;signal?.throwIfAborted();let timer,abort,closed;
    const interrupted=new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('네이버 화면 읽기 시간이 초과되었습니다. 다시 조회해 주세요.')),timeout);
      abort=()=>reject(signal.reason);closed=()=>reject(new Error('네이버 창이 닫혀 화면 읽기를 중단했습니다.'));
      signal?.addEventListener('abort',abort,{once:true});window?.once?.('closed',closed);
    });
    try{return await Promise.race([frame.executeJavaScript(source),interrupted]);}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);window?.off?.('closed',closed);}
  }
  async evaluate(fn,arg,{selector,urlContains='',readOnly=false,userGesture=false}={}){
    const f=selector?await this.frame(selector,urlContains):this.window?.webContents.mainFrame;
    if(!f)throw Object.assign(new Error('네이버 화면을 읽을 수 없습니다. 로그인 또는 화면 변경을 확인해 주세요.'),{status:422});
    const source=`(${fn.toString()})(${JSON.stringify(arg??null)})`;
    return readOnly?this.readFrame(f,source):f.executeJavaScript(source,userGesture);
  }
  async waitFor(selector,timeout=18000,{urlContains=''}={}){
    const start=Date.now();while(Date.now()-start<timeout){const f=await this.frame(selector,urlContains);if(f)return f;await sleep(250);}
    const login=!!this.window&&/nid\.naver\.com\/nidlogin/.test(this.window.webContents.getURL());
    const pages=(await this.snapshot().catch(()=>[]))||[];
    const details=pages.filter(p=>p&&typeof p.url==='string'&&/^https:\/\/fin\.land\.naver\.com\//.test(p.url)).map(p=>({url:p.url.split('?')[0],title:p.title,text:p.text.slice(Math.max(0,p.text.indexOf('단지정보')),Math.max(0,p.text.indexOf('단지정보'))+3000)}));
    throw Object.assign(new Error(login?'네이버 연결 창에서 로그인 또는 보안 확인을 완료해 주세요.':'네이버 화면이 준비되지 않았거나 변경되었습니다. 다시 조회하거나 직접 입력해 주세요.'),{status:login?401:422,...(details.length?{details}: {})});
  }
  async click(selector,{text,optional=false}={}){
    if(optional&&!await this.frame(selector))return false;
    if(!optional)await this.waitFor(selector);
    const start=Date.now();
    do{
      const clicked=await this.evaluate(({selector,text})=>{
        const nodes=[...document.querySelectorAll(selector)];const el=nodes.find(el=>(!text||(`${el.textContent} ${el.getAttribute('aria-label')}`).includes(text))&&el.getBoundingClientRect().width>0);
        if(!el)return false;el.click();return true;
      },{selector,text},{selector});
      if(clicked||optional)return clicked;
      await sleep(250);
    }while(Date.now()-start<10000);
    throw new Error(`네이버 편집기에서 필요한 버튼을 찾지 못했습니다 (${text||selector}).`);
  }
  async clickNative(selector,{text}={}){
    await this.waitFor(selector);const box=await this.evaluate(({selector,text})=>{const el=[...document.querySelectorAll(selector)].find(e=>(!text||((e.textContent||'')+' '+(e.getAttribute('aria-label')||'')).includes(text))&&e.getBoundingClientRect().width>0);if(!el)throw new Error('네이버 버튼을 찾지 못했습니다.');let r=el.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth)el.scrollIntoView({block:'center'});r=el.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};},{selector,text},{selector});
    await this.pointerClick(box);await sleep(120);
  }
  async clickVerifiedButton(selector){
    let frame=await this.waitFor(selector);
    const locate=selector=>{
      const button=[...document.querySelectorAll(selector)].find(e=>e.getBoundingClientRect().width>0&&!e.matches('[disabled],[aria-disabled="true"],.nvu_btn_disabled'));
      if(!button)return null;
      button.scrollIntoView({block:'nearest',inline:'nearest'});
      const rect=button.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
      return button.contains(document.elementFromPoint(x,y))?{x,y}:null;
    };
    let point=await this.readFrame(frame,`(${locate})(${JSON.stringify(selector)})`);
    while(point&&frame.parent){
      const parent=frame.parent,index=parent.frames.findIndex(child=>child.frameTreeNodeId===frame.frameTreeNodeId);
      const translate=({index,x,y})=>{
        const child=window.frames[index];
        if(!child)return null;
        const host=[...document.querySelectorAll('iframe,frame')].find(e=>e.contentWindow===child);
        if(!host)return null;
        const rect=host.getBoundingClientRect();
        x=rect.left+(host.clientLeft+x)*(rect.width/host.offsetWidth);
        y=rect.top+(host.clientTop+y)*(rect.height/host.offsetHeight);
        return document.elementFromPoint(x,y)===host?{x,y}:null;
      };
      point=await this.readFrame(parent,`(${translate})(${JSON.stringify({index,...point})})`);
      frame=parent;
    }
    if(!point)throw new Error('영상 완료 버튼의 클릭 위치를 확인하지 못했습니다. 현재 원고는 보존했습니다.');
    await this.pointerClick(point);
  }
  async pointerClick(box){const wc=this.window.webContents;wc.focus();const attached=wc.debugger.isAttached();if(!attached)wc.debugger.attach('1.3');try{await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',button:'none',buttons:0,...box});await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...box});await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...box});}finally{if(!attached)wc.debugger.detach();}}
  async text(selector,text){await this.waitFor(selector);await this.evaluate(({selector,text})=>{const node=document.querySelector(selector);const el=node.matches('[contenteditable="true"],input,textarea')?node:node.querySelector('[contenteditable="true"]')||node;el.focus();if('value'in el){const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;setter?.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}else{document.getSelection()?.selectAllChildren(el);}}, {selector,text},{selector});
    const isInput=await this.evaluate(selector=>{const el=document.querySelector(selector);return 'value'in el;},selector,{selector});
    if(!isInput){await this.focusText(selector,{last:false,selectAll:true});await this.window.webContents.insertText(text);}
  }
  async focusText(selector,{last=true,selectAll=false}={}){
    this.reveal();
    await this.click('button.se-sidebar-close-button,button.se-flayer-unified-fold-button,button[title="팝업 닫기"],button[aria-label="팝업 닫기"]',{optional:true});
    const box=await this.evaluate(({selector,last,selectAll})=>{
      const nodes=[...document.querySelectorAll(selector)].filter(e=>e.getBoundingClientRect().width>0),node=last?nodes.at(-1):nodes[0];
      if(!node)throw new Error('본문 입력란을 찾지 못했습니다.');node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();
      if(!selectAll){
        const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text,current;
        while(current=walker.nextNode())if(current.textContent.length&&current.parentElement?.getBoundingClientRect().width>0)text=current;
        if(text){const range=document.createRange();range.setStart(text,text.textContent.length);range.collapse(true);const end=[...range.getClientRects()].at(-1);
          if(end?.height>0)return {x:Math.round(Math.max(r.left+1,Math.min(end.right+1,r.right-1))),y:Math.round(end.top+end.height/2)};
        }
      }
      return {x:Math.round(r.left+r.width/2),y:Math.round(last?r.bottom-5:r.top+r.height/2)};
    },{selector,last,selectAll},{selector});
    await this.pointerClick(box);await sleep(80);
    await this.evaluate(({selector,last,selectAll})=>{const nodes=[...document.querySelectorAll(selector)].filter(e=>e.getBoundingClientRect().width>0);const node=last?nodes.at(-1):nodes[0];const el=node.closest('[contenteditable="true"]')||node.querySelector('[contenteditable="true"]');if(!el)return;el.focus();const range=document.createRange();range.selectNodeContents(node);if(!selectAll)range.collapse(false);const s=document.getSelection();s.removeAllRanges();s.addRange(range);},{selector,last,selectAll},{selector});
    if(last&&!selectAll)await this.key(process.platform==='darwin'?'ArrowDown':'End',{modifiers:[process.platform==='darwin'?'meta':'control']});
  }
  async appendParagraph(){
    this.reveal();
    const tail=await this.evaluate(()=>{document.querySelectorAll('[data-lemon-tail],[data-lemon-tail-paragraph]').forEach(e=>{delete e.dataset.lemonTail;delete e.dataset.lemonTailParagraph;});const c=[...document.querySelectorAll('.se-component:not(.se-documentTitle)')].at(-1);if(!c)return null;c.dataset.lemonTail='true';const p=c.matches('.se-text')?[...c.querySelectorAll('.se-text-paragraph')].at(-1):null;if(p)p.dataset.lemonTailParagraph='true';return {text:!!p,empty:![...p?.querySelectorAll('.__se-node')||[]].map(n=>n.textContent).join('').replace(/[\s\u200B\uFEFF]/g,'')};},null,{selector:'.se-component'});
    if(!tail)throw new Error('본문 끝 입력 위치를 찾지 못했습니다.');
    if(tail.text){
      await this.focusText('[data-lemon-tail-paragraph="true"]',{last:false});
      // The pointer must land at the final character: SmartEditor remembers
      // that position even when a programmatic DOM selection moves elsewhere.
      await this.key('End');
      if(!tail.empty)await this.key('Return');
    }
    else{
      const cite=await this.evaluate(()=>!!document.querySelector('[data-lemon-tail="true"] .se-cite .se-text-paragraph'),null,{selector:'.se-component'});
      if(cite){await this.focusText('[data-lemon-tail="true"] .se-cite .se-text-paragraph',{last:false});await this.key('End');await this.key('ArrowDown',{modifiers:[process.platform==='darwin'?'meta':'control']});await this.key('ArrowDown');await this.key('Return');}
      else{await this.clickNative('[data-lemon-tail="true"] .se-component-content');await this.key('ArrowDown');await this.key('Return');}
    }
    await this.evaluate(()=>{document.querySelectorAll('[data-lemon-tail],[data-lemon-tail-paragraph]').forEach(c=>{delete c.dataset.lemonTail;delete c.dataset.lemonTailParagraph;});},null,{selector:'.se-component'});
    const until=Date.now()+3000;let ready=false;do{ready=await this.evaluate(()=>{const c=[...document.querySelectorAll('.se-component:not(.se-documentTitle)')].at(-1);const p=c?.matches('.se-text')?[...c.querySelectorAll('.se-text-paragraph')].at(-1):null;if(!p||[...p.querySelectorAll('.__se-node')].some(n=>n.textContent.replace(/[\s\u200B\uFEFF]/g,'')))return false;p.dataset.lemonInsertion='true';return true;},null,{selector:'.se-component'});if(ready)break;await sleep(100);}while(Date.now()<until);
    if(!ready)throw new Error('인용구·구분선·사진 뒤에 본문 입력 위치를 만들지 못했습니다.');
    await this.focusText('[data-lemon-insertion="true"]',{last:false});await this.key('End');await this.evaluate(()=>{document.querySelectorAll('[data-lemon-insertion]').forEach(p=>delete p.dataset.lemonInsertion);},null,{selector:'.se-component'});
  }
  async key(keyCode,{modifiers=[]}={}){const wc=this.window.webContents,keys={Return:['Enter',13],ArrowDown:['ArrowDown',40],End:['End',35]};if(!keys[keyCode]){for(const type of ['keyDown','keyUp'])wc.sendInputEvent({type,keyCode,modifiers});}else{const attached=wc.debugger.isAttached();if(!attached)wc.debugger.attach('1.3');try{const [key,windowsVirtualKeyCode]=keys[keyCode],mask=modifiers.reduce((n,m)=>n|({shift:8,control:2,meta:4,alt:1}[m]||0),0);await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key,code:key==='Enter'?'Enter':key,windowsVirtualKeyCode,modifiers:mask,...(key==='Enter'&&!mask?{text:'\r',unmodifiedText:'\r'}:{})});await wc.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key,windowsVirtualKeyCode,modifiers:mask});}finally{if(!attached)wc.debugger.detach();}}await sleep(80);}
  async pasteHtml(html,text){
    const saved=await snapshotClipboard();
    try{
      const before=await this.evaluate(()=>[...document.querySelectorAll('.se-component.se-text .__se-node,.se-component.se-quotation .__se-node')].map(e=>e.textContent).join('').replace(/[\s\u200B\uFEFF]/g,'').length,null,{selector:'.se-component',readOnly:true});
      await clipboard.write([new ClipboardItem({'text/plain':text,'text/html':html})]);
      this.window.webContents.focus();this.window.webContents.paste();
      const until=Date.now()+10000;let stable=0;
      do{
        this.operationSignal?.throwIfAborted();
        const inserted=await this.evaluate(({before,text})=>{
          const normal=s=>(s||'').replace(/[\s\u200B\uFEFF]/g,'');
          const all=[...document.querySelectorAll('.se-component.se-text .__se-node,.se-component.se-quotation .__se-node')].map(e=>e.textContent).join('');
          const tail=[...document.querySelectorAll('.se-component.se-text,.se-component.se-quotation')].at(-1);
          const last=[...tail?.querySelectorAll('.se-text-paragraph .__se-node')||[]].map(e=>e.textContent).join('');
          return normal(all).length>=before+normal(text).length&&normal(last).endsWith(normal(text));
        },{before,text},{selector:'.se-component',readOnly:true});
        stable=inserted?stable+1:0;if(stable===2)return;
        await sleep(150);
      }while(Date.now()<until);
      throw new Error('본문 붙여넣기 반영을 확인하지 못했습니다. 다음 사진·영상 입력을 중단하고 현재 원고를 보존했습니다.');
    }finally{if(saved.length)await clipboard.write(saved);else await clipboard.clear();}
  }
  async upload(files,trigger){
    const wc=this.window.webContents;
    if(!wc.debugger.isAttached())wc.debugger.attach('1.3');
    let listener,timer;
    try{
      if(trigger){
        await wc.debugger.sendCommand('Page.enable');await wc.debugger.sendCommand('Page.setInterceptFileChooserDialog',{enabled:true});
        const chooser=new Promise((resolve,reject)=>{listener=(event,method,params)=>{if(method==='Page.fileChooserOpened')resolve(params);};wc.debugger.on('message',listener);timer=setTimeout(()=>reject(new Error('사진 선택 입력란을 찾지 못했습니다. 네이버 화면을 확인해 주세요.')),10000);});
        await trigger();const {backendNodeId}=await chooser;clearTimeout(timer);
        if(!backendNodeId)throw new Error('네이버 사진 입력란을 확인할 수 없습니다.');
        await wc.debugger.sendCommand('DOM.setFileInputFiles',{backendNodeId,files});return;
      }
      const doc=await wc.debugger.sendCommand('DOM.getDocument',{depth:-1,pierce:true});
      const find=node=>{if(node.nodeName==='INPUT'&&node.attributes){const a=node.attributes;for(let i=0;i<a.length;i+=2)if(a[i]==='type'&&a[i+1]==='file')return node.nodeId;}for(const child of [...node.children||[],...node.shadowRoots||[],...(node.contentDocument?[node.contentDocument]:[])]){const id=find(child);if(id)return id;}return null;};
      const nodeId=find(doc.root);if(!nodeId)throw new Error('네이버 사진 업로드 입력란을 찾지 못했습니다.');
      await wc.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files});
    }finally{clearTimeout(timer);if(listener)wc.debugger.off('message',listener);if(wc.debugger.isAttached()){await wc.debugger.sendCommand('Page.setInterceptFileChooserDialog',{enabled:false}).catch(()=>{});wc.debugger.detach();}}
  }
  async watchDialog(pattern){
    const debuggerApi=this.window.webContents.debugger,attached=debuggerApi.isAttached();if(!attached)debuggerApi.attach('1.3');
    const state={message:'',close:()=>{debuggerApi.off('message',listener);if(!attached&&debuggerApi.isAttached())debuggerApi.detach();}};
    const listener=(event,method,params)=>{if(method==='Page.javascriptDialogOpening'&&pattern.test(params.message||'')){state.message=params.message;debuggerApi.sendCommand('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});}};
    try{await debuggerApi.sendCommand('Page.enable');debuggerApi.on('message',listener);return state;}catch(error){state.close();throw error;}
  }
  async snapshot(){
    if(!this.window)return null;
    const frames=[];for(const f of this.window.webContents.mainFrame.framesInSubtree){try{frames.push(await this.readFrame(f,`({url:location.href,title:document.title,text:document.body.innerText.slice(0,12000)})`));}catch{if(this.operationSignal?.aborted)throw this.operationSignal.reason;}}return frames;
  }
  async status(expectedBlogId='',{verify=false}={}){
    this.expectedBlogId=expectedBlogId;
    if(!this.window||this.window.isDestroyed())return this.savedStatus(expectedBlogId);
    try{
      const evidence=[];
      for(const frame of this.window.webContents.mainFrame.framesInSubtree){
        try{evidence.push(await this.readFrame(frame,`(() => {
          const links=[...document.querySelectorAll('a')];
          const write=links.find(a=>/PostWriteForm|\\/postwrite|Redirect=Write/.test(a.href)||a.textContent.trim()==='글쓰기');
          const href=write?.href||'';const query=href.match(/[?&]blogId=([^&]+)/);const path=href.match(/blog\\.naver\\.com\\/([^/?#]+)\\/(?:postwrite)|blog\\.naver\\.com\\/([^/?#]+)\\?Redirect=Write/i);
          const editor=!!document.querySelector('.se-title-text')&&!!document.querySelector('[contenteditable="true"]');
          const editorId=editor?(location.href.match(/blog\\.naver\\.com\\/([^/?#]+)\\/postwrite/i)?.[1]||new URL(location.href).searchParams.get('blogId')||''):'';
          const loginPage=/nid\\.naver\\.com\\/nidlogin/.test(location.href);
          const signedIn=!!write||editor||!!document.querySelector('.gnb_name')||links.some(a=>/nidlogout|로그아웃/.test(a.href+' '+a.textContent));
          const pageId=location.href.match(/[?&]blogId=([^&]+)/)?.[1]||(/blog\\.naver\\.com\\/([^/?#]+)(?:[/?#]|$)/i.exec(location.href)?.[1]||'');
          return {blogId:query?.[1]||path?.[1]||path?.[2]||editorId||(write&&!/^(?:MyBlog\\.naver|PostView\\.naver|PostList\\.naver)$/i.test(pageId)?pageId:'')||'',connected:signedIn&&!loginPage,canWrite:!!write||editor,loginPage};
        })()`));}catch{}
      }
      const cookies=await this.window.webContents.session.cookies.get({});
      const authenticated=['NID_AUT','NID_SES'].every(name=>cookies.some(c=>c.name===name&&(c.domain==='naver.com'||c.domain.endsWith('.naver.com'))));
      const writable=authenticated&&evidence.find(e=>e.canWrite&&(!expectedBlogId||e.blogId===expectedBlogId));
      const connected=authenticated&&evidence.some(e=>e.connected);const blogId=writable?.blogId||evidence.find(e=>e.blogId)?.blogId||'';
      const status={available:true,open:true,connected,canWrite:!!writable,blogId,verified:this.publishVerified,reason:connected?(expectedBlogId&&!writable?'로그인은 완료되었습니다. 담당 블로그의 글쓰기 권한을 확인해 주세요.':'네이버 로그인이 확인되었습니다.'):'네이버 연결 창에서 로그인 또는 보안 확인을 완료해 주세요.'};
      if(connected)await this.captureLogin(status);
      const saved=this.savedStatus(expectedBlogId);
      const loginRequired=evidence.some(e=>e.loginPage);
      if(loginRequired&&this.credentials&&!this.switching){this.credentials=null;this.vault?.remove('naver');}
      if(!verify&&!connected&&this.credentials&&!loginRequired)return {...saved,open:true};
      return {...status,saved:!loginRequired&&saved.saved,lastVerifiedAt:this.credentials?.lastVerifiedAt};
    }catch{return {available:true,connected:false,open:true,verified:this.publishVerified,reason:'네이버 화면을 읽지 못했습니다. 연결 창에서 페이지가 열렸는지 확인해 주세요.'};}
  }
}
module.exports={BrowserBridge,snapshotClipboard};

const {BrowserWindow,clipboard,ClipboardItem,shell}=require('electron');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function snapshotClipboard(api=clipboard,Item=ClipboardItem){const items=await api.read();return Promise.all(items.filter(item=>item.types.length).map(async item=>new Item(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));}
class BrowserBridge {
  constructor({vault}={}){this.window=null;this.busy=false;this.publishVerified=false;this.vault=vault;this.credentials=vault?.get('naver')||null;this.expectedBlogId='';this.captureTimer=null;}
  get available(){return true;}
  async open(url='https://blog.naver.com/MyBlog.naver',{visible=true}={}){
    if(!this.window||this.window.isDestroyed()){
      this.window=new BrowserWindow({width:1180,height:860,show:visible,title:'네이버 · 레몬하우스 스튜디오',webPreferences:{partition:'persist:naver',nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
      if(this.credentials){for(const cookie of this.credentials.cookies||[]){const protocol=cookie.secure?'https':'http';const domain=cookie.domain.replace(/^\./,'');const {hostOnly,session,...value}=cookie;try{await this.window.webContents.session.cookies.set({...value,url:`${protocol}://${domain}${cookie.path||'/'}`});}catch{}}}
      this.window.webContents.setWindowOpenHandler(({url})=>{if(this.allowed(url)){this.window.loadURL(url);return {action:'deny'};}if(/^https:\/\//.test(url))shell.openExternal(url);return {action:'deny'};});
      this.window.webContents.on('will-prevent-unload',event=>{if(this.quitting)event.preventDefault();});
      this.window.webContents.on('will-navigate',(event,url)=>{if(!this.allowed(url)){event.preventDefault();}});
      const remember=()=>{clearTimeout(this.captureTimer);this.captureTimer=setTimeout(()=>this.status(this.expectedBlogId).catch(()=>{}),600);};
      this.window.webContents.on('did-finish-load',remember);this.window.webContents.on('did-frame-finish-load',remember);
      this.cookieListener=(event,cookie,cause,removed)=>{if(!removed&&/^NID_/.test(cookie.name))remember();};
      const session=this.window.webContents.session;session.cookies.on('changed',this.cookieListener);
      const window=this.window;let closing=false;window.on('close',event=>{if(!this.vault||closing||this.quitting)return;event.preventDefault();this.status(this.expectedBlogId).catch(()=>{}).finally(()=>{closing=true;if(!window.isDestroyed())window.close();});});
      this.window.on('closed',()=>{clearTimeout(this.captureTimer);session.cookies.off('changed',this.cookieListener);this.window=null;});
    }
    if(visible)this.window.show();if(url){try{await this.window.loadURL(url);}catch(error){if(error.errno!==-3&&error.code!=='ERR_ABORTED')throw error;}}return this;
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
  async changeAccount(){
    if(this.busy)throw Object.assign(new Error('진행 중인 네이버 작업이 끝난 뒤 계정을 변경해 주세요.'),{status:409});
    this.busy=true;this.switching=true;
    try{await this.open(null,{visible:false});clearTimeout(this.captureTimer);this.expectedBlogId='';this.credentials=null;this.vault?.remove('naver');await this.window.loadURL('about:blank');await this.window.webContents.session.clearStorageData({storages:['cookies','localstorage','indexdb','serviceworkers']});await this.open('https://blog.naver.com/MyBlog.naver');return await this.status('',{verify:true});}
    finally{this.switching=false;this.busy=false;}
  }
  reveal(){if(this.window&&!this.window.isDestroyed()){this.window.show();this.window.focus();}}
  async exclusive(fn){if(this.busy)throw Object.assign(new Error('네이버 화면에서 다른 작업이 진행 중입니다.'),{status:409});this.busy=true;try{return await fn();}finally{this.busy=false;}}
  async frame(selector,urlContains=''){
    if(!this.window||this.window.isDestroyed())throw Object.assign(new Error('설정에서 네이버 연결을 열고 로그인해 주세요.'),{status:401});
    for(const f of this.window.webContents.mainFrame.framesInSubtree){try{if(await f.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)})) && location.href.includes(${JSON.stringify(urlContains)})`))return f;}catch{}}
    return null;
  }
  async evaluate(fn,arg,{selector,urlContains=''}={}){
    const f=selector?await this.frame(selector,urlContains):this.window?.webContents.mainFrame;
    if(!f)throw Object.assign(new Error('네이버 화면을 읽을 수 없습니다. 로그인 또는 화면 변경을 확인해 주세요.'),{status:422});
    return f.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg??null)})`);
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
  async text(selector,text){await this.waitFor(selector);await this.evaluate(({selector,text})=>{const node=document.querySelector(selector);const el=node.matches('[contenteditable="true"],input,textarea')?node:node.querySelector('[contenteditable="true"]')||node;el.focus();if('value'in el){const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;setter?.call(el,text);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}else{document.getSelection()?.selectAllChildren(el);}}, {selector,text},{selector});
    const isInput=await this.evaluate(selector=>{const el=document.querySelector(selector);return 'value'in el;},selector,{selector});
    if(!isInput){await this.focusText(selector,{last:false,selectAll:true});await this.window.webContents.insertText(text);}
  }
  async focusText(selector,{last=true,selectAll=false}={}){
    this.reveal();
    const box=await this.evaluate(({selector,last})=>{const nodes=[...document.querySelectorAll(selector)].filter(e=>e.getBoundingClientRect().width>0);const node=last?nodes.at(-1):nodes[0];if(!node)throw new Error('본문 입력란을 찾지 못했습니다.');node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:Math.round(last?r.right-5:r.left+Math.min(r.width/2,20)),y:Math.round(last?r.bottom-5:r.top+r.height/2)};},{selector,last},{selector});
    const wc=this.window.webContents;wc.focus();for(const type of ['mouseDown','mouseUp'])wc.sendInputEvent({type,button:'left',clickCount:1,...box});await sleep(80);
    await this.evaluate(({selector,last,selectAll})=>{const nodes=[...document.querySelectorAll(selector)].filter(e=>e.getBoundingClientRect().width>0);const node=last?nodes.at(-1):nodes[0];const el=node.closest('[contenteditable="true"]')||node.querySelector('[contenteditable="true"]');if(!el)return;el.focus();const range=document.createRange();range.selectNodeContents(node);if(!selectAll)range.collapse(false);const s=document.getSelection();s.removeAllRanges();s.addRange(range);},{selector,last,selectAll},{selector});
    if(last&&!selectAll)await this.key(process.platform==='darwin'?'ArrowDown':'End',{modifiers:[process.platform==='darwin'?'meta':'control']});
  }
  async appendParagraph(){
    // Click the editor's empty area below the final component to create its
    // native trailing text component, including after quotes and separators.
    this.reveal();const box=await this.evaluate(()=>{const last=[...document.querySelectorAll('.se-component')].at(-1);last.scrollIntoView({block:'center'});const r=last.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.bottom+24)};},null,{selector:'.se-title-text'});
    this.window.webContents.focus();for(const type of ['mouseDown','mouseUp'])this.window.webContents.sendInputEvent({type,button:'left',clickCount:1,...box});await sleep(120);
    await this.key(process.platform==='darwin'?'ArrowDown':'End',{modifiers:[process.platform==='darwin'?'meta':'control']});await this.key('Return');
  }
  async key(keyCode,{modifiers=[]}={}){for(const type of ['keyDown','keyUp'])this.window.webContents.sendInputEvent({type,keyCode,modifiers});await sleep(80);}
  async pasteHtml(html){const saved=await snapshotClipboard();try{await clipboard.write([new ClipboardItem({'text/plain':html.replace(/<[^>]*>/g,''),'text/html':html})]);this.window.webContents.focus();this.window.webContents.paste();await sleep(400);}finally{if(saved.length)await clipboard.write(saved);else await clipboard.clear();}}
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
  async snapshot(){
    if(!this.window)return null;
    const frames=[];for(const f of this.window.webContents.mainFrame.framesInSubtree){try{frames.push(await f.executeJavaScript(`({url:location.href,title:document.title,text:document.body.innerText.slice(0,12000)})`));}catch{}}return frames;
  }
  async status(expectedBlogId='',{verify=false}={}){
    this.expectedBlogId=expectedBlogId;
    if(!this.window||this.window.isDestroyed())return this.savedStatus(expectedBlogId);
    try{
      const evidence=[];
      for(const frame of this.window.webContents.mainFrame.framesInSubtree){
        try{evidence.push(await frame.executeJavaScript(`(() => {
          const links=[...document.querySelectorAll('a')];
          const write=links.find(a=>/PostWriteForm|\\/postwrite|Redirect=Write/.test(a.href)||a.textContent.trim()==='글쓰기');
          const href=write?.href||'';const query=href.match(/[?&]blogId=([^&]+)/);const path=href.match(/blog\\.naver\\.com\\/([^/?#]+)\\/(?:postwrite)|blog\\.naver\\.com\\/([^/?#]+)\\?Redirect=Write/i);
          const editor=!!document.querySelector('.se-title-text')&&!!document.querySelector('[contenteditable="true"]');
          const editorId=editor?(location.href.match(/blog\\.naver\\.com\\/([^/?#]+)\\/postwrite/i)?.[1]||new URL(location.href).searchParams.get('blogId')||''):'';
          const loginPage=/nid\\.naver\\.com\\/nidlogin/.test(location.href);
          const signedIn=!!write||editor||!!document.querySelector('.gnb_name')||links.some(a=>/nidlogout|로그아웃/.test(a.href+' '+a.textContent));
          return {blogId:query?.[1]||path?.[1]||path?.[2]||editorId||'',connected:signedIn&&!loginPage,canWrite:!!write||editor,loginPage};
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
  async close(){this.window?.close();}
}
module.exports={BrowserBridge,snapshotClipboard};

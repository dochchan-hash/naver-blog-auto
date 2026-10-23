import {completionRows} from '../shared/completion-templates.mjs';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {Store} from './store.mjs';
import {Assets} from './assets.mjs';
import {Templates} from './templates.mjs';
import {cafeScopeCurrent} from '../shared/template-fields.mjs';
import {Auth,memoryVault} from './auth.mjs';
import {AI} from './ai.mjs';
import {Jobs,checkCancelled} from './jobs.mjs';
import {Naver} from './naver.mjs';
import {PHASES,CASE_SPACES,COMPLETION_SPACES,photoSpaces,styleKey,exportHtml,bodyText,validateNaverUrl,draftWarnings} from '../shared/domain.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// https://fetch.spec.whatwg.org/#port-blocking
const blockedBrowserPorts=new Set([0,1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080]);
const complex=z.object({name:z.string(),region:z.string(),url:z.string(),text:z.string(),types:z.array(z.string()),images:z.array(z.object({label:z.string(),url:z.string()})),supplyArea:z.string(),exclusiveArea:z.string(),selectedType:z.string(),notice:z.string()});
const site=z.object({name:z.string(),region:z.string(),type:z.string(),supplyArea:z.string(),exclusiveArea:z.string(),sourceUrl:z.string(),details:complex.optional(),floorplanAssetId:z.string().optional()});
const textFormat=z.object({fontFamily:z.string().regex(/^[a-z][a-z0-9]*$/),fontSize:z.number().min(8).max(72),fontWeight:z.number().min(100).max(900),color:z.string().regex(/^(?:#[a-fA-F0-9]{3,8}|rgba?\([0-9., %]+\)|transparent)$/),backgroundColor:z.string().regex(/^(?:#[a-fA-F0-9]{3,8}|rgba?\([0-9., %]+\)|transparent)$/),align:z.enum(['left','center','right','justify'])});
const formatProfile=z.object({postType:z.enum(['recommendation','case','completion']).optional(),photoLayouts:z.record(z.string(),z.array(z.enum(['default','collage','slide']))).optional(),body:textFormat,heading:textFormat,quote:textFormat,quoteVariant:z.string().regex(/^(?:default|quotation_[a-z_]+)$/),dividerVariant:z.string().regex(/^(?:default|line[1-9])$/),spaceOrder:z.array(z.enum([...new Set([...CASE_SPACES,...COMPLETION_SPACES]),'표지','작은방','욕실','기타'])),dividerAfterOutro:z.boolean(),textStyles:z.record(z.string(),z.array(textFormat)).optional(),headingStyles:z.record(z.string(),textFormat).optional(),headingTextStyles:z.record(z.string(),z.array(textFormat)).optional(),headingVariants:z.record(z.string(),z.string().regex(/^(?:default|quotation_[a-z_]+)$/)).optional(),introLead:z.boolean().optional(),introQuote:z.boolean().optional(),headingKind:z.enum(['text','quote']).optional(),headingQuoteVariant:z.string().regex(/^(?:default|quotation_[a-z_]+)$/).optional(),introDividerVariant:z.string().regex(/^(?:default|line[1-9])$/).optional(),sectionDividerVariant:z.string().regex(/^(?:default|line[1-9])$/).optional(),outroDividerVariant:z.string().regex(/^(?:default|line[1-9])$/).optional(),closingDividerVariant:z.string().regex(/^(?:default|line[1-9])$/).optional()});
const block=z.object({layout:z.enum(['collage','slide']).optional(),id:z.string(),kind:z.enum(['text','photos','heading','quote','divider','map','video']),text:z.string().optional(),assetIds:z.array(z.string()).optional(),space:z.string().optional(),formatRole:z.enum(['lead','intro','closing','outro','point','pointBody','contact']).optional(),variant:z.string().regex(/^(?:default|line[1-9]|quotation_[a-z_]+)$/).optional()});
const fact=z.object({id:z.string(),space:z.string(),item:z.string(),sourceAssetId:z.string().optional(),page:z.number().int().positive().optional(),sourceLabel:z.string(),confirmed:z.boolean(),uncertain:z.boolean()});
const templateColor=z.string().regex(/^(?:#[a-fA-F0-9]{6}|transparent)$/);
const completionEdit=z.object({text:z.string().max(12000).optional(),photoId:z.string().max(100).optional(),visible:z.boolean().optional(),x:z.number().min(-20000).max(20000).optional(),y:z.number().min(-20000).max(20000).optional(),scale:z.number().min(.1).max(4).optional(),zoom:z.number().min(1).max(6).optional(),cropX:z.number().min(-100).max(100).optional(),cropY:z.number().min(-100).max(100).optional(),fontSize:z.number().min(8).max(300).optional(),fontFamily:z.string().max(100).optional(),fontWeight:z.number().min(100).max(900).optional(),color:templateColor.optional(),align:z.enum(['left','center','right']).optional(),width:z.number().min(1).max(12000).optional(),height:z.number().min(1).max(12000).optional()}).strict();
const completionOverlay=completionEdit.extend({id:z.string().min(1).max(100),text:z.string().max(12000),x:z.number().min(0).max(20000),y:z.number().min(0).max(20000),width:z.number().min(1).max(12000),height:z.number().min(1).max(12000),backgroundColor:templateColor.optional()});
const projectSchema=z.object({completionVideoId:z.string().optional(),cafeTargetUrl:z.string().max(500).optional(),cafeBoardUrl:z.string().max(1000).optional(),completionTemplates:z.array(z.object({id:z.string().min(1),name:z.string().max(200),position:z.enum(['cover','scope','beforeAfter','space','closing']),space:z.string().max(100),templateId:z.string(),text:z.string().max(12000),photoIds:z.array(z.string()).max(100),layoutId:z.string().max(100).optional(),edits:z.record(z.string().max(100),completionEdit).optional(),overlays:z.array(completionOverlay).max(50).optional(),removedRows:z.array(z.string().max(100)).max(50).optional(),markers:z.array(z.object({number:z.number().int().min(1).max(5),x:z.number().min(0).max(20000),y:z.number().min(0).max(20000)}).strict()).max(5).optional()}).strict()).max(100).optional(),templateEdits:z.object({coverTitle:z.string().max(300),coverConcept:z.string().max(300),location:z.string().max(300),area:z.string().max(100),concept:z.string().max(300),wall:z.string().max(2000),floor:z.string().max(2000),other:z.string().max(12000),scopeProject:z.string().max(300),scopeCopyright:z.string().max(300)}).partial().strict().optional(),cafeScope:z.object({readVersion:z.literal(2).optional(),signature:z.string(),imageUrls:z.array(z.string().url()).max(20),checkedAt:z.string(),location:z.string().max(300),area:z.string().max(100),concept:z.string().max(300),scopeProject:z.string().max(300).optional(),scopeCopyright:z.string().max(300).optional(),rows:z.array(z.object({label:z.string().max(300),value:z.string().max(4000),field:z.enum(['wall','floor','other'])})).max(100),warnings:z.array(z.string())}).nullable().optional(),templateWarning:z.string().max(2000).optional(),id:z.string(),postType:z.enum(['recommendation','case','completion']).default('recommendation'),category:z.string().max(100).optional(),revision:z.number().int().nonnegative(),name:z.string(),phase:z.enum(PHASES),original:site,target:site,manualWork:z.string(),cafeUrl:z.string(),sourceText:z.string(),concept:z.string(),keywords:z.array(z.object({term:z.string(),min:z.number().int().min(0).max(100),max:z.number().int().min(0).max(100)}).refine(k=>k.min<=k.max)),title:z.string(),blocks:z.array(block),tags:z.array(z.string()),facts:z.array(fact),comparison:z.object({summary:z.string(),similarities:z.array(z.string()),differences:z.array(z.string()),unknowns:z.array(z.string()),reviewed:z.boolean()}).nullable(),coverAssetId:z.string().optional(),coverTemplateId:z.string().optional(),scopeTemplateId:z.string().optional(),templatePhotoId:z.string().optional(),questionQuote:z.enum(['none','middle','end']).default('none'),questionQuoteCount:z.number().int().min(1).max(10).default(1),publishMode:z.enum(['review','automatic']),visibility:z.enum(['public','private']).default('public'),scheduleAt:z.string().refine(s=>!s||Number.isFinite(Date.parse(s))),updatedAt:z.string(),createdAt:z.string(),draftStatus:z.string(),generationWarnings:z.array(z.string()),lastJobId:z.string().optional(),draftSourceSignature:z.string().optional(),formatProfile:formatProfile.optional(),sourceReview:z.object({signature:z.string(),checkedAt:z.string(),siteInfo:z.array(z.object({field:z.enum(["location","area","concept"]),value:z.string().max(300),evidence:z.string(),uncertain:z.boolean()})).optional(),cafeFacts:z.array(z.object({space:z.string(),item:z.string(),evidence:z.string(),uncertain:z.boolean()})),conflicts:z.array(z.object({id:z.string(),space:z.string(),topic:z.string(),constructionFactIds:z.array(z.string()),cafeFactIndexes:z.array(z.number().int().nonnegative()),reason:z.string(),decision:z.enum(['pending','construction','cafe','both','exclude','custom']),customText:z.string()})),warnings:z.array(z.string())}).nullable().optional()});
const settingsSchema=z.object({blogId:z.string().refine(s=>!s||/^[a-zA-Z0-9_-]{2,40}$/.test(s)),brand:z.string().min(1).max(100),phone:z.string().max(100),model:z.string().max(100),analysisModel:z.string().max(100),photoEdge:z.number().int().min(512).max(1600)});
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
export async function createServer({dataDir=process.env.LEMONHOUSE_DATA_DIR||path.join(root,'.local'),port=Number(process.env.LEMONHOUSE_PORT||4317),bridge=null,vault=memoryVault(),openExternal=null,onJob=null}={}) {
  const store=new Store(dataDir),assets=new Assets(store),auth=new Auth(store,vault),jobs=new Jobs(store,onJob),templates=new Templates(store,assets),naver=new Naver(store,assets,bridge),ai=new AI(store,auth,assets,naver);
  await templates.refreshCompletionStyles();
  if(!store.list('project').length)store.createProject();
  const app=express();app.disable('x-powered-by');const sessions=new Map();let baseUrl='';
  app.use((req,res,next)=>{
    const allowed=new Set([new URL(baseUrl||'http://127.0.0.1:4317').host]);
    if(!allowed.has(req.headers.host))return res.status(403).json({error:'로컬 주소로 접속해 주세요.'});
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    if(req.path.startsWith('/auth/'))return next();
    const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim().split('=')));
    let sid=cookies.lemon_session;
    if(!sid||!sessions.has(sid)){
      if(req.method!=='GET')return res.status(401).json({error:'작업 화면을 새로고침해 주세요.'});
      sid=randomBytes(24).toString('hex');sessions.set(sid,{csrf:randomBytes(32).toString('hex')});res.cookie('lemon_session',sid,{httpOnly:true,sameSite:'strict',path:'/'});
    }
    req.localSession=sessions.get(sid);
    if(!['GET','HEAD'].includes(req.method)){
      const origin=req.headers.origin;
      if(origin&&origin!==baseUrl)return res.status(403).json({error:'외부 페이지에서 보낸 요청은 허용하지 않습니다.'});
      if(req.headers['x-lemon-csrf']!==req.localSession.csrf)return res.status(403).json({error:'요청 확인에 실패했습니다. 화면을 새로고침해 주세요.'});
    }
    next();
  });
  app.use(express.json({limit:'4mb'}));
  const ensureEditable=id=>{if([...jobs.active.values()].some(j=>j.projectId===id))throw Object.assign(new Error('자동 작업이 끝난 뒤 원고를 수정해 주세요.'),{status:409});};
  app.get('/api/health',(_,res)=>res.json({ok:true,version:'0.1.0',desktop:!!bridge}));
  app.get('/api/bootstrap',asyncRoute(async(req,res)=>{if(!naver.statusPending){naver.statusPending=naver.status().catch(()=>{}).finally(()=>{naver.statusPending=null;});}return res.json({projects:store.list('project'),assets:store.assets(),style:store.get('style','main'),caseStyle:store.get('style','case'),completionStyle:store.get('style','completion'),settings:store.get('settings','main'),auth:auth.status(),browser:naver.cachedStatus||{available:!!bridge,connected:false,verified:false},jobs:store.list('job').slice(0,50),csrf:req.localSession.csrf,platform:process.platform});}));
  app.post('/api/projects',(req,res,next)=>{try{res.json(store.createProject(z.enum(['recommendation','case','completion']).default('recommendation').parse(req.body.postType)));}catch(e){next(e);}});
  app.put('/api/projects/:id',asyncRoute(async(req,res)=>{
    ensureEditable(req.params.id);const value=projectSchema.parse(req.body);if(value.formatProfile?.postType&&value.formatProfile.postType!==value.postType)throw Object.assign(new Error('해당 콘텐츠의 작성 스타일을 선택해 주세요.'),{status:400});if(value.id!==req.params.id)throw Object.assign(new Error('원고가 일치하지 않습니다.'),{status:400});
    if(value.postType==='completion'){
      for(const slot of value.completionTemplates||[]){
        const template=store.get('asset',slot.templateId),layout=template?.layouts?.find(l=>l.id===(slot.layoutId||template.layouts[0]?.id));
        if(slot.layoutId&&!layout)throw Object.assign(new Error('선택한 PSD의 레이아웃을 확인해 주세요.'),{status:400});
        const rows=layout?completionRows(layout):[];
        if(slot.removedRows?.length&&(!rows.length||slot.removedRows.some(id=>!rows.some(r=>r.id===id))||new Set(slot.removedRows).size>=rows.length))throw Object.assign(new Error('사용할 비포애프터 공간을 한 개 이상 남겨 주세요.'),{status:400});
        if(slot.markers&&(slot.position!=='space'||new Set(slot.markers.map(m=>m.number)).size!==slot.markers.length||slot.markers.some(m=>!layout?.elements.some(e=>e.kind==='photo'&&m.x>=e.x&&m.y>=e.y&&m.x+27<=e.x+e.width&&m.y+27<=e.y+e.height))))throw Object.assign(new Error('번호는 1~5를 한 번씩 사진 안에 배치해 주세요.'),{status:400});
        for(const [id,edit]of Object.entries(slot.edits||{})){
          if(!layout?.elements.some(e=>e.id===id))throw Object.assign(new Error('해당 레이아웃에 없는 항목입니다.'),{status:400});
          if(edit.photoId){const photo=store.get('asset',edit.photoId);if(photo?.projectId!==value.id||photo.role!=='photo'||photo.templateOutput)throw Object.assign(new Error('현재 현장의 원본 사진을 선택해 주세요.'),{status:400});}
        }
      }
      for(const slot of value.completionTemplates||[]){if(slot.templateId&&store.get('asset',slot.templateId)?.templateKind!=='completion')throw Object.assign(new Error('마감용 PSD 템플릿을 선택해 주세요.'),{status:400});for(const id of slot.photoIds){const a=store.get('asset',id);if(a?.projectId!==value.id||a.role!=='photo')throw Object.assign(new Error('현재 마감글의 사진을 선택해 주세요.'),{status:400});}}
      if(new Set(value.completionTemplates?.map(s=>s.id)).size!==(value.completionTemplates?.length||0))throw Object.assign(new Error('템플릿 항목이 중복되었습니다.'),{status:400});
      if(value.cafeTargetUrl)validateNaverUrl(value.cafeTargetUrl,'cafe');if(value.cafeBoardUrl)validateNaverUrl(value.cafeBoardUrl,'cafe');value.publishMode='review';
    }
    for(const b of value.blocks)for(const id of b.assetIds||[]){const a=store.get('asset',id);if(!a||a.projectId!==value.id||a.role!==(b.kind==='video'?'video':'photo'))throw Object.assign(new Error('다른 원고의 사진을 사용할 수 없습니다.'),{status:400});}
    for(const which of ['original','target'])if(value[which].floorplanAssetId){const a=store.get('asset',value[which].floorplanAssetId);if(!a||a.projectId!==value.id||a.role!==`floorplan-${which}`)throw Object.assign(new Error('해당 현장에 첨부한 도면을 선택해 주세요.'),{status:400});}
    for(const kind of ['cover','scope'])if(value[`${kind}TemplateId`]){const a=store.get('asset',value[`${kind}TemplateId`]);if(value.postType!=='case'||a?.role!=='template'||a.templateKind!==kind)throw Object.assign(new Error('해당 종류의 PSD 템플릿을 선택해 주세요.'),{status:400});}
    if(value.completionVideoId){const a=store.get('asset',value.completionVideoId);if(value.postType!=='completion'||a?.projectId!==value.id||a.role!=='video')throw Object.assign(new Error('현재 마감글의 동영상을 선택해 주세요.'),{status:400});}
    for(const key of ['coverAssetId','templatePhotoId'])if(value[key]){const a=store.get('asset',value[key]);if(a?.projectId!==value.id||a.role!=='photo'||key==='templatePhotoId'&&a.templateOutput)throw Object.assign(new Error('해당 현장에 첨부한 사진을 선택해 주세요.'),{status:400});}
    for(const b of value.blocks){if(['map','video'].includes(b.kind)&&value.postType!=='completion')throw Object.assign(new Error('지도·동영상은 카페 마감 원고에서 사용해 주세요.'),{status:400});if(b.kind==='map'&&!b.text?.trim())throw Object.assign(new Error('지도 검색어를 입력해 주세요.'),{status:400});if(b.kind==='video'&&(b.assetIds?.length!==1||!store.assets(value.id).some(a=>a.id===b.assetIds[0]&&a.role==='video')))throw Object.assign(new Error('이 원고에 첨부한 동영상을 선택해 주세요.'),{status:400});}
    if(value.sourceReview){const ids=new Set(value.facts.map(f=>f.id));if(value.sourceReview.conflicts.some(c=>c.constructionFactIds.some(id=>!ids.has(id))||c.cafeFactIndexes.some(i=>!value.sourceReview.cafeFacts[i])))throw Object.assign(new Error('자료 차이의 원문 근거를 확인해 주세요.'),{status:400});}
    const previous=store.get('project',value.id);if(previous&&(previous.postType||'recommendation')!==value.postType)throw Object.assign(new Error('게시글 종류는 새 글을 만들 때 선택해 주세요.'),{status:400});if(JSON.stringify(previous.original)!==JSON.stringify(value.original)||JSON.stringify(previous.target)!==JSON.stringify(value.target))value.comparison=null;
    res.json(store.saveProject(value,value.revision));
  }));
  app.get('/api/projects/:id/export',asyncRoute(async(req,res)=>{
    const p=store.get('project',req.params.id);if(!p)throw Object.assign(new Error('원고를 찾을 수 없습니다.'),{status:404});
    if(req.query.format==='text'){res.type('text/plain; charset=utf-8').attachment(`${p.postType||'recommendation'}.txt`).send(`${p.title}\n\n${bodyText(p)}\n\n${p.tags.map(t=>'#'+t).join(' ')}`);}
    else if(req.query.format==='json'){res.type('application/json').attachment(`${p.postType||'recommendation'}.json`).send(JSON.stringify({project:p,assets:store.assets(p.id).map(({originalPath,previewPath,pages,...a})=>({...a,pages:pages?.map(({imagePath,...page})=>page)})),style:store.get('style',styleKey(p.postType))},null,2));}
    else res.type('html').attachment(`${p.postType||'recommendation'}.html`).send(exportHtml(p,store.assets(p.id)));
  }));
  app.delete('/api/projects/:id',asyncRoute(async(req,res)=>{ensureEditable(req.params.id);if(!store.get('project',req.params.id))throw Object.assign(new Error('원고를 찾을 수 없습니다.'),{status:404});for(const asset of store.assets(req.params.id))store.remove('asset',asset.id);for(const job of store.list('job').filter(j=>j.projectId===req.params.id))store.remove('job',job.id);store.remove('project',req.params.id);if(!store.list('project').length)store.createProject();res.json({ok:true});}));
  app.post('/api/projects/:id/assets',asyncRoute(async(req,res)=>{ensureEditable(req.params.id);const asset=await assets.upload(req,req.params.id,req.query.role);res.status(201).json(asset);if(asset.role==='photo'&&req.query.classify!=='false'){const prepared=assets.queue;store.put('asset',asset.id,{...store.get('asset',asset.id),warning:'공간 자동 분류를 준비하고 있습니다.'});ai.photoQueue=(ai.photoQueue||Promise.resolve()).then(async()=>{await prepared;const ready=store.asset(asset.id);if(!ready||ready.status!=='ready')return;try{if(!auth.status().connected)throw new Error('AI 계정을 연결한 뒤 사진 분석을 눌러 주세요.');await ai.analyzeAsset(ready);}catch(e){const raw=store.get('asset',ready.id);if(raw)store.put('asset',ready.id,{...raw,warning:`자동 분류 실패: ${e.message}`});}}).catch(()=>{});}}));
  app.patch('/api/assets/batch',asyncRoute(async(req,res)=>{
    const updates=z.array(z.object({id:z.string(),space:z.string().optional(),group:z.string().optional(),order:z.number().int().nonnegative().optional(),excluded:z.boolean().optional()})).parse(req.body);
    const checked=updates.map(patch=>{const a=store.get('asset',patch.id);if(!a)throw Object.assign(new Error('사진을 찾을 수 없습니다.'),{status:404});ensureEditable(a.projectId);if(a.role!=='photo'||patch.space!==undefined&&!photoSpaces(store.get('project',a.projectId)).includes(patch.space))throw Object.assign(new Error('사진의 공간 분류를 확인해 주세요.'),{status:400});return {...a,...patch,...(patch.space?{spaceManual:true}:{})};});
    for(const a of checked)store.put('asset',a.id,a);
    res.json({assets:store.assets()});
  }));
  app.get('/api/template-font/:weight',(req,res)=>{const family=req.query.family||'freesentation',face=family==='freesentation'?{'400':'4Regular','500':'5Medium','700':'7Bold'}[req.params.weight]:family==='pretendard'?{'300':'Light','400':'Regular','500':'Medium','600':'SemiBold','700':'Bold'}[req.params.weight]:null;if(typeof face!=='string')return res.sendStatus(404);res.sendFile(path.join(root,'server','fonts',family,family==='pretendard'?'Pretendard-'+face+'.otf':'Freesentation-'+face+'.ttf'),{dotfiles:'allow'});});
  app.get('/api/assets/:id/element/:elementId',asyncRoute(async(req,res)=>{
    const template=store.get('asset',req.params.id),element=template?.layouts?.flatMap(l=>l.elements).find(e=>e.id===req.params.elementId);
    if(template?.templateKind!=='completion'||!element)throw Object.assign(new Error('PSD 항목이 없습니다.'),{status:404});
    res.type('png').sendFile(assets.resolve(template.id+'/'+element.file),{dotfiles:'allow'});
  }));
  app.get('/api/assets/:id/:variant',asyncRoute(async(req,res)=>{
    const a=store.get('asset',req.params.id);if(!a)throw Object.assign(new Error('파일을 찾을 수 없습니다.'),{status:404});
    const variant=req.params.variant;if(!['original','preview'].includes(variant))throw Object.assign(new Error('잘못된 파일 요청입니다.'),{status:400});
    const rel=variant==='original'?a.originalPath:a.previewPath;if(!rel)throw Object.assign(new Error('미리보기를 준비 중입니다.'),{status:404});
    res.type(variant==='original'?a.mime:'image/jpeg');if(variant==='original'&&a.role!=='video')res.attachment(a.filename);res.sendFile(assets.resolve(rel),{dotfiles:'allow'});
  }));
  app.get('/api/assets/:id/page/:page',asyncRoute(async(req,res)=>{const a=store.get('asset',req.params.id);const p=a?.pages?.find(p=>p.page===Number(req.params.page));if(!p?.imagePath)throw Object.assign(new Error('페이지 이미지를 찾을 수 없습니다.'),{status:404});res.type('image/jpeg').sendFile(assets.resolve(p.imagePath),{dotfiles:'allow'});}));
  app.get('/api/assets/:id/layout/:layout',asyncRoute(async(req,res)=>{const a=store.get('asset',req.params.id),layout=a?.layouts?.find(l=>l.id===req.params.layout);if(!layout)throw Object.assign(new Error('PSD 레이아웃을 찾을 수 없습니다.'),{status:404});res.type('image/jpeg').sendFile(assets.resolve(`${a.id}/${layout.previewFile}`),{dotfiles:'allow'});}));
  app.put('/api/settings',(req,res,next)=>{try{res.json(store.put('settings','main',settingsSchema.parse(req.body)));}catch(e){next(e);}});
  app.put('/api/style',(req,res,next)=>{try{const postType=z.enum(['recommendation','case','completion']).default('recommendation').parse(req.query.postType),key=styleKey(postType);const next=z.object({name:z.string().min(1),referenceUrls:z.array(z.string()),rules:z.string().min(1),formatProfile:formatProfile.optional()}).parse(req.body);next.referenceUrls.forEach(url=>validateNaverUrl(url,postType==='completion'?'cafe':'blog'));delete next.formatProfile;const previous=store.get('style',key),changed=JSON.stringify(previous.referenceUrls)!==JSON.stringify(next.referenceUrls);res.json(store.put('style',key,{...previous,...next,...(changed?{formatProfile:undefined,formatEvidence:undefined,formatCheckedAt:undefined,referenceEvidence:undefined,analyzedAt:undefined}:{}),status:changed?'reference':next.rules!==previous.rules?'edited':previous.status}));}catch(e){next(e);}});
  app.post('/api/auth/start',asyncRoute(async(req,res)=>{const url=auth.begin(baseUrl,{newAccount:!!req.body.newAccount});if(openExternal)await openExternal(url);res.json({url,opened:!!openExternal});}));
  app.get('/auth/callback',asyncRoute(async(req,res)=>{
    try{await auth.callback(req.query);res.type('html').send('<!doctype html><meta charset="utf-8"><title>연결 완료</title><body style="font-family:system-ui;padding:48px"><h1>ChatGPT 연결 완료</h1><p>레몬하우스 작업 화면으로 돌아가 주세요.</p><a href="/">작업 화면 열기</a></body>');}
    catch(e){auth.lastError=e.message;res.status(e.status||400).type('html').send('<!doctype html><meta charset="utf-8"><title>계정 연결 확인 필요</title><h1>연결을 완료하지 못했습니다.</h1><p>작업 화면의 계정 설정에서 사유를 확인하고 다시 연결해 주세요.</p><a href="/">작업 화면으로 돌아가기</a>');}
  }));
  app.post('/api/auth/disconnect',asyncRoute(async(req,res)=>{await auth.disconnect();res.json(auth.status());}));
  app.post('/api/auth/models',asyncRoute(async(req,res)=>res.json({models:await auth.models()})));
  app.post('/api/naver/login',asyncRoute(async(req,res)=>{await naver.login(store.get('settings','main').blogId);res.json(await naver.status());}));
  app.post('/api/naver/status',asyncRoute(async(req,res)=>res.json(await naver.checkConnection())));
  app.post('/api/naver/change-account',asyncRoute(async(req,res)=>res.json(await naver.changeAccount())));
  app.post('/api/naver/read-post',asyncRoute(async(req,res)=>res.json(await naver.readPost(z.string().parse(req.body.url)))));
  app.post('/api/naver/search',asyncRoute(async(req,res)=>res.json({results:await naver.searchComplex(z.string().parse(req.body.query))})));
  app.post('/api/naver/select-complex',asyncRoute(async(req,res)=>res.json(await naver.selectComplex(z.string().parse(req.body.key)))));
  app.post('/api/naver/complex',asyncRoute(async(req,res)=>res.json(await naver.readComplex(z.string().parse(req.body.url),z.string().optional().parse(req.body.type)))));
  app.post('/api/naver/floorplan',asyncRoute(async(req,res)=>res.json(await naver.importFloorplan(z.string().parse(req.body.projectId),z.enum(['floorplan-original','floorplan-target']).parse(req.body.role),z.string().parse(req.body.url)))));
  app.post('/api/projects/:id/tasks/:kind',asyncRoute(async(req,res)=>{
    if(!store.get('project',req.params.id))throw Object.assign(new Error('원고를 찾을 수 없습니다.'),{status:404});
    const task=req.params.kind;if(store.get('project',req.params.id).postType==='completion'&&['publish','verify'].includes(task))throw Object.assign(new Error('마감은 카페 편집기에 준비한 뒤 직접 검토하고 등록해 주세요.'),{status:400});const handlers={templates:async update=>{
      let sourceError;const p=store.get('project',req.params.id);
      if(p.postType==='case'&&p.scopeTemplateId&&(p.cafeUrl.trim()||p.sourceText.trim()))try{
        if((!cafeScopeCurrent(p)||p.cafeScope?.readVersion!==2)&&!auth.status().connected)throw new Error('공사범위 사진을 읽으려면 설정에서 ChatGPT 계정을 연결해 주세요.');
        await ai.readCafeScope(p.id,update);
      }catch(e){checkCancelled();sourceError=e;}
      store.updateProject(p.id,{templateWarning:sourceError?`공사범위 자동 입력 실패: ${sourceError.message}`:''});
      const result=await templates.render(p.id,update,{skipScope:!!sourceError,slotId:req.body.templateSlotId===undefined?undefined:z.string().min(1).max(100).parse(req.body.templateSlotId)});
      if(sourceError)throw Object.assign(new Error(`표지는 만들었습니다. ${sourceError.message}`),{status:sourceError.status});
      return result;
    },analyze:update=>ai.analyzeMaterials(req.params.id,update),generate:async update=>{
      const p=store.get('project',req.params.id);if((p.postType==='case'&&p.coverTemplateId||p.postType==='completion')&&draftWarnings(p,store.assets(p.id)).some(w=>/템플릿 이미지를 다시|변경 내용을 적용하고 사진칸/.test(w)))throw new Error('사진 단계에서 ‘수정 변경하기’를 눌러 이미지를 적용한 뒤 원고를 작성해 주세요.');
      const result=await ai.generate(req.params.id,update);if(result.project.publishMode!=='automatic')return result;
      const warnings=[...draftWarnings(result.project,store.assets(req.params.id)),...result.project.generationWarnings];
      if(warnings.length){store.updateProject(req.params.id,{draftStatus:'review',phase:'write'});return {...result,needsReview:true,warnings};}
      const publish=await naver.publish(req.params.id,update);return {project:store.get('project',req.params.id),publish};
    },compare:update=>ai.compare(req.params.id,update),prepare:update=>store.get('project',req.params.id).postType==='completion'?naver.prepareCafe(req.params.id,update):naver.publish(req.params.id,update,{prepareOnly:true}),publish:update=>naver.publish(req.params.id,update,{confirmReviewed:req.body.confirmReviewed===true}),verify:update=>naver.verifyPublish(req.params.id,update)};
    if(!handlers[task])throw Object.assign(new Error('지원하지 않는 작업입니다.'),{status:400});
    if(!['publish','prepare','verify','templates'].includes(task)&&!auth.status().connected)throw Object.assign(new Error('설정에서 ChatGPT 계정을 연결해 주세요.'),{status:401});
    if(['publish','prepare','verify'].includes(task))naver.requireBridge();
    if(['publish','prepare','verify'].includes(task)||req.body.expectedRevision!==undefined){const revision=z.number().int().nonnegative().parse(req.body.expectedRevision);if(store.get('project',req.params.id).revision!==revision)throw Object.assign(new Error('화면의 수정 내용과 저장된 원고가 일치하지 않습니다. 최신 원고를 확인한 뒤 다시 시도해 주세요.'),{status:409});}
    if(task==='generate'&&store.get('project',req.params.id).postType==='completion'&&store.get('project',req.params.id).publishMode==='automatic')throw Object.assign(new Error('마감글은 검토 후 카페에 작성합니다.'),{status:400});
    if(task==='generate'&&store.get('project',req.params.id).publishMode==='automatic'){naver.requireBridge();if(!store.get('settings','main').blogId)throw Object.assign(new Error('자동 발행 전에 담당 블로그를 설정해 주세요.'),{status:400});}
    res.status(202).json(jobs.start(req.params.id,task,handlers[task]));
  }));
  app.post('/api/style/analyze',asyncRoute(async(req,res)=>{if(!auth.status().connected)throw Object.assign(new Error('ChatGPT 계정을 연결해 주세요.'),{status:401});naver.requireBridge();const postType=z.enum(['recommendation','case','completion']).default('recommendation').parse(req.body.postType);res.status(202).json(jobs.start(postType==='completion'?'style-completion':postType==='case'?'style-case':'style','style',update=>ai.analyzeStyle(update,postType)));}));
  app.post('/api/style/format',asyncRoute(async(req,res)=>{naver.requireBridge();const postType=z.enum(['recommendation','case','completion']).default('recommendation').parse(req.body.postType);res.status(202).json(jobs.start(postType==='completion'?'style-completion':postType==='case'?'style-case':'style','format',update=>ai.refreshFormat(update,postType)));}));
  app.post('/api/projects/:id/publish-result',asyncRoute(async(req,res)=>{
    const input=z.object({url:z.string(),scheduled:z.boolean(),scheduleAt:z.string().optional()}).parse(req.body);const p=store.get('project',req.params.id);if(p?.postType==='completion')throw Object.assign(new Error('마감글은 블로그 등록 결과로 기록할 수 없습니다.'),{status:400});const url=validateNaverUrl(input.url,'blog');const blogId=store.get('settings','main').blogId;
    const u=new URL(url);if(!(u.pathname.startsWith(`/${blogId}/`)||u.searchParams.get('blogId')===blogId))throw Object.assign(new Error('담당 블로그의 게시글 주소를 입력해 주세요.'),{status:400});
    const key=naver.fingerprint(p,store.assets(p.id),blogId);store.put('publish',key,{fingerprint:key,projectId:p.id,blogId,status:'completed',url,scheduled:input.scheduled,scheduleAt:input.scheduleAt,verified:false,verification:'user-reported',completedAt:new Date().toISOString()});
    res.json(store.updateProject(p.id,{draftStatus:input.scheduled?'scheduled':'published'}));
  }));
  app.post('/api/jobs/:id/cancel',(req,res,next)=>{try{res.json(jobs.cancel(req.params.id));}catch(e){next(e);}});
  app.get('/api/jobs',(req,res)=>res.json(store.list('job').slice(0,50)));
  if(fs.existsSync(path.join(root,'dist','index.html'))){app.use(express.static(path.join(root,'dist'),{index:false}));app.get('/',(_,res)=>res.sendFile('index.html',{root:path.join(root,'dist')}));}
  else app.get('/',(_,res)=>res.type('html').send('<meta charset="utf-8"><p>화면을 준비하려면 npm run build를 실행해 주세요.</p>'));
  app.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const validation=error instanceof z.ZodError;
    res.status(validation?400:error.status||500).json({error:validation?'입력 형식이나 숫자 범위를 확인해 주세요.':error.message||'작업을 완료하지 못했습니다.',...(error.details?{details:error.details}:{})});
  });
  let server;
  for(let attempt=0;attempt<8;attempt++){
    server=await new Promise((resolve,reject)=>{const s=app.listen(port,'127.0.0.1',error=>error?reject(error):resolve(s));s.on('error',reject);});
    if(port!==0||!blockedBrowserPorts.has(server.address().port))break;
    await new Promise(resolve=>server.close(resolve));
    if(attempt===7)throw new Error('프로그램 화면을 열 수 있는 로컬 주소를 찾지 못했습니다. 다시 실행해 주세요.');
  }
  baseUrl=`http://127.0.0.1:${server.address().port}`;
  return {server,app,store,assets,auth,ai,jobs,naver,templates,url:baseUrl,close:async()=>{await assets.queue;await ai.photoQueue;await new Promise(r=>server.close(r));store.close();}};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){const runtime=await createServer();console.log(`레몬하우스 스튜디오: ${runtime.url}`);process.once('SIGINT',async()=>{await runtime.close();process.exit();});}

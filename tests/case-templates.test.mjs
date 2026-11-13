import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import sharp from 'sharp';import {writePsdBuffer} from 'ag-psd';import {createCanvas} from '@napi-rs/canvas';
import {createServer} from '../server/index.mjs';import {readTemplate,renderTemplate} from '../server/templates.mjs';import {AI} from '../server/ai.mjs';
import {CASE_FORMAT,blockTextStyles} from '../shared/format.mjs';import {draftWarnings,photoLayoutBlocks,publicationBlocks,publicationCategory,SPACES,newProject} from '../shared/domain.mjs';
import {templateFields,cafeScopeSignature} from '../shared/template-fields.mjs';import {templateSourceSignature} from '../shared/sources.mjs';
test('시공사례의 표지 원본은 예전 원고에서도 공사범위와 한 번만 묶고 공간별 사진에서는 뺀다',()=>{
  const p=newProject('cover-only','case');Object.assign(p,{templatePhotoId:'raw',coverAssetId:'cover',category:'30PY',title:'시공사례',keywords:[],blocks:[{id:'cover',kind:'photos',space:'표지',assetIds:['cover']},{id:'title',kind:'text',text:'INTERIOR PLAN'},{id:'scope',kind:'photos',space:'도면',assetIds:['raw','scope']},{id:'floorplan',kind:'photos',space:'도면',assetIds:['floorplan']},{id:'entrance',kind:'quote',space:'현관',text:'현관'},{id:'raw',kind:'photos',space:'현관',assetIds:['raw']},{id:'door',kind:'photos',space:'현관',assetIds:['raw','door']},{id:'body',kind:'text',space:'현관',text:'현관 설명'}]});p.original.name='시공 현장';
  const assets=[{id:'raw',role:'template-photo',space:'현관',order:0,status:'ready'},{id:'door',role:'photo',space:'현관',order:1,status:'ready'},{id:'cover',role:'photo',space:'표지',templateOutput:'cover',order:0,status:'ready'},{id:'scope',role:'photo',space:'도면',templateOutput:'scope',group:'interior-plan',order:1,status:'ready'},{id:'floorplan',role:'photo',space:'도면',templateOutput:'floorplan',group:'interior-plan',order:0,status:'ready'}];
  const scopeOnly={...p,blocks:p.blocks.map(b=>b.id==='scope'?{...b,assetIds:['scope']}:b)};
  for(const blocks of [publicationBlocks(p,assets),publicationBlocks(scopeOnly,assets),photoLayoutBlocks(p,assets)]){
    assert.deepEqual(blocks.filter(b=>b.kind==='photos').map(b=>b.assetIds),[['cover'],['raw','scope'],['floorplan'],['door']]);assert.equal(blocks.find(b=>b.space==='도면'&&b.kind==='photos').layout,'collage');assert.equal(blocks.find(b=>b.id==='body').text,'현관 설명');
  }
  assert(!draftWarnings(p,assets).some(w=>/중복 배치|사진 순서/.test(w)));
  p.blocks.push({id:'duplicate',kind:'photos',space:'현관',assetIds:['door']});assert(draftWarnings(p,assets).some(w=>w.includes('중복 배치')));
});
test('INTERIOR PLAN은 도입 본문과 구분해 원본 색·굵기·왼쪽 정렬을 적용한다',()=>{
  const plan={...CASE_FORMAT.body,color:'rgb(255, 95, 69)',fontSize:16,fontWeight:700,align:'left'},format={...CASE_FORMAT,textStyles:{intro:[{...CASE_FORMAT.body,align:'center'}],plan:[plan]}},block={kind:'text',formatRole:'intro',text:'INTERIOR PLAN'};
  assert.deepEqual(blockTextStyles(block,format),[plan]);assert.equal(blockTextStyles(block,CASE_FORMAT)[0].color,'#ff5f45');assert.equal(blockTextStyles({kind:'text',text:'시공사례 본문'},format)[0].align,'left');
});

function coverFixture(){
  const canvas=createCanvas(1000,1000),ctx=canvas.getContext('2d');ctx.fillStyle='#fafafa';ctx.fillRect(0,0,1000,1000);
  const field=(text,y)=>({name:text,left:100,top:y,right:800,bottom:y+35,text:{text,transform:[1,0,0,1,500,y+25],style:{font:{name:'MalgunGothic'},fontSize:30,fillColor:{r:34,g:34,b:34}},paragraphStyle:{justification:'center'}}});
  const photo=createCanvas(880,605);photo.getContext('2d').fillRect(0,0,880,605);
  return writePsdBuffer({width:1000,height:1000,canvas,children:[{name:'배경',left:0,top:0,canvas},{name:'메인사진',left:60,top:270,canvas:photo},field('이전 현장',110),field('이전 콘셉트',195)]});
}

test('시공사례 표지의 위치와 확대를 저장하고 원본 방향에 맞춰 같은 표지 JPG를 갱신한다',async t=>{
  const {runtime,request,upload}=await fixture(t);
  let project=runtime.store.createProject('case');
  const template=await (await upload(project.id,'template',coverFixture(),'표지.psd')).json();
  const frame=await request(`/assets/${template.id}/cover-frame`,'GET');
  assert.equal(frame.status,200);
  assert.deepEqual(await frame.json(),{width:1000,height:1000,photo:{x:60,y:270,width:880,height:605}});
  const canvas=createCanvas(600,900),ctx=canvas.getContext('2d');
  for(const [index,color] of ['#ff0000','#00ff00','#0000ff','#ffff00'].entries()){
    ctx.fillStyle=color;ctx.fillRect(index%2*300,Math.floor(index/2)*450,300,450);
  }
  const original=await sharp(canvas.toBuffer('image/png')).withMetadata({orientation:6}).jpeg().toBuffer();
  const uploaded=await upload(project.id,'template-photo',original,'세로 방향.jpg');assert.equal(uploaded.status,201);
  const photo=await uploaded.json();assert.equal(photo.role,'template-photo');
  await runtime.assets.queue;
  project=runtime.store.get('project',project.id);
  const selected=await request(`/projects/${project.id}`,'PUT',{...project,original:{...project.original,name:'위치 테스트'},templatePhotoId:photo.id});assert.equal(selected.status,200);project=await selected.json();
  const render=async()=>{await runtime.templates.render(project.id);project=runtime.store.get('project',project.id);return runtime.store.asset(project.coverAssetId);};
  const before=await render();
  assert.equal(templateSourceSignature({...project,caseCoverCrop:{zoom:1,x:0,y:0}},runtime.store.assets(project.id)),before.templateSignature);
  const invalid=await request(`/projects/${project.id}`,'PUT',{...project,caseCoverCrop:{zoom:4,x:0,y:0}});
  assert.equal(invalid.status,400);
  const crop={zoom:3,x:100,y:100};
  const saved=await request(`/projects/${project.id}`,'PUT',{...project,caseCoverCrop:crop});
  assert.equal(saved.status,200);assert.deepEqual((await saved.json()).caseCoverCrop,crop);
  assert.notEqual(templateSourceSignature(runtime.store.get('project',project.id),runtime.store.assets(project.id)),before.templateSignature);
  const after=await render();
  assert.equal(after.id,before.id);assert.notEqual(after.hash,before.hash);
  const pixel=await sharp(runtime.assets.resolve(after.originalPath)).extract({left:500,top:500,width:1,height:1}).raw().toBuffer();
  assert(pixel[2]>240&&pixel[0]<15&&pixel[1]<15,'회전 후 왼쪽 상단의 파란 영역이 들어가야 합니다.');
  assert.deepEqual(await fs.readFile(runtime.assets.resolve(photo.originalPath)),original);
  const square=await sharp(await runtime.assets.planPhotoForUpload(runtime.store.asset(photo.id))).metadata();
  assert.deepEqual([square.width,square.height],[600,600]);assert.deepEqual(await fs.readFile(runtime.assets.resolve(photo.originalPath)),original);
});

test('표지 사진 축소는 원본의 미세 입자를 평균화하고 확대된 노이즈를 만들지 않는다',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-cover-noise-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const width=6000,height=4000,data=Buffer.alloc(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const value=((x+y)%2)?112:144,i=(y*width+x)*3;data[i]=data[i+1]=data[i+2]=value;}
 const photo=path.join(dir,'original.png');await sharp(data,{raw:{width,height,channels:3}}).png().toFile(photo);
 const before=await fs.readFile(photo),project=newProject('noise','case');project.original.name='화질 확인';project.concept='밝은 공간';
 const template=readTemplate(coverFixture()),buffer=await renderTemplate(template,project,photo,[]),region={left:template.photo.left+20,top:template.photo.top+20,width:200,height:200},stats=await sharp(await sharp(buffer).extract(region).toBuffer()).stats();
 assert(stats.channels.every(c=>c.stdev<2));assert(stats.channels.every(c=>Math.abs(c.mean-128)<2));assert.deepEqual(await fs.readFile(photo),before);
});
function scopeFixture(){
  const canvas=createCanvas(1500,1500),ctx=canvas.getContext('2d');ctx.fillStyle='#fafafa';ctx.fillRect(0,0,1500,1500);
  const fields=['위치','면적','콘셉트','벽지','바닥','기타'].map((text,i)=>({name:text,left:350,top:220+i*170,right:1000,bottom:250+i*170,text:{text,boxBounds:[0,0,950,i===5?220:110],style:{font:{name:'MalgunGothic'},fontSize:30,fillColor:{r:34,g:34,b:34}}}}));
  const footer=(text,top)=>({name:text,left:850,top,right:1400,bottom:top+30,canvas:createCanvas(550,30),text:{text,style:{font:{name:'MalgunGothic'},fontSize:26,fillColor:{r:34,g:34,b:34}},paragraphStyle:{justification:'right'}}});
  return writePsdBuffer({width:1500,height:1500,canvas,children:[{name:'project info',left:0,top:0,canvas},...fields,footer('Project No. ORIGINAL',1350),footer('ⓒ 2026. LEMONHOUSE ALL rights reserved.',1420)]});
}

test('공사범위 하단 프로젝트와 저작권을 각각 바꾸거나 비우면 JPG에 반영한다',async()=>{
  const template=readTemplate(scopeFixture()),p=newProject('footer','case');p.original={...p.original,name:'현장'};
  p.cafeScope={signature:cafeScopeSignature(p),scopeProject:'Project No. ORIGINAL',scopeCopyright:'ⓒ 2025. LEMONHOUSE ALL rights reserved.',location:'',area:'',concept:'',rows:[]};
  const render=templateEdits=>renderTemplate(template,{...p,templateEdits},null,[]),before=await render({}),project=await render({scopeProject:'Project · 수정한 프로젝트'}),copyright=await render({scopeCopyright:'© 2030. 수정한 저작권'}),empty=await render({scopeProject:'',scopeCopyright:''});
  assert(!before.equals(project));assert(!before.equals(copyright));assert(!project.equals(copyright));assert(!before.equals(empty));assert.equal(template.fields.length,6);
});
test('카페 사진 원문으로 공사범위를 채우고 미리보기 수정·JPG·원고용 이미지에 동일하게 반영한다',async t=>{
  const {runtime,request,upload}=await fixture(t);let p=runtime.store.createProject('case');
  const coverPsd=coverFixture(),scopePsd=scopeFixture();
  await upload(p.id,'template',coverPsd,'표지.psd');const scopeTemplate=await (await upload(p.id,'template',scopePsd,'공사범위.psd')).json();
  await upload(p.id,'photo',await sharp({create:{width:900,height:600,channels:3,background:'#92b4cf'}}).jpeg().toBuffer(),'거실.jpg');await runtime.assets.queue;await runtime.ai.photoQueue;
  assert.equal(runtime.store.assets(p.id).filter(a=>a.templateOutput).length,0);assert.equal(runtime.store.list('job').length,0);
p=runtime.store.updateProject(p.id,{original:{...p.original,name:'테스트 시공 현장'},cafeUrl:'https://cafe.naver.com/site/123',category:'30PY'});
  runtime.auth.status=()=>({connected:true});let reads=0,analyses=0;
  runtime.ai.browser.readPost=async()=>{reads++;return {images:['https://cafefiles.pstatic.net/scope.jpg'],scopeImages:['https://cafefiles.pstatic.net/scope.jpg'],text:'경상남도 양산시 물금읍 삽량로 30 · 11평 · 화이트 우드. 개나리 로하스 실크벽지를 도배해보세요. 강마루를 시공했습니다. 싱크볼과 조명 교체를 추천드립니다.'};};
  runtime.ai.cafeImage=async()=> 'data:image/jpeg;base64,AA';
  runtime.ai.call=async(instructions,content)=>{analyses++;assert(content.some(c=>c.type==='input_image'));return {location:'경상남도 양산시 물금읍 삽량로 30',area:'11PY',concept:'화이트 우드',scopeProject:'Project No. 12AB3456_7890C1234',scopeCopyright:'ⓒ 2025. LEMONHOUSE ALL rights reserved.',rows:[{label:'도배',value:'전체 개나리 로하스 실크벽지',field:'wall'},{label:'바닥',value:'강마루 시공',field:'floor'},{label:'가구',value:'싱크볼과 조명 교체',field:'other'},{label:'기타',value:'방충망 교체',field:'other'}],warnings:[]};};
  const run=async()=>{const response=await request(`/projects/${p.id}/tasks/templates`,'POST',{expectedRevision:runtime.store.get('project',p.id).revision});assert.equal(response.status,202);const job=await response.json();while(runtime.jobs.active.size)await new Promise(r=>setTimeout(r,20));p=runtime.store.get('project',p.id);return runtime.store.get('job',job.id);};
  assert.equal((await run()).status,'completed');assert.equal(reads,1);assert.equal(analyses,1);let fields=templateFields(p,runtime.store.assets(p.id));assert.equal(fields.area,'11PY');assert.match(fields.location,/삽량로 30/);assert.equal(fields.coverConcept,'화이트 우드');assert.match(fields.wall,/개나리/);assert.match(fields.floor,/강마루/);assert.match(fields.other,/싱크볼/);assert(!fields.other.includes('없는 타일'));
  const cover=runtime.store.asset(p.coverAssetId),scope=runtime.store.assets(p.id).find(a=>a.templateOutput==='scope'),oldScopeHash=scope.hash;
  assert.equal(scope.templateSignature,templateSourceSignature(p,runtime.store.assets(p.id)));assert.equal(cover.templateSignature,scope.templateSignature);
  const edits={coverTitle:'수정한 표지 제목',scopeProject:'Project · 수정 현장',scopeCopyright:'© 2030. 수정 저작권',other:'필름 시공\n싱크볼 교체\nLED 조명 교체'};let response=await request(`/projects/${p.id}`,'PUT',{...p,templateEdits:edits});assert.equal(response.status,200);p=await response.json();assert.deepEqual(p.templateEdits,edits);assert(draftWarnings(p,runtime.store.assets(p.id)).some(w=>w.includes('템플릿')));
  assert.equal(p.cafeScope.scopeProject,'Project No. 12AB3456_7890C1234');assert.equal(p.cafeScope.scopeCopyright,'ⓒ 2025. LEMONHOUSE ALL rights reserved.');
  runtime.auth.status=()=>({connected:false});
  assert.equal((await run()).status,'completed');assert.equal(reads,1);assert.equal(analyses,1);assert.equal(templateFields(p,runtime.store.assets(p.id)).other,edits.other);assert.notEqual(runtime.store.asset(scope.id).hash,oldScopeHash);assert.notEqual(runtime.store.asset(cover.id).hash,cover.hash);assert.equal(p.coverAssetId,cover.id);assert.deepEqual(await fs.readFile(runtime.assets.resolve(scopeTemplate.originalPath)),scopePsd);
  const modifiedHash=runtime.store.asset(scope.id).hash;p=runtime.store.updateProject(p.id,{templateEdits:{}});assert.equal((await run()).status,'completed');assert.equal(runtime.store.asset(scope.id).hash,oldScopeHash);assert.notEqual(modifiedHash,oldScopeHash);
  p=runtime.store.updateProject(p.id,{cafeUrl:'https://cafe.naver.com/site/456',sourceText:'',sourceReview:null});const disconnected=await run();assert.equal(disconnected.status,'failed');assert.match(disconnected.message,/ChatGPT/);assert.equal(reads,1);runtime.auth.status=()=>({connected:true});runtime.ai.browser.readPost=async()=>{throw new Error('카페 로그인 실패');};const failed=await run();assert.equal(failed.status,'failed');assert.match(failed.message,/표지는 만들었습니다.*카페 로그인 실패/);assert.match(p.templateWarning,/카페 로그인 실패/);assert.equal(runtime.store.asset(p.coverAssetId).status,'ready');assert(draftWarnings(p,runtime.store.assets(p.id)).some(w=>w.includes('자동 입력 실패')));
  p=runtime.store.updateProject(p.id,{cafeUrl:'',sourceText:'',sourceReview:null,templateEdits:{other:'매우 긴 시공내용'.repeat(500)}});assert.equal((await run()).status,'failed');assert.match(p.templateWarning,/내용이 너무 깁니다/);assert.equal(runtime.store.asset(p.coverAssetId).status,'ready');
});
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-case-')),runtime=await createServer({dataDir:dir,port:0});t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});const init=await fetch(runtime.url+'/api/bootstrap'),data=await init.json(),cookie=init.headers.get('set-cookie').split(';')[0],headers={cookie,'X-Lemon-CSRF':data.csrf,Origin:runtime.url,'Content-Type':'application/json'};
  const request=(url,method,body)=>fetch(runtime.url+'/api'+url,{method,headers,body:JSON.stringify(body)});
  const upload=async(id,role,bytes,name)=>{const form=new FormData();form.append('file',new Blob([bytes]),name);return fetch(runtime.url+`/api/projects/${id}/assets?role=${role}`,{method:'POST',headers:{cookie,'X-Lemon-CSRF':data.csrf,Origin:runtime.url},body:form});};
  return {runtime,data,cookie,request,upload};
}
test('시공사례와 추천글의 보관·스타일·공간·카테고리를 분리한다',async t=>{
  const site={name:'양산 물금읍 범어리 디온플레이스',region:'양산 물금읍',type:'11평'};assert.equal(templateFields({original:site,concept:'',manualWork:'',sourceText:'',cafeUrl:'',facts:[]},[]).coverTitle,site.name+' 11PY');
  const {runtime,data,request}=await fixture(t),page=await fetch(runtime.url+'/');assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);
  const res=await request('/projects','POST',{postType:'case'}),p=await res.json();assert.equal(p.postType,'case');assert.equal(publicationCategory(data.projects[0]),'추천 인테리어');assert.equal(publicationCategory({...p,category:'30PY'}),'30PY');assert.equal(data.caseStyle.referenceUrls.length,5);
  const style={name:'시공사례 양식',rules:'시공사례 본문 규칙',referenceUrls:[]};assert.equal((await request('/style?postType=case','PUT',style)).status,200);assert.notEqual(runtime.store.get('style','main').name,style.name);assert.equal(runtime.store.get('style','case').name,style.name);
  assert.equal((await request(`/projects/${p.id}`,'PUT',{...p,postType:'recommendation'})).status,400);
  runtime.store.put('asset','case-photo',{id:'case-photo',projectId:p.id,role:'photo',space:'거실'});assert.equal((await request('/assets/batch','PATCH',[{id:'case-photo',space:'복도'}])).status,200);assert.equal((await request('/assets/batch','PATCH',[{id:'case-photo',space:'없는 공간'}])).status,400);
  runtime.store.put('asset','rec-photo',{id:'rec-photo',projectId:data.projects[0].id,role:'photo',space:'거실'});assert.equal((await request('/assets/batch','PATCH',[{id:'rec-photo',space:'복도'}])).status,400);assert.equal(SPACES.length,15);
});
test('포토샵 없이 PSD·사진을 등록하고 JPG 미리보기·다운로드·표지를 갱신하며 원본을 보존한다',async t=>{
  const {runtime,data,request,upload,cookie}=await fixture(t);let p=await (await request('/projects','POST',{postType:'case'})).json();const psd=coverFixture();assert.equal(readTemplate(psd).kind,'cover');
  assert.equal((await upload(data.projects[0].id,'template',psd,'표지.psd')).status,400);assert.equal((await upload(p.id,'photo',psd,'위장.jpg')).status,400);assert.equal((await upload(p.id,'template',Buffer.from('not a PSD'),'위장.psd')).status,400);
  const uploaded=await upload(p.id,'template',psd,'시공사례 표지.psd');assert.equal(uploaded.status,201);const template=await uploaded.json();assert.equal(template.templateKind,'cover');assert.equal(template.projectId,'templates');
  const photoBytes=await sharp({create:{width:1600,height:900,channels:3,background:'#92b4cf'}}).jpeg().toBuffer(),photo=await (await upload(p.id,'photo',photoBytes,'현장.jpg')).json();await runtime.assets.queue;await runtime.ai.photoQueue;
  p=runtime.store.get('project',p.id);p=await (await request(`/projects/${p.id}`,'PUT',{...p,original:{...p.original,name:'현재 아파트'},concept:'화이트와 우드',category:'30PY',templatePhotoId:photo.id,keywords:[]})).json();
  const rendered=await request(`/projects/${p.id}/tasks/templates`,'POST',{expectedRevision:p.revision});assert.equal(rendered.status,202);const job=await rendered.json();while(runtime.jobs.active.size)await new Promise(r=>setTimeout(r,20));assert.equal(runtime.store.get('job',job.id).status,'completed');
  p=runtime.store.get('project',p.id);let cover=runtime.store.asset(p.coverAssetId);assert.equal(cover.templateOutput,'cover');assert.equal(cover.status,'ready');assert(!draftWarnings(p,runtime.store.assets(p.id)).some(w=>w.includes('템플릿')));
  const jpg=await fetch(runtime.url+cover.originalUrl,{headers:{cookie}}),buffer=Buffer.from(await jpg.arrayBuffer());assert.match(jpg.headers.get('content-type'),/image\/jpeg/);const dimensions=await sharp(buffer).metadata();assert.equal(dimensions.width,1000);assert.equal(dimensions.height,1000);const pixel=await sharp(buffer).extract({left:500,top:500,width:1,height:1}).raw().toBuffer();assert(Math.abs(pixel[0]-146)<5);
  assert.deepEqual(await fs.readFile(runtime.assets.resolve(template.originalPath)),psd);assert.deepEqual(await fs.readFile(runtime.assets.resolve(photo.originalPath)),photoBytes);
  const oldHash=cover.hash,oldUrl=cover.previewUrl;runtime.store.updateProject(p.id,{original:{...p.original,name:'수정한 아파트'}});assert(draftWarnings(runtime.store.get('project',p.id),runtime.store.assets(p.id)).some(w=>w.includes('템플릿')));await runtime.templates.render(p.id);cover=runtime.store.asset(p.coverAssetId);assert.notEqual(cover.hash,oldHash);assert.notEqual(cover.previewUrl,oldUrl);assert.equal(runtime.store.assets(p.id).filter(a=>a.templateOutput==='cover').length,1);
  const next=runtime.store.createProject('case');assert.equal(next.coverTemplateId,template.id);assert.equal((await request(`/projects/${p.id}`,'DELETE',{})).status,200);assert(runtime.store.get('asset',template.id),'공유 템플릿은 원고 삭제 후에도 남습니다.');
});
test('시공사례 원고는 편집 표지·콘셉트·소개·도면·공간 제목·사진·설명 순서이고 사진 재배치에도 유지한다',async t=>{
  const {runtime}=await fixture(t),p=runtime.store.createProject('case');runtime.store.updateProject(p.id,{original:{...p.original,name:'실제 시공 현장'},category:'30PY',coverAssetId:'cover',keywords:[]});runtime.store.put('style','case',{status:'edited',referenceUrls:[],rules:'실제 현장을 소개하세요.',formatProfile:CASE_FORMAT});
  for(const [order,space]of ['표지','도면','현관','복도'].entries())runtime.store.put('asset',space==='표지'?'cover':space,{id:space==='표지'?'cover':space,projectId:p.id,role:'photo',space,order,status:'ready',hash:space,analysis:{description:'밝은 공간'}});
  const ai=new AI(runtime.store,{}, {},{});ai.analyzeMaterials=async()=>{};ai.call=async(_,content)=>{const context=JSON.parse(content[0].text);assert.deepEqual(context.expectedSpaces,['현관','복도']);return {title:'실제 시공 현장 시공사례',summary:'화이트와 우드의 편안한 집',intro:'시공 현장을 소개합니다.',sections:context.expectedSpaces.map(space=>({space,text:'차분한 자재가 공간을 편안하게 만듭니다.\n생활에 어울리는 배치를 추천드립니다.'})),outro:'감사합니다.',tags:[],warnings:[]};};
  const {project}=await ai.generate(p.id,()=>{}),blocks=project.blocks;assert.equal(blocks[0].assetIds[0],'cover');assert.equal(blocks[1].kind,'quote');assert.equal(blocks[2].formatRole,'intro');assert.equal(blocks[3].text,'INTERIOR PLAN');assert.equal(blocks[4].space,'도면');assert.equal(blocks[5].text,'ENTRANCE\n현관 인테리어');assert.equal(blocks[6].kind,'photos');assert.equal(blocks[7].kind,'text');assert.equal(blocks.at(-3).formatRole,'closing');assert.equal(blocks.at(-2).kind,'divider');assert.equal(blocks.at(-1).formatRole,'outro');assert.equal(blockTextStyles(blocks[5],CASE_FORMAT)[1].fontSize,13);
  const relayout=photoLayoutBlocks(project,runtime.store.assets(p.id));assert.equal(relayout.findIndex(b=>b.space==='도면'),4);assert(!draftWarnings(project,runtime.store.assets(p.id)).some(w=>/사진 순서|공간 설명/.test(w)));
});
test('시공사례는 입력한 카페 링크를 불러온 원본과 시공사례 스타일로 작성하고 읽기 실패 시 기존 원고를 보존한다',async t=>{
  const {runtime}=await fixture(t),p=runtime.store.createProject('case'),url='https://cafe.naver.com/construction/123',text='주방 상부장을 철거하고 화이트 가구를 설치했습니다. 우드 선반을 추천드립니다.';
  runtime.store.updateProject(p.id,{original:{...p.original,name:'현재 시공 현장'},cafeUrl:url,keywords:[],category:'30PY'});
  runtime.store.put('style','case',{rules:'시공사례만의 문체 규칙',status:'edited',referenceUrls:[],formatProfile:CASE_FORMAT});runtime.store.put('style','main',{rules:'추천글만의 문체 규칙',status:'edited',referenceUrls:[]});
  runtime.store.put('asset','kitchen',{id:'kitchen',projectId:p.id,role:'photo',space:'주방',order:0,status:'ready',hash:'photo',analysis:{description:'화이트 주방'}});
  const reads=[],ai=new AI(runtime.store,{}, {},{readPost:async request=>(reads.push(request),{text})});let calls=0;
  ai.call=async(instructions,content)=>{const input=JSON.parse(content[0].text);if(instructions.includes('공간별 시공 분류'))return {items:[{space:'주방',item:'화이트 가구 설치',sourceIds:['fact:0'],photoIds:['kitchen']}],warnings:[]};if(instructions.includes('본문 시공 대조'))return {checks:[{workId:'work-1',blockId:input.blocks.find(b=>b.space==='주방').id,quote:'화이트 가구로 정돈된 인상을 완성했습니다.'}],issues:[]};calls++;if(instructions.includes('cafeFacts'))return {cafeFacts:[{space:'주방',item:'화이트 가구 설치',evidence:'화이트 가구를 설치했습니다',uncertain:false}],conflicts:[],warnings:[]};assert.match(instructions,/시공사례만의 문체 규칙/);assert(!instructions.includes('추천글만의 문체 규칙'));assert.match(instructions,/카페 마감글 원본/);assert.equal(JSON.parse(content[0].text).cafeSource,text);return {title:'현재 시공 현장 시공사례',summary:'화이트와 우드의 조화',intro:'시공 현장을 소개합니다.',sections:[{space:'주방',text:'화이트 가구로 정돈된 인상을 완성했습니다.\n우드 선반이 따뜻한 분위기를 더합니다.'}],outro:'감사합니다.',tags:[],warnings:[]};};
  const result=await ai.generate(p.id,()=>{});assert.deepEqual(reads,[url]);assert.equal(calls,2);assert.equal(result.project.sourceText,text);
  await ai.generate(p.id,()=>{});assert.equal(reads.length,1,'확인한 원본 본문은 다시 읽어 덮어쓰지 않습니다.');const blocks=runtime.store.get('project',p.id).blocks;
  runtime.store.updateProject(p.id,{cafeUrl:'https://cafe.naver.com/construction/456',sourceText:''});ai.browser.readPost=async()=>({text:''});await assert.rejects(ai.generate(p.id,()=>{}),/카페 마감글 본문을 읽지 못/);assert.equal(calls,3);assert.deepEqual(runtime.store.get('project',p.id).blocks,blocks);
});

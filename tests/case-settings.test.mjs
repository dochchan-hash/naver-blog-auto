import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import ts from 'typescript';
import {newProject} from '../shared/domain.mjs';
import * as domain from '../shared/domain.mjs';import * as templateFields from '../shared/template-fields.mjs';import * as sources from '../shared/sources.mjs';import * as completionTemplates from '../shared/completion-templates.mjs';
function nodes(node){if(!node||typeof node!=='object')return [];return [node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
const label=node=>typeof node==='string'?node:node?.props?[node.props.children].flat(Infinity).map(label).join(''):'';
const button=(tree,text)=>nodes(tree).find(n=>['button','Button'].includes(n.type)&&label(n)===text);

test('마감 템플릿 문구는 수정 변경하기를 눌렀을 때만 프로젝트에 반영한다',async()=>{
  const project=newProject('completion','completion'),updates=[],tasks=[],props={project,assets:[],busy:false,onFiles:()=>{},update:patch=>updates.push(patch),task:(...args)=>tasks.push(args),patchAssets:async()=>{}};
  project.completionTemplates[0].position='space';
  const app=await harness('src/components/CompletionTemplates.tsx','CompletionTemplates',props,{}),tree=app.render();
  const component=nodes(tree).find(n=>typeof n.type==='function'&&n.type.name==='TemplateSlot');
  let slot=app.render(()=>component.type(component.props));const field=nodes(slot).find(n=>n.type==='textarea');field.props.onChange({target:{value:'저장하기 전의 새 문구'}});
  assert.equal(updates.length,0);slot=app.render(()=>component.type(component.props));button(slot,'수정 변경하기').props.onClick();assert.equal(updates.length,1);assert.equal(updates[0].completionTemplates[0].text,'저장하기 전의 새 문구');assert.equal(project.completionTemplates[0].text,'');assert.deepEqual(tasks,[['templates',false,project.completionTemplates[0].id]]);
});
test('카페 링크가 바뀌면 이전 공사범위 사진의 확인 경고를 표시하지 않는다',async()=>{
  const project={...newProject('scope-warning','case'),cafeUrl:'https://cafe.naver.com/example/123',sourceText:'본문'};
  project.cafeScope={signature:templateFields.cafeScopeSignature(project),location:'',area:'',concept:'',scopeProject:'',scopeCopyright:'',rows:[],warnings:['이전 사진의 글자 확인 필요']};
  const props={project,assets:[],update:()=>{},onFiles:()=>{},task:()=>{},busy:false},app=await harness('src/components/TemplateEditor.tsx','TemplateEditor',props,{});
  const warnings=()=>nodes(app.render()).filter(n=>n.type==='Notice').map(label);
  assert(warnings().includes(project.cafeScope.warnings[0]));project.cafeUrl='https://cafe.naver.com/example/456';assert(!warnings().includes(project.cafeScope.warnings[0]));
});
async function harness(file,exportName,props,api){
  const source=ts.transpileModule(await fs.readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const states=[],refs=[],effects=[];let stateIndex=0,refIndex=0,effectIndex=0,pending=[];
  const hooks={useState:value=>{const i=stateIndex++;if(!(i in states))states[i]=value;return [states[i],next=>states[i]=typeof next==='function'?next(states[i]):next];},useRef:value=>refs[refIndex++]|| (refs[refIndex-1]={current:value}),useEffect:(fn,deps)=>{const i=effectIndex++;if(!effects[i]||deps.some((d,j)=>!Object.is(d,effects[i].deps[j])))pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
  const module={exports:{}},components=new Proxy({},{get:(_,name)=>name==='bytes'?value=>String(value):String(name)});
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:name==='../api'?{api}:name==='../../shared/domain.mjs'?domain:name==='../../shared/template-fields.mjs'?templateFields:name==='../../shared/sources.mjs'?sources:name==='../../shared/completion-templates.mjs'?completionTemplates:components,window:{addEventListener:()=>{},removeEventListener:()=>{}},setTimeout,clearTimeout,Date,console});
  return {render:(component=module.exports[exportName])=>{stateIndex=refIndex=effectIndex=0;pending=[];const tree=component(props);pending.forEach(fn=>fn());return tree;}};
}
test('작성 스타일에서 추천글과 시공사례의 링크·규칙·서식을 따로 편집하고 저장한다',async()=>{
  const calls=[],data={settings:{},auth:{connected:true,models:[]},browser:{available:true},jobs:[],style:{name:'추천글',rules:'추천글 기본 규칙',referenceUrls:['https://blog.naver.com/rec/123'],status:'analyzed',analyzedAt:'2026-10-12T00:00:00Z'},caseStyle:{name:'시공사례',rules:'시공사례 기본 규칙',referenceUrls:['https://blog.naver.com/case/456'],status:'analyzed',analyzedAt:'2026-10-13T00:00:00Z'}};
  const props={data,postType:'recommendation',refresh:async()=>{},onClose:()=>{},notify:()=>{}},api={saveStyle:async(style,type)=>calls.push(['save',type,style]),analyzeStyle:async type=>calls.push(['analyze',type]),refreshFormat:async type=>calls.push(['format',type])},app=await harness('src/components/Settings.tsx','default',props,api);
  let tree=app.render();button(tree,'작성 스타일').props.onClick();tree=app.render();
  let fields=nodes(tree).filter(n=>n.type==='textarea');fields[0].props.onChange({target:{value:'https://blog.naver.com/rec/789'}});tree=app.render();fields=nodes(tree).filter(n=>n.type==='textarea');fields[1].props.onChange({target:{value:'수정한 추천글 규칙'}});
  tree=app.render();button(tree,'시공사례 작성 스타일').props.onClick();tree=app.render();fields=nodes(tree).filter(n=>n.type==='textarea');assert.equal(fields[0].props.value,data.caseStyle.referenceUrls[0]);assert.equal(fields[1].props.value,data.caseStyle.rules);
  fields[0].props.onChange({target:{value:'https://blog.naver.com/case/999'}});tree=app.render();fields=nodes(tree).filter(n=>n.type==='textarea');fields[1].props.onChange({target:{value:'수정한 시공사례 규칙'}});tree=app.render();await button(tree,'스타일 저장').props.onClick();
  assert.equal(calls[0][1],'case');assert.equal(calls[0][2].rules,'수정한 시공사례 규칙');assert.deepEqual(Array.from(calls[0][2].referenceUrls),['https://blog.naver.com/case/999']);assert.deepEqual(calls[1],['analyze','case']);
  tree=app.render();button(tree,'추천글 작성 스타일').props.onClick();tree=app.render();fields=nodes(tree).filter(n=>n.type==='textarea');assert.equal(fields[0].props.value,'https://blog.naver.com/rec/789');assert.equal(fields[1].props.value,'수정한 추천글 규칙');
  await button(tree,'원본 서식 가져오기').props.onClick();assert.equal(calls.at(-2)[1],'recommendation');assert.deepEqual(calls.at(-1),['format','recommendation']);
  data.jobs=[{id:'case-job',projectId:'style-case',status:'running',message:'분석',progress:0}];tree=app.render();assert.equal(nodes(tree).find(n=>n.type==='fieldset').props.disabled,false);
  button(tree,'시공사례 작성 스타일').props.onClick();tree=app.render();assert.equal(nodes(tree).find(n=>n.type==='fieldset').props.disabled,true);assert.equal(button(tree,'추천글 작성 스타일').props.disabled,false);
});
test('시공사례 첫 단계에 카페 원본 입력란을 표시하고 링크 변경·늦은 응답·읽기 실패를 처리한다',async()=>{
  let resolve;const updates=[],messages=[],props={project:{...newProject('case','case'),cafeUrl:'https://cafe.naver.com/site/123',sourceText:'이전 현장의 본문'},assets:[],busy:false,update:patch=>{updates.push(patch);props.project={...props.project,...patch};},notify:message=>messages.push(message)};
  const api={readPost:()=>new Promise(r=>{resolve=r;})},app=await harness('src/components/Sites.tsx','SiteStep',props,api),site=app.render(),component=site.props.children[1].type;
  assert.equal(component.name,'CafeSource');let tree=app.render(component);assert.equal(nodes(tree).find(n=>n.type==='textarea').props.value,'이전 현장의 본문');
  const pending=button(tree,'마감글 불러오기').props.onClick();nodes(tree).find(n=>n.type==='input'&&n.props.type==='url').props.onChange({target:{value:'https://cafe.naver.com/site/456'}});tree=app.render(component);assert.equal(props.project.sourceText,'');resolve({text:'늦게 도착한 이전 링크 본문'});await pending;assert.equal(props.project.sourceText,'');
  api.readPost=async url=>{assert.equal(url,props.project.cafeUrl);return {text:'새 현장의 공사 완료 원본'};};tree=app.render(component);await button(tree,'마감글 불러오기').props.onClick();assert.equal(props.project.sourceText,'새 현장의 공사 완료 원본');
  api.readPost=async()=>({text:''});tree=app.render(component);await button(tree,'마감글 불러오기').props.onClick();assert.equal(props.project.sourceText,'새 현장의 공사 완료 원본');assert.match(messages.at(-1),/본문을 읽지 못/);tree=app.render(component);assert.equal(button(tree,'마감글 불러오기').props.busy,false);
});
test('다른 작업이 끝나도 같은 현장의 실패한 자동 조회를 반복하지 않고 직접 재조회할 수 있다',async()=>{
  const props={project:newProject('lookup','case'),assets:[],busy:false,which:'original',update:patch=>{props.project={...props.project,...patch};}},calls=[];
  const app=await harness('src/components/Sites.tsx','SiteStep',props,{search:async query=>{calls.push(query);throw Error('조회 실패');}}),component=nodes(app.render()).find(n=>n.type?.name==='ApartmentCard').type;
  props.project.original.name='시티프라디움3차';app.render(component);await new Promise(r=>setTimeout(r,1100));assert.equal(calls.length,1);
  props.busy=true;app.render(component);props.busy=false;let tree=app.render(component);await new Promise(r=>setTimeout(r,1100));assert.equal(calls.length,1);
  await button(tree,'네이버 부동산에서 조회').props.onClick();assert.equal(calls.length,2);
  props.project.original.name='새 현장';app.render(component);await new Promise(r=>setTimeout(r,1100));assert.equal(calls.length,3);
});

test('비슷한 이름의 추천 후보는 하나만 있어도 자동 선택하지 않는다',async()=>{
  let selected=0;const props={project:newProject('similar','case'),assets:[],busy:false,which:'original',update:patch=>{props.project={...props.project,...patch};}};
  const app=await harness('src/components/Sites.tsx','SiteStep',props,{search:async()=>({results:[{name:'아파트 문래대림 서울시 영등포구',key:'similar',suggested:true}]}),selectComplex:async()=>{selected++;}}),component=nodes(app.render()).find(n=>n.type?.name==='ApartmentCard').type;
  props.project.original.name='문래대륌';props.project.original.region='서울시 영등포구';let tree=app.render(component);await button(tree,'네이버 부동산에서 조회').props.onClick();tree=app.render(component);
  assert.equal(selected,0);assert(nodes(tree).some(n=>n.type==='p'&&label(n).includes('비슷한 단지를 추천')));assert(button(tree,'아파트 문래대림 서울시 영등포구'));
});

test('사진 단계에서 사진을 먼저 첨부하고 미리보기 옆에서 문구를 수정하며 이전 JPG 내려받기를 막는다',async()=>{
  const tasks=[],props={project:{...newProject('case','case'),original:{...newProject().original,name:'시공 현장'},coverTemplateId:'psd'},assets:[{id:'photo',role:'photo',status:'ready',excluded:false,filename:'거실.jpg',space:'거실',order:0,hash:'photo'}],busy:false,update:patch=>{props.project={...props.project,...patch};},onFiles:()=>{},task:kind=>tasks.push(kind),patchAssets:async()=>{},notify:()=>{}};
  const step=await harness('src/components/Assets.tsx','AssetsStep',props,{}),tree=step.render(),children=tree.props.children;
  assert.equal(children[1].type,'Dropzone');assert.equal(children[1].props.role,'photo');assert.equal(children[2].type,'TemplateEditor');
  const app=await harness('src/components/TemplateEditor.tsx','TemplateEditor',props,{});let editor=app.render();assert.equal(nodes(editor).find(n=>n.type==='details').props.open,false);
  const field=text=>nodes(editor).find(n=>n.type==='Field'&&n.props.label===text).props.children;
  field('표지 현장명').props.onChange({target:{value:'미리보기에서 수정한 이름'}});editor=app.render();assert.equal(field('표지 현장명').props.value,'미리보기에서 수정한 이름');
  field('하단 프로젝트 문구').props.onChange({target:{value:'Project · 수정한 문구'}});editor=app.render();field('하단 저작권 문구').props.onChange({target:{value:'© 2030. 수정한 저작권'}});editor=app.render();assert.equal(field('하단 프로젝트 문구').props.value,'Project · 수정한 문구');assert.equal(field('하단 저작권 문구').props.value,'© 2030. 수정한 저작권');assert.deepEqual(tasks,[]);button(editor,'표지·공사범위 만들기 시작').props.onClick();assert.deepEqual(tasks,['templates']);
  props.project.cafeScope={signature:templateFields.cafeScopeSignature(props.project),location:'',area:'',concept:'',rows:[],warnings:[],scopeProject:'Project No. 12AB3456_7890C1234',scopeCopyright:'ⓒ 2025. LEMONHOUSE ALL rights reserved.'};
  editor=app.render();button(editor,'카페 원본 내용으로 되돌리기').props.onClick();editor=app.render();assert.equal(field('하단 프로젝트 문구').props.value,props.project.cafeScope.scopeProject);assert.equal(field('하단 저작권 문구').props.value,props.project.cafeScope.scopeCopyright);assert.equal(field('표지 현장명').props.value,'미리보기에서 수정한 이름');assert.deepEqual(tasks,['templates']);
  props.assets.push({id:'cover',role:'photo',templateOutput:'cover',status:'ready',excluded:false,previewUrl:'/preview.jpg',originalUrl:'/original.jpg',templateSignature:'old'});editor=app.render();let download=nodes(editor).find(n=>n.type==='a'&&n.props.download);assert.equal(download.props.href,undefined);assert.equal(download.props['aria-disabled'],true);
  props.assets.at(-1).templateSignature=sources.templateSourceSignature(props.project,props.assets);editor=app.render();download=nodes(editor).find(n=>n.type==='a'&&n.props.download);assert.equal(download.props.href,'/original.jpg');
  button(editor,'현장 정보로 되돌리기').props.onClick();editor=app.render();assert.equal(field('표지 현장명').props.value,'시공 현장');
});

test('PSD 원본 복원은 원문·폰트·크기·굵기를 보여 주고 선택 사진과 저장 전 상태를 보존한다',async()=>{
 const p=newProject('defaults-ui','completion');p.completionTemplates[0]={...p.completionTemplates[0],templateId:'template',edits:{title:{text:'수정한 문구',fontFamily:'Malgun Gothic',fontSize:80,fontWeight:700},photo:{photoId:'chosen'}},overlays:[{id:'extra',text:'추가 문구'}]};
 const updates=[],element={id:'title',name:'원본 제목',kind:'text',text:'PSD 원본 문구',fontFamily:'Freesentation-5Medium',fontSize:36,fontWeight:500,width:250,height:50,x:10,y:10};
 const assets=[{id:'template',role:'template',templateKind:'completion',layouts:[{id:'0',width:300,height:200,elements:[element,{id:'photo',kind:'photo',name:'사진칸',x:0,y:60,width:100,height:100}]}]}];
 const props={project:p,assets,busy:false,onFiles:()=>{},update:patch=>updates.push(patch),task:()=>{},patchAssets:async()=>{}},app=await harness('src/components/CompletionTemplates.tsx','CompletionTemplates',props,{}),component=nodes(app.render()).find(n=>typeof n.type==='function'&&n.type.name==='TemplateSlot');
 let tree=app.render(()=>component.type(component.props));button(tree,'원본 문구·서식으로').props.onClick();tree=app.render(()=>component.type(component.props));assert.equal(updates.length,0);
 const field=label=>nodes(tree).find(n=>n.type==='Field'&&n.props.label===label).props.children;
 field('세부 수정할 항목').props.onChange({target:{value:'title'}});tree=app.render(()=>component.type(component.props));assert.equal(field('문구').props.value,'PSD 원본 문구');assert.equal(field('글꼴').props.value,'Freesentation-5Medium');assert.equal(field('글자 크기').props.value,36);assert.equal(field('글자 굵기').props.value,500);
 button(tree,'수정 변경하기').props.onClick();assert.equal(updates[0].completionTemplates[0].edits.photo.photoId,'chosen');assert.equal(updates[0].completionTemplates[0].edits.title,undefined);assert.equal(updates[0].completionTemplates[0].overlays.length,0);assert.equal(p.completionTemplates[0].edits.title.text,'수정한 문구');
});

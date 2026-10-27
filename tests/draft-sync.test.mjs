import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as domain from '../shared/domain.mjs';
import {newProject} from '../shared/domain.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const source=ts.transpileModule(await fs.readFile('src/App.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function appHarness(api,options={}){
  const project=options.project||{...newProject('draft'),phase:'write',blocks:[{id:'intro',kind:'text',text:'소개'},{id:'heading',kind:'quote',space:'현관',text:'현관'},{id:'body',kind:'text',space:'현관',text:'직접 수정할 설명'}]},data={projects:[project],assets:[],jobs:[],auth:{connected:true},browser:{},settings:{},style:{},...options.data};
  const callbacks=[],refs=[],states=[];let stateIndex=0;
  const hooks={useCallback:fn=>(callbacks.push(fn),fn),useEffect:()=>{},useRef:value=>{const ref={current:refs.length===1?project:value};refs.push(ref);return ref;},useState:initial=>{const i=stateIndex++,value=i===0?data:i===1?project:initial;states[i]=value;return [value,next=>states[i]=typeof next==='function'?next(states[i]):next];}};
  const components=new Proxy({},{get:(_,name)=>String(name)}),module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:name==='./api'?{api}:name==='../shared/format.mjs'?{}:name==='../shared/domain.mjs'?domain:name==='../shared/sources.mjs'?{}:components,localStorage:{getItem:()=>null,setItem:()=>{}},setTimeout,clearTimeout,Date,console});
  const tree=module.exports.default();
  const find=node=>{if(!node||typeof node!=='object')return null;if(node.type==='WriteStep')return node;for(const child of [node.props?.children].flat(Infinity)){const match=find(child);if(match)return match;}return null;};
  return {data,project,tree,update:callbacks[1],save:callbacks[2],refresh:callbacks[3],task:find(tree)?.props.task,onFiles:find(tree)?.props.onFiles,current:refs[1],states};
}
test('저장 도중 반복해서 바꾼 순서와 본문까지 모두 저장한 후 그 버전으로 네이버 준비를 시작한다',async()=>{
  const pending=[],tasks=[];const app=appHarness({saveProject:p=>{const wait=deferred();pending.push({snapshot:p,wait});return wait.promise;},task:async(...args)=>(tasks.push(args),{id:'job',status:'running'})});
  app.update({blocks:[app.project.blocks[1],app.project.blocks[0],app.project.blocks[2]]});
  const saving=app.save(),preparing=app.task('prepare');
  for(let i=0;i<3;i++){app.update({title:`수정 ${i}`,blocks:app.current.current.blocks.map(b=>b.id==='body'?{...b,text:`최종 설명 ${i}`}:b)});pending[i].wait.resolve({...pending[i].snapshot,revision:i+1});await tick();assert.equal(tasks.length,0);}
  assert.equal(pending.length,4);pending[3].wait.resolve({...pending[3].snapshot,revision:4});await Promise.all([saving,preparing]);
  assert.deepEqual(Array.from(app.current.current.blocks,b=>b.id),['heading','intro','body']);assert.equal(app.current.current.blocks[2].text,'최종 설명 2');assert.equal(pending[3].snapshot.title,'수정 2');assert.deepEqual(tasks,[['draft','prepare',false,4]]);
});
test('저장 전 시작한 늦은 상태 조회가 수정한 원고를 이전 버전으로 되돌리지 않는다',async()=>{
  const stale=deferred();const app=appHarness({bootstrap:()=>stale.promise,saveProject:async p=>({...p,revision:1})});const refreshing=app.refresh();
  app.update({blocks:[...app.project.blocks].reverse()});await app.save();stale.resolve(app.data);await refreshing;
  assert.equal(app.current.current.revision,1);assert.deepEqual(Array.from(app.current.current.blocks,b=>b.id),['body','heading','intro']);
});
test('저장 실패 때 이전 원고로 네이버 작업을 진행하지 않고 수정 내용과 오류를 보존한다',async()=>{
  let started=false;const app=appHarness({saveProject:async()=>{throw Error('저장 연결 실패');},task:async()=>{started=true;}});app.update({title:'반드시 보존할 수정'});await app.task('prepare');
  assert.equal(started,false);assert.equal(app.current.current.title,'반드시 보존할 수정');assert(app.states.includes('저장 연결 실패'));assert.equal(app.states.at(-1),false);
});
test('같은 프로그램의 왼쪽 메뉴에서 추천글과 시공사례를 전환하며 수정 원고를 먼저 저장한다',async()=>{
  const recommendation=newProject('recommendation'),portfolio=newProject('case','case'),saved=[];
  const app=appHarness({saveProject:async p=>(saved.push(p),{...p,revision:p.revision+1})},{project:portfolio,data:{projects:[portfolio,recommendation]}});
  const all=[];function walk(node){if(!node||typeof node!=='object')return;all.push(node);for(const child of [node.props?.children].flat(Infinity))walk(child);}walk(app.tree);
  const sidebar=all.find(n=>n.type==='aside'),nodes=[];function visit(node){if(!node||typeof node!=='object')return;nodes.push(node);for(const child of [node.props?.children].flat(Infinity))visit(child);}visit(sidebar);
  const menu=nodes.find(n=>n.type==='nav'&&n.props['aria-label']==='게시글 종류'),buttons=menu.props.children;
  assert.equal(buttons[0].props.children,'추천글 작성');assert.equal(buttons[1].props.children,'시공사례 작성');assert.equal(buttons[1].props['aria-pressed'],true);
  app.update({title:'저장할 시공사례 수정'});buttons[0].props.onClick();await tick();assert.equal(saved[0].title,'저장할 시공사례 수정');assert.equal(app.current.current.id,recommendation.id);
  buttons[1].props.onClick();await tick();assert.equal(app.current.current.id,portfolio.id);
});
test('시공사례의 PSD 영역에 사진을 놓아도 사진으로 첨부하고 PSD는 템플릿으로 등록한다',async()=>{
  const uploads=[],project={...newProject('case','case'),phase:'write'},api={upload:async(id,role,file)=>uploads.push({id,role,name:file.name})};
  const app=appHarness(api,{project});api.bootstrap=async()=>app.data;
  await app.onFiles([{name:'거실 (28).jpg'},{name:'공사범위.psd'},{name:'주방.png'}],'template');
  assert.deepEqual(uploads.map(a=>a.role),['photo','template','photo']);
  uploads.length=0;await app.onFiles([{name:'표지.PSD'},{name:'방.webp'}],'photo');assert.deepEqual(uploads.map(a=>a.role),['template','photo']);
});
test('공사전·공사중 메뉴를 열기 전에 기존 원고를 저장하고 세 콘텐츠의 원고는 그대로 유지한다',async()=>{
  const saved=[],app=appHarness({saveProject:async p=>(saved.push(p),{...p,revision:p.revision+1})});
  const nodes=[];function visit(node){if(!node||typeof node!=='object')return;nodes.push(node);for(const child of [node.props?.children].flat(Infinity))visit(child);}visit(app.tree);
  const menu=nodes.find(n=>n.type==='nav'&&n.props['aria-label']==='게시글 종류');
  assert.deepEqual(Array.from(menu.props.children,n=>n.props.children),['추천글 작성','시공사례 작성','마감 작성 · 카페','공사전 작성 · 카페','공사중 작성 · 카페']);
  app.update({title:'메뉴를 옮겨도 보존할 원고'});menu.props.children[3].props.onClick();await tick();
  assert.equal(saved[0].title,'메뉴를 옮겨도 보존할 원고');assert.equal(app.current.current.id,app.project.id);assert.ok(app.states.includes('before'));
  menu.props.children[4].props.onClick();await tick();assert.ok(app.states.includes('during'));assert.equal(saved.length,1);
});

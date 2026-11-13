import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {Naver,editorContentIssue} from '../server/naver.mjs';
import {newProject} from '../shared/domain.mjs';
import {COMPLETION_FORMAT} from '../shared/format.mjs';

function fixture({boardId='19866392',occupied=false,wrongOrder=false,loggedOut=false,quietSave=false}={}){
  const project={...newProject('test','completion'),title:'[입력 테스트] 카페 마감',original:{name:'테스트 현장'},formatProfile:COMPLETION_FORMAT,tags:[],blocks:[{id:'intro',kind:'text',text:'자동 입력 확인용 원고입니다.'}]};
  project.cafeBoardUrl='https://cafe.naver.com/f-e/cafes/'+boardId+'/menus/187';
  let stage=occupied?'editor':'',href='',text=occupied?'작성 중인 글':'',title='',saved=false;const actions=[];
  const element={textContent:'카페 글쓰기',dataset:{},getBoundingClientRect:()=>({width:100})};
  const draftButton={...element,textContent:'임시등록 | 2',matches:()=>false};
  const document={querySelector:selector=>selector.startsWith('textarea')&&stage==='editor'?{value:title}:selector==='.btn_temp_count'?{textContent:saved?'3':'2'}:null,querySelectorAll:selector=>{
    if(selector==='a[href]')return [{href:stage==='board'?project.cafeBoardUrl:'https://cafe.naver.com/f-e/cafes/19866392/menus/0'}];
    if(selector==='a,button')return loggedOut?[]:[element];
    if(selector==='button,a')return [draftButton];
    if(selector.includes('[role="alert"]'))return saved&&!quietSave?[{getBoundingClientRect:()=>({width:100}),innerText:'임시등록되었습니다.'}]:[];
    if(selector.includes('nidlogin'))return loggedOut?[element]:[];
    if(selector==='.se-component .__se-node')return text?[{textContent:text}]:[];
    if(selector==='.se-component.se-text,.se-component.se-quotation')return [{innerText:text||'내용을 입력하세요.'}];
    if(selector==='.se-component.se-text .__se-node,.se-component.se-quotation .__se-node')return text?[{textContent:text}]:[];
    return [];
  }};
  const bridge={exclusive:fn=>fn(),frame:async()=>stage==='editor',goto:async url=>{actions.push(['goto',url]);href=url;stage=url===project.cafeBoardUrl?'board':'target';},waitFor:async()=>{},evaluate:async(fn,arg)=>vm.runInNewContext(`(${fn.toString()})(arg)`,{document,URL,location:new URL(href||'https://cafe.naver.com/f-e/cafes/19866392/articles/write'),arg}),click:async selector=>{if(selector.includes('nidlogin')){assert(loggedOut);actions.push(['login']);return;}if(selector==='[data-lemon-cafe-draft="true"]'){actions.push(['draft']);saved=true;return;}assert.equal(selector,'[data-lemon-cafe-write="true"]');actions.push(['write']);stage='editor';href='https://cafe.naver.com/f-e/cafes/19866392/articles/write';},text:async(selector,value)=>{assert(selector.startsWith('textarea'));title=value;},watchDialog:async()=>({message:'',close:()=>{}}),reveal:()=>actions.push(['reveal'])};
  bridge.clickNative=bridge.click;
  const naver=new Naver({get:()=>project,assets:()=>[],put:()=>{}},{},bridge);
  if(occupied)bridge.window={isDestroyed:()=>false};
  naver.writeBlocks=async p=>{assert.equal(p,project);actions.push(['body']);text=project.blocks[0].text;};
  naver.editorFormatting=async()=>({components:[{class:'se-component se-text',text:wrongOrder?'다른 본문':text}],paragraphs:[{align:'left',spans:[{text,fontFamily:'nanumbarungothic',fontSize:'15px',fontWeight:'400',color:'#000000',backgroundColor:'transparent'}]}]});
  naver.setTags=async tags=>actions.push(['tags',...tags]);
  return {naver,project,actions};
}
test('카페의 빈 본문 안내는 기존 글로 판단하지 않고 본문·태그 확인 후 임시저장까지 완료한다',async()=>{
  const {naver,project,actions}=fixture();project.tags=['인테리어'];const result=await naver.prepareCafe(project.id,()=>{});
  assert.equal(result.destination,'cafe');assert.equal(result.prepared,true);assert.equal(result.title,project.title);assert.equal(result.revision,project.revision);assert(actions.some(a=>a[0]==='body'));assert(actions.filter(a=>a[0]==='goto').every(a=>a[1].startsWith('https://cafe.naver.com/')));
  assert.equal(result.draftSaved,true);assert.deepEqual(actions.filter(a=>['body','tags','draft'].includes(a[0])),[['body'],['tags','인테리어'],['draft']]);
});

test('영상·사진이 들어가도 빠진 포인트 설명을 영상 오류로 안내하지 않는다',()=>{
  const project={title:'마감',blocks:[{kind:'text',space:'공용욕실',formatRole:'pointBody',text:'브론즈 유리 파티션을 시공했습니다.'},{kind:'photos',assetIds:['photo']},{kind:'video',assetIds:['video']}]};
  assert.match(editorContentIssue(project,{title:'마감',text:'',photoBlocks:[1]}),/공용욕실 포인트 설명/);
  assert.equal(editorContentIssue(project,{title:'마감',text:project.blocks[0].text,photoBlocks:[1]}),'');
});

test('완료 알림이 없어도 같은 원고의 임시등록 개수가 실제 늘면 저장 완료로 확인한다',async()=>{
  const {naver,project,actions}=fixture({quietSave:true});
  const result=await naver.prepareCafe(project.id,()=>{});
  assert.equal(result.draftSaved,true);assert.equal(actions.filter(a=>a[0]==='draft').length,1);
});
test('카페 준비는 기존 글·다른 카페·미일치 서식·로그인 누락을 성공으로 처리하지 않는다',async()=>{
  for(const [options,message]of [[{occupied:true},/작성 중인 글/],[{boardId:'999'},/카페와 다릅니다/],[{wrongOrder:true},/미리보기와 다릅니다/],[{loggedOut:true},/로그인/]]){
    const {naver,project,actions}=fixture(options);await assert.rejects(naver.prepareCafe(project.id,()=>{}),message);if(!options.wrongOrder)assert(!actions.some(a=>a[0]==='body'));assert(!actions.some(a=>a[0]==='draft'));assert.equal(actions.at(-1)[0],'reveal');
  }
});

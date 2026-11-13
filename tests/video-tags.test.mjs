import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {Naver} from '../server/naver.mjs';

function fixture(initial=[],{hideAtLimit=false,tagBox=true}={}){
  const tags=[...initial],calls=[],input={value:'',closest:()=>list};
  const hasInput=()=>!hideAtLimit||tags.length<10;
  const list={get children(){return [...tags.map(tag=>({textContent:tag+'삭제',querySelector:()=>null,cloneNode:()=>{const copy={textContent:tag+'삭제',querySelectorAll:()=>[{remove:()=>{copy.textContent=tag;}}]};return copy;}})),...(hasInput()?[{querySelector:()=>input}]:[])];}};
  const title={closest:()=>document},row={contains:()=>false,querySelector:()=>list},label={childElementCount:0,textContent:'태그 편집',parentElement:row};
  const document={querySelector:selector=>selector==='input.nvu_tag_inp'?(hasInput()?input:null):selector==='#nvu_inp_box_tag'&&tagBox?{closest:()=>list}:selector==='#nvu_inp_box_title'?title:null,querySelectorAll:selector=>selector==='.se-component.se-video'?[{dataset:{}}]:selector==='[data-lemon-video]'?[]:[label]};
  let opened=false;
  const bridge={frame:async selector=>opened&&document.querySelector(selector)?{}:null,evaluate:async(fn,arg,options)=>{
    if(options?.selector==='input.nvu_tag_inp'&&!hasInput())throw Object.assign(new Error('네이버 화면을 읽을 수 없습니다.'),{status:422});
    return vm.runInNewContext('('+fn.toString()+')(arg)',{document,arg});
  },text:async(selector,text)=>{assert.equal(selector,'input.nvu_tag_inp');calls.push(['tag',text]);input.value=text;},key:async key=>{if(key==='Return'){tags.push(input.value);input.value='';}},click:async(selector,options)=>calls.push([selector,options?.text]),clickNative:async(selector,options)=>{calls.push([selector,options?.text]);if(selector==='button.se-video-meta-toolbar-button.se-property-toolbar-basic-button')opened=true;},waitFor:async()=>{}};
  return {naver:new Naver({},null,bridge),tags,calls,input};
}
test('영상 태그는 게시글과 같은 정규화된 태그로 Enter 확정하고 중복 입력하지 않는다',async()=>{
  const f=fixture();await f.naver.setVideoTags(['#자동입력테스트','마감 서식검증','#자동입력테스트','철거삭제']);await f.naver.setVideoTags(['자동입력테스트','마감서식검증','철거삭제']);
  assert.deepEqual(f.tags,['자동입력테스트','마감서식검증','철거삭제']);assert.equal(f.input.value,'');assert.equal(f.calls.filter(c=>c[0]==='tag').length,3);
});
test('열 번째 영상 태그가 확정되어 입력칸이 없어져도 태그 확인과 정보창 닫기를 끝낸다',async()=>{
  const tags=Array.from({length:10},(_,i)=>'영상태그'+i);
  for(const tagBox of [true,false]){
    const f=fixture(tags.slice(0,9),{hideAtLimit:true,tagBox}),bridge=f.naver.requireBridge(),evaluate=bridge.evaluate;
    let redraw=true;
    bridge.evaluate=async(fn,arg,options)=>{
      if(redraw&&f.tags.length===10&&options?.selector==='#nvu_inp_box_title'){redraw=false;throw Object.assign(new Error('화면 재구성 중'),{status:422});}
      return evaluate(fn,arg,options);
    };
    await f.naver.setVideoTags(tags);
    await f.naver.verifyVideoTags(tags);
    assert.equal(redraw,false);
    assert.deepEqual(f.tags,tags);
    assert.deepEqual(f.calls.filter(c=>c[0]==='tag'),[['tag',tags[9]]]);
    assert.equal(f.calls.at(-1)[0],'.nvu_btn_close');
  }
});
test('영상 정보창을 다시 열어 저장된 태그를 대조하며 누락·추가·미확정 태그를 성공으로 처리하지 않는다',async()=>{
  const f=fixture(['자동입력테스트','마감서식검증']);await f.naver.verifyVideoTags(['#마감서식검증','자동입력테스트']);assert(f.calls.some(c=>c[1]==='정보 편집'));assert.equal(f.calls.at(-1)[0],'.nvu_btn_close');
  for(const tags of [['자동입력테스트'],['자동입력테스트','마감서식검증','다른태그']]){const bad=fixture(tags);await assert.rejects(bad.naver.verifyVideoTags(['자동입력테스트','마감서식검증']),/저장된 영상 태그/);assert(!bad.calls.some(c=>c[0]==='.nvu_btn_close'));}
  f.input.value='미확정태그';await assert.rejects(f.naver.verifyVideoTags(['자동입력테스트','마감서식검증']),/저장된 영상 태그/);
});

test('블로그 영상 정보 버튼이 첫 클릭을 무시해도 창이 열린 것을 확인하고 접힌 입력란의 태그를 읽는다',async()=>{
  const f=fixture(['현장','인테리어']),bridge=f.naver.requireBridge();let clicks=0;
  const native=bridge.clickNative;
  bridge.clickNative=async(selector,options)=>{if(selector==='button.se-video-meta-toolbar-button.se-property-toolbar-basic-button'){assert.equal(options.text,'정보 편집');if(++clicks===1)return;}await native(selector,options);};
  f.input.hidden=true;await f.naver.verifyVideoTags(['현장','인테리어']);assert.equal(clicks,2);assert(!f.calls.some(c=>c[0]==='tag'));assert.equal(f.calls.at(-1)[0],'.nvu_btn_close');
});

test('영상 정보창을 끝내 열지 못하면 재시도를 멈추고 해당 단계의 오류를 알린다',async t=>{
  const f=fixture(['현장']),bridge=f.naver.requireBridge();let time=0;
  t.mock.method(Date,'now',()=>time+=5001);bridge.frame=async()=>null;
  await assert.rejects(f.naver.verifyVideoTags(['현장']),/동영상 정보 편집창을 열지 못했습니다/);
  assert(!f.calls.some(c=>c[0]==='tag'));assert(!f.calls.some(c=>c[0]==='.nvu_btn_close'));
});
test('영상 태그 한도는 입력 전에 확인하고 원고 태그를 영상 입력에 전달한다',async()=>{
  for(const tags of [Array.from({length:11},(_,i)=>'태그'+i),['가'.repeat(21)]]){const f=fixture();await assert.rejects(f.naver.setVideoTags(tags),/최대 10개/);assert.equal(f.calls.length,0);}
  const calls=[],naver=new Naver({assets:()=>[]},null,{appendParagraph:async()=>{}});naver.insertVideo=async(...args)=>calls.push(args);
  const block={kind:'video',assetIds:['v'],text:'영상'},update=()=>{};await naver.writeBlocks({id:'p',tags:['게시글태그'],blocks:[block]},update);assert.deepEqual(calls,[[block,'p',['게시글태그'],update]]);
});

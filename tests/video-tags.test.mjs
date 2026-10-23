import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {Naver} from '../server/naver.mjs';

function fixture(initial=[]){
  const tags=[...initial],calls=[],input={value:'',closest:()=>list};
  const list={get children(){return [...tags.map(tag=>({textContent:tag+'삭제',querySelector:()=>null,cloneNode:()=>{const copy={textContent:tag+'삭제',querySelectorAll:()=>[{remove:()=>{copy.textContent=tag;}}]};return copy;}})),{querySelector:()=>input}];}};
  const document={querySelector:()=>input,querySelectorAll:selector=>selector==='.se-component.se-video'?[{dataset:{}}]:[]};
  const bridge={evaluate:async(fn,arg)=>vm.runInNewContext('('+fn.toString()+')(arg)',{document,arg}),text:async(selector,text)=>{assert.equal(selector,'input.nvu_tag_inp');calls.push(['tag',text]);input.value=text;},key:async key=>{if(key==='Return'){tags.push(input.value);input.value='';}},click:async(selector,options)=>calls.push([selector,options?.text]),clickNative:async selector=>calls.push([selector]),waitFor:async()=>{}};
  return {naver:new Naver({},null,bridge),tags,calls,input};
}
test('영상 태그는 게시글과 같은 정규화된 태그로 Enter 확정하고 중복 입력하지 않는다',async()=>{
  const f=fixture();await f.naver.setVideoTags(['#자동입력테스트','마감 서식검증','#자동입력테스트','철거삭제']);await f.naver.setVideoTags(['자동입력테스트','마감서식검증','철거삭제']);
  assert.deepEqual(f.tags,['자동입력테스트','마감서식검증','철거삭제']);assert.equal(f.input.value,'');assert.equal(f.calls.filter(c=>c[0]==='tag').length,3);
});
test('영상 정보창을 다시 열어 저장된 태그를 대조하며 누락·추가·미확정 태그를 성공으로 처리하지 않는다',async()=>{
  const f=fixture(['자동입력테스트','마감서식검증']);await f.naver.verifyVideoTags(['#마감서식검증','자동입력테스트']);assert(f.calls.some(c=>c[1]==='정보 편집'));assert.equal(f.calls.at(-1)[0],'.nvu_btn_close');
  for(const tags of [['자동입력테스트'],['자동입력테스트','마감서식검증','다른태그']]){const bad=fixture(tags);await assert.rejects(bad.naver.verifyVideoTags(['자동입력테스트','마감서식검증']),/저장된 영상 태그/);assert(!bad.calls.some(c=>c[0]==='.nvu_btn_close'));}
  f.input.value='미확정태그';await assert.rejects(f.naver.verifyVideoTags(['자동입력테스트','마감서식검증']),/저장된 영상 태그/);
});
test('영상 태그 한도는 입력 전에 확인하고 원고 태그를 영상 입력에 전달한다',async()=>{
  for(const tags of [Array.from({length:11},(_,i)=>'태그'+i),['가'.repeat(21)]]){const f=fixture();await assert.rejects(f.naver.setVideoTags(tags),/최대 10개/);assert.equal(f.calls.length,0);}
  const calls=[],naver=new Naver({assets:()=>[]},null,{appendParagraph:async()=>{}});naver.insertVideo=async(...args)=>calls.push(args);
  const block={kind:'video',assetIds:['v'],text:'영상'};await naver.writeBlocks({id:'p',tags:['게시글태그'],blocks:[block]},()=>{});assert.deepEqual(calls,[[block,'p',['게시글태그']]]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {Naver} from '../server/naver.mjs';

function fixture(cafe){
  const tags=[],typed=[],root={querySelectorAll:selector=>cafe&&!selector.includes('.tag_text')?[]:tags.map(textContent=>({textContent:'#'+textContent}))};
  const input={value:'',placeholder:'태그를 입력해주세요',parentElement:{parentElement:root},closest:selector=>selector.includes(cafe?'.tag_inner':'tag_textarea')?root:null,focus(){},dispatchEvent(event){if(event.type==='keydown'&&event.key==='Enter'&&this.value){tags.push(this.value);this.value='';this.placeholder='';}}};
  const document={querySelector:selector=>selector==='.tag_inner input.tag_input'?(cafe?input:null):!cafe&&selector.includes('#tag-input')||cafe&&(selector.includes('input.tag_input')||input.placeholder&&selector.includes('placeholder'))?input:null};
  const bridge={evaluate:async(fn,arg)=>vm.runInNewContext('('+fn.toString()+')(arg)',{document,arg,KeyboardEvent:class{constructor(type,props){Object.assign(this,{type},props);}}}),text:async(selector,value)=>{assert(document.querySelector(selector),'태그를 추가한 뒤에도 같은 입력란을 찾아야 합니다.');typed.push(value);input.value=value;},key:async()=>assert.fail('이미 등록된 태그를 다시 입력하면 안 됩니다.')};
  return {naver:new Naver({},null,bridge),tags,typed};
}
test('카페의 빈 안내 문구와 em 태그, 블로그의 태그를 모두 확인하고 중복 입력하지 않는다',async()=>{
  for(const cafe of [true,false]){const {naver,tags,typed}=fixture(cafe);await naver.setTags(['#자동입력테스트','공사범위 확인','#자동입력테스트']);await naver.setTags(['자동입력테스트','공사범위확인']);assert.deepEqual(tags,['자동입력테스트','공사범위확인']);assert.equal(typed.length,2);}
});
test('카페의 태그 개수·길이와 블로그의 개수 한도를 넘으면 입력 전에 알린다',async()=>{
  for(const [cafe,tags,reason] of [[true,Array.from({length:11},(_,i)=>'태그'+i),/10개/],[true,['가'.repeat(21)],/20자/],[false,Array.from({length:31},(_,i)=>'태그'+i),/30개/]]){const f=fixture(cafe);await assert.rejects(f.naver.setTags(tags),reason);assert.equal(f.typed.length,0);}
});

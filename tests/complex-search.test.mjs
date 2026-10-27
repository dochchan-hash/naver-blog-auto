import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {Naver} from '../server/naver.mjs';

function fixture({empty=false,typo=false,complex='문래대림',address='서울시 영등포구 문래동5가',matchQuery='문래대'}={}){
  const typed=[],details=[];let observations=0,linkReads=0,selected=false;
  const result={innerText:'아파트\n'+complex+'\n'+address,getBoundingClientRect:()=>({width:100}),querySelector:selector=>({textContent:selector.includes('__address')?address:complex}),click:()=>{selected=true;}};
  const root={get innerText(){return empty||typo&&input.value!==matchQuery?'검색 결과가 없습니다':result.innerText;},querySelectorAll:()=>empty||typo&&input.value!==matchQuery||++observations<3?[]:[result,result]};
  const input={value:'',parentElement:{parentElement:root}},content={querySelectorAll:()=>selected&&++linkReads>=3?[{textContent:'문래대림',href:'https://fin.land.naver.com/complexes/3790',getBoundingClientRect:()=>({width:100})}]:[]};
  const document={querySelector:selector=>selector==='#header-search'?input:content,querySelectorAll:()=>{throw Error('검색창 밖의 최근 단지·지도 버튼을 읽으면 안 됩니다.');}};
  const bridge={exclusive:fn=>fn(),goto:async()=>{observations=0;selected=false;},click:async()=>{},waitFor:async()=>{},text:async(selector,value)=>{assert.equal(selector,'#header-search');input.value=value;typed.push(value);},evaluate:async(fn,arg)=>vm.runInNewContext(`(${fn.toString()})(arg)`,{document,arg})};
  const naver=new Naver({}, {},bridge);naver.complexDetails=async url=>{details.push(url);return {name:'문래대림',url,types:['106.43㎡']};};
  return {naver,typed,details,observations:()=>observations,linkReads:()=>linkReads};
}

test('아파트명만 넣어도 접미사를 정리하고 늦게 도착한 실제 단지 후보를 읽는다',async()=>{
  const f=fixture(),results=await f.naver.searchComplex('  문래대림아파트  ');
  assert.deepEqual(f.typed,['문래대림']);assert.equal(results.length,1);assert.equal(results[0].suggested,false);assert.equal(results[0].complexName,'문래대림');assert.equal(results[0].address,'서울시 영등포구 문래동5가');assert(f.observations()>=3);
});

test('동 이름을 붙인 검색어도 결과 이름과 주소를 따로 읽어 같은 단지를 반환한다',async()=>{
  const f=fixture({complex:'에일린의뜰',address:'부산시 강서구 명지동'}),results=await f.naver.searchComplex('명지동 에일린의뜰','부산광역시 강서구 명지국제5로 60');
  assert.deepEqual(f.typed,['명지동 에일린의뜰']);assert.equal(results.length,1);assert.equal(results[0].complexName,'에일린의뜰');assert.equal(results[0].suggested,false);
});

test('검색 후보를 선택하면 해당 단지의 상세 링크가 도착할 때까지 기다린다',async()=>{
  const f=fixture(),results=await f.naver.searchComplex('문래대림아파트'),details=await f.naver.selectComplex(results[0].key);
  assert.equal(details.url,'https://fin.land.naver.com/complexes/3790');assert.deepEqual(f.typed,['문래대림','문래대림']);assert.equal(f.details.length,1);assert(f.linkReads()>=3);
});

test('단지 없음과 결과 읽기 오류를 구분하고 빈 일반명은 네이버에 보내지 않는다',async t=>{
  let clock=0;t.mock.method(Date,'now',()=>clock+=6000);const f=fixture({empty:true});
  await assert.rejects(f.naver.searchComplex('없는단지아파트'),/해당하는 단지를 네이버에서 찾지 못/);
  await assert.rejects(f.naver.searchComplex('아파트'),/아파트명을 입력/);assert.deepEqual(f.typed,['없는단지','없는단','없는']);
  await assert.rejects(f.naver.searchComplex('가'.repeat(101)),/100자 이내/);
});

test('철자가 비슷한 단지는 짧은 이름으로 다시 찾고 사용자가 선택할 추천 후보로 반환한다',async t=>{
  let clock=0;t.mock.method(Date,'now',()=>clock+=1000);const f=fixture({typo:true});
  const results=await f.naver.searchComplex('문래대륌아파트');assert.deepEqual(f.typed,['문래대륌','문래대']);assert.equal(results[0].complexName,'문래대림');assert.equal(results[0].suggested,true);assert.equal(f.details.length,0);
});

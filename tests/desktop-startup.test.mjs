import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function loader(){
  const module={exports:{}};const waits=[];
  vm.runInNewContext(await fs.readFile('desktop/startup.cjs','utf8'),{module,console:{warn(){}},setTimeout:(fn,ms)=>{waits.push(ms);fn();}});
  return {...module.exports,waits};
}
test('처음부터 열린 화면은 다시 불러오지 않는다',async()=>{
  const {loadStudio,waits}=await loader();let loads=0;
  await loadStudio({isDestroyed:()=>false,loadURL:async url=>{assert.equal(url,'http://127.0.0.1:4317/');loads++;}},'http://127.0.0.1:4317/');
  assert.equal(loads,1);assert.deepEqual(waits,[]);
});
test('내부 연결 프로세스가 재시작되면 같은 화면을 기다렸다가 다시 연다',async()=>{
  for(const code of ['ERR_FAILED','ERR_NETWORK_CHANGED','ERR_CONNECTION_RESET','ERR_CONNECTION_REFUSED']){
    const {loadStudio,waits}=await loader();let loads=0;
    await loadStudio({isDestroyed:()=>false,loadURL:async()=>{if(++loads<3)throw Object.assign(new Error('일시 연결 실패'),{code});}},'http://127.0.0.1:4317/');
    assert.equal(loads,3);assert.deepEqual(waits,[1500,1500]);
  }
});
test('지속된 연결 오류와 다른 오류는 무한 반복하지 않고 알린다',async()=>{
  for(const [code,expected] of [['ERR_FAILED',3],['ERR_FILE_NOT_FOUND',1],['ERR_CERT_AUTHORITY_INVALID',1],['ERR_ABORTED',1]]){
    const {loadStudio}=await loader();let loads=0;const error=Object.assign(new Error('연결 실패'),{code});
    await assert.rejects(loadStudio({isDestroyed:()=>false,loadURL:async()=>{loads++;throw error;}},'http://127.0.0.1:4317/'),e=>e===error);
    assert.equal(loads,expected);
  }
});
test('시작 중 사용자가 창을 닫으면 다시 열거나 오류창을 띄우지 않는다',async()=>{
  const {loadStudio,waits}=await loader();let closed=false,loads=0;
  await loadStudio({isDestroyed:()=>closed,loadURL:async()=>{loads++;closed=true;throw Object.assign(new Error('창 닫힘'),{code:'ERR_FAILED'});}},'http://127.0.0.1:4317/');
  assert.equal(loads,1);assert.deepEqual(waits,[]);
});

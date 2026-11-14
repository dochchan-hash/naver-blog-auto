import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

async function loader(){
  const module={exports:{}};const waits=[];
  vm.runInNewContext(await fs.readFile('desktop/startup.cjs','utf8'),{module,require,console:{warn(){}},setTimeout:(fn,ms)=>{waits.push(ms);fn();}});
  return {...module.exports,waits};
}

test('작업 표시줄에서 직접 실행해도 실행 스크립트와 같은 원고·브라우저 저장 폴더를 사용한다',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-pinned-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const {studioPaths}=await loader(),dataDir=path.join(root,'.local'),userData=path.join(root,'appdata');
  await fs.mkdir(dataDir);await fs.writeFile(path.join(dataDir,'studio.sqlite'),'saved');await fs.writeFile(path.join(root,'레몬하우스 실행.cmd'),'launcher');
  const options={packaged:true,exePath:path.join(root,'release','win-unpacked','Lemonhouse Blog Studio.exe'),projectRoot:'inside-app.asar',userData};
  const direct=studioPaths(options),script=studioPaths({...options,dataDir});
  assert.equal(direct.dataDir,dataDir);assert.equal(direct.userData,path.join(dataDir,'desktop'));assert.deepEqual(direct,script);
  assert.equal(await fs.readFile(path.join(dataDir,'studio.sqlite'),'utf8'),'saved');
  const custom=path.join(root,'custom');assert.equal(studioPaths({...options,dataDir:custom}).dataDir,custom);
  assert.equal(studioPaths({...options,packaged:false,projectRoot:root}).dataDir,dataDir);
  await fs.rm(path.join(root,'레몬하우스 실행.cmd'));
  assert.equal(studioPaths(options).dataDir,path.join(userData,'workspace'));assert.equal(studioPaths(options).userData,userData);
  await fs.writeFile(path.join(root,'레몬하우스 실행.cmd'),'launcher');await fs.rm(path.join(dataDir,'studio.sqlite'));
  assert.equal(studioPaths(options).dataDir,path.join(userData,'workspace'));
  assert.equal(studioPaths({...options,exePath:path.join(root,'installed','app.exe')}).dataDir,path.join(userData,'workspace'));
});
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

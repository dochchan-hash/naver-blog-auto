import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from '../server/index.mjs';
import {localApi} from '../scripts/local-api.mjs';

test('PSD 편집 글꼴은 OS에 설치하지 않아도 앱에서 불러온다',async()=>{
  await promisify(execFile)(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {GlobalFonts} from '@napi-rs/canvas';
    assert(!GlobalFonts.families.some(f=>f.family==='Pretendard'));
    await import('./server/completion-templates.mjs');
    for(const name of ['Pretendard','Freesentation','Gmarket Sans','KoPubWorldDotum'])assert(GlobalFonts.families.some(f=>f.family===name),name);
  `],{env:{...process.env,DISABLE_SYSTEM_FONTS_LOAD:'1'}});
});

test('미리보기 글꼴은 허용된 제품·굵기만 제공하고 경로와 상속 속성은 거부한다',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-fonts-')),runtime=await createServer({dataDir:dir,port:0});
  t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  await localApi(runtime.url);
  for(const weight of [300,400,500,600,700]){
    const response=await fetch(runtime.url+'/api/template-font/'+weight+'?family=pretendard');assert.equal(response.status,200);assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,4).toString(),'OTTO');
  }
  assert.equal((await fetch(runtime.url+'/api/template-font/400')).status,200);
  for(const suffix of ['300','toString','400?family=../../','400?family=unknown','400?family=pretendard&family=freesentation','800?family=pretendard'])assert.equal((await fetch(runtime.url+'/api/template-font/'+suffix)).status,404,suffix);
});

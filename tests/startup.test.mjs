import test from 'node:test';
import assert from 'node:assert/strict';
import {Server} from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../server/index.mjs';

test('자동 할당 주소가 브라우저 차단 포트면 닫고 사용 가능한 주소로 다시 연다',async t=>{
  const address=Server.prototype.address;let first;
  t.mock.method(Server.prototype,'address',function(){const actual=address.call(this);if(!first&&actual&&typeof actual==='object'){first=this;return {...actual,port:6000};}return actual;});
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-startup-')),runtime=await createServer({dataDir:dir,port:0});
  t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  assert.notEqual(runtime.server,first);assert.equal(first.listening,false);assert.notEqual(new URL(runtime.url).port,'6000');assert.equal((await fetch(runtime.url+'/api/bootstrap')).status,200);
});

import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const exec=promisify(execFile);
const executable=path.resolve(process.argv[2]||'release/mac-arm64/Lemonhouse Blog Studio.app/Contents/MacOS/Lemonhouse Blog Studio');
await fs.access(executable);
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lemonhouse-package-check-'));
const child=spawn(executable,[],{env:{...process.env,LEMONHOUSE_DATA_DIR:directory},stdio:['ignore','ignore','pipe']});
let errors='';child.stderr.on('data',chunk=>{errors+=chunk.toString();});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  let base='';const started=Date.now();
  while(Date.now()-started<25000){
    if(child.exitCode!==null)throw new Error(`배포 앱이 준비 전에 종료되었습니다 (${child.exitCode}). ${errors.slice(-700)}`);
    const {stdout}=await exec('/usr/sbin/lsof',['-nP','-a','-p',String(child.pid),'-iTCP','-sTCP:LISTEN']).catch(()=>({stdout:''}));
    const port=stdout.match(/127\.0\.0\.1:(\d+)/)?.[1];if(port){base=`http://127.0.0.1:${port}`;break;}await wait(300);
  }
  if(!base)throw new Error('배포 앱의 로컬 서비스가 준비되지 않았습니다.');
  const health=await (await fetch(base+'/api/health')).json();
  const initial=await fetch(base+'/api/bootstrap'),bootstrap=await initial.json();
  const page=await fetch(base+'/');const html=await page.text();
  if(!health.ok||!health.desktop||!Array.isArray(bootstrap.projects)||bootstrap.auth.connected||!html.includes('레몬하우스'))throw new Error('배포 앱 초기 상태를 확인하지 못했습니다.');
  const connection=await fetch(base+'/api/naver/login',{method:'POST',headers:{cookie:initial.headers.get('set-cookie').split(';')[0],'X-Lemon-CSRF':bootstrap.csrf,'Content-Type':'application/json',Origin:base},body:'{}'});
  if(!connection.ok)throw new Error('별도 검증 공간에서 네이버 창을 열지 못했습니다.');
  console.log(JSON.stringify({packagedStartup:true,desktopRuntime:true,webPageLoaded:page.ok,independentTestData:true,userCredentialsUsed:false,naverWindowOpened:true}));
}finally{
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await Promise.race([exited,wait(8000)]);
  if(child.exitCode===null&&child.signalCode===null){child.unref();child.stderr.destroy();throw new Error('네이버 창이 열린 앱의 정상 종료를 확인하지 못했습니다. 강제 종료하지 않았습니다.');}
  console.log(JSON.stringify({packagedShutdown:true,naverWindowClosed:true,forcedTermination:false}));
  await fs.rm(directory,{recursive:true,force:true});
}

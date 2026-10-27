import {fork} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const directory=fileURLToPath(new URL('./construction/',import.meta.url));
export class Construction {
  constructor(dataDir,getCookies=null){this.dataDir=path.join(dataDir,'construction');this.getCookies=getCookies;this.child=null;this.pending=null;this.browserBusy=false;this.loginSignature='';}
  start(){
    if(this.pending)return this.pending;
    const secret=randomBytes(32).toString('hex');
    this.pending=new Promise((resolve,reject)=>{
      const child=this.child=fork(path.join(directory,'runtime.cjs'),[],{execArgv:[],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
      let ready=false,detail='';
      child.stderr.on('data',chunk=>{detail=(detail+chunk).slice(-2000);});
      const timer=setTimeout(()=>{child.kill();reject(new Error('공사전·공사중 연결 시간이 초과됐습니다. 다시 열어 주세요.'));},15000);
      child.on('message',message=>{
        if(message.browserBusy!==undefined)this.browserBusy=message.browserBusy;
        if(message.port){ready=true;clearTimeout(timer);resolve({port:message.port,secret});}
        if(message.error){clearTimeout(timer);reject(new Error(message.error));child.kill();}
      });
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',()=>{clearTimeout(timer);this.child=null;this.pending=null;this.browserBusy=false;this.loginSignature='';if(!ready)reject(new Error('공사전·공사중 실행 실패: '+detail.trim()));});
      child.send({dataDir:this.dataDir,secret});
    });
    return this.pending;
  }
  async proxy(req,res,next){
    try{
      const {port,secret}=await this.start();
      if(this.getCookies){
        const cookies=await this.getCookies(),body=JSON.stringify({cookies}),signature=createHash('sha256').update(body).digest('hex');
        if(signature!==this.loginSignature){
          const result=await fetch(`http://127.0.0.1:${port}/session`,{method:'POST',headers:{'x-construction-secret':secret,'Content-Type':'application/json'},body});
          if(!result.ok)throw new Error('기존 네이버 로그인 연결을 확인해 주세요.');
          this.loginSignature=signature;
        }
      }
      const headers={'x-construction-secret':secret};
      for(const name of ['content-type','content-length'])if(req.headers[name])headers[name]=req.headers[name];
      const upstream=http.request({hostname:'127.0.0.1',port,path:req.originalUrl,method:req.method,headers},response=>{
        res.status(response.statusCode);
        for(const name of ['content-type','content-length','cache-control','content-disposition'])if(response.headers[name])res.setHeader(name,response.headers[name]);
        response.on('error',error=>res.destroy(error));response.pipe(res);
      });
      upstream.on('error',next);
      req.on('aborted',()=>upstream.destroy());
      res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});
      req.pipe(upstream);
    }catch(error){error.status=503;next(error);}
  }
  html(csrf,kind='before'){return fs.readFileSync(path.join(directory,'public','cafe.html'),'utf8').replace('__LEMON_CSRF__',JSON.stringify(csrf)).replace('__CONSTRUCTION_KIND__',JSON.stringify(kind)).replaceAll('__CONSTRUCTION_LABEL__',kind==='during'?'공사중':'공사전');}
  async close(){
    const child=this.child;if(!child)return;
    await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
  }
}

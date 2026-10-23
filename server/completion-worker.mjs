import {fork} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {renderCompletionLayout} from './completion-templates.mjs';
import {jobSignal} from './jobs.mjs';

export function renderCompletionImage(input){
  return new Promise((resolve,reject)=>{
    const worker=fork(new URL(import.meta.url),[],{execArgv:[],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],signal:jobSignal()});
    let result,error;
    worker.once('message',message=>{result=message.result;if(message.error)error=Object.assign(new Error(message.error.message),{status:message.error.status});});
    worker.once('error',reject);
    worker.once('close',code=>result&&code===0?resolve(result):reject(error||new Error('PSD 이미지 생성이 종료됐습니다. 원본은 보존했습니다. 다시 시도해 주세요. (코드 '+code+')')));
    worker.send(input,err=>{if(err){worker.kill();reject(err);}});
  });
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  process.once('message',async({template,slot,project,assets,root,edge})=>{
    let message;
    try{
      const result=await renderCompletionLayout(template,slot,project,assets,rel=>path.join(root,rel));
      const preview=await sharp(result.buffer,{limitInputPixels:268_402_689}).resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).jpeg({quality:72,mozjpeg:true}).toBuffer();
      message={result:{...result,preview}};
    }catch(error){message={error:{message:error.message,status:error.status}};}
    process.send(message,error=>process.exit(error?1:0));
  });
}

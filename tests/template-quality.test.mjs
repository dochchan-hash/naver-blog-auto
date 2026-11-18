import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {renderCompletionLayout} from '../server/completion-templates.mjs';
import {createServer} from '../server/index.mjs';
import {localApi} from '../scripts/local-api.mjs';

async function fixture(t,width=128,height=96){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-quality-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'template'));
 await sharp({create:{width,height,channels:4,background:'#ffffff'}}).png().toFile(path.join(dir,'template/mask.png'));
 const element={id:'photo',name:'사진칸',kind:'photo',x:0,y:0,width,height,file:'mask.png',opacity:1};
 return {dir,template:{id:'template',layouts:[{id:'main',position:'cover',width,height,elements:[element]}]},slot:{id:'slot',templateId:'template',layoutId:'main',position:'cover',photoIds:['photo'],edits:{}},project:{id:'project'},photo:{id:'photo',projectId:'project',role:'template-photo',status:'ready',hash:'source',originalPath:'photo.png',previewPath:'wrong-preview.png'}};
}
test('원본 축소는 미세 입자·무늬를 그대로 샘플링해 거친 모아레로 만들지 않는다',async t=>{
 const f=await fixture(t),width=1024,height=768,data=Buffer.alloc(width*height*3);let seed=7;
 for(let i=0;i<data.length;i+=3){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const value=100+(seed>>>24)%56;data[i]=data[i+1]=data[i+2]=value;}
 const original=await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer();await fs.writeFile(path.join(f.dir,'photo.png'),original);
 await sharp({create:{width:32,height:24,channels:3,background:'#ff00ff'}}).png().toFile(path.join(f.dir,'wrong-preview.png'));
 const result=await renderCompletionLayout(f.template,f.slot,f.project,[f.photo],p=>path.join(f.dir,p)),decoded=await sharp(result.buffer).removeAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(result.missing.length,0);assert.equal(decoded.info.width,128);assert.equal(decoded.info.height,96);
 let sum=0,squares=0,n=0;for(let y=12;y<84;y++)for(let x=12;x<116;x++){const v=decoded.data[(y*128+x)*3];sum+=v;squares+=v*v;n++;}
 assert(Math.sqrt(squares/n-(sum/n)**2)<4,'기본 보간의 축소 입자가 남았습니다.');assert(sum/n>120&&sum/n<135,'축소 미리보기를 원본 대신 썼습니다.');assert((await fs.readFile(path.join(f.dir,'photo.png'))).equals(original));
});
test('JPG 제작 시 가는 색 경계를 색상 다운샘플링으로 뭉개지 않는다',async t=>{
 const f=await fixture(t,128,96),data=Buffer.alloc(128*96*3);
 for(let y=0;y<96;y++)for(let x=0;x<128;x++){const offset=(y*128+x)*3;data[offset]=x%2?0:255;data[offset+2]=x%2?255:0;}
 await sharp(data,{raw:{width:128,height:96,channels:3}}).png().toFile(path.join(f.dir,'photo.png'));
 const result=await renderCompletionLayout(f.template,f.slot,f.project,[f.photo],p=>path.join(f.dir,p)),metadata=await sharp(result.buffer).metadata(),decoded=await sharp(result.buffer).removeAlpha().raw().toBuffer();assert.equal(metadata.chromaSubsampling,'4:4:4');
 for(let x=32;x<48;x++){const offset=(48*128+x)*3;assert(decoded[offset+(x%2?2:0)]>230);assert(decoded[offset+(x%2?0:2)]<30);}
});
test('제작 원본 URL은 재제작 후 갱신되고 네이버 전달 파일은 원본 바이트를 유지한다',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-quality-api-')),runtime=await createServer({dataDir:dir,port:0});t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
 const {request}=await localApi(runtime.url),p=runtime.store.createProject('completion');await fs.mkdir(runtime.assets.resolve('template'),{recursive:true});
 await sharp({create:{width:128,height:96,channels:4,background:'#ffffff'}}).png().toFile(runtime.assets.resolve('template/mask.png'));
 const layout={id:'main',position:'cover',width:128,height:96,elements:[{id:'photo',name:'사진칸',kind:'photo',x:0,y:0,width:128,height:96,file:'mask.png',opacity:1}]};
 runtime.store.put('asset','template',{id:'template',role:'template',projectId:'completion-templates',templateKind:'completion',templateVersion:3,status:'ready',layouts:[layout]});
 const original=await sharp({create:{width:1024,height:768,channels:3,background:'#0066cc'}}).png().toBuffer(),form=new FormData();form.append('file',new Blob([original]),'original.png');
 const photo=await request(`/projects/${p.id}/assets?role=template-photo&classify=false`,'POST',form);await runtime.assets.queue;
 const slot={id:'slot',name:'표지',position:'cover',templateId:'template',layoutId:'main',photoIds:[photo.id],edits:{}};runtime.store.updateProject(p.id,{completionTemplates:[slot]});
 await runtime.templates.render(p.id);const first=runtime.store.assets(p.id).find(a=>a.templateSlotId==='slot');assert.equal((await sharp(runtime.assets.resolve(first.originalPath)).metadata()).width,128);
 const originalJpg=await fs.readFile(runtime.assets.resolve(first.originalPath)),file=await runtime.assets.originalForUpload(runtime.store.get('asset',first.id));assert.equal(file,runtime.assets.resolve(first.originalPath));assert((await fs.readFile(file)).equals(originalJpg));assert((await fs.readFile(runtime.assets.resolve(runtime.store.get('asset',photo.id).originalPath))).equals(original));
 runtime.store.updateProject(p.id,{completionTemplates:[{...slot,overlays:[{id:'extra',text:'',x:0,y:0,width:20,height:20,fontSize:12,backgroundColor:'#ff0000'}]}]});await runtime.templates.render(p.id);
 const next=runtime.store.assets(p.id).find(a=>a.templateSlotId==='slot');assert.equal(next.id,first.id);assert.notEqual(next.originalUrl,first.originalUrl);assert(next.originalUrl.includes(next.hash));
 const boot=await fetch(runtime.url+'/api/bootstrap'),cookie=boot.headers.get('set-cookie').split(';')[0],download=await fetch(runtime.url+next.originalUrl,{headers:{cookie}});assert(download.ok);assert(Buffer.from(await download.arrayBuffer()).equals(await fs.readFile(runtime.assets.resolve(next.originalPath))));
 await fs.mkdir(runtime.assets.resolve('scope'),{recursive:true});const scopeBytes=await sharp({create:{width:128,height:128,channels:3,background:'#0066cc'}}).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();await fs.writeFile(runtime.assets.resolve('scope/original.jpg'),scopeBytes);
 const scope={id:'scope',templateOutput:'scope',originalPath:'scope/original.jpg'};assert.equal(await runtime.assets.planPhotoForUpload(scope),runtime.assets.resolve(scope.originalPath));assert((await fs.readFile(runtime.assets.resolve(scope.originalPath))).equals(scopeBytes));
});

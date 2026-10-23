import fs from 'node:fs';
import {promises as fsp} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import Busboy from 'busboy';
import sharp from 'sharp';
import {readTemplate} from './templates.mjs';
import {compileCompletionTemplate} from './completion-templates.mjs';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
globalThis.DOMMatrix ||= DOMMatrix;globalThis.ImageData ||= ImageData;globalThis.Path2D ||= Path2D;
const fileError=message=>Object.assign(new Error(message),{status:400});
export function detectMime(head) {
  if(head.length>=6&&head.subarray(0,4).toString()==='8BPS'&&head.readUInt16BE(4)===1)return 'image/vnd.adobe.photoshop';
  if(head.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
  if(head[0]===0xff&&head[1]===0xd8&&head[2]===0xff)return 'image/jpeg';
  if(head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(head.subarray(0,4).toString()==='RIFF'&&head.subarray(8,12).toString()==='WEBP')return 'image/webp';
  if(head.length>=12&&head.subarray(4,8).toString()==='ftyp'&&/^(?:isom|iso[2-9]|avc1|mp4[12]|M4V |qt  )$/.test(head.subarray(8,12).toString()))return head.subarray(8,12).toString()==='qt  '?'video/quicktime':'video/mp4';
  return null;
}
export class Assets {
  constructor(store){this.store=store;this.root=path.join(store.dir,'files');fs.mkdirSync(this.root,{recursive:true,mode:0o700});this.queue=Promise.resolve();for(const a of store.assets())if(a.status==='processing')this.queue=this.queue.then(()=>this.process(a.id)).catch(()=>{});}
  resolve(rel){const result=path.resolve(this.root,rel);if(!result.startsWith(this.root+path.sep))throw fileError('잘못된 파일 경로입니다.');return result;}
  async originalForUpload(asset){
    const source=this.resolve(asset.originalPath);if(path.extname(source))return source;
    const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[asset.mime];if(!extension)throw fileError('게시할 사진 원본을 확인해 주세요.');
    const destination=this.resolve(`${asset.id}/original.${extension}`);
    try {await fsp.copyFile(source,destination,fs.constants.COPYFILE_EXCL);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const digest=async file=>{const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');};
      const [originalHash,existingHash]=await Promise.all([digest(source),digest(destination)]);
      if(originalHash!==existingHash)throw fileError('게시할 사진 원본과 기존 파일이 다릅니다. 원본 파일을 확인해 주세요.');
    }
    return destination;
  }
  async upload(req,projectId,role) {
    if(!this.store.get('project',projectId))throw fileError('원고를 먼저 선택해 주세요.');
    if(!['photo','construction','floorplan-original','floorplan-target','template','video'].includes(role))throw fileError('첨부 영역을 확인해 주세요.');
    if(role==='video'&&this.store.get('project',projectId).postType!=='completion')throw fileError('동영상은 카페 마감에 첨부해 주세요.');
    if(role==='template'&&!['case','completion'].includes(this.store.get('project',projectId).postType))throw fileError('PSD 템플릿은 시공사례 또는 마감에 첨부해 주세요.');
    const id=randomUUID(),folder=this.resolve(id),templateLimit=this.store.get('project',projectId).postType==='completion'?256:64;await fsp.mkdir(folder,{mode:0o700});
    const dest=path.join(folder,'original');let filename,bytes=0,hash,head=Buffer.alloc(0),work,error;
    try {
      await new Promise((resolve,reject)=>{
        let seen=false;
        const bb=Busboy({headers:req.headers,defParamCharset:'utf8',limits:{files:1,fields:0,parts:1,headerPairs:100}});
        bb.on('file',(_,file,info)=>{
          if(seen){file.resume();error=fileError('파일을 한 개씩 전송해 주세요.');return;}seen=true;filename=path.basename(info.filename||'첨부파일');
          const sha=createHash('sha256');
          const meter=new Transform({transform(chunk,enc,cb){bytes+=chunk.length;if(role==='video'&&bytes>1024*1024*1024)return cb(fileError('동영상은 1GB 이하로 선택해 주세요.'));if(role==='template'&&bytes>templateLimit*1024*1024)return cb(fileError(`PSD 템플릿은 ${templateLimit}MB 이하로 선택해 주세요.`));sha.update(chunk);if(head.length<16)head=Buffer.concat([head,chunk]).subarray(0,16);cb(null,chunk);}});
          work=pipeline(file,meter,fs.createWriteStream(dest,{mode:0o600})).then(()=>{hash=sha.digest('hex');}).catch(e=>{error=e;});
        });
        bb.on('filesLimit',()=>{error=fileError('파일을 한 개씩 전송해 주세요.');});
        bb.on('error',reject);req.on('aborted',()=>reject(fileError('전송이 중단되었습니다. 다시 첨부해 주세요.')));
        bb.on('close',async()=>{await work;if(error)return reject(error);if(!seen||!bytes)return reject(fileError('빈 파일은 첨부할 수 없습니다.'));resolve();});req.pipe(bb);
      });
      const mime=detectMime(head);
      if((role==='video')!==!!mime?.startsWith('video/'))throw fileError(role==='video'?'MP4 또는 MOV 동영상을 선택해 주세요.':'동영상은 마감 동영상 영역에 첨부해 주세요.');
      if(!mime)throw fileError('JPG, PNG, WEBP 사진 또는 PDF, PSD 파일을 선택해 주세요.');
      if((role==='template')!==(mime==='image/vnd.adobe.photoshop'))throw fileError(role==='template'?'PSD 템플릿 파일을 선택해 주세요.':'PSD는 시공사례 템플릿 영역에 첨부해 주세요.');
      if(role==='construction'&&!['application/pdf','image/jpeg'].includes(mime))throw fileError('공사시공내역은 PDF 또는 JPG 파일을 선택해 주세요.');
      if(role==='photo'&&mime==='application/pdf')throw fileError('현장 사진 영역에는 이미지 파일을 넣어 주세요.');
      const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf','image/vnd.adobe.photoshop':'psd','video/mp4':'mp4','video/quicktime':'mov'}[mime];
      const originalPath=`${id}/original.${extension}`;await fsp.rename(dest,this.resolve(originalPath));
      const existing=this.store.assets(projectId).filter(a=>a.role==='photo');
      const asset={id,projectId,role,filename,mime,bytes,hash,originalPath,status:'processing',space:'미분류',group:'',order:existing.length,excluded:false};
      if(role==='template'){
        const template=readTemplate(await fsp.readFile(this.resolve(originalPath)),{unmapped:this.store.get('project',projectId)?.postType==='completion'}),previewPath=`${id}/preview.jpg`;
        if(template.kind==='completion'){
          const layouts=await compileCompletionTemplate(template,folder,filename),p=this.store.get('project',projectId),slots=p.completionTemplates||[],position=layouts[0].position;
          if(slots.length>=100)throw fileError('마감 템플릿은 최대 100개까지 등록할 수 있습니다.');
          await fsp.copyFile(path.join(folder,layouts[0].previewFile),this.resolve(previewPath));
          Object.assign(asset,{projectId:'completion-templates',templateKind:'completion',templateVersion:2,status:'ready',previewPath,layouts});this.store.put('asset',id,asset);
          const blank=slots.find(s=>!s.templateId&&s.position===position),slot={id:blank?.id||randomUUID(),name:filename.replace(/\.psd$/i,''),position,space:blank?.space||'거실',templateId:id,layoutId:layouts[0].id,text:'',photoIds:[]};
          this.store.updateProject(projectId,{completionTemplates:blank?slots.map(s=>s.id===blank.id?slot:s):[...slots,slot]});this.store.put('templates','completion',{...this.store.get('templates','completion'),[position]:id});return this.store.asset(id);
        }
        const board=template.psd.children.find(l=>l.artboard)?.artboard?.rect;
        let image=sharp(template.psd.canvas.toBuffer('image/png'));if(board)image=image.extract({left:board.left,top:board.top,width:board.right-board.left,height:board.bottom-board.top});
        await image.resize({width:1000,height:1000,fit:'inside'}).jpeg({quality:85}).toFile(this.resolve(previewPath));
        Object.assign(asset,{projectId:'templates',templateKind:template.kind,status:'ready',previewPath});
        this.store.put('asset',id,asset);const key=`${template.kind}TemplateId`;this.store.put('templates','main',{...this.store.get('templates','main'),[key]:id});this.store.updateProject(projectId,{[key]:id});return this.store.asset(id);
      }
      if(role==='video')asset.status='ready';
      this.store.put('asset',id,asset);
      if(role==='video')return this.store.asset(id);
      this.queue=this.queue.then(()=>this.process(id)).catch(()=>{});
      return this.store.asset(id);
    }catch(error){await fsp.rm(folder,{recursive:true,force:true});throw error;}
  }
  async process(id) {
    const asset=this.store.get('asset',id);if(!asset)return;
    try {
      if(asset.mime==='application/pdf')await this.processPdf(asset);
      else {
        const original=this.resolve(asset.originalPath);
        const edge=asset.role==='photo'?this.store.get('settings','main').photoEdge:1800;
        const previewPath=`${id}/preview.jpg`;
        const img=sharp(original,{limitInputPixels:268_402_689}).rotate();
        const meta=await img.metadata();
        const info=await img.resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).jpeg({quality:asset.role==='photo'?72:84,mozjpeg:true}).toFile(this.resolve(previewPath));
        Object.assign(asset,{width:meta.width,height:meta.height,previewPath,previewBytes:info.size,status:'ready'});
      }
      const latest=this.store.get('asset',id);
      this.store.put('asset',id,{...asset,space:latest.space,group:latest.group,order:latest.order,excluded:latest.excluded});
    }catch(error){this.store.put('asset',id,{...this.store.get('asset',id),status:'error',warning:`원본은 저장되었습니다. 미리보기 처리 실패: ${error.message}`});}
  }
  async processPdf(asset) {
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data=new Uint8Array(await fsp.readFile(this.resolve(asset.originalPath)));
    const loading=getDocument({data,useSystemFonts:true,isEvalSupported:false,disableFontFace:true});const doc=await loading.promise;
    const pages=[];
    try {
      for(let n=1;n<=doc.numPages;n++){
        const page=await doc.getPage(n);const content=await page.getTextContent();
        let text='';let lastY=null;
        for(const item of content.items){if(!('str'in item))continue;const y=Math.round(item.transform[5]);if(lastY!==null&&Math.abs(y-lastY)>3)text+='\n';else if(text&&!text.endsWith('\n'))text+=' ';text+=item.str;if(item.hasEOL)text+='\n';lastY=y;}
        const scanned=text.replace(/\s/g,'').length<40;
        const entry={page:n,text:text.trim(),scanned};
        if(n===1||scanned){
          const initial=page.getViewport({scale:1});const scale=Math.min(2,1800/Math.max(initial.width,initial.height));const viewport=page.getViewport({scale});
          const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
          await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
          entry.imagePath=`${asset.id}/page-${n}.jpg`;
          await fsp.writeFile(this.resolve(entry.imagePath),await canvas.encode('jpeg',84),{mode:0o600});
        }
        pages.push(entry);page.cleanup();
      }
      const previewPath=pages[0]?.imagePath;
      Object.assign(asset,{pages,previewPath,previewBytes:previewPath?(await fsp.stat(this.resolve(previewPath))).size:0,status:'ready'});
    }finally{await loading.destroy();}
  }
  async imageData(asset, page) {
    const raw=this.store.get('asset',asset.id);
    const rel=page?raw.pages?.find(p=>p.page===page)?.imagePath:raw.previewPath;
    if(!rel)throw fileError('분석용 이미지가 아직 준비되지 않았습니다.');
    const data=await fsp.readFile(this.resolve(rel));return `data:image/jpeg;base64,${data.toString('base64')}`;
  }
}

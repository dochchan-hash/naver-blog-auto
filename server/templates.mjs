import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {readPsd,initializeCanvas} from 'ag-psd';
import {createCanvas,ImageData,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {caseCoverPhotos,templateSourceSignature} from '../shared/sources.mjs';
import {templateFields} from '../shared/template-fields.mjs';
import {checkCancelled} from './jobs.mjs';
import {readCompletionTemplate,refreshCompletionTextStyles} from './completion-templates.mjs';
import {renderCompletionImage} from './completion-worker.mjs';
import {completionSignature} from '../shared/completion-templates.mjs';
import {photoLayoutBlocks} from '../shared/domain.mjs';
initializeCanvas(createCanvas,undefined,(w,h)=>new ImageData(w,h));
GlobalFonts.loadSystemFonts();
const fail=message=>Object.assign(new Error(message),{status:400});
const flat=layers=>layers.flatMap(l=>l.hidden?[]:l.children?flat(l.children):[l]);
const artboardRect=psd=>psd.children?.find(l=>l.artboard)?.artboard?.rect;

export function readCoverFrame(buffer){
  const psd=readPsd(buffer,{skipLayerImageData:true,skipCompositeImageData:true,skipThumbnail:true});
  const photo=flat(psd.children||[]).find(l=>l.name==='메인사진');
  if(!photo)throw fail('표지 PSD에서 사진 영역을 찾을 수 없습니다.');
  const board=artboardRect(psd)||{left:0,top:0,right:psd.width,bottom:psd.height};
  return {width:board.right-board.left,height:board.bottom-board.top,photo:{x:photo.left-board.left,y:photo.top-board.top,width:photo.right-photo.left,height:photo.bottom-photo.top}};
}

export function readTemplate(buffer,{unmapped=false}={}){
  if(unmapped)return readCompletionTemplate(buffer);
  if(buffer.length<26||buffer.subarray(0,4).toString()!=='8BPS'||buffer.readUInt16BE(4)!==1||buffer.readUInt16BE(22)!==8||buffer.readUInt16BE(24)!==3)throw fail('RGB · 8비트 PSD 템플릿을 선택해 주세요.');
  const height=buffer.readUInt32BE(14),width=buffer.readUInt32BE(18);
  if(!width||!height||width*height>20_000_000)throw fail('템플릿 크기는 2천만 픽셀 이하로 선택해 주세요.');
  let psd;try{
    const metadata=readPsd(buffer,{skipLayerImageData:true,skipCompositeImageData:true,skipThumbnail:true});
    if(flat(metadata.children||[]).reduce((n,l)=>n+Math.max(0,l.right-l.left)*Math.max(0,l.bottom-l.top),width*height)>80_000_000)throw fail('PSD의 레이어 용량이 너무 큽니다. 사용하지 않는 레이어를 정리해 주세요.');
    psd=readPsd(buffer,{skipThumbnail:true});
  }catch(e){if(e.status)throw e;throw fail('PSD 레이어를 읽지 못했습니다. 원본 PSD 파일을 확인해 주세요.');}
  const layers=flat(psd.children||[]),texts=layers.filter(l=>l.text),photo=layers.find(l=>l.name==='메인사진');
  if(photo){
    const fields=texts.filter(l=>!/lemonhouse|레몬하우스|ⓒ/i.test(l.text.text)).sort((a,b)=>a.top-b.top);
    if(fields.length!==2||!psd.canvas)throw fail('표지의 현장명·콘셉트 레이어를 확인하지 못했습니다.');
    return {psd,kind:'cover',layers,fields,photo};
  }
  if(layers.some(l=>l.name.toLowerCase()==='project info')){
    const fields=texts.filter(l=>!/lemonhouse|레몬하우스|ⓒ|Project No\./i.test(l.text.text)).sort((a,b)=>a.top-b.top);
    if(fields.length!==6||!psd.canvas)throw fail('공사범위의 위치·면적·콘셉트·자재 레이어를 확인하지 못했습니다.');
    return {psd,kind:'scope',layers,fields};
  }
  // shortcut: supplied Lemonhouse layouts only; add mappings when another template is requested.
  throw fail('현재는 제공해 주신 시공사례 표지와 레몬리뉴얼 공사범위 PSD 양식을 지원합니다.');
}
function fitText(ctx,layer,value,width,height=0){
  const t=layer.text,s=t.style,font=s.font?.name||t.styleRuns?.[0]?.style.font?.name||'Malgun Gothic',scale=Math.abs(t.transform?.[3]||1);
  let size=(s.fontSize||20)*scale;
  const family=GlobalFonts.families.find(f=>f.styles.some(x=>x.style===font)||f.family.replace(/\s/g,'').toLowerCase()===font.replace(/(?:PL|PS)?(?:MT)?$/,'').replace(/[-\s]/g,'').toLowerCase())?.family;
  const fallback=/gmarket/i.test(font)?'Gmarket Sans':/pretendard/i.test(font)?'Pretendard':/kopub/i.test(font)?'KoPubWorldDotum':'Malgun Gothic';
  const weight=/bold/i.test(font)?700:/light/i.test(font)?300:400;
  const set=()=>{ctx.font=`${weight} ${size}px "${family||fallback}","Malgun Gothic",sans-serif`;};set();
  const text=String(value??'—').trim();
  const wrap=()=>{if(!height)return [text.replace(/[\r\n]+/g,' ')];const lines=[];for(const paragraph of text.split(/\r?\n/)){let line='';for(const c of paragraph){if(line&&ctx.measureText(line+c).width>width){lines.push(line);line='';}line+=c;}lines.push(line);}return lines;};
  let lines=wrap();
  const fits=()=>lines.every(line=>ctx.measureText(line).width<=width)&&(!height||lines.length*size*1.2<=height);
  while(!fits()&&size>18){size-=1;set();lines=wrap();}
  if(!fits())throw fail('템플릿에 들어갈 내용이 너무 깁니다. 미리보기 옆의 현장명 또는 시공내용을 줄여 주세요.');
  const color=s.fillColor||{r:34,g:34,b:34};ctx.fillStyle=`rgb(${Math.round(color.r||0)},${Math.round(color.g||0)},${Math.round(color.b||0)})`;
  ctx.textBaseline='middle';ctx.textAlign=['center','right'].includes(t.paragraphStyle?.justification)?t.paragraphStyle.justification:'left';
  const x=ctx.textAlign==='center'?(t.transform?.[4]||(layer.left+layer.right)/2):ctx.textAlign==='right'?layer.right:layer.left;
  lines.forEach((line,i)=>ctx.fillText(line,x,(layer.top+layer.bottom)/2+i*size*1.2));
}
export async function renderTemplate(template,project,photoPath,assets){
  const {psd,layers,fields,photo,kind}=template,artboard=artboardRect(psd),canvas=createCanvas(psd.width,psd.height),ctx=canvas.getContext('2d'),background=createCanvas(psd.width,psd.height),back=background.getContext('2d');
  ctx.drawImage(psd.canvas,0,0);
  for(const l of layers)if(l.canvas&&!l.text&&!l.clipping){back.globalAlpha=l.opacity??1;back.drawImage(l.canvas,l.left,l.top);}
  const replace=(l,value,width,height=0)=>{
    const x=Math.max(0,l.left-4),y=Math.max(0,l.top-4),w=Math.min(psd.width-x,l.right-l.left+8),h=l.bottom-l.top+8;
    if(kind==='cover'){const pixel=psd.canvas.getContext('2d').getImageData(x,y,1,1).data;ctx.fillStyle=`rgb(${pixel[0]},${pixel[1]},${pixel[2]})`;ctx.fillRect(x,y,w,h);}else ctx.drawImage(background,x,y,w,h,x,y,w,h);
    fitText(ctx,l,value,width,height);
  };
  const values=templateFields(project,assets);
  if(kind==='cover'){
    const w=photo.right-photo.left,h=photo.bottom-photo.top;
    const source=sharp(photoPath).autoOrient();
    const crop=project.caseCoverCrop;
    if(crop&&(crop.zoom!==1||crop.x!==0||crop.y!==0)){
      const {autoOrient:{width,height}}=await source.metadata();
      const scale=Math.max(w/width,h/height)*crop.zoom;
      const cropWidth=Math.max(1,Math.floor(w/scale)),cropHeight=Math.max(1,Math.floor(h/scale));
      source.extract({left:Math.round((width-cropWidth)*(100-crop.x)/200),top:Math.round((height-cropHeight)*(100-crop.y)/200),width:cropWidth,height:cropHeight});
    }
    const image=await loadImage(await source.resize(w,h,{fit:'cover',kernel:'lanczos3'}).png().toBuffer());
    ctx.drawImage(image,photo.left,photo.top,w,h);
    replace(fields[0],values.coverTitle,psd.width*.87);
    replace(fields[1],values.coverConcept,psd.width*.87);
  }else{
    // shortcut: the supplied scope layout reserves its bottom quarter for the brand; remap for a new layout.
    ['location','area','concept','wall','floor','other'].forEach((key,i)=>{const l=fields[i],width=Math.min((artboard?.right||psd.width)-l.left-40,(l.text.boxBounds?.[2]||500)*Math.abs(l.text.transform?.[0]||1)),bottom=artboard?artboard.top+(artboard.bottom-artboard.top)*.74:l.top+245,height=i<3?0:Math.min((l.text.boxBounds?.[3]||90)*Math.abs(l.text.transform?.[3]||1),i<5?fields[i+1].top-l.top-35:bottom-l.top-25);replace(l,values[key],width,height);});
    for(const l of layers.filter(l=>/Project No\./i.test(l.text?.text||'')))replace(l,values.scopeProject,l.right-l.left);
    for(const l of layers.filter(l=>/ⓒ|©/.test(l.text?.text||'')))replace(l,values.scopeCopyright,l.right-l.left);
  }
  const output=artboard?createCanvas(artboard.right-artboard.left,artboard.bottom-artboard.top):canvas;
  if(artboard)output.getContext('2d').drawImage(canvas,artboard.left,artboard.top,output.width,output.height,0,0,output.width,output.height);
  return sharp(output.toBuffer('image/png')).jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();
}

export class Templates {
  constructor(store,assets){Object.assign(this,{store,assets});}
  async refreshCompletionStyles(){
    for(const asset of this.store.assets().filter(a=>a.templateKind==='completion'&&a.layouts?.length&&a.templateVersion!==3)){
      try{const layouts=refreshCompletionTextStyles(await fs.readFile(this.assets.resolve(asset.originalPath)),asset.layouts);this.store.put('asset',asset.id,{...asset,layouts,templateVersion:3});}
      catch(error){this.store.put('asset',asset.id,{...asset,warning:'PSD 원본 서식을 다시 읽지 못했습니다. 원본은 보존했습니다. '+error.message});}
    }
  }

  async render(projectId,update=()=>{},{skipScope=false,slotId}={}){
    await this.assets.queue;const project=this.store.get('project',projectId);
    if(project?.postType==='completion')return this.renderCompletion(project,update,slotId);
    if(project?.postType!=='case')throw fail('시공사례에서 템플릿 이미지를 만들 수 있습니다.');
    if(!project.original.name.trim())throw fail('시공 현장명을 먼저 입력해 주세요.');
    const all=this.store.assets(),projectAssets=all.filter(a=>a.projectId===projectId),photos=caseCoverPhotos(projectAssets).filter(a=>a.status==='ready'),photo=photos.find(a=>a.id===(project.templatePhotoId||project.coverAssetId))||photos[0];
    if(!photo)throw fail('표지에 사용할 현장 사진을 첨부해 주세요.');
    const input={...project,templatePhotoId:photo.id},signature=templateSourceSignature(input,projectAssets),outputs=[];
    let scopeError;for(const kind of skipScope?['cover']:['cover','scope'])try{
      const id=input[`${kind}TemplateId`];if(!id){if(kind==='cover')throw fail('표지 PSD 템플릿을 첨부해 주세요.');continue;}
      const asset=all.find(a=>a.id===id&&a.role==='template'&&a.templateKind===kind&&a.status==='ready');if(!asset)throw fail('사용할 PSD 템플릿을 다시 선택해 주세요.');
      update({message:kind==='cover'?'현장 사진과 이름으로 표지를 만들고 있습니다.':'현재 현장의 공사범위 이미지를 만들고 있습니다.',progress:kind==='cover'?20:65});checkCancelled();
      outputs.push({kind,buffer:await renderTemplate(readTemplate(await fs.readFile(this.assets.resolve(asset.originalPath))),input,this.assets.resolve(photo.originalPath),all)});
    }catch(e){checkCancelled();if(kind==='cover')throw e;scopeError=e;}
    const plan=projectAssets.find(a=>a.id===input.original.floorplanAssetId&&a.role==='floorplan-original'&&a.status==='ready');
    if(plan)outputs.push({kind:'floorplan',buffer:await fs.readFile(this.assets.resolve(plan.previewPath))});
    checkCancelled();let coverAssetId='';
    for(const {kind,buffer} of outputs){
      const old=projectAssets.find(a=>a.templateOutput===kind),id=old?.id||randomUUID();
      await fs.mkdir(this.assets.resolve(id),{recursive:true});const originalPath=`${id}/original.jpg`,temporary=this.assets.resolve(`${id}/render.tmp`);await fs.writeFile(temporary,buffer);await fs.rename(temporary,this.assets.resolve(originalPath));
      this.store.put('asset',id,{...old,id,projectId,role:'photo',filename:`${input.original.name} ${kind==='cover'?'표지':kind==='scope'?'공사범위':'도면'}.jpg`,mime:'image/jpeg',bytes:buffer.length,hash:createHash('sha256').update(buffer).digest('hex'),originalPath,status:'processing',space:kind==='cover'?'표지':'도면',spaceManual:true,group:kind==='cover'?'':'interior-plan',order:kind==='floorplan'?0:kind==='scope'?1:0,excluded:false,templateOutput:kind,templateSignature:signature});
      await this.assets.process(id);if(this.store.get('asset',id).status!=='ready')throw fail('완성 이미지의 미리보기를 만들지 못했습니다. 다시 시도해 주세요.');if(kind==='cover')coverAssetId=id;
    }
    if(!plan)for(const a of projectAssets.filter(a=>a.templateOutput==='floorplan'))this.store.put('asset',a.id,{...a,excluded:true});
    if(!input.scopeTemplateId)for(const a of projectAssets.filter(a=>a.templateOutput==='scope'))this.store.put('asset',a.id,{...a,excluded:true});
    const saved=this.store.updateProject(projectId,{templatePhotoId:photo.id,coverAssetId,...(scopeError?{templateWarning:`공사범위 이미지 생성 실패: ${scopeError.message}`}:{})});
    if(scopeError)throw fail(`표지는 만들었습니다. 공사범위: ${scopeError.message}`);
    update({message:'이미지를 완성했습니다. 미리보기와 JPG 파일을 확인해 주세요.',progress:100});return {project:saved,assets:this.store.assets(projectId)};
  }
  async renderCompletion(project,update,slotId){
    const slots=(project.completionTemplates||[]).filter(s=>s.enabled!==false&&s.templateId&&(!slotId||s.id===slotId));if(!slots.length)throw fail('수정할 마감 PSD 템플릿을 선택해 주세요.');
    const all=this.store.assets(),created=[];let coverAssetId=project.coverAssetId;
    for(const [index,slot]of slots.entries()){
      const template=all.find(a=>a.id===slot.templateId&&a.templateKind==='completion'&&a.status==='ready');if(!template?.layouts?.length)throw fail('마감 PSD를 다시 등록해 레이아웃을 읽어 주세요.');
      update({message:`${slot.name} 이미지를 만듭니다.`,progress:10+Math.round(index/slots.length*75)});
      const {buffer,preview,missing,layout}=await renderCompletionImage({template,slot,project,assets:all,root:this.assets.root,edge:this.store.get('settings','main').photoEdge});checkCancelled();
      const previous=all.find(a=>a.projectId===project.id&&a.templateSlotId===slot.id),id=previous?.id||randomUUID(),originalPath=`${id}/original.jpg`,previewPath=`${id}/preview.jpg`;
      await fs.mkdir(this.assets.resolve(id),{recursive:true});await fs.writeFile(this.assets.resolve(`${id}/render.tmp`),buffer);await fs.rename(this.assets.resolve(`${id}/render.tmp`),this.assets.resolve(originalPath));
      await fs.writeFile(this.assets.resolve(`${id}/preview.tmp`),preview);await fs.rename(this.assets.resolve(`${id}/preview.tmp`),this.assets.resolve(previewPath));
      const space={cover:'표지',scope:'공사범위',beforeAfter:'시공전후',closing:'마무리',space:slot.space}[slot.position];
      this.store.put('asset',id,{...previous,id,projectId:project.id,role:'photo',filename:`${project.original.name||'현장'} ${slot.name}.jpg`,mime:'image/jpeg',bytes:buffer.length,hash:createHash('sha256').update(buffer).digest('hex'),originalPath,previewPath,previewBytes:preview.length,status:'ready',space,spaceManual:true,group:'',order:(project.completionTemplates||[]).indexOf(slot),excluded:missing.length>0,templateOutput:'completion',templateSlotId:slot.id,templateIncomplete:missing,templateSignature:completionSignature(slot,all),width:layout.width,height:layout.height});
      created.push(id);
      if(slot.position==='cover'&&!missing.length)coverAssetId=id;
    }
    const active=new Set((project.completionTemplates||[]).filter(s=>s.enabled!==false).map(s=>s.id));for(const a of all.filter(a=>a.projectId===project.id&&a.templateOutput==='completion'&&!active.has(a.templateSlotId)))this.store.put('asset',a.id,{...a,excluded:true});
    const next={...project,coverAssetId},assets=this.store.assets(project.id),activePhotos=assets.filter(a=>a.role==='photo'&&!a.excluded),written=project.blocks.filter(b=>b.kind==='photos').flatMap(b=>b.assetIds),samePhotos=activePhotos.length===written.length&&activePhotos.every(a=>written.includes(a.id)),saved=this.store.updateProject(project.id,{coverAssetId,...(project.blocks.length?{blocks:samePhotos?project.blocks:photoLayoutBlocks(next,assets)}:{})});
    update({message:'변경 내용을 적용했습니다. 사진칸과 JPG 미리보기를 확인해 주세요.',progress:100});return {project:saved,assets,created};
  }
}

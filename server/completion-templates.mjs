import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPsd,getLayerCanvas,getCompositeCanvas,initializeCanvas} from 'ag-psd';
import {createCanvas,ImageData,loadImage,GlobalFonts} from '@napi-rs/canvas';
import {completionText,completionPhotos,completionBands,completionMarkers,completionMarkerSprites,isCompletionMarker,completionPhotoPlacement,drawCompletionText} from '../shared/completion-templates.mjs';
import {checkCancelled} from './jobs.mjs';
initializeCanvas(createCanvas,undefined,(w,h)=>new ImageData(w,h));
for(const face of ['4Regular','5Medium','7Bold'])GlobalFonts.registerFromPath(fileURLToPath(new URL('./fonts/freesentation/Freesentation-'+face+'.ttf',import.meta.url)));
for(const face of ['Light','Regular','Medium','SemiBold','Bold'])GlobalFonts.registerFromPath(fileURLToPath(new URL('./fonts/pretendard/Pretendard-'+face+'.otf',import.meta.url)));
for(const file of ['gmarket/GmarketSansLight.otf','gmarket/GmarketSansMedium.otf','kopub/KoPubWorld Dotum Light.ttf'])GlobalFonts.registerFromPath(fileURLToPath(new URL('./fonts/'+file,import.meta.url)));
const fail=message=>Object.assign(new Error(message),{status:400});
const leaves=(layers,prefix='')=>layers.flatMap((layer,i)=>layer.hidden?[]:layer.children?leaves(layer.children,prefix+i+'.'):[{layer,id:prefix+i}]);
export function readCompletionTemplate(buffer){
  if(buffer.length>256*1024*1024||buffer.length<26||buffer.subarray(0,4).toString()!=='8BPS'||buffer.readUInt16BE(4)!==1||buffer.readUInt16BE(22)!==8||buffer.readUInt16BE(24)!==3)throw fail('256MB 이하 RGB · 8비트 PSD를 선택해 주세요.');
  const width=buffer.readUInt32BE(18),height=buffer.readUInt32BE(14);if(!width||!height||width*height>64_000_000)throw fail('PSD 전체 크기는 6천4백만 픽셀 이하여야 합니다.');
  const psd=readPsd(buffer,{useRawData:true,skipThumbnail:true});
  const layers=leaves(psd.children||[]);if(layers.length>1000||layers.some(({layer:l})=>(l.right-l.left)*(l.bottom-l.top)>80_000_000))throw fail('PSD 레이어 크기가 처리 범위를 넘습니다.');
  // shortcut: supplied layouts use normal raster layers; reject extra blending or pixel masks until another layout needs them.
  if(layers.some(({layer:l})=>l.mask||l.realMask||l.blendMode&&l.blendMode!=='normal'))throw fail('현재는 일반 혼합 레이어와 클리핑마스크 PSD를 지원합니다. 추가 혼합 효과·레이어 마스크를 확인해 주세요.');
  return {kind:'completion',psd,layers};
}
const hex=c=>'#'+['r','g','b'].map(k=>Math.round(c?.[k]||0).toString(16).padStart(2,'0')).join('');
function textStyle(layer){
  const t=layer.text,s={...t.style,...[...(t.styleRuns||[])].sort((a,b)=>b.length-a.length)[0]?.style},scale=Math.abs(t.transform?.[3]||1),font=s.font?.name||'Malgun Gothic';
  const baseline=s.fontBaseline===1?t.superscriptSize??.583:s.fontBaseline===2?t.subscriptSize??.583:1,size=(s.fontSize||20)*scale*baseline;
  const weight=/thin/i.test(font)?100:/extralight/i.test(font)?200:/light/i.test(font)?300:/medium/i.test(font)?500:/semibold/i.test(font)?600:/extrabold/i.test(font)?800:/black|heavy/i.test(font)?900:/bold/i.test(font)?700:400;
  const first={...t.style,...t.styleRuns?.[0]?.style};
  return {fontFamily:font,fontSize:size,fontWeight:weight,color:hex(s.fillColor),align:['center','right'].includes(t.paragraphStyle?.justification)?t.paragraphStyle.justification:'left',lineHeight:first.autoLeading?size*(t.paragraphStyle?.autoLeading||1.2):(first.leading||first.fontSize*1.3||26)*scale,letterSpacing:(s.tracking||0)/1000*size};
}
function textGeometry(layer,element,layout,rect){
  const t=layer.text,transform=t.transform||[1,0,0,1,element.x+rect.left,element.y+rect.top],align=textStyle(layer).align;
  const box=t.boxBounds,sx=Math.abs(transform[0]),sy=Math.abs(transform[3]);
  const width=box?(box[2]-box[0])*sx:layout.position==='cover'?layout.width*.9:Math.max(element.width,layout.width-(transform[4]-rect.left)-40);
  const x=transform[4]-rect.left+(box?box[0]*sx:align==='center'?-width/2:align==='right'?-width:0);
  return {textX:x,textWidth:width,textHeight:Math.max(element.height+(element.fontSize||32)*.4,box?(box[3]-box[1])*sy:layout.position==='space'?layout.height-element.y-40:0)};
}
export function refreshCompletionTextStyles(buffer,layouts){
  const psd=readPsd(buffer,{skipLayerImageData:true,skipCompositeImageData:true,skipThumbnail:true});
  const boards=(psd.children||[]).map((layer,i)=>({layer,id:String(i)})).filter(b=>b.layer.artboard);
  if(!boards.length)boards.push({layer:{children:psd.children||[]},id:'main'});
  const layers=new Map(boards.flatMap(({layer,id})=>leaves(layer.children||[],id+'.')).map(({id,layer})=>[id,layer]));
  return layouts.map(layout=>{const rect=boards.find(b=>b.id===layout.id)?.layer.artboard?.rect||{left:0,top:0};return {...layout,elements:layout.elements.map(element=>{const l=layers.get(element.id);return l?.text?{...element,...textStyle(l),...textGeometry(l,element,layout,rect)}:element;})};});
}
function category(name){return /표지/.test(name)?'cover':/공사범위/.test(name)?'scope':/비포|애프터/.test(name)?'beforeAfter':/개별공사|안내/.test(name)?'closing':'space';}
export async function compileCompletionTemplate(template,folder,filename){
  const {psd}=template,position=category(filename),boards=(psd.children||[]).map((layer,i)=>({layer,id:String(i)})).filter(b=>b.layer.artboard);
  if(!boards.length)boards.push({layer:{name:'기본 레이아웃',children:psd.children,artboard:{rect:{left:0,top:0,right:psd.width,bottom:psd.height}}},id:'main'});
  if(boards.length>50)throw fail('한 PSD에는 최대 50개 레이아웃을 사용할 수 있습니다.');
  const composite=getCompositeCanvas(psd),layouts=[];
  await fs.mkdir(path.join(folder,'parts'),{recursive:true});
  for(const [index,{layer:board,id}]of boards.entries()){
    checkCancelled();const r=board.artboard.rect,width=r.right-r.left,height=r.bottom-r.top;
    if(width<1||height<1||width*height>20_000_000)throw fail('각 레이아웃은 2천만 픽셀 이하여야 합니다.');
    const preview=createCanvas(width,height),p=preview.getContext('2d');p.fillStyle='white';p.fillRect(0,0,width,height);if(composite)p.drawImage(composite,-r.left,-r.top);
    const previewFile=`layout-${index}.jpg`;await fs.writeFile(path.join(folder,previewFile),preview.toBuffer('image/jpeg',90));preview.width=1;
    const elements=[],all=leaves(board.children||[],id+'.');
    for(const [n,{layer:l,id:elementId}]of all.entries()){
      if(l.clipping)continue;
      const left=Math.max(r.left,l.left),top=Math.max(r.top,l.top),right=Math.min(r.right,l.right),bottom=Math.min(r.bottom,l.bottom);
      if(right<=left||bottom<=top)continue;
      const photo=all[n+1]?.layer.clipping||/클리핑/.test(l.name)||position==='beforeAfter'&&/\s[AB]$/.test(l.name);
      const image=getLayerCanvas(l);if(!image)continue;
      const sprite=createCanvas(right-left,bottom-top),c=sprite.getContext('2d');c.drawImage(image,l.left-left,l.top-top);image.width=1;
      const file=`parts/${index}-${n}.png`;await fs.writeFile(path.join(folder,file),sprite.toBuffer('image/png'));sprite.width=1;
      const element={id:elementId,name:l.name,kind:photo?'photo':l.text?'text':'image',x:left-r.left,y:top-r.top,width:right-left,height:bottom-top,file,opacity:l.opacity??1};
      if(l.text){Object.assign(element,{text:l.text.text,...textStyle(l)});
        if(position==='cover'&&!/lemonhouse/i.test(element.text))element.binding=/\d+\s*(?:PY|평)/i.test(element.text)?'siteTitle':'region';
        if(position==='space')element.binding=element.fontSize>50?'space':'point';
        if(position==='scope'){
          const sorted=all.filter(({layer})=>layer.text&&!/lemonhouse|레몬하우스|ⓒ|©|Project No\./i.test(layer.text.text)).sort((a,b)=>a.layer.top-b.layer.top);
          const ordinal=sorted.findIndex(e=>e.id===elementId);if(ordinal>=0)element.binding=['location','area','concept','wall','floor','other'][ordinal];
          if(/Project No\./i.test(element.text))element.binding='project';
        }
        Object.assign(element,textGeometry(l,element,{width,height,position},r));
      }
      elements.push(element);await new Promise(r=>setImmediate(r));
    }
    layouts.push({id,name:board.name,width,height,position,elements,previewFile});
  }
  if(composite)composite.width=1;
  return layouts;
}
function drawText(ctx,element,edit,text){
  const size=edit.fontSize??element.fontSize??32,font=edit.fontFamily||element.fontFamily||'Malgun Gothic',weight=edit.fontWeight??element.fontWeight??400;
  const normal=s=>s.replace(/(?:[-_ ]?[1-9]?(?:ExtraLight|SemiBold|ExtraBold|Regular|Medium|Light|Bold|Black|Heavy|Thin))$/i,'').replace(/(?:PL|PS)?(?:MT)?$/,'').replace(/[\s_-]/g,'').toLowerCase();
  const family=GlobalFonts.families.find(f=>normal(f.family)===normal(font))?.family;
  if(!family)throw fail(font+' 글꼴을 사용할 수 없습니다. 원본 문구는 유지할 수 있습니다. 글꼴을 설치하거나 사용할 글꼴을 직접 선택해 주세요.');
  ctx.font=weight+' '+size+'px "'+family+'"';drawCompletionText(ctx,element,edit,text);
}
export async function renderCompletionLayout(template,slot,project,assets,resolve){
  const layout=template.layouts.find(l=>l.id===(slot.layoutId||template.layouts[0]?.id));if(!layout)throw fail('사용할 PSD 레이아웃을 선택해 주세요.');
  const canvas=createCanvas(layout.width,layout.height),ctx=canvas.getContext('2d'),missing=[];ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
  const photos=completionPhotos(slot,layout),bands=completionBands(slot,layout);
  if(!bands.length)throw fail('비포애프터 공간을 한 개 이상 남겨 주세요.');
  for(const element of layout.elements){
    checkCancelled();const edit=slot.edits?.[element.id]||{};if(edit.visible===false||element.kind==='photo'&&!photos.some(p=>p.element.id===element.id)||slot.position==='space'&&isCompletionMarker(element))continue;
    const sprite=await loadImage(resolve(`${template.id}/${element.file}`)),x=edit.x??element.x,y=edit.y??element.y,scale=edit.scale||1;
    ctx.save();ctx.globalAlpha=element.opacity;
    if(element.kind==='photo'||edit.photoId){
      const id=edit.photoId||photos.find(p=>p.element.id===element.id)?.id,photo=assets.find(a=>a.id===id&&a.projectId===project.id&&a.role==='photo'&&!a.excluded&&!a.templateOutput&&a.status==='ready');
      const part=createCanvas(element.width,element.height),c=part.getContext('2d');
      if(photo){const image=await loadImage(resolve(photo.originalPath)),p=completionPhotoPlacement(edit,element,image);c.drawImage(image,p.x,p.y,p.width,p.height);}
      else{missing.push(element.name);c.fillStyle='#eef0e9';c.fillRect(0,0,part.width,part.height);c.font='24px "Malgun Gothic",sans-serif';c.fillStyle='#61715d';c.fillText('사진을 선택하세요',18,part.height/2);}
      c.globalCompositeOperation='destination-in';c.drawImage(sprite,0,0);ctx.drawImage(part,x,y,element.width*scale,element.height*scale);part.width=1;
    }else if(element.kind==='text'){
      const text=completionText(slot,element),styled=['fontSize','fontFamily','fontWeight','color','align','width','height'].some(k=>edit[k]!==undefined);
      if(text===element.text&&!styled)ctx.drawImage(sprite,x,y,element.width*scale,element.height*scale);else if(text)drawText(ctx,element,edit,text);
    }else if(edit.color){const part=createCanvas(element.width,element.height),c=part.getContext('2d');c.drawImage(sprite,0,0);c.globalCompositeOperation='source-in';c.fillStyle=edit.color;c.fillRect(0,0,part.width,part.height);ctx.drawImage(part,x,y,part.width*scale,part.height*scale);part.width=1;}
    else ctx.drawImage(sprite,x,y,element.width*scale,element.height*scale);
    ctx.restore();
  }
  const sprites=completionMarkerSprites(template);
  for(const marker of completionMarkers(slot,layout)){
    const sprite=sprites[marker.number];if(sprite)ctx.drawImage(await loadImage(resolve(template.id+'/'+sprite.file)),marker.x,marker.y,27,27);
    else{ctx.fillStyle='#ff7025';ctx.beginPath();ctx.arc(marker.x+13.5,marker.y+13.5,13.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='white';ctx.font='16px "Malgun Gothic"';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(marker.number),marker.x+13.5,marker.y+13.5);}
  }
  for(const overlay of slot.overlays||[]){if(overlay.backgroundColor&&overlay.backgroundColor!=='transparent'){ctx.fillStyle=overlay.backgroundColor;ctx.fillRect(overlay.x,overlay.y,overlay.width,overlay.height);}drawText(ctx,overlay,overlay,overlay.text);}
  const height=bands.reduce((sum,b)=>sum+b.height,0);
  if(height===layout.height)return {buffer:canvas.toBuffer('image/jpeg',95),missing,layout};
  const compact=createCanvas(layout.width,height),c=compact.getContext('2d');
  for(const band of bands)c.drawImage(canvas,0,band.y,layout.width,band.height,0,band.top,layout.width,band.height);
  return {buffer:compact.toBuffer('image/jpeg',95),missing,layout:{...layout,height}};
}

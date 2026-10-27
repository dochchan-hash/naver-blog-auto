import {useEffect,useRef,useState} from 'react';
import type {Asset,CompletionEdit,CompletionLayout,CompletionTemplate} from '../../shared/model';
import {completionBands,completionPhotos,completionMarkers,completionMarkerSprites,isCompletionMarker,completionPan,completionText,completionPhotoPlacement,drawCompletionText} from '../../shared/completion-templates.mjs';

type Props={template:Asset;layout:CompletionLayout;slot:CompletionTemplate;assets:Asset[];selected:string;select:(id:string)=>void;edit:(id:string,patch:CompletionEdit)=>void;onMarkers:(markers:NonNullable<CompletionTemplate['markers']>)=>void;onPhoto:(id:string,files:File[],photoId?:string)=>Promise<void>;disabled:boolean;};
export function CompletionPreview({template,layout,slot,assets,selected,select,edit,onMarkers,onPhoto,disabled}:Props){
  const canvas=useRef<HTMLCanvasElement>(null),cache=useRef(new Map<string,Promise<HTMLImageElement>>()),drag=useRef<{id:string;x:number;y:number;edit:CompletionEdit;marker?:number}|null>(null),[error,setError]=useState('');
  const bands=completionBands(slot,layout),height=bands.reduce((n:number,b:{height:number})=>n+b.height,0),photos=completionPhotos(slot,layout),markers=completionMarkers(slot,layout);
  const load=(url:string)=>{if(!cache.current.has(url))cache.current.set(url,new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>{cache.current.delete(url);reject(new Error('미리보기를 불러오지 못했습니다. 다시 시도해 주세요.'));};img.src=url;}));return cache.current.get(url)!;};
  useEffect(()=>{
    let cancelled=false;
    void (async()=>{
      const full=document.createElement('canvas');full.width=layout.width;full.height=layout.height;const c=full.getContext('2d')!;c.fillStyle='white';c.fillRect(0,0,full.width,full.height);
      for(const element of layout.elements){
        const change=slot.edits?.[element.id]||{},text=element.kind==='text'?completionText(slot,element):'';
        if(change.visible===false||element.kind==='photo'&&!photos.some((p:{element:{id:string}})=>p.element.id===element.id)||slot.position==='space'&&isCompletionMarker(element))continue;
        if(!element.imageUrl)continue;
        const sprite=await load(element.imageUrl),x=change.x??element.x,y=change.y??element.y,scale=change.scale||1;
        c.save();c.globalAlpha=(element as typeof element&{opacity?:number}).opacity??1;
        if(element.kind==='photo'||change.photoId){
          const id=change.photoId??photos.find((p:{element:{id:string}})=>p.element.id===element.id)?.id,asset=assets.find(a=>a.id===id),part=document.createElement('canvas');part.width=element.width;part.height=element.height;const p=part.getContext('2d')!;
          if(asset?.previewUrl){const image=await load(asset.previewUrl),placement=completionPhotoPlacement(change,element,image);p.drawImage(image,placement.x,placement.y,placement.width,placement.height);}
          else{p.fillStyle='#eef0e9';p.fillRect(0,0,part.width,part.height);p.fillStyle='#61715d';p.font='24px sans-serif';p.fillText('사진을 끌어 넣으세요',18,part.height/2);}
          p.globalCompositeOperation='destination-in';p.drawImage(sprite,0,0);c.drawImage(part,x,y,part.width*scale,part.height*scale);
        }else if(element.kind==='text'&&(text!==element.text||['fontSize','fontFamily','fontWeight','color','align','width','height'].some(k=>change[k as keyof CompletionEdit]!==undefined))){
          const size=change.fontSize??element.fontSize??32,family=change.fontFamily||element.fontFamily||'Malgun Gothic',font=/Freesentation/i.test(family)?'Freesentation':/Pretendard/i.test(family)?'Pretendard':family;
          await document.fonts.load((change.fontWeight??element.fontWeight??400)+' '+size+'px "'+font+'"');
          c.font=(change.fontWeight??element.fontWeight??400)+' '+size+'px "'+font+'"';drawCompletionText(c,element,change,text);
        }else if(change.color){const part=document.createElement('canvas');part.width=element.width;part.height=element.height;const p=part.getContext('2d')!;p.drawImage(sprite,0,0);p.globalCompositeOperation='source-in';p.fillStyle=change.color;p.fillRect(0,0,part.width,part.height);c.drawImage(part,x,y,part.width*scale,part.height*scale);}
        else c.drawImage(sprite,x,y,element.width*scale,element.height*scale);
        c.restore();
      }
      for(const overlay of slot.overlays||[]){
        if(overlay.backgroundColor&&overlay.backgroundColor!=='transparent'){c.fillStyle=overlay.backgroundColor;c.fillRect(overlay.x,overlay.y,overlay.width,overlay.height);}
        const family=overlay.fontFamily||'Malgun Gothic',font=/Freesentation/i.test(family)?'Freesentation':/Pretendard/i.test(family)?'Pretendard':family,size=overlay.fontSize||32,weight=overlay.fontWeight||400;
        await document.fonts.load(weight+' '+size+'px "'+font+'"');c.font=weight+' '+size+'px "'+font+'"';drawCompletionText(c,overlay,overlay,overlay.text);
      }
      const sprites=completionMarkerSprites(template);
      for(const marker of markers){const source=sprites[marker.number];if(source?.imageUrl)c.drawImage(await load(source.imageUrl),marker.x,marker.y,27,27);else{c.fillStyle='#ff7025';c.beginPath();c.arc(marker.x+13.5,marker.y+13.5,13.5,0,Math.PI*2);c.fill();c.font='16px sans-serif';c.fillStyle='white';c.textAlign='center';c.textBaseline='middle';c.fillText(String(marker.number),marker.x+13.5,marker.y+13.5);}}
      if(cancelled||!canvas.current)return;const target=canvas.current,ctx=target.getContext('2d')!;target.width=layout.width;target.height=height;
      for(const band of bands)ctx.drawImage(full,0,band.y,layout.width,band.height,0,band.top,layout.width,band.height);
      const element=layout.elements.find(e=>e.id===selected),band=element&&bands.find((b:{y:number;height:number})=>element.y>=b.y&&element.y<b.y+b.height);
      if(element&&band){const change=slot.edits?.[element.id]||{};ctx.strokeStyle='#d9862f';ctx.lineWidth=3;ctx.strokeRect(change.x??element.x,(change.y??element.y)-band.y+band.top,element.width*(change.scale||1),element.height*(change.scale||1));}
      setError('');
    })().catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};
  },[template,layout,slot,assets,selected,height]);
  const point=(e:{clientX:number;clientY:number;currentTarget:HTMLCanvasElement})=>{const box=e.currentTarget.getBoundingClientRect(),y=(e.clientY-box.top)/box.height*height,band=bands.find((b:{top:number;height:number})=>y>=b.top&&y<b.top+b.height);return {x:(e.clientX-box.left)/box.width*layout.width,y:band?y-band.top+band.y:y};};
  const hit=(p:{x:number;y:number})=>photos.find(({element}:{element:{id:string;x:number;y:number;width:number;height:number}})=>{const change=slot.edits?.[element.id]||{},x=change.x??element.x,y=change.y??element.y;return p.x>=x&&p.y>=y&&p.x<x+element.width*(change.scale||1)&&p.y<y+element.height*(change.scale||1);});
  return <><div className="completion-preview-scroll"><canvas ref={canvas} width={layout.width} height={height} className="completion-template-preview completion-edit-canvas" aria-label={slot.name+' 사진을 끌어 넣고 드래그해 위치 조정'}
    onDragOver={e=>{if(!disabled&&(e.dataTransfer.types.includes('lemon-photo')||e.dataTransfer.types.includes('Files'))&&hit(point(e))){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='copy';}}}
    onDrop={e=>{e.preventDefault();e.stopPropagation();if(disabled)return;const target=hit(point(e));if(target)void onPhoto(target.element.id,Array.from(e.dataTransfer.files),e.dataTransfer.getData('lemon-photo')).catch(err=>setError(err.message));}}
    onPointerDown={e=>{if(disabled||e.button!==0)return;const p=point(e),marker=[...markers].reverse().find((m:{x:number;y:number})=>Math.hypot(m.x+13.5-p.x,m.y+13.5-p.y)<30);if(marker){select('marker:'+marker.number);drag.current={id:'',...p,edit:{},marker:marker.number};}else{const photo=hit(p);if(!photo)return;select(photo.element.id);drag.current={id:photo.element.id,...p,edit:{...slot.edits?.[photo.element.id]}};}e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{const active=drag.current;if(!active||disabled)return;const p=point(e);if(active.marker){const target=hit(p);if(target){const photo=target.element;onMarkers(markers.map((m:{number:number;x:number;y:number})=>m.number===active.marker?{...m,x:Math.round(Math.max(photo.x,Math.min(photo.x+photo.width-27,p.x-13.5))),y:Math.round(Math.max(photo.y,Math.min(photo.y+photo.height-27,p.y-13.5)))}:m));}}else{const photo=photos.find((p:{element:{id:string}})=>p.element.id===active.id),asset=assets.find(a=>a.id===photo?.id);if(photo&&asset?.width&&asset.height)edit(active.id,completionPan(active.edit,photo.element,asset,p.x-active.x,p.y-active.y));}}}
    onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}/></div>
    <small>사진을 각 칸에 놓고 끌어 위치를 조정하세요. 번호도 끌어서 옮길 수 있습니다. 확대와 사진 선택은 오른쪽에서 조정합니다.</small>{error?<p role="alert">{error}</p>:null}</>;
}

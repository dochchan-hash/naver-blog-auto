import {templateFields} from './template-fields.mjs';

export function completionText(project,slot,element,assets){
  if(slot.edits?.[element.id]?.text!==undefined)return slot.edits[element.id].text;
  if(['cover','scope','closing'].includes(slot.position))return element.text||'';
  if(element.binding==='space')return slot.space;
  if(element.binding==='point')return slot.text;
  if(element.binding==='siteTitle')return [project.original.name,project.original.type||project.original.supplyArea].filter(Boolean).join(' ');
  if(element.binding==='region')return project.original.region;
  if(element.binding==='project')return project.templateEdits?.scopeProject||'';
  if(element.binding)return templateFields(project,assets)[element.binding]||'';
  return element.text||'';
}
export function completionRows(layout){
  if(layout.position!=='beforeAfter')return [];
  const rows=[];
  for(const photo of layout.elements.filter(e=>e.kind==='photo').sort((a,b)=>a.y-b.y||a.x-b.x)){
    let row=rows.find(r=>Math.abs(r.y-photo.y)<3);
    if(!row){row={id:photo.id,name:photo.name.replace(/\s[AB]$/,''),y:photo.y,elements:[]};rows.push(row);}
    row.elements.push(photo.id);
  }
  return rows.map((row,i)=>({...row,height:(rows[i+1]?.y??layout.height)-row.y}));
}
export function completionBands(slot,layout){
  const rows=completionRows(layout);if(!rows.length)return [{y:0,height:layout.height,top:0}];
  let top=rows[0].y;
  return [...(top?[{y:0,height:top,top:0}]:[]),...rows.filter(r=>!slot.removedRows?.includes(r.id)).map(row=>{const band={...row,top};top+=row.height;return band;})];
}
export function completionPhotos(slot,layout){
  const removed=new Set(completionRows(layout).filter(r=>slot.removedRows?.includes(r.id)).flatMap(r=>r.elements));
  return layout.elements.filter(e=>e.kind==='photo').map((e,i)=>({element:e,id:slot.edits?.[e.id]?.photoId??slot.photoIds[i]??''})).filter(p=>!removed.has(p.element.id)&&slot.edits?.[p.element.id]?.visible!==false);
}
export const isCompletionMarker=e=>e.kind==='image'&&/^[1-5](?:\s|$)/.test(e.name)&&e.width<=60&&e.height<=60;
export function completionMarkers(slot,layout){
  if(slot.position!=='space')return [];
  if(slot.markers)return slot.markers;
  const photos=layout.elements.filter(e=>e.kind==='photo');
  return layout.elements.filter(e=>isCompletionMarker(e)&&photos.some(p=>e.x>=p.x&&e.y>=p.y&&e.x+e.width<=p.x+p.width&&e.y+e.height<=p.y+p.height)).map(e=>({number:Number(e.name[0]),x:e.x,y:e.y})).filter((m,i,all)=>all.findIndex(n=>n.number===m.number)===i);
}
export function completionMarkerSprites(template){return Object.fromEntries(template.layouts.flatMap(l=>l.elements).filter(isCompletionMarker).map(e=>[Number(e.name[0]),e]));}
export function completionPan(edit,photo,image,dx,dy){
  const scale=Math.max(photo.width/image.width,photo.height/image.height)*(edit.zoom||1),overflowX=image.width*scale-photo.width,overflowY=image.height*scale-photo.height;
  const clamp=n=>Math.max(-100,Math.min(100,n));
  return {cropX:overflowX>0?clamp((edit.cropX||0)+dx*200/overflowX):0,cropY:overflowY>0?clamp((edit.cropY||0)+dy*200/overflowY):0};
}
export function completionSignature(project,slot,assets){
  const ids=[...new Set([...slot.photoIds,...Object.values(slot.edits||{}).map(e=>e.photoId).filter(Boolean)])].sort();
  return JSON.stringify({version:3,slot,...(['cover','scope','closing'].includes(slot.position)?{}:{site:project.original,fields:templateFields(project,assets)}),photos:ids.map(id=>[id,assets.find(a=>a.id===id&&!a.excluded)?.hash])},(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
}

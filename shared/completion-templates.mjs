export function completionText(project,slot,element,assets){
  if(slot.edits?.[element.id]?.text!==undefined)return slot.edits[element.id].text;
  if(slot.position==='space'&&element.binding==='space')return slot.space||element.text||'';
  if(slot.position==='space'&&element.binding==='point')return slot.text||element.text||'';
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
  const {rangeX,rangeY}=completionPhotoPlacement(edit,photo,image);
  const clamp=n=>Math.max(-100,Math.min(100,n));
  return {cropX:clamp((edit.cropX||0)+dx*200/rangeX),cropY:clamp((edit.cropY||0)+dy*200/rangeY)};
}
export function completionPhotoPlacement(edit,photo,image){
  const scale=Math.max(photo.width/image.width,photo.height/image.height)*(edit.zoom||1),width=image.width*scale,height=image.height*scale;
  const rangeX=Math.max(width-photo.width,photo.width),rangeY=Math.max(height-photo.height,photo.height);
  return {x:(photo.width-width)/2+(edit.cropX||0)*rangeX/200,y:(photo.height-height)/2+(edit.cropY||0)*rangeY/200,width,height,rangeX,rangeY};
}
export function drawCompletionText(ctx,element,edit,text){
  if(!text)return;
  const size=edit.fontSize??element.fontSize??32,ratio=size/(element.fontSize||size),width=edit.width||element.textWidth||element.width,height=edit.height||element.textHeight||element.height;
  ctx.letterSpacing=(element.letterSpacing||0)*ratio+'px';ctx.fontKerning='normal';
  const lines=[],leading=(element.lineHeight||size*1.3)*ratio;
  for(const paragraph of String(text).split(/\r?\n/)){let line='';for(const character of paragraph){if(line&&ctx.measureText(line+character).width>width){lines.push(line);line='';}line+=character;}lines.push(line);}
  const metrics=lines.map(line=>ctx.measureText(line||'가')),inkHeight=Math.max(...metrics.map(m=>m.actualBoundingBoxAscent+m.actualBoundingBoxDescent));
  if((lines.length-1)*leading+inkHeight>height||metrics.some(m=>m.width>width))throw Object.assign(new Error((element.name||'추가 문구')+' 내용이 영역보다 깁니다. 원래 글자 크기는 유지했습니다. 영역을 넓히거나 글자 크기를 직접 조정해 주세요.'),{status:400});
  const align=edit.align||element.align||'left',x=(element.textX??element.x)+(edit.x===undefined?0:edit.x-element.x),y=edit.y??element.y;
  const baseline=ctx.measureText(String(element.text||text).split(/\r?\n/)[0]||'가').actualBoundingBoxAscent;
  ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillStyle=edit.color||element.color||'#222222';
  lines.forEach((line,i)=>ctx.fillText(line,x+(align==='center'?width/2:align==='right'?width:0),y+i*leading+baseline));
}
export function completionSignature(project,slot,assets){
  const ids=[...new Set([...slot.photoIds,...Object.values(slot.edits||{}).map(e=>e.photoId).filter(Boolean)])].sort();
  const {name,enabled,...input}=slot;
  return JSON.stringify({version:4,slot:input,photos:ids.map(id=>[id,assets.find(a=>a.id===id&&!a.excluded)?.hash])},(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
}

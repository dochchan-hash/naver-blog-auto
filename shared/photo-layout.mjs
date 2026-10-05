export function photoDropPatches(assets,sourceId,targetId,intent,makeId=()=>crypto.randomUUID()){
  const photos=assets.filter(a=>a.role==='photo').sort((a,b)=>a.order-b.order).map(a=>({...a}));
  const source=photos.find(a=>a.id===sourceId),target=photos.find(a=>a.id===targetId);
  if(!source||source.excluded)throw new Error('사용할 사진을 선택해 주세요.');
  if(sourceId===targetId)return [];
  if(intent!=='ungroup'&&(!target||target.excluded))throw new Error('사용할 사진이나 묶음 위에 놓아 주세요.');
  if(target&&source.projectId!==target.projectId)throw new Error('같은 추천글의 사진끼리 배치해 주세요.');
  if(intent==='group'){
    if(source.space!==target.space)throw new Error('같은 공간의 사진끼리 묶어 주세요. 사진의 공간을 먼저 선택할 수 있습니다.');
    const group=target.group||makeId();target.group=group;source.group=group;
    photos.splice(photos.indexOf(source),1);const last=photos.findLastIndex(a=>a.group===group&&a.space===target.space);photos.splice(last+1,0,source);
  }else if(intent==='before'||intent==='after'){
    if(source.group!==target.group||source.space!==target.space)source.group='';
    photos.splice(photos.indexOf(source),1);photos.splice(photos.indexOf(target)+(intent==='after'?1:0),0,source);
  }else if(intent==='ungroup'){
    source.group='';photos.splice(photos.indexOf(source),1);photos.push(source);
  }else throw new Error('사진을 놓을 위치를 다시 선택해 주세요.');
  const sizes=new Map();for(const a of photos)if(a.group){const key=a.space+':'+a.group;sizes.set(key,(sizes.get(key)||0)+1);}
  return photos.map((a,order)=>({id:a.id,order,group:a.group&&sizes.get(a.space+':'+a.group)>1?a.group:''}));
}

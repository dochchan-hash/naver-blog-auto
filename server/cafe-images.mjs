import sharp from 'sharp';
import {jobSignal} from './jobs.mjs';
export function cafeImageUrl(value){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.port||u.username||u.password||!u.hostname.endsWith('.pstatic.net'))throw new Error('카페 첨부 이미지 주소를 확인해 주세요.');
  return u.href;
}
export async function cafeImageData(url,edge=2000){
  const u=new URL(cafeImageUrl(url));u.searchParams.delete('type');
  const timeout=AbortSignal.timeout(30000),signal=jobSignal()?AbortSignal.any([jobSignal(),timeout]):timeout;
  const response=await fetch(u,{redirect:'error',signal});
  if(!response.ok)throw new Error(`카페 공사범위 사진을 불러오지 못했습니다 (${response.status}).`);
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>12*1024*1024)throw new Error('카페 사진이 너무 큽니다. 공사범위 사진을 JPG로 직접 첨부해 주세요.');chunks.push(chunk);}
  const data=await sharp(Buffer.concat(chunks),{limitInputPixels:40_000_000}).rotate().resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).jpeg({quality:95}).toBuffer();
  return `data:image/jpeg;base64,${data.toString('base64')}`;
}

import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {localApi} from './local-api.mjs';
const api=await localApi(process.argv[2]);let project=await api.request('/projects','POST',{});
project=await api.request(`/projects/${project.id}`,'PUT',{...project,name:'도면 비교 기능 검증',phase:'compare',original:{...project.original,name:'메트로시티',region:'창원시 양덕동'},target:{...project.target,name:'창원센텀푸르지오',region:'창원시 양덕동'}});
const evidence=[];
for(const which of ['original','target']){
  const site=project[which],search=await api.request('/naver/search','POST',{query:site.name});
  const candidate=search.results.find(r=>r.name.includes(` ${site.name} `));assert(candidate,`${site.name} 검색 후보를 찾지 못했습니다.`);
  let complex=await api.request('/naver/select-complex','POST',{key:candidate.key});assert(complex.types.length&&complex.images.length,'타입과 도면이 필요합니다.');
  complex=await api.request('/naver/complex','POST',{url:complex.url,type:complex.types[0]});
  const floorplan=await api.request('/naver/floorplan','POST',{projectId:project.id,role:`floorplan-${which}`,url:complex.images[0].url});
  project=await api.request(`/projects/${project.id}`,'PUT',{...project,[which]:{...site,sourceUrl:complex.url,type:complex.selectedType,supplyArea:complex.supplyArea,exclusiveArea:complex.exclusiveArea}});
  evidence.push({which,name:complex.name,url:complex.url,type:complex.selectedType,types:complex.types,supplyArea:complex.supplyArea,exclusiveArea:complex.exclusiveArea,assetId:floorplan.id});
  console.log(JSON.stringify(evidence.at(-1)));
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));let data;
for(let i=0;i<60;i++){data=(await localApi(process.argv[2])).bootstrap;if(data.assets.filter(a=>a.projectId===project.id).every(a=>a.status==='ready'))break;await wait(1000);}
const job=await api.request(`/projects/${project.id}/tasks/compare`,'POST',{});console.log(JSON.stringify({jobId:job.id,projectId:project.id}));
let latest;
for(let i=0;i<120;i++){latest=(await api.request('/jobs')).find(j=>j.id===job.id);if(!['running','queued'].includes(latest.status))break;await wait(3000);}
assert.equal(latest.status,'completed',latest.message);
data=(await localApi(process.argv[2])).bootstrap;project=data.projects.find(p=>p.id===project.id);
const result={liveFloorplanComparison:true,projectId:project.id,evidence,plans:data.assets.filter(a=>a.projectId===project.id).map(a=>({role:a.role,width:a.width,height:a.height,bytes:a.bytes,analysisBytes:a.previewBytes})),comparison:project.comparison};
await fs.mkdir('.local/checks',{recursive:true});await fs.writeFile('.local/checks/live-floorplans.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));

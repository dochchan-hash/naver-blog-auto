import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {localApi} from './local-api.mjs';
import {keywordReport,draftWarnings} from '../shared/domain.mjs';

const api=await localApi(process.argv[2]);
assert(api.bootstrap.auth.connected,'ChatGPT 연결이 필요합니다.');
assert.equal(api.bootstrap.style.status,'analyzed','스타일 분석을 먼저 완료해 주세요.');
let project=await api.request('/projects','POST',{});
project=await api.request(`/projects/${project.id}`,'PUT',{...project,name:'기능 검증 · 공개 발행하지 않음',original:{...project.original,name:'원본 샘플현장'},target:{...project.target,name:'추천 샘플아파트'},manualWork:'프로그램 검증용 가상 자료입니다. 실제 시공사례나 고객 현장이 아닙니다. 거실: 화이트 벽면 마감, 오크 수납장. 주방: 매립 천장 조명.',concept:'화이트와 우드의 차분한 분위기. 기능 확인용 가상 추천 예시임을 명시합니다.',keywords:[{term:'추천 샘플아파트',min:7,max:8},{term:'화이트 인테리어',min:3,max:4}],publishMode:'review'});

function documentFixture(){
  const text='BT /F1 16 Tf 40 720 Td (TEST ONLY. Living room: white wall finish and oak cabinet. Kitchen: recessed ceiling light.) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 7 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${text.length} >>\nstream\n${text}\nendstream`,'<< /Length 0 >>\nstream\n\nendstream'];
  let pdf='%PDF-1.4\n';const offsets=[];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const start=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(pdf);
}
async function upload(role,bytes,filename){const form=new FormData();form.append('file',new Blob([bytes]),filename);return api.request(`/projects/${project.id}/assets?role=${role}`,'POST',form);}
const photos=[];
for(let i=1;i<=3;i++)photos.push(await upload('photo',await fs.readFile(`tests/fixtures/layout-check-${i}.jpg`),`검증용-사진-${i}.jpg`));
const document=await upload('construction',documentFixture(),'검증용-시공내역.pdf');
await api.request('/assets/batch','PATCH',photos.map((p,i)=>({id:p.id,space:i===0?'표지':'거실',group:i===0?'':'검증묶음',order:i})));
const wait=ms=>new Promise(r=>setTimeout(r,ms));let data;
for(let i=0;i<60;i++){data=(await localApi(process.argv[2])).bootstrap;if(data.assets.filter(a=>a.projectId===project.id).every(a=>a.status==='ready'))break;await wait(1000);}
assert(data.assets.filter(a=>a.projectId===project.id).every(a=>a.status==='ready'));
const job=await api.request(`/projects/${project.id}/tasks/generate`,'POST',{});
console.log(JSON.stringify({projectId:project.id,jobId:job.id,publicPublishing:false}));
let latest,previous='';
for(let i=0;i<240;i++){
  latest=(await api.request('/jobs')).find(j=>j.id===job.id);
  if(latest.message!==previous){console.log(JSON.stringify({status:latest.status,message:latest.message}));previous=latest.message;}
  if(!['running','queued'].includes(latest.status))break;await wait(3000);
}
assert.equal(latest.status,'completed',latest.message);
data=(await localApi(process.argv[2])).bootstrap;project=data.projects.find(p=>p.id===project.id);const assets=data.assets.filter(a=>a.projectId===project.id);
const report=keywordReport(project);
assert(project.facts.some(f=>f.sourceAssetId===document.id&&f.page===1),'PDF의 페이지 근거가 보존되어야 합니다.');
assert(project.blocks.some(b=>b.kind==='photos'&&b.assetIds?.length===2),'사진 묶음이 원고에 반영되어야 합니다.');
assert(project.blocks.every(b=>!(b.assetIds||[]).includes(document.id)),'시공자료가 게시 사진에 섞이면 안 됩니다.');
assert(report.every(k=>k.ok),'키워드 목표 횟수가 맞아야 합니다.');
const result={liveGeneration:true,projectId:project.id,title:project.title,photoBlocks:project.blocks.filter(b=>b.kind==='photos').map(b=>b.assetIds.length),facts:project.facts,keywordReport:report,warnings:draftWarnings(project,assets),generationWarnings:project.generationWarnings,originalPhotoBytes:assets.filter(a=>a.role==='photo').map(a=>a.bytes),analysisPhotoBytes:assets.filter(a=>a.role==='photo').map(a=>a.previewBytes),publicPublishing:false};
await fs.mkdir('.local/checks',{recursive:true});await fs.writeFile('.local/checks/live-generation.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,facts:result.facts.length}));

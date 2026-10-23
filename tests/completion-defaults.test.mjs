import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createCanvas} from '@napi-rs/canvas';import {writePsdBuffer} from 'ag-psd';
import {readCompletionTemplate,compileCompletionTemplate,renderCompletionLayout,refreshCompletionTextStyles} from '../server/completion-templates.mjs';
import {completionText,completionSignature} from '../shared/completion-templates.mjs';
function source(){
 const base=createCanvas(320,150),b=base.getContext('2d');b.fillStyle='white';b.fillRect(0,0,320,150);
 const text=createCanvas(260,60),c=text.getContext('2d');c.font='500 36px Freesentation';c.fillStyle='#222222';c.fillText('PSD 원본 문구',0,40);b.drawImage(text,20,40);
 return writePsdBuffer({width:320,height:150,canvas:base,children:[{name:'원본 레이아웃',artboard:{rect:{left:0,top:0,right:320,bottom:150}},children:[{name:'원본 문구',left:20,top:40,canvas:text,text:{text:'PSD 원본 문구',transform:[1,0,0,1,20,40],style:{font:{name:'Freesentation-5Medium'},fontSize:36,fillColor:{r:34,g:34,b:34}},paragraphStyle:{justification:'left'}}}]}]});
}
test('표지·공사범위·개별공사안내는 현장 정보와 무관하게 원문을 유지하고 명시적 수정만 적용한다',()=>{
 const project={original:{name:'새 현장',region:'새 지역'},templateEdits:{scopeProject:'새 프로젝트'}},element={id:'text',binding:'siteTitle',text:'PSD 원래 문구'};
 for(const position of ['cover','scope','closing']){
  const slot={position,photoIds:[]};assert.equal(completionText(project,slot,element,[]),'PSD 원래 문구');assert.equal(completionText(project,{...slot,edits:{text:{text:'직접 수정'}}},element,[]),'직접 수정');assert.equal(completionText(project,{...slot,edits:{text:{text:''}}},element,[]),'');
  assert.equal(completionSignature(project,slot,[]),completionSignature({...project,original:{name:'다른 현장'}},slot,[]));
 }
 assert.equal(completionText(project,{position:'space',text:'포인트 수정'},{binding:'point'},[]),'포인트 수정');
});
test('원본 텍스트는 이미지 그대로 보존하고 문구 편집 시 원래 폰트·크기를 사용하며 자동 축소하지 않는다',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lemon-psd-default-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const layouts=await compileCompletionTemplate(readCompletionTemplate(source()),path.join(dir,'template'),'표지.psd'),template={id:'template',layouts},slot={position:'cover',templateId:'template',photoIds:[]},p={id:'p',original:{name:'자동 대체 금지'}};
 const element=layouts[0].elements.find(e=>e.kind==='text');assert.equal(element.fontFamily,'Freesentation-5Medium');assert.equal(element.fontWeight,500);assert.equal(element.fontSize,36);
 const render=edits=>renderCompletionLayout(template,{...slot,edits},p,[],rel=>path.join(dir,rel));const a=await render({}),b=await render({[element.id]:{text:element.text}});assert(a.buffer.equals(b.buffer));
 const c=await render({[element.id]:{text:'문구만 수정'}});assert(!a.buffer.equals(c.buffer));assert.equal(c.layout.elements[0].fontSize,36);
 await assert.rejects(render({[element.id]:{text:'아주 긴 문구를 좁은 영역에 넣어 자동으로 작아지는지 확인합니다.',width:10,height:10}}),/원래 글자 크기는 유지/);
 element.fontFamily='MissingFontForTest';await render({});await assert.rejects(render({[element.id]:{text:'수정'}}),/글꼴을 사용할 수 없습니다/);
});
test('PSD의 아래·위 첨자 크기와 Light·Medium 굵기를 원본 메타데이터에서 복원한다',()=>{
 const canvas=createCanvas(100,80),buffer=writePsdBuffer({width:100,height:80,canvas,children:[{name:'텍스트',canvas,text:{text:'원본',transform:[2,0,0,2,0,0],subscriptSize:.583,style:{font:{name:'Pretendard-Light'},fontSize:40,fontBaseline:2}}}]}),layouts=[{id:'main',elements:[{id:'main.0',fontSize:80,fontWeight:400}]}];
 const [layout]=refreshCompletionTextStyles(buffer,layouts);assert.equal(layout.elements[0].fontWeight,300);assert(Math.abs(layout.elements[0].fontSize-46.64)<.001);
});

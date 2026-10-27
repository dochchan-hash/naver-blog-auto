import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readReferenceFormat,COMPLETION_FORMAT,REFERENCE_FORMAT,CASE_FORMAT,applyReferenceFormat,blockTextStyles} from '../shared/format.mjs';
import {completionBlocks} from '../shared/domain.mjs';

function reference(){
 const body={fontFamily:'se-nanumbarungothic, sans-serif',fontSize:'15px',fontWeight:'400',color:'rgb(0, 0, 0)',backgroundColor:'rgba(0, 0, 0, 0)',textAlign:'left'};
 const quote={...body,fontFamily:'-apple-system, sans-serif',fontSize:'19px',fontWeight:'700'},point={...body,fontSize:'16px',fontWeight:'700',color:'rgb(255, 95, 69)'},contact={...point,fontSize:'19px',textAlign:'center'};
 const components=[];
 const add=(kind,text='',css=body,variant='default')=>{
   const c={className:'se-component se-'+kind+' se-l-'+variant,innerText:text,paragraphs:[],classList:{contains:n=>n==='se-'+kind},matches:q=>q.split(',').some(s=>s==='.'+'se-'+kind),querySelectorAll:q=>q==='.se-text-paragraph'?c.paragraphs:[]};
   if(text){const p={textContent:text,css,closest:q=>q==='.se-component'?c:q==='.se-quotation'&&kind==='quotation'?c:null};const span={textContent:text,className:'',css,parentElement:p,querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null};p.querySelectorAll=()=>[span];c.paragraphs.push(p);}components.push(c);return c;
 };
 add('image');add('text','브랜드 인사와 실제 시공 현장을 소개하는 긴 문장을 작성합니다.');add('placesMap');add('horizontalLine','','','line5');add('image');add('quotation','BEFORE & AFTER',{...quote,textAlign:'center'},'quotation_corner');add('image');
 for(const name of ['현관','안방 드레스룸','작은방 3','공용 욕실']){
   add('quotation',name,quote,'quotation_line');add('image');const points=add('text','1. 시공 포인트',point),details=add('text','확인한 시공 내용을 설명합니다.');points.paragraphs.push(...details.paragraphs);points.innerText+='\n'+details.innerText;components.pop();add('image');add('text',name+' 공간의 종합 설명은 왼쪽 정렬로 작성합니다.');add('imageGroup','','','slide');
 }
 const farewell=add('text','이상으로 현장을 살펴보았습니다. 문의 사항을 남겨 주세요.');const last=add('text','T.1644-0402',contact);farewell.paragraphs.push(...last.paragraphs);components.pop();
 add('horizontalLine','','','line5');add('video');add('image');
 const root={querySelectorAll:q=>q==='.se-component'?components:components.flatMap(c=>c.paragraphs),querySelector:q=>q==='.se-quotation .se-text-paragraph'?components.find(c=>c.className.includes('se-quotation')).paragraphs[0]:q==='.se-quotation'?components.find(c=>c.className.includes('se-quotation')):q==='.se-horizontalLine'?components.find(c=>c.className.includes('se-horizontalLine')):null};
 return {document:{querySelector:()=>root},getComputedStyle:n=>n.css};
}
test('마감 원본의 처음·끝 구조와 포인트·종합 설명·연락처 서식을 별도로 읽는다',()=>{
 const {formatProfile:p,blocks}=vm.runInNewContext(`(${readReferenceFormat.toString()})({postType:'completion',withEvidence:true})`,reference());
 assert.deepEqual(Array.from(p.spaceOrder),['현관','드레스룸','작은방3','공용욕실']);
 assert.equal(p.textStyles.point[0].fontWeight,700);assert.equal(p.textStyles.point[0].color,'rgb(255, 95, 69)');assert.equal(p.textStyles.pointBody[0].fontWeight,400);
 assert.equal(p.textStyles.공용욕실.length,1);assert(p.textStyles.공용욕실.every(s=>s.align==='left'));
 assert.equal(p.textStyles.closing[0].align,'left');assert.equal(p.textStyles.contact[0].align,'center');assert.equal(p.textStyles.contact[0].fontSize,19);
 assert.equal(p.textStyles.contact[0].color,'rgb(255, 95, 69)');assert.equal(p.photoLayouts.현관.at(-1),'slide');
 assert.deepEqual(Array.from(blocks.slice(0,7),b=>b.kind),['photos','text','map','divider','photos','quote','photos']);assert.equal(blocks.at(-2).kind,'video');
 assert.equal(p.introLead,false);assert.equal(p.dividerAfterOutro,false);assert.equal(p.postType,'completion');
});
test('마감은 포인트 → 대표 사진 → 종합 설명 → 나머지 사진과 별도 연락처로 구성한다',()=>{
 const project={postType:'completion',completionTemplates:[{position:'space',space:'거실',templateId:'psd'}]},assets=['표지','공사범위','시공전후','거실','거실','거실','거실','작은방3','마무리'].map((space,i)=>({id:String(i),role:'photo',space,order:i,...(i===3?{templateSlotId:'point'}:{})}));
 const blocks=completionBlocks(project,assets,{intro:'브랜드 인사',sections:[{space:'거실',text:'공간 종합 설명',points:[{title:'확인된 포인트',text:'포인트 설명'}]},{space:'작은방3',text:'마지막 공간도 설명합니다.',points:[]}],outro:'마무리 인사',phone:'1644-0402'},COMPLETION_FORMAT);
 assert.deepEqual(blocks.filter(b=>b.space==='거실').map(b=>b.formatRole||b.kind),['quote','photos','point','pointBody','photos','text','photos']);
 assert.deepEqual(blocks.slice(0,6).map(b=>b.kind),['photos','text','divider','photos','quote','photos']);
 assert.deepEqual(blocks.slice(-4).map(b=>b.formatRole||b.kind),['closing','contact','divider','photos']);
 assert.equal(blockTextStyles(blocks.at(-3),COMPLETION_FORMAT)[0].align,'center');
 assert.deepEqual(applyReferenceFormat({...project,blocks},COMPLETION_FORMAT).blocks,blocks);
 assert.equal(REFERENCE_FORMAT.body.align,'center');assert.equal(CASE_FORMAT.headingQuoteVariant,'quotation_underline');
});

test('마감에서도 사용자가 선택한 질문 인용구만 별도로 배치한다',()=>{
 const assets=[{id:'a',role:'photo',space:'거실',order:0}],result={intro:'인사',sections:[{space:'거실',text:'설명',points:[]}],outro:'마무리',questionAnswers:[{question:'첫 질문',answer:'첫 답변'},{question:'둘째 질문',answer:'둘째 답변'}]};
 for(const choice of ['none','middle','end']){
   const blocks=completionBlocks({postType:'completion',questionQuote:choice},assets,result,COMPLETION_FORMAT);
   assert.equal(blocks.filter(b=>b.kind==='quote'&&!b.space).length,choice==='none'?0:2);
   assert.equal(blocks.filter(b=>b.text?.includes('답변')).length,choice==='none'?0:2);
 }
});

test('AI가 쓴 포인트 번호·도입의 구조 제목·끝의 연락처를 중복하지 않고 새 제목을 영상에 쓴다',()=>{
 const project={postType:'completion',completionTemplates:[{position:'space',space:'거실',templateId:'psd'}],completionVideoId:'video',original:{name:'테스트 현장'},title:''},assets=[{id:'photo',role:'photo',space:'거실',order:0},{id:'video',role:'video',status:'ready',filename:'원본영상.mp4'}],result={title:'새 원고 제목',intro:'브랜드 인사\n\nBEFORE & AFTER',sections:[{space:'거실',text:'공간 설명',points:[{title:'1. 확인한 시공',text:'시공 설명'},{title:'2) 수납 구성',text:'수납 설명'}]}],outro:'마무리 인사\n\nT. 1644-0402',phone:'1644-0402'};
 const blocks=completionBlocks(project,assets,result,COMPLETION_FORMAT);assert.equal(blocks.find(b=>b.formatRole==='intro').text,'브랜드 인사');assert(!blocks.some(b=>b.text==='BEFORE & AFTER'));assert.deepEqual(blocks.filter(b=>b.formatRole==='point').map(b=>b.text),['1. 확인한 시공','2. 수납 구성']);assert.equal(blocks.find(b=>b.formatRole==='closing').text,'마무리 인사');assert.equal(blocks.filter(b=>b.text?.includes('1644-0402')).length,1);assert.equal(blocks.find(b=>b.kind==='video').text,result.title);
 const other=completionBlocks(project,assets,{...result,outro:'대표 번호는 1644-0402입니다.\nTel. 1644 0402'},COMPLETION_FORMAT);assert.equal(other.find(b=>b.formatRole==='closing').text,'대표 번호는 1644-0402입니다.');
});

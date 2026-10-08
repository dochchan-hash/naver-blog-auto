// These defaults were read from all five saved Lemonhouse reference posts.
export const REFERENCE_FORMAT = {
  body:{fontFamily:'nanumbarungothic',fontSize:15,fontWeight:400,color:'#000000',backgroundColor:'#ffffff',align:'center'},
  heading:{fontFamily:'nanumbarungothic',fontSize:19,fontWeight:700,color:'#000000',backgroundColor:'#ffe3c8',align:'center'},
  quote:{fontFamily:'nanumbarungothic',fontSize:19,fontWeight:700,color:'#8a837e',backgroundColor:'transparent',align:'center'},
  quoteVariant:'quotation_corner',dividerVariant:'line6',spaceOrder:['현관','거실','주방','안방','안방욕실','작은방1','작은방2','공용욕실'],dividerAfterOutro:true,
};

// Run in the reference article frame. Inspect visible text nodes, since the
// paragraph's computed font can differ from the font applied to its spans.
export function readReferenceFormat(){
  const root=document.querySelector('.se-main-container');if(!root)return null;
  const spaces=['현관','거실','주방','안방','안방욕실','작은방1','작은방2','공용욕실','작은방','욕실','기타'];
  const paragraphs=[...root.querySelectorAll('.se-component.se-text .se-text-paragraph,.se-component.se-quotation .se-text-paragraph')];
  const text=p=>p.textContent.replace(/[\u200B\uFEFF]/g,'').trim();
  const css=p=>{let node=[...p.querySelectorAll('span')].filter(e=>e.textContent.trim()).sort((a,b)=>b.textContent.length-a.textContent.length)[0]||p;const bold=[...node.querySelectorAll('b,strong')].find(e=>e.textContent.trim()===node.textContent.trim());if(bold)node=bold;const s=getComputedStyle(node),ps=getComputedStyle(p);const bg=s.backgroundColor==='rgba(0, 0, 0, 0)'&&node.parentElement?getComputedStyle(node.parentElement).backgroundColor:s.backgroundColor;return {fontFamily:(node.className+' '+(node.closest('[class*="se-ff-"]')?.className||'')).match(/se-ff-([a-z][a-z0-9]*)/)?.[1]||'nanumbarungothic',fontSize:parseFloat(s.fontSize),fontWeight:Number(s.fontWeight)||400,color:s.color,backgroundColor:bg==='rgba(0, 0, 0, 0)'?'transparent':bg,align:['left','center','right','justify'].includes(ps.textAlign)?ps.textAlign:'center'};};
  const spaceOf=p=>{const t=text(p).replace(/\s/g,'').replace(/^[0-9]+[.)．]/,'');return spaces.find(space=>new RegExp('^'+space+'(?:인테리어|공간|INTERIOR|ROOM)?$','i').test(t))||spaces.find(space=>text(p).toLowerCase()===({거실:'living room',주방:'kitchen',현관:'entrance',안방:'master bedroom',욕실:'bathroom'}[space]||''));};
  const body=paragraphs.find(p=>text(p).length>25&&!spaceOf(p)&&!p.closest('.se-quotation'));
  const heading=paragraphs.find(p=>spaceOf(p)&&p.closest('.se-quotation'))||paragraphs.find(p=>spaceOf(p))||paragraphs.find(p=>{const t=text(p),c=css(p);return t.length>0&&t.length<50&&(c.fontWeight>=600||c.fontSize>(body?css(body).fontSize:15))&&!p.closest('.se-quotation');});
  const quote=root.querySelector('.se-quotation .se-text-paragraph');const components=[...root.querySelectorAll('.se-component')];
  const variant=(selector,prefix)=>root.querySelector(selector)?.className.match(new RegExp('se-l-('+prefix+'[a-z0-9_]*)'))?.[1];
  if(!body)return null;
  const dividerIndices=components.flatMap((c,i)=>c.matches('.se-horizontalLine')?[i]:[]);
  const headingComponent=heading?.closest('.se-component');const headingKind=headingComponent?.classList.contains('se-quotation')?'quote':'text';
  const dividerVariant=c=>c?.className.match(/se-l-(line[1-9]|default)/)?.[1];
  const firstHeading=components.findIndex(c=>c===headingComponent),lastHeading=components.reduce((last,c,i)=>(headingKind!=='quote'||c.classList.contains('se-quotation'))&&c.querySelectorAll('.se-text-paragraph').length&&[...c.querySelectorAll('.se-text-paragraph')].some(spaceOf)?i:last,-1);
  const dividers=dividerIndices.map(i=>({i,variant:dividerVariant(components[i])}));
  const before=dividers.filter(d=>d.i<firstHeading),after=dividers.filter(d=>d.i>lastHeading);
  const textStyles={},headingStyles={},headingVariants={};
  let role='intro';
  for(const [i,c]of components.entries()){
    const ps=[...c.querySelectorAll('.se-text-paragraph')].filter(p=>text(p));
    const space=ps.map(spaceOf).find(Boolean);
    if(space&&(headingKind!=='quote'||c.classList.contains('se-quotation'))){role=space;headingStyles[space]=css(ps.find(spaceOf));if(c.classList.contains('se-quotation'))headingVariants[space]=c.className.match(/se-l-(quotation_[a-z_]+|default)/)?.[1]||'default';continue;}
    if(!c.matches('.se-text'))continue;
    const key=i<firstHeading?(before.length>1&&i<before[0].i?'lead':'intro'):i>lastHeading&&after.length&&i>after[0].i?'outro':role;
    (textStyles[key]||=[]).push(...ps.map(css));
  }
  return {textStyles,headingStyles,headingVariants,introLead:before.length>1&&components.slice(0,before[0].i).some(c=>c.matches('.se-text')),introQuote:components.slice(0,firstHeading).some(c=>c.matches('.se-quotation')),headingKind,headingQuoteVariant:headingKind==='quote'?headingComponent.className.match(/se-l-(quotation_[a-z_]+|default)/)?.[1]:undefined,introDividerVariant:before.length>1?before[0].variant:undefined,sectionDividerVariant:before.at(-1)?.variant,outroDividerVariant:after[0]?.variant,closingDividerVariant:after.length>1?after.at(-1).variant:undefined,body:css(body),heading:css(heading||body),quote:quote?css(quote):css(heading||body),quoteVariant:variant('.se-quotation','')||'default',dividerVariant:variant('.se-horizontalLine','line')||'line1',spaceOrder:[...new Set(paragraphs.filter(p=>headingKind!=='quote'||p.closest('.se-quotation')).map(spaceOf).filter(Boolean))],dividerAfterOutro:dividerIndices.length>1&&components.slice(dividerIndices.at(-2)+1,dividerIndices.at(-1)).some(c=>c.matches('.se-text'))};
}
export function applyReferenceFormat(project,profile){
  project={...project,blocks:referenceStructure(project,profile)};
  const headings=project.blocks.flatMap((b,i)=>['heading','quote'].includes(b.kind)&&b.space?[i]:[]),first=headings[0]??Infinity,last=headings.at(-1)??-1;
  const dividers=project.blocks.flatMap((b,i)=>b.kind==='divider'?[i]:[]),before=dividers.filter(i=>i<first),after=dividers.filter(i=>i>last);
  const blocks=project.blocks.map((b,i)=>{if(['heading','quote'].includes(b.kind)&&b.space)return {...b,kind:profile.headingKind==='quote'?'quote':'heading',variant:profile.headingKind==='quote'?referenceValue(profile.headingVariants,b.space)||profile.headingQuoteVariant||profile.quoteVariant:undefined};if(b.kind==='divider')return {...b,variant:i<first?(i===before[0]&&before.length>1?profile.introDividerVariant:profile.sectionDividerVariant)||profile.dividerVariant:i===after[0]?profile.outroDividerVariant||profile.dividerVariant:profile.closingDividerVariant||profile.dividerVariant};if(b.kind==='text'&&!b.space)return {...b,formatRole:i<first?(profile.introLead&&i<before[0]?'lead':'intro'):after.length&&i>after[0]?'outro':b.formatRole};return b;});
  return {...project,blocks:spaceHeadingFirst(blocks),formatProfile:profile,draftStatus:'edited'};
}
export function referenceSpaceOrder(profile){return [...new Set(profile.spaceOrder.flatMap(s=>s==='작은방'?['작은방1','작은방2']:s==='욕실'?['공용욕실']:s))];}
export function referenceStructure(project,profile){
  let blocks=spaceHeadingFirst(project.blocks);
  const isHeading=b=>b.space&&['heading','quote'].includes(b.kind);
  const starts=blocks.flatMap((b,i)=>isHeading(b)?[i]:[]);
  if(!starts.length)return blocks;
  const end=blocks.findIndex((b,i)=>i>starts.at(-1)&&b.kind==='divider');
  const finish=end<0?blocks.length:end,order=referenceSpaceOrder(profile);
  const sections=starts.map((start,i)=>blocks.slice(start,starts[i+1]??finish));
  sections.sort((a,b)=>(order.indexOf(a[0].space)<0?100:order.indexOf(a[0].space))-(order.indexOf(b[0].space)<0?100:order.indexOf(b[0].space)));
  let prefix=blocks.slice(0,starts[0]);
  if(profile.introLead&&prefix.some(b=>b.kind==='text')&&prefix.some(b=>b.kind==='divider')){
    const texts=prefix.filter(b=>b.kind==='text'),firstDivider=prefix.findIndex(b=>b.kind==='divider');
    const existingLead=texts.find(b=>prefix.indexOf(b)<firstDivider);
    const intro=texts.filter(b=>b!==existingLead).map(b=>b.text).join('\n\n').replace(/^인테리어 디자인 제안[^\n]*\s*\n+/,'');
    const lead=existingLead||{id:(texts[0]?.id||project.id)+'-reference-lead',kind:'text',text:`인테리어 디자인 제안\n${project.target?.name||''}`.trim()};
    const dividers=prefix.filter(b=>b.kind==='divider');
    prefix=[...prefix.filter(b=>b.kind==='photos'),lead,...(dividers.length>1?[dividers[0]]:[]),{...texts.find(b=>b!==existingLead),kind:'text',text:intro},...(profile.introQuote===false?[]:prefix.filter(b=>b.kind==='quote')),...dividers.slice(dividers.length>1?1:0)];
  }else if(profile.introQuote===false)prefix=prefix.filter(b=>b.kind!=='quote');
  return [...prefix,...sections.flat(),...blocks.slice(finish)];
}
// Move a legacy heading ahead of its own immediately preceding photo groups.
// Keep cover photos, question quotes, dividers and user text in their positions.
export function spaceHeadingFirst(blocks){
  const ordered=[...blocks];
  for(let i=0;i<ordered.length;i++){
    const heading=ordered[i];
    if(!heading.space||!['heading','quote'].includes(heading.kind))continue;
    let first=i;while(first>0&&ordered[first-1].kind==='photos'&&ordered[first-1].space===heading.space)first--;
    if(first<i){ordered.splice(i,1);ordered.splice(first,0,heading);}
  }
  return ordered;
}
export function textCss(style){return `font-family:${style.fontFamily},sans-serif;font-size:${style.fontSize}px;font-weight:${style.fontWeight};font-style:normal;text-decoration:none;color:${style.color};background-color:${style.backgroundColor};`;}
export function formatFor(project){return project.formatProfile||REFERENCE_FORMAT;}
export function referenceValue(values,space){return values?.[space]||values?.[/^작은방[12]$/.test(space)?'작은방':space==='공용욕실'?'욕실':space];}
export function blockTextStyles(block,format){
  if(block.kind==='heading'||block.kind==='quote'&&block.space)return [referenceValue(format.headingStyles,block.space)||format.heading];
  if(block.kind==='quote')return [format.quote];
  return referenceValue(format.textStyles,block.space||block.formatRole)?.length?referenceValue(format.textStyles,block.space||block.formatRole):[format.body];
}
export function blockTextLines(block,format){
  const styles=blockTextStyles(block,format);let paragraph=0;
  return (block.text||'').split('\n').map(text=>({text,style:styles[Math.min(text.trim()?paragraph++:paragraph,styles.length-1)]}));
}
export function editorFormatMatches(project,state){
  const normal=t=>(t||'').replace(/[\s\u200B\uFEFF]/g,''),format=formatFor(project);
  const marker=(kind,variant)=>`<${kind}:${variant}>`;
  const expected=project.blocks.map(b=>b.kind==='photos'?marker('photos',b.assetIds.length):b.kind==='divider'?marker('divider',b.variant||format.dividerVariant):b.kind==='quote'?marker('quote',b.variant||format.quoteVariant)+normal(b.text):normal(b.text)).join('');
  const actual=state.components.filter(c=>!c.class.includes('se-documentTitle')).map(c=>c.class.includes('se-image')?marker('photos',c.photoCount):c.class.includes('se-horizontalLine')?marker('divider',c.class.match(/se-l-(\w+)/)?.[1]):c.class.includes('se-quotation')?marker('quote',c.class.match(/se-l-(\w+)/)?.[1])+normal(c.text):normal(c.text)).join('');
  if(expected!==actual)return false;
  // A caret in the middle of the final sentence used to split it when the next
  // component was added. Comparing text alone cannot detect that extra break.
  const boundaries=new Set([0]);let expectedOffset=0,actualOffset=0;
  for(const b of project.blocks.filter(b=>['heading','text','quote'].includes(b.kind)))for(const line of (b.text||'').split(/\r?\n/)){expectedOffset+=normal(line).length;boundaries.add(expectedOffset);}
  for(const p of state.paragraphs){actualOffset+=normal(p.spans.map(s=>s.text).join('')).length;if(!boundaries.has(actualOffset))return false;}
  if(actualOffset!==expectedOffset)return false;
  const color=c=>{if(c==='transparent'||c==='rgba(0, 0, 0, 0)')return 'transparent';if(c.startsWith('#')){const hex=c.slice(1);return (hex.length===3?hex.split('').map(x=>x+x):hex.match(/../g)).map(x=>parseInt(x,16)).join(',');}return c.match(/[\d.]+/g)?.slice(0,3).join(',');};
  const spans=state.paragraphs.flatMap(p=>p.spans.map(s=>({...s,align:p.align})));let offset=0;
  for(const b of project.blocks.filter(b=>['heading','text','quote'].includes(b.kind))){
    const styles=blockTextStyles(b,format),uniform=styles.every(s=>JSON.stringify(s)===JSON.stringify(styles[0]));
    for(const {text:line,style}of (uniform?[{text:b.text||'',style:styles[0]}]:blockTextLines(b,format))){
      const target=normal(line);let read='';
      while(read.length<target.length&&offset<spans.length){const s=spans[offset++];read+=normal(s.text);if(Number(s.fontWeight)!==style.fontWeight||parseFloat(s.fontSize)!==style.fontSize||color(s.backgroundColor)!==color(style.backgroundColor)||color(s.color)!==color(style.color)||s.align!==style.align||!s.fontFamily.includes(style.fontFamily))return false;}
      if(read!==target)return false;
    }
  }
  return offset===spans.length;
}

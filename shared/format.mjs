// These defaults were read from all five saved Lemonhouse reference posts.
export const REFERENCE_FORMAT = {
  body:{fontFamily:'nanumbarungothic',fontSize:15,fontWeight:400,color:'#000000',backgroundColor:'#ffffff',align:'center'},
  heading:{fontFamily:'nanumbarungothic',fontSize:19,fontWeight:700,color:'#000000',backgroundColor:'#ffe3c8',align:'center'},
  quote:{fontFamily:'nanumbarungothic',fontSize:19,fontWeight:700,color:'#8a837e',backgroundColor:'transparent',align:'center'},
  quoteVariant:'quotation_corner',dividerVariant:'line6',spaceOrder:['현관','거실','주방','안방','작은방','욕실','기타'],dividerAfterOutro:true,
};

// Run in the reference article frame. Inspect visible text nodes, since the
// paragraph's computed font can differ from the font applied to its spans.
export function readReferenceFormat(){
  const root=document.querySelector('.se-main-container');if(!root)return null;
  const spaces=['현관','거실','주방','안방','작은방','욕실','기타'];
  const paragraphs=[...root.querySelectorAll('.se-component.se-text .se-text-paragraph')];
  const text=p=>p.textContent.replace(/[\u200B\uFEFF]/g,'').trim();
  const css=p=>{const node=[...p.querySelectorAll('b,strong,span')].find(e=>e.textContent.trim()&&e.matches('b,strong'))||[...p.querySelectorAll('span')].find(e=>e.textContent.trim())||p;const s=getComputedStyle(node),ps=getComputedStyle(p);const bg=s.backgroundColor==='rgba(0, 0, 0, 0)'&&node.parentElement?getComputedStyle(node.parentElement).backgroundColor:s.backgroundColor;return {fontFamily:(node.className+' '+(node.closest('[class*="se-ff-"]')?.className||'')).match(/se-ff-([a-z][a-z0-9]*)/)?.[1]||'nanumbarungothic',fontSize:parseFloat(s.fontSize),fontWeight:Number(s.fontWeight)||400,color:s.color,backgroundColor:bg==='rgba(0, 0, 0, 0)'?'transparent':bg,align:['left','center','right','justify'].includes(ps.textAlign)?ps.textAlign:'center'};};
  const heading=paragraphs.find(p=>spaces.includes(text(p))),body=paragraphs.find(p=>text(p).length>40&&!spaces.includes(text(p)));
  const quote=root.querySelector('.se-quotation .se-text-paragraph');const components=[...root.querySelectorAll('.se-component')];
  const variant=(selector,prefix)=>root.querySelector(selector)?.className.match(new RegExp('se-l-('+prefix+'[a-z0-9_]*)'))?.[1];
  if(!body||!heading)return null;
  const dividerIndices=components.flatMap((c,i)=>c.matches('.se-horizontalLine')?[i]:[]);
  return {body:css(body),heading:css(heading),quote:quote?css(quote):css(heading),quoteVariant:variant('.se-quotation','')||'default',dividerVariant:variant('.se-horizontalLine','line')||'line1',spaceOrder:[...new Set(paragraphs.map(text).filter(t=>spaces.includes(t)))],dividerAfterOutro:dividerIndices.length>1&&components.slice(dividerIndices.at(-2)+1,dividerIndices.at(-1)).some(c=>c.matches('.se-text'))};
}
export function textCss(style){return `font-family:${style.fontFamily},sans-serif;font-size:${style.fontSize}px;font-weight:${style.fontWeight};font-style:normal;text-decoration:none;color:${style.color};background-color:${style.backgroundColor};`;}
export function formatFor(project){return project.formatProfile||REFERENCE_FORMAT;}
export function editorFormatMatches(project,state){
  const normal=t=>(t||'').replace(/[\s\u200B\uFEFF]/g,''),format=formatFor(project);
  const marker=(kind,variant)=>`<${kind}:${variant}>`;
  const expected=project.blocks.map(b=>b.kind==='photos'?marker('photos',b.assetIds.length):b.kind==='divider'?marker('divider',format.dividerVariant):b.kind==='quote'?marker('quote',format.quoteVariant)+normal(b.text):normal(b.text)).join('');
  const actual=state.components.filter(c=>!c.class.includes('se-documentTitle')).map(c=>c.class.includes('se-image')?marker('photos',c.photoCount):c.class.includes('se-horizontalLine')?marker('divider',c.class.match(/se-l-(\w+)/)?.[1]):c.class.includes('se-quotation')?marker('quote',c.class.match(/se-l-(\w+)/)?.[1])+normal(c.text):normal(c.text)).join('');
  if(expected!==actual)return false;
  const color=c=>{if(c==='transparent'||c==='rgba(0, 0, 0, 0)')return 'transparent';if(c.startsWith('#')){const hex=c.slice(1);return (hex.length===3?hex.split('').map(x=>x+x):hex.match(/../g)).map(x=>parseInt(x,16)).join(',');}return c.match(/[\d.]+/g)?.slice(0,3).join(',');};
  const spans=state.paragraphs.flatMap(p=>p.spans.map(s=>({...s,align:p.align})));let offset=0;
  for(const b of project.blocks.filter(b=>['heading','text','quote'].includes(b.kind))){
    const target=normal(b.text);let read='';const style=b.kind==='heading'?format.heading:b.kind==='quote'?format.quote:format.body;
    while(read.length<target.length&&offset<spans.length){const s=spans[offset++];read+=normal(s.text);if(Number(s.fontWeight)!==style.fontWeight||parseFloat(s.fontSize)!==style.fontSize||color(s.backgroundColor)!==color(style.backgroundColor)||color(s.color)!==color(style.color)||s.align!==style.align||!s.fontFamily.includes(style.fontFamily))return false;}
    if(read!==target)return false;
  }
  return offset===spans.length;
}

import {useState,type CSSProperties} from 'react';
import {Monitor,Smartphone,Image,Eye} from 'lucide-react';
import type {Project,Asset} from '../../shared/model';
import {postSite,postLabel,isPlanCollage} from '../../shared/domain.mjs';
import {formatFor,blockTextStyles,blockTextLines} from '../../shared/format.mjs';
import {photoUploadBlocks} from '../../shared/photo-layout.mjs';
export default function Preview({project,assets}:{project:Project;assets:Asset[]}){
  const [mobile,setMobile]=useState(false);const map=new Map(assets.map(a=>[a.id,a])),blocks=photoUploadBlocks(project.blocks) as Project['blocks'];
  const format=formatFor(project);const css=({align,...style}:typeof format.body):CSSProperties=>({...style,textAlign:align,fontFamily:`${style.fontFamily},sans-serif`,fontStyle:'normal',textDecoration:'none'});
  return <aside className={`preview-panel ${mobile?'mobile':''}`}><div className="preview-header"><span><Eye size={15}/>게시글 미리보기</span><div><button className={!mobile?'active':''} onClick={()=>setMobile(false)} aria-label="PC 미리보기" aria-pressed={!mobile}><Monitor size={16}/></button><button className={mobile?'active':''} onClick={()=>setMobile(true)} aria-label="모바일 미리보기" aria-pressed={mobile}><Smartphone size={16}/></button></div></div><div className="preview-scroll"><div className="preview-page"><div className="preview-blog-name">LEMON HOUSE · {postLabel(project)}</div><h1>{project.title||`${postSite(project).name||'아파트'} ${postLabel(project)}`}</h1><div className="preview-author">레몬하우스 인테리어 <span>게시글 미리보기</span></div><div className="preview-divider"/>
    {blocks.length?blocks.map((b,i)=>{
      if(b.kind==='map')return <div className="preview-map" key={b.id}><strong>현장 지도</strong><p>{b.text}</p><small>네이버 장소 검색에서 확인 후 지도 카드를 넣습니다.</small></div>;
      if(b.kind==='video'){const a=map.get(b.assetIds?.[0]||'');return a?<figure className="preview-video" key={b.id}><video controls preload="metadata" aria-label={b.text||'현장 동영상'} src={a.originalUrl}/><figcaption>{b.text}</figcaption></figure>:null;}
      if(b.kind==='photos')return <div className={`preview-photos ${b.layout==='slide'?'slide':''}`} key={b.id}>{b.assetIds?.map(id=>{const a=map.get(id);return a?<img key={id} src={a.previewUrl} alt={a.space} style={b.space==='표지'||isPlanCollage(project,b,assets)?{aspectRatio:'1 / 1',objectFit:'cover'}:undefined}/>:null;})}</div>;
      if(b.kind==='divider')return <hr className={`post-rule ${b.variant||format.dividerVariant}`} key={b.id}/>;
      const styles=blockTextStyles(b,format),style=styles[0];
      if(b.kind==='heading')return <h3 className="post-heading" style={{textAlign:style.align}} key={b.id}><span style={css(style)}>{b.text}</span></h3>;
      if(b.kind==='quote')return <blockquote className={b.variant||format.quoteVariant} style={css(style)} key={b.id}>{styles.length===1?b.text:blockTextLines(b,format).map(({text,style:lineStyle}:{text:string;style:typeof style},i:number)=><span key={i} style={{...css(lineStyle),display:'block'}}>{text||'\u00a0'}</span>)}</blockquote>;
      return <p className="post-text" style={{...css(style),...(project.postType==='completion'&&['point','pointBody'].includes(b.formatRole||'')?{margin:0,lineHeight:1.8}:{}),...(project.postType==='completion'&&b.formatRole==='point'&&blocks[i-1]?.formatRole==='pointBody'?{marginTop:'1.8em'}:{})}} key={b.id}>{styles.every((s:typeof style)=>JSON.stringify(s)===JSON.stringify(style))?b.text:blockTextLines(b,format).map(({text,style:lineStyle}:{text:string;style:typeof style},i:number)=><span key={i} style={{...css(lineStyle),display:'block'}}>{text||'\u00a0'}</span>)}</p>;
    }):<div className="preview-empty"><Image size={38}/><h3>원고를 작성하면 여기에 보여요</h3><p>사진 배치와 글을 함께 확인하며<br/>자연스럽게 다듬어 보세요.</p></div>}
    {project.tags.length?<div className="preview-tags">{project.tags.map(t=><span key={t}>#{t}</span>)}</div>:null}
    </div></div><div className="preview-caption">네이버 등록 후 사진과 서식을 다시 확인합니다.</div></aside>;
}

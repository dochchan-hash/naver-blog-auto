import {useState,type CSSProperties} from 'react';
import {Monitor,Smartphone,Image,Eye} from 'lucide-react';
import type {Project,Asset} from '../../shared/model';
import {formatFor} from '../../shared/format.mjs';
export default function Preview({project,assets}:{project:Project;assets:Asset[]}){
  const [mobile,setMobile]=useState(false);const map=new Map(assets.map(a=>[a.id,a]));
  const format=formatFor(project);const css=(s:typeof format.body):CSSProperties=>({...s,textAlign:s.align,fontFamily:`${s.fontFamily},sans-serif`,fontStyle:'normal',textDecoration:'none'});
  return <aside className={`preview-panel ${mobile?'mobile':''}`}><div className="preview-header"><span><Eye size={15}/>게시글 미리보기</span><div><button className={!mobile?'active':''} onClick={()=>setMobile(false)} aria-label="PC 미리보기" aria-pressed={!mobile}><Monitor size={16}/></button><button className={mobile?'active':''} onClick={()=>setMobile(true)} aria-label="모바일 미리보기" aria-pressed={mobile}><Smartphone size={16}/></button></div></div><div className="preview-scroll"><div className="preview-page"><div className="preview-blog-name">LEMON HOUSE · 인테리어 추천</div><h1>{project.title||`${project.target.name||'아파트'} 인테리어 추천`}</h1><div className="preview-author">레몬하우스 인테리어 <span>게시글 미리보기</span></div><div className="preview-divider"/>
    {project.blocks.length?project.blocks.map(b=>{
      if(b.kind==='photos')return <div className="preview-photos" key={b.id}>{b.assetIds?.map(id=>{const a=map.get(id);return a?<img key={id} src={a.previewUrl} alt={a.space}/>:null;})}</div>;
      if(b.kind==='divider')return <hr className={`post-rule ${format.dividerVariant}`} key={b.id}/>;
      if(b.kind==='heading')return <h3 className="post-heading" style={{textAlign:format.heading.align}} key={b.id}><span style={css(format.heading)}>{b.text}</span></h3>;
      if(b.kind==='quote')return <blockquote className={format.quoteVariant} style={css(format.quote)} key={b.id}>{b.text}</blockquote>;
      return <p className="post-text" style={css(format.body)} key={b.id}>{b.text}</p>;
    }):<div className="preview-empty"><Image size={38}/><h3>원고를 작성하면 여기에 보여요</h3><p>사진 배치와 글을 함께 확인하며<br/>자연스럽게 다듬어 보세요.</p></div>}
    {project.tags.length?<div className="preview-tags">{project.tags.map(t=><span key={t}>#{t}</span>)}</div>:null}
    </div></div><div className="preview-caption">네이버 등록 후 사진과 서식을 다시 확인합니다.</div></aside>;
}

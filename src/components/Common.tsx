import {useId,useRef,useState} from 'react';
import {UploadCloud,Plus,LoaderCircle,ChevronRight} from 'lucide-react';
import type {Role} from '../../shared/model';
export function Field({label,hint,children}: {label:string;hint?:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}{hint?<small>{hint}</small>:null}</label>;}
export function SectionTitle({eyebrow,title,description,action}:{eyebrow?:string;title:string;description?:string;action?:React.ReactNode}){return <div className="section-heading"><div>{eyebrow?<span className="eyebrow">{eyebrow}</span>:null}<h2>{title}</h2>{description?<p>{description}</p>:null}</div>{action}</div>;}
export function Notice({children,tone='neutral'}:{children:React.ReactNode;tone?:'neutral'|'warning'|'success'}){return <div className={`notice ${tone}`}>{children}</div>;}
export function Button({children,className='',busy=false,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{busy?:boolean}){return <button className={`button ${className}`} {...props} disabled={props.disabled||busy}>{busy?<LoaderCircle size={16} className="spin"/>:null}{children}</button>;}
export function Next({children,onClick}:{children:React.ReactNode;onClick:()=>void}){return <div className="step-footer"><Button className="primary" onClick={onClick}>{children}<ChevronRight size={16}/></Button></div>;}
export function Dropzone({role,title,description,accept,onFiles,disabled=false,compact=false}:{role:Role;title:string;description:string;accept:string;onFiles:(files:File[],role:Role)=>void;disabled?:boolean;compact?:boolean}){
  const input=useRef<HTMLInputElement>(null),id=useId();const [dragging,setDragging]=useState(false);
  return <div className={`dropzone ${dragging?'dragging':''} ${compact?'compact':''}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(!disabled)onFiles(Array.from(e.dataTransfer.files),role);}}>
    <div className="drop-icon"><UploadCloud size={24}/></div><h3>{title}</h3><p>{description}</p>
    <input id={id} ref={input} type="file" accept={accept} multiple hidden disabled={disabled} onChange={e=>{onFiles(Array.from(e.target.files||[]),role);e.target.value='';}}/>
    <Button className="secondary small" disabled={disabled} onClick={()=>input.current?.click()}><Plus size={15}/>파일 선택</Button>
  </div>;
}
export function bytes(value:number){if(value<1024)return `${value} B`;if(value<1024**2)return `${(value/1024).toFixed(0)} KB`;return `${(value/1024**2).toFixed(1)} MB`;}

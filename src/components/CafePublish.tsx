import type {Project,Asset} from '../../shared/model';
import {draftWarnings} from '../../shared/domain.mjs';
import {Button,Field,Notice,SectionTitle} from './Common';
export function CafePublish({project,assets,update,save,notify,task,busy,available}:{project:Project;assets:Asset[];update:(patch:Partial<Project>)=>void;save:()=>Promise<void>;notify:(text:string)=>void;task:(kind:string)=>void;busy:boolean;available:boolean}){
  const warnings=draftWarnings(project,assets);
  const download=async()=>{try{await save();const link=document.createElement('a');link.href=`/api/projects/${project.id}/export`;link.download='';link.click();}catch(e){notify((e as Error).message);}};
  return <><SectionTitle eyebrow="04 · 네이버 카페" title="마감 게시글 확인" description="마감은 카페 게시판에 작성합니다. 대상 카페·게시판과 미리보기를 확인하세요."/>
    <section className="card"><Field label="대상 카페"><input type="url" value={project.cafeTargetUrl||''} onChange={e=>update({cafeTargetUrl:e.target.value})}/></Field><Field label="대상 게시판"><input type="url" value={project.cafeBoardUrl||''} onChange={e=>update({cafeBoardUrl:e.target.value})}/></Field>
      {warnings.length?<Notice tone="warning"><ul>{warnings.map(w=><li key={w}>{w}</li>)}</ul></Notice>:<Notice tone="success">원고의 기본 검사를 통과했습니다.</Notice>}
      <Button className="secondary full" onClick={download} disabled={!project.title||!project.blocks.length}>마감 원고 HTML 내려받기</Button>
      <Button className="primary full" busy={busy} disabled={!available||!project.title||!project.blocks.length||!project.cafeTargetUrl} onClick={()=>task('prepare')}>카페에 입력하고 임시저장</Button>
      <Notice>제목·본문·사진·지도·인용구·구분선과 동영상을 카페에 입력합니다. 동영상 업로드 완료 후 마지막 사진과 태그를 넣고 임시저장을 확인합니다. 최종 등록은 직접 검토한 뒤 진행하세요. PSD 문구와 사진은 사진 단계에서 수정하고 JPG로 적용합니다.</Notice>
    </section></>;
}

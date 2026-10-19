import type {Project,Asset} from '../../shared/model';
import {draftWarnings} from '../../shared/domain.mjs';
import {Button,Field,Notice,SectionTitle} from './Common';
export function CafePublish({project,assets,update,save,notify}:{project:Project;assets:Asset[];update:(patch:Partial<Project>)=>void;save:()=>Promise<void>;notify:(text:string)=>void}){
  const warnings=draftWarnings(project,assets);
  const download=async()=>{try{await save();const link=document.createElement('a');link.href=`/api/projects/${project.id}/export`;link.download='';link.click();}catch(e){notify((e as Error).message);}};
  return <><SectionTitle eyebrow="04 · 네이버 카페" title="마감 게시글 확인" description="마감은 카페 게시판에 작성합니다. 대상 카페·게시판과 미리보기를 확인하세요."/>
    <section className="card"><Field label="대상 카페"><input type="url" value={project.cafeTargetUrl||''} onChange={e=>update({cafeTargetUrl:e.target.value})}/></Field><Field label="대상 게시판"><input type="url" value={project.cafeBoardUrl||''} onChange={e=>update({cafeBoardUrl:e.target.value})}/></Field>
      {warnings.length?<Notice tone="warning"><ul>{warnings.map(w=><li key={w}>{w}</li>)}</ul></Notice>:<Notice tone="success">원고의 기본 검사를 통과했습니다.</Notice>}
      <Button className="secondary full" onClick={download} disabled={!project.title||!project.blocks.length}>마감 원고 HTML 내려받기</Button>
      <Notice>현재 테스트 단계에서는 원고 작성·사진 배치·미리보기와 파일 저장을 사용할 수 있습니다. 실제 PSD 자동 편집과 카페 편집기 입력·등록은 PSD를 받은 뒤 검증해 연결합니다.</Notice>
    </section></>;
}

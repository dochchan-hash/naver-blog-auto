const {Notification}=require('electron');
const names={analyze:'사진·시공 자료 분석',compare:'도면 비교',generate:'원고 작성',templates:'템플릿 이미지 만들기',style:'작성 스타일 분석',format:'원본 서식 가져오기',prepare:'네이버 편집기 준비',publish:'네이버 등록',verify:'네이버 등록 확인'};
const statuses={completed:'완료',cancelled:'중단',cancelling:'중단 중',failed:'실패',limited:'사용량 확인 필요',login_required:'계정 연결 필요',uncertain:'등록 결과 확인 필요'};
function jobNotifications(getWindow){
  const shown=new Map();
  return job=>{
    if(!Notification.isSupported())return;
    const running=['running','queued'].includes(job.status),stage=Math.min(3,Math.floor(job.progress/25)),previous=shown.get(job.id);
    if(previous&&(running?previous.status===job.status&&stage<=previous.stage:previous.status===job.status))return;
    const status=running?`진행 중 ${stage*25}%`:job.result?.needsReview?'원고 확인 필요':statuses[job.status]||'확인 필요';
    const body=job.status==='completed'?(job.result?.needsReview?'원고를 작성했습니다. 검토가 필요한 항목을 확인해 주세요.':job.kind==='prepare'?'수정한 원고를 네이버 편집기에 준비했습니다. 최종 발행은 하지 않았습니다.':job.kind==='generate'&&job.result?.publish?'원고 작성과 네이버 등록을 완료했습니다.':`${names[job.kind]||'작업'}을 완료했습니다.`):job.message;
    const notification=new Notification({id:job.id,groupId:'lemonhouse-jobs',title:`${names[job.kind]||'블로그 스튜디오'} · ${status}`,body,silent:running});
    notification.on('click',()=>{const window=getWindow();if(!window||window.isDestroyed())return;if(window.isMinimized())window.restore();window.show();window.focus();});
    notification.on('failed',(_,error)=>{console.error('Windows 알림을 표시하지 못했습니다:',error);});
    notification.show();shown.set(job.id,{status:job.status,stage,notification});
  };
}
module.exports={jobNotifications};

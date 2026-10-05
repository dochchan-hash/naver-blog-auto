export async function localApi(base){
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base||''))throw new Error('로컬 프로그램 주소를 확인해 주세요.');
  const response=await fetch(base+'/api/bootstrap');if(!response.ok)throw new Error('프로그램에 연결할 수 없습니다.');
  const bootstrap=await response.json();const cookie=response.headers.get('set-cookie').split(';')[0];
  const request=async(route,method='GET',body)=>{
    const res=await fetch(base+'/api'+route,{method,headers:{cookie,Origin:base,'X-Lemon-CSRF':bootstrap.csrf,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});
    const value=await res.json();if(!res.ok)throw Object.assign(new Error(value.error||`요청 실패 (${res.status})`),{details:value.details,status:res.status});return value;
  };
  return {bootstrap,request};
}

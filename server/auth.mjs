import {randomBytes,createHash} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';
const AUTH='https://auth.openai.com';
const RESOURCE='https://api.openai.com/v1';
const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const appError=(message,status=400)=>Object.assign(new Error(message),{status});
export class Auth {
  constructor(store,vault){this.store=store;this.vault=vault;this.pending=null;this.lastError='';this.modelCache=[];this.refreshing=null;}
  account(){return this.store.get('account','active');}
  status(){const a=this.account();return {connected:!!a&&!!this.vault.get('chatgpt'),email:a?.email,planEnabled:a?.scopes?.includes('chatgpt.tokens.use.direct')||false,lastError:this.lastError,models:this.modelCache};}
  begin(baseUrl,{newAccount=false}={}){
    const a=newAccount?null:this.account();
    const verifier=randomBytes(48).toString('base64url'),state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url');
    const redirectUri=`${baseUrl}/auth/callback`;
    this.pending={verifier,state,nonce,redirectUri,clientId:a?.clientId||'dynamic_agent_client',subject:a?.subject,expires:Date.now()+10*60*1000};
    const url=new URL(`${AUTH}/api/accounts/authorize`);
    const params={client_id:this.pending.clientId,ext_agent_host_id:this.store.get('system','host').hostId,response_type:'code',redirect_uri:redirectUri,scope:SCOPES,resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')};
    if(!a)params.agent_name_hint='Lemonhouse Blog Studio';
    else {const secrets=this.vault.get('chatgpt');if(secrets?.id_token)params.id_token_hint=secrets.id_token;if(a.email)params.login_hint=a.email;}
    for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
    this.lastError='';return url.toString();
  }
  async callback(query) {
    const pending=this.pending;
    if(!pending||pending.expires<Date.now()||typeof query.state!=='string'||query.state!==pending.state)throw appError('로그인 요청이 만료되었거나 일치하지 않습니다. 연결을 다시 시작해 주세요.');
    this.pending=null;
    if(query.error)throw appError('ChatGPT 요금제 사용 권한이 승인되지 않았습니다. 자료는 그대로 저장되어 있습니다.',401);
    if(typeof query.code!=='string')throw appError('로그인 응답에 인증 코드가 없습니다.');
    let clientId=pending.clientId;
    if(clientId==='dynamic_agent_client'){
      if(typeof query.client_id!=='string'||query.client_id==='dynamic_agent_client')throw appError('계정 연결 등록이 완료되지 않았습니다.');
      clientId=query.client_id;
    }else if(query.client_id&&query.client_id!==clientId)throw appError('로그인 계정 등록 정보가 일치하지 않습니다.');
    const tokens=await this.tokenRequest({grant_type:'authorization_code',client_id:clientId,code:query.code,code_verifier:pending.verifier,redirect_uri:pending.redirectUri,resource:RESOURCE});
    if(!tokens.id_token)throw appError('로그인 계정을 확인할 수 없습니다.',401);
    const discovery=await fetch(`${AUTH}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(20000)}).then(r=>r.json());
    if(discovery.issuer!==AUTH||typeof discovery.jwks_uri!=='string'||!discovery.jwks_uri.startsWith(`${AUTH}/`))throw appError('공식 인증 정보 확인에 실패했습니다.',401);
    const {payload}=await jwtVerify(tokens.id_token,createRemoteJWKSet(new URL(discovery.jwks_uri)),{issuer:AUTH,audience:clientId,requiredClaims:['sub','exp','iat','nonce']});
    if(payload.nonce!==pending.nonce||!payload.sub||(pending.subject&&payload.sub!==pending.subject))throw appError('로그인 계정 검증에 실패했습니다.',401);
    const scopes=String(tokens.scope||'').split(/\s+/);
    if(!scopes.includes('chatgpt.tokens.use.direct'))throw appError('이 계정에서 프로그램의 ChatGPT 요금제 사용이 허용되지 않았습니다.',401);
    this.vault.set('chatgpt',{...tokens,clientId,expiresAt:Date.now()+Number(tokens.expires_in||3600)*1000});
    this.store.put('account','active',{email:payload.email||'ChatGPT 계정',subject:payload.sub,clientId,scopes,connectedAt:new Date().toISOString()});
    this.lastError='';await this.models();return this.status();
  }
  async tokenRequest(values){
    const response=await fetch(`${AUTH}/api/accounts/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values),signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw appError(response.status===429?'ChatGPT 요청 한도에 도달했습니다. 잠시 후 다시 연결해 주세요.':'ChatGPT 인증을 완료하지 못했습니다. 공식 로그인 화면에서 다시 연결해 주세요.',response.status===429?429:401);
    return response.json();
  }
  async token(){
    const t=this.vault.get('chatgpt');if(!t||!this.account())throw appError('설정에서 ChatGPT 계정을 연결해 주세요.',401);
    if(!this.account().scopes?.includes('chatgpt.tokens.use.direct'))throw appError('ChatGPT 구독 사용 권한이 없습니다. 계정을 다시 연결해 구독 사용을 승인해 주세요.',401);
    if(t.expiresAt>Date.now()+60000)return t.access_token;
    if(this.refreshing)return this.refreshing;
    this.refreshing=(async()=>{
      try{const next=await this.tokenRequest({grant_type:'refresh_token',client_id:t.clientId,refresh_token:t.refresh_token,resource:RESOURCE});const saved={...t,...next,expiresAt:Date.now()+Number(next.expires_in||3600)*1000};this.vault.set('chatgpt',saved);return saved.access_token;}
      catch(error){this.lastError='ChatGPT 로그인을 갱신해 주세요.';throw error;}
      finally{this.refreshing=null;}
    })();return this.refreshing;
  }
  async models(){
    const response=await fetch(`${RESOURCE}/models`,{headers:{Authorization:`Bearer ${await this.token()}`},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw appError('계정에서 사용할 수 있는 AI 모델을 조회하지 못했습니다.',response.status===429?429:response.status===401?401:502);
    const body=await response.json();const catalog=body.models||body.data||[];
    this.modelCache=catalog.filter(m=>m.visibility==='list').map(m=>({id:m.slug||m.id,name:m.display_name||m.name||m.slug||m.id,capabilities:m.supported_modalities||m.modalities})).filter(m=>m.id);
    return this.modelCache;
  }
  async disconnect(){this.vault.remove('chatgpt');this.store.remove('account','active');this.modelCache=[];this.lastError='';}
}
export function memoryVault(){const values=new Map();return {get:k=>values.get(k),set:(k,v)=>values.set(k,v),remove:k=>values.delete(k),persistent:false};}

const base64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const unbase64=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),character=>character.charCodeAt(0));

const AUTH='https://auth.openai.com', API='https://api.openai.com/v1';
const secret=()=>base64(crypto.getRandomValues(new Uint8Array(32)));
export class LocalError extends Error {}
const fail=message=>{throw new LocalError(message);};
const endpoint=value=>{const url=new URL(value);if(url.origin!==AUTH||url.username||url.password)fail('Endpoint de identidade inválido.');return url.href;};
export async function verifyIdentity(jwt,{jwks,issuer,clientId,nonce,now=Date.now()}){
 try{
  const parts=jwt.split('.');if(parts.length!==3)throw Error();
  const header=JSON.parse(new TextDecoder().decode(unbase64(parts[0]))),claims=JSON.parse(new TextDecoder().decode(unbase64(parts[1])));
  if(!['RS256','ES256'].includes(header.alg)||header.crit||!header.kid)throw Error();
  const jwk=jwks.keys.find(k=>k.kid===header.kid&&(!k.use||k.use==='sig')&&(!k.alg||k.alg===header.alg));
  if(!jwk||jwk.kty!==(header.alg==='RS256'?'RSA':'EC'))throw Error();
  const algorithm=header.alg==='RS256'?{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}:{name:'ECDSA',namedCurve:'P-256'};
  const key=await crypto.subtle.importKey('jwk',jwk,algorithm,false,['verify']);
  if(!await crypto.subtle.verify(header.alg==='RS256'?algorithm:{name:'ECDSA',hash:'SHA-256'},key,unbase64(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error();
  const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(claims.iss!==issuer||!audiences.includes(clientId)||(audiences.length>1&&claims.azp!==clientId)||typeof claims.exp!=='number'||claims.exp<=now/1000||claims.nbf>now/1000+30||claims.nonce!==nonce||typeof claims.sub!=='string'||!claims.sub)throw Error();
  return {subject:claims.sub,email:typeof claims.email==='string'?claims.email.slice(0,254):''};
 }catch{fail('A identidade retornada pelo ChatGPT não passou na validação. Entre novamente.');}
}
export class OpenAISession {
 constructor({hostId,registrations=[],saveRegistrations=async()=>{},fetcher=(...args)=>globalThis.fetch(...args),now=Date.now}){
  this.hostId=hostId;this.registrations=registrations;this.saveRegistrations=saveRegistrations;this.fetcher=fetcher;this.now=now;this.active=null;this.pending=null;this.loginError='';this.refreshing=null;this.generation=0;
 }
 async json(url,options={}){
  const response=await this.fetcher(url,{...options,redirect:'error',credentials:'omit',signal:options.signal??AbortSignal.timeout(20000)});
  if(!response.ok){
   if(response.status===401)fail('A sessão ChatGPT expirou ou foi recusada. Entre novamente.');
   if(response.status===403)fail('O ChatGPT recusou esta autorização ou o acesso ao plano/modelo. Confira as permissões da conta.');
   if(response.status===429)fail('Limite de uso do ChatGPT atingido. Aguarde antes de tentar novamente.');
   fail('Não foi possível concluir a chamada oficial à OpenAI. Tente novamente.');
  }
  return response.json();
 }
 async metadata(){
  const data=await this.json(AUTH+'/.well-known/openid-configuration');
  if(data.issuer!==AUTH)fail('Emissor de identidade inválido.');
  endpoint(data.jwks_uri);if(data.revocation_endpoint)endpoint(data.revocation_endpoint);
  return data;
 }
 status(){
  if(this.pending&&this.pending.expiresAt<=this.now()){this.pending=null;this.loginError='A tentativa de login expirou. Inicie novamente.';}
  return {connected:!!this.active,account:this.active?{email:this.active.email,subjectLabel:this.active.subject.slice(-6),planEnabled:this.active.scope.split(' ').includes('chatgpt.tokens.use.direct')}:null,accounts:this.registrations.map(r=>({id:r.clientId,label:(r.email||'Conta ChatGPT')+' · '+r.clientId.slice(-6)})),loginPending:!!this.pending,error:this.loginError};
 }
 async begin(redirectUri,accountId){
  const registration=accountId?this.registrations.find(r=>r.clientId===accountId):null;
  if(accountId&&!registration)fail('Conta local não encontrada.');
  const verifier=secret(),state=secret(),nonce=secret();
  this.pending={verifier,state,nonce,redirectUri,registration,expiresAt:this.now()+300000,generation:++this.generation};this.loginError='';
  const url=new URL(AUTH+'/api/accounts/authorize');
  const values={client_id:registration?.clientId??'dynamic_agent_client',ext_agent_host_id:this.hostId,response_type:'code',redirect_uri:redirectUri,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',resource:API,state,nonce,code_challenge_method:'S256',code_challenge:base64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))};
  if(!registration)values.agent_name_hint='O Espertinho — Assistente local';
  for(const [key,value] of Object.entries(values))url.searchParams.set(key,value);
  return url.href;
 }
 async callback(params){
  const pending=this.pending;
  if(!pending||pending.expiresAt<=this.now()||params.get('state')!==pending.state)fail('Retorno de login inválido ou expirado.');
  this.pending=null;
  try{
   if(params.has('error'))fail('A autorização do ChatGPT foi recusada ou cancelada.');
   const clientId=params.get('client_id')??pending.registration?.clientId,code=params.get('code');
   if(!code||code.length>4096||!clientId||clientId==='dynamic_agent_client'||!/^[\w-]{1,250}$/.test(clientId)||(pending.registration&&clientId!==pending.registration.clientId))fail('Registro OAuth incompleto. Inicie o login novamente.');
   const tokens=await this.json(AUTH+'/api/accounts/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,code_verifier:pending.verifier,redirect_uri:pending.redirectUri,resource:API})});
   const metadata=await this.metadata(),jwks=await this.json(endpoint(metadata.jwks_uri));
   const identity=await verifyIdentity(tokens.id_token,{jwks,issuer:metadata.issuer,clientId,nonce:pending.nonce,now:this.now()});
   if(pending.registration&&identity.subject!==pending.registration.subject)fail('A conta retornada difere da conta selecionada.');
   this.validateTokens(tokens);
   const registration={clientId,...identity};
   this.registrations=[...this.registrations.filter(r=>r.clientId!==clientId),registration].slice(-20);
   await this.saveRegistrations(this.registrations);
   if(pending.generation!==this.generation)fail('A tentativa de login foi interrompida.');
   this.active={...registration,...tokens,expiresAt:this.now()+tokens.expires_in*1000};
  }catch(error){this.loginError=error instanceof LocalError?error.message:'Falha ao validar o login oficial. Tente novamente.';throw new LocalError(this.loginError);}
 }
 validateTokens(tokens){
  if(typeof tokens.access_token!=='string'||typeof tokens.refresh_token!=='string'||typeof tokens.scope!=='string'||tokens.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0)fail('Credenciais OAuth incompletas. Entre novamente.');
 }
 async token(){
  if(!this.active)fail('Entre com ChatGPT para continuar.');
  if(!this.active.scope.split(' ').includes('chatgpt.tokens.use.direct'))fail('A conta foi identificada, mas não autorizou uso do plano. Conecte novamente e autorize o uso.');
  if(this.active.expiresAt-this.now()<60000){
   this.refreshing??=this.refresh().finally(()=>{this.refreshing=null;});await this.refreshing;
  }
  if(!this.active)fail('Sessão encerrada.');
  return this.active.access_token;
 }
 async refresh(){
  const active=this.active;
  const tokens=await this.json(AUTH+'/api/accounts/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:active.clientId,refresh_token:active.refresh_token,resource:API})});
  const updated={...tokens,refresh_token:tokens.refresh_token??active.refresh_token,scope:tokens.scope??active.scope};this.validateTokens(updated);
  if(this.active!==active)fail('A sessão foi alterada durante a renovação.');
  this.active={...active,...updated,expiresAt:this.now()+updated.expires_in*1000};
 }
 async models(){
  const token=await this.token();
  const data=await this.json(API+'/models',{headers:{Authorization:'Bearer '+token}});
  if(!Array.isArray(data.models))fail('O catálogo de modelos da conta retornou um formato incompatível.');
  return data.models.filter(m=>m.visibility==='list'&&typeof m.slug==='string'&&typeof m.display_name==='string').slice(0,100).map(m=>({id:m.slug,name:m.display_name}));
 }
 async signout(){
  const active=this.active;this.generation++;this.active=null;this.pending=null;this.loginError='';
  if(!active)return {revoked:true};
  try{
   const metadata=await this.metadata();if(!metadata.revocation_endpoint)throw Error();
   const response=await this.fetcher(endpoint(metadata.revocation_endpoint),{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:active.refresh_token,token_type_hint:'refresh_token',client_id:active.clientId}),signal:AbortSignal.timeout(15000)});
   return {revoked:response.status===200};
  }catch{return {revoked:false};}
 }
}

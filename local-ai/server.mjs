import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {LocalError} from './openai-session.mjs';
import {analyze} from './analysis.mjs';

const extensionOrigin=value=>typeof value==='string'&&/^chrome-extension:\/\/[a-p]{32}$/.test(value);
const same=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function body(req){
 if(req.headers['content-type']!=='application/json')throw new LocalError('Use JSON no protocolo local.');
 let value='';for await(const chunk of req){value+=chunk;if(Buffer.byteLength(value)>64000)throw new LocalError('Dados acima do limite local.');}
 try{return JSON.parse(value||'{}');}catch{throw new LocalError('JSON inválido.');}
}
export function createLocalServer({session,pairCode=randomBytes(18).toString('base64url'),port=18765,analysis=analyze}){
 let pairing=null,pairFailures=0,pairBlockedUntil=0,job=null,jobController=null,closing=false;
 const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
 const server=createServer(async(req,res)=>{
  const address=server.address(),host='127.0.0.1:'+address.port;
  if(closing||req.headers.host!==host||req.url.length>10000){send(res,403,{error:'Origem local inválida.'});return;}
  const url=new URL(req.url,'http://'+host),origin=req.headers.origin;
  if(url.pathname==='/auth/callback'&&req.method==='GET'){
   let success=false;
   try{await session.callback(url.searchParams);success=true;}catch{/* Status exposes a sanitized error to the paired extension. */}
   res.writeHead(success?200:400,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff'});
   res.end('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>O Espertinho</title><h1>'+ (success?'Login recebido':'Não foi possível concluir o login')+'</h1><p>Volte ao painel da extensão para conferir a conta e a autorização do plano. Você pode fechar esta aba.</p></html>');return;
  }
  if(!extensionOrigin(origin)||(pairing&&pairing.origin!==origin)){send(res,403,{error:'Somente a extensão vinculada pode acessar o auxiliar.'});return;}
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){
   res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Espertinho-Local');res.setHeader('Access-Control-Allow-Private-Network','true');res.writeHead(204);res.end();return;
  }
  if(req.method!=='POST'){send(res,405,{error:'Método local inválido.'});return;}
  try{
   const data=await body(req);
   if(!data||typeof data!=='object'||Array.isArray(data))throw new LocalError('Corpo local inválido.');
   if(url.pathname==='/pair'){
    if(Date.now()<pairBlockedUntil)throw new LocalError('Aguarde um minuto antes de vincular novamente.');
    if(!same(data.code,pairCode)){
     if(++pairFailures>=5){pairBlockedUntil=Date.now()+60000;pairFailures=0;}
     throw new LocalError('Código local incorreto. Confira o código no terminal do auxiliar.');
    }
    pairing={origin,key:randomBytes(32).toString('base64url')};pairCode=randomBytes(18).toString('base64url');send(res,200,{key:pairing.key});return;
   }
   if(!pairing||!same(req.headers['x-espertinho-local'],pairing.key)){send(res,401,{error:'Vincule novamente o auxiliar local.'});return;}
   if(url.pathname==='/status'){send(res,200,{...session.status(),analysis:job});return;}
   if(url.pathname==='/login'){
    if(job?.status==='running')throw new LocalError('Aguarde ou cancele a análise antes de trocar de conta.');
    send(res,200,{url:session.begin('http://'+host+'/auth/callback',data.accountId||undefined)});return;
   }
   if(url.pathname==='/logout'){
    jobController?.abort();job=null;const result=await session.signout();send(res,200,result);return;
   }
   if(url.pathname==='/models'){send(res,200,{models:await session.models()});return;}
   if(url.pathname==='/analyze'){
    if(job?.status==='running')throw new LocalError('Já existe uma análise local em andamento.');
    if(session.status().loginPending)throw new LocalError('Conclua o login antes de analisar a oferta.');
    if(!session.status().account?.planEnabled)throw new LocalError('Conecte uma conta ChatGPT com autorização de uso do plano.');
    const current={id:randomBytes(12).toString('hex'),status:'running',result:null,error:''};job=current;jobController=new AbortController();
    const signal=AbortSignal.any([jobController.signal,AbortSignal.timeout(120000)]);
    void analysis(session,data,signal).then(result=>{if(job===current){current.status='completed';current.result=result;}}).catch(error=>{if(job===current){current.status='failed';current.error=error instanceof LocalError?error.message:'A análise foi interrompida ou a OpenAI está indisponível. Tente novamente.';}});
    send(res,202,{id:current.id});return;
   }
   if(url.pathname==='/cancel'){jobController?.abort();job=null;send(res,200,{cancelled:true});return;}
   send(res,404,{error:'Operação local não encontrada.'});
  }catch(error){send(res,400,{error:error instanceof LocalError?error.message:'Não foi possível concluir a operação local.'});}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 return {server,pairCode,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve(server.address());});}),close:async()=>{closing=true;jobController?.abort();session.pending=null;session.active=null;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

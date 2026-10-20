import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {OpenAISession} from './openai-session.mjs';
import {createLocalServer} from './server.mjs';

// Separate from the repository and OneDrive. This file never contains OAuth tokens.
const directory=join(process.env.LOCALAPPDATA||join(homedir(),'.local','share'),'O-Espertinho','chatgpt-local');
await mkdir(directory,{recursive:true,mode:0o700});
if(process.platform==='win32'){
 const identity=execFileSync('whoami',[],{encoding:'utf8',windowsHide:true}).trim();
 execFileSync('icacls',[directory,'/inheritance:r','/grant:r',identity+':(OI)(CI)F'],{stdio:'ignore',windowsHide:true});
}else await chmod(directory,0o700);
const file=join(directory,'registrations.json');let saved;
try{saved=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('O registro local está inválido. Confira o arquivo de registros do auxiliar.');}
saved??={hostId:'urn:uuid:'+randomUUID(),registrations:[]};
if(!/^urn:uuid:[\da-f-]{36}$/.test(saved.hostId)||!Array.isArray(saved.registrations))throw Error('Registro de host local inválido.');
async function persist(registrations){
 saved.registrations=registrations;const temporary=file+'.tmp';
 await writeFile(temporary,JSON.stringify(saved),{mode:0o600});await rename(temporary,file);
}
await persist(saved.registrations);
const session=new OpenAISession({...saved,saveRegistrations:persist}),local=createLocalServer({session});
try{await local.listen();}catch{console.error('Não foi possível iniciar o auxiliar em 127.0.0.1:18765. Confira se já está aberto.');process.exit(1);}
console.log('O Espertinho — auxiliar ChatGPT local (prova de conceito)');
console.log('Endereço: http://127.0.0.1:18765');
console.log('Código de vínculo (uso único): '+local.pairCode);
console.log('Tokens ChatGPT ficam apenas em memória. Nenhuma API do Espertinho é acessada pelo auxiliar.');
console.log('Mantenha este processo aberto. Use Desconectar ChatGPT antes de encerrá-lo.');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void local.close().finally(()=>process.exit(0));});

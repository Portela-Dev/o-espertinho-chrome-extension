import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {openWhatsAppGroup} from '../dist/whatsapp-group-navigation.js';

async function fixture(callback){
 const win=new Window({url:'https://web.whatsapp.com/'}),old={window:globalThis.window,location:globalThis.location};Object.assign(globalThis,{window:win,location:win.location});
 const a={id:{_serialized:'120363000000001@g.us',server:'g.us'},isGroup:true,name:'Mesmo nome',active:false},b={id:{_serialized:'120363000000002@g.us',server:'g.us'},isGroup:true,name:'Mesmo nome',active:true};let chats=[a,b],account='5511999999999@c.us',command=async({chat})=>{a.active=chat===a;b.active=chat===b;};const opened=[];
 win.focus=()=>{throw Error('Não pode mudar foco');};win.require=name=>name==='WAWebCollections'?{Chat:{getModelsArray:()=>chats}}:name==='WAWebUserPrefsMeUser'?{getMaybeMePnUser:()=>({_serialized:account})}:{Cmd:{openChatBottom:args=>{opened.push(args.chat.id._serialized);return command(args);}}};
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(account)),input={groupId:a.id._serialized,accountHash:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')};
 try{await callback({input,a,b,opened,setChats:value=>chats=value,setAccount:value=>account=value,setCommand:value=>command=value});}finally{win.close();Object.assign(globalThis,old);}
}

test('abre exatamente o grupo vinculado entre homônimos sem pesquisar por nome ou mudar foco',async()=>fixture(async f=>{
 assert.equal((await openWhatsAppGroup(f.input,10)).selected,true);assert.deepEqual(f.opened,[f.a.id._serialized]);assert.equal(f.a.active,true);assert.equal(f.b.active,false);
 assert.equal((await openWhatsAppGroup(f.input,10)).selected,true);assert.equal(f.opened.length,1);
}));

test('conta diferente, grupo ausente e destino individual não iniciam navegação',async()=>fixture(async f=>{
 assert.match((await openWhatsAppGroup({...f.input,accountHash:'a'.repeat(64)},10)).error,/conta/);assert.equal(f.opened.length,0);
 f.setChats([f.b]);assert.match((await openWhatsAppGroup(f.input,10)).error,/não está carregado/);assert.equal(f.opened.length,0);
 assert.match((await openWhatsAppGroup({...f.input,groupId:'5511999999999@c.us'},10)).error,/inválido/);assert.equal(f.opened.length,0);
}));

test('falha de abertura, conta alterada e grupo errado após comando impedem a prévia, sem segunda chamada',async()=>fixture(async f=>{
 f.setCommand(()=>Promise.reject(Error('Falha controlada')));assert.match((await openWhatsAppGroup(f.input,10)).error,/Falha/);assert.equal(f.opened.length,1);
 f.setCommand(async()=>{});assert.match((await openWhatsAppGroup(f.input,1)).error,/não confirmou/);assert.equal(f.opened.length,2);
 f.setCommand(async()=>{f.a.active=true;f.b.active=false;f.setAccount('5511888888888@c.us');});assert.match((await openWhatsAppGroup(f.input,10)).error,/mudou/);assert.equal(f.opened.length,3);
}));

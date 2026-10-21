export function setupWhatsAppPanel(notify:(message:string,kind?:'error'|'success')=>void,browser:typeof chrome=chrome){
 const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
 let pending:string|undefined,busy=false;
 const request=async(operation:string,payload:any={})=>{const reply=await browser.runtime.sendMessage({type:'WHATSAPP_GROUP',operation,payload});if(reply.error)throw new Error(reply.error);return reply.value;};
 const option=(label:string,value:string)=>{const node=document.createElement('option');node.textContent=label;node.value=value;return node;};
 const clear=()=>{pending=undefined;el('wa-candidate').hidden=true;el<HTMLButtonElement>('wa-confirm').disabled=true;};
 const status=(text:string)=>{el('wa-validation').textContent=text;};
 const refresh=async()=>{const list=await request('list'),select=el<HTMLSelectElement>('wa-bindings'),previous=select.value;select.replaceChildren(option('Selecione um grupo vinculado',''));for(const binding of list)select.add(option(binding.name+' · '+binding.groupId,binding.id));if(list.some((b:any)=>b.id===previous))select.value=previous;};
 const permission=()=>browser.permissions.request({origins:['https://web.whatsapp.com/*']});
 const tab=async()=>{const [active]=await browser.tabs.query({active:true,currentWindow:true});if(active?.id===undefined||!active.url||new URL(active.url).origin!=='https://web.whatsapp.com')throw new Error('Abra o grupo na aba atual do WhatsApp Web.');return active.id;};
 const action=(callback:()=>Promise<void>,needsPermission=false)=>{
  if(busy)return;busy=true;status('Verificação pendente.');
  // Request optional access directly from the click gesture.
  const granted=needsPermission?permission():Promise.resolve(true);
  void granted.then(async allowed=>{if(!allowed)throw new Error('Acesso ao WhatsApp Web não autorizado.');await callback();}).catch(error=>{clear();notify(error instanceof Error?error.message:'Não foi possível validar o grupo.');}).finally(()=>{busy=false;});
 };
 el('wa-open').addEventListener('click',()=>action(async()=>{clear();const tabs=await browser.tabs.query({url:'https://web.whatsapp.com/*',currentWindow:true});if(tabs[0]?.id!==undefined)await browser.tabs.update(tabs[0].id,{active:true});else await browser.tabs.create({url:'https://web.whatsapp.com/',active:true});},true));
 el('wa-identify').addEventListener('click',()=>action(async()=>{clear();const result=await request('inspect',{tabId:await tab()});pending=result.ticket;el('wa-candidate-name').textContent=result.name;el('wa-candidate-id').textContent=result.groupId;el('wa-candidate-account').textContent='Conta: '+result.accountFingerprint;el('wa-candidate').hidden=false;el<HTMLButtonElement>('wa-confirm').disabled=false;},true));
 el('wa-confirm').addEventListener('click',()=>action(async()=>{if(!pending)throw new Error('Identifique o grupo primeiro.');const result=await request('confirm',{ticket:pending});clear();await refresh();el<HTMLSelectElement>('wa-bindings').value=result.id;notify('Grupo vinculado neste Chrome. Nenhuma mensagem foi enviada.','success');}));
 el('wa-load').addEventListener('click',()=>action(refresh));
 el('wa-validate').addEventListener('click',()=>action(async()=>{const id=el<HTMLSelectElement>('wa-bindings').value;if(!id)throw new Error('Selecione um grupo vinculado.');const result=await request('validate',{id,tabId:await tab()});status('Identidade conferida às '+new Date(result.checkedAt).toLocaleTimeString('pt-BR')+': '+result.name+(result.renamed?' (nome alterado)':'')+'. Esta conferência não autoriza envios futuros.');notify('A conta e o identificador do grupo correspondem ao vínculo.','success');},true));
 el('wa-remove').addEventListener('click',()=>action(async()=>{const id=el<HTMLSelectElement>('wa-bindings').value;if(!id)throw new Error('Selecione um grupo vinculado.');await request('remove',{id});await refresh();clear();notify('Vínculo removido.','success');}));
 el('wa-bindings').addEventListener('change',()=>status('Verificação pendente.'));
 document.addEventListener('visibilitychange',()=>{clear();status('Verificação pendente.');});
}

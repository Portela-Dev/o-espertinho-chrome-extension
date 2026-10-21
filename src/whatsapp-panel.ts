export function setupWhatsAppPanel(notify:(message:string,kind?:'error'|'success')=>void,browser:typeof chrome=chrome){
 const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
 let pending:string|undefined,textTicket:string|undefined,busy=false;
 const clearText=()=>{textTicket=undefined;el('wa-text-preview').hidden=true;el<HTMLButtonElement>('wa-send-confirm').disabled=true;};
 const invalidateText=()=>{const ticket=textTicket;clearText();if(ticket)void request('cancel_text',{ticket}).catch(()=>{});};
 const renderAttempt=(attempt:any)=>{el('wa-send-status').textContent=attempt?.status==='observed'?'Mensagem registrada na conversa do grupo. Entrega aos participantes não confirmada.':attempt?.status==='not_sent'?'Envio recusado antes do disparo. Nenhuma mensagem foi enviada.':attempt?'Resultado desconhecido. Confira a conversa no WhatsApp antes de preparar outro envio. Não houve repetição automática.':'Nenhuma tentativa de envio.';};
 const request=async(operation:string,payload:any={})=>{const reply=await browser.runtime.sendMessage({type:'WHATSAPP_GROUP',operation,payload});if(reply.error)throw new Error(reply.error);return reply.value;};
 const option=(label:string,value:string)=>{const node=document.createElement('option');node.textContent=label;node.value=value;return node;};
 const clear=()=>{pending=undefined;el('wa-candidate').hidden=true;el<HTMLButtonElement>('wa-confirm').disabled=true;};
 const status=(text:string)=>{el('wa-validation').textContent=text;};
 const refresh=async()=>{const attempt=await request('text_status');renderAttempt(attempt);const list=await request('list'),select=el<HTMLSelectElement>('wa-bindings'),previous=select.value;select.replaceChildren(option('Selecione um grupo vinculado',''));for(const binding of list)select.add(option(binding.name+' · '+binding.groupId,binding.id));if(list.some((b:any)=>b.id===previous))select.value=previous;};
 const permission=()=>browser.permissions.request({origins:['https://web.whatsapp.com/*']});
 const tab=async()=>{const [active]=await browser.tabs.query({active:true,currentWindow:true});if(active?.id===undefined||!active.url||new URL(active.url).origin!=='https://web.whatsapp.com')throw new Error('Abra o grupo na aba atual do WhatsApp Web.');return active.id;};
 const groupTab=async()=>{
  const tabs=(await browser.tabs.query({url:'https://web.whatsapp.com/*',currentWindow:true})).filter(t=>t.id!==undefined&&t.url&&new URL(t.url).origin==='https://web.whatsapp.com');
  if(!tabs.length)throw Error('Mantenha uma aba do WhatsApp Web aberta nesta janela, com o grupo vinculado selecionado.');
  if(tabs.length!==1)throw Error('Há mais de uma aba do WhatsApp Web nesta janela. Mantenha somente uma para evitar ambiguidade.');
  return tabs[0].id!;
 };
 const action=(callback:()=>Promise<void>,needsPermission=false)=>{
  if(busy)return;busy=true;status('Verificação pendente.');
  // Request optional access directly from the click gesture.
  const granted=needsPermission?permission():Promise.resolve(true);
  void granted.then(async allowed=>{if(!allowed)throw new Error('Acesso ao WhatsApp Web não autorizado.');await callback();}).catch(error=>{clear();invalidateText();notify(error instanceof Error?error.message:'Não foi possível validar o grupo.');}).finally(()=>{busy=false;});
 };
 el('wa-open').addEventListener('click',()=>action(async()=>{clear();const tabs=await browser.tabs.query({url:'https://web.whatsapp.com/*',currentWindow:true});if(tabs[0]?.id!==undefined)await browser.tabs.update(tabs[0].id,{active:true});else await browser.tabs.create({url:'https://web.whatsapp.com/',active:true});},true));
 el('wa-identify').addEventListener('click',()=>action(async()=>{clear();const result=await request('inspect',{tabId:await tab()});pending=result.ticket;el('wa-candidate-name').textContent=result.name;el('wa-candidate-id').textContent=result.groupId;el('wa-candidate-account').textContent='Conta: '+result.accountFingerprint;el('wa-candidate').hidden=false;el<HTMLButtonElement>('wa-confirm').disabled=false;},true));
 el('wa-confirm').addEventListener('click',()=>action(async()=>{if(!pending)throw new Error('Identifique o grupo primeiro.');const result=await request('confirm',{ticket:pending});clear();await refresh();el<HTMLSelectElement>('wa-bindings').value=result.id;notify('Grupo vinculado neste Chrome. Nenhuma mensagem foi enviada.','success');}));
 el('wa-load').addEventListener('click',()=>action(refresh));
 el('wa-validate').addEventListener('click',()=>action(async()=>{const id=el<HTMLSelectElement>('wa-bindings').value;if(!id)throw new Error('Selecione um grupo vinculado.');const result=await request('validate',{id,tabId:await groupTab()});status('Identidade conferida às '+new Date(result.checkedAt).toLocaleTimeString('pt-BR')+': '+result.name+(result.renamed?' (nome alterado)':'')+'. Esta conferência não autoriza envios futuros.');notify('A conta e o identificador do grupo correspondem ao vínculo.','success');},true));
 el('wa-remove').addEventListener('click',()=>action(async()=>{const id=el<HTMLSelectElement>('wa-bindings').value;if(!id)throw new Error('Selecione um grupo vinculado.');await request('remove',{id});await refresh();clear();notify('Vínculo removido.','success');}));
 el('wa-text-preview-button').addEventListener('click',()=>action(async()=>{
  invalidateText();const id=el<HTMLSelectElement>('wa-bindings').value;if(!id)throw Error('Selecione um grupo vinculado.');
  const preview=await request('preview_text',{id,tabId:await groupTab(),text:el<HTMLTextAreaElement>('wa-text').value});
  textTicket=preview.ticket;el('wa-text-name').textContent=preview.name;el('wa-text-group').textContent=preview.groupId;el('wa-text-account').textContent='Conta: '+preview.accountFingerprint;el('wa-preview-text').textContent=preview.text;el('wa-text-preview').hidden=false;el<HTMLButtonElement>('wa-send-confirm').disabled=false;
 },true));
 el('wa-send-cancel').addEventListener('click',invalidateText);
 el('wa-send-confirm').addEventListener('click',()=>action(async()=>{
  const ticket=textTicket;if(!ticket)throw Error('Gere e confira uma nova prévia.');clearText();
  const field=el<HTMLTextAreaElement>('wa-text'),select=el<HTMLSelectElement>('wa-bindings');field.readOnly=true;select.disabled=true;el('wa-send-status').textContent='Envio único em andamento…';
  try{renderAttempt(await request('send_text',{ticket}));}
  catch(error){renderAttempt({status:'unknown'});throw error;}
  finally{field.readOnly=false;select.disabled=false;}
 }));
 el('wa-text').addEventListener('input',invalidateText);
 el('wa-bindings').addEventListener('change',()=>{invalidateText();status('Verificação pendente.');});
 document.addEventListener('visibilitychange',()=>{clear();invalidateText();status('Verificação pendente.');});
}

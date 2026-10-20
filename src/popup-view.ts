import type { Configuration, Progress, Account,State } from "./contracts.js";
export interface View {
  affiliateConfig?:Configuration;
  affiliateProof?:State['affiliateProof'];
  affiliateHeaderReady?:boolean;
  proofMarkets?:import('./session-proof.js').ProofMarket[];
  proofTest?:import('./session-proof.js').ProofTest;
  backendUrl: string;
  user?: Account;
  pairing: boolean;
  config?: Configuration;
  marketplaceId?: string;
  progress: Progress;
  queue?: {
    items: {
      id: string;
      title: string;
      state: string;
      affiliateUrl?: string;
      error?: string;
    }[];
  };
  version: string;
}
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
function renderAccount(view: View) {
  const connected = !!view.user;
  element("version").textContent = view.version;
  element("account").textContent = view.user?.email ?? "Conta desconectada";
  element("status").textContent = view.progress.message;
  element("mode").textContent = view.config?.mock
    ? "Ambiente demonstrativo"
    : "Conexão administrativa";
  element("login").hidden = connected;
  element<HTMLButtonElement>("login").disabled = view.pairing;
  element("logout").hidden = !connected && !view.pairing;
  element("logout").textContent = view.pairing ? "Cancelar conexão" : "Sair";
  element("workspace").hidden = !connected;
  const backend = element<HTMLInputElement>("backend");
  if (document.activeElement !== backend) {
    backend.value = view.backendUrl;
  }
  backend.disabled = connected;
  element<HTMLButtonElement>("save-backend").disabled = connected;
}
function renderMarketplaces(view: View, running: boolean) {
  const select = element<HTMLSelectElement>("marketplace");
  const selected = select.value || view.marketplaceId;
  const marketplaces = view.config?.marketplaces ?? [];
  if (
    JSON.stringify(Array.from(select.options, (option) => option.value)) !==
    JSON.stringify(marketplaces.map((m) => m.id))
  ) {
    select.replaceChildren(
      ...marketplaces.map((m) => {
        const option = document.createElement("option");
        option.value = m.id;
        option.textContent = m.name;
        return option;
      }),
    );
  }
  if (
    selected &&
    Array.from(select.options).some((option) => option.value === selected)
  ) {
    select.value = selected;
  }
  select.disabled = running;
  return select.value;
}
function renderProgress(view: View) {
  const processed = view.progress.success + view.progress.failed;
  const progress = element<HTMLProgressElement>("progress");
  progress.max = Math.max(1, view.progress.total);
  progress.value = processed;
  element("counts").textContent =
    `${processed} de ${view.progress.total} processados · ${view.progress.success} concluídos · ${view.progress.failed} falhas`;
  element("current").textContent = view.progress.currentTitle ?? "";
}
function resultLink(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      return;
    }
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Ver link";
    return link;
  } catch {
    return undefined;
  }
}
function resultRow(item: NonNullable<View["queue"]>["items"][number]) {
  const row = document.createElement("li"),
    name = document.createElement("strong");
  name.textContent = item.title;
  row.append(name, document.createElement("br"));
  const detail = document.createElement("span");
  const labels: Record<string, string> = {
    pending: "Pendente",
    leased: "Em processamento",
    done: "Link gerado",
    failed: "Falhou",
  };
  detail.textContent = item.error ?? labels[item.state] ?? item.state;
  row.append(detail);
  if (item.affiliateUrl) {
    const link = resultLink(item.affiliateUrl);
    if (link) {
      row.append(" · ", link);
    }
  }
  return row;
}
export function renderView(view: View, busy: boolean) {
  renderAffiliate(view,busy);
  renderProof(view,busy);
  const running = view.progress.status === "running";
  renderAccount(view);
  const marketplace = renderMarketplaces(view, running);
  element<HTMLButtonElement>("start").disabled =
    running || busy || !marketplace;
  element("start").textContent =
    view.progress.status === "paused"
      ? "Continuar geração"
      : "Gerar links pendentes";
  element<HTMLButtonElement>("pause").disabled = !running;
  element<HTMLButtonElement>("refresh").disabled = running;
  element<HTMLButtonElement>("reset").disabled = running;
  element("reset").hidden = !view.config?.mock;
  renderProgress(view);
  element("results").replaceChildren(
    ...(view.queue?.items ?? []).map(resultRow),
  );
}
function renderAffiliate(view:View,busy:boolean){
 element('affiliate-proof').hidden=!view.user;
 const select=element<HTMLSelectElement>('affiliate-marketplace'),markets=view.affiliateConfig?.marketplaces??[],selected=select.value;
 if(JSON.stringify([...select.options].map(o=>o.value))!==JSON.stringify(markets.map(m=>m.id))){select.replaceChildren(...markets.map(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=m.name;return o;}));if(markets.some(m=>m.id===selected))select.value=selected;}
 const proof=view.affiliateProof,running=proof?.status==='running'||proof?.status==='enriching';select.disabled=busy||running;
 element<HTMLButtonElement>('affiliate-load').disabled=busy||running;
 element<HTMLButtonElement>('affiliate-arm').disabled=busy||running||!markets.length;
 element<HTMLButtonElement>('affiliate-start').disabled=busy||running||!markets.length;
 element('affiliate-start').textContent=proof?.status==='paused'?'Continuar conversão':'Converter até 3 links';
 element<HTMLButtonElement>('affiliate-enrich').disabled=busy||proof?.status!=='converted'||!proof.results.some(r=>r.affiliateUrl);
 element<HTMLButtonElement>('affiliate-refresh').disabled=busy||!proof;
 element<HTMLButtonElement>('affiliate-reset').disabled=busy||running||!proof;
 element('affiliate-header').textContent=view.affiliateHeaderReady?'Header de sessão pronto na memória local.':'Prepare a aba e gere um link manualmente pelo marketplace.';
 element('affiliate-result').textContent=proof?proof.message+'\n'+proof.results.length+'/'+proof.items.length+' conversões\n'+proof.results.map(r=>(r.affiliateUrl||r.error||'Pendente')).join('\n')+'\n'+(proof.run?'Job: '+proof.run.status+'\n':'')+(proof.runItems??[]).map(i=>i.status+(i.error?' ('+i.error+')':'')).join('\n'):'Nenhum teste iniciado.';
}
function renderProof(view:View,busy:boolean){
 element('session-proof').hidden=!view.user;
 const select=element<HTMLSelectElement>('proof-marketplace'),markets=view.proofMarkets??[],selected=select.value;
 if(JSON.stringify([...select.options].map(o=>o.value))!==JSON.stringify(markets.map(m=>m.id))){select.replaceChildren(...markets.map(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=m.name;return o;}));if(markets.some(m=>m.id===selected))select.value=selected;}
 const market=markets.find(m=>m.id===select.value),running=view.proofTest?.status==='running';
 select.disabled=busy||running;
 for(const id of ['proof-load','proof-open','proof-capture'])element<HTMLButtonElement>(id).disabled=busy||running||id!=='proof-load'&&!market;
 element<HTMLInputElement>('proof-batch').disabled=busy||running;
 element('proof-capture').textContent=element<HTMLInputElement>('proof-batch').checked?'Capturar sessão e testar lote':'Capturar sessão e testar';
 element<HTMLInputElement>('proof-url').disabled=busy||running||element<HTMLInputElement>('proof-batch').checked;
 if(market&&!element<HTMLInputElement>('proof-url').value)element<HTMLInputElement>('proof-url').value=market.testUrl;
 element('proof-domains').textContent=market?'Domínios autorizados: '+market.cookieDomains.join(', '):'Carregue os marketplaces para começar.';
 const test=view.proofTest;
 if(test?.batch){
  const batch=test.batch;
  element('proof-result').textContent=(test.error||'Lote '+(test.status==='running'?'em andamento':'finalizado'))+': '+batch.completed+'/'+batch.total+' · intervalo '+batch.intervalMs/1000+' s\n'+batch.items.map((item,index)=>{
   const r=item.result,price=r?.priceCents==null?'':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(r.priceCents/100);
   return (index+1)+'. '+(item.error||r?.status||'sem resultado')+(r?.reason?' ('+r.reason+')':'')+' '+price+'\n'+(r?.title||'')+'\n'+item.url+'\nURL final: '+(r?.finalUrl||'sem resposta')+'\nCampos ausentes: '+(r?.missing.join(', ')||'nenhum')+'\nHTTP: '+(r?.navigationStatuses.join(' → ')||'sem resposta')+' · Cookies: '+(r?.cookiesImported??0);
  }).join('\n\n');return;
 }
 element('proof-result').textContent=!test?'Faça login na aba do marketplace antes de capturar.':test.status==='running'?'Teste em andamento no container…':test.error||('Último teste: '+(test.result?.status??test.status)+(test.result?.reason?' ('+test.result.reason+')':'')+'\n'+(test.result?.title||'')+'\nURL final: '+(test.result?.finalUrl||'')+'\nCookies importados: '+(test.result?.cookiesImported??0)+' · HTTP: '+(test.result?.navigationStatuses.join(' → ')||'sem resposta'));
}

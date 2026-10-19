// Serialized by chrome.scripting; keep all DOM logic inside this function.
export function startSelectorPicker() {
  const key = '__oespertinhoSelectorPicker';
  const state = window as unknown as Record<string, {dispose:()=>void}|undefined>;
  state[key]?.dispose();
  const host = document.createElement('o-espertinho-selector-tool');
  const shadow = host.attachShadow({mode:'closed'});
  const controller = new AbortController();
  const selected = new Set<Element>();
  let scope: Document|Element = document, current: Element|null = null, locked = false;
  let preview: Element[] = [], selectedSelector = '', disposed = false, timer = 0;
  const children = new WeakMap<Element, Element>();
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
:host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;color-scheme:light;font:13px/1.45 system-ui,sans-serif;color:#173a2b}
*{box-sizing:border-box}.panel{font:13px/1.45 system-ui,sans-serif;color:#173a2b;z-index:2;position:absolute;top:12px;right:12px;width:370px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;background:#fff;border:1px solid #9dad9b;border-radius:14px;box-shadow:0 8px 36px #0004;padding:16px;pointer-events:auto}.panel.left{left:12px;right:auto}h2{font-size:17px;margin:0 0 8px}p{margin:8px 0}button,select,textarea{font:inherit}button{cursor:pointer;border:1px solid #aab9a8;background:#f4f7f0;color:#173a2b;border-radius:6px;padding:6px 9px}button:disabled{opacity:.5;cursor:default}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #eb8b20;outline-offset:2px}.row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.trail{display:flex;gap:4px;flex-wrap:wrap}.trail button{max-width:100%;overflow-wrap:anywhere;font-size:11px}label{display:block;margin:10px 0 5px}select,textarea{width:100%;padding:7px;border:1px solid #aab9a8;border-radius:6px;background:#fff;color:#173a2b}textarea{min-height:65px;resize:vertical;font:12px/1.5 monospace}.hint{font-size:11px;color:#526852}.status{display:block;white-space:pre-line}.outline{z-index:1;position:fixed;pointer-events:none;border:2px solid #eb8b20;background:#eb8b2015}.outline.selected{border-color:#167746;background:#16774618}.outline.match{border:2px dashed #226ac3;background:#226ac310}.outline.current{border:3px solid #eb8b20;background:#eb8b2022}ol{max-height:110px;overflow:auto;padding-left:22px;margin:6px 0}.remove{font-size:11px;margin-left:5px}output{overflow-wrap:anywhere}
`);
  shadow.adoptedStyleSheets = [sheet];
  function node<K extends keyof HTMLElementTagNameMap>(tag:K, text='', parent:Node=shadow) {
    const element=document.createElement(tag);element.textContent=text;parent.appendChild(element);return element;
  }
  const panel=node('section');panel.className='panel';panel.setAttribute('aria-label','Seletor visual do O Espertinho');
  node('h2','Selecionar elementos',panel);
  node('p','Clique para inspecionar; ↑ pai, ↓ filho, Enter seleciona. Esc encerra.',panel).className='hint';
  const controls=node('div','',panel);controls.className='row';
  function button(label:string,parent:Node,click:()=>void){const b=node('button',label,parent);b.type='button';b.addEventListener('click',click);return b;}
  button('Mover painel',controls,()=>panel.classList.toggle('left'));
  button('Fechar',controls,dispose);
  const context=node('p','',panel);context.className='hint';
  const trail=node('nav','',panel);trail.className='trail';trail.setAttribute('aria-label','Hierarquia do elemento');
  const navigation=node('div','',panel);navigation.className='row';
  const parentButton=button('↑ Pai',navigation,up);
  const childButton=button('↓ Filho',navigation,down);
  const toggleButton=button('Adicionar à seleção',navigation,toggle);
  button('Voltar a apontar',panel,()=>{locked=false;message.textContent='Passe o mouse e clique no próximo elemento.';});
  const scopeRow=node('div','',panel);scopeRow.className='row';
  const scopeButton=button('Usar como escopo',scopeRow,()=>{if(current){scope=current;selected.clear();current=null;locked=false;refresh();}});
  button('Escopo: documento',scopeRow,()=>{scope=document;selected.clear();current=null;locked=false;refresh();});
  node('label','Tipo de seletor',panel).htmlFor='selector-mode';
  const mode=node('select','',panel);mode.id='selector-mode';
  for(const [value,label] of [['pattern','Padrão: incluir elementos semelhantes'],['exact','Exato: somente os selecionados']]){const option=node('option',label,mode);option.value=value;}
  const list=node('ol','',panel);list.setAttribute('aria-label','Elementos selecionados');
  const row=node('div','',panel);row.className='row';
  button('Limpar seleção',row,()=>{selected.clear();refresh();});
  node('label','Seletores encontrados',panel).htmlFor='selector-candidates';
  const candidates=node('select','',panel);candidates.id='selector-candidates';
  const result=node('output','',panel);result.className='status';result.setAttribute('aria-live','polite');
  node('label','Seletor CSS',panel).htmlFor='selector-result';
  const text=node('textarea','',panel);text.id='selector-result';text.readOnly=true;
  const copy=button('Copiar seletor',panel,()=>{void copySelector();});
  node('p','Verde: seleção · azul: resultados · laranja: alvo atual. Iframes e árvores shadow precisam de contexto próprio; não são atravessados por este seletor.',panel).className='hint';
  const message=node('output','',panel);message.className='status';message.setAttribute('aria-live','polite');
  const outlines=node('div');outlines.setAttribute('aria-hidden','true');
  (document.body??document.documentElement).appendChild(host);
  function describe(element:Element){return element.localName+(element.id?'#'+element.id.slice(0,60):'')+Array.from(element.classList).slice(0,2).map(c=>'.'+c.slice(0,40)).join('');}
  function contains(element:Element){return element.isConnected&&element.getRootNode()===document&&(scope===document||scope.contains(element));}
  function query(selector:string):Element[]{
    try{if(selector===':scope'&&scope instanceof Element){return [scope];}return Array.from(scope.querySelectorAll(selector)).filter(e=>e!==host&&!host.contains(e));}catch{return [];}
  }
  const stable=(value:string)=>value.length>0&&value.length<=70&&!/(?:[a-f0-9]{12}|\d{6}|^(?:css-|jsx-|ng-|sc-)|^(?:active|selected|hover|focus|loading|disabled|expanded)$)/i.test(value);
  function atoms(element:Element){
    const tag=CSS.escape(element.localName),values:string[]=[];
    if(element.id&&stable(element.id))values.push('#'+CSS.escape(element.id));
    for(const attribute of ['data-testid','data-test','data-qa','data-cy','itemprop','name','role','aria-label']){
      const value=element.getAttribute(attribute);if(value&&value.length<=120)values.push(`${tag}[${attribute}="${CSS.escape(value)}"]`);
    }
    const classes=Array.from(element.classList).filter(stable).slice(0,5);
    for(const name of classes){values.push('.'+CSS.escape(name));values.push(tag+'.'+CSS.escape(name));}
    if(classes.length>1)values.push(tag+classes.slice(0,3).map(c=>'.'+CSS.escape(c)).join(''));
    values.push(tag);return values;
  }
  function exactPath(element:Element){
    if(element===scope){return ':scope';}
    const parts:string[]=[];let cursor:Element|null=element;
    while(cursor&&cursor!==scope){
      const unique=atoms(cursor).find(a=>{const found=query(a);return found.length===1&&found[0]===cursor;});
      if(unique){parts.unshift(unique);return parts.join(' > ');}
      const parent:Element|null=cursor.parentElement;
      const siblings=parent?Array.from(parent.children).filter(e=>e.localName===cursor!.localName):[cursor];
      const tag=CSS.escape(cursor.localName);
      parts.unshift(tag+(siblings.length>1?`:nth-of-type(${siblings.indexOf(cursor)+1})`:''));
      const selector=parts.join(' > '),found=query(selector);
      if(found.length===1&&found[0]===element)return selector;
      cursor=parent;
    }
    return parts.join(' > ');
  }
  function suggestions(){
    const elements=Array.from(selected);if(!elements.length){return [];}
    const selectors=new Set<string>();
    if(elements.length===1&&elements[0]===scope)selectors.add(':scope');
    const common=atoms(elements[0]).filter(a=>elements.every(e=>e.matches(a)));
    for(const base of common){selectors.add(base);let ancestor=elements[0].parentElement,depth=0;
      while(ancestor&&ancestor!==scope&&depth++<4){
        if(elements.every(e=>ancestor!.contains(e)))for(const a of atoms(ancestor).slice(0,5))selectors.add(a+' '+base);
        ancestor=ancestor.parentElement;
      }
    }
    if(mode.value==='exact'||!selectors.size){const paths=elements.map(exactPath);selectors.add(paths.join(', '));}
    return Array.from(selectors).map(selector=>({selector,matches:query(selector)})).filter(c=>elements.every(e=>c.matches.includes(e))&&(mode.value!=='exact'||c.matches.length===elements.length)).sort((a,b)=>{
      const brittle=(s:string)=>s.includes(':nth-of-type')?1000:0;
      const broad=(s:string)=>/[.#\[]/.test(s)?0:100;
      return brittle(a.selector)-brittle(b.selector)||broad(a.selector)-broad(b.selector)||a.matches.length-b.matches.length||a.selector.length-b.selector.length;
    }).slice(0,12);
  }
  function draw(){
    outlines.replaceChildren();
    const show=(element:Element,className:string)=>{if(!contains(element)){return;}const rect=element.getBoundingClientRect();if(rect.width<=0||rect.height<=0){return;}const box=node('div','',outlines);box.className='outline '+className;Object.assign(box.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});};
    for(const element of preview.slice(0,60))show(element,'match');
    for(const element of selected)show(element,'selected');
    if(current)show(current,'current');
  }
  function showCurrent(){
    trail.replaceChildren();
    const chain:Element[]=[];let element=current;
    while(element&&chain.length<8){chain.unshift(element);if(element===scope)break;element=element.parentElement;}
    for(const ancestor of chain)button(describe(ancestor),trail,()=>{current=ancestor;locked=true;showCurrent();draw();});
    parentButton.disabled=!current?.parentElement||current===scope;
    childButton.disabled=!current?.firstElementChild;
    toggleButton.disabled=!current;
    toggleButton.textContent=current&&selected.has(current)?'Remover da seleção':'Adicionar à seleção';
    scopeButton.disabled=!current;
    draw();
  }
  function showCandidate(){
    selectedSelector=candidates.value;preview=query(selectedSelector);text.value=selectedSelector;copy.disabled=!selectedSelector;
    const extras=preview.length-selected.size;
    result.textContent=selectedSelector?`${preview.length} encontrados; ${selected.size} selecionados${extras>0?`; ${extras} adicionais`:''}.`:'Selecione elementos para gerar um seletor.';
    if(selectedSelector.includes(':nth-of-type'))result.textContent+=' Caminho estrutural: pode mudar se a ordem da página mudar.';
    if(selectedSelector.length>600)result.textContent+=' O seletor ultrapassa os 600 caracteres aceitos pelos cadastros; prefira um escopo menor.';
    if(preview.length>60)result.textContent+=' Destaque limitado aos primeiros 60 resultados.';
    draw();
  }
  function refresh(){
    for(const element of selected)if(!contains(element))selected.delete(element);
    if(current&&!contains(current))current=null;
    context.textContent='Escopo: '+(scope===document?'documento':describe(scope as Element));
    list.replaceChildren();
    for(const element of selected){const item=node('li',describe(element),list);button('Remover',item,()=>{selected.delete(element);refresh();}).className='remove';}
    const previous=candidates.value;candidates.replaceChildren();
    for(const candidate of suggestions()){const option=node('option',`${candidate.matches.length} resultados — ${candidate.selector}`,candidates);option.value=candidate.selector;}
    if(Array.from(candidates.options).some(o=>o.value===previous))candidates.value=previous;
    showCandidate();showCurrent();
  }
  function up(){if(current?.parentElement&&current!==scope){children.set(current.parentElement,current);current=current.parentElement;locked=true;showCurrent();}}
  function down(){if(current){const child=children.get(current)??current.firstElementChild;if(child){current=child;locked=true;showCurrent();}}}
  function toggle(){
    if(!current){return;}
    if(selected.has(current))selected.delete(current);
    else if(selected.size<20)selected.add(current);
    else{message.textContent='Selecione até 20 exemplos por vez.';return;}
    locked=true;message.textContent='Seleção atualizada. Use “Voltar a apontar” para inspecionar outro alvo.';refresh();
  }
  function inside(event:Event){return event.composedPath().includes(host);}
  function target(event:Event){const element=event.composedPath().find(n=>n instanceof Element);if(!(element instanceof Element)){return null;}if(element.getRootNode()!==document){message.textContent='Este elemento está em uma árvore shadow. Selecione um elemento do documento principal.';return null;}return contains(element)?element:null;}
  function block(event:Event){event.preventDefault();event.stopImmediatePropagation();}
  function onClick(event:Event){if(inside(event)){return;}block(event);const element=target(event);if(element){current=element;locked=true;showCurrent();}}
  function onKey(event:KeyboardEvent){
    if(event.key==='Escape'){block(event);dispose();return;}
    if(inside(event))return;
    if(event.key==='ArrowUp'){block(event);up();}
    if(event.key==='ArrowDown'){block(event);down();}
    if(event.key==='Enter'){block(event);toggle();}
  }
  async function copySelector(){
    if(!selectedSelector){return;}
    try{await navigator.clipboard.writeText(selectedSelector);message.textContent='Seletor copiado.';}
    catch{text.focus();text.select();message.textContent='Cópia automática indisponível. Use Ctrl+C no campo selecionado.';}
  }
  function dispose(){
    if(disposed){return;}disposed=true;controller.abort();observer.disconnect();clearTimeout(timer);host.remove();delete state[key];
  }
  const observer=new MutationObserver(()=>{if(!host.isConnected){dispose();return;}clearTimeout(timer);timer=window.setTimeout(()=>{if(scope instanceof Element&&!scope.isConnected){scope=document;selected.clear();current=null;message.textContent='O escopo foi removido da página. Selecione novamente.';}refresh();},150);});
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true});
  const options={capture:true,signal:controller.signal};
  window.addEventListener('pointerover',event=>{if(!inside(event)&&!locked){const element=target(event);if(element){current=element;showCurrent();}}},options);
  window.addEventListener('click',onClick,options);
  window.addEventListener('auxclick',onClick,options);
  window.addEventListener('pointerdown',event=>{if(!inside(event))block(event);},options);
  window.addEventListener('keydown',onKey,options);
  window.addEventListener('scroll',draw,options);
  window.addEventListener('resize',draw,{signal:controller.signal});
  mode.addEventListener('change',refresh);candidates.addEventListener('change',showCandidate);
  state[key]={dispose};refresh();
  return {started:true};
}

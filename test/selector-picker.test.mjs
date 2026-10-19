import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {startSelectorPicker} from '../dist/selector-picker.js';
import {launchSelectorPicker} from '../dist/picker-launcher.js';
let active;
afterEach(async()=>{if(active){active.window.dispatchEvent(new active.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await active.window.happyDOM.close();active=undefined;}});
function fixture(){
 const window=new Window({url:'https://shop.example.com/list'});let shadow,copied='',denyCopy=false;
 const original=window.Element.prototype.attachShadow;
 window.Element.prototype.attachShadow=function(options){const root=original.call(this,options);if(this.localName==='o-espertinho-selector-tool')shadow=root;return root;};
 window.Element.prototype.getBoundingClientRect=()=>({left:10,top:10,width:100,height:40,right:110,bottom:50,x:10,y:10,toJSON(){return {};}});
 Object.defineProperty(window.navigator,'clipboard',{value:{writeText:async value=>{if(denyCopy)throw new Error('Denied');copied=value;}},configurable:true});
 for(const key of ['window','document','Element','CSS','CSSStyleSheet','MutationObserver','AbortController'])globalThis[key]=key==='window'?window:window[key];
 Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});
 window.document.body.innerHTML='<main><div class="grid">'+Array.from({length:4},(_,i)=>`<article class="product-card" data-i="${i}"><a class="product-link" href="/product/${i}"><h2 class="title"><span class="label">Product ${i}</span></h2></a></article>`).join('')+'</div><aside><article class="product-card">Other area</article></aside><div id="sku:x" class="css-random123456">Escaped id</div><iframe></iframe></main>';
 const result=startSelectorPicker();assert.equal(result.started,true);
 const button=text=>{const found=Array.from(shadow.querySelectorAll('button')).find(b=>b.textContent===text);assert.ok(found,'Missing button '+text);return found;};
 const click=element=>{const event=new window.MouseEvent('click',{bubbles:true,composed:true,cancelable:true});element.dispatchEvent(event);return event;};
 const add=element=>{click(element);button('Adicionar à seleção').click();};
 const mode=value=>{shadow.getElementById('selector-mode').value=value;shadow.getElementById('selector-mode').dispatchEvent(new window.Event('change'));};
 const key=value=>window.dispatchEvent(new window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
 active={window};return {window,document:window.document,get shadow(){return shadow;},button,click,add,mode,key,get copied(){return copied;},set denyCopy(v){denyCopy=v;},get selector(){return shadow.getElementById('selector-result').value;},get matches(){const selector=shadow.getElementById('selector-result').value;return Array.from(window.document.querySelectorAll(selector));}};
}

test('multiple examples infer a shared selector, count extra matches and support exact structural unions',()=>{
 const f=fixture(),cards=Array.from(f.document.querySelectorAll('.grid .product-card'));f.add(cards[0]);f.add(cards[1]);assert.equal(f.matches.length,4);assert.ok(f.matches.includes(cards[0]));assert.match(f.shadow.querySelector('output.status').textContent,/4 encontrados; 2 selecionados; 2 adicionais/);assert.equal(f.shadow.querySelectorAll('.outline.selected').length,2);assert.equal(f.shadow.querySelectorAll('.outline.match').length,4);
 f.mode('exact');assert.equal(f.matches.length,2);assert.deepEqual(f.matches,[cards[0],cards[1]]);assert.match(f.selector,/, /);assert.match(f.shadow.querySelector('output.status').textContent,/Caminho estrutural/);
 f.click(cards[0]);f.button('Remover da seleção').click();assert.equal(f.shadow.querySelectorAll('ol li').length,1);f.shadow.querySelector('ol .remove').click();assert.equal(f.shadow.getElementById('selector-result').value,'');assert.equal(f.button('Copiar seletor').disabled,true);
});

test('nested targets can be frozen, navigate parents/remembered children, use breadcrumbs and relative scope',()=>{
 const f=fixture(),label=f.document.querySelector('.label'),card=f.document.querySelector('.product-card');
 label.dispatchEvent(new f.window.Event('pointerover',{bubbles:true,composed:true}));f.key('ArrowUp');f.key('ArrowUp');f.key('ArrowDown');f.key('ArrowDown');f.key('Enter');assert.equal(f.shadow.querySelector('ol li').textContent.includes('span.label'),true);
 f.button('Limpar seleção').click();f.click(label);f.button('↑ Pai').click();f.button('↑ Pai').click();f.button('↑ Pai').click();f.button('Usar como escopo').click();f.add(label);assert.equal(card.querySelectorAll(f.selector).length,1);assert.ok(!f.selector.includes('.product-card'));
 f.button('Escopo: documento').click();f.click(label);const crumbs=Array.from(f.shadow.querySelectorAll('nav button'));crumbs.find(b=>b.textContent==='article.product-card').click();f.button('Adicionar à seleção').click();assert.equal(f.matches.length,4);
 const event=f.click(card.querySelector('a'));assert.equal(event.defaultPrevented,true);f.button('Voltar a apontar').click();card.dispatchEvent(new f.window.Event('pointerover',{bubbles:true,composed:true}));assert.equal(f.shadow.querySelectorAll('.outline.current').length,1);
 f.button('Mover painel').click();assert.ok(f.shadow.querySelector('.panel').classList.contains('left'));f.button('↓ Filho').click();
});

test('copy works locally with a manual fallback and stable identifiers are escaped',async()=>{
 const f=fixture();f.add(f.document.getElementById('sku:x'));assert.deepEqual(f.matches,[f.document.getElementById('sku:x')]);assert.ok(!f.selector.includes('css-random'));f.button('Copiar seletor').click();await Promise.resolve();assert.equal(f.copied,f.selector);
 f.denyCopy=true;f.button('Copiar seletor').click();await Promise.resolve();await Promise.resolve();assert.match(f.shadow.lastElementChild.previousElementSibling.textContent,/Ctrl\+C/);
 const candidates=f.shadow.getElementById('selector-candidates');candidates.value=candidates.options[candidates.options.length-1].value;candidates.dispatchEvent(new f.window.Event('change'));assert.ok(f.selector);
});

test('DOM changes clean removed selections/scopes, repeated activation replaces the tool and closing removes interception',async()=>{
 const f=fixture();const card=f.document.querySelector('.product-card');f.click(card);f.button('Usar como escopo').click();f.add(card.querySelector('.label'));card.remove();await f.window.happyDOM.whenAsyncComplete();assert.equal(f.shadow.querySelectorAll('ol li').length,0);assert.match(f.shadow.textContent,/O escopo foi removido/);
 const oldHost=f.document.querySelector('o-espertinho-selector-tool');startSelectorPicker();assert.equal(oldHost.isConnected,false);assert.equal(f.document.querySelectorAll('o-espertinho-selector-tool').length,1);f.button('Fechar').click();assert.equal(f.document.querySelectorAll('o-espertinho-selector-tool').length,0);assert.equal(f.click(f.document.querySelector('a')).defaultPrevented,false);
 startSelectorPicker();f.document.querySelector('o-espertinho-selector-tool').remove();await f.window.happyDOM.whenAsyncComplete();assert.equal(f.click(f.document.querySelector('a')).defaultPrevented,false);
});

test('selection limit, unsupported shadow content and keyboard/pointer events remain contained',()=>{
 const f=fixture();for(let i=0;i<21;i++){const e=f.document.createElement('div');e.className='example';f.document.body.append(e);f.add(e);}assert.equal(f.shadow.querySelectorAll('ol li').length,20);assert.match(f.shadow.textContent,/até 20 exemplos/);
 const host=f.document.createElement('div');const root=host.attachShadow({mode:'open'});const internal=f.document.createElement('span');root.append(internal);f.document.body.append(host);f.click(internal);assert.match(f.shadow.textContent,/árvore shadow/);
 f.button('Limpar seleção').click();f.click(f.document.documentElement);f.button('↑ Pai').click();f.key('ArrowUp');f.click(f.document.querySelector('span'));const down=new f.window.Event('pointerdown',{bubbles:true,cancelable:true,composed:true});f.document.querySelector('a').dispatchEvent(down);assert.equal(down.defaultPrevented,true);
 f.window.dispatchEvent(new f.window.Event('scroll'));f.window.dispatchEvent(new f.window.Event('resize'));f.shadow.querySelector('select').dispatchEvent(new f.window.KeyboardEvent('keydown',{key:'ArrowDown',composed:true,bubbles:true}));f.key('Escape');assert.equal(f.document.querySelector('o-espertinho-selector-tool'),null);
});

test('launcher targets only the active HTTP tab in isolated world and exposes controlled errors',async()=>{
 let tabs=[{id:5,url:'https://shop.example.com/list'}],calls=[];let fail=false;
 const browser={tabs:{query:async input=>{assert.deepEqual(input,{active:true,currentWindow:true});return tabs;}},scripting:{executeScript:async args=>{if(fail)throw new Error('Sensitive Chrome details');calls.push(args);}}};
 await launchSelectorPicker(browser);assert.equal(calls[0].target.tabId,5);assert.equal(calls[0].world,'ISOLATED');assert.equal(calls[0].func,startSelectorPicker);assert.equal(calls[0].args,undefined);
 tabs=[];await assert.rejects(()=>launchSelectorPicker(browser),/aba ativa/);tabs=[{id:5,url:'chrome://extensions'}];await assert.rejects(()=>launchSelectorPicker(browser),/HTTP ou HTTPS/);tabs=[{id:5,url:'https://chromewebstore.google.com'}];fail=true;await assert.rejects(()=>launchSelectorPicker(browser),/Chrome não permitiu/);
});

import {startSelectorPicker} from './selector-picker.js';
export async function launchSelectorPicker(browser:typeof chrome=chrome){
 const [tab]=await browser.tabs.query({active:true,currentWindow:true});
 if(!tab?.id||!tab.url)throw new Error('Não foi possível identificar a aba ativa.');
 const url=new URL(tab.url);
 if(!['http:','https:'].includes(url.protocol))throw new Error('Abra uma página HTTP ou HTTPS para selecionar elementos.');
 try{await browser.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:startSelectorPicker});}
 catch{throw new Error('O Chrome não permitiu inspecionar esta página. Páginas internas, lojas de extensões e alguns documentos são protegidos.');}
}

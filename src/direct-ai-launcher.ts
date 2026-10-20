import {captureAiOffer} from './local-ai.js';
export async function launchDirectAi(browser:typeof chrome=chrome){
 await browser.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
 try{const offer=await captureAiOffer(browser);await browser.storage.session.set({directAiOfferDraft:offer});}
 catch{await browser.storage.session.remove('directAiOfferDraft');}
 await browser.tabs.create({url:browser.runtime.getURL('direct-ai.html'),active:true});
}

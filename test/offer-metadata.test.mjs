import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {readFile} from 'node:fs/promises';
import {readOfferMetadata,captureAiOffer} from '../dist/offer-metadata.js';

test('captura lê somente metadados públicos de produto e ignora JSON inválido',async()=>{
 const page=new Window();globalThis.document=page.document;
 document.write('<title>Fallback</title><script type="application/ld+json">broken</script><script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Modelo X","description":"Descrição","brand":{"name":"Marca"},"category":"Áudio"}]}</script>');
 assert.deepEqual(readOfferMetadata(),{title:'Modelo X',description:'Descrição',brand:'Marca',sourceCategory:'Áudio'});
 const browser={tabs:{query:async()=>[{id:1,url:'https://shop.test/product'}]},scripting:{executeScript:async({func})=>[{result:func()}]}};
 assert.equal((await captureAiOffer(browser)).title,'Modelo X');browser.tabs.query=async()=>[{id:1,url:'chrome://settings'}];await assert.rejects(()=>captureAiOffer(browser),/HTTPS/);page.close();
});

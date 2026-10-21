import type {ReviewTransport} from './review-ai-workflow.js';
export class ReviewAiInventory{
 revision='';categories:any[]=[];products:any[]=[];
 async load(transport:ReviewTransport,current:()=>void){
  this.revision='';this.categories=[];this.products=[];
  for(const kind of ['categories','products','drafts']){
   let cursor:string|undefined;const seen=new Set<string>();
   do{current();const page=await transport('inventory',{kind,...(cursor?{cursor}:{}),...(this.revision?{revision:this.revision}:{}),limit:250});current();
    if(typeof page.revision!=='string'||!Array.isArray(page.items)||this.revision&&page.revision!==this.revision)throw new Error('Inventário inconsistente. Atualize e tente novamente.');
    this.revision=page.revision;
    if(kind==='categories')this.categories.push(...page.items);else this.products.push(...page.items);
    cursor=page.nextCursor??undefined;if(cursor){if(seen.has(cursor))throw new Error('Paginação do inventário sem progresso.');seen.add(cursor);}
   }while(cursor);
  }
 }
 merge(delta:any){
  if(!delta?.revision)throw new Error('O backend não devolveu a revisão do catálogo atualizado.');
  this.revision=delta.revision;
  this.categories=[...new Map([...this.categories,...delta.categories??[]].map(c=>[c.id,c])).values()];
  const removed=new Set(delta.removeDraftIds??[]);
  this.products=[...new Map([...this.products.filter(p=>!removed.has(p.id)),...delta.products??[],...delta.drafts??[]].map(p=>[p.id,p])).values()];
 }
}
const chunks=(items:any[],size:number)=>Array.from({length:Math.max(1,Math.ceil(items.length/size))},(_,i)=>items.slice(i*size,(i+1)*size));
export async function decideReview(context:any,inventory:ReviewAiInventory,model:string,analyze:(input:any)=>Promise<any>,current:()=>void){
 const call=async(categories:any[],products:any[],allowCreate=true)=>{current();const answer=await analyze({...context,model,categories,products,allowCreate,candidatesTruncated:false});current();return answer;};
 if(context.task==='product'){
  let proposal:any,ambiguous:any;
  for(const group of chunks(inventory.products,30)){
   const answer=await call([],group);if(answer.action==='link_existing')return answer;
   if(answer.action==='needs_review')ambiguous=answer;else proposal??=answer;
  }
  return ambiguous??proposal;
 }
 let proposal:any,ambiguous:any,finalists:any[]=[];
 for(const group of chunks(inventory.categories,100)){
  const answer=await call(group,[]);
  if(answer.action==='use_category'){const category=group.find(c=>c.id===answer.categoryId);if(!category)throw new Error('A IA escolheu uma categoria fora dos candidatos.');finalists.push(category);}
  else if(answer.action==='needs_review')ambiguous=answer;else proposal??=answer;
 }
 finalists=[...new Map(finalists.map(c=>[c.id,c])).values()];
 if(finalists.length===0)return ambiguous??proposal;
 while(finalists.length>100){const next:any[]=[];for(const group of chunks(finalists,100)){const answer=await call(group,[],false);if(answer.action==='needs_review')return answer;next.push(group.find(c=>c.id===answer.categoryId));}finalists=next;}
 // Resolve between all matching branches, rather than choosing the first partial match.
 return call(finalists,[],false);
}

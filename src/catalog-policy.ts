export type FailureKind='navigation'|'timeout'|'emptyPage'|'invalidItem'|'pagination';
export function discoveryPolicy(config:any,kind:FailureKind,attempt:number){
 const rule=config.failures?.[kind]??{action:'stop_section',retries:0,delayMs:5000,backoffMultiplier:2};
 return {action:rule.action,retry:attempt<Math.min(5,rule.retries),delayMs:Math.min(3600000,Math.max(100,rule.delayMs*Math.pow(rule.backoffMultiplier,attempt)))};
}
export function failureKind(message:string):FailureKind {
 if(message==='emptyPage'||message==='invalidItem'||message==='pagination')return message;
 return message==='incomplete'?'timeout':'navigation';
}

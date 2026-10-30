export class LocalError extends Error {constructor(message:string,status?:number,code?:string);status:number;code:string;}
export function verifyIdentity(jwt:string,options:any):Promise<{subject:string;email:string}>;
export class OpenAISession {
 constructor(options:{hostId:string;registrations?:any[];saveRegistrations?:(rows:any[])=>Promise<void>;fetcher?:typeof fetch;now?:()=>number});
 active:any;pending:any;loginError:string;generation:number;
 validateTokens(tokens:any):void;
 token():Promise<string>;
 status():any;
 begin(redirectUri:string,accountId?:string):Promise<string>;
 callback(params:URLSearchParams):Promise<void>;
 models(cached?:boolean):Promise<{id:string;name:string}[]>;
 signout():Promise<{revoked:boolean}>;
}

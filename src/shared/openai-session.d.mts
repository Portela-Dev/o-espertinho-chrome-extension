export class LocalError extends Error {}
export function verifyIdentity(jwt:string,options:any):Promise<{subject:string;email:string}>;
export class OpenAISession {
 constructor(options:{hostId:string;registrations?:any[];saveRegistrations?:(rows:any[])=>Promise<void>;fetcher?:typeof fetch;now?:()=>number});
 active:any;pending:any;loginError:string;generation:number;
 status():any;
 begin(redirectUri:string,accountId?:string):Promise<string>;
 callback(params:URLSearchParams):Promise<void>;
 models():Promise<{id:string;name:string}[]>;
 signout():Promise<{revoked:boolean}>;
}

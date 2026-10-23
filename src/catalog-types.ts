import type {Auth,Recipe} from './contracts.js';
export type CatalogStep='discover'|'convert'|'enrich'|'prices';
export interface BlockRule {kind:'login'|'challenge'|'access_denied'|'rate_limit'|'unavailable';match:'url_contains'|'selector'|'text';value:string}
export interface CatalogSettings {intervalMs:number;timeoutMs:number;humanTimeoutMs:number;categorySeparator:string;blockRules:BlockRule[];recipe:Recipe|null}
export interface CatalogMarket {id:string;name:string;website_url:string;catalog_executor:string;allowedOrigins:string[];config:CatalogSettings}
export interface CatalogRun {id:string;marketplace_id:string;step:CatalogStep|'preview'|'selector_test';status:string;reason:string;total:number;completed:number;failed:number;snapshot:any}
export interface CatalogClaim {item:{id:string;payload:any;lease_token:string;target_id:string}|null;snapshot:any;step:CatalogRun['step']}
export interface CatalogStats {marketplaceId:string;retryFailed:boolean;observedAt:string;convert:{pending:number;completed?:number;total:number};enrich:{pending:number;completed?:number;total:number}|null;prices:{pending:number;total:number}|null}
export interface CatalogState {
 version:2;backendUrl:string;environmentId?:string;auth?:Auth;
 pair?:{deviceCode:string;verifier:string;expiresAt:number;verificationUrl:string;nextAt:number};
 markets:CatalogMarket[];marketplaceId?:string;retryFailed?:boolean;run?:CatalogRun;tabId?:number;windowId?:number;hostWindowId?:number;
 locallyPaused?:boolean;claim?:CatalogClaim;pendingResult?:Record<string,unknown>;nextAt?:number;message:string;error?:string;
}

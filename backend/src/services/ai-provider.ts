import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getConfig } from '../config/env.js';
import { HttpError } from '../common/http.js';
import { z } from 'zod';
import { validateProviderBaseUrl } from './ai-provider-registry.js';

const capabilityNames=['shared/agricultural-assistant','shared/market-advisor','shared/recommendations-center','farmer/crop-advisor','farmer/price-advisor','farmer/listing-assistant','farmer/matching-assistant','farmer/harvest-advisor','farmer/net-profit-advisor','buyer/produce-finder','buyer/supplier-advisor','buyer/purchase-assistant'] as const;
export type AiCapability=typeof capabilityNames[number];
export const AI_CAPABILITIES=capabilityNames;
const t=z.string().trim().min(1).max(4000);const positive=z.number().finite().positive();const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const requestSchemas:Record<AiCapability,z.ZodTypeAny>={
  'shared/agricultural-assistant':z.object({message:t,history:z.array(z.object({role:z.enum(['user','assistant']),content:t}).passthrough()).max(24).optional()}).passthrough(),
  'shared/market-advisor':z.object({produce:t,location:t,quantity:positive,timePeriod:z.enum(['week','month','quarter']),verifiedObservations:z.array(z.unknown()).max(100).optional()}).passthrough(),
  'shared/recommendations-center':z.object({role:z.enum(['farmer','buyer']),produceType:t,location:t,budget:z.number().nonnegative().optional(),rankedCandidates:z.array(z.unknown()).max(10).optional()}).passthrough(),
  'farmer/crop-advisor':z.object({produceType:t,growingStage:t,location:t,expectedQuantity:positive,expectedHarvestDate:date.optional()}).passthrough(),
  'farmer/price-advisor':z.object({produce:t,quantity:positive,qualityGrade:t,location:t,unit:t,verifiedObservations:z.array(z.unknown()).max(100).optional()}).passthrough(),
  'farmer/listing-assistant':z.object({existingTitle:t,description:t,qualityDetails:z.string().max(1000).optional(),quantity:z.string().max(100).optional(),availability:z.string().max(100).optional()}).passthrough(),
  'farmer/matching-assistant':z.object({produceType:t,quantity:positive,location:t,quality:z.string().max(300).optional(),availability:z.string().max(300).optional()}).passthrough(),
  'farmer/harvest-advisor':z.object({produceType:t,expectedHarvestDate:date,expectedQuantity:positive,location:t,logisticsPlan:z.record(z.string(),z.unknown()).optional(),question:z.string().max(4000).optional()}).passthrough(),
  'farmer/net-profit-advisor':z.object({calculation:z.record(z.string(),z.unknown()),question:z.string().max(4000).optional()}).passthrough(),
  'buyer/produce-finder':z.object({produceType:t,requiredQuantity:positive,location:t,unit:z.string().max(30).optional(),qualityRequirements:z.string().max(500).optional(),budgetRange:z.string().max(100).optional(),requiredAvailabilityDate:date.optional(),rankedMatches:z.array(z.unknown()).max(10).optional(),question:z.string().max(4000).optional()}).passthrough(),
  'buyer/supplier-advisor':z.object({produceType:t,location:t,quantity:positive.optional(),quality:z.string().max(300).optional(),availability:z.string().max(300).optional(),rankedSuppliers:z.array(z.unknown()).max(10).optional()}).passthrough(),
  'buyer/purchase-assistant':z.object({produceRequirements:t,requiredQuantities:positive,budget:z.number().nonnegative().optional(),purchaseDeadline:date.optional(),deliveryArea:t,purchasePlan:z.record(z.string(),z.unknown()).optional(),question:z.string().max(4000).optional()}).passthrough(),
};
export function validateAiRequest(capability:string,payload:unknown){if(!capabilityNames.includes(capability as AiCapability))throw new HttpError(404,'AI capability not found.','AI_CAPABILITY_NOT_FOUND');const result=requestSchemas[capability as AiCapability].safeParse(payload);if(!result.success)throw new HttpError(422,result.error.issues[0]?.message??'Check the AI request fields.','AI_INVALID_REQUEST',String(result.error.issues[0]?.path.join('.')??''));return result.data as Record<string,unknown>;}
const keyBytes=()=>{const raw=getConfig().CONFIG_ENCRYPTION_KEY??'';let key:Buffer;try{key=Buffer.from(raw,'base64');}catch{key=Buffer.alloc(0);}if(key.length!==32&&/^[a-f0-9]{64}$/i.test(raw))key=Buffer.from(raw,'hex');if(key.length!==32)throw new HttpError(503,'AI configuration encryption is not available on the server.','AI_CONFIG_ENCRYPTION_UNAVAILABLE');return key;};
export function encryptSecret(value:string){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',keyBytes(),iv);const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return{iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')};}
export function decryptSecret(value:any){const decipher=createDecipheriv('aes-256-gcm',keyBytes(),Buffer.from(value.iv,'base64'));decipher.setAuthTag(Buffer.from(value.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString('utf8');}
export async function loadAiConfig(){
  // Compatibility API: derive the old NVIDIA-shaped response from the same
  // provider registry and capability routes used by every gateway request.
  const { readAiGatewayConfig } = await import('./ai-gateway.js');
  const config = await readAiGatewayConfig();
  const provider = config.providers.nvidia;
  const capabilityModels = Object.fromEntries(capabilityNames.flatMap((capability) => {
    const route = config.capabilityRouting[capability];
    return route.preferredProvider === 'nvidia' && route.preferredModel ? [[capability, route.preferredModel]] : [];
  }));
  return {
    enabled: provider.enabled, baseUrl: provider.baseUrl, model: provider.model, capabilityModels,
    apiKey: provider.apiKey, timeoutMs: provider.timeoutMs, temperature: provider.temperature,
    topP: provider.topP, maxTokens: provider.maxTokens, source: provider.source,
  };
}
export function maskSecret(secret:string){return secret?`••••••••${secret.slice(-4)}`:'';}
export async function generateAi(capability:AiCapability,payload:Record<string,unknown>,history:Array<{role:'user'|'assistant';content:string}> = [],role='unknown',priorUserMessages:string[]=[],outputMode:'capability'|'explanation'='capability'){
  const { routeAiGeneration } = await import('./ai-gateway.js');
  return routeAiGeneration(capability,payload,{history,role,priorUserMessages,outputMode});
}
export function validateAiResponse(capability:AiCapability,value:any){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(503,'The AI provider returned an invalid response.','AI_RESPONSE_INVALID');
  const mustString:Record<string,string[]>={'shared/agricultural-assistant':['content'],'shared/market-advisor':['summary'],'shared/recommendations-center':['summary'],'farmer/crop-advisor':['summary'],'farmer/price-advisor':[],'farmer/listing-assistant':['improvedTitle','improvedDescription'],'farmer/matching-assistant':[],'farmer/harvest-advisor':['timeline'],'farmer/net-profit-advisor':['summary'],'buyer/produce-finder':[],'buyer/supplier-advisor':['summary'],'buyer/purchase-assistant':['summary']};
  for(const key of mustString[capability]??[])if(typeof value[key]!=='string'||!value[key].trim())throw new HttpError(503,'The AI provider returned an incomplete response.','AI_RESPONSE_INVALID');
  const arrays:Record<string,string[]>={'farmer/price-advisor':[],'farmer/matching-assistant':['matches'],'buyer/produce-finder':['matches']};for(const key of arrays[capability]??[])if(!Array.isArray(value[key]))throw new HttpError(503,'The AI provider returned an incomplete response.','AI_RESPONSE_INVALID');
  if(capability==='farmer/price-advisor'&&(!Number.isFinite(value.suggestedMinPrice)||!Number.isFinite(value.suggestedMaxPrice)||value.suggestedMinPrice<0||value.suggestedMaxPrice<value.suggestedMinPrice))throw new HttpError(503,'The AI provider returned an invalid price range.','AI_RESPONSE_INVALID');
}
export function validateProviderConfig(input:{baseUrl:string;model:string;apiKey?:string;timeoutMs?:number;temperature?:number;topP?:number;maxTokens?:number;enabled?:boolean}){
  let baseUrl:string;try{baseUrl=validateProviderBaseUrl('nvidia',input.baseUrl);}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(422,'Use NVIDIA’s public HTTPS API base URL.','AI_PROVIDER_URL_INVALID','baseUrl');}if(input.model.trim().length<2||input.model.length>160)throw new HttpError(422,'Enter a valid model identifier.','AI_MODEL_INVALID','model');if(input.apiKey!==undefined&&(input.apiKey.length<12||input.apiKey.length>500))throw new HttpError(422,'Enter a valid API credential or leave it blank to retain the saved value.','AI_KEY_INVALID','apiKey');
  return{baseUrl,model:input.model.trim(),apiKey:input.apiKey,timeoutMs:Math.max(1000,Math.min(120000,input.timeoutMs??30000)),temperature:Math.max(0,Math.min(2,input.temperature??0.2)),topP:Math.max(0,Math.min(1,input.topP??0.9)),maxTokens:Math.max(1,Math.min(8192,input.maxTokens??1200)),enabled:input.enabled!==false};
}

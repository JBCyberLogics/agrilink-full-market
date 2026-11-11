import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../common/auth.js';
import { writeAudit } from '../common/audit.js';
import { calculateNetProfit } from '../common/algorithms.js';
import { HttpError, sendData } from '../common/http.js';
import { AiConversation, AiMessage, AiUsage, MarketPrice, Product, Setting } from '../database/models.js';
import { AI_CAPABILITIES, generateAi, loadAiConfig, maskSecret, validateProviderConfig, encryptSecret, validateAiRequest } from '../services/ai-provider.js';
import { parseBody, objectId } from '../common/validation.js';
import { productIsAvailable, productToApi } from '../services/marketplace.js';
import { requireRole } from '../common/identity.js';
import { deduplicateMarketObservations, marketObservationToApi, verifiedMarketObservationQuery } from '../services/market-intelligence.js';

export const aiRouter=Router();
const payloadSchema=z.record(z.string(),z.unknown()).refine(v=>JSON.stringify(v).length<=30000,'The AI request is too large.');
const capabilityModelSchema=z.record(z.enum(AI_CAPABILITIES),z.string().trim().min(2).max(160).nullable());
async function runCapability(capability:string,req:any,res:any){
  if(!AI_CAPABILITIES.includes(capability as any))throw new HttpError(404,'AI capability not found.','AI_CAPABILITY_NOT_FOUND');
  if(capability.startsWith('farmer/'))requireRole(req,['farmer']);
  if(capability.startsWith('buyer/'))requireRole(req,['buyer']);
  if(JSON.stringify(req.body??{}).length>30000)throw new HttpError(413,'The AI request is too large.','AI_REQUEST_TOO_LARGE');const payload=validateAiRequest(capability,req.body);const hourAgo=new Date(Date.now()-3600000);const used=await AiUsage.countDocuments({user:req.user._id,createdAt:{$gte:hourAgo},status:'success'});if(used>=30)throw new HttpError(429,'You have reached the hourly AI request limit.','AI_RATE_LIMITED');
  if(capability==='farmer/net-profit-advisor'){
    const calc=(payload as any).calculation??payload;const result=calculateNetProfit(calc);const data={summary:`Estimated net profit is ${result.netProfit.toFixed(2)} ${result.currency} at the supplied figures.`,...result,actions:[]};await AiUsage.create({user:req.user._id,capability,status:'success',createdAt:new Date()});return sendData(res,{capability,data,meta:{provider:'deterministic',source:'user-provided inputs',estimate:true}});
  }
  const conversationId=(payload as any).conversationId;let conversation:any;
  if(conversationId){conversation=await AiConversation.findOne({_id:objectId(conversationId,'conversationId'),user:req.user._id,capability});if(!conversation)throw new HttpError(404,'AI conversation not found.','AI_CONVERSATION_NOT_FOUND');}
  const history=Array.isArray((payload as any).history)?(payload as any).history.slice(-24).map((turn:any)=>({role:turn.role==='assistant'?'assistant':'user',content:String(turn.content??turn.message??'').slice(0,4000)})):[];
  const context:Record<string,unknown>={};
  if(capability==='shared/market-advisor'||capability==='farmer/price-advisor'){
    const produce=String((payload as any).produce).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const now=new Date();const marketFilter:any=verifiedMarketObservationQuery(now);marketFilter.$and.push({$or:[{produce:{$regex:produce,$options:'i'}},{crop:{$regex:produce,$options:'i'}}]},{observedAt:{$gte:new Date(now.getTime()-24*60*60*1000),$lte:now}});const rows=await MarketPrice.find(marketFilter).sort({observedAt:-1}).limit(100);
    const observations=deduplicateMarketObservations(rows.flatMap((row:any)=>{const observation=marketObservationToApi(row);return observation&&Date.now()-new Date(observation.observedAt).getTime()<24*60*60*1000?[observation]:[]}));
    if(!observations.length)throw new HttpError(503,'No fresh verified market observation is available for this produce. No price recommendation was generated.','MARKET_DATA_UNAVAILABLE');context.verifiedObservations=observations;
  }
  const productCapability=['shared/recommendations-center','farmer/matching-assistant','buyer/produce-finder','buyer/supplier-advisor'].includes(capability);
  if(productCapability){const produce=String((payload as any).produceType).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const rows=await Product.find({isDeleted:{$ne:true},isAvailable:{$ne:false},isAvailableForSale:{$ne:false},status:{$nin:['archived','deleted','inactive','rejected','sold','soldout','unavailable','draft','pending','suspended']},$or:[{name:{$regex:produce,$options:'i'}},{cropType:{$regex:produce,$options:'i'}}]}).sort({updatedAt:-1}).limit(50);const candidates=await Promise.all(rows.filter(productIsAvailable).map(productToApi));if(!candidates.length)throw new HttpError(503,'No currently available marketplace listings match this request. No supplier recommendations were generated.','MARKETPLACE_CANDIDATES_UNAVAILABLE');context.marketplaceCandidates=candidates.map((p:any)=>({id:p.id,name:p.name,priceCents:p.priceCents,currency:p.currency,unit:p.unit,stock:p.stock,qualityGrade:p.qualityGrade,county:p.county,availability:p.isAvailable}));}
  try{
    const safePayload={...payload};delete (safePayload as any).verifiedObservations;delete (safePayload as any).rankedCandidates;delete (safePayload as any).rankedMatches;delete (safePayload as any).rankedSuppliers;const generated=await generateAi(capability as any,{...safePayload,authoritativeContext:context},history);
    if(productCapability){const candidates=(context.marketplaceCandidates as any[])??[];const ids=new Set(candidates.map((item:any)=>String(item.id)));const collection=Array.isArray((generated.data as any).matches)?(generated.data as any).matches:Array.isArray((generated.data as any).items)?(generated.data as any).items:Array.isArray((generated.data as any).suppliers)?(generated.data as any).suppliers:[];const key=capability==='buyer/supplier-advisor'?'suppliers':capability==='shared/recommendations-center'?'items':'matches';(generated.data as any)[key]=collection.filter((match:any)=>ids.has(String(match?.productId??match?.id??''))).map((match:any)=>{const actual=candidates.find((candidate:any)=>String(candidate.id)===String(match?.productId??match?.id));return{...actual,reason:typeof match.reason==='string'?match.reason.slice(0,500):undefined};});}
    conversation=conversation??await AiConversation.create({user:req.user._id,capability,title:String((payload as any).message??(payload as any).produce??capability).slice(0,120),createdAt:new Date(),updatedAt:new Date()});
    await AiMessage.create([{conversation:conversation._id,role:'user',content:JSON.stringify(payload).slice(0,30000),createdAt:new Date()},{conversation:conversation._id,role:'assistant',content:JSON.stringify(generated.data).slice(0,50000),createdAt:new Date()}]);conversation.updatedAt=new Date();await conversation.save();
    await AiUsage.create({user:req.user._id,capability,status:'success',model:generated.model,provider:generated.provider,usage:generated.usage,createdAt:new Date()});
    return sendData(res,{capability,data:generated.data,conversationId:String(conversation._id),meta:{provider:generated.provider,model:generated.model,usage:generated.usage}});
  }catch(error){await AiUsage.create({user:req.user._id,capability,status:'failed',createdAt:new Date()});throw error;}
}
aiRouter.post('/assistant',requireAuth,async(req,res)=>runCapability('shared/agricultural-assistant',req,res));
aiRouter.post('/:scope/:name',requireAuth,async(req,res)=>runCapability(`${req.params.scope}/${req.params.name}`,req,res));
aiRouter.post('/:capability',requireAuth,async(req,res)=>runCapability(String(req.params.capability),req,res));
aiRouter.get('/conversations',requireAuth,async(req,res)=>{const rows=await AiConversation.find({user:req.user._id}).sort({updatedAt:-1}).limit(50);return sendData(res,{conversations:rows.map((c:any)=>({id:String(c._id),capability:c.capability,title:c.title,updatedAt:c.updatedAt}))});});
aiRouter.get('/conversations/:id',requireAuth,async(req,res)=>{const id=objectId(req.params.id);const c=await AiConversation.findOne({_id:id,user:req.user._id});if(!c)throw new HttpError(404,'AI conversation not found.','AI_CONVERSATION_NOT_FOUND');const rows=await AiMessage.find({conversation:id}).sort({createdAt:1}).limit(100);return sendData(res,{conversation:{id:String(c._id),capability:c.capability,title:c.title},messages:rows.map((m:any)=>({role:m.role,content:m.content,createdAt:m.createdAt}))});});

export const adminAiRouter=Router();
adminAiRouter.get('/config',requirePermission('ai.read'),async(_req,res)=>{const config=await loadAiConfig();return sendData(res,{enabled:config.enabled,baseUrl:config.baseUrl,model:config.model,capabilityModels:config.capabilityModels,apiKeyMasked:maskSecret(config.apiKey),hasApiKey:Boolean(config.apiKey),source:config.source,timeoutMs:config.timeoutMs,temperature:config.temperature,topP:config.topP,maxTokens:config.maxTokens,capabilities:AI_CAPABILITIES});});
adminAiRouter.put('/config',requirePermission('ai.configure'),async(req,res)=>{
  const body=parseBody(z.object({baseUrl:z.string().url(),model:z.string().trim().min(2).max(160),capabilityModels:capabilityModelSchema.optional(),apiKey:z.string().max(500).optional(),timeoutMs:z.coerce.number().int().min(1000).max(120000).optional(),temperature:z.coerce.number().min(0).max(2).optional(),topP:z.coerce.number().min(0).max(1).optional(),maxTokens:z.coerce.number().int().min(1).max(8192).optional(),enabled:z.boolean().optional()}),req.body);
  const current:any=await Setting.findOne({scope:'ai.provider'});const config=validateProviderConfig({...body,apiKey:body.apiKey||undefined});const encryptedApiKey=body.apiKey?encryptSecret(body.apiKey):current?.value?.encryptedApiKey;
  if(body.enabled!==false&&!encryptedApiKey&&!process.env.NVIDIA_API_KEY)throw new HttpError(422,'An NVIDIA API credential is required to enable the provider.','AI_KEY_REQUIRED','apiKey');
  const value={baseUrl:config.baseUrl,model:config.model,capabilityModels:{...(current?.value?.capabilityModels??{}),...(body.capabilityModels??{})},encryptedApiKey,enabled:config.enabled,timeoutMs:config.timeoutMs,temperature:config.temperature,topP:config.topP,maxTokens:config.maxTokens};
  await Setting.updateOne({scope:'ai.provider'},{$set:{scope:'ai.provider',value,updatedAt:new Date(),updatedBy:req.user._id},$setOnInsert:{createdAt:new Date()}},{upsert:true});await writeAudit({actor:req.user._id,action:'ai.provider_configured',resource:'ai-provider',metadata:{model:config.model,baseUrl:config.baseUrl,enabled:config.enabled,secretChanged:Boolean(body.apiKey)}});
  const saved=await loadAiConfig();return sendData(res,{enabled:config.enabled,baseUrl:config.baseUrl,model:config.model,capabilityModels:saved.capabilityModels,apiKeyMasked:maskSecret(body.apiKey??saved.apiKey),hasApiKey:Boolean(encryptedApiKey),timeoutMs:config.timeoutMs,temperature:config.temperature,topP:config.topP,maxTokens:config.maxTokens});
});
adminAiRouter.post('/diagnostics',requirePermission('ai.configure'),async(_req,res)=>{const config=await loadAiConfig();if(!config.enabled||!config.apiKey||!config.baseUrl||!config.model)throw new HttpError(503,'Configure a base URL, model, and key before testing the provider.','AI_PROVIDER_NOT_CONFIGURED');try{const result=await generateAi('shared/agricultural-assistant',{message:'Reply with a brief readiness confirmation. Do not claim to have access to external data.'});await writeAudit({actor:(_req as any).user?._id,action:'ai.provider_diagnostic',resource:'ai-provider',metadata:{status:'available',model:config.model}});return sendData(res,{available:true,model:config.model,provider:'nvidia',responseValidated:Boolean(result.data)});}catch(error){await writeAudit({actor:(_req as any).user?._id,action:'ai.provider_diagnostic',resource:'ai-provider',outcome:'failure',metadata:{status:'unavailable'}});throw error;}});
adminAiRouter.get('/usage',requirePermission('ai.read'),async(_req,res)=>{const [total,failed,byCapability]=await Promise.all([AiUsage.countDocuments({}),AiUsage.countDocuments({status:'failed'}),AiUsage.aggregate([{$group:{_id:'$capability',requests:{$sum:1},failures:{$sum:{$cond:[{$eq:['$status','failed']},1,0]}}}}])]);return sendData(res,{totalRequests:total,failedRequests:failed,byCapability:byCapability.map((x:any)=>({capability:x._id,requests:x.requests,failures:x.failures}))});});

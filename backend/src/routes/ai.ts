import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../common/auth.js';
import { writeAudit } from '../common/audit.js';
import { calculateNetProfit } from '../common/algorithms.js';
import { HttpError, sendData } from '../common/http.js';
import { AiConversation, AiMessage, AiUsage, MarketPrice, Product, PurchaseRequest, Setting, User } from '../database/models.js';
import { AI_CAPABILITIES, generateAi, loadAiConfig, maskSecret, validateAiRequest } from '../services/ai-provider.js';
import { parseBody, objectId } from '../common/validation.js';
import { productIsAvailable, productToApi } from '../services/marketplace.js';
import { requireRole } from '../common/identity.js';
import { deduplicateMarketObservations, marketObservationToApi, verifiedMarketObservationQuery } from '../services/market-intelligence.js';
import { assertAiDomain } from '../services/ai-domain-policy.js';
import { AI_PROVIDER_IDS, type AiProviderId } from '../services/ai-provider-registry.js';
import { providerAdminView, readAiGatewayConfig, removeProviderConfiguration, runProviderConnectivityDiagnostic, runProviderInferenceDiagnostic, saveCapabilityRouting, saveProviderConfiguration } from '../services/ai-gateway.js';
import { normalizeMatchingWeights } from '../common/algorithms.js';

export const aiRouter=Router();
const payloadSchema=z.record(z.string(),z.unknown()).refine(v=>JSON.stringify(v).length<=30000,'The AI request is too large.');
const capabilityModelSchema=z.record(z.enum(AI_CAPABILITIES),z.string().trim().min(2).max(160).nullable());
const providerInputFields:Record<string,string[]>={
  'shared/agricultural-assistant':['message'],'shared/market-advisor':['produce','location','quantity','timePeriod'],
  'shared/recommendations-center':['role','produceType','location','budget'],'farmer/crop-advisor':['produceType','growingStage','location','expectedQuantity','expectedHarvestDate'],
  'farmer/price-advisor':['produce','quantity','qualityGrade','location','unit'],'farmer/listing-assistant':['existingTitle','description','qualityDetails','quantity','availability'],
  'farmer/matching-assistant':['produceType','quantity','location','quality','availability'],'farmer/harvest-advisor':['produceType','expectedHarvestDate','expectedQuantity','location','logisticsPlan','question'],
  'farmer/net-profit-advisor':['calculation','question'],'buyer/produce-finder':['produceType','requiredQuantity','location','unit','qualityRequirements','budgetRange','requiredAvailabilityDate','question'],
  'buyer/supplier-advisor':['produceType','location','quantity','quality','availability'],'buyer/purchase-assistant':['produceRequirements','requiredQuantities','budget','purchaseDeadline','deliveryArea','question'],
};
function providerSafeInput(capability:string,payload:Record<string,unknown>){return Object.fromEntries((providerInputFields[capability]??[]).filter(key=>Object.hasOwn(payload,key)).map(key=>[key,payload[key]]));}
async function explainDeterministicResult(capability:string,payload:Record<string,unknown>,context:Record<string,unknown>,history:Array<{role:'user'|'assistant';content:string}>,role:string,priorUserMessages:string[],user:unknown){
  let config;try{config=await readAiGatewayConfig();}catch{return{status:'unavailable',explanation:null,provider:null};}
  if(!config.capabilityRouting[capability as keyof typeof config.capabilityRouting]?.explanationsEnabled)return{status:'disabled',explanation:null,provider:null};
  try{
    const result=await generateAi(capability as any,{...payload,authoritativeContext:{...context,explanationOnly:true,providerInstruction:'Explain the deterministic result. Do not rank, add, remove, or alter records. Use only the supplied facts.'}},history,role,priorUserMessages,'explanation');
    const explanation=typeof (result.data as any).explanation==='string'?(result.data as any).explanation:null;
    await AiUsage.create({user,capability,status:'success',provider:result.provider,model:result.model,usage:result.usage,latencyMs:result.latencyMs,fallbackAttempts:result.fallbackAttempts,providerAttempts:result.providerAttempts,operation:'deterministic-explanation',createdAt:new Date()});
    return{status:explanation?'available':'unavailable',explanation,provider:result.provider};
  }catch(error){
    const details=error instanceof HttpError&&error.details&&typeof error.details==='object'?error.details as Record<string,unknown>:{};
    await AiUsage.create({user,capability,status:'failed',provider:details.provider,latencyMs:details.latencyMs,errorCategory:details.category??(error instanceof HttpError?error.code:'provider_error'),fallbackAttempts:details.fallbackAttempts??0,providerAttempts:details.providerAttempts??[],operation:'deterministic-explanation',createdAt:new Date()});
    return{status:'unavailable',explanation:null,provider:null};
  }
}
async function runCapability(capability:string,req:any,res:any){
  if(!AI_CAPABILITIES.includes(capability as any))throw new HttpError(404,'AI capability not found.','AI_CAPABILITY_NOT_FOUND');
  if(capability.startsWith('farmer/'))requireRole(req,['farmer']);
  if(capability.startsWith('buyer/'))requireRole(req,['buyer']);
  if(capability==='shared/recommendations-center'){requireRole(req,['farmer','buyer']);(req.body as any).role=String(req.user.role??'').toLowerCase();}
  if(JSON.stringify(req.body??{}).length>30000)throw new HttpError(413,'The AI request is too large.','AI_REQUEST_TOO_LARGE');const payload=validateAiRequest(capability,req.body);
  const conversationId=(payload as any).conversationId;let conversation:any;let history:Array<{role:'user'|'assistant';content:string}>=[];let priorUserMessages:string[]=[];
  if(conversationId){conversation=await AiConversation.findOne({_id:objectId(conversationId,'conversationId'),user:req.user._id,capability});if(!conversation)throw new HttpError(404,'AI conversation not found.','AI_CONVERSATION_NOT_FOUND');const rows=await AiMessage.find({conversation:conversation._id,role:{$in:['user','assistant']}}).sort({createdAt:-1}).limit(24).lean();history=rows.reverse().map((row:any)=>({role:row.role==='assistant'?'assistant':'user',content:String(row.content??'').slice(0,4000)}));priorUserMessages=history.filter((turn)=>turn.role==='user').map((turn)=>turn.content);}
  // One backend policy gates every capability before algorithms, persistence, or providers run.
  assertAiDomain(capability,payload,priorUserMessages);
  const hourAgo=new Date(Date.now()-3600000);const used=await AiUsage.countDocuments({user:req.user._id,createdAt:{$gte:hourAgo},status:'success'});if(used>=30)throw new HttpError(429,'You have reached the hourly AI request limit.','AI_RATE_LIMITED');
  if(capability==='farmer/net-profit-advisor'){
    const calc=(payload as any).calculation??payload;const result=calculateNetProfit(calc);const data:any={summary:`Estimated net profit is ${result.netProfit.toFixed(2)} ${result.currency} at the supplied figures.`,...result,actions:[]};const explanation=await explainDeterministicResult(capability,payload,{deterministicCalculation:result},history,String(req.user.role??'unknown').toLowerCase(),priorUserMessages,req.user._id);data.explanation=explanation.explanation;data.explanationStatus=explanation.status;await AiUsage.create({user:req.user._id,capability,status:'success',provider:'deterministic',source:'user-provided inputs',latencyMs:0,createdAt:new Date()});return sendData(res,{capability,data,meta:{provider:'deterministic',source:'user-provided inputs',estimate:true,explanationProvider:explanation.provider}});
  }
  const context:Record<string,unknown>={};
  let verifiedObservations:any[]=[];
  if(capability==='shared/market-advisor'||capability==='farmer/price-advisor'){
    const produce=String((payload as any).produce).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const now=new Date();const isMarketAdvisor=capability==='shared/market-advisor';const periodDays:Record<string,number>={week:7,month:30,quarter:90};const periodMs=isMarketAdvisor?(periodDays[String((payload as any).timePeriod)]??7)*24*60*60*1000:24*60*60*1000;const observationStart=new Date(now.getTime()-periodMs);const marketFilter:any=verifiedMarketObservationQuery(now);marketFilter.$and.push({$or:[{produce:{$regex:produce,$options:'i'}},{crop:{$regex:produce,$options:'i'}}]},{observedAt:{$gte:observationStart,$lte:now}});const rows=await MarketPrice.find(marketFilter).sort({observedAt:-1}).limit(100);
    verifiedObservations=deduplicateMarketObservations(rows.flatMap((row:any)=>{const observation=marketObservationToApi(row);const observedAt=observation?new Date(observation.observedAt).getTime():NaN;return observation&&observedAt>=observationStart.getTime()&&observedAt<=now.getTime()?[observation]:[]}));
    const requestedLocation=String((payload as any).location??'').trim().toLocaleLowerCase();const requestedUnit=String((payload as any).unit??'').trim().toLocaleLowerCase();
    verifiedObservations=verifiedObservations.filter((item:any)=>{const location=[item.market,item.location].filter(Boolean).some((value:any)=>String(value).trim().toLocaleLowerCase()===requestedLocation);const unit=!requestedUnit||String(item.unit??'').trim().toLocaleLowerCase()===requestedUnit;return location&&unit;});
    if(!verifiedObservations.length)throw new HttpError(503,`No verified market observation matches this produce, location, measurement unit, and ${isMarketAdvisor?String((payload as any).timePeriod):'24-hour freshness'} window. No market recommendation was generated.`,'MARKET_DATA_UNAVAILABLE');context.verifiedObservations=verifiedObservations;
  }
  const productCapability=['shared/recommendations-center','buyer/produce-finder','buyer/supplier-advisor','buyer/purchase-assistant'].includes(capability);
  if(productCapability){const searchTerms=capability==='buyer/purchase-assistant'?String((payload as any).produceRequirements??'').match(/[\p{L}\p{N}]{4,}/gu)?.filter((word:string)=>!['need','want','with','from','each','unit','delivery','quality','produce'].includes(word.toLowerCase())).slice(0,4)??[]:[String((payload as any).produceType??'')];const terms=searchTerms.filter(Boolean).map((term:string)=>term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));if(!terms.length)throw new HttpError(422,'Include a produce name in the purchase requirements.','AI_INVALID_REQUEST','produceRequirements');const query:any={$or:terms.flatMap((term:string)=>[{name:{$regex:term,$options:'i'}},{cropType:{$regex:term,$options:'i'}}])};const rows=await Product.find({isDeleted:{$ne:true},isAvailable:{$ne:false},isAvailableForSale:{$ne:false},status:{$nin:['archived','deleted','inactive','rejected','sold','soldout','unavailable','draft','pending','suspended']},...query}).sort({updatedAt:-1}).limit(50);const candidates=await Promise.all(rows.filter(productIsAvailable).map(productToApi));if(!candidates.length&&capability!=='buyer/produce-finder')throw new HttpError(503,'No currently available marketplace listings match this request. No supplier recommendations were generated.','MARKETPLACE_CANDIDATES_UNAVAILABLE');context.marketplaceCandidates=candidates.map((p:any)=>({id:p.id,name:p.name,description:p.description??null,price:p.price,priceCents:p.priceCents,currency:p.currency,unit:p.unit,stock:p.stock,qualityGrade:p.qualityGrade,county:p.county,availability:p.isAvailable}));}
  if(capability==='farmer/matching-assistant'){
    const produce=String((payload as any).produceType).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const ownedListingIds=await Product.find({$or:[{farmer:req.user._id},{sellerId:req.user._id}],isDeleted:{$ne:true}}).distinct('_id');
    const requests=ownedListingIds.length?await PurchaseRequest.find({status:'open',listingId:{$in:ownedListingIds},produce:{$regex:produce,$options:'i'}}).sort({createdAt:-1}).limit(100).lean():[];
    const buyerIds=[...new Set(requests.map((item:any)=>String(item.buyer)).filter(Boolean))];
    const buyers=buyerIds.length?await User.find({_id:{$in:buyerIds}}).select('fullName firstName lastName name').lean():[];
    const buyerNames=new Map(buyers.map((buyer:any)=>[String(buyer._id),buyer.fullName??buyer.name??[buyer.firstName,buyer.lastName].filter(Boolean).join(' ')]));
    const setting:any=await Setting.findOne({scope:'algorithm.matching'});
    const weights=normalizeMatchingWeights(setting?.value?.weights??{price:0.35,quality:0.25,distance:0.2,availability:0.2});
    const matches=(await Promise.all(requests.map(async(request:any)=>{
      const product=await Product.findOne({_id:request.listingId,$or:[{farmer:req.user._id},{sellerId:req.user._id}],isDeleted:{$ne:true}});
      if(!product||!productIsAvailable(product))return null;
      const listing:any=await productToApi(product);
      const factorValues:Record<string,number|null>={
        price:Number.isFinite(Number(request.proposedPrice))&&Number(request.proposedPrice)>=0&&Number(listing.price)>0?Math.min(Number(request.proposedPrice)/Number(listing.price),1):null,
        quality:request.quality&&(payload as any).quality?String(request.quality).trim().toLowerCase()===String((payload as any).quality).trim().toLowerCase()?1:0:null,
        distance:null,
        availability:Number.isFinite(Number(request.quantity))&&Number(request.quantity)>0?Math.min(Number(listing.stock)/Number(request.quantity),1):null,
      };
      const used=Object.entries(weights).filter(([key,weight])=>weight>0&&Number.isFinite(factorValues[key]));
      const total=used.reduce((sum,[,weight])=>sum+weight,0);if(!total)return null;
      const score=used.reduce((sum,[key,weight])=>sum+Number(factorValues[key])*weight,0)/total;
      return{id:String(request._id),buyerName:buyerNames.get(String(request.buyer))||'Buyer',produce:request.produce,quantity:request.quantity,unit:request.unit,location:request.deliveryArea??null,quality:request.quality??null,proposedPrice:request.proposedPrice??null,createdAt:request.createdAt??null,listing:{id:listing.id,name:listing.name,price:listing.price,currency:listing.currency,unit:listing.unit,stock:listing.stock},score:Math.round(score*10000)/100,scoreCoverage:Math.round(total*10000)/100,factors:factorValues,missingFactors:Object.keys(weights).filter(key=>!Number.isFinite(factorValues[key])),weights,explanation:'Deterministic match from this farmer’s active listing and a persisted open buyer request. Distance is withheld because verified coordinates are unavailable.'};
    }))).filter(Boolean).sort((a:any,b:any)=>b.score-a.score||b.scoreCoverage-a.scoreCoverage);
    context.deterministicMatches=matches;
  }
  try{
    const safePayload=providerSafeInput(capability,payload);const role=String(req.user.role??'unknown').toLowerCase();let generated:any;
    if(capability==='buyer/produce-finder'){
      const requestedQuantity=Number((payload as any).requiredQuantity);const requestedLocation=String((payload as any).location??'').trim().toLocaleLowerCase();const requestedQuality=String((payload as any).qualityRequirements??'').trim().toLocaleLowerCase();
      const matches=((context.marketplaceCandidates as any[])??[]).map((item:any)=>{const quantityAvailable=item.stock===null||item.stock===undefined||item.stock===''?null:Number.isFinite(Number(item.stock))?Number(item.stock):null;const enough=quantityAvailable!==null&&quantityAvailable>=requestedQuantity;const sameLocation=requestedLocation&&String(item.county??'').trim().toLocaleLowerCase()===requestedLocation;const sameQuality=requestedQuality&&String(item.qualityGrade??'').trim().toLocaleLowerCase()===requestedQuality;const reasons=[enough?'Listing stock covers the requested quantity.':quantityAvailable===null?'Available quantity is not recorded.':'Listing stock is below the requested quantity.',sameLocation?'Listing county matches the requested location.':null,sameQuality?'Quality label matches the requested requirement.':null].filter(Boolean);return{...item,score:{quantityCoverage:quantityAvailable===null?null:Math.min(quantityAvailable/requestedQuantity,1),locationMatch:Boolean(sameLocation),qualityMatch:requestedQuality?Boolean(sameQuality):null},reasons};}).sort((a:any,b:any)=>Number(b.score.quantityCoverage??-1)-Number(a.score.quantityCoverage??-1)||Number(b.score.locationMatch)-Number(a.score.locationMatch)||Number(b.score.qualityMatch??false)-Number(a.score.qualityMatch??false)||(Number(a.price??Number.POSITIVE_INFINITY)-Number(b.price??Number.POSITIVE_INFINITY)));
      const data:any={matches,summary:matches.length?'Listings are ranked using persisted stock, exact location and quality labels where available, and recorded price. No distance is inferred.':'No active marketplace listings currently match this produce.'};
      const explanation=await explainDeterministicResult(capability,safePayload,{...context,deterministicResults:matches},history,role,priorUserMessages,req.user._id);data.explanation=explanation.explanation;data.explanationStatus=explanation.status;
      generated={data,provider:'deterministic',model:'marketplace-ranking',usage:null,latencyMs:0,fallbackAttempts:0,providerAttempts:[]};
    }else if(capability==='farmer/matching-assistant'){
      const matches=(context.deterministicMatches as any[])??[];const data:any={matches,summary:matches.length?'Buyer requests are ranked with the configured deterministic matching weights and available persisted listing/request data. Missing distance is omitted.':'No open buyer requests match this farmer’s available listings.'};
      const explanation=await explainDeterministicResult(capability,safePayload,{deterministicResults:matches.map((item:any)=>({produce:item.produce,quantity:item.quantity,unit:item.unit,score:item.score,scoreCoverage:item.scoreCoverage,factors:item.factors}))},history,role,priorUserMessages,req.user._id);data.explanation=explanation.explanation;data.explanationStatus=explanation.status;
      generated={data,provider:'deterministic',model:'weighted-matching',usage:null,latencyMs:0,fallbackAttempts:0,providerAttempts:[]};
    }else if(capability==='farmer/price-advisor'){
      const prices=verifiedObservations.map((item:any)=>Number(item.price)).filter((price:number)=>Number.isFinite(price)&&price>0);
      if(!prices.length)throw new HttpError(503,'Verified observations do not contain usable prices. No price recommendation was generated.','MARKET_DATA_UNAVAILABLE');
      const explanation=await explainDeterministicResult(capability,safePayload,{verifiedObservations},history,role,priorUserMessages,req.user._id);
      generated={data:{suggestedMinPrice:Math.min(...prices),suggestedMaxPrice:Math.max(...prices),factors:[`Observed range from ${verifiedObservations.length} fresh, verified record(s).`,`Market: ${String((payload as any).location)}. Unit: ${String((payload as any).unit)}.`,`Sources: ${[...new Set(verifiedObservations.map((item:any)=>item.source).filter(Boolean))].join(', ')||'Source unavailable in the observation records.'}.`],aiExplanation:explanation.explanation,explanationStatus:explanation.status,source:'verified AgriLink market observations'},provider:'deterministic',model:'verified-market-observations',usage:null,latencyMs:0,fallbackAttempts:0,providerAttempts:[]};
    }else if(capability==='shared/market-advisor'){
      const explanation=await explainDeterministicResult(capability,safePayload,{verifiedObservations},history,role,priorUserMessages,req.user._id);
      generated={data:{summary:`${verifiedObservations.length} verified market observation(s) within the selected ${String((payload as any).timePeriod)} window match ${String((payload as any).produce)} at ${String((payload as any).location)}. This count is source-backed; it is not a forecast.`,aiInterpretation:explanation.explanation,explanationStatus:explanation.status,verifiedObservationCount:verifiedObservations.length,source:'verified AgriLink market observations'},provider:'deterministic',model:'verified-market-observations',usage:null,latencyMs:0,fallbackAttempts:0,providerAttempts:[]};
    }else generated=await generateAi(capability as any,{...safePayload,authoritativeContext:context},history,role,priorUserMessages);
    if(['shared/recommendations-center','buyer/supplier-advisor'].includes(capability)){const candidates=(context.marketplaceCandidates as any[])??[];const ids=new Set(candidates.map((item:any)=>String(item.id)));const collection=Array.isArray((generated.data as any).matches)?(generated.data as any).matches:Array.isArray((generated.data as any).items)?(generated.data as any).items:Array.isArray((generated.data as any).suppliers)?(generated.data as any).suppliers:[];const key=capability==='buyer/supplier-advisor'?'suppliers':'items';(generated.data as any)[key]=collection.filter((match:any)=>ids.has(String(match?.productId??match?.id??''))).map((match:any)=>{const actual=candidates.find((candidate:any)=>String(candidate.id)===String(match?.productId??match?.id));return{...actual,reason:typeof match.reason==='string'?match.reason.slice(0,500):undefined};});}
    conversation=conversation??await AiConversation.create({user:req.user._id,capability,title:String((payload as any).message??(payload as any).produce??capability).slice(0,120),createdAt:new Date(),updatedAt:new Date()});
    await AiMessage.create([{conversation:conversation._id,role:'user',content:JSON.stringify(safePayload).slice(0,30000),createdAt:new Date()},{conversation:conversation._id,role:'assistant',content:JSON.stringify(generated.data).slice(0,50000),createdAt:new Date()}]);conversation.updatedAt=new Date();await conversation.save();
    await AiUsage.create({user:req.user._id,capability,status:'success',model:generated.model,provider:generated.provider,usage:generated.usage,latencyMs:generated.latencyMs,fallbackAttempts:generated.fallbackAttempts,providerAttempts:generated.providerAttempts??[],createdAt:new Date()});
    return sendData(res,{capability,data:generated.data,conversationId:String(conversation._id),meta:{provider:generated.provider,model:generated.model,usage:generated.usage,latencyMs:generated.latencyMs,fallbackAttempts:generated.fallbackAttempts}});
  }catch(error){const details=error instanceof HttpError&&error.details&&typeof error.details==='object'?error.details as Record<string,unknown>:{};await AiUsage.create({user:req.user._id,capability,status:'failed',provider:details.provider,latencyMs:details.latencyMs,errorCategory:details.category??(error instanceof HttpError?error.code:'internal'),fallbackAttempts:details.fallbackAttempts??0,providerAttempts:details.providerAttempts??[],createdAt:new Date()});throw error;}
}
aiRouter.post('/assistant',requireAuth,async(req,res)=>runCapability('shared/agricultural-assistant',req,res));
aiRouter.post('/:scope/:name',requireAuth,async(req,res)=>runCapability(`${req.params.scope}/${req.params.name}`,req,res));
aiRouter.post('/:capability',requireAuth,async(req,res)=>runCapability(String(req.params.capability),req,res));
aiRouter.get('/conversations',requireAuth,async(req,res)=>{const rows=await AiConversation.find({user:req.user._id}).sort({updatedAt:-1}).limit(50);return sendData(res,{conversations:rows.map((c:any)=>({id:String(c._id),capability:c.capability,title:c.title,updatedAt:c.updatedAt}))});});
aiRouter.get('/conversations/:id',requireAuth,async(req,res)=>{const id=objectId(req.params.id);const c=await AiConversation.findOne({_id:id,user:req.user._id});if(!c)throw new HttpError(404,'AI conversation not found.','AI_CONVERSATION_NOT_FOUND');const rows=await AiMessage.find({conversation:id}).sort({createdAt:1}).limit(100);return sendData(res,{conversation:{id:String(c._id),capability:c.capability,title:c.title},messages:rows.map((m:any)=>({role:m.role,content:m.content,createdAt:m.createdAt}))});});

export const adminAiRouter=Router();
adminAiRouter.get('/providers',requirePermission('ai.read'),async(_req,res)=>sendData(res,providerAdminView(await readAiGatewayConfig())));
adminAiRouter.put('/providers/:id',requirePermission('ai.configure'),async(req,res)=>{
  const id=String(req.params.id) as AiProviderId;
  if(!AI_PROVIDER_IDS.includes(id))throw new HttpError(404,'AI provider not found.','AI_PROVIDER_NOT_FOUND');
  const result=await saveProviderConfiguration(id,req.body as Record<string,unknown>,req.user._id);
  await writeAudit({actor:req.user._id,action:'ai.provider_configured',resource:'ai-provider',resourceId:id,metadata:{provider:id,enabled:(req.body as any)?.enabled===true,model:(req.body as any)?.model,priority:(req.body as any)?.priority,credentialReplaced:Boolean((req.body as any)?.apiKey)}});
  return sendData(res,result);
});
adminAiRouter.delete('/providers/:id',requirePermission('ai.configure'),async(req,res)=>{const id=String(req.params.id) as AiProviderId;const result=await removeProviderConfiguration(id);await writeAudit({actor:req.user._id,action:'ai.provider_configuration_removed',resource:'ai-provider',resourceId:id,metadata:{provider:id}});return sendData(res,result);});
adminAiRouter.get('/capabilities',requirePermission('ai.read'),async(_req,res)=>sendData(res,providerAdminView(await readAiGatewayConfig())));
adminAiRouter.put('/capabilities',requirePermission('ai.configure'),async(req,res)=>{const result=await saveCapabilityRouting(req.body as {capabilityRouting:unknown;maxFallbackAttempts:unknown;requestDeadlineMs:unknown});await writeAudit({actor:req.user._id,action:'ai.capability_routing_configured',resource:'ai-capabilities',metadata:{count:Array.isArray((req.body as any)?.capabilityRouting)?(req.body as any).capabilityRouting.length:12}});return sendData(res,result);});
adminAiRouter.post('/providers/:id/diagnostics/connectivity',requirePermission('ai.configure'),async(req,res)=>{
  const id=String(req.params.id) as AiProviderId;
  const result=await runProviderConnectivityDiagnostic(id);
  const authenticated='authenticated' in result?result.authenticated:null;
  const modelAvailable='modelAvailable' in result?result.modelAvailable:null;
  await writeAudit({
    actor:req.user._id,action:'ai.provider_connectivity_diagnostic',resource:'ai-provider',resourceId:id,
    outcome:id==='nvidia'?(result.reachable&&authenticated===true&&modelAvailable===true?'success':'failure'):(result.reachable?'success':'failure'),
    metadata:{provider:id,reachable:result.reachable,authenticated,modelAvailable,latencyMs:result.latencyMs,errorCategory:result.errorCategory},
  });
  return sendData(res,result);
});
adminAiRouter.post('/providers/:id/diagnostics/inference',requirePermission('ai.configure'),async(req,res)=>{const id=String(req.params.id) as AiProviderId;const body=parseBody(z.object({capability:z.enum(AI_CAPABILITIES).optional()}).strict(),req.body);try{const result=await runProviderInferenceDiagnostic(id,req.user._id,body.capability);await writeAudit({actor:req.user._id,action:'ai.provider_inference_diagnostic',resource:'ai-provider',resourceId:id,outcome:'success',metadata:{provider:id,capability:body.capability??'shared/agricultural-assistant',model:result.requestedModel,latencyMs:result.latencyMs}});return sendData(res,result);}catch(error){await writeAudit({actor:req.user._id,action:'ai.provider_inference_diagnostic',resource:'ai-provider',resourceId:id,outcome:'failure',metadata:{provider:id,capability:body.capability??'shared/agricultural-assistant',errorCategory:error instanceof HttpError?error.code:'provider_error'}});throw error;}});

// Backward-compatible NVIDIA settings contract. Updates are translated into
// the canonical gateway record and never replace the whole shared setting.
adminAiRouter.get('/config',requirePermission('ai.read'),async(_req,res)=>{const config=await loadAiConfig();return sendData(res,{...providerAdminView(await readAiGatewayConfig()),enabled:config.enabled,baseUrl:config.baseUrl,model:config.model,capabilityModels:config.capabilityModels,apiKeyMasked:maskSecret(config.apiKey),hasApiKey:Boolean(config.apiKey),source:config.source,timeoutMs:config.timeoutMs,temperature:config.temperature,topP:config.topP,maxTokens:config.maxTokens,capabilities:AI_CAPABILITIES});});
adminAiRouter.put('/config',requirePermission('ai.configure'),async(req,res)=>{
  const body=parseBody(z.object({baseUrl:z.string().url(),model:z.string().trim().min(2).max(160),capabilityModels:capabilityModelSchema.optional(),apiKey:z.string().max(500).optional(),timeoutMs:z.coerce.number().int().min(1000).max(120000).optional(),temperature:z.coerce.number().min(0).max(2).optional(),topP:z.coerce.number().min(0).max(1).optional(),maxTokens:z.coerce.number().int().min(1).max(8192).optional(),enabled:z.boolean().optional()}),req.body);
  const current=await readAiGatewayConfig();const nvidia=current.providers.nvidia;
  const saved=await saveProviderConfiguration('nvidia',{enabled:body.enabled??true,baseUrl:body.baseUrl,model:body.model,apiKey:body.apiKey,priority:nvidia.priority,isPrimary:current.primaryProvider==='nvidia'||!current.primaryProvider,fallbackEligible:nvidia.fallbackEligible,timeoutMs:body.timeoutMs??nvidia.timeoutMs,temperature:body.temperature??nvidia.temperature,topP:body.topP??nvidia.topP,maxTokens:body.maxTokens??nvidia.maxTokens,capabilities:AI_CAPABILITIES},req.user._id);
  const existing:any=await Setting.findOne({scope:'ai.provider'});const legacyModels={...(existing?.value?.capabilityModels??{}),...(body.capabilityModels??{})};
  await Setting.updateOne({scope:'ai.provider'},{$set:{'value.capabilityModels':legacyModels,'value.updatedAt':new Date(),'value.updatedBy':String(req.user._id)}},{upsert:true});
  if(body.capabilityModels){const currentRoutes=current.capabilityRouting;for(const capability of AI_CAPABILITIES){const route=currentRoutes[capability];route.preferredProvider='nvidia';route.preferredModel=body.capabilityModels[capability]??null;}await saveCapabilityRouting({capabilityRouting:currentRoutes,maxFallbackAttempts:current.maxFallbackAttempts,requestDeadlineMs:current.requestDeadlineMs});}
  await writeAudit({actor:req.user._id,action:'ai.provider_configured',resource:'ai-provider',metadata:{provider:'nvidia',model:body.model,enabled:body.enabled!==false,credentialReplaced:Boolean(body.apiKey)}});
  const result=await loadAiConfig();return sendData(res,{...saved,enabled:result.enabled,baseUrl:result.baseUrl,model:result.model,capabilityModels:result.capabilityModels,apiKeyMasked:maskSecret(result.apiKey),hasApiKey:Boolean(result.apiKey),source:result.source,timeoutMs:result.timeoutMs,temperature:result.temperature,topP:result.topP,maxTokens:result.maxTokens});
});
adminAiRouter.post('/diagnostics',requirePermission('ai.configure'),async(req,res)=>{
  try{
    const result=await runProviderInferenceDiagnostic('nvidia',req.user._id);
    await writeAudit({actor:req.user._id,action:'ai.provider_inference_diagnostic',resource:'ai-provider',resourceId:'nvidia',outcome:'success',metadata:{provider:'nvidia',model:result.model,latencyMs:result.latencyMs,legacyRoute:true}});
    return sendData(res,{...result,available:result.inferenceSucceeded,responseValidated:result.inferenceSucceeded,provider:'nvidia'});
  }catch(error){
    await writeAudit({actor:req.user._id,action:'ai.provider_inference_diagnostic',resource:'ai-provider',resourceId:'nvidia',outcome:'failure',metadata:{provider:'nvidia',errorCategory:error instanceof HttpError?error.code:'provider_error',legacyRoute:true}});
    throw error;
  }
});
function usageAggregation(field:'capability'|'provider'){
  return [
    ...(field==='provider'?[{$match:{provider:{$exists:true,$nin:['deterministic',null,'']}}}]:[]),
    {$group:{
      _id:`$${field}`,
      requests:{$sum:1},
      failures:{$sum:{$cond:[{$eq:['$status','failed']},1,0]}},
      fallbackRequests:{$sum:{$cond:[{$gt:[{$ifNull:['$fallbackAttempts',0]},0]},1,0]}},
      fallbackAttempts:{$sum:{$ifNull:['$fallbackAttempts',0]}},
      latencyMs:{$avg:'$latencyMs'},
      inputTokens:{$sum:{$cond:[{$isNumber:'$usage.inputTokens'},'$usage.inputTokens',0]}},
      inputTokenReports:{$sum:{$cond:[{$isNumber:'$usage.inputTokens'},1,0]}},
      outputTokens:{$sum:{$cond:[{$isNumber:'$usage.outputTokens'},'$usage.outputTokens',0]}},
      outputTokenReports:{$sum:{$cond:[{$isNumber:'$usage.outputTokens'},1,0]}},
    }},
  ];
}
function usageSummary(row:any){
  return {
    requests:row.requests,
    failures:row.failures,
    fallbackRequests:row.fallbackRequests??0,
    fallbackAttempts:row.fallbackAttempts??0,
    averageLatencyMs:Number.isFinite(row.latencyMs)?Math.round(row.latencyMs):null,
    inputTokens:row.inputTokenReports>0?row.inputTokens:null,
    outputTokens:row.outputTokenReports>0?row.outputTokens:null,
  };
}
adminAiRouter.get('/usage',requirePermission('ai.read'),async(_req,res)=>{
  const [total,failed,byCapability,byProvider,recentRows]=await Promise.all([
    AiUsage.countDocuments({}),
    AiUsage.countDocuments({status:'failed'}),
    AiUsage.aggregate(usageAggregation('capability')),
    AiUsage.aggregate(usageAggregation('provider')),
    AiUsage.find({$or:[{status:'failed'},{fallbackAttempts:{$gt:0}},{providerAttempts:{$elemMatch:{status:'failed'}}}]})
      .sort({createdAt:-1}).limit(30).select('capability provider status errorCategory fallbackAttempts providerAttempts latencyMs createdAt operation').lean(),
  ]);
  const recentProviderEvents=(recentRows as any[]).flatMap((row:any)=>{
    const attempts=Array.isArray(row.providerAttempts)?row.providerAttempts:[];
    if(!attempts.length)return[{type:'request_failure',capability:row.capability??null,provider:row.provider??null,status:row.status,errorCategory:row.errorCategory??null,latencyMs:row.latencyMs??null,createdAt:row.createdAt??null}];
    return attempts.flatMap((attempt:any,index:number)=>attempt?.status==='failed'||index>0? [{
      type:index>0?(attempt?.status==='failed'?'fallback_failure':'fallback_success'):'provider_failure',capability:row.capability??null,
      provider:attempt?.provider??null,status:attempt?.status??null,errorCategory:attempt?.errorCategory??null,
      latencyMs:attempt?.latencyMs??row.latencyMs??null,createdAt:row.createdAt??null,
    }]:[]);
  }).slice(0,50);
  return sendData(res,{
    totalRequests:total,
    failedRequests:failed,
    byCapability:byCapability.filter((row:any)=>row._id).map((row:any)=>({capability:row._id,...usageSummary(row)})),
    byProvider:byProvider.filter((row:any)=>row._id).map((row:any)=>({provider:row._id,...usageSummary(row)})),
    recentProviderEvents,
  });
});

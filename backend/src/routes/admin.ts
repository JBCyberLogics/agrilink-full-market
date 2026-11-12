import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth, requirePermission, requirePermissions, revokeUserSessions } from '../common/auth.js';
import { writeAudit } from '../common/audit.js';
import { normalizeMatchingWeights, scoreMatch } from '../common/algorithms.js';
import { ALL_ADMIN_PERMISSIONS, displayUser, normalizeRole, permissionsForUser } from '../common/identity.js';
import { HttpError, sendData, sendList } from '../common/http.js';
import { objectId, pagination, parseBody } from '../common/validation.js';
import { AdminRole, AuditLog, ContactMessage, MarketPrice, Order, Payment, Product, Report, Setting, User } from '../database/models.js';
import { productToApi } from '../services/marketplace.js';

export const adminUsersRouter=Router();
adminUsersRouter.get('/administrators',requirePermission('administrators.manage'),async(_req,res)=>{const rows=await User.find({role:{$in:['admin','super_admin']},isDeleted:{$ne:true}});return sendData(res,{administrators:rows.map((u:any)=>({...displayUser(u),adminRoleId:u.adminRoleId?String(u.adminRoleId):null,isActive:u.isActive!==false}))});});
adminUsersRouter.post('/roles',requirePermission('administrators.manage'),async(req,res)=>{const body=parseBody(z.object({name:z.string().trim().min(2).max(80),permissions:z.array(z.enum(ALL_ADMIN_PERMISSIONS)).max(ALL_ADMIN_PERMISSIONS.length)}),req.body);const role=await AdminRole.create({...body,isActive:true,createdAt:new Date(),updatedAt:new Date()});await writeAudit({actor:req.user._id,action:'admin_role.created',resource:'admin-role',resourceId:String(role._id),metadata:{name:body.name,permissions:body.permissions}});return sendData(res,{id:String(role._id),name:role.name,permissions:role.permissions,isActive:true},201);});
adminUsersRouter.get('/roles',requirePermission('administrators.manage'),async(_req,res)=>{const custom=await AdminRole.find({}).sort({name:1});return sendData(res,{permissions:ALL_ADMIN_PERMISSIONS,builtIn:[{name:'Administrator',role:'admin'},{name:'Super administrator',role:'super_admin'}],roles:custom.map((r:any)=>({id:String(r._id),name:r.name,permissions:r.permissions,isActive:r.isActive!==false}))});});
adminUsersRouter.patch('/roles/:id',requirePermission('administrators.manage'),async(req,res)=>{const id=objectId(req.params.id);const body=parseBody(z.object({name:z.string().trim().min(2).max(80).optional(),permissions:z.array(z.enum(ALL_ADMIN_PERMISSIONS)).max(ALL_ADMIN_PERMISSIONS.length).optional(),isActive:z.boolean().optional()}),req.body);const role=await AdminRole.findByIdAndUpdate(id,{$set:{...body,updatedAt:new Date()}},{returnDocument:'after'});if(!role)throw new HttpError(404,'Administrator role not found.','ADMIN_ROLE_NOT_FOUND');await writeAudit({actor:req.user._id,action:'admin_role.updated',resource:'admin-role',resourceId:String(id),metadata:{fields:Object.keys(body)}});return sendData(res,{id:String(role._id),name:role.name,permissions:role.permissions,isActive:role.isActive!==false});});
adminUsersRouter.patch('/administrators/:id/role',requirePermission('administrators.manage'),async(req,res)=>{const id=objectId(req.params.id);if(String(id)===String(req.user._id))throw new HttpError(409,'You cannot change your own administrator role.','SELF_ROLE_CHANGE_BLOCKED');const roleId=objectId(parseBody(z.object({roleId:z.string()}),req.body).roleId,'roleId');const role=await AdminRole.findOne({_id:roleId,isActive:true});if(!role)throw new HttpError(404,'Administrator role not found.','ADMIN_ROLE_NOT_FOUND');const user=await User.findOneAndUpdate({_id:id,role:{$in:['admin','super_admin']}},{$set:{adminRoleId:roleId,updatedAt:new Date()},$inc:{refreshTokenVersion:1}},{returnDocument:'after'});if(!user)throw new HttpError(404,'Administrator not found.','ADMIN_NOT_FOUND');await writeAudit({actor:req.user._id,action:'administrator.role_assigned',resource:'user',resourceId:String(id),metadata:{roleId:String(roleId)}});return sendData(res,{user:displayUser(user),adminRole:{id:String(role._id),name:role.name}});});
adminUsersRouter.patch('/administrators/:id/status',requirePermission('administrators.manage'),async(req,res)=>{
  const id=objectId(req.params.id);
  if(String(id)===String(req.user._id))throw new HttpError(409,'You cannot suspend your own administrator account.','SELF_SUSPENSION_BLOCKED');
  const body=parseBody(z.object({isActive:z.boolean(),reason:z.string().trim().min(5).max(500)}),req.body);
  const session=await (await import('mongoose')).default.startSession();
  let changed=false;
  try{await session.withTransaction(async()=>{
    const target=await User.findOne({_id:id,role:{$in:['admin','super_admin']},isDeleted:{$ne:true}}).select('+refreshTokenVersion').session(session);
    if(!target)throw new HttpError(404,'Administrator not found.','ADMIN_NOT_FOUND');
    if(normalizeRole(target.role)==='super_admin'&&normalizeRole(req.user.role)!=='super_admin')throw new HttpError(403,'Only a super administrator can change a super administrator account.','SUPER_ADMIN_STATUS_FORBIDDEN');
    if(!body.isActive&&normalizeRole(target.role)==='super_admin'&&target.isActive!==false){
      const activeSuperAdmins=await User.countDocuments({role:'super_admin',isActive:{$ne:false},isDeleted:{$ne:true}}).session(session);
      if(activeSuperAdmins<=1)throw new HttpError(409,'The last active super administrator cannot be suspended.','LAST_SUPER_ADMIN');
    }
    changed=target.isActive!==body.isActive;
    if(changed){target.isActive=body.isActive;target.updatedAt=new Date();target.refreshTokenVersion=Number(target.refreshTokenVersion??0)+1;await target.save({session});}
  });}finally{await session.endSession();}
  if(changed&&!body.isActive)await revokeUserSessions(id);
  const target=await User.findById(id).select('isActive');
  await writeAudit({actor:req.user._id,action:body.isActive?'administrator.reactivated':'administrator.suspended',resource:'user',resourceId:String(id),metadata:{reason:body.reason,changed}});
  return sendData(res,{id:String(id),isActive:target?.isActive!==false,changed});
});

export const adminMarketplaceRouter=Router();
adminMarketplaceRouter.get('/products',requirePermission('marketplace.read'),async(req,res)=>{
  const{page,limit,skip}=pagination(req.query as Record<string,unknown>);
  const query=parseBody(z.object({status:z.enum(['active','suspended','rejected','archived']).optional(),search:z.string().trim().max(80).optional()}),req.query);
  const filter:any={};if(query.status)filter.status=query.status;if(query.search)filter.name={$regex:query.search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),$options:'i'};
  const[rows,total]=await Promise.all([Product.find(filter).sort({createdAt:-1}).skip(skip).limit(limit),Product.countDocuments(filter)]);
  return sendList(res,await Promise.all(rows.map(productToApi)),page,limit,total);
});
adminMarketplaceRouter.get('/products/:id/details',requirePermission('marketplace.read'),async(req,res)=>{
  const id=objectId(req.params.id);
  const product:any=await Product.findById(id).lean();
  if(!product||product.isDeleted===true)throw new HttpError(404,'Listing not found.','PRODUCT_NOT_FOUND');
  const sellerId=product.farmer??product.sellerId??product.seller??product.user;
  const [seller,history]=await Promise.all([
    sellerId?User.findById(sellerId).select('email fullName firstName lastName role isActive isEmailVerified isVerified verificationStatus phone county createdAt image'):null,
    AuditLog.find({resource:'product',resourceId:String(id),action:'product.moderated'}).sort({createdAt:-1}).limit(50).lean(),
  ]);
  const actorIds=history.map((entry:any)=>entry.actor).filter(Boolean);
  const actors=actorIds.length?await User.find({_id:{$in:actorIds}}).select('email fullName firstName lastName role isActive isEmailVerified isVerified verificationStatus phone county createdAt image'):[];
  const actorMap=new Map(actors.map((actor:any)=>[String(actor._id),displayUser(actor)]));
  return sendData(res,{
    listing:await productToApi(product),
    seller:seller?displayUser(seller):sellerId?{id:String(sellerId),name:null}:null,
    moderation:{reason:product.moderationReason??null,moderatedAt:product.moderatedAt??null,moderatedBy:product.moderatedBy?actorMap.get(String(product.moderatedBy))??null:null,history:history.map((entry:any)=>({id:String(entry._id),status:entry.metadata?.status??null,reason:entry.metadata?.reason??null,createdAt:entry.createdAt??null,actor:actorMap.get(String(entry.actor))??null}))},
  });
});
adminMarketplaceRouter.patch('/products/:id/moderation',requirePermission('marketplace.manage'),async(req,res)=>{const id=objectId(req.params.id);const body=parseBody(z.object({status:z.enum(['active','suspended','rejected','archived']),reason:z.string().trim().min(5).max(500)}),req.body);const update:any={status:body.status,moderationReason:body.reason,moderatedBy:req.user._id,moderatedAt:new Date(),updatedAt:new Date()};if(body.status!=='active'){update.isAvailable=false;update.isAvailableForSale=false;}else{update.isAvailable=true;update.isAvailableForSale=true;}const product=await Product.findByIdAndUpdate(id,{$set:update},{returnDocument:'after'});if(!product)throw new HttpError(404,'Listing not found.','PRODUCT_NOT_FOUND');await writeAudit({actor:req.user._id,action:'product.moderated',resource:'product',resourceId:String(id),metadata:{status:body.status,reason:body.reason}});return sendData(res,await productToApi(product));});

export const adminFinanceRouter=Router();
adminFinanceRouter.get('/ledger',requirePermissions('orders.read','payments.read'),async(req,res)=>{
  const {page,limit,skip}=pagination(req.query as Record<string,unknown>);
  const query=parseBody(z.object({
    status:z.string().trim().min(1).max(40).optional(),
    type:z.enum(['all','order','payment']).default('all'),
    search:z.string().trim().max(100).optional(),
    from:z.iso.date().optional(),
    to:z.iso.date().optional(),
  }),req.query);
  if(query.from&&query.to&&query.from>query.to)throw new HttpError(422,'The start date must be on or before the end date.','INVALID_DATE_RANGE');
  const escaped=query.search?.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const searchRegex=escaped?new RegExp(escaped,'i'):null;
  const dateEnd=query.to?new Date(`${query.to}T00:00:00.000Z`):new Date();if(query.to)dateEnd.setUTCDate(dateEnd.getUTCDate()+1);
  const dateRange=query.from||query.to?{$gte:query.from?new Date(`${query.from}T00:00:00.000Z`):new Date(0),$lt:dateEnd}:null;
  const orderFilter:any={};const paymentFilter:any={};
  if(query.status){orderFilter.$or=[{status:query.status},{deliveryStage:query.status}];paymentFilter.status=query.status;}
  if(searchRegex){
    const orderSearch:any=[{orderNumber:searchRegex}];const paymentSearch:any=[{transactionId:searchRegex},{checkoutRequestID:searchRegex},{provider:searchRegex},{method:searchRegex}];
    if(/^[a-f\d]{24}$/i.test(query.search??'')){orderSearch.push({_id:objectId(query.search)});paymentSearch.push({_id:objectId(query.search)});}
    orderFilter.$and=[...(orderFilter.$or?[{$or:orderFilter.$or}]:[]),{$or:orderSearch}];delete orderFilter.$or;
    paymentFilter.$or=paymentSearch;
  }
  if(dateRange){
    orderFilter.$and=[...(orderFilter.$and??[]),{$or:[{createdAt:dateRange},{createdAt:{$exists:false},orderDate:dateRange}]}];
    paymentFilter.createdAt=dateRange;
  }
  const includeOrders=query.type!=='payment';const includePayments=query.type!=='order';
  const [orderTotal,paymentTotal]=await Promise.all([
    includeOrders?Order.countDocuments(orderFilter):0,
    includePayments?Payment.countDocuments(paymentFilter):0,
  ]);
  const orderPipeline:any[]=[
    {$match:orderFilter},
    {$project:{_id:0,id:{$toString:'$_id'},recordType:{$literal:'order'},transactionId:{$ifNull:['$orderNumber',{$toString:'$_id'}]},orderId:{$toString:'$_id'},provider:{$literal:'Order'},amount:{$cond:[{$isNumber:'$totalCents'},{$divide:['$totalCents',100]},{$cond:[{$isNumber:'$totalAmount'},'$totalAmount',null]}]},currency:{$ifNull:['$currency',null]},status:{$ifNull:['$status',{$ifNull:['$deliveryStage','unknown']}]},createdAt:{$ifNull:['$createdAt','$orderDate']}}},
  ];
  const paymentPipeline:any[]=[
    {$match:paymentFilter},
    {$project:{_id:0,id:{$toString:'$_id'},recordType:{$literal:'payment'},transactionId:{$ifNull:['$transactionId',{$ifNull:['$checkoutRequestID',{$toString:'$_id'}]}]},orderId:{$cond:[{$ifNull:['$order','$orderId']},{$toString:{$ifNull:['$order','$orderId']}},null]},provider:{$ifNull:['$provider',{$ifNull:['$method',null]}]},amount:{$cond:[{$isNumber:'$amountCents'},{$divide:['$amountCents',100]},{$cond:[{$isNumber:'$amount'},'$amount',null]}]},currency:{$ifNull:['$currency',null]},status:{$ifNull:['$status','unknown']},createdAt:{$ifNull:['$createdAt',null]}}},
  ];
  let items:any[];
  if(includeOrders&&includePayments){
    items=await Order.aggregate([...orderPipeline,{$unionWith:{coll:'payments',pipeline:paymentPipeline}},{$sort:{createdAt:-1,id:-1}},{$skip:skip},{$limit:limit}]);
  }else if(includeOrders){
    items=await Order.aggregate([...orderPipeline,{$sort:{createdAt:-1,id:-1}},{$skip:skip},{$limit:limit}]);
  }else{
    items=await Payment.aggregate([...paymentPipeline,{$sort:{createdAt:-1,id:-1}},{$skip:skip},{$limit:limit}]);
  }
  return sendList(res,items,page,limit,orderTotal+paymentTotal);
});
adminFinanceRouter.get('/ledger/:type/:id',requireAdmin,async(req,res)=>{
  const type=z.enum(['order','payment']).parse(req.params.type);
  const id=objectId(req.params.id);
  const permissions=await permissionsForUser(req.user);
  const required=type==='order'?'orders.read':'payments.read';
  if(!permissions.includes(required))throw new HttpError(403,'You do not have permission to inspect this financial record.','FORBIDDEN');
  if(type==='order'){
    const order:any=await Order.findById(id).lean();
    if(!order)throw new HttpError(404,'Order not found.','ORDER_NOT_FOUND');
    const buyerId=order.buyer??order.customerId;const farmerId=order.farmer??order.sellerId;
    const rawItems=Array.isArray(order.items)?order.items:[];
    const productIds=rawItems.map((item:any)=>item.product??item.productId).filter((value:any)=>value&&/^[a-f\d]{24}$/i.test(String(value)));
    const [buyer,farmer,products,payments]=await Promise.all([
      buyerId?User.findById(buyerId):null,farmerId?User.findById(farmerId):null,
      productIds.length?Product.find({_id:{$in:productIds}}).select('name unit measurementUnit').lean():[],
      Payment.find({$or:[{order:id},{orderId:id}]}).sort({createdAt:-1}).lean(),
    ]);
    const productMap=new Map(products.map((product:any)=>[String(product._id),product]));
    const items=rawItems.map((item:any)=>{
      const productId=item.product??item.productId;const product=productMap.get(String(productId));
      const unitPriceCents=Number.isFinite(item.unitPriceCents)?Number(item.unitPriceCents):Number.isFinite(item.priceCents)?Number(item.priceCents):null;
      const quantity=Number.isFinite(Number(item.quantity))?Number(item.quantity):null;
      const subtotalCents=Number.isFinite(item.subtotalCents)?Number(item.subtotalCents):unitPriceCents!==null&&quantity!==null?unitPriceCents*quantity:null;
      return{productId:productId?String(productId):null,name:item.name??product?.name??null,quantity,unit:item.unit??product?.unit??product?.measurementUnit??null,unitPriceCents,subtotalCents};
    });
    return sendData(res,{type:'order',id:String(order._id),orderNumber:order.orderNumber??String(order._id),status:order.status??order.deliveryStage??'unknown',paymentStatus:order.paymentStatus??'unknown',currency:order.currency??null,subtotalCents:Number.isFinite(order.subtotalCents)?order.subtotalCents:null,deliveryFeeCents:Number.isFinite(order.deliveryFeeCents)?order.deliveryFeeCents:null,totalCents:Number.isFinite(order.totalCents)?order.totalCents:Number.isFinite(order.totalAmount)?Math.round(order.totalAmount*100):null,createdAt:order.createdAt??order.orderDate??null,buyer:buyer?displayUser(buyer):buyerId?{id:String(buyerId),name:null}:null,farmer:farmer?displayUser(farmer):farmerId?{id:String(farmerId),name:null}:null,items,payments:payments.map((payment:any)=>({id:String(payment._id),provider:payment.provider??payment.method??null,reference:payment.transactionId??payment.checkoutRequestID??payment.paypalOrderId??null,status:payment.status??'unknown',amountCents:Number.isFinite(payment.amountCents)?payment.amountCents:Number.isFinite(payment.amount)?Math.round(payment.amount*100):null,currency:payment.currency??null,createdAt:payment.createdAt??null,updatedAt:payment.updatedAt??null}))});
  }
  const payment:any=await Payment.findById(id).lean();
  if(!payment)throw new HttpError(404,'Payment not found.','PAYMENT_NOT_FOUND');
  const orderId=payment.order??payment.orderId;const payerId=payment.payer??payment.userId;
  const [order,payer]=await Promise.all([orderId?Order.findById(orderId).lean():null,payerId?User.findById(payerId):null]);
  return sendData(res,{type:'payment',id:String(payment._id),provider:payment.provider??payment.method??null,reference:payment.transactionId??payment.checkoutRequestID??payment.paypalOrderId??null,status:payment.status??'unknown',amountCents:Number.isFinite(payment.amountCents)?payment.amountCents:Number.isFinite(payment.amount)?Math.round(payment.amount*100):null,currency:payment.currency??null,createdAt:payment.createdAt??null,updatedAt:payment.updatedAt??null,payer:payer?displayUser(payer):payerId?{id:String(payerId),name:null}:null,order:order?{id:String(order._id),orderNumber:order.orderNumber??String(order._id),status:order.status??order.deliveryStage??'unknown',paymentStatus:order.paymentStatus??'unknown',totalCents:Number.isFinite(order.totalCents)?order.totalCents:null,currency:order.currency??null}:null});
});
adminFinanceRouter.get('/payments',requirePermission('payments.read'),async(req,res)=>{
  const{page,limit,skip}=pagination(req.query as Record<string,unknown>);const filter:any={};if(req.query.status)filter.status=String(req.query.status);
  const[rows,total]=await Promise.all([Payment.find(filter).sort({createdAt:-1}).skip(skip).limit(limit),Payment.countDocuments(filter)]);
  return sendList(res,rows.map((p:any)=>({id:String(p._id),orderId:p.order??p.orderId?String(p.order??p.orderId):null,payerId:p.payer??p.userId?String(p.payer??p.userId):null,provider:p.provider??p.method??null,amountCents:Number.isFinite(p.amountCents)?Number(p.amountCents):Number.isFinite(p.amount)?Math.round(Number(p.amount)*100):null,currency:p.currency??null,status:p.status??'unknown',providerReference:p.transactionId??p.checkoutRequestID??null,createdAt:p.createdAt??null,updatedAt:p.updatedAt??null})),page,limit,total);
});
adminFinanceRouter.get('/transactions',requirePermission('payments.read'),async(req,res)=>{
  const{page,limit,skip}=pagination(req.query as Record<string,unknown>);const[rows,total]=await Promise.all([Payment.find({}).sort({createdAt:-1}).skip(skip).limit(limit),Payment.countDocuments({})]);
  return sendList(res,rows.map((p:any)=>({id:String(p._id),transactionId:p.transactionId??p.checkoutRequestID??null,amount:Number.isFinite(p.amount)?Number(p.amount):Number.isFinite(p.amountCents)?Number(p.amountCents)/100:null,currency:p.currency??null,status:p.status??'unknown',provider:p.provider??p.method??null,createdAt:p.createdAt??null})),page,limit,total);
});
adminFinanceRouter.get('/disputes',requirePermission('support.manage'),async(req,res)=>{const{page,limit,skip}=pagination(req.query as Record<string,unknown>);const[rows,total]=await Promise.all([Report.find({}).sort({createdAt:-1}).skip(skip).limit(limit),Report.countDocuments({})]);return sendList(res,rows.map((r:any)=>({id:String(r._id),type:r.type,reason:r.reason,status:r.status,orderId:r.order?String(r.order):null,reporterId:r.reporter?String(r.reporter):null,createdAt:r.createdAt})),page,limit,total);});
adminFinanceRouter.patch('/disputes/:id',requirePermission('support.manage'),async(req,res)=>{const id=objectId(req.params.id);const body=parseBody(z.object({status:z.enum(['under_review','resolved','rejected']),resolution:z.string().trim().min(5).max(1000)}),req.body);const row=await Report.findByIdAndUpdate(id,{$set:{...body,handledBy:req.user._id,updatedAt:new Date()}},{returnDocument:'after'});if(!row)throw new HttpError(404,'Dispute not found.','DISPUTE_NOT_FOUND');await writeAudit({actor:req.user._id,action:'dispute.updated',resource:'report',resourceId:String(id),metadata:{status:body.status}});return sendData(res,{id:String(row._id),status:row.status});});

export const adminAlgorithmsRouter=Router();
const DEFAULT_MATCHING_WEIGHTS={price:0.35,quality:0.25,distance:0.2,availability:0.2};
async function matchingConfiguration(){const row:any=await Setting.findOne({scope:'algorithm.matching'});const weights=normalizeMatchingWeights(row?.value?.weights??DEFAULT_MATCHING_WEIGHTS);return{weights,version:row?.value?.version??1,method:'weighted-deterministic-score'};}
export const matchingAlgorithmRouter=Router();
matchingAlgorithmRouter.get('/matching',requireAuth,async(_req,res)=>sendData(res,await matchingConfiguration()));
adminAlgorithmsRouter.get('/matching',requirePermission('algorithms.manage'),async(_req,res)=>sendData(res,await matchingConfiguration()));
adminAlgorithmsRouter.put('/matching',requirePermission('algorithms.manage'),async(req,res)=>{const weights=normalizeMatchingWeights(parseBody(z.object({price:z.coerce.number().min(0).max(1),quality:z.coerce.number().min(0).max(1),distance:z.coerce.number().min(0).max(1),availability:z.coerce.number().min(0).max(1)}),req.body));const current:any=await Setting.findOne({scope:'algorithm.matching'});const version=Number(current?.value?.version??0)+1;await Setting.updateOne({scope:'algorithm.matching'},{$set:{scope:'algorithm.matching',value:{weights,version,updatedBy:req.user._id},updatedAt:new Date()},$setOnInsert:{createdAt:new Date()}},{upsert:true});await writeAudit({actor:req.user._id,action:'matching.algorithm_configured',resource:'algorithm',metadata:{weights,version}});return sendData(res,{weights,version});});
adminAlgorithmsRouter.post('/matching/score',requirePermission('algorithms.manage'),async(req,res)=>{const body=parseBody(z.object({price:z.number().min(0).max(1),quality:z.number().min(0).max(1),distance:z.number().min(0).max(1),availability:z.number().min(0).max(1)}),req.body);const current:any=await Setting.findOne({scope:'algorithm.matching'});const weights=normalizeMatchingWeights(current?.value?.weights??{price:0.35,quality:0.25,distance:0.2,availability:0.2});const result=scoreMatch(body,weights);await writeAudit({actor:req.user._id,action:'matching.algorithm_executed',resource:'algorithm',metadata:{version:current?.value?.version??1}});return sendData(res,{...result,version:current?.value?.version??1});});

export const adminAnalyticsRouter=Router();
adminAnalyticsRouter.get('/summary',requirePermission('reports.read'),async(_req,res)=>{
  const query=parseBody(z.object({from:z.iso.date().optional(),to:z.iso.date().optional()}),_req.query);
  const now=new Date();const requestedEnd=query.to?new Date(`${query.to}T00:00:00.000Z`):now;
  const endExclusive=query.to?new Date(requestedEnd.getTime()+86400000):now;
  const periodEnd=new Date(Math.min(endExclusive.getTime(),now.getTime()));
  const periodStart=query.from?new Date(`${query.from}T00:00:00.000Z`):new Date(Math.max(periodEnd.getTime()-30*86400000,0));
  if(!Number.isFinite(periodStart.getTime())||periodStart>=periodEnd||periodEnd.getTime()-periodStart.getTime()>366*86400000)throw new HttpError(422,'Choose a valid reporting period up to 366 days.','INVALID_REPORTING_PERIOD');
  const duration=periodEnd.getTime()-periodStart.getTime();const previousStart=new Date(periodStart.getTime()-duration);
  const paymentPipeline=(from:Date,to:Date)=>Payment.aggregate([
    {$match:{createdAt:{$gte:from,$lt:to},status:{$in:['paid','completed','success']},currency:{$type:'string'},$or:[{amountCents:{$type:'number',$gte:0}},{amount:{$type:'number',$gte:0}}]}},
    {$group:{_id:'$currency',amountCents:{$sum:{$cond:[{$isNumber:'$amountCents'},'$amountCents',{$multiply:['$amount',100]}]}},count:{$sum:1}}},
  ]);
  const ordersFilter={createdAt:{$gte:periodStart,$lt:periodEnd}};
  const[paid,previousPaid,ordersByStatus,orderCount,newUsers]=await Promise.all([
    paymentPipeline(periodStart,periodEnd),paymentPipeline(previousStart,periodStart),
    Order.aggregate([{$match:ordersFilter},{$group:{_id:'$status',count:{$sum:1}}}]),
    Order.countDocuments(ordersFilter),User.countDocuments({createdAt:ordersFilter.createdAt}),
  ]);
  const previousByCurrency=new Map(previousPaid.map((row:any)=>[String(row._id),Number(row.amountCents)]));
  const revenue=paid.map((row:any)=>{const previous=previousByCurrency.get(String(row._id));const amountCents=Number(row.amountCents);return{currency:row._id,amountCents,count:row.count,previousAmountCents:previous??null,changePercent:previous&&previous>0?((amountCents-previous)/previous)*100:null};});
  return sendData(res,{periodStart,periodEnd,previousPeriodStart:previousStart,previousPeriodEnd:periodStart,totalOrders:orderCount,verifiedPayments:revenue,previousVerifiedPayments:previousPaid.map((row:any)=>({currency:row._id,amountCents:Number(row.amountCents),count:row.count})),ordersByStatus:ordersByStatus.map((row:any)=>({status:row._id??'unknown',count:row.count})),newUsers});
});

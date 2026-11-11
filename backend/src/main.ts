import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import swaggerUi from 'swagger-ui-express';
import { getConfig, assertRuntimeConfig } from './config/env.js';
import { connectDatabase, disconnectDatabase, pingDatabase } from './database/connection.js';
import { initializeDatabase } from './database/initialize.js';
import { csrfProtection } from './common/auth.js';
import { errorHandler, HttpError, requestId, sendData } from './common/http.js';
import { authRouter, otpRouter, signupRouter } from './routes/auth.js';
import { usersRouter, profilesRouter, adminPeopleRouter } from './routes/users.js';
import { categoryRouter, favoriteRouter, productRouter, reviewRouter } from './routes/marketplace.js';
import { cartRouter, checkoutRouter, orderRouter, adminOrderRouter } from './routes/commerce.js';
import { adminPurchaseRequestRouter, purchaseRequestRouter } from './routes/requests.js';
import { adminPlatformRouter, marketIntelligenceRouter, messagingRouter, notificationRouter, supportRouter } from './routes/platform.js';
import { aiRouter, adminAiRouter } from './routes/ai.js';
import { adminAlgorithmsRouter, adminAnalyticsRouter, adminFinanceRouter, adminMarketplaceRouter, adminUsersRouter, matchingAlgorithmRouter } from './routes/admin.js';
import { adminPaymentsRouter, paymentRouter } from './routes/payments.js';
import { uploadRouter } from './routes/uploads.js';
import { publicContentRouter, shopRouter } from './routes/shops.js';

export function createApp(){
  const config=getConfig();const app=express();
  if(config.TRUST_PROXY)app.set('trust proxy',config.TRUST_PROXY);
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'},contentSecurityPolicy:{directives:{defaultSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'data:','https:'],scriptSrc:["'self'","'unsafe-inline'"],connectSrc:["'self'",...config.origins]}}}));
  app.use(cors({origin(origin,callback){if(!origin||config.origins.includes(origin))return callback(null,true);return callback(new HttpError(403,'This browser origin is not allowed.','ORIGIN_NOT_ALLOWED'));},credentials:true,methods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','Authorization','X-CSRF-Token','Idempotency-Key','X-Requested-With']}));
  app.use(express.json({limit:'1mb',strict:true}));app.use(express.urlencoded({extended:false,limit:'64kb'}));app.use(cookieParser());
  app.get('/health/live',(_req,res)=>sendData(res,{status:'alive',timestamp:new Date()}));
  app.get('/health/ready',async(_req,res)=>{const connected=await pingDatabase().catch(()=>false);return res.status(connected?200:503).json({success:connected,status:connected?'ready':'not_ready',checks:{database:connected?'available':'unavailable'},timestamp:new Date()});});
  app.get('/api/v1/health/live',(_req,res)=>sendData(res,{status:'alive',timestamp:new Date()}));
  app.get('/api/v1/health/ready',async(_req,res)=>{const database=await pingDatabase().catch(()=>false);let aiConfigured=false;try{const {loadAiConfig}=await import('./services/ai-provider.js');const c=await loadAiConfig();aiConfigured=Boolean(c.enabled&&c.baseUrl&&c.model&&c.apiKey);}catch{}return res.status(database?200:503).json({success:database,status:database?'ready':'not_ready',checks:{database:database?'available':'unavailable',aiProvider:aiConfigured?'configured':'unavailable',payments:{mpesa:Boolean(config.MPESA_CONSUMER_KEY&&config.MPESA_CONSUMER_SECRET),paypal:Boolean(config.PAYPAL_CLIENT_ID&&config.PAYPAL_CLIENT_SECRET)}},timestamp:new Date()});});
  app.use('/api/v1',csrfProtection);
  const authLimiter=rateLimit({windowMs:15*60*1000,limit:40,standardHeaders:true,legacyHeaders:false,message:{success:false,code:'RATE_LIMITED',message:'Too many attempts. Wait before trying again.'}});
  app.use('/api/v1/auth',authLimiter,authRouter);app.use('/api/v1/signup',authLimiter,signupRouter);app.use('/api/v1/otp',authLimiter,otpRouter);
  app.use('/api/v1/users',authLimiter,signupRouter,usersRouter);app.use('/api/v1/user',usersRouter);app.use('/api/v1/profiles',profilesRouter);
  app.use('/api/v1/shops',shopRouter);app.use('/api/v1/shop',shopRouter);app.use('/api/v1',publicContentRouter);
  app.use('/api/v1/product',productRouter);app.use('/api/v1/products',productRouter);app.use('/api/v1/categories',categoryRouter);app.use('/api/v1/category',categoryRouter);app.use('/api/v1/favorite-product',favoriteRouter);app.use('/api/v1/favorites',favoriteRouter);app.use('/api/v1/review',reviewRouter);app.use('/api/v1/reviews',reviewRouter);
  app.use('/api/v1/algorithms',matchingAlgorithmRouter);
  app.use('/api/v1/cart',cartRouter);app.use('/api/v1/checkout',checkoutRouter);app.use('/api/v1/order',orderRouter);app.use('/api/v1/orders',orderRouter);
  app.use('/api/v1/purchase-requests',purchaseRequestRouter);app.use('/api/v1/buyer/purchase-requests',purchaseRequestRouter);
  app.use('/api/v1/notifications',notificationRouter);app.use('/api/v1/notification',notificationRouter);app.use('/api/v1/messages',messagingRouter);app.use('/api/v1/message',messagingRouter);app.use('/api/v1/chat',messagingRouter);app.use('/api/v1/market-intelligence',marketIntelligenceRouter);app.use('/api/v1/marketprices',marketIntelligenceRouter);
  app.use('/api/v1',supportRouter);app.use('/api/v1/ai',aiRouter);app.use('/api/v1/payments',paymentRouter);app.use('/api/v1/upload',uploadRouter);
  app.use('/uploads',express.static(path.resolve(config.uploadDirectory),{fallthrough:false,immutable:true,maxAge:'7d',dotfiles:'deny',index:false}));

  app.use('/api/v1/admin/users',usersRouter);app.use('/api/v1/admin/users',adminPeopleRouter);app.use('/api/v1/admin',adminUsersRouter);app.use('/api/v1/admin',adminPlatformRouter);app.use('/api/v1/admin',adminMarketplaceRouter);app.use('/api/v1/admin',adminFinanceRouter);app.use('/api/v1/admin/orders',adminOrderRouter);app.use('/api/v1/admin/purchase-requests',adminPurchaseRequestRouter);app.use('/api/v1/admin/ai',adminAiRouter);app.use('/api/v1/admin/algorithms',adminAlgorithmsRouter);app.use('/api/v1/admin/analytics',adminAnalyticsRouter);app.use('/api/v1/admin/payments',adminPaymentsRouter);

  app.get('/api/v1/openapi.json',(_req,res)=>res.json(openApi));
  app.use('/api/docs',swaggerUi.serve,swaggerUi.setup(openApi,{explorer:false}));
  app.use((_req,_res,next)=>next(new HttpError(404,'The requested endpoint was not found.','NOT_FOUND')));
  app.use(errorHandler());
  return app;
}

const openApi={openapi:'3.0.3',info:{title:'AgriLink Unified API',version:'1.0.0',description:'Shared API for the AgriLink farmer/buyer portal and AgriLink Control.'},servers:[{url:'/api/v1'}],paths:{
  '/auth/csrf':{get:{summary:'Issue browser CSRF token',responses:{200:{description:'CSRF token set as cookie'}}}},
  '/auth/login':{post:{summary:'Create farmer/buyer browser session',responses:{200:{description:'Authenticated user'}}}},
  '/auth/admin/login':{post:{summary:'Create administrator browser session',responses:{200:{description:'Administrator session'}}}},
  '/auth/logout':{post:{summary:'Invalidate current session',responses:{200:{description:'Session revoked'}}}},
  '/product':{get:{summary:'Search marketplace listings',responses:{200:{description:'Paginated live listings'}}},post:{summary:'Create a farmer listing',responses:{201:{description:'Persisted listing'}}}},
  '/cart':{get:{summary:'Read current buyer cart',responses:{200:{description:'Persisted cart'}}},post:{summary:'Add a listing to the cart',responses:{200:{description:'Updated cart'}}},delete:{summary:'Clear the current buyer cart',responses:{200:{description:'Cart cleared'}}}},
  '/checkout':{post:{summary:'Create orders atomically using an Idempotency-Key',responses:{201:{description:'Persisted orders'}}}},
  '/orders':{get:{summary:'Read caller-owned orders',responses:{200:{description:'Paginated orders'}}}},
  '/algorithms/matching':{get:{summary:'Read the current authenticated marketplace matching weights',responses:{200:{description:'Normalized weights and algorithm version'},401:{description:'Authentication required'}}}},
  '/ai/{capability}':{post:{summary:'Run one of the 12 configured AI capabilities',responses:{200:{description:'Validated AI result'},503:{description:'Provider unavailable'}}}},
  '/admin/ai/config':{get:{summary:'Read masked NVIDIA settings',responses:{200:{description:'Masked provider configuration'}}},put:{summary:'Update encrypted NVIDIA settings',responses:{200:{description:'Saved configuration without raw key'}}}},
  '/health/ready':{get:{summary:'Readiness status',responses:{200:{description:'Service ready'},503:{description:'A dependency is unavailable'}}}},
}};

async function start(){const config=assertRuntimeConfig();await connectDatabase(config.mongoUri!);const database=await initializeDatabase();console.log(JSON.stringify({level:'info',event:'database_initialized',database:database.database,collections:database.collections.length,indexesCreated:database.createdIndexes.length}));const app=createApp();const onListening=()=>console.log(JSON.stringify({level:'info',event:'server_started',port:config.PORT,environment:config.NODE_ENV,api:'/api/v1',host:config.NODE_ENV==='development'?'127.0.0.1':'configured'}));const server=config.NODE_ENV==='development'?app.listen(config.PORT,'127.0.0.1',onListening):app.listen(config.PORT,onListening);const shutdown=async()=>{server.close();await disconnectDatabase();process.exit(0);};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);}
if(import.meta.url===`file://${process.argv[1]}`){start().catch((error)=>{console.error(JSON.stringify({level:'error',event:'startup_failed',message:String(error?.message??'configuration or database unavailable')}));process.exitCode=1;});}

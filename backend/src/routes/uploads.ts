import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';
import { requireAuth } from '../common/auth.js';
import { HttpError, sendData } from '../common/http.js';
import { getConfig } from '../config/env.js';
import { User, Product } from '../database/models.js';

export const uploadRouter=Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:getConfig().MAX_UPLOAD_BYTES,files:1,fields:1}});
uploadRouter.post('/image',requireAuth,upload.single('file'),async(req,res)=>{
  const file=req.file;if(!file)throw new HttpError(422,'Choose an image to upload.','UPLOAD_REQUIRED','file');
  const purpose=String(req.body?.purpose??'product');if(!['product','profile'].includes(purpose))throw new HttpError(422,'Choose a supported image purpose.','UPLOAD_PURPOSE_INVALID','purpose');
  const type=await fileTypeFromBuffer(file.buffer);if(!type||!['image/jpeg','image/png','image/webp'].includes(type.mime))throw new HttpError(415,'Only JPEG, PNG, or WebP images are accepted.','UPLOAD_TYPE_NOT_ALLOWED','file');
  const directory=path.resolve(getConfig().uploadDirectory);await mkdir(directory,{recursive:true,mode:0o750});const name=`${randomUUID()}.${type.ext}`;await writeFile(path.join(directory,name),file.buffer,{flag:'wx',mode:0o640});
  const url=`${getConfig().publicApiUrl}/uploads/${name}`;
  if(purpose==='profile'){
    try{await User.updateOne({_id:req.user._id},{$set:{image:url,updatedAt:new Date()}});}
    catch(error){await unlink(path.join(directory,name)).catch(()=>{});throw error;}
  }
  return sendData(res,{url,imageUrl:url,filename:name,mimeType:type.mime,size:file.size},201);
});
uploadRouter.delete('/image',requireAuth,async(req,res)=>{
  const current=await User.findById(req.user._id);const url=String(current?.image??'');if(!url)throw new HttpError(404,'No profile image is set.','IMAGE_NOT_FOUND');
  const base=getConfig().publicApiUrl;let filename='';try{const parsed=new URL(url);if(base&&parsed.origin===new URL(base).origin)filename=path.basename(parsed.pathname);}catch{}
  if(!filename||!/^([a-f0-9-]{36})\.(jpg|png|webp)$/.test(filename))throw new HttpError(422,'Only profile images stored by AgriLink can be removed here.','IMAGE_NOT_OWNED');
  await User.updateOne({_id:req.user._id},{$unset:{image:''},$set:{updatedAt:new Date()}});
  const referenced=await Product.exists({images:url});if(!referenced)await unlink(path.join(path.resolve(getConfig().uploadDirectory),filename)).catch(()=>{});
  return sendData(res,{removed:true});
});

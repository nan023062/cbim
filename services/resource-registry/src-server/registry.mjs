import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, link, unlink, stat,readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const limit=512*1024*1024;
function fail(status,message){throw Object.assign(new Error(message),{status});}
function json(res,status,value){
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}

async function readMetadata(req){
  let bytes=0;const parts=[];
  for await(const part of req){bytes+=part.length;if(bytes>106496)fail(413,'metadata too large');parts.push(part);}
  if(!bytes)return {};
  let input;try{input=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{fail(400,'invalid metadata');}
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'invalid metadata');
  const metadata={};
  for(const [key,max] of Object.entries({name:100,summary:500,developer:100,preview:1000,changes:1000})){
    if(input[key]===undefined)continue;
    if(typeof input[key]!=='string'||input[key].length>max)fail(400,'invalid '+key);
    metadata[key]=input[key].trim();
  }
  if(input.priceCnyFen!==undefined){
    if(!Number.isSafeInteger(input.priceCnyFen)||input.priceCnyFen<0||input.priceCnyFen>100000000)fail(400,'invalid price');
    metadata.priceCnyFen=input.priceCnyFen;
  }
  if(input.logo!==undefined){
    if(typeof input.logo!=='string'||input.logo.length>98304||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(input.logo))fail(400,'invalid raster logo');
    metadata.logo=input.logo;
  }
  if(Object.keys(input).some(key=>!Object.hasOwn(metadata,key)))fail(400,'unknown metadata');
  return metadata;
}

// Stage the whole upload before making either its blob or its version visible.
async function storeBlob(req,dir,digest){
  if(Number(req.headers['content-length'])>limit)fail(413,'package too large');
  const temp=path.join(dir,randomUUID()+'.part'),file=await open(temp,'wx');
  const hash=createHash('sha256');let size=0;
  try{
    try{
      for await(const chunk of req){
        size+=chunk.length;if(size>limit)fail(413,'package too large');
        hash.update(chunk);await file.writeFile(chunk);
      }
      if(!size || hash.digest('hex')!==digest)fail(422,'package digest mismatch or empty package');
      await file.sync();
    }finally{await file.close();}
    try{await link(temp,path.join(dir,digest));}catch(e){if(e.code!=='EEXIST')throw e;}
    return size;
  }finally{await unlink(temp);}
}
export async function startRegistry({data,token,port=0}){
  if(!token || !token.trim())throw Error('REGISTRY_TOKEN required');
  const blobs=path.join(data,'blobs');await mkdir(blobs,{recursive:true});
  const db=new DatabaseSync(path.join(data,'registry.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS versions(kind TEXT,id TEXT,version TEXT,sha256 TEXT NOT NULL,size INTEGER NOT NULL,published INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(kind,id,version))');
  if(!db.prepare('PRAGMA table_info(versions)').all().some(col=>col.name==='metadata'))db.exec('ALTER TABLE versions ADD COLUMN metadata TEXT');
  const get=db.prepare('SELECT kind,id,version,sha256,size,published,metadata FROM versions WHERE kind=? AND id=? AND version=?');
  const catalog=db.prepare('SELECT kind,id,version,sha256,size,metadata FROM versions WHERE published=1 ORDER BY kind,id,version');
  function describe({metadata,...row}){return metadata?{...row,metadata:JSON.parse(metadata)}:row;}
  async function handle(req,res){
    const {pathname,searchParams}=new URL(req.url,'http://localhost');
    if(req.method==='GET' && pathname==='/v1/engine-index'){
      const file=path.join(data,'signed-engine-index.json');
      const info=await stat(file).catch(e=>{if(e.code==='ENOENT')fail(404,'engine index not provisioned');throw e;});
      if(!info.isFile()||info.size>16*1024*1024)fail(500,'invalid engine index');
      return json(res,200,JSON.parse(await readFile(file,'utf8')));
    }
    if(req.method==='GET' && pathname==='/v1/resources')return json(res,200,catalog.all().map(describe));
    const m=/^\/v1\/resources\/(engine|connector|talent|business)\/([a-z][a-z0-9-]{0,47})\/(\d{1,8}\.\d{1,8}\.\d{1,8})\/(draft|publish|lock|download)$/.exec(pathname);
    if(!m)fail(404,'unknown resource or route');
    const [,kind,id,version,action]=m,key=[kind,id,version];
    if(action==='draft'||action==='publish'){
      if(req.headers.authorization!=='Bearer '+token)fail(401,'publisher authentication required');
      const digest=req.headers['x-content-sha256'];
      if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))fail(400,'expected X-Content-SHA256');
      if(action==='draft' && req.method==='PUT'){
        const size=await storeBlob(req,blobs,digest);
        const inserted=db.prepare('INSERT INTO versions(kind,id,version,sha256,size) VALUES(?,?,?,?,?) ON CONFLICT(kind,id,version) DO NOTHING').run(...key,digest,size);
        const row=get.get(...key);
        if(row.sha256!==digest)fail(409,'version already bound to other content');
        return json(res,inserted.changes?201:200,row);
      }
      if(action==='publish' && req.method==='POST'){
        const fields=await readMetadata(req),metadata=Object.keys(fields).length?JSON.stringify(fields):null;
        const row=get.get(...key);if(!row)fail(404,'no draft');
        if(row.sha256!==digest)fail(409,'draft digest mismatch');
        if(row.published&&metadata!==row.metadata)fail(409,'published metadata is immutable');
        db.prepare('UPDATE versions SET published=1,metadata=? WHERE kind=? AND id=? AND version=?').run(metadata,...key);
        return json(res,200,describe(get.get(...key)));
      }
    }else if(req.method==='GET'){
      const row=get.get(...key);if(!row?.published)fail(404,'version not published');
      if(row.metadata&&JSON.parse(row.metadata).priceCnyFen>0)fail(403,'entitlement required');
      const {sha256,size}=row;
      if(action==='lock')return json(res,200,{kind,id,version,sha256,size,download:pathname.replace(/lock$/,'download')+'?sha256='+sha256});
      if(searchParams.get('sha256')!==sha256)fail(409,'exact locked digest required');
      const file=path.join(blobs,sha256);
      if((await stat(file)).size!==size)fail(500,'invalid blob');
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':size,'ETag':'"'+sha256+'"','X-Content-SHA256':sha256});
      await pipeline(createReadStream(file),res);return;
    }
    fail(405,'method not allowed');
  }
  const server=http.createServer((req,res)=>handle(req,res).catch(e=>{
    if(res.headersSent)res.destroy();else json(res,e.status??500,{error:e.status?e.message:'storage or transfer error'});
  }));
  try{await new Promise((resolve,reject)=>server.once('error',reject).listen(port,'127.0.0.1',resolve));}
  catch(e){db.close();throw e;}
  return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise((resolve,reject)=>server.close(e=>{db.close();e?reject(e):resolve();}))};
}

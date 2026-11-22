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
  const get=db.prepare('SELECT kind,id,version,sha256,size,published FROM versions WHERE kind=? AND id=? AND version=?');
  const catalog=db.prepare('SELECT kind,id,version,sha256,size FROM versions WHERE published=1 ORDER BY kind,id,version');
  async function handle(req,res){
    const {pathname,searchParams}=new URL(req.url,'http://localhost');
    if(req.method==='GET' && pathname==='/v1/engine-index'){
      const file=path.join(data,'signed-engine-index.json');
      const info=await stat(file).catch(e=>{if(e.code==='ENOENT')fail(404,'engine index not provisioned');throw e;});
      if(!info.isFile()||info.size>16*1024*1024)fail(500,'invalid engine index');
      return json(res,200,JSON.parse(await readFile(file,'utf8')));
    }
    if(req.method==='GET' && pathname==='/v1/resources')return json(res,200,catalog.all());
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
        const row=get.get(...key);if(!row)fail(404,'no draft');
        if(row.sha256!==digest)fail(409,'draft digest mismatch');
        db.prepare('UPDATE versions SET published=1 WHERE kind=? AND id=? AND version=?').run(...key);
        return json(res,200,get.get(...key));
      }
    }else if(req.method==='GET'){
      const row=get.get(...key);if(!row?.published)fail(404,'version not published');
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

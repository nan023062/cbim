import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 只向回环地址提供固定构建目录，不暴露工程、凭据或任意本地文件。
const root=path.resolve(fileURLToPath(new URL('../build/website/',import.meta.url)));
const port=Number(process.env.CBIM_WEBSITE_PORT||4178);
const allowed=new Set(['index.html','download.html','404.html','robots.txt','sitemap.xml','cbim.png']);
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://localhost').pathname,name=pathname==='/'?'index.html':pathname.slice(1);
    if(!allowed.has(name)){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});res.end(await fs.readFile(path.join(root,'404.html')));return}
    const bytes=await fs.readFile(path.join(root,name));const type={'.html':'text/html; charset=utf-8','.png':'image/png','.xml':'application/xml','.txt':'text/plain; charset=utf-8'}[path.extname(name)];
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
  }catch{res.writeHead(404);res.end('Not found')}
});
server.listen(port,'127.0.0.1',()=>{
  // CI 用 port=0 请求独立端口，通过自有子进程 IPC 回执确认服务，避免误测其他预览实例。
  const url=`http://127.0.0.1:${server.address().port}/`;
  console.log(`CBIM website preview: ${url}`);
  process.send?.({url});
});

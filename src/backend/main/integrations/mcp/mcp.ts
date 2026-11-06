/**
 * 作用定位：将内部知识服务发布为 MCP，处理传输鉴权、调用日志与心跳。
 * 设计原因：业务工具由 KnowledgeTools 统一维护，此层仅承担外部协议适配。
 */
import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Workspace} from '../../workspace/workspace';
import {fail} from '../../../core/foundation/errors';
import {traceMcp} from './mcp-trace';
import {knowledgeTools} from '../../../scheduler-engine/tools/knowledge-tools';
const same=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function serve(workspace:Workspace,port=0){
  const knowledge=knowledgeTools(workspace);
  const endpoint=`/mcp/${workspace.entry.id}/${workspace.instanceId}`;
  let stopping=false;const active=new Set<{server:McpServer;transport:StreamableHTTPServerTransport}>();
  const httpServer=http.createServer(async(req,res)=>{
    const token=(req.headers.authorization||'').replace(/^Bearer /,'');const read=same(token,workspace.readToken),write=same(token,workspace.writeToken);
    const heartbeat=read&&req.headers['x-cbim-probe']===workspace.instanceId;
    const trace=heartbeat?undefined:traceMcp(workspace,req,res);
    if(stopping||workspace.state!=='running'){res.writeHead(503);res.end('WORKSPACE_NOT_RUNNING');return}
    if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host||'')||req.headers.origin){res.writeHead(403);res.end('ORIGIN_DENIED');return}
    if(!read&&!write){res.writeHead(401,{'WWW-Authenticate':'Bearer realm="CBIM workspace"'});res.end('UNAUTHORIZED');return}
    if(req.url!==endpoint){res.writeHead(404);res.end();return}
    const server=new McpServer({name:'cbim-assistant',version:'0.1.0'});
    for(const tool of knowledge.tools)server.registerTool(tool.name,{description:tool.description,inputSchema:tool.inputSchema},async args=>{
      try{trace?.tool(tool.name);return await knowledge.call(tool.name,args,write)}
      catch(e:any){trace?.fail(e.code||'ERROR',e.message);return {isError:true,content:[{type:'text' as const,text:JSON.stringify({code:e.code||'ERROR',message:e.message,workspaceId:workspace.entry.id})}]}}
    });
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});const record={server,transport};active.add(record);
    res.on('close',()=>{active.delete(record);void transport.close();void server.close()});
    try{await server.connect(transport);await transport.handleRequest(req,res)}catch{trace?.fail('MCP_REQUEST_FAILED','MCP 请求处理失败');if(!res.headersSent)res.writeHead(500);res.end('MCP_REQUEST_FAILED')}
  });
  httpServer.requestTimeout=30000;httpServer.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(port,'127.0.0.1',()=>{httpServer.off('error',reject);resolve()})});
  const address=httpServer.address();if(!address||typeof address==='string')throw Error('MCP bind failed');const url=`http://127.0.0.1:${address.port}${endpoint}`;
  let checking=false;
  const probe=async()=>{
    if(stopping||checking)return;checking=true;const started=Date.now();
    const client=new Client({name:'cbim-readiness',version:'1'});
    try{
      await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{signal:AbortSignal.timeout(3000),headers:{Authorization:`Bearer ${workspace.readToken}`,'x-cbim-probe':workspace.instanceId}}}),{timeout:3000});
      const result=await client.callTool({name:'cbim_workspace_identity',arguments:{}},undefined,{timeout:3000});const value=JSON.parse((result.content as any)[0].text);
      if(value.workspaceId!==workspace.entry.id||value.instanceId!==workspace.instanceId)fail('IDENTITY','MCP 就绪核验失败');
      if(!stopping)workspace.mcp.checked(Date.now()-started);
    }catch(e:any){if(!stopping)workspace.mcp.checked(Date.now()-started,e.message);throw e}
    finally{checking=false;await client.close()}
  };
  const heartbeat=setInterval(()=>{if(workspace.state==='running')void probe().catch(()=>{})},5000);heartbeat.unref();
  return {url,probe,
    close:async()=>{stopping=true;clearInterval(heartbeat);workspace.mcp.stopped();await Promise.all([...active].map(async x=>{await x.transport.close();await x.server.close()}));await new Promise<void>(resolve=>{httpServer.close(()=>resolve());httpServer.closeAllConnections()})}};
}

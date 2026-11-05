import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {z} from 'zod';
import {Workspace} from './workspace';
import {fail} from './paths';
const same=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const identity={workspaceId:z.string(),instanceId:z.string()};
export async function serve(workspace:Workspace,port=0){
  let stopping=false;const active=new Set<{server:McpServer;transport:StreamableHTTPServerTransport}>();
  const httpServer=http.createServer(async(req,res)=>{
    const token=(req.headers.authorization||'').replace(/^Bearer /,'');const read=same(token,workspace.readToken),write=same(token,workspace.writeToken);
    if(stopping||workspace.state!=='running'){res.writeHead(503);res.end('WORKSPACE_NOT_RUNNING');return}
    if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host||'')||req.headers.origin){res.writeHead(403);res.end('ORIGIN_DENIED');return}
    if(!read&&!write){res.writeHead(401,{'WWW-Authenticate':'Bearer realm="CBIM workspace"'});res.end('UNAUTHORIZED');return}
    if(req.url!=='/mcp'){res.writeHead(404);res.end();return}
    const server=new McpServer({name:'cbim-assistant',version:'0.1.0'});
    const wrap=(fn:(args:any)=>Promise<unknown>|unknown)=>(async(args:any)=>{try{workspace.assert(args);const value=await fn(args);return {content:[{type:'text' as const,text:JSON.stringify(value)}]}}catch(e:any){return {isError:true,content:[{type:'text' as const,text:JSON.stringify({code:e.code||'ERROR',message:e.message,workspaceId:workspace.entry.id})}]}}});
    server.registerTool('workspace_identity',{description:'核验工程与运行实例。不能启动工作区。',inputSchema:{}},async()=>({content:[{type:'text',text:JSON.stringify({workspaceId:workspace.entry.id,root:workspace.entry.path,instanceId:workspace.instanceId,state:workspace.state,writeEnabled:workspace.writable})}]}));
    server.registerTool('knowledge_snapshot',{description:'读取正式知识、版本、模块树与校验结果；不包含本地记忆。',inputSchema:identity},wrap(()=>workspace.snapshot()));
    server.registerTool('knowledge_search',{inputSchema:{...identity,query:z.string().max(200)}},wrap(async args=>{const snapshot=await workspace.read();return {...snapshot,files:snapshot.files.filter(f=>f.path.includes(args.query)||f.text.toLowerCase().includes(args.query.toLowerCase()))}}));
    const changeSchema={...identity,revision:z.string(),requestId:z.string(),changes:z.array(z.object({path:z.string(),text:z.string().nullable()})).max(1000)};
    server.registerTool('knowledge_preview',{description:'校验修改并预览影响，不写入。',inputSchema:changeSchema},wrap(args=>workspace.preview(args)));
    server.registerTool('knowledge_commit',{description:'需桌面开启 Agent 写入、写令牌、读取版本及幂等请求标识。',inputSchema:changeSchema},wrap(args=>{if(!write||!workspace.writable)fail('FORBIDDEN','桌面未启用 Agent 写入或凭据没有写权限');return workspace.commit(args)}));
    server.registerTool('knowledge_move_preview',{inputSchema:{...identity,from:z.string(),to:z.string().nullable()}},wrap(async args=>workspace.preview(await workspace.planMove(await workspace.read(),args.from,args.to))));
    server.registerTool('rules_validate',{inputSchema:identity},wrap(()=>workspace.startTask('validate')));
    server.registerTool('task_status',{inputSchema:{...identity,taskId:z.string()}},wrap(args=>workspace.tasks.get(args.taskId)||{state:'not_found'}));
    server.registerTool('task_cancel',{inputSchema:{...identity,taskId:z.string()}},wrap(args=>workspace.cancelTask(args.taskId)));
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});const record={server,transport};active.add(record);
    res.on('close',()=>{active.delete(record);void transport.close();void server.close()});
    try{await server.connect(transport);await transport.handleRequest(req,res)}catch{if(!res.headersSent)res.writeHead(500);res.end('MCP_REQUEST_FAILED')}
  });
  httpServer.requestTimeout=30000;httpServer.headersTimeout=10000;
  await new Promise<void>((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(port,'127.0.0.1',()=>{httpServer.off('error',reject);resolve()})});
  const address=httpServer.address();if(!address||typeof address==='string')throw Error('MCP bind failed');const url=`http://127.0.0.1:${address.port}/mcp`;
  return {url,probe:async()=>{const client=new Client({name:'cbim-readiness',version:'1'});try{await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:`Bearer ${workspace.readToken}`}}}));const result=await client.callTool({name:'workspace_identity',arguments:{}});const value=JSON.parse((result.content as any)[0].text);if(value.workspaceId!==workspace.entry.id||value.instanceId!==workspace.instanceId)fail('IDENTITY','MCP 就绪核验失败')}finally{await client.close()}},
    close:async()=>{stopping=true;await Promise.all([...active].map(async x=>{await x.transport.close();await x.server.close()}));await new Promise<void>(resolve=>{httpServer.close(()=>resolve());httpServer.closeAllConnections()})}};
}

/**
 * 作用定位：宿主启动的 stdio MCP 桥；逐次连接当前工作区服务，不自动重放写入。
 * 设计原因：宿主拥有短生命周期 stdio 进程，CBIM 拥有常驻服务；每次请求重新发现但不重放写入。
 */
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {parseArgs} from 'node:util';
import path from 'node:path';
import {Paths} from '../../platform/paths';
import {connectWorkspace} from '../mcp/discovery';

// A host owns this stdio process; CBIM owns the long-lived workspace service.
// Resolve the live instance for each request. Never retry a write or replace its identity.
async function main(){
  const {values}=parseArgs({options:{root:{type:'string'},'user-data':{type:'string'},'workspace-id':{type:'string'}}});
  if(!values.root||!values['user-data']||!values['workspace-id'])throw Error('缺少工作区连接参数');
  const paths=new Paths(values['user-data'],path.dirname(process.argv[1]));
  const root=values.root;
  if((await paths.identity(root)).id!==values['workspace-id'])throw Error('工作区身份不匹配，请在 CBIM 中重新定位');
  const server=new Server({name:'cbim-'+values['workspace-id'],version:'0.1.0'},{capabilities:{tools:{}}});
  const connected=async<T>(action:(client:Awaited<ReturnType<typeof connectWorkspace>>['client'])=>Promise<T>)=>{
    const {client}=await connectWorkspace(paths,root,true);
    try{return await action(client)}finally{await client.close()}
  };
  server.setRequestHandler(ListToolsRequestSchema,request=>connected(client=>client.listTools(request.params)));
  server.setRequestHandler(CallToolRequestSchema,async request=>{
    try{return await connected(client=>client.callTool(request.params))}
    catch(e:any){return {isError:true,content:[{type:'text',text:JSON.stringify({code:e.code||'CONNECTION',message:e.message})}]}}
  });
  await server.connect(new StdioServerTransport());
  process.stdin.on('end',()=>void server.close());
}
void main().catch(e=>{process.stderr.write(String(e.message)+'\n');process.exitCode=1});

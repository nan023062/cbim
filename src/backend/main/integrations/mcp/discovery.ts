/**
 * 作用定位：校验发现文件、凭据与实际 MCP 实例，建立绑定指定工作区的连接。
 * 设计原因：同时验证发现记录和真实服务，拒绝过期实例且不隐式启动工作区。
 */
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import path from 'node:path';
import {Paths} from '../../platform/paths';
import {exists,readJson} from '../../../core/foundation/files';
import {fail} from '../../../core/foundation/errors';
/** Discover and verify only; never registers, initializes or opens a workspace. */
export async function connectWorkspace(paths:Paths,root:string,write=false){
  const identity=await paths.identity(root),file=paths.discovery(identity.id);
  if(!await exists(file))fail('NOT_RUNNING','工作区未运行，请由用户在 CBIM Assistant 中打开');
  const d=await readJson(file),credentials=await readJson(path.join(paths.project(identity.id),'credentials.json'));
  if(d.version!==1||d.workspaceId!==identity.id||d.root!==identity.path||d.instanceId!==credentials.instanceId)fail('IDENTITY','发现记录与项目身份不符');
  const url=new URL(d.url);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!==`/mcp/${identity.id}/${d.instanceId}`||url.username!==''||url.password!==''||url.search!==''||url.hash!=='')fail('IDENTITY','发现记录不是合法的本机 MCP 入口');
  const client=new Client({name:'cbim-client',version:'0.1.0'});
  try{await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:`Bearer ${write?credentials.writeToken:credentials.readToken}`}}}));const response=await client.callTool({name:'cbim_workspace_identity',arguments:{}});const actual=JSON.parse((response.content as any)[0].text);if(actual.workspaceId!==identity.id||actual.instanceId!==d.instanceId||actual.root!==identity.path)fail('STALE_INSTANCE','连接到错误工程或过期实例');return {client,identity:{workspaceId:identity.id,instanceId:d.instanceId}}}catch(e){await client.close();throw e}
}

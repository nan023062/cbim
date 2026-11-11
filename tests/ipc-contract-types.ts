import type {IpcCaller,IpcCall} from '../src/bridge/contracts/ipc-call';
import type {AgentHistoryQueryPort} from '../src/backend/main/ipc/agent-history';

// 只由 tsc 检查，不执行无效 IPC；防止迁移后又通过宽重载逃逸。
async function assertHistoryContract(call:IpcCaller,port:AgentHistoryQueryPort){
  const roles=await call('agentHistory.roles',{workspaceId:'workspace'});
  roles.roles[0]?.agentId;
  const sessions=await call('agentHistory.sessions',{workspaceId:'workspace',agentId:'cbim:main'});
  sessions.items[0]?.sessionId;
  // @ts-expect-error 响应不能被当作另一操作的结果
  roles.items;
  // @ts-expect-error 未登记的操作不能通过 string 兜底
  await call('agentHistory.unknown',{});
  // @ts-expect-error 必填请求不能省略
  await call('agentHistory.roles');
  // @ts-expect-error runs 必须提供 sessionId
  await call('agentHistory.runs',{workspaceId:'workspace',agentId:'cbim:main'});
  // @ts-expect-error events 游标是原运行与序号，不是列表字符串
  await call('agentHistory.events',{workspaceId:'workspace',agentId:'cbim:main',sessionId:'session',taskId:'task',runId:'run',cursor:'list-cursor'});
  // @ts-expect-error 即使显式放宽泛型，操作和参数仍须正确配对
  await call<IpcCall>('agentHistory.events',{workspaceId:'workspace'});
  // @ts-expect-error 请求字段不能放宽成字符串
  await call('agentHistory.sessions',{workspaceId:'workspace',agentId:'cbim:main',limit:'30'});
  // @ts-expect-error 服务实现也须遵守该操作的响应
  port.roles=async()=>({items:[],diagnostics:[]});
}
void assertHistoryContract;

// 每个新增操作必须同时声明请求与响应，不能用 any / unknown 响应恢复旧通配入口。
import {ipcRequests,ipcSuccess,type IpcAction,type IpcResponse,type IpcHandlers} from '../src/bridge/contracts/ipc-call';
type AnyResponse={[A in IpcAction]:0 extends 1&IpcResponse<A>?A:never}[IpcAction];
type UnknownResponse={[A in IpcAction]:unknown extends IpcResponse<A>?A:never}[IpcAction];
type AssertNever<T extends never>=T;
type AllResponsesKnown=AssertNever<AnyResponse|UnknownResponse|Exclude<keyof typeof ipcRequests,IpcAction>|Exclude<IpcAction,keyof typeof ipcRequests>>;
async function assertAllGroups(call:IpcCaller,handlers:IpcHandlers){
  const list=await call('list');list.entries[0]?.state;
  const raw=await call('chat.preview',{id:'workspace',attachmentId:'attachment'});raw.text.toUpperCase();
  // @ts-expect-error 无参数操作不能接受伪造身份
  await call('desktop.updates.status',{id:'forged'});
  // @ts-expect-error 桌面不能发送任意操作字符串
  await call('anything',{});
  // @ts-expect-error 正式岗位查询必须携带身份
  await call('workspace.members.list',{});
  // @ts-expect-error 治理实施必须携带完整原提案与决定身份
  await call('governance.apply',{workspaceId:'w'});
  // @ts-expect-error 原执行只接受完整图身份
  await call('dispatch.executionStart',{taskId:'t'});
  // @ts-expect-error 队列插入必须绑定用户点击时的运行
  await call('loop.queueInsert',{id:'w',taskId:'t',queueId:'q'});
  // @ts-expect-error 模型选择不是通用配置对象
  await call('models.select',{model:'m'});
  // @ts-expect-error 资源连接撤销不能省略命令与版本
  await call('resources.connection.revoke',{workspaceId:'w'});
  // @ts-expect-error 公共查询结果不能换成原始 JSON / any 槽位
  handlers['chat.preview']=async()=>({});
  // @ts-expect-error 原生终端与选择目录的响应不能混用
  ipcSuccess('chooseFolder',{output:'',running:false,exitCode:0});
  // @ts-expect-error 显式联合泛型也不能把两种请求字段拼在一起
  await call<IpcCall<'terminal.start'|'models.select'>>('terminal.start',{id:'w'});
}
void assertAllGroups;

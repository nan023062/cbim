/**
 * 作用定位：把等待资料控制器的单次读取映射为桌面 IPC，传递本轮导入身份与取消。
 * 设计原因：取消和实际读取共享 importId，允许 Main 识别先到的取消；端口不负责授权，也不把成功保存误称为目标受理。
 */
import type {ContinuationPorts} from './continuation-state';

/** 仅允许资料准备所需操作；动作名不能扩展到任意桌面 IPC。 */
type Call=(action:'chat.importCancel'|'chat.pick'|'chat.import'|'chat.materialTargets'|'chat.materialList',args:unknown)=>Promise<any>;
/** 每个操作新建身份；取消只停止准备资料，不撤销既有受理事实或普通聊天运行。 */
export function continuationSourcePorts(workspaceId:string,call:Call,uuid:()=>string):Pick<ContinuationPorts,'importSource'|'materialTargets'|'materialList'>{
  async function cancellable<T>(signal:AbortSignal,read:(importId:string)=>Promise<T>):Promise<T>{
    const importId=uuid(),cancel=()=>{void call('chat.importCancel',{id:workspaceId,importId}).catch(()=>{/* 实际读取仍会返回自身错误；前端不会把取消请求发出当成取消成功。 */})};
    if(signal.aborted)throw Error('资料准备已取消');
    signal.addEventListener('abort',cancel,{once:true});
    try{return await read(importId)}finally{signal.removeEventListener('abort',cancel)}
  }
  return {
    importSource:(selection,signal)=>cancellable(signal,async importId=>selection.kind==='file'||selection.kind==='folder'
      ?call('chat.pick',{id:workspaceId,kind:selection.kind,importId})
      :[await call('chat.import',{id:workspaceId,importId,attachment:selection})]),
    materialTargets:async signal=>{if(signal.aborted)throw Error('资料准备已取消');return call('chat.materialTargets',{id:workspaceId})},
    materialList:(selection,signal)=>cancellable(signal,importId=>call('chat.materialList',{id:workspaceId,importId,connectorId:selection.target.connectorId,connectionId:selection.target.connectionId,...(selection.expectedRevision?{expectedRevision:selection.expectedRevision}:{}),...(selection.offset!==undefined?{offset:selection.offset}:{}),limit:50})),
  };
}

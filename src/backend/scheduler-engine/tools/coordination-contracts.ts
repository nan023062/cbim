/**
 * 作用定位：校验只读闭包预览的原运行归属和提交依据。
 * 设计原因：预览不能被错误回包换成其他周期、版本或原因；最终写入仍使用原领域契约。
 */
import {coordinationPreviewSchema} from '../../../logic/tasks/rules/coordination-preview';
import type {MainToolOutputBinding} from '../../../logic/tasks/rules/main-tool-output';
import type {CancelQueuedTasksInput} from '../../../logic/tasks/rules/queued-task-cancel';
import {checkedJsonToolResult} from '../../../logic/tools/rules/results';

export function checkedClosurePreview(name:string,value:unknown,binding:MainToolOutputBinding,input?:CancelQueuedTasksInput){
  return checkedJsonToolResult(name,value,coordinationPreviewSchema.refine(preview=>{
    if(preview.workspaceId!==binding.workspaceId||preview.rootSessionId!==binding.rootSessionId||preview.scopeId!==binding.scopeId)return false;
    if(input&&preview.cancel){
      return preview.cancel.reason===input.reason&&preview.cancel.expectedGraphCursor.streamId===input.expectedGraphCursor.streamId&&preview.cancel.expectedGraphCursor.seq===input.expectedGraphCursor.seq&&input.targets.every(target=>preview.cancel!.targets.some(item=>item.taskId===target.taskId&&item.expectedRevision===target.expectedRevision));
    }
    return !input?!preview.cancel:!preview.memberPause;
  }));
}

/**
 * 作用定位：管理工作区内等待用户回答的结构化问题，供 Loop 工具与对话界面共享。
 * 设计原因：冻结原题并按真实选项索引构造答案，公开列表不共享队列对象；选择不授权工具，只有显式提交才恢复等待的模型。
 * 生命周期：回答与取消只有先发生者消费等待；回包损坏不会重建问题，停止/关闭清理等待，重启不自动重放。
 */
import {randomUUID} from 'node:crypto';
import {questionInput as input,questionAnswersInputSchema,type PendingQuestion,type QuestionResult} from '../../../logic/tools/rules/questions';
export type {QuestionInput,PendingQuestion} from '../../../logic/tools/rules/questions';
export class QuestionQueue {
  private pending=new Map<string,{view:PendingQuestion;finish:(answers:QuestionResult)=>void}>();
  /** 返回独立视图；调用方或界面不得通过修改列表改写原题和选项。 */
  list(taskId:string){return [...this.pending.values()].filter(p=>p.view.taskId===taskId).map(p=>structuredClone(p.view))}
  /** 先校验模型输入；取消信号监听在结束时移除，防止任务残留等待。 */
  ask(taskId:string,args:unknown,signal:AbortSignal):Promise<QuestionResult>{
    const parsed=structuredClone(input.parse(args));if(signal.aborted)return Promise.resolve({cancelled:true});
    return new Promise(resolve=>{const id=randomUUID();let settled=false;const cancel=()=>finish({cancelled:true});const finish=(value:QuestionResult)=>{if(settled)return;settled=true;this.pending.delete(id);signal.removeEventListener('abort',cancel);resolve(value)};
      this.pending.set(id,{view:{id,taskId,...parsed},finish});signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
    });
  }
  /** 校验全部答案后一次性消费问题；重复提交或跨任务回答均拒绝。 */
  answer(taskId:string,id:string,value:unknown){
    const item=this.pending.get(id);if(!item||item.view.taskId!==taskId)throw Error('问题已结束，请刷新对话');
    const answers=questionAnswersInputSchema.parse(value);
    if(answers.length!==item.view.questions.length)throw Error('请回答所有问题');
    const result=answers.map((answer,i)=>{const q=item.view.questions[i];if(answer.option===null){if(!answer.other)throw Error('请填写其它补充');return {question:q.question,answer:answer.other}}const selected=q.options[answer.option];if(!selected)throw Error('无效选项');return {question:q.question,answer:selected.label,supplement:answer.other||undefined}});
    item.finish({answers:result});
  }
  cancel(taskId?:string){for(const item of [...this.pending.values()])if(!taskId||item.view.taskId===taskId)item.finish({cancelled:true})}
}

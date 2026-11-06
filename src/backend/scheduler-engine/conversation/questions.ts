/**
 * 作用定位：管理工作区内等待用户回答的结构化问题，供 Loop 工具与对话界面共享。
 * 设计原因：问题和答案绑定任务及一次调用；选择不会直接授权工具，只有显式提交才恢复等待的模型。
 * 生命周期：停止、关闭或调用取消时清除等待；重启不自动重放问题，历史由工具事件保留。
 */
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {questionInput as input,type PendingQuestion} from '../../core/tools/questions';
export type {QuestionInput,PendingQuestion} from '../../core/tools/questions';
/** 仅向模型声明真实交互能力，默认不选中任何答案，客户端始终提供其它输入。 */
export const questionTool={name:'cbim_ask_user_question',description:'需要用户在方案、方向或偏好之间选择时使用。提供2至6个选项，界面自动提供其它补充输入。等待用户回答后继续，不要仅在正文列出选项；此工具不授予执行权限。',inputSchema:{type:'object',properties:{questions:{type:'array',minItems:1,maxItems:3,items:{type:'object',properties:{question:{type:'string'},options:{type:'array',minItems:2,maxItems:6,items:{type:'object',properties:{label:{type:'string'},description:{type:'string'}},required:['label']}}},required:['question','options']}}},required:['questions']}};
export class QuestionQueue {
  private pending=new Map<string,{view:PendingQuestion;finish:(answers:unknown)=>void}>();
  list(taskId:string){return [...this.pending.values()].filter(p=>p.view.taskId===taskId).map(p=>p.view)}
  /** 先校验模型输入；取消信号监听在结束时移除，防止任务残留等待。 */
  ask(taskId:string,args:unknown,signal:AbortSignal):Promise<unknown>{
    const parsed=input.parse(args);if(signal.aborted)return Promise.resolve({cancelled:true});
    return new Promise(resolve=>{const id=randomUUID();const cancel=()=>finish({cancelled:true});const finish=(value:unknown)=>{this.pending.delete(id);signal.removeEventListener('abort',cancel);resolve(value)};
      this.pending.set(id,{view:{id,taskId,...parsed},finish});signal.addEventListener('abort',cancel,{once:true});
    });
  }
  /** 校验全部答案后一次性消费问题；重复提交或跨任务回答均拒绝。 */
  answer(taskId:string,id:string,value:unknown){
    const item=this.pending.get(id);if(!item||item.view.taskId!==taskId)throw Error('问题已结束，请刷新对话');
    const answers=z.array(z.object({option:z.number().int().min(0).nullable(),other:z.string().trim().max(4000)})).parse(value);
    if(answers.length!==item.view.questions.length)throw Error('请回答所有问题');
    const result=answers.map((answer,i)=>{const q=item.view.questions[i];if(answer.option===null){if(!answer.other)throw Error('请填写其它补充');return {question:q.question,answer:answer.other}}const selected=q.options[answer.option];if(!selected)throw Error('无效选项');return {question:q.question,answer:selected.label,supplement:answer.other||undefined}});
    item.finish({answers:result});
  }
  cancel(taskId?:string){for(const item of [...this.pending.values()])if(!taskId||item.view.taskId===taskId)item.finish({cancelled:true})}
}

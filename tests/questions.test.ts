import {expect,test} from 'vitest';
import {QuestionQueue} from '../src/logic/conversation/runtime/questions';
const args={questions:[{question:'下一步？',options:[{label:'双人模式'},{label:'音效'}]}]};
test('question answers are task-bound, validated and consumed once',async()=>{
 const queue=new QuestionQueue(),wait=queue.Ask('task',args,new AbortController().signal),id=queue.List('task')[0].id;
 expect(()=>queue.Answer('other',id,[{option:0,other:''}])).toThrow();
 expect(()=>queue.Answer('task',id,[{option:null,other:''}])).toThrow();
 expect(queue.List('task')).toHaveLength(1);
 queue.Answer('task',id,[{option:1,other:'可以关闭声音'}]);
 expect(await wait).toEqual({answers:[{question:'下一步？',answer:'音效',supplement:'可以关闭声音'}]});
 expect(()=>queue.Answer('task',id,[])).toThrow();
});
test('freeform answers, abort and task cancellation release waiting tools',async()=>{
 const queue=new QuestionQueue(),controller=new AbortController();
 const a=queue.Ask('a',args,controller.signal),b=queue.Ask('b',args,new AbortController().signal);
 controller.abort();expect(await a).toEqual({cancelled:true});expect(queue.List('b')).toHaveLength(1);
 queue.Answer('b',queue.List('b')[0].id,[{option:null,other:'先优化触屏'}]);expect(await b).toEqual({answers:[{question:'下一步？',answer:'先优化触屏'}]});
 const c=queue.Ask('c',args,new AbortController().signal);queue.Cancel();expect(await c).toEqual({cancelled:true});expect(queue.List('c')).toEqual([]);
});

test('原题独立于模型对象和公开列表，回答始终使用最初选项',async()=>{
 const queue=new QuestionQueue(),source=structuredClone(args),wait=queue.Ask('task',source,new AbortController().signal),view=queue.List('task')[0];
 source.questions[0].question='模型改题';source.questions[0].options[0].label='模型改选项';
 view.questions[0].question='视图改题';view.questions[0].options[0].label='视图改选项';view.taskId='other';
 const original=queue.List('task')[0];expect(original).toMatchObject({taskId:'task',questions:args.questions});
 queue.Answer('task',original.id,[{option:0,other:''}]);expect(await wait).toEqual({answers:[{question:'下一步？',answer:'双人模式'}]});
});

test('所有题目一次提交，非法答案不消费；有选项说明和其它正文保留各自语义',async()=>{
 const queue=new QuestionQueue(),input={questions:[...args.questions,{question:'附加目标？',options:[{label:'小型'},{label:'完整'}]}]},wait=queue.Ask('task',input,new AbortController().signal),id=queue.List('task')[0].id;
 for(const invalid of [[{option:0,other:''}],[{option:2,other:''},{option:null,other:'其它'}],[{option:0,other:'',approved:true},{option:1,other:''}],[{option:0,other:''},{option:null,other:'  '}],[{option:0,other:''},{option:1,other:'x'.repeat(4001)}]]){
  expect(()=>queue.Answer('task',id,invalid)).toThrow();expect(queue.List('task')).toHaveLength(1);
 }
 queue.Answer('task',id,[{option:1,other:'  支持静音  '},{option:null,other:'  可导出文档  '}]);
 expect(await wait).toEqual({answers:[{question:'下一步？',answer:'音效',supplement:'支持静音'},{question:'附加目标？',answer:'可导出文档'}]});expect(queue.List('task')).toEqual([]);
});

test('回答与取消只有先发生者消费，已取消或关闭的题目不接受迟到提交',async()=>{
 const queue=new QuestionQueue(),first=new AbortController(),answered=queue.Ask('a',args,first.signal),a=queue.List('a')[0].id;
 queue.Answer('a',a,[{option:0,other:''}]);first.abort();expect(await answered).toEqual({answers:[{question:'下一步？',answer:'双人模式'}]});
 const second=new AbortController(),cancelled=queue.Ask('b',args,second.signal),b=queue.List('b')[0].id;second.abort();expect(()=>queue.Answer('b',b,[{option:0,other:''}])).toThrow();expect(await cancelled).toEqual({cancelled:true});
 const c=queue.Ask('c',args,new AbortController().signal),id=queue.List('c')[0].id;queue.Cancel('c');expect(()=>queue.Answer('c',id,[{option:0,other:''}])).toThrow();expect(await c).toEqual({cancelled:true});
 const already=new AbortController();already.abort();expect(await queue.Ask('d',args,already.signal)).toEqual({cancelled:true});expect(queue.List('d')).toEqual([]);
});

test('模型嵌套额外字段在创建等待前拒绝，不静默裁剪身份或授权',()=>{
 const queue=new QuestionQueue(),signal=new AbortController().signal;
 for(const raw of [{...args,runId:'forged'},{questions:[{...args.questions[0],approved:true}]},{questions:[{...args.questions[0],options:[{label:'a',scope:'all'},{label:'b'}]}]}])expect(()=>queue.Ask('task',raw,signal)).toThrow();
 expect(queue.List('task')).toEqual([]);
});

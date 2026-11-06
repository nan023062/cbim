import {expect,test} from 'vitest';
import {QuestionQueue} from '../src/backend/scheduler-engine/conversation/questions';
const args={questions:[{question:'下一步？',options:[{label:'双人模式'},{label:'音效'}]}]};
test('question answers are task-bound, validated and consumed once',async()=>{
 const queue=new QuestionQueue(),wait=queue.ask('task',args,new AbortController().signal),id=queue.list('task')[0].id;
 expect(()=>queue.answer('other',id,[{option:0,other:''}])).toThrow();
 expect(()=>queue.answer('task',id,[{option:null,other:''}])).toThrow();
 expect(queue.list('task')).toHaveLength(1);
 queue.answer('task',id,[{option:1,other:'可以关闭声音'}]);
 expect(await wait).toEqual({answers:[{question:'下一步？',answer:'音效',supplement:'可以关闭声音'}]});
 expect(()=>queue.answer('task',id,[])).toThrow();
});
test('freeform answers, abort and task cancellation release waiting tools',async()=>{
 const queue=new QuestionQueue(),controller=new AbortController();
 const a=queue.ask('a',args,controller.signal),b=queue.ask('b',args,new AbortController().signal);
 controller.abort();expect(await a).toEqual({cancelled:true});expect(queue.list('b')).toHaveLength(1);
 queue.answer('b',queue.list('b')[0].id,[{option:null,other:'先优化触屏'}]);expect(await b).toEqual({answers:[{question:'下一步？',answer:'先优化触屏'}]});
 const c=queue.ask('c',args,new AbortController().signal);queue.cancel();expect(await c).toEqual({cancelled:true});expect(queue.list('c')).toEqual([]);
});

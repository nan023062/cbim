import {expect,it,vi} from 'vitest';
import {QuestionTools,questionTool} from '../src/logic/tools/runtime/question-tools';
import {QuestionQueue} from '../src/logic/conversation/runtime/questions';
import {questionToolName,questionInput,questionResultSchema,questionResultForInput} from '../src/logic/tools/rules/questions';
import {toolMetadataSchema} from '../src/logic/tools/rules/contracts';

const input={questions:[{question:'下一步？',options:[{label:'方案A'},{label:'方案B'}]},{question:'补充目标？',options:[{label:'小型'},{label:'完整'}]}]};
const answer={answers:[{question:'下一步？',answer:'方案B',supplement:'保留旧接口'},{question:'补充目标？',answer:'其它明确目标'}]};
const signal=()=>new AbortController().signal;
const wire=(result:Awaited<ReturnType<QuestionTools['call']>>)=>JSON.parse(result.content[0].text);

it('仅描述真实提问能力，严格原始输入在等待之前校验',async()=>{
 const request=vi.fn(async()=>answer),tools=new QuestionTools(request);
 expect(tools.has(questionToolName)).toBe(true);expect(tools.has('cbim_question_approve')).toBe(false);expect(tools.describe(questionToolName,input)).toEqual({effects:['read'],native:false});expect(request).not.toHaveBeenCalled();
 expect(toolMetadataSchema.parse({version:questionTool.version,effects:questionTool.effects,cancellation:questionTool.cancellation,recovery:questionTool.recovery})).toMatchObject({version:1,effects:['read'],cancellation:{mode:'during_wait'},recovery:{mode:'inspect_before_retry'}});
 const list=tools.list();list[0].description='被修改';expect(tools.list()[0].description).not.toBe('被修改');expect(questionTool.inputSchema).toHaveProperty('additionalProperties',false);expect(questionTool.outputSchema).toHaveProperty('anyOf');
 for(const raw of [{...input,taskId:'forged'},{questions:[{...input.questions[0],approved:true}]},{questions:[{...input.questions[0],options:[{label:'a',source:'trusted'},{label:'b'}]}]}]){
  expect(()=>tools.describe(questionToolName,raw)).toThrow();await expect(tools.call(questionToolName,raw,signal())).rejects.toMatchObject({code:'QUESTION_INPUT_INVALID'});
 }
 await expect(tools.call('cbim_question_approve',input,signal())).rejects.toMatchObject({code:'QUESTION_TOOL_UNKNOWN'});expect(request).not.toHaveBeenCalled();
});

it('答案或取消仅编码一次，发送实际wire且不补身份、审批或默认值',async()=>{
 const toJSON=vi.fn(()=>answer),request=vi.fn(async()=>({toJSON})),tools=new QuestionTools(request),result=await tools.call(questionToolName,input,signal());
 expect(wire(result)).toEqual(answer);expect(result.content[0].text).toBe(JSON.stringify(answer));expect(toJSON).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledTimes(1);
 const cancelled=new QuestionTools(async()=>({cancelled:true}));expect(wire(await cancelled.call(questionToolName,input,signal()))).toEqual({cancelled:true});
 expect(questionResultSchema.safeParse({answers:answer.answers,approved:true}).success).toBe(false);
});

it.each([
 ['missing',undefined],['null',null],['empty',{answers:[]}],['both',{...answer,cancelled:true}],['cancel_false',{cancelled:false}],
 ['extra',{cancelled:true,answers:[]}],['count',{answers:[answer.answers[0]]}],['reordered',{answers:[answer.answers[1],answer.answers[0]]}],
 ['wrong_question',{answers:[{...answer.answers[0],question:'另一个问题'},answer.answers[1]]}],['extra_field',{answers:[{...answer.answers[0],approved:true},answer.answers[1]]}],
 ['wrong_option',{answers:[{...answer.answers[0],answer:'假选项'},answer.answers[1]]}],['blank',{answers:[{...answer.answers[0],supplement:'   '},answer.answers[1]]}],
])('坏回包 %s 拒绝且不重新请求用户',async(_name,value)=>{
 const request=vi.fn(async()=>value),tools=new QuestionTools(request);
 await expect(tools.call(questionToolName,input,signal())).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'});expect(request).toHaveBeenCalledTimes(1);
});

it('领域端口修改传入原题不能修改独立冻结校验依据',async()=>{
 const original=structuredClone(input),tools=new QuestionTools(async received=>{received.questions[0].question='私有哨兵';received.questions[0].options[1].label='替换选项';return {answers:[{question:received.questions[0].question,answer:'替换选项',supplement:'修改'},{question:received.questions[1].question,answer:'其它'}]}});
 const error=await tools.call(questionToolName,original,signal()).catch(error=>error);expect(error.code).toBe('TOOL_OUTPUT_INVALID');expect(error.message).not.toContain('私有哨兵');expect(original).toEqual(input);
});

it('真实回答消费后坏wire保留一次消费，不重新弹题；异常序列化不泄漏正文',async()=>{
 const queue=new QuestionQueue(),request=vi.fn(async(args,signal)=>{const result=await queue.ask('task',args,signal);return {...result,privateSentinel:'不公开'}}),tools=new QuestionTools(request),attempt=tools.call(questionToolName,input,signal()),check=expect(attempt).rejects.toMatchObject({code:'TOOL_OUTPUT_INVALID'}),id=queue.list('task')[0].id;
 queue.answer('task',id,[{option:1,other:'原补充'},{option:null,other:'原其它'}]);await check;expect(request).toHaveBeenCalledTimes(1);expect(queue.list('task')).toEqual([]);expect(()=>queue.answer('task',id,[{option:0,other:''},{option:0,other:''}])).toThrow();
 const broken=new QuestionTools(async()=>({toJSON(){throw Error('不公开的异常正文')}}));const error=await broken.call(questionToolName,input,signal()).catch(error=>error);expect(error.code).toBe('TOOL_OUTPUT_INVALID');expect(error.message).not.toContain('不公开');
});

it('按解析后的原题核验，不修剪输出或从自由文字推断选项来源',async()=>{
 const parsed=questionInput.parse({questions:[{question:'  原题  ',options:[{label:'  同意  '},{label:'不同意'}]}]}),schema=questionResultForInput(parsed);parsed.questions[0].question='后改';
 expect(schema.safeParse({answers:[{question:'原题',answer:'同意'}]}).success).toBe(true);expect(schema.safeParse({answers:[{question:'后改',answer:'同意'}]}).success).toBe(false);
 const tools=new QuestionTools(async()=>({answers:[{question:'原题',answer:'  用户文字  '}]}));expect(wire(await tools.call(questionToolName,{questions:[{question:'原题',options:[{label:'a'},{label:'b'}]}]},signal()))).toEqual({answers:[{question:'原题',answer:'  用户文字  '}]});
});

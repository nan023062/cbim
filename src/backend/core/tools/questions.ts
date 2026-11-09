/**
 * 作用定位：结构化提问的严格输入、桌面答案、排他结果与待答快照，供队列、工具包装和证据边界共用。
 * 设计原因：答案必须对应原题且不能把取消补成空回答；这里仅检查协议，不从文字推断选项来源、用户认证、授权或业务验收。
 */
import {z} from 'zod';
export const questionToolName='cbim_ask_user_question';
const question=z.object({question:z.string().trim().min(1).max(1000),options:z.array(z.object({label:z.string().trim().min(1).max(200),description:z.string().max(1000).optional()}).strict()).min(2).max(6)}).strict();
export const questionInput=z.object({questions:z.array(question).min(1).max(3)}).strict();
export type QuestionInput=z.infer<typeof questionInput>;
export interface PendingQuestion extends QuestionInput {id:string;taskId:string}
/** option 为 null 才是其它答案；索引只引用冻结选项，不接受客户端自报的题目或答案标签。 */
export const questionAnswersInputSchema=z.array(z.object({option:z.number().int().min(0).max(5).nullable(),other:z.string().trim().max(4000)}).strict()).min(1).max(3);
const answerText=z.string().min(1).max(4000).refine(value=>!!value.trim(),'答案不能为空');
/** 输出没有 trim/default/transform；唯一 wire 必须保留实际事实，取消与答案不能同时出现。 */
export const questionResultSchema=z.union([
  z.object({answers:z.array(z.object({question:z.string().min(1).max(1000),answer:answerText,supplement:answerText.optional()}).strict()).min(1).max(3)}).strict(),
  z.object({cancelled:z.literal(true)}).strict(),
]);
export type QuestionResult=z.infer<typeof questionResultSchema>;

/**
 * 按调用前独立冻结的已解析输入核对数量、原题顺序和补充答案的选项关系。
 * 无 supplement 的文字可能来自选项或其它输入，不能据此反推选择或认证；来源只由真实队列提交路径保证。
 */
export function questionResultForInput(input:QuestionInput){
  const expected=structuredClone(input);
  return questionResultSchema.superRefine((value,context)=>{
    if('cancelled' in value)return;
    if(value.answers.length!==expected.questions.length){context.addIssue({code:'custom',message:'回答数量与原题不一致'});return}
    value.answers.forEach((answer,index)=>{
      const original=expected.questions[index];
      if(answer.question!==original.question)context.addIssue({code:'custom',path:['answers',index,'question'],message:'回答不属于原题或顺序不一致'});
      if(answer.supplement!==undefined&&!original.options.some(option=>option.label===answer.answer))context.addIssue({code:'custom',path:['answers',index,'answer'],message:'附加说明必须属于原选项答案'});
    });
  });
}

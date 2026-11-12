/**
 * 目录归属：backend/scheduler-engine/evidence；目标状态与核证恢复服务。
 * 作用定位：在影响观察中核对已有受控文件报告与原成员完整绑定、参数和字节摘要。
 * 设计原因：原 applied/unknown 与原工具结果分开，补偿只作为独立历史；复用可信报告，不创建文件进程、补备份或执行预览。
 * 职责边界：输入已经通过原 canonical/授权校验；公开仅 ledger，checkedAt 不进入处置依据，错误只给不可核实诊断。
 */
import {isDeepStrictEqual as equal} from 'node:util';
import {hash} from '../../core/foundation/serialization';
import {fail} from '../../core/foundation/errors';
import {controlledFileReportSchema,type ControlledFileReport,type ControlledFileReportInput,type ControlledFileWriteInput,type ControlledFileBinding} from '../../core/file-operations/controlled-file-operation';
import {controlledFileOperationId} from '../../core/file-operations/controlled-file-rules';

/** 只能从已核实成员来源构造，不能从页面传入正文、scope 或运行绑定。 */
export interface ControlledEffectReference {identity:ControlledFileReportInput;scopeId:string;binding:ControlledFileBinding;input:ControlledFileWriteInput}
/** 只读取原报告，返回无时钟的 ledger；停止由调用方 alive 在每次 await 前后复核并向外传播。 */
export async function observeControlledEffect(reference:ControlledEffectReference,read:(input:ControlledFileReportInput,signal?:AbortSignal)=>Promise<ControlledFileReport>,alive:()=>void,signal?:AbortSignal):Promise<ControlledFileReport['ledger']>{
  alive();
  try{
    const report=controlledFileReportSchema.parse(await read(reference.identity,signal));alive();
    if(!equal(report.identity,reference.identity))fail('EFFECT_CONTROLLED_IDENTITY','受控报告不属于原调用');
    const ledger=report.ledger;
    if(ledger.state==='recorded'){
      const op=ledger.operation,input=reference.input;
      if(!equal(op.binding,reference.binding)||op.scopeId!==reference.scopeId||op.operationId!==controlledFileOperationId(reference.binding,reference.identity.toolCallId)||op.relativePath!==input.path||!equal(op.before,input.expectedBefore)||!equal(op.intendedAfter,{byteLength:Buffer.byteLength(input.content,'utf8'),sha256:hash(Buffer.from(input.content,'utf8'))}))fail('EFFECT_CONTROLLED_IDENTITY','受控原操作与成员身份或原参数不一致');
    }
    return ledger;
  }catch{alive();return {state:'unverifiable',issues:[{code:'EFFECT_CONTROLLED_UNVERIFIABLE',message:'原受控阶段、来源或参数无法可靠核实，原结果保留'}]}}
}

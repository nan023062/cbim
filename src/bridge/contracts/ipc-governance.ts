/**
 * 作用定位：模块治理观察、提案、决定与实施的公开 IPC 请求与响应。
 * 设计原因：命令输出按对应回执种类核实；批准和实施分别提交，查询不会重放原事务。类型不替代身份和权限校验。
 */
import {z} from 'zod';
import {moduleGovernanceReceiptSchema,type ModuleGovernanceList,type ModuleGovernanceReceipt,type ModuleGovernanceUnaccepted,moduleGovernanceApplyInputSchema,moduleGovernanceDecideInputSchema,moduleGovernanceListInputSchema,moduleGovernanceLookupSchema,moduleGovernanceObserveInputSchema,moduleGovernanceProposeInputSchema,moduleGovernanceRegisterInputSchema,moduleGovernanceUnacceptedInputSchema} from '../../backend/core/governance/module-governance';

export const governanceIpcRequests={
  'governance.list':moduleGovernanceListInputSchema,
  'governance.receipt':moduleGovernanceLookupSchema,
  'governance.unaccepted':moduleGovernanceUnacceptedInputSchema,
  'governance.register':moduleGovernanceRegisterInputSchema,
  'governance.observe':moduleGovernanceObserveInputSchema,
  'governance.propose':moduleGovernanceProposeInputSchema,
  'governance.decide':moduleGovernanceDecideInputSchema,
  'governance.apply':moduleGovernanceApplyInputSchema,
};
export interface GovernanceIpcResponses {
  'governance.list':ModuleGovernanceList;
  'governance.receipt':ModuleGovernanceReceipt|undefined;
  'governance.unaccepted':ModuleGovernanceUnaccepted;
  'governance.register':z.infer<typeof governanceCommandReceipts.register>;
  'governance.observe':z.infer<typeof governanceCommandReceipts.observe>;
  'governance.propose':z.infer<typeof governanceCommandReceipts.propose>;
  'governance.decide':z.infer<typeof governanceCommandReceipts.decide>;
  'governance.apply':z.infer<typeof governanceCommandReceipts.apply>;
}

/** 命令返回对应种类的回执；通用查询仍可能返回其它种类或未找到。 */
export const governanceCommandReceipts={register:moduleGovernanceReceiptSchema.options[0],observe:moduleGovernanceReceiptSchema.options[1],propose:moduleGovernanceReceiptSchema.options[2],decide:moduleGovernanceReceiptSchema.options[3],apply:moduleGovernanceReceiptSchema.options[4]};

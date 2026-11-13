/**
 * 作用定位：向业务架构界面公开模块知识治理的纯数据与严格校验协议。
 * 设计原因：界面核对原命令、真实来源、精确差异与反馈版本，但不能导入治理服务、知识事务或私有批准凭据。
 */
export {
  moduleGovernanceIdentitySchema,moduleGovernanceListSchema,moduleGovernanceListInputSchema,
  moduleGovernanceRegisterInputSchema,moduleGovernanceObserveInputSchema,moduleGovernanceProposeInputSchema,
  moduleGovernanceDecideInputSchema,moduleGovernanceApplyInputSchema,moduleGovernanceLookupSchema,
  moduleGovernanceReceiptSchema,moduleGovernanceUnacceptedInputSchema,moduleGovernanceUnacceptedSchema,
  type ModuleGovernanceIdentity,type ModuleGovernanceList,type ModuleGovernanceObservation,
  type ModuleGovernanceProposal,type ModuleGovernanceDecision,type ModuleGovernanceProtection,
  type ModuleGovernanceApplication,type ModuleGovernanceReceipt,
  type ModuleGovernanceOrigin,
  type ModuleGovernanceFeedback,type ModuleGovernanceResponseRef,type ModuleGovernanceResponseAssessment,type ModuleGovernanceResponseState,
} from '../../logic/governance/rules/module-governance';

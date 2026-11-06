export interface SessionRepairOptions {
  sessionFile:string;recordId:string;toolCallId:string;expectedSha256?:string;apply?:boolean;
}
export interface SessionRepairResult {
  sessionFile:string;recordId:string;toolCallId:string;line:number;
  beforeSha256:string;afterSha256:string;status:'would_repair'|'already_repaired'|'repaired';
  backupFile?:string;repairId?:string;createdAt?:string;completedAt?:string;
  code?:string;changedRecordIds?:string[];replayed?:boolean;
}
export function assertNoActiveCbim():Promise<void>;
export function repairPiToolResult(options:SessionRepairOptions,dependencies?:{assertIdle?:()=>Promise<void>}):Promise<SessionRepairResult>;

export interface WorkspaceEntry { id:string; path:string; name:string; lastOpened?:string; previousIds?:string[] }
export interface Catalog {version:1; entries:WorkspaceEntry[]; recent:string[]; settings:{restore:boolean}; lastRunning:string[]}
export interface WorkspaceView extends WorkspaceEntry {state:string; error?:string; writable:boolean; tasks:TaskView[]; revision?:string; changed?:boolean}
export interface TaskView {id:string; workspaceId:string; name:string; state:string; progress:string; result?:unknown; error?:string}
export interface KnowledgeFile {path:string; text:string; hash:string}
export interface Change {path:string; text:string|null}
export interface ChangeRequest {workspaceId:string; instanceId:string; revision:string; requestId:string; changes:Change[]}
export interface Issue {severity:'error'|'warning'; code:string; message:string; path?:string}
export interface Validation {issues:Issue[]; indexes:Record<string,string>; tree:{nodes:Record<string,ModuleNode>;roots:string[]}; skills?:Record<string,{chain:string[];entries:{name:string;purpose:string;reference:string;owner:string;scope:string}[]}>; structural:boolean; architecture:'review-required'; business:'not-run'}
export interface ModuleNode {id:string;name:string;summary:string;sources:{location:string;scope:string}[];children:string[];virtual?:boolean}
export interface Snapshot {workspaceId:string;instanceId:string;revision:string;files:KnowledgeFile[];validation?:Validation}
export interface Preview {request:ChangeRequest;changes:Change[];validation:Validation;affected:string[];diff:string;fingerprint:string}
export interface Bridge {call(action:string,args?:unknown):Promise<any>}
declare global {interface Window {cbim:Bridge}}

export interface DependencyEdge {from:string; to:string; line:number; kind:string; spec:string}
export interface DependencyReport {
  ok:boolean; files:number; edges:DependencyEdge[];
  cycles:{files:string[]; edges:DependencyEdge[]}[];
  unresolved:unknown[]; dynamic:unknown[]; external:unknown[]; violations:DependencyEdge[];
}
export const roots:string[];
export const externalLoads:{file:string; expression:string; reason:string}[];
export function auditDependencies(root?:string, options?:{roots?:string[]; externalLoads?:typeof externalLoads}):DependencyReport;

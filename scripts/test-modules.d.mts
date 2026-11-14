export interface TestModuleDefinition {roots:string[];tests:Record<string,string[]>}
export interface TestModuleCatalog {version:number;modules:Record<string,TestModuleDefinition>}
export interface TestModuleEntry {file:string;module:string;kind:string}
export interface TestDependencyEdge {from:string;to:string;line:number;kind:string;spec:string}
export interface TestModuleReport {ok:boolean;errors:string[];entries:TestModuleEntry[]}
export function runtimeReference(root:string,edge:TestDependencyEdge):boolean;
export function testSubjects(root:string,file:string,edges:TestDependencyEdge[]):string[];
export function checkTestModules(root?:string,options?:{catalog?:TestModuleCatalog;files?:string[];dependencies?:{ok?:boolean;edges:TestDependencyEdge[]}}):TestModuleReport;
export function selectModuleTests(entries:TestModuleEntry[],module:string,kind?:string):string[];

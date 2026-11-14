export const adapterSources:Readonly<Record<'pi'|'claude-code'|'codex',string>>;
export function buildEngineAdapter(kind:string,destination:string):Promise<{id:string;version:string;protocol:1;entry:string}>;

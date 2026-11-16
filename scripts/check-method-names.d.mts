export interface MethodNameException
{
  file: string;
  owner: string;
  name: string;
  reason: string;
}

export interface MethodNameLocation
{
  file: string;
  owner: string;
  name: string;
  line: number;
}

export interface MethodNameReport
{
  ok: boolean;
  files: number;
  methods: number;
  symbolMethods: number;
  violations: (MethodNameLocation & { kind: string; message: string })[];
  exempted: (MethodNameLocation & { reason: string })[];
  staleExceptions: MethodNameException[];
  duplicateExceptions: (MethodNameException & { count: number })[];
}

export const externalMethodNames: MethodNameException[];
export function auditMethodNames(sources: { file: string; text: string }[], exceptions?: MethodNameException[]): MethodNameReport;
export function checkMethodNames(root?: string): MethodNameReport;

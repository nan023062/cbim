export interface ProtectedFormatRange
{
  line: number;
  rule: string;
  reason: string;
}

export function assertEquivalent(file: string, before: string, after: string): void;
export function formatSource(file: string, original: string): { text: string; protectedRanges: ProtectedFormatRange[] };
export function formatSources(root?: string, write?: boolean): { files: number; changed: string[]; violations: { file: string; line: number }[]; protectedRanges: (ProtectedFormatRange & { file: string })[] };

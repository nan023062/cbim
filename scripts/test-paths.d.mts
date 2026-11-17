export const testFilePattern: RegExp;
export function isUnitTestPath(file: string): boolean;
export function isTestSupport(file: string): boolean;
export function unitTestDirectory(definition: {directory?: string; roots: string[]}): string | undefined;

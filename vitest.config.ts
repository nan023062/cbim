import {defineConfig} from 'vitest/config';
import CiTestSequencer from './scripts/ci-test-sequencer';
export default defineConfig({test:{include:['tests/**/*.test.ts','tests/**/*.test.mjs','src/**/unittest/**/*.test.ts','src/**/unittest/**/*.test.mjs','scripts/**/unittest/**/*.test.ts','scripts/**/unittest/**/*.test.mjs'],testTimeout:30000,hookTimeout:30000,fileParallelism:false,sequence:{sequencer:CiTestSequencer}}});

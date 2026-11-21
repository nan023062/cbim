import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import {productionTestGuard} from './scripts/production-test-guard.mjs';
export default defineConfig({plugins:[productionTestGuard()],build:{rollupOptions:{external:['electron','koffi',...builtinModules,...builtinModules.map(x=>'node:'+x)]}}});

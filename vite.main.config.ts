import { defineConfig } from 'vite';
import {packagedEngineBuild} from './scripts/engine-package-build.mjs';
import { builtinModules } from 'node:module';
import {productionTestGuard} from './scripts/production-test-guard.mjs';
export default defineConfig({plugins:[productionTestGuard(),packagedEngineBuild()],build:{rollupOptions:{external:['electron','koffi',...builtinModules,...builtinModules.map(x=>'node:'+x)]}}});

import { defineConfig } from 'vite';
import {packagedEngineBuild} from './scripts/engine-package-build.mjs';
import { builtinModules } from 'node:module';
export default defineConfig({plugins:[packagedEngineBuild()],build:{rollupOptions:{external:['electron','koffi',...builtinModules,...builtinModules.map(x=>'node:'+x)]}}});

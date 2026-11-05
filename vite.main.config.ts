import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
export default defineConfig({build:{rollupOptions:{external:['electron','koffi',...builtinModules,...builtinModules.map(x=>'node:'+x)]}}});

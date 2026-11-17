import { defineConfig } from 'vite';
import {productionTestGuard} from './scripts/production-test-guard.mjs';
export default defineConfig({plugins:[productionTestGuard()],build:{rollupOptions:{external:['electron']}}});

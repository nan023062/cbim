import {defineConfig,mergeConfig} from 'vite';
import main from './vite.main.config';
// 固定启动器必须自包含，不能把校验器共享 chunk 放进可更新的资源目录。
export default mergeConfig(main,defineConfig({build:{rollupOptions:{output:{inlineDynamicImports:true}}}}));

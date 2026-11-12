import {defineConfig,mergeConfig} from 'vite';
import main from './vite.main.config';
// 业务入口作为独立 R 导出，由固定冷壳调用；不能裁掉没有静态消费者的 startDesktop。
export default mergeConfig(main,defineConfig({build:{rollupOptions:{preserveEntrySignatures:'strict',output:{exports:'named'}}}}));

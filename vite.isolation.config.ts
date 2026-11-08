import {defineConfig,mergeConfig} from 'vite';
import main from './vite.main.config';
// 平台端口单独打包，供可信宿主装配；保留导出，不提供 renderer IPC 或模型可选路径。
export default mergeConfig(main,defineConfig({build:{rollupOptions:{preserveEntrySignatures:'strict',output:{exports:'named'}}}}));

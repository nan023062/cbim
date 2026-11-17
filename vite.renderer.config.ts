import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {productionTestGuard} from './scripts/production-test-guard.mjs';
// 公共依赖按职责分包，不提高告警阈值；页面自身的动态入口决定何时请求。
export default defineConfig({plugins:[productionTestGuard(),react()],base:'./',build:{rollupOptions:{output:{
  onlyExplicitManualChunks:true,
  manualChunks(id){
    const normalized=id.replaceAll('\\','/');
    if(!normalized.includes('/node_modules/'))return;
    if(/\/(react|react-dom|scheduler)\//.test(normalized))return 'react-runtime';
    if(/\/(highlight\.js|lowlight|rehype-highlight)\//.test(normalized))return 'syntax-highlight';
    if(/\/(react-markdown|remark-[^/]+|rehype-[^/]+|unified|micromark[^/]*|mdast-[^/]+|hast-[^/]+|vfile[^/]*|unist-[^/]+)\//.test(normalized))return 'markdown';
    if(/\/zod\//.test(normalized))return 'validation';
  },
}}}});

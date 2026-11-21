// 编排与适配按领域归属；公开文件单独登记，规则不得依赖运行服务。
export const engineRoot='src/engine-plugins/';
export const isEngine=file=>file.startsWith(engineRoot);
export const runtimePublicEntries=new Set([
  "src/engine-plugins/claude/engine.ts",
  "src/engine-plugins/codex/engine.ts",
  "src/engine-plugins/pi/engine.ts",
  "src/engine-plugins/pi/rpc.ts",
  "src/engine-plugins/runtime-binding.ts",
]);

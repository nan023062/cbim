// 应用服务与数据端口的明确入口，纯协议不能加载服务或平台实现。
export const serviceRoots=[
  "src/logic/engines/packages/",
  "src/logic/engines/service/",
  "src/logic/application/",
  "src/logic/execution/platform/",
  "src/resource/connections/service/",
  "src/logic/updates/service/",
  "src/logic/updates/service/"
];
export const isService=file=>serviceRoots.some(root=>file.startsWith(root));
export const servicePublicEntries=new Set([
  "src/logic/updates/service/engine-index.ts",
  "src/logic/updates/service/download-service.ts",
  "src/logic/engines/packages/index.ts",
  "src/logic/updates/service/engine-artifacts.ts",
  "src/logic/engines/service/index.ts",
  "src/resource/connections/service/repository-connections.ts",
  "src/logic/execution/platform/tool-guard.ts",
  "src/logic/updates/service/desktop-releases.ts",
  "src/logic/updates/service/desktop-updates.ts",
  "src/logic/updates/service/restart-profile.ts",
  "src/logic/updates/service/runtime-host.ts",
  "src/logic/updates/service/runtime-journal.ts",
  "src/logic/updates/service/runtime-manifest.ts",
  "src/logic/updates/service/runtime-store.ts",
  "src/logic/updates/service/runtime-updates.ts",
]);
export const businessDataEntries=new Set([
  "src/logic/updates/engine-artifacts.ts",
  "src/logic/updates/contracts.ts"
]);

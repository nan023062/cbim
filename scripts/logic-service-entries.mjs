// 应用服务与数据端口的明确入口，纯协议不能加载服务或平台实现。
export const serviceRoots=[
  "src/logic-new/engines/packages/",
  "src/logic-new/engines/service/",
  "src/logic-new/application/",
  "src/logic-new/execution/platform/",
  "src/resource/connections/service/",
  "src/logic-new/updates/service/",
  "src/logic-new/updates/service/"
];
export const isService=file=>serviceRoots.some(root=>file.startsWith(root));
export const servicePublicEntries=new Set([
  "src/logic-new/updates/service/engine-index.ts",
  "src/logic-new/updates/service/download-service.ts",
  "src/logic-new/engines/packages/index.ts",
  "src/logic-new/updates/service/engine-artifacts.ts",
  "src/logic-new/engines/service/index.ts",
  "src/resource/connections/service/repository-connections.ts",
  "src/logic-new/execution/platform/tool-guard.ts",
  "src/logic-new/updates/service/desktop-releases.ts",
  "src/logic-new/updates/service/desktop-updates.ts",
  "src/logic-new/updates/service/restart-profile.ts",
  "src/logic-new/updates/service/runtime-host.ts",
  "src/logic-new/updates/service/runtime-journal.ts",
  "src/logic-new/updates/service/runtime-manifest.ts",
  "src/logic-new/updates/service/runtime-store.ts",
  "src/logic-new/updates/service/runtime-updates.ts",
]);
export const businessDataEntries=new Set([
  "src/logic-new/updates/engine-artifacts.ts",
  "src/logic-new/updates/contracts.ts"
]);

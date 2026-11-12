// 冷包与 R-only 构建共用入口和 Forge 配置生成器，避免两条流水线产出不同的主进程代码。
export const desktopBuilds={build:[
  {entry:'src/backend/bootstrap/desktop.ts',config:'vite.bootstrap.config.ts',target:'main' as const},
  {entry:'src/backend/main/main.ts',config:'vite.application.config.ts',target:'main' as const},
  {entry:'src/backend/main/platform/files/controlled-file-child.ts',config:'vite.main.config.ts',target:'main' as const},
  {entry:'src/backend/main/platform/isolation/isolated-node.ts',config:'vite.isolation.config.ts',target:'main' as const},
  {entry:'src/bridge/preload/preload.ts',config:'vite.preload.config.ts',target:'preload' as const},
],renderer:[{name:'main_window',config:'vite.renderer.config.ts'}]};

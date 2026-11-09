/** 打包前检查 SVG 与已生成原生图标的摘要，不启动渲染器。 */
export function verifyBrandAssets(): Promise<{source:string;sizes:number[];sha256:Record<string,string>}>;

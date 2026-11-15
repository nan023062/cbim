import path from 'node:path';
/** 正式资源产物不内嵌源码适配器；开发和责任单元仍直接运行源码兼容表。 */
export function packagedEngineBuild(){return {name:'cbim-official-engine-packages',enforce:'pre',resolveId(source,importer){
  if(source==='./engine-adapters'&&importer?.replaceAll('\\','/').endsWith('/src/logic/execution/assembly/loop-engine.ts'))return path.join(path.dirname(importer),'packaged-engine-adapters.ts');
}}}

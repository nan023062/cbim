/**
 * 作用定位：Electron 打开原 profile 前，同步核实当前或已授权候选资源，并决定是否进入恢复。
 * 设计原因：启动期只校验较小的 R，不等待引擎下载；未接触数据时允许回退，访问标记一旦存在就拒绝自动降级。
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {RuntimeJournal} from '../../../logic/updates/service/runtime-journal';
import {verifyRuntimeManifest,runtimeRelativePath,type ColdRuntime,type RuntimeManifest,type RuntimeFile} from '../../../logic/updates/service/runtime-manifest';

/** 同步启动校验只处理有限资源，不用于大型引擎包；活动目录不得有额外文件或链接。 */
export function verifyBootResources(root:string,files:RuntimeFile[]){
  if(files.reduce((sum,file)=>sum+file.bytes,0)>256*1024*1024||files.some(file=>file.bytes>64*1024*1024))throw Error('启动资源超过冷壳支持的上限');
  const expected=new Map(files.map(file=>[file.path,file]));let count=0;
  if(fs.lstatSync(root).isSymbolicLink())throw Error('资源目录不能是链接');
  function walk(directory:string){
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const file=path.join(directory,entry.name),relative=path.relative(root,file).split(path.sep).join('/');runtimeRelativePath(relative);
      if(entry.isSymbolicLink())throw Error('资源目录包含链接');
      if(entry.isDirectory()){if(!files.some(item=>item.path.startsWith(relative+'/')))throw Error('资源目录包含多余内容');walk(file);continue;}
      const target=expected.get(relative),stat=fs.lstatSync(file);
      if(!target||!stat.isFile()||stat.nlink>1||stat.size!==target.bytes||createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==target.sha256)throw Error('启动资源校验失败');count++;
    }
  }
  walk(root);if(count!==files.length)throw Error('启动资源不完整');
}
function readJson(file:string){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw Error('资源清单文件无效');return JSON.parse(fs.readFileSync(file,'utf8'))}
export interface BootSelection {root:string;manifest:RuntimeManifest;digest:string;journal:RuntimeJournal;pending:boolean}

/** 与 cacheRoot 对应的单实例锁由桌面入口取得；返回后仍须先记 data-access 才可导入业务。 */
export function selectBootResources(cold:ColdRuntime,cacheRoot:string,bundledRoot:string,bundledManifest:string,stateDirectory=path.join(cacheRoot,'state')):BootSelection{
  const initial=verifyRuntimeManifest(readJson(bundledManifest),cold,{installed:true});
  const journal=new RuntimeJournal(stateDirectory,{digest:initial.digest,resourceVersion:initial.manifest.resourceVersion});
  const state=journal.read();if(state.pending?.stage==='data-access')throw Error('RESOURCE_RECOVERY_REQUIRED：上次更新已访问用户数据但未确认启动，请从恢复窗口重试原候选。');
  function resolve(digest:string){
    const checked=digest===initial.digest?initial:verifyRuntimeManifest(readJson(path.join(cacheRoot,'manifests',digest+'.json')),cold,{installed:true});
    if(checked.digest!==digest)throw Error('启动资源身份不符');
    const root=digest===initial.digest?bundledRoot:path.join(cacheRoot,'packages',checked.manifest.resource.sha256);
    verifyBootResources(root,checked.manifest.resource.files);return {...checked,root};
  }
  let selected:ReturnType<typeof resolve>,pending=!!state.pending;
  try{selected=resolve(state.pending?.digest??state.confirmed)}catch(error){
    if(!state.pending||state.pending.dataAccessed)throw error;journal.rejectBeforeData(state.pending.digest);selected=resolve(state.confirmed);pending=false;
  }
  return {root:selected.root,manifest:selected.manifest,digest:selected.digest,journal,pending};
}

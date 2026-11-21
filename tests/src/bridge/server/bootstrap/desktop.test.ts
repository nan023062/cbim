import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';
import type {DesktopRuntimeHost} from '../../../../../src/logic/updates/service/runtime-host';

const sourceRoot=path.resolve('src/bridge/server');
const compile=(file:string)=>ts.transpileModule(readFileSync(path.join(sourceRoot,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const desktopCode=compile('bootstrap/desktop.ts');

// 读取真实业务模块的导出名，但不执行窗口和业务生命周期；错误的入口拼写不能由同名替身掩盖。
const businessExports:Record<string,unknown>={};
runInNewContext(compile('desktop/main.ts'),{exports:businessExports,require:()=>({})});

function boot(packaged:boolean,failure?:Error){
  const start=vi.fn((_runtime?:DesktopRuntimeHost)=>{if(failure)throw failure});
  const implementation=Object.fromEntries(Object.keys(businessExports).map(name=>[name,start]));
  const loadApplication=vi.fn(()=>implementation);
  const cold={schema:1,codeVersion:'0.1.21',platform:process.platform+'-'+process.arch};
  const app={isPackaged:packaged,getVersion:()=>cold.codeVersion,getPath:(name:string)=>path.resolve('test-results/bootstrap',name),setPath:vi.fn(),requestSingleInstanceLock:vi.fn(()=>true),quit:vi.fn(),exit:vi.fn(),on:vi.fn()};
  const dialog={showErrorBox:vi.fn()};
  const selection={root:path.resolve('test-results/bootstrap/selected'),digest:'selected-digest',pending:true,manifest:{resourceVersion:'r2'},envelope:{},journal:{AccessData:vi.fn(),Confirm:vi.fn()}};
  const selectBootResources=vi.fn(()=>selection);
  const runtimeStore=vi.fn();
  const engineArtifacts=vi.fn();
  const dependencies:Record<string,unknown>={
    electron:{app,dialog},
    'node:fs':{readFileSync:vi.fn(()=>JSON.stringify(cold)),existsSync:()=>false},
    'node:path':path,
    'node:crypto':{createHash},
    'node:module':{createRequire:()=>loadApplication},
    './selection':{selectBootResources},
    '../../../logic/updates/service/runtime-journal':{},
    '../../../logic/updates/service/runtime-manifest':{},
    '../../../logic/updates/service/engine-artifacts':{EngineArtifacts:engineArtifacts},
    '../../../logic/updates/service/runtime-store':{RuntimeStore:runtimeStore},
    '../../../logic/updates/service/runtime-updates':{RuntimeUpdates:vi.fn()},
    '../../../logic/updates/service/desktop-updates':{DesktopUpdates:vi.fn()},
    '../../../updater':{NsisUpdateInstaller:vi.fn()},
    '../../../logic/updates/service/engine-index':{officialEnginePublicKey:'key'},
    '../../../logic/updates/service/download-service':{DownloadService:vi.fn()},
    '../../../logic/updates/service/restart-profile':{updateUserRoot:()=>undefined},
  };
  const directory=path.resolve('test-results/bootstrap/build');
  runInNewContext(desktopCode,{
    exports:{},__dirname:directory,__filename:path.join(directory,'desktop.js'),AbortController,
    process:{argv:[],env:{},platform:process.platform,arch:process.arch,resourcesPath:path.resolve('test-results/bootstrap/resources')},
    require:(name:string)=>{if(!(name in dependencies))throw Error('Unexpected dependency: '+name);return dependencies[name]},
  });
  return {start,app,dialog,selection,selectBootResources,loadApplication,directory};
}

it('starts development through the actual business export without a packaged runtime',()=>{
  const result=boot(false);
  expect(result.loadApplication).toHaveBeenCalledExactlyOnceWith(path.join(result.directory,'main.js'));
  expect(result.start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({cacheRoot:expect.any(String),Confirm:expect.any(Function)}));
  expect(result.selectBootResources).not.toHaveBeenCalled();
  expect(result.dialog.showErrorBox).not.toHaveBeenCalled();
  expect(result.app.exit).not.toHaveBeenCalled();
});

it('starts the selected packaged resources with their trusted host after recording data access',()=>{
  const result=boot(true);
  expect(result.loadApplication).toHaveBeenCalledExactlyOnceWith(path.join(result.selection.root,'.vite/build/main.js'));
  expect(result.start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({assetsRoot:result.selection.root,codeVersion:'0.1.21',resourceVersion:'r2'}));
  expect(result.selection.journal.AccessData).toHaveBeenCalledExactlyOnceWith(result.selection.digest);
  expect(result.selection.journal.AccessData.mock.invocationCallOrder[0]).toBeLessThan(result.loadApplication.mock.invocationCallOrder[0]);
  result.start.mock.calls[0][0]!.Confirm();
  expect(result.selection.journal.Confirm).toHaveBeenCalledExactlyOnceWith(result.selection.digest);
  expect(result.dialog.showErrorBox).not.toHaveBeenCalled();
  expect(result.app.exit).not.toHaveBeenCalled();
});

it.each([false,true])('reports startup failure and exits without retrying (packaged=%s)',packaged=>{
  const result=boot(packaged,Error('business startup failed'));
  expect(result.start).toHaveBeenCalledTimes(1);
  expect(result.loadApplication).toHaveBeenCalledTimes(1);
  expect(result.dialog.showErrorBox).toHaveBeenCalledExactlyOnceWith('CBIM 启动资源验证失败',expect.stringContaining('business startup failed'));
  expect(result.app.exit).toHaveBeenCalledExactlyOnceWith(1);
});

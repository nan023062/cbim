/**
 * 文件工人边界：app.ready 后装配独立打包 utility 入口，不复用窗口主入口作为工人；退出等待所有原文件操作排空。
 * 作用定位：本机后端的 Electron 装配入口，管理窗口、固定 IPC、原生文件选择、附件预览与打包验证；前端只通过 bridge/preload 请求服务。
 * 设计原因：把 Electron 窗口与 IPC 留在唯一桌面入口，服务层可以脱离窗口验证；模型凭据加密通过系统 safeStorage 注入；手动终端固定工作区目录，退出时释放子进程。
 * 附件边界：原生多选超过12项时在任何快照导入前拒绝；安全等待的 importId 贯穿选择器，取消后迟到路径不读取、不返回给另一目标。
 * GitHub 登录只在桌面点击后打开固定官方 Device Flow 页面，不接收重定向地址或令牌。
 * 桌面更新只装配在正式 NSIS 包中；检查不下载、下载不退出。显式安装先拒绝新请求并等待正常业务排空。
 */
import {app,BrowserWindow,ipcMain,dialog,shell} from 'electron';
import {createControlledFileTransport} from './platform/controlled-file-transport';
import path from 'node:path';
import fs from 'node:fs/promises';
import {TerminalSessions} from './platform/terminal';
import {Application} from './application';
import {ChatInputs} from './persistence/tasks/chat-inputs';
import {systemSecretCipher} from './platform/secrets';
import {Paths} from './platform/paths';
import {json} from '../core/foundation/serialization';
import {knowledgeTools} from '../scheduler-engine/tools/knowledge-tools';
import {DesktopUpdates} from '../updater/desktop-updates';
import {latestDesktopRelease} from '../updater/desktop-releases';
import {NsisUpdateInstaller} from '../updater/nsis-updater';
import {updateUserRoot} from '../updater/restart-profile';
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL:string;
declare const MAIN_WINDOW_VITE_NAME:string;
const terminals=new TerminalSessions();
let application:Application;let quitting=false;let window:BrowserWindow;let updates:DesktopUpdates|undefined;
// 安装器通过显式参数保留自定义目录；重新设置环境供下一次更新继续传递，不读取或传递任何凭据。
const userRoot=updateUserRoot(process.argv,process.env.CBIM_USER_DATA_ROOT);
if(userRoot)process.env.CBIM_USER_DATA_ROOT=userRoot;
if(userRoot){app.setPath('userData',path.join(userRoot,'desktop'));app.setPath('sessionData',path.join(userRoot,'desktop'))}
else {const root=path.join(app.getPath('home'),'.cbim');app.setPath('userData',path.join(root,'desktop'));app.setPath('sessionData',path.join(root,'desktop'))}
app.whenReady().then(async()=>{
  const install=app.isPackaged?process.resourcesPath:app.getAppPath();
  app.setAppUserModelId('com.cbim.assistant.desktop');
  let release:{channel?:string;version?:string;notes?:string}={};try{release=JSON.parse(await fs.readFile(path.join(install,'desktop-release.json'),'utf8'))}catch{}
  const installed=app.isPackaged&&process.platform==='win32'&&process.arch==='x64'&&release.channel==='desktop-stable'&&release.version===app.getVersion()&&await fs.access(path.join(path.dirname(app.getPath('exe')),'Uninstall CBIM Desktop.exe')).then(()=>true,()=>false);
  if(installed&&!app.requestSingleInstanceLock()){app.quit();return}
  updates=new DesktopUpdates(app.getVersion(),typeof release.notes==='string'?release.notes:'',installed,latestDesktopRelease,new NsisUpdateInstaller());
  application=new Application(new Paths(userRoot,app.isPackaged?path.dirname(app.getPath('exe')):install),path.join(install,'design'),systemSecretCipher,{controlledFiles:createControlledFileTransport()});await application.init();
  window=new BrowserWindow({width:1320,height:860,minWidth:760,minHeight:520,title:'CBIM Assistant',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event)=>event.preventDefault());
  app.on('second-instance',()=>{if(window.isMinimized())window.restore();window.focus()});
  // 拖放走独立 IPC；与原生选择器共用快照和 .cbim 边界检查。
  ipcMain.handle('cbim:drop',async(event,request:{id:string;paths:string[]})=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('UNAUTHORIZED');
    try{if(!request||!Array.isArray(request.paths)||!request.paths.length||request.paths.length>12||request.paths.some(p=>typeof p!=='string'))throw Error('无效文件列表');
      const inputs=new ChatInputs(application.workspace(request.id));const items=[];
      for(const file of request.paths){const stat=await fs.stat(file);items.push(await inputs.path(stat.isDirectory()?'folder':'file',file))}return {ok:true,value:items};
    }catch(e:any){return {ok:false,error:{message:e.message}}}
  });
  ipcMain.handle('cbim:call',async(event,action:string,args:unknown)=>{if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('UNAUTHORIZED');
    if(action.startsWith('desktop.updates.'))try{
      if(args!==undefined&&args!==null&&(!(typeof args==='object')||Array.isArray(args)||Object.keys(args).length))throw Error('更新操作不接受地址、路径或命令');
      const value=action==='desktop.updates.status'?updates!.status():action==='desktop.updates.check'?await updates!.check():action==='desktop.updates.download'?await updates!.download():action==='desktop.updates.install'?await updates!.install(async()=>{terminals.closeAll();await application.shutdown();quitting=true}):(()=>{throw Error('未知更新操作')})();
      return {ok:true,value};
    }catch{return {ok:false,error:{code:'DESKTOP_UPDATE',message:'更新操作未能完成，请检查当前状态后重试。'}}}
    if(updates?.status().phase==='installing')return {ok:false,error:{code:'UPDATING',message:'正在关闭任务并安装更新，请稍后重新打开。'}};
    if(action.startsWith('terminal.'))try{
      const request=args as {id:string;tabId:string;command:string};if(!/^[a-zA-Z0-9-]{1,100}$/.test(request.tabId))throw Error('无效终端页签');const key=request.id+':'+request.tabId;if(action==='terminal.close'){terminals.close(key);return {ok:true,value:undefined}}const ws=application.workspace(request.id);ws.assert();
      const value=action==='terminal.start'?terminals.start(key,ws.entry.path,request.command):action==='terminal.read'?terminals.read(key):action==='terminal.close'?terminals.close(key):(()=>{throw Error('未知终端操作')})();return {ok:true,value};
    }catch(e:any){return {ok:false,error:{message:e.message}}}
    if(action==='github.feedback.openLogin')try{await shell.openExternal('https://github.com/login/device');return {ok:true,value:true}}catch{return {ok:false,error:{code:'GITHUB_LOGIN_PAGE',message:'GitHub 登录页未能打开，请在浏览器访问 https://github.com/login/device'}}}
    if(action==='chat.openLink')try{
      // 只有用户点击才打开链接；业务产物必须属于当前工作区且不是可执行程序。
      const request=args as {id:string;target:string};const owner=application.workspace(request.id);
      if(typeof request.target!=='string')throw Error('无效链接');
      if(/^https?:\/\//i.test(request.target)){const url=new URL(request.target);if(url.username||url.password)throw Error('不支持包含凭据的链接');await shell.openExternal(url.href)}
      else{
        const root=await fs.realpath(owner.entry.path),file=await fs.realpath(path.resolve(root,decodeURIComponent(request.target)));
        const relative=path.relative(root,file);
        if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>p.toLowerCase()==='.cbim'))throw Error('只能打开当前工作区的业务产物');
        if(!/\.(html?|txt|md|pdf|png|jpe?g|gif|webp|svg)$/i.test(file))throw Error('该文件类型暂不支持直接打开');
        const error=await shell.openPath(file);if(error)throw Error(error);
      }return {ok:true,value:true};
    }catch(e:any){return {ok:false,error:{code:'OPEN_LINK',message:e.message}}}
    if(action==='chat.pick')try{
      const request=args as {id:string;kind:string;importId?:string};if(!['file','folder'].includes(request.kind))throw Error('未知附件类型');
      if(request.importId!==undefined){const value=await application.chatMaterials.pick(request,async()=>{const result=await dialog.showOpenDialog(window,{properties:request.kind==='folder'?['openDirectory']:['openFile','multiSelections']});return result.canceled?[]:result.filePaths});return {ok:true,value}}
      const inputs=new ChatInputs(application.workspace(request.id));const result=await dialog.showOpenDialog(window,{properties:request.kind==='folder'?['openDirectory']:['openFile','multiSelections']});
      // 在导入第一份快照前拒绝超量选择，不能静默裁剪用户明确选中的资料。
      if(!result.canceled&&result.filePaths.length>12)throw Error('最多选择12个附件，请减少选择后重试');
      const items=[];if(!result.canceled)for(const file of result.filePaths)items.push(await inputs.path(request.kind as 'file'|'folder',file));return {ok:true,value:items};
    }catch(e:any){return {ok:false,error:{code:e.code||'ATTACHMENT',message:e.message}}}
    try{if(action==='chooseFolder'){const result=await dialog.showOpenDialog(window,{properties:['openDirectory']});return {ok:true,value:result.canceled?null:result.filePaths[0]}}return {ok:true,value:await application.dispatch(action,args)}}catch(e:any){return {ok:false,error:{code:e.code||'ERROR',message:e.message}}}});
  if(MAIN_WINDOW_VITE_DEV_SERVER_URL)await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);else await window.loadFile(path.join(__dirname,`../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  updates.start();
  // 仅隔离数据目录下的显式打包测试可写入样本；正常启动走运行授权策略。
  if(process.env.CBIM_SMOKE_ROOT&&userRoot){
    const entry=await application.catalog.add(process.env.CBIM_SMOKE_ROOT),ws=await application.open(entry.id),snap=await ws.snapshot();
    const tools=knowledgeTools(ws),identity={workspaceId:entry.id,instanceId:ws.instanceId};
    const invoke=async(name:string,args:Record<string,unknown>={},write=false)=>{
      const result=await tools.callFromRun(name,name==='cbim_workspace_identity'?{}:{...identity,...args},write);
      return JSON.parse(result.content[0].text);
    };
    const current=await invoke('cbim_workspace_identity');
    if(current.workspaceId!==entry.id||current.instanceId!==ws.instanceId||!tools.list().some(t=>t.name==='cbim_knowledge_snapshot'))throw Error('Packaged internal knowledge verification failed');
    for(const tool of ['cbim_skill_knowledge_query','cbim_skill_business_execution','cbim_skill_knowledge_governance','cbim_skill_architecture_governance','cbim_skill_create_agent_skill','cbim_skill_create_workflow','cbim_skill_core_check'])await invoke(tool);
    const plan=await invoke('cbim_object_preview',{revision:snap.revision,operations:[{kind:'agent',action:'create',parentId:'.cbim/team',slug:'smoke_agent',data:{name:'Smoke',summary:'portabletest'.repeat(12),capabilities:['test']},body:'# Principles'}]});
    await invoke('cbim_object_commit',{planId:plan.planId},true);
    const agent=await invoke('cbim_agent_get',{id:plan.objects[0]});
    if(!agent.principles.available)throw Error('Packaged object CRUD failed');
    const catalog=await invoke('cbim_builtin_catalog');
    for(const item of catalog.items){const document=await invoke('cbim_builtin_read',{id:item.id,expectedVersion:item.version});if(!document.text)throw Error('Packaged builtin read failed: '+item.id)}
    await fs.writeFile(path.join(userRoot,'smoke-result.json'),json({packaged:app.isPackaged,workspaceId:entry.id,files:snap.files.length,internalKnowledge:true,builtins:true,objectCrud:true,workspaceState:ws.state,structural:snap.validation?.structural}));
    await application.shutdown();app.quit();
  }
}).catch(e=>{dialog.showErrorBox('CBIM Assistant 启动失败',e.message+'\n请检查用户数据目录权限及程序资源。');app.exit(1)});
app.on('before-quit',event=>{if(!quitting&&application){event.preventDefault();quitting=true;terminals.closeAll();void application.shutdown().then(()=>app.quit()).catch(e=>{quitting=false;dialog.showErrorBox('工作区关闭失败',e.message+'\n请保留运行窗口并重试。')})}});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>updates?.close());

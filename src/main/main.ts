import {app,BrowserWindow,ipcMain,dialog} from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import {Application} from './application';
import {Paths,json} from './paths';
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL:string;
declare const MAIN_WINDOW_VITE_NAME:string;
let application:Application;let quitting=false;let window:BrowserWindow;
const userRoot=process.env.CBIM_USER_DATA_ROOT;
if(userRoot){app.setPath('userData',path.join(userRoot,'desktop'));app.setPath('sessionData',path.join(userRoot,'desktop'))}
else {const root=path.join(app.getPath('home'),'.cbim');app.setPath('userData',path.join(root,'desktop'));app.setPath('sessionData',path.join(root,'desktop'))}
app.whenReady().then(async()=>{
  const install=app.isPackaged?process.resourcesPath:app.getAppPath();
  application=new Application(new Paths(userRoot,app.isPackaged?path.dirname(app.getPath('exe')):install),path.join(install,'design'));await application.init();
  window=new BrowserWindow({width:1320,height:860,minWidth:760,minHeight:520,title:'CBIM Assistant',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event)=>event.preventDefault());
  ipcMain.handle('cbim:call',async(event,action:string,args:unknown)=>{if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('UNAUTHORIZED');
    try{if(action==='chooseFolder'){const result=await dialog.showOpenDialog(window,{properties:['openDirectory']});return {ok:true,value:result.canceled?null:result.filePaths[0]}}return {ok:true,value:await application.dispatch(action,args)}}catch(e:any){return {ok:false,error:{code:e.code||'ERROR',message:e.message}}}});
  if(MAIN_WINDOW_VITE_DEV_SERVER_URL)await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);else await window.loadFile(path.join(__dirname,`../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  await application.restore();
  // Packaged smoke execution is opt-in and requires an isolated data root.
  if(process.env.CBIM_SMOKE_ROOT&&userRoot){const entry=await application.catalog.add(process.env.CBIM_SMOKE_ROOT);const ws=await application.open(entry.id);const snap=await ws.snapshot();await fs.writeFile(path.join(userRoot,'smoke-result.json'),json({packaged:app.isPackaged,workspaceId:entry.id,files:snap.files.length,mcp:ws.state,structural:snap.validation?.structural}));await application.shutdown();app.quit()}
}).catch(e=>{dialog.showErrorBox('CBIM Assistant 启动失败',e.message+'\n请检查用户数据目录权限及程序资源。');app.exit(1)});
app.on('before-quit',event=>{if(!quitting&&application){event.preventDefault();quitting=true;void application.shutdown().then(()=>app.quit()).catch(e=>{quitting=false;dialog.showErrorBox('工作区关闭失败',e.message+'\n请保留运行窗口并重试。')})}});
app.on('window-all-closed',()=>app.quit());

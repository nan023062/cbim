// 仅供品牌构建的离屏 Chromium 宿主；与产品主进程及真实用户资料完全分离。
const {app,BrowserWindow}=require('electron');
const path=require('node:path');
app.setPath('userData',path.resolve('build/brand-renderer-profile'));
app.whenReady().then(()=>{
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  void window.loadURL('about:blank');
});
app.on('window-all-closed',()=>app.quit());

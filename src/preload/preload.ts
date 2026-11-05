import {contextBridge,ipcRenderer} from 'electron';
contextBridge.exposeInMainWorld('cbim',{call:async(action:string,args:unknown)=>{const result=await ipcRenderer.invoke('cbim:call',action,args);if(!result.ok)throw new Error(`${result.error.code}: ${result.error.message}`);return result.value}});

/**
 * 作用定位：前后端通信边界的 Electron 安全桥，仅向 window.cbim 暴露固定 call 与系统 File 导入，通过 cbim:call IPC 请求本机后端。
 * 设计原因：只开放固定 IPC 调用桥，渲染页面不获得 Node 或任意 Electron API。
 * 契约边界：实现 Bridge 的关联调用签名；传输不授予权限，主进程仍解析请求，失败沿原错误信封拒绝。
 */
import {contextBridge,ipcRenderer,webUtils} from 'electron';
import type {Bridge} from '../contracts/workspace';
/** 只把系统 File 转成路径；截图等无磁盘路径的剪贴板内容不伪装成已上传文件。 */
async function importFiles(id:string,files:File[]){
  if(!Array.isArray(files)||!files.length||files.length>12)throw Error('一次最多添加 12 个文件');
  const paths=files.map(file=>webUtils.getPathForFile(file));if(paths.some(p=>!p))throw Error('此粘贴内容没有本地文件路径，请先保存后选择文件');
  const result=await ipcRenderer.invoke('cbim:drop',{id,paths});if(!result.ok)throw Error(result.error.message);return result.value;
}
const bridge:Bridge={importFiles,call:async(...[action,args])=>{const result=await ipcRenderer.invoke('cbim:call',action,args);if(!result.ok)throw new Error(`${result.error.code}: ${result.error.message}`);return result.value}};
contextBridge.exposeInMainWorld('cbim',bridge);

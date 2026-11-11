/**
 * 作用定位：将当前粘贴事件中的图片 File 转为有界上传字节，不读取全局剪贴板。
 * 设计原因：截图没有磁盘路径，不能伪装系统 File 路径；字节只用于本机快照，格式真实性仍由 Main 校验。
 */
const formats=['image/png','image/jpeg','image/gif','image/webp'] as const;
export async function pastedImage(file:File){
  const mimeType=formats.find(type=>type===file.type);if(!mimeType)throw Error('剪贴板图片格式不支持，请使用 PNG、JPEG、GIF 或 WebP');
  if(!file.size||file.size>5*1024*1024)throw Error('单张剪贴板图片需小于 5 MiB');
  const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size)throw Error('剪贴板图片读取不完整');
  let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return {name:(file.name||'剪贴板图片.png').slice(0,255),mimeType,data:btoa(binary)};
}

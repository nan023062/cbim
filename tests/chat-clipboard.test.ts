import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fixture} from './helpers';
import {ChatInputs} from '../src/logic/materials/service/chat-inputs';
import {pastedLocalPaths} from '../src/bridge/contracts/chat';
import {pastedImage} from '../src/view/conversation/pasted-images';
import {ComposerAttachments} from '../src/view/execution-view/ComposerAttachments';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2X8AAAAASUVORK5CYII=','base64');
it('仅完整绝对路径列表识别为引用，普通文字和混合内容保留原文',()=>{
 expect(pastedLocalPaths('"C:\\工作目录\\a.txt"\r\nC:\\工作目录\\文件夹')).toEqual(['C:\\工作目录\\a.txt','C:\\工作目录\\文件夹']);
 expect(pastedLocalPaths('file:///C:/a%20b.png')).toEqual(['file:///C:/a%20b.png']);expect(pastedLocalPaths('/home/user/a.md')).toEqual(['/home/user/a.md']);
 for(const text of ['请查看 C:\\a.txt','C:\\a.txt\n谢谢','https://example.com','relative.txt','\\\\server\\share','../secret',''])expect(pastedLocalPaths(text)).toBeUndefined();
});
it('截图无磁盘路径仍保留字节、名称、来源和时间，预览/视觉/等待补充读同一快照',async()=>{
 const f=await fixture();try{
  const entry=await f.app.dispatch('add',{path:f.a}),inputs=new ChatInputs(f.app.workspace(entry.id));
  const prepared=await pastedImage(new File([png],'截图.png',{type:'image/png'}));expect(prepared.data).toBe(png.toString('base64'));
  const attachment=await f.app.dispatch('chat.image',{id:entry.id,...prepared});expect(attachment.source).toMatch(/^clipboard:\/\/image\//);expect(attachment.name).toBe('截图.png');expect(attachment.note).toMatch(/\d{4}-\d{2}-\d{2}T/);expect(JSON.stringify(attachment)).not.toContain(prepared.data);
  const preview=await f.app.dispatch('chat.preview',{id:entry.id,attachmentId:attachment.id});expect(preview.image).toEqual({mimeType:'image/png',data:prepared.data});
  expect(await inputs.images([attachment.id])).toEqual([{type:'image',mimeType:'image/png',data:prepared.data}]);
  const continuation=await inputs.prepareContinuation('看截图',[attachment.id],new AbortController().signal);expect(continuation.images[0].data).toBe(prepared.data);expect(continuation.message).toContain(attachment.source);expect(continuation.message).not.toContain(prepared.data);
  const html=renderToStaticMarkup(createElement(ComposerAttachments,{items:[attachment],workspaceId:entry.id,disabled:false,onRemove:()=>{}}));expect(html).toContain('预览附件 截图.png');expect(html).toContain('移除附件 截图.png');expect(html).toContain(attachment.source.replace(/&/g,'&amp;'));
 }finally{await f.cleanup()}
});
it('明确路径导入校验存在、文件夹种类与工作区隔离，源修改不改写已保存正文',async()=>{
 const f=await fixture();try{
  const entry=await f.app.dispatch('add',{path:f.a}),other=await f.app.dispatch('add',{path:f.b}),file=path.join(f.temp,'原始 文件.txt');await fs.writeFile(file,'原始正文');
  const [attachment,folder]=await f.app.dispatch('chat.paths',{id:entry.id,paths:[pathToFileURL(file).href,f.b]});expect(attachment.source).toBe(await fs.realpath(file));expect(folder.kind).toBe('folder');await fs.writeFile(file,'后来修改');
  expect((await f.app.dispatch('chat.preview',{id:entry.id,attachmentId:attachment.id})).text).toBe('原始正文');expect(await new ChatInputs(f.app.workspace(entry.id)).message('读文件',[attachment.id])).toContain('原始正文');
  await expect(f.app.dispatch('chat.preview',{id:other.id,attachmentId:attachment.id})).rejects.toThrow();
  const directory=path.join(f.app.paths.project(entry.id),'chat-inputs'),before=await fs.readdir(directory);
  await expect(f.app.dispatch('chat.paths',{id:entry.id,paths:[file,path.join(f.temp,'不存在')]})).rejects.toThrow();expect(await fs.readdir(directory)).toEqual(before);
  await expect(f.app.dispatch('chat.paths',{id:entry.id,paths:[path.join(f.a,'.cbim')]})).rejects.toThrow('知识库');
  for(const invalid of ['relative.txt','\\\\server\\share','file://server/share'])await expect(f.app.dispatch('chat.paths',{id:entry.id,paths:[invalid]})).rejects.toThrow();
 }finally{await f.cleanup()}
});
it('拒绝伪造类型、非规范 base64、过量图片和未知字段，不保存坏快照',async()=>{
 const f=await fixture();try{
  const entry=await f.app.dispatch('add',{path:f.a});
  for(const request of [{name:'x.png',mimeType:'image/png',data:Buffer.from('not an image').toString('base64')},{name:'x.jpg',mimeType:'image/jpeg',data:png.toString('base64')},{name:'x.png',mimeType:'image/png',data:png.toString('base64')+'\n'},{name:'x.png',mimeType:'image/png',data:Buffer.concat([png,Buffer.alloc(5*1024*1024)]).toString('base64')}])await expect(f.app.dispatch('chat.image',{id:entry.id,...request} as any)).rejects.toThrow();
  await expect(f.app.dispatch('chat.image',{id:entry.id,name:'x.svg',mimeType:'image/svg+xml',data:'PHN2Zz4='} as any)).rejects.toThrow();
  await expect(f.app.dispatch('chat.paths',{id:entry.id,paths:Array(13).fill(f.a)})).rejects.toThrow();
  await expect(pastedImage(new File(['<svg/>'],'x.svg',{type:'image/svg+xml'}))).rejects.toThrow();
  await expect(pastedImage(new File([Buffer.alloc(5*1024*1024+1)],'x.png',{type:'image/png'}))).rejects.toThrow();
 }finally{await f.cleanup()}
});

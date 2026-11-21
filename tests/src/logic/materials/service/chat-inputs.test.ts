// logic/materials/service: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from '../../application/support/helpers';
import {ChatInputs} from '../../../../../src/logic/materials/service/chat-inputs';
it('损坏附件 JSON 不能经公开预览返回伪造的字符串字段',async()=>{
 const f=await fixture();try{
  const entry=await f.app.Dispatch('add',{path:f.a}),inputs=new ChatInputs(f.app.Workspace(entry.id));
  const file=path.join(f.a,'contract.txt');await fs.writeFile(file,'saved');const item=await inputs.Path('file',file);
  const saved=path.join(f.app.paths.Project(entry.id),'chat-inputs',item.id+'.json');
  await fs.writeFile(saved,JSON.stringify({...item,text:{secret:'not preview text'}}));
  await expect(f.app.Dispatch('chat.preview',{id:entry.id,attachmentId:item.id})).rejects.toThrow();
 }finally{await f.cleanup()}
});
it('attachment preview uses the saved snapshot and rejects another workspace or path traversal',async()=>{
 const f=await fixture();try{const a=await f.app.Dispatch('add',{path:f.a}),b=await f.app.Dispatch('add',{path:f.b});const inputs=new ChatInputs(f.app.Workspace(a.id));const file=path.join(f.a,'preview.txt');await fs.writeFile(file,'ORIGINAL');const attachment=await inputs.Path('file',file);await fs.writeFile(file,'CHANGED');expect(await f.app.Dispatch('chat.preview',{id:a.id,attachmentId:attachment.id})).toMatchObject({name:'preview.txt',text:'ORIGINAL'});await expect(f.app.Dispatch('chat.preview',{id:b.id,attachmentId:attachment.id})).rejects.toThrow();await expect(inputs.Preview('../credentials')).rejects.toThrow();}finally{await f.cleanup()}
});
it('附件快照按工作区隔离，发送时使用选择时文本，拒绝知识路径和越界 ID',async()=>{
 const f=await fixture();try{const a=await f.app.Dispatch('add',{path:f.a}),b=await f.app.Dispatch('add',{path:f.b}),inputs=new ChatInputs(f.app.Workspace(a.id));const file=path.join(f.a,'note.txt');await fs.writeFile(file,'SNAPSHOT_TEXT');const item=await inputs.Path('file',file);await fs.writeFile(file,'CHANGED');const message=await inputs.Message('看看',[item.id]);expect(message).toContain('SNAPSHOT_TEXT');expect(message).not.toContain('CHANGED');await expect(new ChatInputs(f.app.Workspace(b.id)).Message('cross',[item.id])).rejects.toThrow();await expect(inputs.Message('bad',['../credentials'])).rejects.toThrow();await expect(inputs.Path('folder',path.join(f.a,'.cbim'))).rejects.toThrow('知识库');const dir=await inputs.Path('folder',f.a);expect(await inputs.Message('dir',[dir.id])).not.toContain('目录 .cbim');expect(message.split('\n\n')[0]).toBe('看看');expect(JSON.parse(message.split('\n').at(-1)!)).toMatchObject({name:'note.txt',source:item.source});}finally{await f.cleanup()}
});
it('链接不联网，网页只抓取公开文本，不把脚本当正文',async()=>{
 const f=await fixture();let calls=0;const server=http.createServer((_req,res)=>{calls++;res.writeHead(200,{'Content-Type':'text/html'}).end('<html><script>HIDDEN_SCRIPT</script><h1>ARTICLE_TEXT</h1></html>')});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{const a=await f.app.Dispatch('add',{path:f.a}),inputs=new ChatInputs(f.app.Workspace(a.id)),url=`http://127.0.0.1:${(server.address() as any).port}/page`;const link=await inputs.Add({kind:'link',value:url});expect(calls).toBe(0);expect(await inputs.Message('link',[link.id])).toContain('未抓取正文');const web=await inputs.Add({kind:'web',value:url});expect(calls).toBe(1);const content=await inputs.Message('page',[web.id]);expect(content).toContain('ARTICLE_TEXT');expect(content).not.toContain('HIDDEN_SCRIPT');await expect(inputs.Add({kind:'web',value:'file:///secret'})).rejects.toThrow();}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.cleanup()}
});

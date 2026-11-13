import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fixture} from './helpers';
import {ChatInputs} from '../src/logic/materials/service/chat-inputs';
import {transcript} from '../src/frontend/execution-view/transcript';
it('损坏附件 JSON 不能经公开预览返回伪造的字符串字段',async()=>{
 const f=await fixture();try{
  const entry=await f.app.dispatch('add',{path:f.a}),inputs=new ChatInputs(f.app.workspace(entry.id));
  const file=path.join(f.a,'contract.txt');await fs.writeFile(file,'saved');const item=await inputs.path('file',file);
  const saved=path.join(f.app.paths.project(entry.id),'chat-inputs',item.id+'.json');
  await fs.writeFile(saved,JSON.stringify({...item,text:{secret:'not preview text'}}));
  await expect(f.app.dispatch('chat.preview',{id:entry.id,attachmentId:item.id})).rejects.toThrow();
 }finally{await f.cleanup()}
});
it('attachment preview uses the saved snapshot and rejects another workspace or path traversal',async()=>{
 const f=await fixture();try{const a=await f.app.dispatch('add',{path:f.a}),b=await f.app.dispatch('add',{path:f.b});const inputs=new ChatInputs(f.app.workspace(a.id));const file=path.join(f.a,'preview.txt');await fs.writeFile(file,'ORIGINAL');const attachment=await inputs.path('file',file);await fs.writeFile(file,'CHANGED');expect(await f.app.dispatch('chat.preview',{id:a.id,attachmentId:attachment.id})).toMatchObject({name:'preview.txt',text:'ORIGINAL'});await expect(f.app.dispatch('chat.preview',{id:b.id,attachmentId:attachment.id})).rejects.toThrow();await expect(inputs.preview('../credentials')).rejects.toThrow();}finally{await f.cleanup()}
});
it('附件快照按工作区隔离，发送时使用选择时文本，拒绝知识路径和越界 ID',async()=>{
 const f=await fixture();try{const a=await f.app.dispatch('add',{path:f.a}),b=await f.app.dispatch('add',{path:f.b}),inputs=new ChatInputs(f.app.workspace(a.id));const file=path.join(f.a,'note.txt');await fs.writeFile(file,'SNAPSHOT_TEXT');const item=await inputs.path('file',file);await fs.writeFile(file,'CHANGED');const message=await inputs.message('看看',[item.id]);expect(message).toContain('SNAPSHOT_TEXT');expect(message).not.toContain('CHANGED');await expect(new ChatInputs(f.app.workspace(b.id)).message('cross',[item.id])).rejects.toThrow();await expect(inputs.message('bad',['../credentials'])).rejects.toThrow();await expect(inputs.path('folder',path.join(f.a,'.cbim'))).rejects.toThrow('知识库');const dir=await inputs.path('folder',f.a);expect(await inputs.message('dir',[dir.id])).not.toContain('目录 .cbim');const visible=transcript({task:{goal:'x'} as any,runId:'r',status:'completed',acceptance:'not_evaluated',unresolvedTools:[],events:[{type:'run.started',data:{message}} as any]});expect(visible[0].text).toBe('看看');expect(visible[0].attachments?.[0].name).toBe('note.txt');}finally{await f.cleanup()}
});
it('链接不联网，网页只抓取公开文本，不把脚本当正文',async()=>{
 const f=await fixture();let calls=0;const server=http.createServer((_req,res)=>{calls++;res.writeHead(200,{'Content-Type':'text/html'}).end('<html><script>HIDDEN_SCRIPT</script><h1>ARTICLE_TEXT</h1></html>')});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{const a=await f.app.dispatch('add',{path:f.a}),inputs=new ChatInputs(f.app.workspace(a.id)),url=`http://127.0.0.1:${(server.address() as any).port}/page`;const link=await inputs.add({kind:'link',value:url});expect(calls).toBe(0);expect(await inputs.message('link',[link.id])).toContain('未抓取正文');const web=await inputs.add({kind:'web',value:url});expect(calls).toBe(1);const content=await inputs.message('page',[web.id]);expect(content).toContain('ARTICLE_TEXT');expect(content).not.toContain('HIDDEN_SCRIPT');await expect(inputs.add({kind:'web',value:'file:///secret'})).rejects.toThrow();}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await f.cleanup()}
});

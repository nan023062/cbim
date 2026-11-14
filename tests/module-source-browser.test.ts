import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ModuleSourceBrowser} from '../src/logic/workspace/service/source-browser';
import type {Snapshot} from '../src/logic/knowledge/rules/types';

const temporary:string[]=[];
afterEach(async()=>{for(const root of temporary.splice(0))await fs.rm(root,{recursive:true,force:true})});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-module-source-'));temporary.push(root);
 await fs.mkdir(path.join(root,'src','nested'),{recursive:true});await fs.writeFile(path.join(root,'src','main.ts'),'export const 文本 = "<script>safe</script>";');
 const input={workspaceId:'w',instanceId:'i',revision:'r',moduleId:'.cbim/workspace/app',source:'src',path:''};
 const snapshot:Snapshot={workspaceId:'w',instanceId:'i',revision:'r',files:[{path:input.moduleId+'/module.json',hash:'m',text:JSON.stringify({sources:[{location:'src',scope:'app'}]})},{path:'.cbim/.cbimignore',text:'src/hidden/\n',hash:'ignore'}]};
 let reads=0,onRead:(count:number)=>void=()=>{};
 const service=new ModuleSourceBrowser({entry:{id:'w',path:root},assert:identity=>{if(identity.workspaceId!=='w'||identity.instanceId!=='i')throw Object.assign(Error('旧实例'),{code:'STALE_INSTANCE'})},read:async()=>{onRead(++reads);return snapshot}});
 return {root,input,snapshot,service,onRead:(fn:(count:number)=>void)=>{onRead=fn}};
}
it('读取实际绑定目录与文本，保留层级；不返回知识、忽略目录或链接',async()=>{
 const f=await fixture();await fs.mkdir(path.join(f.root,'src','hidden'));await fs.mkdir(path.join(f.root,'src','.cbim'));
 const result=await f.service.list(f.input);
 expect(result.entries.map(x=>[x.name,x.kind])).toEqual([['nested','directory'],['main.ts','file']]);
 expect(await f.service.read({...f.input,path:'main.ts'})).toEqual({kind:'text',text:'export const 文本 = "<script>safe</script>";',bytes:Buffer.byteLength('export const 文本 = "<script>safe</script>";')});
 expect(await f.service.list({...f.input,path:'nested'})).toEqual({entries:[]});
 expect(await fs.readdir(path.join(f.root,'src'))).toHaveLength(4);
});
it('拒绝伪造绑定、旧实例/版本、绝对路径和路径穿越',async()=>{
 const f=await fixture();
 await expect(f.service.list({...f.input,source:'elsewhere'})).rejects.toMatchObject({code:'SOURCE_BINDING'});
 await expect(f.service.list({...f.input,instanceId:'old'})).rejects.toMatchObject({code:'STALE_INSTANCE'});
 await expect(f.service.list({...f.input,revision:'old'})).rejects.toMatchObject({code:'SOURCE_STALE'});
 for(const relative of ['../main.ts','/main.ts','C:/main.ts','nested/../../main.ts','nested\\main.ts','file:stream','nested.','nested/','a\u0000b'])await expect(f.service.read({...f.input,path:relative})).rejects.toMatchObject({code:'SOURCE_PATH'});
 for(const relative of ['.cbim/agent.json','.git/config','hidden/file'])await expect(f.service.read({...f.input,path:relative})).rejects.toMatchObject({code:'SOURCE_IGNORED'});
});
it('目录联接不能逃逸绑定范围；直接访问与列表都拒绝跟随',async()=>{
 const f=await fixture(),outside=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-module-outside-'));temporary.push(outside);
 await fs.writeFile(path.join(outside,'secret.txt'),'OUTSIDE');
 await fs.symlink(outside,path.join(f.root,'src','linked'),process.platform==='win32'?'junction':'dir');
 expect((await f.service.list(f.input)).entries.some(x=>x.name==='linked')).toBe(false);
 await expect(f.service.read({...f.input,path:'linked/secret.txt'})).rejects.toMatchObject({code:'SOURCE_LINK'});
});
it('分页可继续读取目录；不截断成伪完整结果',async()=>{
 const f=await fixture();
 await Promise.all(Array.from({length:201},(_,i)=>fs.writeFile(path.join(f.root,'src','f'+i+'.ts'),'')));
 const first=await f.service.list(f.input);expect(first.entries).toHaveLength(200);expect(first.nextOffset).toBeDefined();
 const next=await f.service.list({...f.input,offset:first.nextOffset});expect(next.nextOffset).toBeUndefined();
 expect(new Set([...first.entries,...next.entries].map(x=>x.path)).size).toBe(203);
});
it('二进制、大文件和删除文件明确说明；读取中知识变更拒绝旧结果',async()=>{
 const f=await fixture();
 await fs.writeFile(path.join(f.root,'src','binary'),Buffer.from([0,1,2]));await fs.writeFile(path.join(f.root,'src','big'),Buffer.alloc(256*1024+1,65));
 expect(await f.service.read({...f.input,path:'binary'})).toMatchObject({kind:'unsupported',bytes:3});
 expect(await f.service.read({...f.input,path:'big'})).toMatchObject({kind:'unsupported',bytes:256*1024+1});
 await expect(f.service.read({...f.input,path:'gone'})).rejects.toMatchObject({code:'SOURCE_READ'});
 const other=await fixture();other.onRead(count=>{if(count===2)other.snapshot.revision='changed'});
 await expect(other.service.read({...other.input,path:'main.ts'})).rejects.toMatchObject({code:'SOURCE_STALE'});
});
it('请求严格且无写入选项；源绑定本身必须是目录',async()=>{
 const f=await fixture();await expect(f.service.list({...f.input,write:true})).rejects.toThrow();
 f.snapshot.files[0].text=JSON.stringify({sources:[{location:'src/main.ts'}]});
 await expect(f.service.read({...f.input,source:'src/main.ts'})).rejects.toMatchObject({code:'SOURCE_KIND'});
});

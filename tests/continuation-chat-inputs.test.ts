import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {fixture} from './helpers';
import {ChatInputs} from '../src/backend/main/persistence/tasks/chat-inputs';
import {hash} from '../src/backend/core/foundation/serialization';
import {continuationAttachmentLimits} from '../src/backend/core/tasks/scope-continuation-attachments';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
async function setup(){const f=await fixture();const entry=await f.app.dispatch('add',{path:f.a}),workspace=f.app.workspace(entry.id),inputs=new ChatInputs(workspace),directory=path.join(workspace.paths.project(entry.id),'chat-inputs');return {...f,entry,workspace,inputs,directory,signal:new AbortController().signal}}

it('一次读取已保存文本、图片与二进制引用，同字节构造有序清单，源文件后续变化不进入补充',async()=>{
  const f=await setup();try{
    const textFile=path.join(f.a,'note.txt'),imageFile=path.join(f.a,'pixel.png'),binaryFile=path.join(f.a,'data.bin');
    await fs.writeFile(textFile,'SELECTED_TEXT');await fs.writeFile(imageFile,png);await fs.writeFile(binaryFile,Buffer.from([0,1,2,3]));
    const text=await f.inputs.path('file',textFile),image=await f.inputs.path('file',imageFile),binary=await f.inputs.path('file',binaryFile),ids=[image.id,text.id,binary.id],snapshots=await Promise.all(ids.map(id=>fs.readFile(path.join(f.directory,id+'.json'))));
    await fs.writeFile(textFile,'NEW_SOURCE');await fs.writeFile(imageFile,Buffer.from('not the saved image'));
    const open=vi.spyOn(fs,'open');let prepared:Awaited<ReturnType<ChatInputs['prepareContinuation']>>;try{prepared=await f.inputs.prepareContinuation('  补充原文\n',ids,f.signal);expect(open.mock.calls.map(call=>call[0])).toEqual(ids.map(id=>path.join(f.directory,id+'.json')))}finally{open.mockRestore()}
    expect(prepared.message).toContain('SELECTED_TEXT');expect(prepared.message).not.toContain('NEW_SOURCE');expect(prepared.message).toContain('保存的文本快照，可能截取');expect(prepared.message).not.toContain(png.toString('base64'));expect(prepared.images).toEqual([{type:'image',mimeType:'image/png',data:png.toString('base64')}]);
    expect(prepared.manifest.items.map(item=>item.attachmentId)).toEqual(ids);expect(prepared.manifest.items.map(item=>item.contentKind)).toEqual(['image','text','reference']);expect(prepared.manifest.items.map(item=>item.snapshotHash)).toEqual(snapshots.map(hash));expect(prepared.manifest.items[0]).toMatchObject({contentHash:hash(png),byteLength:png.length,mimeType:'image/png'});
    expect(prepared.manifest.items[1]).toMatchObject({contentHash:hash('SELECTED_TEXT'),byteLength:Buffer.byteLength('SELECTED_TEXT')});expect(prepared.manifest).toMatchObject({expandedMessageHash:hash(prepared.message),expandedMessageBytes:Buffer.byteLength(prepared.message)});expect(JSON.stringify(prepared.manifest)).not.toContain(f.a);expect(JSON.stringify(prepared.manifest)).not.toContain('SELECTED_TEXT');
  }finally{await f.cleanup()}
});

it('未知、跨工作区、非文件、重复及损坏快照明确拒绝，不将附件丢弃成纯文本',async()=>{
  const f=await setup();try{
    const file=path.join(f.a,'note.txt');await fs.writeFile(file,'text');const item=await f.inputs.path('file',file),snapshotFile=path.join(f.directory,item.id+'.json'),original=await fs.readFile(snapshotFile,'utf8');
    const other=await f.app.dispatch('add',{path:f.b});await expect(new ChatInputs(f.app.workspace(other.id)).prepareContinuation('x',[item.id],f.signal)).rejects.toMatchObject({code:'GOAL_ATTACHMENT_MISSING'});
    await expect(f.inputs.prepareContinuation('x',[randomUUID()],f.signal)).rejects.toMatchObject({code:'GOAL_ATTACHMENT_MISSING'});
    await expect(f.inputs.prepareContinuation('x',[item.id,item.id],f.signal)).rejects.toMatchObject({code:'GOAL_ATTACHMENT_INPUT'});
    const folder=await f.inputs.path('folder',f.a);await expect(f.inputs.prepareContinuation('x',[folder.id],f.signal)).rejects.toMatchObject({code:'GOAL_ATTACHMENT_UNSUPPORTED'});
    for(const text of ['{',JSON.stringify({...JSON.parse(original),id:randomUUID()}),JSON.stringify({...JSON.parse(original),image:{type:'image',mimeType:'image/png',data:'YQ=='}}),JSON.stringify({...JSON.parse(original),text:{secret:'invalid'}})]){
      await fs.writeFile(snapshotFile,text);await expect(f.inputs.prepareContinuation('x',[item.id],f.signal)).rejects.toMatchObject({code:'GOAL_ATTACHMENT_INVALID'});
    }
  }finally{await f.cleanup()}
});

it('私有快照和全部展开正文有独立字节上限，超限整体拒绝而非截断补充',async()=>{
  const f=await setup();try{
    const file=path.join(f.a,'long.txt');await fs.writeFile(file,'x'.repeat(64000));const ids:string[]=[];
    for(let i=0;i<9;i++)ids.push((await f.inputs.path('file',file)).id);
    await expect(f.inputs.prepareContinuation('原始要求',ids,f.signal)).rejects.toMatchObject({code:'GOAL_ATTACHMENT_LIMIT'});
    const first=path.join(f.directory,ids[0]+'.json');await fs.writeFile(first,Buffer.alloc(continuationAttachmentLimits.snapshotBytes+1,32));
    const open=vi.spyOn(fs,'open');try{await expect(f.inputs.prepareContinuation('x',[ids[0]],f.signal)).rejects.toMatchObject({code:'GOAL_ATTACHMENT_LIMIT'});expect(open).not.toHaveBeenCalled()}finally{open.mockRestore()}
  }finally{await f.cleanup()}
});

it('图片合计上限在同次准备中执行，停止在读取await后保持原取消原因',async()=>{
  const f=await setup();try{
    const file=path.join(f.a,'large.png'),bytes=Buffer.alloc(continuationAttachmentLimits.imageBytes);png.copy(bytes);await fs.writeFile(file,bytes);const ids:string[]=[];
    for(let i=0;i<5;i++)ids.push((await f.inputs.path('file',file)).id);
    await expect(f.inputs.prepareContinuation('x',ids,f.signal)).rejects.toMatchObject({code:'GOAL_ATTACHMENT_LIMIT'});
    const controller=new AbortController(),reason=Object.assign(Error('停止附件准备'),{code:'COLLABORATION_STOPPED'}),stat=fs.lstat.bind(fs),spy=vi.spyOn(fs,'lstat').mockImplementation(async(...args)=>{const value=await stat(...args);controller.abort(reason);return value});
    try{await expect(f.inputs.prepareContinuation('x',[ids[0]],controller.signal)).rejects.toBe(reason)}finally{spy.mockRestore()}
  }finally{await f.cleanup()}
});

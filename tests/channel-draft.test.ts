import {expect,it} from 'vitest';
import {ChannelDraftStore} from '../src/view/conversation/channel-draft';
const identity={workspaceId:'workspace',rootSessionId:'root',scopeId:'a'};
const attachment={id:'11111111-1111-4111-8111-111111111111',kind:'file' as const,name:'资料',source:'C:/fixture.txt'};
function storage(){const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)}}}
it('频道及办公室身份隔离，重建后恢复文本与附件，不修改主聊天键',()=>{
 const io=storage(),a=new ChannelDraftStore(identity,io),b=new ChannelDraftStore({...identity,scopeId:'b'},io),other=new ChannelDraftStore({...identity,rootSessionId:'other'},io);
 a.edit({text:'频道 A',attachments:[attachment]});b.edit({text:'频道 B'});expect(other.snapshot.text).toBe('');
 expect(new ChannelDraftStore(identity,io).snapshot).toEqual(a.snapshot);expect(b.snapshot.attachments).toEqual([]);expect(io.getItem('cbim.tabs')).toBeNull();
});
it('迟到回执只清除对应版本，不能清空后来草稿或其他频道',()=>{
 const a=new ChannelDraftStore(identity,storage());a.edit({text:'已发'});const sent=a.snapshot.revision;a.edit({text:'新草稿'});a.clearIfUnchanged(sent);expect(a.snapshot.text).toBe('新草稿');a.clearIfUnchanged(a.snapshot.revision);expect(a.snapshot.text).toBe('');
});
it('隐藏或切换后的文件选择丢弃；新选择独立接受，不混到新频道',()=>{
 const io=storage(),a=new ChannelDraftStore(identity,io),b=new ChannelDraftStore({...identity,scopeId:'b'},io);const old=a.beginImport();a.cancelImport();expect(a.finishImport(old,[attachment])).toBe(false);expect(b.snapshot.attachments).toEqual([]);
 expect(b.finishImport(b.beginImport(),[attachment])).toBe(true);expect(a.snapshot.attachments).toEqual([]);
});
it('损坏和存储失败保留原值，拒绝覆盖或假装保存成功',()=>{
 const io=storage(),a=new ChannelDraftStore(identity,io);a.edit({text:'保留'});io.setItem=()=>{throw Error('storage full')};expect(()=>a.edit({text:'未保存'})).toThrow();expect(a.snapshot.text).toBe('保留');expect(a.writable).toBe(true);
 const bad=new ChannelDraftStore(identity,{getItem:()=>'{bad',setItem:()=>{throw Error('不得覆盖')}});expect(bad.error).not.toBe('');expect(bad.writable).toBe(false);expect(()=>bad.edit({text:'覆盖'})).toThrow('无法读取');
});

it('写入和恢复使用同一记录上限，过大转义附件不会写成下次无法读取的草稿',()=>{
 const io=storage(),store=new ChannelDraftStore(identity,io);store.edit({text:'保留原稿'});
 const items=Array.from({length:12},(_,index)=>({...attachment,id:'11111111-1111-4111-8111-'+String(index).padStart(12,'0'),source:'\n'.repeat(32768)}));
 expect(()=>store.edit({attachments:items})).toThrow('记录上限');expect(new ChannelDraftStore(identity,io).snapshot.text).toBe('保留原稿');expect(store.snapshot.attachments).toEqual([]);
});

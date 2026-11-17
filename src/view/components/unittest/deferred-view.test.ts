import {expect,test,vi} from 'vitest';
import {createElement} from 'react';
import {renderToPipeableStream,renderToStaticMarkup} from 'react-dom/server';
import {PassThrough} from 'node:stream';
import {deferredView} from '../DeferredView';

test('page registration does not request its module before mounting',()=>{
 const loader=vi.fn(async()=>({default:()=>createElement('p',null,'page')}));
 deferredView(loader,'测试页');
 expect(loader).not.toHaveBeenCalled();
});

test('pending page exposes its own accessible loading status',()=>{
 const View=deferredView(()=>new Promise<{default:()=>null}>(()=>{}),'团队架构');
 const html=renderToStaticMarkup(createElement(View));
 expect(html).toContain('role="status"');
 expect(html).toContain('正在加载团队架构');
});

test('resolved page receives the original props without changing the surrounding output',async()=>{
 const View=deferredView(async()=>({default:({name}:{name:string})=>createElement('p',null,name)}),'测试页');
 const result=await new Promise<string>((resolve,reject)=>{
  const output=new PassThrough();let html='';
  output.on('data',chunk=>{html+=chunk.toString()});output.on('end',()=>resolve(html));output.on('error',reject);
  const stream=renderToPipeableStream(createElement('section',null,'旁侧',createElement(View,{name:'原始项目'})),{
   onAllReady(){stream.pipe(output)},onError:reject,
  });
 });
 expect(result).toContain('旁侧');expect(result).toContain('原始项目');expect(result).not.toContain('正在加载');
});

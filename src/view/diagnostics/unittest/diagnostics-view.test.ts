import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {WorkspaceDiagnostics} from '../WorkspaceDiagnostics';
import type {Snapshot,WorkspaceView} from '../../../bridge/contracts/workspace';

const workspace={id:'workspace-a',instanceId:'instance-a',name:'示例项目',path:'C:/example',state:'running'} as WorkspaceView;
function render(workspaceId:string,instanceId:string){
  const snapshot={workspaceId,instanceId,revision:'revision-a',validation:{issues:[]}} as unknown as Snapshot;
  return renderToStaticMarkup(createElement(WorkspaceDiagnostics,{workspace,snapshot,refreshKnowledge:async()=>{}}));
}
describe('工作区诊断结果的展示归属',()=>{
  it.each([['workspace-b','instance-a'],['workspace-a','instance-b']])('不把 %s / %s 的快照展示为当前检查通过',(id,instance)=>{
    const html=render(id,instance);
    expect(html).toContain('等待加载检查结果');
    expect(html).not.toContain('当前未发现结构校验问题');
    expect(html).not.toContain('revision-a');
  });
  it('匹配身份时展示检查结果，并保留业务验收边界',()=>{
    const html=render('workspace-a','instance-a');
    expect(html).toContain('当前未发现结构校验问题');
    expect(html).toContain('不代表业务语义或执行结果已验收');
    expect(html).toContain('revision-a');
  });
});

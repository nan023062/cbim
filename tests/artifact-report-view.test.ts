import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ArtifactReportController,checkedArtifactReport} from '../src/view/tasks/artifact-report-state';
import {ArtifactReportPanel} from '../src/view/tasks/MemberArtifactReport';
import type {ArtifactReport,ArtifactReportInput} from '../src/bridge/contracts/dispatch';

const identity={workspaceId:'workspace',rootSessionId:'root',taskId:'member',runId:'run'},time='2026-11-07T01:00:00.000Z',digest='a'.repeat(64);
function report(verify=false):ArtifactReport{return {identity,checkedAt:time,basis:'b'.repeat(64),consistency:'stable',log:{state:'verified',lastSeq:30},coverage:'selected_files_only',impact:'selected_files_only',baselines:[{baselineId:'baseline',captureToolCallId:'capture',knowledgeRevision:'knowledge',progressVersion:2,capturedAt:time,capturedSeq:20,finishedSeq:21,fileCount:1,invalidated:false}],...(verify?{verification:{baselineId:'baseline',state:'matches' as const,files:[{relativePath:'src/game.ts',state:'matches' as const,expected:{byteLength:12,sha256:digest},observed:{byteLength:12,sha256:digest}}]}}:{}),issues:[]}}
function render(value:ArtifactReport,selectedId='',error=''){return renderToStaticMarkup(createElement(ArtifactReportPanel,{taskId:'member',runId:'run',state:{report:value,selectedId,loading:false,error,stale:false,list:async()=>{},inspect:async()=>{},select:()=>{}}}))}

it('基线只显式加载，列表不自动选取或hash；选择不请求，明确复核才传baselineId',async()=>{
  const read=vi.fn(async(input:ArtifactReportInput)=>report(!!input.baselineId)),controller=new ArtifactReportController(identity,read);
  const stop=controller.subscribe(vi.fn());expect(read).not.toHaveBeenCalled();await controller.inspect();expect(read).not.toHaveBeenCalled();
  await controller.list();expect(read).toHaveBeenCalledTimes(1);expect(read.mock.calls[0][0]).toEqual(identity);expect(controller.snapshot.selectedId).toBe('');
  controller.select('baseline');expect(read).toHaveBeenCalledTimes(1);expect(controller.snapshot.report?.verification).toBeUndefined();
  await controller.inspect();expect(read).toHaveBeenLastCalledWith({...identity,baselineId:'baseline'});expect(controller.snapshot.report?.verification?.state).toBe('matches');
  await controller.list();expect(controller.snapshot.report?.verification).toBeUndefined();expect(controller.snapshot.selectedId).toBe('baseline');stop();
});

it('双击合并查询，切换基线或卸载丢弃迟到数据，不发恢复或取消任务请求',async()=>{
  let resolve!:(value:ArtifactReport)=>void;const read=vi.fn(async()=>report()),controller=new ArtifactReportController(identity,read);await controller.list();controller.select('baseline');
  read.mockImplementationOnce(()=>new Promise<ArtifactReport>(finish=>{resolve=finish}));const pending=controller.inspect();await controller.inspect();expect(read).toHaveBeenCalledTimes(2);
  controller.select('');resolve(report(true));await pending;expect(controller.snapshot.selectedId).toBe('');expect(controller.snapshot.report?.verification).toBeUndefined();expect(controller.snapshot.loading).toBe(false);
  read.mockImplementationOnce(()=>new Promise<ArtifactReport>(finish=>{resolve=finish}));const next=controller.list();controller.cancel();resolve(report());await next;expect(controller.snapshot.loading).toBe(false);
});

it('跨工作区/任务/轮次、默认验证、重复基线和矛盾明细被拒绝',()=>{
  for(const field of ['workspaceId','rootSessionId','taskId','runId'])expect(()=>checkedArtifactReport({...report(),identity:{...identity,[field]:'other'}},identity)).toThrow('不属于');
  expect(()=>checkedArtifactReport(report(true),identity)).toThrow('隐式');
  const input={...identity,baselineId:'baseline'};
  expect(()=>checkedArtifactReport(report(true),{...input,baselineId:'other'})).toThrow('选择');
  const duplicate=report();duplicate.baselines.push(duplicate.baselines[0]);expect(()=>checkedArtifactReport(duplicate,identity)).toThrow('重复');
  const bad=report(true);bad.verification!.files[0].observed!.sha256='c'.repeat(64);expect(()=>checkedArtifactReport(bad,input)).toThrow('观察不一致');
  const incomplete=report(true);incomplete.baselines[0].fileCount=2;expect(()=>checkedArtifactReport(incomplete,input)).toThrow('全部文件');
  const changed=report(true);changed.consistency='changed_during_read';expect(()=>checkedArtifactReport(changed,input)).toThrow('读取期间');
  const badLog=report();badLog.log.state='invalid';expect(()=>checkedArtifactReport(badLog,identity)).toThrow('未核实');
});

it('读取失败保留原观察但显示明确错误，图版本在途变化不会冒称当前依据',async()=>{
  let version='one';const read=vi.fn(async()=>report()),controller=new ArtifactReportController(identity,read,()=>version);await controller.list();const prior=controller.snapshot.report;
  read.mockRejectedValueOnce(Error('读取中断'));await controller.list();expect(controller.snapshot.report).toBe(prior);expect(controller.snapshot.error).toBe('读取中断');
  let resolve!:(value:ArtifactReport)=>void;read.mockImplementationOnce(()=>new Promise<ArtifactReport>(finish=>{resolve=finish}));const pending=controller.list();version='two';resolve(report());await pending;expect(controller.snapshot.sourceVersion).toBe('one');
  read.mockResolvedValueOnce({...report(),identity:{...identity,runId:'other'}});const current=controller.snapshot.report;await controller.list();expect(controller.snapshot.report).toBe(current);expect(controller.snapshot.error).toContain('不属于');
});

it('所有文件状态有独立文案，只有relative路径/字节/哈希；无恢复验收入口且内容转义',()=>{
  for(const [state,label] of [['matches','内容一致'],['changed','内容已变化'],['missing','文件缺失'],['unverifiable','不可核实']] as const){
    const value=report(true),file=value.verification!.files[0];file.state=state;file.relativePath='src/<script>.ts';if(state==='missing')delete file.observed;
    value.verification!.state=state==='matches'?'matches':state==='unverifiable'?'unverifiable':'changed';value.impact='unknown';value.baselines[0].invalidated=true;
    const html=render(value,'baseline');expect(html).toContain(label);expect(html).toContain('src/&lt;script&gt;.ts');expect(html).not.toContain('<script>');expect(html).toContain('范围不明');expect(html).toContain('不能直接用于恢复');
    expect(html).not.toContain('恢复执行</button>');expect(html).not.toContain('批准</button>');expect(html).toContain('不代表整个工作区未变');expect(html).toContain('artifact-baseline-refresh');
  }
  const empty=report();empty.baselines=[];const html=render(empty);expect(html).toContain('没有可核实的显式文件基线');expect(html).not.toContain('artifact-baseline-select');
  const malformed={...report(),absolutePath:'C:/private/file'};expect(()=>checkedArtifactReport(malformed,identity)).toThrow();
});

it('未选定时复核按钮不可用，用户切换选项立即清除上一份结果',async()=>{
  expect(render(report())).toMatch(/data-testid="artifact-baseline-inspect" disabled/);
  const read=vi.fn(async(input:ArtifactReportInput)=>{const value=report(!!input.baselineId);value.baselines.push({...value.baselines[0],baselineId:'second'});return value}),controller=new ArtifactReportController(identity,read);
  await controller.list();controller.select('baseline');await controller.inspect();controller.select('second');expect(controller.snapshot.report?.verification).toBeUndefined();expect(read).toHaveBeenCalledTimes(2);
  expect(()=>controller.select('not-listed')).toThrow('不在');
});

it('坏日志或丢失基线只显示不可核实，不把空列表解释为文件未变',()=>{
  const missing=report();missing.log.state='missing';missing.baselines=[];missing.verification={baselineId:'baseline',state:'unverifiable',files:[]};missing.issues=[{code:'ARTIFACT_LOG_UNAVAILABLE',message:'日志缺失不表示没有副作用'}];
  const value=checkedArtifactReport(missing,{...identity,baselineId:'baseline'});expect(value.verification?.state).toBe('unverifiable');
  const html=render(value,'baseline');expect(html).toContain('运行日志缺失');expect(html).toContain('无法完整核实');expect(html).not.toContain('所列文件当前字节一致');expect(html).not.toContain('artifact-baseline-select');
});

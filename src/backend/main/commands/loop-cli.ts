/**
 * 作用定位：主进程命令入口：Pi Loop 开发 CLI：创建任务、显式恢复、中断和输出执行事件。
 * 设计原因：独立拥有工作区锁并复用应用执行管理；不能与桌面同时占用同一工作区。
 */
import {parseArgs} from 'node:util';
import path from 'node:path';
import {Paths} from '../platform/paths';
import {Application} from '../application';

async function main(){
  const {values}=parseArgs({options:{root:{type:'string'},'user-data':{type:'string'},provider:{type:'string'},model:{type:'string'},goal:{type:'string'},module:{type:'string'},agent:{type:'string'},workflow:{type:'string'},person:{type:'string'},acceptance:{type:'string',multiple:true},'allow-execution':{type:'boolean'},task:{type:'string'},resume:{type:'string'},message:{type:'string'},'reconciled-tool':{type:'string',multiple:true}}});
  if(!values.root||!values.provider||!values.model)throw Error('需要 --root、--provider 和 --model；CLI 独立打开工作区，请先关闭占用该工程的 CBIM');
  if(Boolean(values.task)!==Boolean(values.resume))throw Error('--task 与 --resume 必须同时提供');
  const application=new Application(new Paths(values['user-data'],path.resolve('.')),path.resolve('design'),undefined,false);
  let stop:(()=>void)|undefined;
  try{
    await application.init();const entry=await application.catalog.add(values.root);await application.open(entry.id);
    const manager=application.execution(entry.id);manager.subscribe(event=>process.stdout.write(JSON.stringify(event)+'\n'));
    const options={provider:values.provider,model:values.model,allowNativeExecution:values['allow-execution']??false};
    const run=values.task&&values.resume
      ?await manager.resume(values.task,values.resume,values.message||'',options,values['reconciled-tool'])
      :await manager.start({goal:values.goal!,moduleId:values.module!,agentId:values.agent!,workflowId:values.workflow!,responsiblePerson:values.person,acceptance:values.acceptance||[]},options);
    stop=()=>{void manager.stop(run.taskId)};process.on('SIGINT',stop);process.on('SIGTERM',stop);
    let result=await manager.inspect(run.taskId,run.runId);
    while(result.status==='running'){await new Promise(resolve=>setTimeout(resolve,100));result=await manager.inspect(run.taskId,run.runId)}
    process.stdout.write(JSON.stringify({taskId:run.taskId,runId:run.runId,status:result.status,acceptance:result.acceptance})+'\n');
    if(result.status!=='completed')process.exitCode=1;
  }finally{if(stop){process.off('SIGINT',stop);process.off('SIGTERM',stop)}await application.shutdown()}
}
void main().catch(error=>{process.stderr.write((error instanceof Error?error.message:String(error))+'\n');process.exitCode=1});

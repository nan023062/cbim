/**
 * 作用定位：在已打开的本地工作区执行冻结代码检查，复用完整目录枚举核实前后源码集合。
 * 设计原因：无 shell 拼接、有限输出和超时，真实退出及测试摘要决定结果；模型不能提供命令结果。
 * 职责边界：这是需要 command 授权的宿主进程，不是沙箱；未知退出不产生成功证明。范围只覆盖显式声明的输入。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {hash} from '../../../core/foundation/serialization';
import {fail} from '../../../core/foundation/errors';
import {codeCheckLimits,codeTestSummarySchema} from '../../../core/workspace/code-check';
import {codeCheckExecutionSchema,type CodeCheckPort,type FrozenCodeCheck,type CodeCommandResult} from '../../../core/evidence/code-check';
import {outputManifestHash} from '../../../core/evidence/output-manifest-evidence';
import {OutputManifestFiles} from './output-manifest-files';

/** 每次调用均核实工作区实例；不继承模型传入的 cwd、环境变量或 shell 文本。 */
export class CodeCheckRunner implements CodeCheckPort {
  private readonly manifests:OutputManifestFiles;
  constructor(private readonly root:string,private readonly assertCurrent:()=>void){this.root=path.resolve(root);this.manifests=new OutputManifestFiles(this.root,assertCurrent)}
  private async directory(relative:string,signal:AbortSignal){
    this.assertCurrent();signal.throwIfAborted();
    let current=this.root;
    for(const part of ['',...(relative==='.'?[]:relative.split('/'))]){
      current=path.join(current,part);const stat=await fs.lstat(current),real=await fs.realpath(current);
      if(!stat.isDirectory()||stat.isSymbolicLink()||path.relative(real,current)!=='')fail('CODE_CHECK_DIRECTORY','检查目录包含链接、已改变或不是目录');
      this.assertCurrent();signal.throwIfAborted();
    }
    return current;
  }
  async run(checks:readonly FrozenCodeCheck[],scopes:Parameters<CodeCheckPort['run']>[1],signal:AbortSignal){
    const snapshot=await this.manifests.capture(scopes,signal);
    if(snapshot.roots.some(root=>root.state==='missing')||!snapshot.entries.some(entry=>entry.kind==='file'))fail('CODE_CHECK_INPUT','代码检查范围必须存在并包含实际文件');
    const commands:CodeCommandResult[]=[];
    for(const check of checks){
      this.assertCurrent();signal.throwIfAborted();commands.push(await this.command(check,await this.directory(check.requirement.cwd,signal),signal));
    }
    this.assertCurrent();signal.throwIfAborted();
    const current=await this.manifests.check(snapshot,signal);signal.throwIfAborted();this.assertCurrent();
    return codeCheckExecutionSchema.parse({snapshot,commands,sourceChanged:current.state!=='matches'||current.observedHash!==outputManifestHash(snapshot)});
  }
  private command(check:FrozenCodeCheck,cwd:string,signal:AbortSignal):Promise<CodeCommandResult>{
    const rule=check.requirement,program=rule.program==='node'?process.execPath:rule.program,started=Date.now();
    return new Promise((resolve,reject)=>{
      let stdout='',stderr='',bytes=0,failure:CodeCommandResult['failure'],settled=false,killTimer:ReturnType<typeof setTimeout>|undefined;
      const child=spawn(program,rule.args,{cwd,env:{...process.env,...(rule.program==='node'?{ELECTRON_RUN_AS_NODE:'1'}:{})},shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
      const clean=()=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);signal.removeEventListener('abort',abort)};
      const terminate=()=>{
        if(killTimer)return;
        if(child.pid){
          if(process.platform==='win32')execFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});
          else try{process.kill(-child.pid,'SIGKILL')}catch{child.kill('SIGKILL')}
        }
        killTimer=setTimeout(()=>{if(!settled){settled=true;clean();reject(Error('CODE_CHECK_PROCESS_UNKNOWN: 检查进程未确认退出，不能重试或交付'))}},3000);
      };
      const abort=()=>{terminate()};
      const timer=setTimeout(()=>{failure='timeout';terminate()},rule.timeoutMs);
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      const output=(chunk:Buffer,stream:'out'|'err')=>{
        bytes+=chunk.length;if(bytes>codeCheckLimits.outputBytes){failure??='output_limit';terminate();return}
        if(stream==='out')stdout+=chunk.toString('utf8');else stderr+=chunk.toString('utf8');
      };
      child.stdout.on('data',chunk=>output(chunk,'out'));child.stderr.on('data',chunk=>output(chunk,'err'));
      child.on('error',error=>{failure='spawn';stderr=String(error).slice(-codeCheckLimits.tailBytes)});
      child.on('close',(exitCode,exitSignal)=>{
        if(settled)return;settled=true;clean();
        if(signal.aborted){reject(signal.reason??Error('代码检查已取消'));return}
        let summary:CodeCommandResult['summary'];
        if(exitCode!==0||exitSignal)failure??='exit';
        if(rule.success.kind==='test-summary-json'){
          const lines=stdout.split(/\r?\n/).filter(line=>line.startsWith('CBIM_TEST_SUMMARY '));
          try{if(lines.length!==1)throw Error('Missing or duplicate summary');summary=codeTestSummarySchema.parse(JSON.parse(lines[0].slice(18)));if(summary.failed||summary.passed<rule.success.minPassed)failure??='summary'}catch{failure??='summary'}
        }
        resolve({moduleId:check.moduleId,requirementId:rule.id,resolvedProgram:program,exitCode,signal:exitSignal,durationMs:Date.now()-started,...(failure?{failure}:{}),outputHash:hash(JSON.stringify({stdout,stderr})),stdoutTail:stdout.slice(-codeCheckLimits.tailBytes),stderrTail:stderr.slice(-codeCheckLimits.tailBytes),...(summary?{summary}:{})});
      });
    });
  }
}

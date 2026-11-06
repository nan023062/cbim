/**
 * 作用定位：宿主 Hook 命令入口：读取 stdin、执行访问策略并返回拒绝或放行。
 * 设计原因：用独立命令适配宿主 PreToolUse 协议，检查失败时拒绝执行。
 */
import {parseArgs} from 'node:util';
import {guard} from '../../platform/tool-guard';
async function main(){
  const {values}=parseArgs({options:{root:{type:'string'},'workspace-id':{type:'string'}}});
  if(!values.root||!values['workspace-id'])throw Error('CBIM Hook 配置不完整');
  const chunks:Buffer[]=[];let size=0;for await(const chunk of process.stdin){const b=Buffer.from(chunk);size+=b.length;if(size>4*1024*1024)throw Error('CBIM Hook 输入过大');chunks.push(b)}
  const message=guard(JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'')),values.root,values['workspace-id']);
  if(message){process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:message}}));process.stderr.write(message);process.exitCode=2}
}
void main().catch(e=>{process.stderr.write('CBIM Hook 检查失败，拒绝操作：'+e.message);process.exitCode=2});

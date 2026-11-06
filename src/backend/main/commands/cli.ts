/**
 * 作用定位：只连接已运行工作区的知识查询/校验命令，不启动工作区服务。
 * 设计原因：仅连接已运行工作区，命令行查询不会悄悄创建或初始化工程。
 */
import path from 'node:path';
import {parseArgs} from 'node:util';
import {Paths} from '../platform/paths';
import {json} from '../../core/foundation/serialization';
import {connectWorkspace} from '../integrations/mcp/discovery';
// All CLI operations connect to a workspace that a user has already opened.
async function main(){const {values}=parseArgs({options:{root:{type:'string'},'user-data':{type:'string'},query:{type:'string'},validate:{type:'boolean'}}});if(!values.root)throw Error('必须提供 --root；不会默认使用安装目录');const {client,identity}=await connectWorkspace(new Paths(values['user-data'],path.resolve('.')),values.root);
  try{const name=values.validate?'cbim_rules_validate':values.query?'cbim_knowledge_search':'cbim_knowledge_snapshot';const result=await client.callTool({name,arguments:{...identity,...values.query?{query:values.query}:{}}});process.stdout.write(json(result));if(result.isError)process.exitCode=1}finally{await client.close()}}
void main().catch(e=>{process.stderr.write(json({code:e.code||'ERROR',message:e.message}));process.exitCode=1});

import path from 'node:path';
import {parseArgs} from 'node:util';
import {Paths,json} from './paths';
import {connectWorkspace} from './discovery';
// All CLI operations connect to a workspace that a user has already opened.
async function main(){const {values}=parseArgs({options:{root:{type:'string'},'user-data':{type:'string'},query:{type:'string'},validate:{type:'boolean'}}});if(!values.root)throw Error('必须提供 --root；不会默认使用安装目录');const {client,identity}=await connectWorkspace(new Paths(values['user-data'],path.resolve('.')),values.root);
  try{const name=values.validate?'rules_validate':values.query?'knowledge_search':'knowledge_snapshot';const result=await client.callTool({name,arguments:{...identity,...values.query?{query:values.query}:{}}});process.stdout.write(json(result));if(result.isError)process.exitCode=1}finally{await client.close()}}
void main().catch(e=>{process.stderr.write(json({code:e.code||'ERROR',message:e.message}));process.exitCode=1});

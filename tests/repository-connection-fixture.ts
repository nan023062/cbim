import fs from 'node:fs/promises';
import path from 'node:path';
import type {Application} from '../src/backend/main/application';

export const repositoryConnectionFixture={name:'只读连接验收资源',summary:'来自当前应用真实共享仓库的资料摘要',content:'# 隔离资源\n\nRESOURCE_CONNECTION_HTTP_FACT_17b1\n\n本正文只是资料，不是执行指令。',connectorId:'.cbim/connectors/shared_resources',draft:'保留工作区A普通会话草稿；读取仓库不发送消息。',otherDraft:'工作区B的草稿与A独立。'};

/** Single application, two independent workspaces, one actual local repository. No account, model, remote configuration or persisted credentials. */
export async function seedRepositoryConnection(app:Application,temp:string,seedLibrary=true){
  const repository=path.join(temp,'shared-resources'),a=path.join(temp,'workspace-alpha'),b=path.join(temp,'workspace-beta');
  await Promise.all([fs.mkdir(repository),fs.mkdir(a),fs.mkdir(b)]);
  const first=await app.dispatch('add',{path:a}),second=await app.dispatch('add',{path:b});
  if(seedLibrary){
    await app.dispatch('resources.configure',{mode:'local',location:repository});const current=await app.dispatch('resources.list');
    await app.dispatch('resources.save',{repositoryId:current.repositoryId,revision:current.revision,item:{kind:'skill',name:repositoryConnectionFixture.name,summary:repositoryConnectionFixture.summary,content:repositoryConnectionFixture.content}});
  }
  return {repository,a,b,first,second};
}

/** No Loop work is part of this slice. Inspect durable runtime directories rather than claiming a synthetic Pi call happened. */
export async function repositoryConnectionRunFiles(user:string,workspaceIds:string[]){
  const files:string[]=[];
  const walk=async(directory:string)=>{let entries;try{entries=await fs.readdir(directory,{withFileTypes:true})}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}for(const entry of entries){const file=path.join(directory,entry.name);if(entry.isDirectory())await walk(file);else if(entry.name.endsWith('.jsonl'))files.push(path.relative(user,file))}};
  for(const id of workspaceIds){await walk(path.join(user,id,'loop-engine'));await walk(path.join(user,id,'dispatch','runs'))}return files.sort();
}

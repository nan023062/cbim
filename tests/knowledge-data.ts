/** 纯知识数据构造；不初始化 Application、工作区、存储或运行引擎。 */
import {json,hash} from '../src/core/platform/node/serialization';
import {randomUUID} from 'node:crypto';
import type {Snapshot,Change,KnowledgeFile} from '../src/logic/knowledge/rules/types';
export const request=(snapshot:Snapshot,changes:Change[])=>({workspaceId:snapshot.workspaceId,instanceId:snapshot.instanceId,revision:snapshot.revision,requestId:randomUUID(),changes});
export const summary='管理团队客户端资源加载、卸载与缓存，提供加载器和实例生命周期接口。包含异步请求取消、对象池复用、回调有效性检查与过期资源清理，支持定位加载失败、实例释放和重复请求问题。底层资源传输由相关系统提供，本模块负责运行期调用与生命周期管理。';
export function moduleFiles(name='game',children:string[]=[],sources:any[]=[]):KnowledgeFile[]{const id='.cbim/workspace/'+name;const data={id,name:name.split('/').at(-1),summary,authors:[],sources,connectors:[],children,overview:'module.md',workflows:[]};const body=`# ${data.name}\n\n## 定位\n管理资源。\n\n## 子模块和 source 节点\n无\n\n## 结构关系图与抽象设计决策\n\n\`\`\`mermaid\nclassDiagram\nclass Game\n${sources.length?'class CbimDirectContent["直属内容（虚拟子模块）"]\n<<virtual>> CbimDirectContent\n':''}\`\`\`\n无\n\n## 雷区与排障\n无\n\n## 观察模式-待抽象\n无\n`;return [{path:id+'/module.json',text:json(data),hash:''},{path:id+'/module.md',text:body,hash:''}].map(f=>({...f,hash:hash(f.text)}))}

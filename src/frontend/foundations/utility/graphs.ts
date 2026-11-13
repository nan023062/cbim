/**
 * 作用定位：前端有向图的纯拓扑算法，不引用任务、画布或通信契约。
 * 设计原因：拓扑分层与卡片几何分别变化；业务选择边并解释错误，算法仅处理节点和有向关系。
 */
export class GraphTopologyError extends Error {
  constructor(readonly code:'duplicate-node'|'missing-endpoint'|'cycle') {super(code);this.name='GraphTopologyError';}
}

/** 按输入次序遍历，返回从 0 开始的最长前驱层级；平行边逐条计入，自环视为环，不修改输入。 */
export function rankDirectedGraph(ids:readonly string[],edges:readonly (readonly [string,string])[]):Map<string,number>{
  if(new Set(ids).size!==ids.length)throw new GraphTopologyError('duplicate-node');
  const incoming=new Map(ids.map(id=>[id,0])),outgoing=new Map(ids.map(id=>[id,[] as string[]])),ranks=new Map(ids.map(id=>[id,0]));
  for(const [from,to] of edges){
    if(!incoming.has(from)||!incoming.has(to))throw new GraphTopologyError('missing-endpoint');
    incoming.set(to,incoming.get(to)!+1);outgoing.get(from)!.push(to);
  }
  const queue=ids.filter(id=>incoming.get(id)===0);
  for(let index=0;index<queue.length;index++){
    const id=queue[index];
    for(const target of outgoing.get(id)!){
      ranks.set(target,Math.max(ranks.get(target)!,ranks.get(id)!+1));
      incoming.set(target,incoming.get(target)!-1);if(incoming.get(target)===0)queue.push(target);
    }
  }
  if(queue.length!==ids.length)throw new GraphTopologyError('cycle');
  return ranks;
}

/**
 * 作用定位：后端有向图的纯结构算法，不认识任务、权限、等待状态或前端布局。
 * 设计原因：多个领域图复用无环判断，边选择与领域错误分别维护；与前端算法独立演进。
 */
/**
 * 对唯一节点及完整端点执行拓扑遍历；平行边逐条计数，自环返回 false，空图返回 true。
 * 不修改输入；重复节点或缺端点抛错。领域入口应先核验身份，不能以无环代替授权。
 */
export function isDirectedAcyclic(nodes:readonly string[],edges:readonly (readonly [string,string])[]):boolean{
  const incoming=new Map(nodes.map(node=>[node,0])),outgoing=new Map<string,string[]>();
  if(incoming.size!==nodes.length)throw Error('Duplicate graph node');
  for(const [from,to] of edges){
    if(!incoming.has(from)||!incoming.has(to))throw Error('Missing graph endpoint');
    incoming.set(to,incoming.get(to)!+1);outgoing.set(from,[...(outgoing.get(from)??[]),to]);
  }
  const queue=nodes.filter(node=>incoming.get(node)===0);
  for(let i=0;i<queue.length;i++){
    for(const target of outgoing.get(queue[i])??[]){
      const count=incoming.get(target)!-1;incoming.set(target,count);if(count===0)queue.push(target);
    }
  }
  return queue.length===nodes.length;
}

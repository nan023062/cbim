/**
 * 作用定位：为主会话任务图计算可测试的 DAG 分层坐标与有向连线路径，供任务视图绘制。
 * 设计原因：布局只依赖身份和连线，不依赖不断变化的文字/状态；同层保留上次顺序并在末尾加入新节点，避免实时更新造成跳动。
 * 算法边界：前端 utility 只计算拓扑层级；任务错误、同层稳定顺序、坐标和路径由本模块维护。
 * 职责边界：只显示后端已提交节点，不推断成员任务、不补造依赖；循环或缺失端点须显式报告。
 */
import {rankDirectedGraph,GraphTopologyError} from '../foundations/utility';
import type {GraphSnapshot,GraphEdge} from '../../bridge/contracts/dispatch';

/** 图节点的画布坐标；布局身份与打开任务详情时使用的业务身份分别保存。 */
export interface GraphNodePosition {
  /** 图内节点 ID；根为 session:<rootSessionId>，业务节点为 task:<taskId>。 */
  nodeId:string;
  /** 根节点缺省；业务任务详情用此 ID，不能把 nodeId 直接传给执行接口。 */
  taskId?:string;
  /** 从 0 开始的拓扑层级，由启用的派发边和依赖边共同决定。 */
  rank:number;
  /** 相对画布左上角的位置与尺寸，单位均为显示像素。 */
  x:number;y:number;width:number;height:number;
}
/** 保留后端连线身份和种类；path 是同一画布坐标系内的 SVG 路径，不改变依赖关系。 */
export interface GraphEdgePosition {edge:GraphEdge;path:string}
/** 坐标以显示像素计；节点不随视口缩小，窄屏通过图内滚动保留可读字号。 */
export interface DispatchGraphLayout {nodes:GraphNodePosition[];edges:GraphEdgePosition[];width:number;height:number}
/** 布局所需的最小图输入；状态文案和成员运行进度不参与坐标计算。 */
export type LayoutGraph=Pick<GraphSnapshot,'root'|'tasks'|'edges'>;
/** 卡片尺寸（显示像素）与画布布局共用，视口缩小时滚动而不缩字。 */
export const GRAPH_NODE_WIDTH=248,GRAPH_NODE_HEIGHT=192;
const PADDING=20,COLUMN_GAP=32,RANK_GAP=74;

/**
 * 合并派发边和启用依赖边执行拓扑分层，所有箭头都从较早层指向较晚层。
 * previous 只影响同层顺序；新依赖改变拓扑时允许必要移动，状态和正文变化不影响坐标。
 */
export function layoutDispatchGraph(graph:LayoutGraph|undefined,rootNodeId:string,previous?:DispatchGraphLayout):DispatchGraphLayout{
  const ids=[rootNodeId,...(graph?.tasks.map(task=>task.nodeId)??[])];
  if(new Set(ids).size!==ids.length)throw Error('任务图存在重复节点，无法绘制');
  const enabled=graph?.edges.filter(edge=>edge.enabled)??[];
  let ranks:Map<string,number>;
  try{ranks=rankDirectedGraph(ids,enabled.map(edge=>[edge.fromNodeId,edge.toNodeId] as const))}
  catch(error){
    if(!(error instanceof GraphTopologyError))throw error;
    throw Error(error.code==='missing-endpoint'?'任务图连线缺少端点，请重新同步':error.code==='cycle'?'任务图存在循环，无法绘制有向流程':'任务图存在重复节点，无法绘制');
  }
  const prior=new Map(previous?.nodes.map(node=>[node.nodeId,node])??[]),tasks=new Map(graph?.tasks.map(task=>[task.nodeId,task])??[]);
  const layers=new Map<number,string[]>();
  for(const id of ids){const rank=ranks.get(id)!;layers.set(rank,[...(layers.get(rank)??[]),id])}
  const nodes:GraphNodePosition[]=[];
  for(const [rank,layer] of [...layers].sort(([a],[b])=>a-b)){
    layer.sort((a,b)=>{
      const oldA=prior.get(a),oldB=prior.get(b),aStable=oldA?.rank===rank,bStable=oldB?.rank===rank;
      if(aStable&&bStable)return oldA.x-oldB.x;
      if(aStable!==bStable)return aStable?-1:1;
      const aTime=tasks.get(a)?.createdAt??'',bTime=tasks.get(b)?.createdAt??'';
      return aTime.localeCompare(bTime)||a.localeCompare(b);
    });
    layer.forEach((nodeId,column)=>nodes.push({nodeId,taskId:tasks.get(nodeId)?.taskId,rank,x:PADDING+column*(GRAPH_NODE_WIDTH+COLUMN_GAP),y:PADDING+rank*(GRAPH_NODE_HEIGHT+RANK_GAP),width:GRAPH_NODE_WIDTH,height:GRAPH_NODE_HEIGHT}));
  }
  const baseWidth=Math.max(...nodes.map(node=>node.x+node.width))+PADDING,byId=new Map(nodes.map(node=>[node.nodeId,node]));
  let outsideLanes=0;
  const edges=enabled.map(edge=>{
    const source=byId.get(edge.fromNodeId)!,target=byId.get(edge.toNodeId)!;
    const x1=source.x+source.width/2,y1=source.y+source.height,x2=target.x+target.width/2,y2=target.y;
    if(target.rank-source.rank===1){const middle=(y1+y2)/2;return {edge,path:`M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`}}
    // 跨层连线走节点区外侧，避免穿过中间任务的正文。
    const side=baseWidth+16+outsideLanes++*14;
    return {edge,path:`M ${x1} ${y1} L ${x1} ${y1+22} L ${side} ${y1+22} L ${side} ${y2-22} L ${x2} ${y2-22} L ${x2} ${y2}`};
  });
  return {nodes,edges,width:baseWidth+(outsideLanes?32+outsideLanes*14:0),height:Math.max(...nodes.map(node=>node.y+node.height))+PADDING};
}

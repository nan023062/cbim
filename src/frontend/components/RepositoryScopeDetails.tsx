/**
 * 作用定位：在主对话工具详情与执行核实报告中展示可信回执的资源仓库范围。
 * 设计原因：外部资料读取不能冒充业务文件操作；只解析公开身份字段，不从模型参数或资源正文猜测作用域，不将历史回执当成当前授权。
 */
import {repositoryToolScopeSchema} from '../../bridge/contracts/execution';
import './repository-scope.css';

/** 兼容旧日志：没有合法仓库 scope 时不添加该说明；本组件不访问服务或发起读取。 */
export function RepositoryScopeDetails({scope}:{scope:unknown}){
  const parsed=repositoryToolScopeSchema.safeParse(scope);if(!parsed.success)return null;const value=parsed.data;
  return <div className="repository-scope-details" data-testid="repository-tool-scope">
    <b>资源仓库 · {value.operation==='list'?'查询目录':'读取资料'}</b>
    <span>链接器 <code>{value.connectorId}</code></span><span>仓库 <code>{value.repositoryId}</code></span><span>连接实例 <code>{value.connectionId}</code></span>
    <small>这是该次调用的范围记录，资料不等于业务文件实现或验收证据。</small>
  </div>;
}

/**
 * 作用定位：为静态架构编辑和资源导入提供可选的 Team/小组归属。
 * 设计原因：小组可仅由空目录或辅助正文组成，没有自身 skills.json；优先纳入同版本规则索引，再从定义路径补齐祖先，避免下拉框丢失合法归属。这里只读取静态快照。
 */
import type {Snapshot} from '../../bridge/contracts/workspace';

/** Team 根恒存在；Agent 是叶子，不能作为另一个 Agent/团队的归属。 */
export function teamGroupIds(snapshot:Snapshot):string[]{
  const root='.cbim/team',groups=new Set([root]),agents=new Set<string>();
  function addAncestors(id:unknown){
    if(typeof id!=='string'||!(id===root||id.startsWith(root+'/'))||id.includes('\\')||id.split('/').some(part=>!part||part==='.'||part==='..'))return;
    let owner=id;
    while(owner===root||owner.startsWith(root+'/')){groups.add(owner);owner=owner.slice(0,owner.lastIndexOf('/'))}
  }
  // Rules 读取真实目录后生成的 groups 还覆盖空组和只有 references 正文的组；快照正文不能重建这些事实。
  const registry=snapshot.validation?.indexes?.[root+'/registry.json'];
  if(registry)try{const parsed=JSON.parse(registry);if(Array.isArray(parsed?.groups))for(const group of parsed.groups)addAncestors(group?.id)}catch{/* 损坏的派生索引不能使编辑界面崩溃，仍显示可从正式定义确认的归属。 */}
  for(const file of snapshot.files){
    if(!file.path.startsWith(root+'/'))continue;
    const agent=file.path.endsWith('/agent.json'),inventory=file.path.endsWith('/skills.json');
    if(!agent&&!inventory)continue;
    let owner=file.path.slice(0,file.path.lastIndexOf('/'));
    if(agent){agents.add(owner);owner=owner.slice(0,owner.lastIndexOf('/'))}
    addAncestors(owner);
  }
  return [...groups].filter(id=>![...agents].some(agent=>id===agent||id.startsWith(agent+'/'))).sort();
}

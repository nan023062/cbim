/**
 * 作用定位：从模块责任登记解析显式或最近祖先负责人，供发现、派发和 Store 不变量共同核对。
 * 设计原因：继承是只读解析，不为子模块复制责任记录；路径分段限制祖先范围，空负责人继续向上查找。失效的显式关系仍返回，由调用者报告缺口。
 */
import type {ModuleOwnership} from '../../workspace/rules/module-ownership';

/** 不缓存结果；每次使用当前登记，因而新关系立即影响新选择，历史绑定由调用方保留。 */
export function implicitModuleOwner(owners:readonly ModuleOwnership[]|undefined,moduleId:string):ModuleOwnership|undefined{
  if(!moduleId.startsWith('.cbim/workspace/')||moduleId.split('/').some(part=>!part||part==='.'||part==='..'))return;
  let current=moduleId;
  while(current!=='.cbim/workspace'){
    const owner=owners?.find(value=>value.moduleId===current&&value.ownerMemberId!==null);
    if(owner)return owner;
    current=current.slice(0,current.lastIndexOf('/'));
  }
}

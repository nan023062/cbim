/**
 * 作用定位：办公室工作人员，将组织树中的岗位绑定到该办公室的 Agent 实例。
 * 设计原因：薄实例只关联岗位与分配到的 Agent，避免再次拥有引擎创建和关闭职责。
 */
import type { Organization } from '../cability/organization';

export class Worker
{
  public constructor(public readonly memberId: string, public readonly agentId: string, public readonly agent: ReturnType<Organization['Allocate']>)
  {
  }
}

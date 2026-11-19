/** 办公室工作人员，将组织树中的岗位绑定到该办公室的 Agent 实例。 */
import type { Organization } from '../cability/organization';

export class Worker
{
  public constructor(public readonly memberId: string, public readonly agentId: string, public readonly agent: ReturnType<Organization['Allocate']>)
  {
  }
}

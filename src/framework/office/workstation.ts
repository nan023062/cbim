/** 办公室工位，引用该工位承载的业务工作区。 */
import type { WorkspaceInstance } from '../business';

export class Workstation
{
  public constructor(public readonly workspace: WorkspaceInstance)
  {
  }
}

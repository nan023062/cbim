/**
 * 作用定位：办公室工位，引用该工位承载的业务工作区。
 * 设计原因：工位引用已打开的 WorkspaceInstance，目录资源管理仍由工作区实例承担。
 */
import type { WorkspaceInstance } from '../business';

export class Workstation
{
  public constructor(public readonly workspace: WorkspaceInstance)
  {
  }
}

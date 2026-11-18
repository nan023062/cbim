/** 将原生锁占用与访问失败转换成原生 Error。 */
import { KernelLock, KernelLockError } from '../../core/io/locking';

/** 获取一把锁；其它系统异常原样传播，调用者负责释放。 */
export function acquireLock(root: string, id: string, scope?: string): KernelLock
{
  try
  {
    return new KernelLock(root, id, scope);
  }
  catch (error)
  {
    if (error instanceof KernelLockError)
      throw new Error(error.message);

    throw error;
  }
}

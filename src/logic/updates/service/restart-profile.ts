/**
 * 作用定位：恢复安装器显式传回的本机用户目录，供 Main 在初始化任何业务数据之前调用。
 * 设计原因：Windows Shell 重启不会继承原进程环境；必须保留自定义目录，避免更新后打开另一份历史。
 */
import path from 'node:path';
/** 只接受更新重启参数或原环境中的绝对目录；不接受重复参数、控制字符或可截断的长路径，不回退到别的用户目录。 */
export function updateUserRoot(args:string[],environment:string|undefined){
  const values=args.filter(arg=>arg.startsWith('--cbim-user-data-root='));
  if(values.length>1||values.length&&!args.includes('--updated'))throw Error('更新重启用户目录参数无效');
  const root=values.length?values[0].slice('--cbim-user-data-root='.length):environment;
  if(root===undefined)return;
  if(!root||root.length>700||/["\x00-\x1f]/.test(root)||!path.isAbsolute(root))throw Error('用户目录必须是有效的绝对路径，且长度不超过 700 字符');
  return path.resolve(root);
}

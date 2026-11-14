/**
 * 作用定位：正式 R 构建替换源码兼容表，禁止回退到内嵌具体引擎。
 * 设计原因：生产只加载冷宿主已验证的独立 E 包；缺包或协议不兼容不能悄悄启动另一个实现。
 */
import type {EngineAdapter} from '../rules/engine-adapter';
export function sourceEngineAdapter(_id:string):EngineAdapter {throw Error('正式运行需要已验证的独立引擎包，请在引擎设置中准备后重试')}

/**
 * 作用定位：当前源码/旧包的官方适配器装配表，所有实现均通过同一版本协议取得工厂。
 * 设计原因：退出按构造器分支的中央工厂；独立包加载接入前保留开发及旧宿主入口，不能宣称此表已完成冷壳迁移。
 */
import {engineAdapter as pi} from '../engines/pi/package';
import {engineAdapter as claude} from '../engines/claude/package';
import {engineAdapter as codex} from '../engines/codex/package';
import {engineAdapter as memory} from '../engines/memory/package';
import {checkedEngineAdapter} from '../rules/engine-adapter';
const adapters=[pi,claude,codex,memory] as const;
/** 只查开发者静态注册，无默认引擎回退或失败重试。 */
export function sourceEngineAdapter(id:string){return checkedEngineAdapter(adapters.find(adapter=>adapter.id===id),{id})}

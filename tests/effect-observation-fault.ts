import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {PiEngine} from '../src/backend/engines/pi/engine';
import type {EngineContext} from '../src/logic/execution/rules/types';
import {effectFixture as data} from './effect-observation-provider';

type Event={type:string;toolCallId?:string;toolName?:string;isError?:boolean;result?:unknown};
type TestEngine={context?:EngineContext;consume(event:Event):Promise<void>};
/** 只丢测试专属 Pi 的真实结束事件；磁盘写入和原生历史已真实发生，不删改任何已保存 canonical。 */
export function loseOriginalEffectResult(project:string){
  const prototype=PiEngine.prototype as unknown as TestEngine,consume=prototype.consume,events:Event[]=[];
  const wrapped=async function(this:TestEngine,event:Event){
    if(this.context?.memberBinding&&path.resolve(this.context.task.root)===path.resolve(project)&&event.type==='tool_execution_end'&&event.toolCallId==='effect-old-write'){
      assert.equal(event.toolName,'write');assert.equal(event.isError,false);assert.equal(await fs.readFile(path.join(project,data.file),'utf8'),data.oldText);assert.equal(events.length,0);events.push(structuredClone(event));return;
    }
    return consume.call(this,event);
  };
  prototype.consume=wrapped;
  return {events,restore:()=>{assert.equal(prototype.consume,wrapped);prototype.consume=consume}};
}

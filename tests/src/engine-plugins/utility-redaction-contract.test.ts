import {it,expect} from 'vitest';
import {PiEngine} from '../../../src/engine-plugins/pi/engine';
import {CodexEngine} from '../../../src/engine-plugins/codex/engine';
import {ClaudeCodeEngine} from '../../../src/engine-plugins/claude/engine';

it('引擎保留凭据选择策略，Pi 仅对 api-key 模式替换',()=>{
  const options:any={llm:{apiKey:'secret',profile:{auth:'api-key'}}};
  for(const Engine of [PiEngine,CodexEngine,ClaudeCodeEngine]){
    const engine=new Engine(options) as any;
    expect(engine.Redact('secret secret')).toBe('[REDACTED] [REDACTED]');
  }
  const pi=new PiEngine({llm:{apiKey:'secret',profile:{auth:'oauth'}}} as any) as any;
  expect(pi.Redact('secret')).toBe('secret');
});
it('Claude 无凭据保留事件引用，有凭据仍按原序列化路径替换',async()=>{
  const event={type:'message.delta',data:{text:'secret'}};
  for(const apiKey of [undefined,'secret']){
    const engine=new ClaudeCodeEngine({llm:{apiKey}} as any) as any;
    let received:any;engine.context={emit:async(value:any)=>{received=value}};
    await engine.Emit(event);
    if(!apiKey)expect(received).toBe(event);
    else expect(received).toEqual({type:'message.delta',data:{text:'[REDACTED]'}});
  }
  expect(event.data.text).toBe('secret');
});

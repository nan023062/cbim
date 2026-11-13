import {expect,it} from 'vitest';
import {LineFramer} from '../../../../src/core/utility';

it('任意分块仅按 LF 交付，保留 CR、空白和 Unicode 分隔符，不交付 EOF 尾部',()=>{
  const lines:string[]=[],tails:string[]=[],frames=new LineFramer({checkLine:()=>{},checkRemainder:text=>{tails.push(text)}});
  frames.push('one\r',line=>lines.push(line));frames.push('\n\n\u2028\u2029\ntail',line=>lines.push(line));
  expect(lines).toEqual(['one\r','','\u2028\u2029']);expect(tails).toEqual(['one\r','tail']);
  frames.push('\n',line=>lines.push(line));expect(lines.at(-1)).toBe('tail');
});
it('完整帧与尾部各自按调用者规则拒绝，精确上限可读',()=>{
  const reason=Error('limit'),check=(text:string)=>{if(text.length>3)throw reason};
  const frames=new LineFramer({checkLine:check,checkRemainder:check}),lines:string[]=[];
  frames.push('abc\n',line=>lines.push(line));expect(lines).toEqual(['abc']);
  expect(()=>frames.push('toolong\n',line=>lines.push(line))).toThrow(reason);expect(lines).toEqual(['abc']);
  expect(()=>new LineFramer({checkLine:check,checkRemainder:check}).push('abcd',()=>{})).toThrow(reason);
});
it('接收失败不撤回先前帧、不预先吞掉后续帧，实例隔离',()=>{
  const lines:string[]=[],reason=Error('bad protocol'),frames=new LineFramer({checkLine:()=>{},checkRemainder:()=>{}});
  expect(()=>frames.push('ok\nbad\nafter\n',line=>{if(line==='bad')throw reason;lines.push(line)})).toThrow(reason);
  expect(lines).toEqual(['ok']);frames.push('',line=>lines.push(line));expect(lines).toEqual(['ok','after']);
  const other=new LineFramer({checkLine:()=>{},checkRemainder:()=>{}});other.push('',line=>lines.push(line));expect(lines).toHaveLength(2);
});
it('同一文本可按 UTF-16 字符或 UTF-8 字节计量，机制不改写策略',()=>{
  const policy=(measure:(text:string)=>number)=>{const check=(text:string)=>{if(measure(text)>3)throw Error('limit')};return {checkLine:check,checkRemainder:check}};
  const received:string[]=[];new LineFramer(policy(text=>text.length)).push('中文\n',line=>received.push(line));
  expect(received).toEqual(['中文']);expect(()=>new LineFramer(policy(text=>new TextEncoder().encode(text).length)).push('中文\n',()=>{})).toThrow('limit');
});

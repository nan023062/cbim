import {describe,it,expect} from 'vitest';
import {redactLiteral} from '../../../../src/foundations/utility';
describe('literal redaction',()=>{
  it('替换每次精确出现，不解释正则字符或大小写',()=>{
    expect(redactLiteral('a.* a.* A.*','a.*')).toBe('[REDACTED] [REDACTED] A.*');
    expect(redactLiteral('中文中文','中文')).toBe('[REDACTED][REDACTED]');
  });
  it('缺失、空凭据和无匹配保持原文',()=>{
    expect(redactLiteral('abc',undefined)).toBe('abc');expect(redactLiteral('abc','')).toBe('abc');
    expect(redactLiteral('abc','other')).toBe('abc');expect(redactLiteral('','secret')).toBe('');
  });
  it('保持非重叠替换与原始文本转义语义',()=>{
    expect(redactLiteral('aaa','aa')).toBe('[REDACTED]a');
    expect(redactLiteral('a\\nb','a\nb')).toBe('a\\nb');
    expect(redactLiteral('a\nb','a\nb')).toBe('[REDACTED]');
  });
});

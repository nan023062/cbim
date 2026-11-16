import {describe,it,expect} from 'vitest';
import {StringUtils} from '../../../../src/core/utility';
describe('literal redaction',()=>{
  it('替换每次精确出现，不解释正则字符或大小写',()=>{
    expect(StringUtils.redactLiteral('a.* a.* A.*','a.*')).toBe('[REDACTED] [REDACTED] A.*');
    expect(StringUtils.redactLiteral('中文中文','中文')).toBe('[REDACTED][REDACTED]');
  });
  it('缺失、空凭据和无匹配保持原文',()=>{
    expect(StringUtils.redactLiteral('abc',undefined)).toBe('abc');expect(StringUtils.redactLiteral('abc','')).toBe('abc');
    expect(StringUtils.redactLiteral('abc','other')).toBe('abc');expect(StringUtils.redactLiteral('','secret')).toBe('');
  });
  it('保持非重叠替换与原始文本转义语义',()=>{
    expect(StringUtils.redactLiteral('aaa','aa')).toBe('[REDACTED]a');
    expect(StringUtils.redactLiteral('a\\nb','a\nb')).toBe('a\\nb');
    expect(StringUtils.redactLiteral('a\nb','a\nb')).toBe('[REDACTED]');
  });
});

import {expect,it} from 'vitest';
import {htmlMarkdown,truncateParagraphs} from '../src/core/web';
it('HTML 保留正文结构，去除导航和脚本，段落截断不切坏 Unicode',()=>{
  const page=htmlMarkdown('<title>标题</title><nav>菜单</nav><main><h1>正文</h1><p>第一段 &amp; 信息</p><p>第二段 <a href="/a">引用</a></p><script>secret()</script></main>','https://example.com');
  expect(page.title).toBe('标题');expect(page.markdown).toContain('# 正文');expect(page.markdown).toContain('[引用](https://example.com/a)');expect(page.markdown).not.toMatch(/菜单|secret/);
  expect(truncateParagraphs('一段\n\n第二段内容',6)).toEqual({markdown:'一段',truncated:true});expect(truncateParagraphs('😀😀😀',2)).toEqual({markdown:'😀😀',truncated:true});
});

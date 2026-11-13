import {test,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MarkdownMessage} from '../src/view/execution-view/MarkdownMessage';
import {repairStreamingMarkdown} from '../src/view/execution-view/repairStreamingMarkdown';
test('message renders GFM and highlighted code without executing raw HTML or unsafe links',()=>{
  const text='## 完成\n\n**已写入**\n\n- 第一项\n\n| 名称 | 结果 |\n| --- | --- |\n| 游戏 | 可运行 |\n\n```js\nconst game = 1;\n```\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))';
  const html=renderToStaticMarkup(createElement(MarkdownMessage,{text,workspaceId:'w'}));
  for(const expected of ['<h2>完成</h2>','<strong>已写入</strong>','<li>第一项</li>','<table>','复制代码','hljs-keyword'])expect(html).toContain(expected);
  expect(html).not.toContain('<script>');expect(html).not.toContain('href="javascript:');
});
test('stream repair affects display only and keeps code fence stable',()=>{
  const source='```js\nconst a = 1;';expect(repairStreamingMarkdown(source)).toContain('const a = 1;');
  const html=renderToStaticMarkup(createElement(MarkdownMessage,{text:source,streaming:true,workspaceId:'w'}));expect(html).toContain('chat-code-block');expect(source).toBe('```js\nconst a = 1;');
});

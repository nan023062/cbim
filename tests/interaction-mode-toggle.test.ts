import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {InteractionModeToggle} from '../src/view/conversation/InteractionModeToggle';
it('一个按钮表达当前视图及切换目标；渲染不改变会话',()=>{
 let changes=0;
 for(const [office,review,label] of [[false,false,'切换到办公室'],[true,false,'切换到对话'],[true,true,'切换到工作审阅']] as const){
 const html=renderToStaticMarkup(createElement(InteractionModeToggle,{office,review,onToggle:()=>{changes++}}));
 expect(html.match(/<button/g)).toHaveLength(1);expect(html).toContain(label);expect(html).toContain('aria-pressed="'+office+'"');
 }
 expect(changes).toBe(0);
});

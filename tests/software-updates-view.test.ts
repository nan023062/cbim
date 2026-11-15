import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {SoftwareUpdates} from '../src/view/updates/SoftwareUpdates';
import type {SoftwareUpdateController} from '../src/view/updates/useSoftwareUpdates';

function render(progress?:number){
  const updates={status:{enabled:true,currentVersion:'0.1.16',phase:'downloading',progress},act:async()=>{},refresh:async()=>{}} as unknown as SoftwareUpdateController;
  return renderToStaticMarkup(createElement(SoftwareUpdates,{updates,onClose:()=>{}}));
}
describe('下载计量展示',()=>{
  it('未知进度使用不定指示，不虚构 0%',()=>{
    const html=render();
    expect(html).toContain('进度待确认');
    expect(html.match(/<progress[^>]*>/)?.[0]).not.toContain('value=');
    expect(html).not.toContain('0%');
  });
  it.each([0,37,100])('保留后端返回的 %s 百分比',progress=>{
    const html=render(progress);
    expect(html.match(/<progress[^>]*>/)?.[0]).toContain(`value="${progress}"`);
    expect(html).not.toContain('进度待确认');
  });
});

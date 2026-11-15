import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {EngineOverview} from '../src/view/settings/EngineOverview';
import type {EnginePackageStatus} from '../src/bridge/contracts/engines';

const engine=(overrides:Partial<EnginePackageStatus>={}):EnginePackageStatus=>({
  kind:'pi',enabled:true,active:{kind:'pi',identity:'a'.repeat(64),version:'1.1.0',nativeVersion:'1.5.0',protocol:1,dependencies:[]},
  installed:[],references:0,preparing:false,...overrides,
});
const render=(items:EnginePackageStatus[],managed=true)=>renderToStaticMarkup(createElement(EngineOverview,{state:{managed,revision:1,items},onSelect:()=>{}}));

describe('installed engine overview',()=>{
  it('shows active versions including disabled engines, but excludes removed caches and uninstalled candidates',()=>{
    const pi=engine(),candidate={...pi.active!,version:'2.0.0'};
    const html=render([engine({candidate}),engine({kind:'claude-code',enabled:false}),engine({kind:'codex',active:undefined,installed:[candidate]}),engine({kind:'memory',active:undefined,candidate})]);
    expect(html).toContain('已安装引擎 · 2');
    expect(html).toContain('查看 Pi 引擎详情');expect(html).toContain('查看 Claude Code 引擎详情');
    expect(html).toContain('当前版本 1.1.0');expect(html).toContain('运行库 1.5.0');
    expect(html).toContain('已停用');expect(html).not.toContain('查看 Codex');expect(html).not.toContain('查看 记忆引擎');
    expect(html).not.toContain('2.0.0');expect(html).not.toContain('下载并安装');
  });
  it('does not hide a running reference when preparation or an error also exists',()=>{
    const html=render([engine({references:2,preparing:true,preparation:{identity:'b'.repeat(64),version:'2.0.0',progress:37},error:'校验失败 <script>'})]);
    expect(html).toContain('运行中 · 2 个占用');expect(html).toContain('准备中');expect(html).toContain('准备进度 37%');
    expect(html).toContain('异常：校验失败 &lt;script&gt;');expect(html).not.toContain('<script>');
  });
  it.each([[true,'空闲'],[false,'未运行']] as const)('distinguishes an enabled=%s idle engine', (enabled,label)=>{
    expect(render([engine({enabled})])).toContain(label);
  });
  it('reports an idle failure rather than presenting it as healthy or inventing preparation progress',()=>{
    const failed=render([engine({error:'缓存缺失'})]);expect(failed).toContain('异常：缓存缺失');expect(failed).not.toContain('空闲');
    const preparing=render([engine({preparing:true})]);expect(preparing).toContain('准备中');expect(preparing).not.toContain('准备进度');
  });
  it('distinguishes not loaded, source mode, and an empty installed list',()=>{
    expect(renderToStaticMarkup(createElement(EngineOverview,{onSelect:()=>{}}))).toBe('');
    expect(render([],false)).toContain('源码开发模式');expect(render([],false)).not.toContain('尚未安装');
    expect(render([])).toContain('尚未安装引擎');expect(render([])).not.toContain('<button');
  });
});

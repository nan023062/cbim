import {describe,it,expect} from 'vitest';
import {updateButtonState} from '../src/frontend/updates/update-button-state';
import type {DesktopUpdateStatus} from '../src/bridge/contracts/desktop-updates';
const base:DesktopUpdateStatus={currentVersion:'0.1.14',currentNotes:'notes',enabled:true,phase:'idle',release:{version:'0.1.15',tag:'desktop-v0.1.15',notes:'next',publishedAt:'2026-11-12T00:00:00Z'}};
describe('sidebar update control',()=>{
  it('only a verified ready candidate accepts install',()=>{
    for(const phase of ['disabled','idle','checking','current','available','downloading','installing'] as const)expect(updateButtonState({...base,phase,progress:100}).canInstall).toBe(false);
    expect(updateButtonState({...base,phase:'ready'}).canInstall).toBe(true);
    expect(updateButtonState({...base,phase:'ready'},true)).toMatchObject({canInstall:false,ready:false,active:true,progress:undefined});
    expect(updateButtonState({...base,phase:'ready',enabled:false}).canInstall).toBe(false);
    expect(updateButtonState({...base,phase:'ready',release:undefined}).canInstall).toBe(false);
    expect(updateButtonState().canInstall).toBe(false);
  });
  it('does not show a full ring merely because transfer reached 100 percent',()=>{
    expect(updateButtonState({...base,phase:'downloading',progress:100})).toMatchObject({ready:false,progress:99,active:true});
    expect(updateButtonState({...base,phase:'downloading',progress:-5}).progress).toBe(0);
    expect(updateButtonState({...base,phase:'downloading',progress:NaN}).progress).toBeUndefined();
    expect(updateButtonState({...base,phase:'ready',progress:20})).toMatchObject({ready:true,progress:100});
  });
  it('shows installed and target code/resource versions independently',()=>{
    const view=updateButtonState({...base,currentResourceVersion:2,release:{...base.release!,version:'0.1.14',resourceVersion:3,delivery:'resources'}});
    expect(view.current).toBe('当前版本 C 0.1.14 · R 2');expect(view.target).toBe('可更新版本 C 0.1.14 · R 3');
    expect(updateButtonState(base).current).toBe('当前版本 v0.1.14');
  });
  it('keeps install retries explicit and reports read/download failures',()=>{
    expect(updateButtonState({...base,phase:'ready',error:'排空失败'})).toMatchObject({canInstall:true,error:'排空失败',progress:100});
    expect(updateButtonState({...base,phase:'available',error:'下载失败'})).toMatchObject({canInstall:false,error:'下载失败',progress:undefined});
    expect(updateButtonState(base,false,'无法读取更新状态').error).toBe('无法读取更新状态');
  });
});

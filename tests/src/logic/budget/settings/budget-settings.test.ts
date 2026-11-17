import {describe,it,expect} from 'vitest';
import {BudgetSettings,type BudgetSettingsStorage} from '../../../../../src/logic/budget/settings/budget-settings';

function memory(initial?:string){let value=initial,failWrite=false,writes=0;const storage:BudgetSettingsStorage={Read:async()=>{if(value===undefined)throw Object.assign(Error('missing'),{code:'ENOENT'});return value},Write:async(_file,next)=>{if(failWrite)throw Error('disk full');writes++;value=next}};return {storage,get value(){return value},get writes(){return writes},set failWrite(v:boolean){failWrite=v}}}
describe('versioned scope budget settings',()=>{
  it('starts disabled, requires init, returns detached policy and persists across reconstruction',async()=>{
    const disk=memory(),settings=new BudgetSettings('test',disk.storage);expect(()=>settings.Read()).toThrow('尚未就绪');await settings.Init();expect(settings.Read()).toEqual({revision:1,enabled:false,limits:{}});expect(disk.writes).toBe(0);
    const saved=await settings.Configure({revision:1,enabled:true,limits:{tokens:1200,estimatedCostUsd:0.01}});expect(saved.revision).toBe(2);saved.limits.tokens=1;expect(settings.Read().limits.tokens).toBe(1200);
    const reopened=new BudgetSettings('test',disk.storage);await reopened.Init();expect(reopened.Read()).toEqual(settings.Read());
    await settings.Configure(settings.Read());expect(disk.writes).toBe(1);
  });
  it('serializes competing revisions and preserves the old policy when disk fails',async()=>{
    const disk=memory(),settings=new BudgetSettings('test',disk.storage);await settings.Init();const results=await Promise.allSettled([settings.Configure({revision:1,enabled:true,limits:{tokens:100}}),settings.Configure({revision:1,enabled:true,limits:{tokens:200}})]);expect(results.map(r=>r.status)).toEqual(['fulfilled','rejected']);expect(settings.Read().limits.tokens).toBe(100);
    disk.failWrite=true;await expect(settings.Configure({revision:2,enabled:true,limits:{tokens:300}})).rejects.toMatchObject({code:'BUDGET_SETTINGS_WRITE'});expect(settings.Read()).toEqual({revision:2,enabled:true,limits:{tokens:100}});
    disk.failWrite=false;await settings.Configure({revision:2,enabled:false,limits:{}});expect(settings.Read()).toEqual({revision:3,enabled:false,limits:{}});
  });
  it('rejects invalid limits and unknown fields before writing; corrupt saved settings never silently disable limits',async()=>{
    const disk=memory(),settings=new BudgetSettings('test',disk.storage);await settings.Init();for(const limits of [{},{tokens:0},{tokens:1.5},{tokens:Number.MAX_SAFE_INTEGER+1},{estimatedCostUsd:-1},{estimatedCostUsd:NaN}])await expect(settings.Configure({revision:1,enabled:true,limits})).rejects.toMatchObject({code:'BUDGET_SETTINGS_INPUT'});
    await expect(settings.Configure({revision:1,enabled:true,limits:{tokens:100},scopeId:'foreign'})).rejects.toMatchObject({code:'BUDGET_SETTINGS_INPUT'});expect(disk.writes).toBe(0);
    const broken=memory('{bad');const bad=new BudgetSettings('test',broken.storage);await expect(bad.Init()).rejects.toMatchObject({code:'BUDGET_SETTINGS_INVALID'});expect(()=>bad.Read()).toThrow('尚未就绪');expect(broken.writes).toBe(0);
  });
});

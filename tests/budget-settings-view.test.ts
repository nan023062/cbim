import {describe,it,expect} from 'vitest';
import {BudgetSettingsController,budgetSettingsInput} from '../src/frontend/settings/budget-settings-state';

const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}};
describe('scope budget settings draft',()=>{
  it('发布状态后同步通知，退订后只更新状态而不通知旧页面',()=>{
    let reads=0;const controller=new BudgetSettingsController(async()=>{reads++;return undefined});
    const values:string[]=[];
    const off=controller.subscribe(()=>values.push(controller.snapshot().tokens));
    controller.edit({tokens:'100'});expect(values).toEqual(['100']);
    off();controller.edit({tokens:'200'});
    expect(values).toEqual(['100']);expect(controller.snapshot().tokens).toBe('200');expect(reads).toBe(0);
  });
  it('treats blanks as unconfigured and requires an explicit positive limit when enabled',()=>{
    expect(budgetSettingsInput({enabled:false,tokens:'bad',estimatedCostUsd:'-1'},1)).toEqual({revision:1,enabled:false,limits:{}});
    expect(budgetSettingsInput({enabled:true,tokens:'1200',estimatedCostUsd:''},2)).toEqual({revision:2,enabled:true,limits:{tokens:1200}});
    expect(budgetSettingsInput({enabled:true,tokens:'',estimatedCostUsd:'.001'},2).limits).toEqual({estimatedCostUsd:0.001});
    for(const tokens of ['', '0','-5','1.2','1e4'])expect(()=>budgetSettingsInput({enabled:true,tokens,estimatedCostUsd:''},1)).toThrow();
  });
  it('does not poll, submits once and ignores responses from a disposed page',async()=>{
    const wait=deferred<unknown>(),calls:string[]=[];const controller=new BudgetSettingsController(async action=>{calls.push(action);return wait.promise});const unsubscribe=controller.subscribe(()=>{});expect(calls).toEqual([]);
    const load=controller.load();await controller.load();expect(calls).toEqual(['budget.settings']);controller.cancel();wait.resolve({revision:1,enabled:true,limits:{tokens:100}});await load;expect(controller.snapshot().policy).toBeUndefined();unsubscribe();
  });
  it('keeps drafts and expected version on failure, then refreshes before saving the latest setting',async()=>{
    let revision=1,fail=true,writes=0;const controller=new BudgetSettingsController(async(action,raw)=>{if(action==='budget.settings')return {revision,enabled:false,limits:{}};writes++;if(fail)throw Error('BUDGET_SETTINGS_CONFLICT');const input=raw as {revision:number};expect(input.revision).toBe(2);return {...(raw as object),revision:++revision}});
    await controller.load();controller.edit({enabled:true,tokens:'300'});await controller.save();expect(writes).toBe(1);expect(controller.snapshot()).toMatchObject({enabled:true,tokens:'300',policy:{revision:1}});expect(controller.snapshot().error).toContain('草稿已保留');
    revision=2;await controller.load();controller.edit({enabled:true,tokens:'500'});fail=false;await controller.save();expect(controller.snapshot()).toMatchObject({enabled:true,tokens:'500',policy:{revision:3}});expect(controller.snapshot().notice).toContain('仅对之后创建的新目标生效');
  });
  it('freezes form while saving and sends the exact visible draft only once',async()=>{
    const wait=deferred<unknown>(),payloads:unknown[]=[];const controller=new BudgetSettingsController(async(action,input)=>{if(action==='budget.settings')return {revision:1,enabled:false,limits:{}};payloads.push(input);return wait.promise});await controller.load();controller.edit({enabled:true,tokens:'800',estimatedCostUsd:'0.02'});const save=controller.save();controller.edit({tokens:'900'});await controller.save();expect(payloads).toEqual([{revision:1,enabled:true,limits:{tokens:800,estimatedCostUsd:0.02}}]);expect(controller.snapshot().tokens).toBe('800');wait.resolve({revision:2,enabled:true,limits:{tokens:800,estimatedCostUsd:0.02}});await save;expect(controller.snapshot().busy).toBe(false);
  });
});

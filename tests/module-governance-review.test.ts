import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers';
import {seedModuleGovernance,moduleGovernanceFixture} from './module-governance-fixture';

it.each(['missing','empty','one_registration_removed'] as const)('已有保护的账本损坏（%s）不能在重开后静默减少登记范围',async(mode)=>{
  const f=await fixture();try{
    const seeded=await seedModuleGovernance(f.app,f.a),registered=await f.app.dispatch('governance.register',{...seeded.identity,commandId:randomUUID(),moduleId:moduleGovernanceFixture.moduleId,expectedKnowledgeRevision:seeded.snapshot.revision});
    expect(registered.action).toBe('register');
    await f.app.dispatch('governance.register',{...seeded.identity,commandId:randomUUID(),moduleId:moduleGovernanceFixture.unprotectedId,expectedKnowledgeRevision:seeded.snapshot.revision});
    await f.app.stop(seeded.entry.id);
    const ledgerPath=path.join(f.user,seeded.entry.id,'governance','module-ledger.json');
    if(mode==='missing')await fs.rm(ledgerPath);
    else {const ledger=JSON.parse(await fs.readFile(ledgerPath,'utf8'));ledger.commands=mode==='empty'?[]:ledger.commands.filter((command:any)=>command.receipt.record.moduleId!==moduleGovernanceFixture.moduleId);await fs.writeFile(ledgerPath,JSON.stringify(ledger));}
    await expect(f.app.open(seeded.entry.id)).rejects.toMatchObject({code:'GOVERNANCE_DATA'});
    expect(f.app.workspace(seeded.entry.id).state).toBe('failed');
    expect(await fs.readFile(path.join(f.a,seeded.overviewPath),'utf8')).toBe(seeded.original);
  }finally{await f.cleanup()}
});

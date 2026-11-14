import {it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {
  createRepositoryConnectionPendingStore,checkedRepositoryConnectionCommit,checkedRepositoryConnectionReceipt,
  checkedRepositoryConnectionUnaccepted,
  isRepositoryConnectionPreflightRejection,REPOSITORY_CONNECTION_PENDING_KEY,REPOSITORY_CONNECTION_PENDING_BYTES,
  type RepositoryConnectionPending,type RepositoryConnectionCommitPending,type RepositoryConnectionGrantPending,
} from '../src/view/resources/repository-connection-state';

const repositoryId='34bbf997-055b-4c56-a70d-f7033cc4d3fa',definitionHash='a'.repeat(64),connectorId='.cbim/connectors/resources',instanceId='bd20194b-2e8a-478f-906f-2f44908438bf';
function storage(){const items=new Map<string,string>();return {items,getItem:vi.fn((key:string)=>items.get(key)??null),setItem:vi.fn((key:string,value:string)=>{items.set(key,value)})}}
function grant(workspaceId='workspace'):RepositoryConnectionGrantPending{return {action:'grant',input:{workspaceId,instanceId,connectorId,repositoryId,definitionHash,expectedGrantRevision:0,commandId:randomUUID()}}}
function commit(workspaceId='workspace'):RepositoryConnectionCommitPending{return {action:'commit',input:{workspaceId,instanceId,planId:randomUUID()},expected:{connectorId,repositoryId,definitionHash}}}
function grantReceipt(pending:RepositoryConnectionGrantPending){const {input}=pending,expected=pending.action==='grant'?pending.input:pending.expected;return {workspaceId:input.workspaceId,connectorId:input.connectorId,commandId:input.commandId,action:pending.action,grant:{workspaceId:input.workspaceId,connectorId:input.connectorId,repositoryId:expected.repositoryId,definitionHash:expected.definitionHash,revision:input.expectedGrantRevision+1,enabled:pending.action==='grant',updatedAt:'2026-11-07T00:00:00.000Z'}}}
function commitReceipt(pending:RepositoryConnectionCommitPending){return {identity:{workspaceId:pending.input.workspaceId,instanceId:pending.input.instanceId},planId:pending.input.planId,...pending.expected,knowledgeRevision:'current',state:'committed',changed:['.cbim/connectors/registry.json']}}

it('冻结小记录可跨卸载恢复，读取不执行操作或覆盖原实例',()=>{
  const disk=storage(),pending=commit(),first=createRepositoryConnectionPendingStore(disk);
  first.save(pending);const encoded=disk.items.get(REPOSITORY_CONNECTION_PENDING_KEY)!;
  expect(JSON.parse(encoded).records).toEqual([pending]);expect(encoded).not.toMatch(/preview|token|url|changes|diff/);
  const reopened=createRepositoryConnectionPendingStore(disk),recovered=reopened.read('workspace');expect(recovered).toEqual(pending);
  expect(reopened.read('other')).toBeUndefined();expect(disk.setItem).toHaveBeenCalledTimes(1);
  if(recovered)recovered.input.instanceId=randomUUID();expect(reopened.read('workspace')).toEqual(pending);
  expect(()=>reopened.save({...pending,input:{...pending.input,instanceId:randomUUID()}})).toThrow('未确认');
  expect(reopened.read('workspace')).toEqual(pending);
});

it('未知或错误回执保留原命令，只有准确确认后才能显式清除',()=>{
  const disk=storage(),store=createRepositoryConnectionPendingStore(disk),pending=grant();store.save(pending);
  for(const raw of [undefined,null,{}, {...grantReceipt(pending),commandId:randomUUID()}])expect(()=>checkedRepositoryConnectionReceipt(raw,pending)).toThrow();
  expect(store.read('workspace')).toEqual(pending);
  const receipt=checkedRepositoryConnectionReceipt(grantReceipt(pending),pending);expect(receipt.commandId).toBe(pending.input.commandId);
  store.remove(pending);expect(store.read('workspace')).toBeUndefined();
  const next=grant();store.save(next);expect(()=>store.remove(pending)).toThrow('迟到回执');expect(store.read('workspace')).toEqual(next);
});

it('坏本地JSON、未知字段、重复工作区与重复命令不降级空表或自动覆盖',()=>{
  const pending=grant(),other=grant('other');
  const invalid:[string,unknown][]=[
    ['json','{'],['version',{version:2,records:[]}],['extra',{version:1,records:[],token:'secret'}],
    ['payload',{version:1,records:[{...pending,preview:{secret:true}}]}],
    ['duplicateWorkspace',{version:1,records:[pending,grant()]}],
    ['duplicateCommand',{version:1,records:[pending,{...other,input:{...other.input,commandId:pending.input.commandId}}]}],
    ['oversize',' '.repeat(REPOSITORY_CONNECTION_PENDING_BYTES+1)],
  ];
  for(const [,value] of invalid){
    const disk=storage(),raw=typeof value==='string'?value:JSON.stringify(value);disk.items.set(REPOSITORY_CONNECTION_PENDING_KEY,raw);
    const store=createRepositoryConnectionPendingStore(disk);expect(()=>store.read('workspace')).toThrow('原数据已保留');
    expect(()=>store.save(pending)).toThrow();expect(()=>store.remove(pending)).toThrow();
    expect(disk.items.get(REPOSITORY_CONNECTION_PENDING_KEY)).toBe(raw);expect(disk.setItem).not.toHaveBeenCalled();
  }
});

it('读取或保存配额失败阻止发送，确认后清除失败仍保留原请求供再次核对',async()=>{
  const disk=storage(),store=createRepositoryConnectionPendingStore(disk),pending=grant(),send=vi.fn();
  disk.setItem.mockImplementation(()=>{throw Error('QuotaExceededError')});
  async function submit(){store.save(pending);await send(pending.input)}
  await expect(submit()).rejects.toThrow('无法保存');expect(send).not.toHaveBeenCalled();
  disk.setItem.mockImplementation((key,value)=>{disk.items.set(key,value)});store.save(pending);
  disk.setItem.mockImplementation(()=>{throw Error('QuotaExceededError')});
  expect(()=>store.save(pending)).toThrow('无法保存');expect(()=>store.remove(pending)).toThrow('无法保存');
  expect(createRepositoryConnectionPendingStore(disk).read('workspace')).toEqual(pending);
  disk.getItem.mockImplementation(()=>{throw Error('SecurityError')});expect(()=>store.read('workspace')).toThrow('无法读取');
});

it('最多64工作区且有字节上限，不淘汰旧未知请求或跨工作区重复命令',()=>{
  const disk=storage(),store=createRepositoryConnectionPendingStore(disk),pending:RepositoryConnectionPending[]=[];
  for(let index=0;index<64;index++){const value=grant('workspace-'+index);pending.push(value);store.save(value)}
  const before=disk.items.get(REPOSITORY_CONNECTION_PENDING_KEY);expect(()=>store.save(grant('workspace-65'))).toThrow('64');
  expect(disk.items.get(REPOSITORY_CONNECTION_PENDING_KEY)).toBe(before);
  const duplicate=grant('new');duplicate.input.commandId=(pending[0] as RepositoryConnectionGrantPending).input.commandId;
  expect(()=>store.save(duplicate)).toThrow('其他工作区');
  store.remove(pending[0]);store.save(grant('workspace-65'));expect(store.read('workspace-65')).toBeDefined();
  const small=storage(),smallStore=createRepositoryConnectionPendingStore(small);expect(()=>smallStore.save(grant('x'.repeat(REPOSITORY_CONNECTION_PENDING_BYTES)))).toThrow('容量');expect(small.setItem).not.toHaveBeenCalled();
});

it('定义提交回执严格绑定原workspace/instance/plan/connector/repository/hash',()=>{
  const pending=commit(),good=commitReceipt(pending);expect(checkedRepositoryConnectionCommit(good,pending)).toEqual(good);
  const variants=[
    {...good,identity:{...good.identity,workspaceId:'other'}},{...good,identity:{...good.identity,instanceId:randomUUID()}},
    {...good,planId:randomUUID()},{...good,connectorId:'.cbim/connectors/other'},{...good,repositoryId:randomUUID()},
    {...good,definitionHash:'b'.repeat(64)},{...good,state:'pending'},{...good,granted:true},
  ];
  for(const raw of variants)expect(()=>checkedRepositoryConnectionCommit(raw,pending)).toThrow();
});

it('grant与revoke同时校验外层和授权事实、精确下一revision及期望enabled',()=>{
  const approved=grant(),revoked:RepositoryConnectionGrantPending={action:'revoke',input:{workspaceId:'workspace',instanceId,connectorId,expectedGrantRevision:4,commandId:randomUUID()},expected:{repositoryId,definitionHash}};
  for(const pending of [approved,revoked]){
    const good=grantReceipt(pending);expect(checkedRepositoryConnectionReceipt(good,pending)).toEqual(good);
    const variants=[
      {...good,workspaceId:'other'},{...good,connectorId:'.cbim/connectors/other'},{...good,commandId:randomUUID()},
      {...good,action:pending.action==='grant'?'revoke':'grant'},
      ...[{workspaceId:'other'},{connectorId:'.cbim/connectors/other'},{repositoryId:randomUUID()},{definitionHash:'b'.repeat(64)},{revision:good.grant.revision+1},{revision:good.grant.revision-1},{enabled:!good.grant.enabled},{token:'secret'}].map(change=>({...good,grant:{...good.grant,...change}})),
    ];
    for(const raw of variants)expect(()=>checkedRepositoryConnectionReceipt(raw,pending)).toThrow();
  }
});

it('只声明首次预检未受理码，网络失败例外仅适用于grant而非提交或撤销',()=>{
  for(const action of ['grant','revoke','commit'] as const){
    for(const code of ['REPOSITORY_CONNECTION_INPUT','REPOSITORY_CONNECTION_PLAN','REPOSITORY_CONNECTION_DEFINITION','REPOSITORY_CONNECTION_STALE','REPOSITORY_CONNECTION_NOT_SHARED','REPOSITORY_CONNECTION_NOT_GRANTED','STALE_INSTANCE','NOT_RUNNING','WORKSPACE_STOPPING']){
      expect(isRepositoryConnectionPreflightRejection(action,{code})).toBe(true);
      expect(isRepositoryConnectionPreflightRejection(action,new Error(code+': 拒绝'))).toBe(true);
    }
    for(const code of ['REPOSITORY_CONNECTION_APPLIED','REPOSITORY_CONNECTION_CONFLICT','IO','UNKNOWN','ENOENT'])expect(isRepositoryConnectionPreflightRejection(action,new Error(code+': 结果未知'))).toBe(false);
    for(const code of ['CONNECTION','TIMEOUT','CANCELLED'])expect(isRepositoryConnectionPreflightRejection(action,code+': 读取失败')).toBe(action==='grant');
    expect(isRepositoryConnectionPreflightRejection(action,new Error('网络中断'))).toBe(false);
  }
});

it('未受理核实严格匹配原退役实例和操作，只有明确true才可清除pending',()=>{
  for(const pending of [commit(),grant(),{action:'revoke' as const,input:{workspaceId:'workspace',instanceId,connectorId,expectedGrantRevision:1,commandId:randomUUID()},expected:{repositoryId,definitionHash}}]){
    const id=pending.action==='commit'?pending.input.planId:pending.input.commandId;
    const proof={identity:{workspaceId:pending.input.workspaceId,instanceId:pending.input.instanceId},action:pending.action,id,unaccepted:true};
    expect(checkedRepositoryConnectionUnaccepted(proof,pending)).toBe(true);
    expect(checkedRepositoryConnectionUnaccepted({...proof,unaccepted:false},pending)).toBe(false);
    for(const raw of [undefined,null,{}, {...proof,unaccepted:'true'},{...proof,identity:{...proof.identity,workspaceId:'other'}},{...proof,identity:{...proof.identity,instanceId:randomUUID()}},{...proof,action:pending.action==='commit'?'grant':'commit'},{...proof,id:randomUUID()},{...proof,confirmed:true}])expect(()=>checkedRepositoryConnectionUnaccepted(raw,pending)).toThrow();
    const disk=storage(),store=createRepositoryConnectionPendingStore(disk);store.save(pending);
    if(checkedRepositoryConnectionUnaccepted({...proof,unaccepted:false},pending))store.remove(pending);
    expect(store.read('workspace')).toEqual(pending);
    if(checkedRepositoryConnectionUnaccepted(proof,pending))store.remove(pending);
    expect(store.read('workspace')).toBeUndefined();
  }
});

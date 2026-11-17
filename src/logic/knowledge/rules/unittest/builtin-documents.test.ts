import fs from 'node:fs/promises';
import {afterEach,expect,it,vi} from 'vitest';
import {Builtins} from '../builtins';
import {hash} from '../../../../core/platform/node/serialization';

// 迁移前 Windows 正文的固定身份；规范有意改变时才更新，不随生成器自动刷新。
const identities={
  "bug-feedback": "c798b63e93af211bc369e197cf8f81ea2db9e42ec23de8667203fe8a3295741d",
  "feature-wish": "46e0e75d5fdd502b4732337cba644d9f5db81d53c04e610960390761df38c535",
  "common-rules": "26562ce9c4ba907b164568d94de550fe824451de4bfc64d1b6b9a5fa2c994a59",
  "knowledge-query": "49a41bea2f8eba889d2bd3838c17654a0febb30d81d167acaae0bd22b547a343",
  "knowledge-governance": "f94c6d35b4a8fd3ad34c8c10208a8ef4581db4292222b972d9ac9c46bfb8e367",
  "shared-skills-workflows": "9a584f352275ec843694baf9a87fc65bdbb8f32ca8eeeb7ae5ac87968ab42c49",
  "architecture-spec": "8598b2109f4e95b773644830660abbeee716d1ee77f45bbfde592bb08e5abff6",
  "architecture-governance": "b88e5d2db36b6928f611e3345a6a8c37b748c63c3aff86b18161c5a31681d004",
  "team-architecture-governance": "b2033d5b8b3dd03c624b35819f6996d96a0dd7c55edc8753de9a968d62f44e4b",
  "business-architecture-governance": "b6b285e823e61bc5b92477c00b1db37b02cdb27b0e5c97244696b0b2e36143c3",
  "core-check": "3e28e6161883479389586e969bb9a206036a52b8dc205bc32ec51e50bf2b11a7",
  "module-spec": "f72f79fece2dbaed70cfaef94fafbd6a22f13a3da0ebd40f9d20fa672819f0d6",
  "module-schema": "3a21c4d1ee7783ada2918d850c4192cb62be4d56e81c639618df31405f99fc9b",
  "create-workflow": "fc3ce5f3b1af97f974b847f54ebdc4b93e5c7a3e15b8d2b653a0647fb7a30803",
  "agent-spec": "d91f795124a876a174791208d1850e3fe88e85807dfa022e551011b7f1c30f53",
  "agent-schema": "e9604d6ccb6cad8def516767f6dc7c780c1fefddef8ea724f115176f86adfbcf",
  "agent-registry-schema": "0ebba47ff2202fbb046abf9542b9554c82f4331a561e0ee143ce2fdf03f026eb",
  "team-skills-schema": "1a2950ae5956ade26733b9db378d0649d7e784a9a8729a92353204fdba8dbe53",
  "create-agent-skill": "6379f9749553d3cc411439264f3532557ef84a16798958f802b80211a77f3a1f",
  "task-spec": "e833fa88c2efe409d8c72e2218665e9298d7997dc9b33ae697a4417f912d6971",
  "task-loop": "172dbb92cb5acf05b6befb2350d648fec9380d729e9167c139e72b5c990d2d93",
  "base-task": "3d73b5f9a176f275af11b12f0703c6cc60b1a98dc412bcfb56d8fced33ad41fd",
  "task-baseline": "416b1c046fa144c905d75e6bf686969ddc4781fcd5362168cc2e35f57ec04105",
  "business-execution": "267ad85dd984de06703bdb780281af9619a22502fd024e5df1ddb232550ffc64",
  "connector-spec": "92705de2a2bfe92ce2cde5c0e1a0456be797004939e0139183ba16d3b052d0e8",
  "connector-schema": "ef6adcd7e4405c78fb53ae60f3f338b4962d9e09c2bf8473a82a3052d26b3f75"
};

afterEach(()=>vi.restoreAllMocks());

it('编译内置资料保留迁移正文身份，目录和读取不访问文件系统',async()=>{
  const read=vi.spyOn(fs,'readFile').mockRejectedValue(new Error('unexpected file read'));
  const realpath=vi.spyOn(fs,'realpath').mockRejectedValue(new Error('unexpected path lookup'));
  const catalog=await Builtins.Catalog();
  expect(catalog.items.map(item=>item.id).sort()).toEqual(Object.keys(identities).sort());
  for(const entry of catalog.items){
    const doc=await Builtins.Read(entry.id,entry.version);
    expect(doc.version).toBe(identities[entry.id as keyof typeof identities]);
    expect(hash(doc.text)).toBe(doc.version);
    expect(doc.source).toMatch(/^src\/logic\/.+\.ts#[a-zA-Z]+$/);
    expect(doc.readOnly).toBe(true);expect(doc).not.toHaveProperty('referenceBase');
    if(doc.kind==='schema')expect(()=>JSON.parse(doc.text)).not.toThrow();
  }
  expect(read).not.toHaveBeenCalled();expect(realpath).not.toHaveBeenCalled();
});

it('正文相对链接与 builtin 引用仍可逐层读取，新增入口修复原来的两个断点',async()=>{
  const agent=await Builtins.Read('agent-spec'),module=await Builtins.Read('module-spec');
  for(const doc of [agent,module])expect(doc.references).toEqual(expect.arrayContaining([expect.objectContaining({id:'connector-spec',status:'available'}),expect.objectContaining({id:'shared-skills-workflows',status:'available'})]));
  expect(agent.references).toEqual(expect.arrayContaining([expect.objectContaining({id:'agent-registry-schema',status:'available'})]));
  const catalog=await Builtins.Catalog();
  for(const entry of catalog.items){
    const doc=await Builtins.Read(entry.id);
    for(const ref of doc.references)if(ref.status==='available')expect((await Builtins.Read(ref.id!)).text).not.toBe('');
  }
  expect((await Builtins.Read('knowledge-governance')).references.every(ref=>ref.status==='available')).toBe(true);
});

it('未知 ID 和旧版本仍拒绝；修改查询回执不会污染下次读取',async()=>{
  for(const id of ['../../credentials.json','C:/secret','unknown'])await expect(Builtins.Read(id)).rejects.toMatchObject({code:'BUILTIN_NOT_FOUND'});
  await expect(Builtins.Read('common-rules','old')).rejects.toMatchObject({code:'BUILTIN_VERSION_CHANGED'});
  const doc=await Builtins.Read('common-rules'),before=doc.text;doc.text='tampered';
  expect((await Builtins.Read('common-rules')).text).toBe(before);
  const catalog=await Builtins.Catalog(),revision=catalog.revision;catalog.items[0].title='tampered';
  expect((await Builtins.Catalog()).revision).toBe(revision);
});

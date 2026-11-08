import {expect,it} from 'vitest';
import {csvTableSchema,validateCsvArtifact,csvValidationLimits,type CsvTableSchema} from '../src/backend/core/workspace/csv-validation-schema';
import {workflowContractSchema,parseWorkflowContract} from '../src/backend/core/workspace/workflow-contract';
import {validationRequirement} from '../src/backend/core/tasks/validation-evidence';
import {hash} from '../src/backend/core/foundation/serialization';

export const inventorySchema:CsvTableSchema={columns:[{name:'sku',type:'string',minLength:1,maxLength:32},{name:'quantity',type:'integer',minimum:0,maximum:100000},{name:'location',type:'string',minLength:1,maxLength:100}],minRows:1,maxRows:100,uniqueBy:['sku']};
const bytes=(text:string)=>new TextEncoder().encode(text),check=(text:string,schema:CsvTableSchema=inventorySchema)=>validateCsvArtifact(schema,bytes(text));

it.each(['\r\n','\n'])('实际逐行解析表头、引号、转义和Unicode，允许末尾没有换行（%j）',newline=>{
  const text='sku,quantity,location'+newline+'"A,""01",2,"货架😀'+newline+'二层"'+newline+'B02,0,库房';
  expect(check(text)).toEqual({outcome:'passed',issues:[]});expect(check('\uFEFF'+text+newline)).toEqual({outcome:'passed',issues:[]});
  expect(check('sku,quantity,location'+newline+'A,3,库房'+newline+newline).outcome).toBe('rejected');
});
it.each(['sku,quantity,location\n"A,1,库房','sku,quantity,location\nA"x,1,库房','sku,quantity,location\n"A"x,1,库房','sku,quantity,location\rA,1,库房','sku,quantity,location\nA,1,"库\r房"','sku,quantity,location\nA,1,\0'])('无效语法不能截断成有效行：%j',text=>{
  expect(check(text)).toEqual({outcome:'rejected',issues:[{code:'csv_invalid',instancePath:'',keyword:'syntax'}]});
});
it('严格UTF8、空文件、错误表头与列数均不通过，诊断不携带值',()=>{
  expect(validateCsvArtifact(inventorySchema,new Uint8Array([0xff]))).toMatchObject({outcome:'rejected',issues:[{code:'csv_invalid',keyword:'utf8'}]});
  for(const text of ['', 'quantity,sku,location\n2,A,private','sku,quantity,location,extra\nA,2,private,secret','sku,sku,location\nA,2,private'])expect(check(text).issues[0].code).toBe('csv_header');
  const result=check('sku,quantity,location\nprivate,2\nA,not-a-number,SECRET');expect(result.issues.map(i=>i.code)).toEqual(['csv_columns','csv_value']);expect(JSON.stringify(result)).not.toMatch(/private|SECRET|not-a-number/);
});
it.each(['',' 1','1 ','01','+1','1.0','1e2','NaN','Infinity','0x10','9007199254740992','-1','100001'])('整数与范围不隐式修复：%j',value=>{
  expect(check('sku,quantity,location\nA,'+value+',库房')).toMatchObject({outcome:'rejected',issues:[{code:'csv_value',instancePath:'/rows/1/1'}]});
});
it('数值、枚举及Unicode长度按声明检查，字符串不trim或执行公式',()=>{
  const schema:CsvTableSchema={columns:[{name:'value',type:'number',minimum:-10,maximum:10},{name:'label',type:'string',minLength:1,maxLength:1,enum:['😀','好']}]};
  expect(check('value,label\n-1e-2,😀',schema).outcome).toBe('passed');
  for(const value of ['1e999','0x1','', ' 1','-11'])expect(check('value,label\n'+value+',好',schema).outcome).toBe('rejected');
  expect(check('value,label\n1, 好',schema).issues.map(i=>i.keyword)).toEqual(['length','enum']);
  expect(check('literal\n=1+2',{columns:[{name:'literal',type:'string',enum:['=1+2']}]})).toEqual({outcome:'passed',issues:[]});
});
it('唯一键比较原字段组合，精确行数含空数据行但不含表头',()=>{
  expect(check('sku,quantity,location\nA,1,甲\nA,2,乙').issues[0]).toMatchObject({code:'csv_duplicate',instancePath:'/rows/2'});
  expect(check('sku,quantity,location\n').issues[0].code).toBe('csv_rows');
  const schema:CsvTableSchema={columns:[{name:'a',type:'string'},{name:'b',type:'string'}],uniqueBy:['a','b'],minRows:2,maxRows:2};
  expect(check('a,b\n"x,y",z\nx,"y,z"',schema).outcome).toBe('passed');expect(check('a,b\nx,y\nx,y',schema).issues[0].code).toBe('csv_duplicate');
  expect(check('a,b\nx,y\nz,z\na,b',schema).issues[0].code).toBe('csv_rows');
});
it('产品上限不截断作证，诊断有界仍检查全部输入',()=>{
  const one:CsvTableSchema={columns:[{name:'value',type:'string'}]};
  for(const text of ['value\n'+'x'.repeat(4097),'value\n'+'x\n'.repeat(10001),Array(33).fill('x').join(',')])expect(()=>check(text,one)).toThrow(expect.objectContaining({code:'VALIDATION_LIMIT'}));
  expect(check('value\n'+'x\n'.repeat(10000),one).outcome).toBe('passed');
  expect(()=>validateCsvArtifact(one,new Uint8Array(csvValidationLimits.fileBytes+1))).toThrow(expect.objectContaining({code:'VALIDATION_LIMIT'}));
  const invalid='sku,quantity,location\n'+Array(40).fill('A,not-valid,库房').join('\n');expect(check(invalid).issues).toHaveLength(csvValidationLimits.issues);
});
it('冻结声明拒绝未知字段、错误类型、重复列/键、上下界及超大规则，保留JSON原哈希',()=>{
  for(const schema of [{...inventorySchema,delimiter:';'}, {...inventorySchema,columns:[{name:'x',type:'formula'}]}, {...inventorySchema,columns:[{name:'x',type:'integer',maxLength:2}]}, {...inventorySchema,columns:[{name:'x',type:'string',minLength:3,maxLength:1}]}, {...inventorySchema,columns:[{name:'x',type:'number',minimum:3,maximum:1}]}, {...inventorySchema,columns:[{name:'x',type:'string'},{name:'x',type:'string'}]}, {...inventorySchema,uniqueBy:['missing']}, {...inventorySchema,uniqueBy:['sku','sku']}, {...inventorySchema,minRows:5,maxRows:1}, {...inventorySchema,columns:[{name:'x',type:'string',enum:Array.from({length:32},(_,i)=>String(i)+'x'.repeat(2000))}]}])expect(csvTableSchema.safeParse(schema).success).toBe(false);
  const requirement={id:'inventory',validator:'csv-table-v1' as const,artifactPath:'inventory.csv',schema:inventorySchema},contract={version:1 as const,delivery:{requiredValidations:[requirement]}};
  expect(parseWorkflowContract('```cbim-workflow\n'+JSON.stringify(contract)+'\n```')).toEqual(contract);
  for(const patch of [{validator:'csv-unknown'},{artifactPath:'../outside'},{schema:{type:'object'}}])expect(workflowContractSchema.safeParse({version:1,delivery:{requiredValidations:[{...requirement,...patch}]}}).success).toBe(false);
  const binding={moduleId:'module',workflowId:'flow',workflowVersion:'v1',contract},original=validationRequirement([binding],'module','inventory');
  const changed=structuredClone(binding);changed.contract.delivery.requiredValidations[0].schema.columns[0]={name:'sku',type:'string',minLength:2};expect(validationRequirement([changed],'module','inventory').schemaHash).not.toBe(original.schemaHash);
  const json={...binding,contract:{version:1 as const,delivery:{requiredValidations:[{id:'inventory',validator:'json-schema-v1' as const,artifactPath:'inventory.json',schema:{type:'string' as const}}]}}};expect(validationRequirement([json],'module','inventory').schemaHash).toBe(hash(JSON.stringify({type:'string'})));
});

import type {CsvTableSchema} from '../src/backend/core/workspace/csv-validation-schema';

export const csvInventorySchema:CsvTableSchema={columns:[{name:'sku',type:'string',minLength:1,maxLength:32},{name:'quantity',type:'integer',minimum:0,maximum:100000},{name:'location',type:'string',minLength:1,maxLength:100}],minRows:1,maxRows:100,uniqueBy:['sku']};
export const csvValidationData={
  model:'csv-validation-fixture',goal:'CSV_VALIDATION_MAIN: 按冻结表格规则交付真实库存CSV',memberGoal:'CSV_VALIDATION_MEMBER: 修复库存CSV并验证实际字节后交付',
  file:'inventory.csv',requirementId:'inventory-table',schema:csvInventorySchema,
  bad:'sku,quantity,location\r\nSKU-001,not-an-integer,库房\r\nSKU-001,2,库房\r\n',
  good:'sku,quantity,location\r\nSKU-001,2,库房\r\nSKU-002,0,"B,区"\r\n',
  changed:'sku,quantity,location\r\nSKU-001,3,库房\r\nSKU-002,0,"B,区"\r\n',
  acceptance:['真实库存CSV符合冻结表头、字段类型/范围和唯一键约束，并绑定当前文件字节'],
  draft:'保留普通草稿；库存表格检查不代表外部库存事实已确认。',humanId:'csv-human-review',humanCriterion:'请人工判断库存CSV成果是否符合本次业务要求',
};

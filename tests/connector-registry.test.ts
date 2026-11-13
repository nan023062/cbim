import {it,expect} from 'vitest';
import {ConnectorRegistry} from '../src/backend/core/connectors/registry';

it('链接器封装查询和唯一身份规则，不启动外部工具',()=>{
  const connector={id:'.cbim/connectors/docs',name:'文档桥',summary:'团队文档',plugin:{ghost_id:'docs',namespace:null}};
  const registry=new ConnectorRegistry([connector,{...connector,id:'.cbim/connectors/other'}]);
  expect(registry.get(connector.id)).toEqual(connector);expect(registry.list('文档')).toHaveLength(2);
  expect(registry.duplicates()).toEqual(['.cbim/connectors/other']);
});
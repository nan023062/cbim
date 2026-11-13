import {test,expect} from 'vitest';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {parseModelCatalog} from '../src/logic/models';
test('provider catalog preserves actual capacity without inventing unknown limits',()=>{
 expect(parseModelCatalog([{id:'deepseek-flash',context_window:1048576,max_output_tokens:393216,effort:{supported_levels:['low','high','max']}}])[0]).toMatchObject({contextWindow:1048576,maxOutputTokens:393216,reasoning:true});
 expect(parseModelCatalog([{id:'unknown'}])[0]).toMatchObject({id:'unknown',contextWindow:undefined,maxOutputTokens:undefined});
 expect(parseModelCatalog([{id:'bad',context_window:-1,max_output_tokens:Infinity}])[0].contextWindow).toBeUndefined();
 expect(parseModelCatalog([{id:'camel',contextWindow:128000,maxOutputTokens:32000}])[0].maxOutputTokens).toBe(32000);
});

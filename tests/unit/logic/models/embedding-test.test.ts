import {test,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {LlmProfiles} from '../../../../src/logic/models/service';
test('向量诊断使用明确操作和配置维度，不伪造输出字段或保存连接通过状态',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cbim-vector-test-')),file=path.join(root,'models.json');
  const fetch=vi.fn(async()=>new Response(JSON.stringify({data:[{index:0,embedding:[1,0,0]}]}),{status:200}));vi.stubGlobal('fetch',fetch);
  try{
    const models=new LlmProfiles(file);const saved=await models.save({profile:{name:'Vectors',api:'openai-completions',baseUrl:'https://custom.example/v1',auth:'none',models:[],defaultModel:'',embedding:{api:'openai-embeddings',baseUrl:'https://vector.example/v1',models:[{id:'vector',name:'Vector',enabled:true,inputTokens:8192,dimensions:3}]}}});
    const before=await fs.readFile(file,'utf8');const result=await models.testEmbedding(saved.profiles[0].id,'vector');expect(result).toMatchObject({api:'openai-embeddings',dimensions:3});
    const [url,options]=fetch.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://vector.example/v1/embeddings');expect(JSON.parse(options.body as string)).toEqual({model:'vector',input:['connection test'],encoding_format:'float'});
    expect(await fs.readFile(file,'utf8')).toBe(before);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({data:[{index:0,embedding:[1]}]})));await expect(models.testEmbedding(saved.profiles[0].id,'vector')).rejects.toThrow(/维度/);expect(fetch).toHaveBeenCalledTimes(2);
  }finally{vi.unstubAllGlobals();if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('cbim-vector-test-'))throw Error('cleanup boundary');await fs.rm(root,{recursive:true,force:true})}
});

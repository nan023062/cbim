import {expect,it} from 'vitest';
import http from 'node:http';
import {governanceFeedbackProvider,governanceFeedbackFixture} from './module-governance-feedback-provider';
import {moduleGovernanceToolNames} from './module-governance-tools-provider';

it('确定性治理模型按 UTF-8 解码跨 HTTP 数据块的中文，不改写工具正文',async()=>{
  const provider=await governanceFeedbackProvider();
  try{
    const body={model:governanceFeedbackFixture.model,tools:moduleGovernanceToolNames.map(name=>({function:{name}})),messages:[{role:'user',content:'界面与治理摘要保持原文'}]};
    const bytes=Buffer.from(JSON.stringify(body)),split=bytes.indexOf(Buffer.from('界'))+1;
    await new Promise<void>((resolve,reject)=>{
      const req=http.request(provider.url+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Transfer-Encoding':'chunked'}},res=>{
        res.resume();res.on('end',()=>res.statusCode===200?resolve():reject(Error('Fixture response '+res.statusCode)));
      });
      req.on('error',reject);req.write(bytes.subarray(0,split));req.end(bytes.subarray(split));
    });
    expect(provider.errors).toEqual([]);
    expect(provider.requests).toEqual([body]);
  }finally{await provider.close()}
});

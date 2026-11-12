import {expect,it,vi} from 'vitest';
import {openBridge} from '../src/backend/engines/pi/bridge';

it('records active tool names and diagnoses missing registration without invoking any tool',async()=>{
  const report=vi.fn(async()=>{}),call=vi.fn(async()=>({content:[{type:'text',text:'unused'}]}));
  const expected=['cbim_feedback_submit','cbim_feedback_receipt'];
  const bridge=await openBridge({list:async()=>expected.map(name=>({name,inputSchema:{type:'object'}})),call},async()=>({allow:true}),undefined,undefined,report);
  const post=(body:unknown,authorized=true)=>fetch(bridge.url+'/tools',{method:'POST',headers:{Authorization:'Bearer '+(authorized?bridge.token:'wrong'),'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    expect((await post({active:expected},false)).status).toBe(403);expect(report).not.toHaveBeenCalled();
    const valid=await post({active:['read',...expected]});expect(valid.status).toBe(200);
    expect(report).toHaveBeenLastCalledWith({expected:[...expected].sort(),active:['read',...expected].sort(),missing:[]});
    const missing=await post({active:['read','cbim_feedback_submit']});expect(missing.status).toBe(400);expect(await missing.json()).toMatchObject({code:'TOOL_CATALOG_MISMATCH'});
    expect(report).toHaveBeenLastCalledWith({expected:[...expected].sort(),active:['cbim_feedback_submit','read'],missing:['cbim_feedback_receipt']});
    const invalid=await post({active:expected,token:'private'});expect(await invalid.json()).toMatchObject({code:'TOOL_CATALOG_INVALID'});
    expect(call).not.toHaveBeenCalled();expect(report).toHaveBeenCalledTimes(2);
  }finally{await bridge.close()}
});

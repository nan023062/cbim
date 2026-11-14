import {expect,it,vi} from 'vitest';
import http from 'node:http';
import {PublicHttp,publicUrl,publicAddress} from '../src/core/platform/node/web';
const signal=()=>new AbortController().signal;
it.each(['http://127.0.0.1','http://2130706433','http://0x7f000001','http://[::1]','http://[::ffff:127.0.0.1]','http://169.254.169.254/latest','http://10.0.0.1','http://100.64.0.1','http://192.168.1.1','http://172.31.1.1','http://[fc00::1]','http://localhost','file:///C:/secret','https://user:pass@example.com','http://example.com:8080'])('禁止 SSRF 地址 %s',value=>expect(()=>publicUrl(value)).toThrow());
it('所有 DNS 答案均需公开，私有混合、IPv6 保留及空答案均不发起请求',async()=>{
  for(const addresses of [[{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}],[{address:'fe80::1',family:6}],[]]){
    const request=vi.fn(),client=new PublicHttp({lookup:async()=>addresses,request:request as unknown as typeof http.request});
    await expect(client.read('https://example.com',signal())).rejects.toMatchObject({code:'WEB_SSRF'});expect(request).not.toHaveBeenCalled();
  }
  expect(publicAddress('192.0.2.1')).toBe(false);expect(publicAddress('2001:db8::1')).toBe(false);expect(publicAddress('8.8.8.8')).toBe(true);
});

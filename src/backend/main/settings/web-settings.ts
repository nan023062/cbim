/**
 * 目录归属：backend/main/settings；预算、并发与搜索设置。
 * 作用定位：版本化保存浏览器 robots 策略、Brave 搜索开关及加密凭据，桌面只取得摘要。
 * 设计原因：密钥不进入工具参数、模型上下文或返回值；并发保存以 revision 校验，系统加密不可用时不回退明文。
 */
import fs from 'node:fs/promises';
import {z} from 'zod';
import {atomic} from '../../core/foundation/files';
import {fail} from '../../core/foundation/errors';
import {webConfigureInput,type WebSettingsView} from '../../core/connectors/web-tools';
import type {SecretCipher} from '../../core/models/ports';
const schema=z.object({revision:z.number().int().positive(),enabled:z.boolean(),encryptedKey:z.string().optional(),browserRobotsPolicy:z.enum(['allow','respect']).default('allow')}).strict();
/** robots 策略由每次网页读取捕获；搜索开关及密钥独立生效。旧文件缺省 allow，旧客户端保存不重置策略。 */
export class WebSettings {
  private state:z.infer<typeof schema>={revision:1,enabled:false,browserRobotsPolicy:'allow'};
  private pending:Promise<unknown>=Promise.resolve();
  constructor(private readonly filename:string,private readonly cipher?:SecretCipher){}
  async init(){try{this.state=schema.parse(JSON.parse(await fs.readFile(this.filename,'utf8')))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')fail('WEB_SETTINGS_INVALID','网页配置损坏，请检查设置文件')}}
  read():WebSettingsView{return {revision:this.state.revision,provider:'brave',enabled:this.state.enabled,hasKey:!!this.state.encryptedKey,secureStorage:this.cipher?.available()===true,browserRobotsPolicy:this.state.browserRobotsPolicy}}
  configure(raw:unknown):Promise<WebSettingsView>{
    const next=this.pending.then(async()=>{
      const input=webConfigureInput.parse(raw);
      if(input.revision!==this.state.revision)fail('WEB_SETTINGS_CONFLICT','网页设置已改变，请刷新后保存');
      if(input.clearKey&&input.apiKey)fail('WEB_SETTINGS_INPUT','不能同时保存和移除密钥');
      if(input.apiKey&&!this.cipher?.available())fail('WEB_SECRET_UNAVAILABLE','系统安全存储不可用，未保存密钥');
      const encryptedKey=input.clearKey?undefined:input.apiKey?this.cipher!.encrypt(input.apiKey):this.state.encryptedKey;
      if(input.enabled&&!encryptedKey)fail('WEB_SEARCH_CONFIG','请先配置 Brave Search API 密钥');
      const state={revision:this.state.revision+1,enabled:input.enabled,encryptedKey,browserRobotsPolicy:input.browserRobotsPolicy??this.state.browserRobotsPolicy};
      await atomic(this.filename,JSON.stringify(state));this.state=state;return this.read();
    });this.pending=next.catch(()=>{});return next;
  }
  /** 只供主进程固定 API 适配器读取；错误不附带原密钥或加密字节。 */
  resolve():string {
    if(!this.state.enabled||!this.state.encryptedKey)fail('WEB_SEARCH_CONFIG','网页搜索未启用，请在设置中配置 Brave Search API');
    if(!this.cipher?.available())fail('WEB_SECRET_UNAVAILABLE','系统安全存储不可用');
    try{return this.cipher.decrypt(this.state.encryptedKey)}catch{return fail('WEB_SECRET_UNAVAILABLE','无法解密搜索密钥，请在设置中重新保存')}
  }
}

/**
 * 作用定位：前端本地 JSON 记录的有界同步读写机制，通过注入端口使用存储。
 * 设计原因：序列化及 UTF-8 容量检查可复用，业务记录格式、损坏锁定和恢复策略必须留在控制器。
 */
export interface TextStorage {
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
}

/** 不缓存、不自动删除或覆盖坏数据；每次读写调用注入端口，异常原样传播。 */
export class JsonRecordStorage {
  constructor(private readonly storage:TextStorage,private readonly key:string,private readonly maxBytes:number){}

  /** null/空串视为缺失；其余先按 UTF-8 检查上限再解析。返回未校验数据，业务方必须核验。 */
  read(limitMessage:string):any{
    const raw=this.storage.getItem(this.key);if(!raw)return undefined;
    if(new TextEncoder().encode(raw).length>this.maxBytes)throw Error(limitMessage);
    return JSON.parse(raw);
  }

  /** 保留 JSON.stringify 次序及错误；超限不调用 setItem，成功返回只表示同步写入完成。 */
  write(value:unknown,limitMessage:string):void{
    const raw=JSON.stringify(value);
    if(new TextEncoder().encode(raw).length>this.maxBytes)throw Error(limitMessage);
    this.storage.setItem(this.key,raw);
  }
}

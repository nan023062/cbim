/**
 * 作用定位：基础网页读取器与浏览器适配之间的小型只读契约。
 * 设计原因：WebPageReader 管理抓取策略，宿主注入真实渲染器；普通 Node 消费者不加载 Electron。
 */
export interface BrowserPage {
  url:string;
  title:string;
  markdown:string;
  /** 浏览器采集已达到内部上限；服务再次按用户 maxChars 截断时不能丢失此事实。 */
  truncated:boolean;
}
/** 匿名读取独占临时会话；authorize 逐资源应用宿主捕获的访问策略，文档额外节流。取消须释放窗口和连接。 */
export interface BrowserReader {
  read(url:string,signal:AbortSignal,authorize:(url:string,signal:AbortSignal,document?:boolean)=>Promise<void>):Promise<BrowserPage>;
}

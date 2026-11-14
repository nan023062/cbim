import assert from 'node:assert/strict';

// 验收专用：连接已核实 PID 的本机调试端口，不启动、暂停或替换被测进程。
// Electron 资源更新的原生重启不会继承 Playwright 对象，需要重新接入主进程来继续被动观测。
export async function connectDesktopInspector(url) {
  const address=new URL(url);
  assert.equal(address.protocol,'ws:');assert.equal(address.hostname,'127.0.0.1');
  const socket=new WebSocket(url), pending=new Map();let next=0;
  const fail=error=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error)}pending.clear()};
  socket.addEventListener('close',()=>fail(Error('Desktop inspector disconnected')));
  socket.addEventListener('error',()=>fail(Error('Desktop inspector connection error')));
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data),entry=pending.get(message.id);if(!entry)return;
    pending.delete(message.id);clearTimeout(entry.timer);
    if(message.error)entry.reject(Error(message.error.message));else entry.resolve(message.result);
  });
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.close();reject(Error('Desktop inspector connection timeout'))},10000);
    socket.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});
    socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Desktop inspector connection error'))},{once:true});
  });
  return {
    async evaluate(expression) {
      assert.equal(socket.readyState,WebSocket.OPEN);
      const id=++next;
      const result=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(Error('Desktop inspector evaluation timeout'))},30000);
        pending.set(id,{resolve,reject,timer});
        socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,includeCommandLineAPI:true,awaitPromise:true,returnByValue:true}}));
      });
      if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
      return result.result.value;
    },
    close(){socket.close()},
  };
}

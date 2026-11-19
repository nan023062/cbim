// Protocol fixture only; never counted as a real model or Pi execution.
let buffer='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;let offset;while((offset=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,offset);buffer=buffer.slice(offset+1);const request=JSON.parse(line);
  if(request.type==='unicode'){
    const event=JSON.stringify({type:'message',text:'first\u2028second\u2029third'})+'\n';
    process.stdout.write(event.slice(0,12));setTimeout(()=>{process.stdout.write(event.slice(12));reply(request,{ok:true})},5);
  }else if(request.type==='never'){}else if(request.type==='crash')process.exit(7);else reply(request,{echo:request.type});
}});
function reply(request,data){process.stdout.write(JSON.stringify({type:'response',id:request.id,command:request.type,success:true,data})+'\n')}
process.stdin.on('end',()=>process.exit(0));

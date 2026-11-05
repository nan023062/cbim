// Deterministic interaction smoke test; no browser or third-party packages.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
class Element {
  constructor() { this.children=[]; this.checked=false; this.value=''; this.clientWidth=900; this.clientHeight=600; }
  append(e) { this.children.push(e); }
  replaceChildren() { this.children=[]; }
  setAttribute(k,v) { this[k]=v; }
  addEventListener() {}
}
const html=fs.readFileSync(process.argv[2], 'utf8');
const elements={};
const document={getElementById:id=>elements[id]??=new Element(),createElement:()=>new Element(),createElementNS:()=>new Element()};
document.getElementById('data').textContent=html.match(/type="application\/json">([\s\S]*?)<\/script>/)[1];
const context=vm.createContext({document});
const code=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
vm.runInContext(code,context);
const run=code=>vm.runInContext(code,context);
const total=run('Object.keys(nodes).length');
assert.equal(run('Object.keys(positions).length'),total);
run("$('virtual').checked=true;$('virtual').onchange()");
assert.equal(run('Object.keys(positions).length'),total+run('Object.values(nodes).filter(n=>n.sources.length).length'));
run("choose(Object.keys(positions).find(id=>id.endsWith('::direct')))");
run("$('fold').onclick()");
assert.equal(run('Object.keys(positions).length'),run('data.roots.length'));
run("$('search').value='client';$('search').oninput();$('next').onclick()");
assert.ok(run('selected.includes("client")'));
run("$('all').onclick();$('virtual').checked=false;$('virtual').onchange();$('fit').onclick();$('plus').onclick();$('minus').onclick();$('read').onclick()");
assert.equal(run('Object.keys(positions).length'),total);
assert.equal(run('scale'),1);
console.log(`PASS: ${total} modules; virtual nodes, collapse, search, expansion and zoom`);

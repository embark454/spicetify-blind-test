const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const script=fs.readFileSync(require('node:path').resolve(__dirname,'../launcher.js'),'utf8');
test('launcher registers once, validates playlists and navigates without playback',()=>{
 let registrations=0,registered,navigation,stored,event;
 class Item {constructor(name,click,predicate){this.name=name;this.click=click;this.predicate=predicate;registered=this;} register(){registrations++;}}
 const sandbox={Spicetify:{ContextMenu:{Item},React:{createElement(){}},Platform:{History:{push:path=>navigation=path}}},localStorage:{setItem:(key,value)=>stored=JSON.parse(value)},dispatchEvent:e=>event=e.type,Event:class{constructor(type){this.type=type;}}};
 vm.createContext(sandbox);vm.runInContext(script,sandbox);vm.runInContext(script,sandbox);assert.equal(registrations,1);
 const uri='spotify:playlist:0000000000000000000001'; assert.equal(registered.predicate([uri]),true);assert.equal(registered.predicate(['spotify:collection:tracks']),true);assert.equal(registered.predicate([uri,'spotify:collection:tracks']),true);assert.equal(registered.predicate(['spotify:collection:local-files']),false);assert.equal(registered.predicate(['spotify:track:0000000000000000000001']),false);registered.click(['https://evil.test']);assert.equal(navigation,undefined);registered.click([uri]);assert.equal(navigation,'/blind-test');assert.equal(stored.uris[0],uri);assert.equal(event,'blind-test:launch');registered.click(['spotify:collection:tracks']);assert.equal(stored.uris[0],'spotify:collection:tracks');
});
test('launcher startup polling terminates when APIs are unavailable',()=>{const queue=[];const sandbox={setTimeout:fn=>queue.push(fn),clearTimeout(){}};vm.createContext(sandbox);vm.runInContext(script,sandbox);let n=0;while(queue.length){queue.shift()();if(++n>65)throw Error('Unbounded poll');}assert.equal(n,59);});

test('album launch accepts only canonical album IDs and preserves mixed sources',()=>{
  let registered;
  class Item{constructor(name,click,predicate){this.click=click;this.predicate=predicate;}register(){registered=this;}}
  const {sandbox}=runtime({Spicetify:{ContextMenu:{Item},React:{createElement(){}},Platform:{History:{push(){}}}}});
  vm.runInContext(script,sandbox);
  const album='spotify:album:0000000000000000000001',playlist='spotify:playlist:0000000000000000000001';
  assert.equal(registered.predicate([album]),true);
  assert.equal(registered.predicate([album,playlist,'spotify:collection:tracks']),true);
  registered.click([album,playlist,album]);
  assert.deepEqual(sandbox.pending.uris,[album,playlist]);
  for(const uri of ['spotify:album:short','spotify:album:0000000000000000000001:extra','spotify:album:000000000000000000000_','spotify:artist:0000000000000000000001','https://open.spotify.com/album/0000000000000000000001'])assert.equal(registered.predicate([uri]),false);
});

function runtime(extra={}) {
  const timers=new Map();let nextTimer=0;
  const sandbox={setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id),
    localStorage:{setItem:(key,value)=>{sandbox.pending=JSON.parse(value);}},dispatchEvent:event=>{sandbox.lastEvent=event.type;},
    Event:class{constructor(type){this.type=type;}},...extra};
  vm.createContext(sandbox);
  return {sandbox,timers,flush(){let count=0;while(timers.size){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();if(++count>65)throw Error('Unbounded poll');}}};
}

test('late webpack readiness recovers after polling expires and registration stays unique',()=>{
  let ready,registrations=0;
  const {sandbox,timers,flush}=runtime({Spicetify:{Events:{webpackLoaded:{on:fn=>{ready=fn;}}}}});
  vm.runInContext(script,sandbox);flush();assert.equal(sandbox.__blindTestLauncherV2.attempts,60);
  class Item{constructor(){}register(){registrations++;}}
  Object.assign(sandbox.Spicetify,{ContextMenu:{Item},React:{createElement(){}},Platform:{History:{push(){}}}});
  ready();assert.equal(registrations,1);assert.equal(timers.size,0);
  ready();vm.runInContext(script,sandbox);assert.equal(registrations,1);
});

test('transient constructor failures retry instead of leaving a permanent empty singleton',()=>{
  let constructions=0,registrations=0;
  class Item{constructor(){if(++constructions===1)throw Error('not ready');}register(){registrations++;}}
  const {sandbox,flush}=runtime({Spicetify:{ContextMenu:{Item},React:{createElement(){}},Platform:{History:{push(){}}}}});
  assert.doesNotThrow(()=>vm.runInContext(script,sandbox));assert.equal(sandbox.__blindTestLauncherV2.error,'not ready');
  flush();assert.equal(constructions,2);assert.equal(registrations,1);assert.equal(sandbox.__blindTestLauncherV2.error,null);
});

test('readiness event is subscribed when Spicetify appears late, including an already-fired event',()=>{
  let subscriptions=0,registrations=0;
  const {sandbox,timers}=runtime();
  vm.runInContext(script,sandbox);
  class Item{constructor(){}register(){registrations++;}}
  sandbox.Spicetify={ContextMenu:{Item},React:{createElement(){}},Platform:{History:{push(){}}},
    Events:{webpackLoaded:{on:fn=>{subscriptions++;fn();}}}};
  const [id,fn]=timers.entries().next().value;timers.delete(id);fn();
  assert.equal(subscriptions,1);assert.equal(registrations,1);assert.equal(timers.size,0);
});

test('V2-only fallback accepts observed library reference and liked-song uri props',()=>{
  let registered,navigation;
  class Item{constructor(props){this.props=props;}register(){registered=this;}}
  const {sandbox}=runtime({Spicetify:{ContextMenuV2:{Item},React:{createElement(){}},ReactJSX:{jsx(){}},Platform:{History:{push:path=>{navigation=path;}}}}});
  vm.runInContext(script,sandbox);
  const uri='spotify:playlist:0000000000000000000001';
  for(const props of [{reference:{uri}},{uri:'spotify:collection:tracks'},{uri:'spotify:album:0000000000000000000001'},{item:{uri}},{uris:[uri,'spotify:collection:tracks']}]){
    assert.equal(registered.props.shouldAdd(props),true);registered.props.onClick({props});assert.equal(navigation,'/blind-test');
  }
  assert.equal(registered.props.shouldAdd({uri:'spotify:track:0000000000000000000001',contextUri:uri}),false);
  assert.equal(registered.props.shouldAdd({uri:'spotify:collection:local-files'}),false);
  assert.equal(registered.props.shouldAdd({reference:{uri:'https://evil.test'}}),false);
});

const installedMap=require('node:path').join(process.env.LOCALAPPDATA||'', 'spicetify/jsHelper/spicetifyWrapper.js.map');
test('installed Spicetify constructors wait for ReactJSX and support actual library props', {skip:!process.env.LOCALAPPDATA || !fs.existsSync(installedMap)},()=>{
  const map=JSON.parse(fs.readFileSync(installedMap,'utf8'));
  const sourceIndex=map.sources.findIndex(name=>name.endsWith('/spicetifyWrapper/menus.js'));
  assert.notEqual(sourceIndex,-1);
  const menus=map.sourcesContent[sourceIndex].replace(/^import[^\n]+\n/,'');
  let ready,context={},navigation;
  const {sandbox,timers}=runtime({createIconComponent:()=>null,Spicetify:{SVGIcons:{},ReactComponent:{MenuItem(){}},
    React:{createElement:(type,props)=>({type,props}),useState:value=>[value,()=>{}],useEffect(){},useContext:()=>context},
    Platform:{History:{push:path=>{navigation=path;}}},Events:{webpackLoaded:{on:fn=>{ready=fn;}}}}});
  vm.runInContext(menus,sandbox);
  // The real 2.45.1 Item constructor calls ReactJSX.jsx immediately. It exists
  // before ReactJSX, unlike the original test's simplified menu constructor.
  assert.throws(()=>new sandbox.Spicetify.ContextMenu.Item('probe',()=>{}),/jsx/);
  assert.doesNotThrow(()=>vm.runInContext(script,sandbox));
  assert.equal(sandbox.__blindTestLauncherV2.item,null);assert.equal(timers.size,1);
  sandbox.Spicetify.ReactJSX={jsx:(type,props)=>({type,props})};
  ready();assert.equal(timers.size,0);
  const item=sandbox.__blindTestLauncherV2.item;assert.ok(item);
  const uri='spotify:playlist:0000000000000000000001';
  for(const props of [{reference:{uri}},{uri:'spotify:collection:tracks'},{uri:'spotify:album:0000000000000000000001'}]){
    assert.equal(item.shouldAdd(props),true);context={props};item._element.type().props.onClick({});assert.equal(navigation,'/blind-test');
    assert.equal(sandbox.pending.uris[0],props.uri||props.reference.uri);
  }
  ready();assert.equal(sandbox.__blindTestLauncherV2.item,item);
});

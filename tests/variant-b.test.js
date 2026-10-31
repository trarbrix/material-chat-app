const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM,VirtualConsole} = require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'..','variant-b.html'),'utf8');
async function app({user='', fetch:mock, session={}}={}) {
  const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(html,{url:'http://localhost/variant-b.html',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    w.localStorage.setItem('anim','false');if(user)w.localStorage.setItem('user',user);
    Object.entries(session).forEach(([k,v])=>w.sessionStorage.setItem(k,v));
    w.fetch=mock|| (async()=>({ok:true,status:200,json:async()=>[]}));
    w.confirm=()=>true;w.prompt=()=>null;w.HTMLElement.prototype.scrollIntoView=function(){};
  }});
  await new Promise(resolve=>dom.window.addEventListener('load',resolve));
  await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(errors,[]);return dom;
}
function response(data,status=200){return {ok:status>=200&&status<300,status,json:async()=>data};}
function buttonByText(w,text,root=w.document){return [...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text);}
test('new variant starts with the original registration dialog, and uses separate mobile panes',async()=>{
 const dom=await app();const w=dom.window;try{
  assert.equal(w.document.getElementById('auth-screen').hidden,false);
  assert.ok(w.document.querySelector('.auth-card .logo'));
  w.showForm(false);assert.ok(w.document.getElementById('auth-form').classList.contains('active'));
  w.document.getElementById('settings-button').click();assert.ok(w.document.getElementById('app').classList.contains('vb-mobile-details'));
  w.document.getElementById('detail-close').click();assert.ok(w.document.getElementById('app').classList.contains('vb-mobile-chats'));
  w.document.getElementById('global-chat').click();assert.ok(w.document.getElementById('app').classList.contains('vb-mobile-chat'));
 } finally {w.close();}
});
test('failed Telegram delivery never displays a made-up code or signs in',async()=>{
 let req=[];const dom=await app({fetch:async(url,opt={})=>{req.push(url);return url.endsWith('/send_code')?response({status:'error',detail:'Нажми /start в боте'}):response([])}});const w=dom.window;try{
  w.showForm(false);w.document.getElementById('input-tg').value='alice';w.document.getElementById('input-pass').value='password';await w.submitAuth();
  assert.ok(req.some(x=>x.endsWith('/send_code')));assert.equal(w.document.getElementById('code-field').style.display,'none');
  assert.equal(w.document.getElementById('input-code').value,'');assert.equal(w.localStorage.getItem('user'),null);
  assert.match(w.document.getElementById('auth-error').textContent,/start/);
 } finally{w.close();}
});
test('registration uses the actual code and stores the session token only in session storage',async()=>{
 let requests=[];const dom=await app({fetch:async(url,opt={})=>{requests.push({url,body:opt.body});if(url.endsWith('/send_code'))return response({status:'ok'});if(url.endsWith('/profile/register'))return response({token:'abc'});if(url.includes('/profile/me'))return response({nickname:'Alice',handle:'',avatar:''});return response([])}});const w=dom.window;try{
  w.showForm(false);w.document.getElementById('input-tg').value='alice';w.document.getElementById('input-pass').value='password';await w.submitAuth();
  assert.equal(w.document.getElementById('code-field').style.display,'block');assert.equal(w.document.getElementById('input-code').value,'');
  w.document.getElementById('input-code').value='4321';await w.submitAuth();
  const reg=requests.find(r=>r.url.endsWith('/profile/register'));assert.deepEqual(JSON.parse(reg.body),{tg_username:'alice',password:'password',code:'4321'});
  assert.equal(w.sessionStorage.getItem('profile-token'),'abc');assert.equal(w.localStorage.getItem('profile-token'),null);
  assert.equal(w.document.getElementById('auth-screen').hidden,true);
 }finally{w.close();}
});
test('network failure does not switch to fake local authentication or overwrite local data',async()=>{
 const dom=await app({fetch:async()=>{throw Error('offline')}});const w=dom.window;try{
  const old=JSON.stringify({users:{old:{username:'old'}},messages:[{text:'keep'}],reactions:[]});w.localStorage.setItem('mc-local-db-v1',old);
  w.showForm(true);w.document.getElementById('input-tg').value='old';w.document.getElementById('input-pass').value='pw';await w.submitAuth();
  assert.equal(w.localStorage.getItem('user'),null);assert.equal(w.localStorage.getItem('mc-local-db-v1'),old);assert.equal(w.document.getElementById('auth-screen').hidden,false);
 }finally{w.close();}
});
test('settings include languages, privacy, power, folders and animation controls',async()=>{
 const dom=await app({user:'alice'});const w=dom.window;try{
  w.document.getElementById('settings-button').click();const body=w.document.getElementById('detail-body');
  for(const text of ['Папки чатов','Конфиденциальность','Энергосбережение','Анимация сообщений','Фон чата'])assert.ok(body.textContent.includes(text),text);
  assert.equal(body.querySelector('#settings-language').options.length,5);
  buttonByText(w,'Режим энергосбережения',body).click();assert.equal(w.localStorage.getItem('power-saving'),'true');
  w.setLanguage('fr');assert.equal(w.document.documentElement.lang,'fr');assert.equal(w.localStorage.getItem('language'),'fr');
 }finally{w.close();}
});
test('emoji picker searches full embedded catalog and inserts at caret',async()=>{
 const dom=await app({user:'alice'});const w=dom.window;try{
  w.document.getElementById('emoji-button').click();const search=w.document.querySelector('.vb-modal input[type=search]');search.value='grinning face';search.dispatchEvent(new w.Event('input'));
  const button=w.document.querySelector('.vb-emoji-grid button');assert.equal(button.textContent,'😀');const draft=w.document.getElementById('message-draft');draft.value='ab';draft.setSelectionRange(1,1);button.click();assert.equal(draft.value,'a😀b');assert.ok(w.EMOJI_DATA.length>3000);
 }finally{w.close();}
});
test('folders keep the previous per-account storage and never delete chat data',async()=>{
 const dom=await app({user:'alice'});const w=dom.window;try{
  w.localStorage.setItem('chat-folders:alice',JSON.stringify([{id:'x',name:'Friends',chats:['global']}]));
  w.document.getElementById('settings-button').click();buttonByText(w,'Управлять папкой').click();buttonByText(w,'Friends').click();
  const checks=w.document.querySelectorAll('.vb-folder-check input');assert.equal(checks.length,3);assert.equal(checks[0].checked,true);checks[1].click();
  assert.deepEqual(JSON.parse(w.localStorage.getItem('chat-folders:alice'))[0].chats,['global','saved']);
 }finally{w.close();}
});
test('legacy registration verifies the real Telegram code before creating a server account',async()=>{
 let req=[];const dom=await app({fetch:async(url,opt={})=>{req.push({url,body:opt.body});if(url.endsWith('/send_code'))return response({status:'ok'});if(url.endsWith('/profile/register'))return response({},404);if(url.endsWith('/verify_code'))return response({status:'ok'});if(url.endsWith('/auth'))return response({status:'ok'});return response([])}});const w=dom.window;try{
  w.showForm(false);w.document.getElementById('input-tg').value='alice';w.document.getElementById('input-pass').value='secret';await w.submitAuth();w.document.getElementById('input-code').value='5678';await w.submitAuth();
  const verify=req.find(r=>r.url.endsWith('/verify_code'));const auth=req.find(r=>r.url.endsWith('/auth'));assert.deepEqual(JSON.parse(verify.body),{tg_username:'alice',code:'5678'});assert.match(JSON.parse(auth.body).username,/^u_[0-9a-f]{32}$/);assert.equal(w.localStorage.getItem('user'),'alice');
 }finally{w.close();}
});
test('legacy registration does not create an account when code verification fails',async()=>{
 let req=[];const dom=await app({fetch:async(url,opt={})=>{req.push(url);if(url.endsWith('/send_code'))return response({status:'ok'});if(url.endsWith('/profile/register'))return response({},404);if(url.endsWith('/verify_code'))return response({status:'error'});return response([])}});const w=dom.window;try{
  w.showForm(false);w.document.getElementById('input-tg').value='alice';w.document.getElementById('input-pass').value='secret';await w.submitAuth();w.document.getElementById('input-code').value='5678';await w.submitAuth();assert.equal(req.some(u=>u.endsWith('/auth')),false);assert.equal(w.localStorage.getItem('user'),null);
 }finally{w.close();}
});
test('AI uses the configured HTTPS provider and keeps the key out of browser storage',async()=>{
 let request;const dom=await app({user:'alice',fetch:async(url,opt={})=>{if(url==='https://ai.example.com/v1/chat/completions'){request={url,opt};return response({choices:[{message:{content:'Hi there'}}]});}return response([])}});const w=dom.window;try{
  w.localStorage.setItem('ai-endpoint','https://ai.example.com/v1/chat/completions');w.localStorage.setItem('ai-model','model');
  w.document.getElementById('ai-chat').click();w.document.getElementById('chat-settings-button').click();const form=w.document.querySelector('.vb-modal form');const inputs=form.querySelectorAll('input');inputs[2].value='private-key';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  w.document.getElementById('message-draft').value='Hello';w.document.getElementById('message-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(request.opt.headers.Authorization,'Bearer private-key');assert.equal(JSON.parse(request.opt.body).messages[0].content,'Hello');assert.equal(w.localStorage.getItem('ai-history:alice').includes('Hi there'),true);assert.equal(Object.values(w.localStorage).includes('private-key'),false);
 }finally{w.close();}
});
test('settings are translated and profiles keep their account identity',async()=>{
 const dom=await app({user:'alice',session:{'profile-token':'tok','profile-token-owner':'alice'},fetch:async(url,opt={})=>{if(url.includes('/profile/me'))return response(opt.method==='PUT'?JSON.parse(opt.body):{nickname:'Alice',handle:'',avatar:''});return response([])}});const w=dom.window;try{
  w.document.getElementById('settings-button').click();w.setLanguage('fr');assert.ok(w.document.getElementById('detail-body').textContent.includes('Mode sombre'));
  w.setLanguage('ru');w.document.getElementById('account-button').click();buttonByText(w,'✎  Редактировать профиль').click();const inputs=w.document.querySelectorAll('.vb-profile-actions input[type=text],.vb-profile-actions input:not([type])');inputs[0].value='Alice A';inputs[1].value='alice_123';const form=w.document.querySelector('.vb-profile-actions form')||w.document.querySelector('form.vb-profile-actions');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,15));assert.equal(w.localStorage.getItem('user'),'alice');assert.equal(w.sessionStorage.getItem('profile-token-owner'),'alice');
 }finally{w.close();}
});
test('unknown chat senders are not displayed as Telegram identifiers',async()=>{
 const dom=await app({user:'alice',fetch:async(url)=>{if(url.includes('/messages/global'))return response([{id:1,sender:'telegram_private_name',text:'hello'}]);if(url.includes('/profile/public/'))return response({},404);return response([])}});const w=dom.window;try{
  await new Promise(resolve=>setTimeout(resolve,20));const list=w.document.getElementById('message-list');assert.ok(list.textContent.includes('hello'));assert.equal(list.textContent.includes('telegram_private_name'),false);
 }finally{w.close();}
});

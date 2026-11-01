const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM,VirtualConsole} = require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'..','variant-b.html'),'utf8');
async function app({user='', fetch:mock, session={}, initial={}, setup, url='http://localhost/variant-b.html'}={}) {
  const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
  const dom=new JSDOM(html,{url,runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
    w.localStorage.setItem('anim','false');if(user)w.localStorage.setItem('user',user);
    Object.entries(session).forEach(([k,v])=>w.sessionStorage.setItem(k,v));
    Object.entries(initial).forEach(([k,v])=>w.localStorage.setItem(k,v));if(setup)setup(w);
    w.fetch=mock|| (async()=>({ok:true,status:200,json:async()=>[]}));
    w.confirm=()=>true;w.prompt=()=>null;w.HTMLElement.prototype.scrollIntoView=function(){};
  }});
  await new Promise(resolve=>dom.window.addEventListener('load',resolve));
  await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(errors,[]);return dom;
}
function response(data,status=200){return {ok:status>=200&&status<300,status,json:async()=>data};}
function buttonByText(w,text,root=w.document){return [...root.querySelectorAll('button')].find(b=>b.textContent.trim()===text);}
function openSection(w,id){const button=w.document.querySelector(`[data-settings-section="${id}"]`);assert.ok(button,'section '+id);button.click();}
function settingsBack(w){w.document.querySelector('.vb-settings-back').click();}
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
test('settings are grouped with usable back navigation and without the old link',async()=>{
 const dom=await app({user:'alice'});const w=dom.window;try{
  w.document.getElementById('settings-button').click();const body=w.document.getElementById('detail-body');
  for(const id of ['appearance','privacy','chats','folders','language','power','account','ai','application'])assert.ok(body.querySelector(`[data-settings-section="${id}"]`),id);
  assert.equal(body.textContent.includes('Открыть исходный интерфейс'),false);assert.equal(body.querySelector('a[href="./manager.html"]'),null);
  openSection(w,'privacy');assert.ok(body.textContent.includes('Скрывать сообщения'));assert.equal(body.querySelector('[data-settings-section]'),null);
  buttonByText(w,'Скрывать сообщения (наведите для просмотра)',body).click();assert.equal(w.localStorage.getItem('privacy-blur'),'true');assert.ok(w.document.getElementById('app').classList.contains('vb-private-blur'));
  settingsBack(w);openSection(w,'language');assert.equal(body.querySelector('#settings-language').options.length,5);
  settingsBack(w);openSection(w,'power');buttonByText(w,'Режим энергосбережения',body).click();assert.equal(w.localStorage.getItem('power-saving'),'true');
  settingsBack(w);openSection(w,'chats');assert.ok(body.textContent.includes('Анимация сообщений'));
  w.setLanguage('fr');assert.equal(w.document.documentElement.lang,'fr');assert.equal(w.localStorage.getItem('language'),'fr');
  w.document.getElementById('detail-close').click();assert.ok(body.querySelector('[data-settings-section="appearance"]'));assert.ok(w.document.getElementById('app').classList.contains('vb-mobile-details'));
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
  w.document.getElementById('settings-button').click();openSection(w,'folders');buttonByText(w,'Управлять папкой').click();buttonByText(w,'Friends').click();
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
  w.document.getElementById('settings-button').click();openSection(w,'appearance');w.setLanguage('fr');assert.ok(w.document.getElementById('detail-body').textContent.includes('Mode sombre'));
  w.setLanguage('ru');w.document.getElementById('account-button').click();buttonByText(w,'✎  Редактировать профиль').click();const inputs=w.document.querySelectorAll('.vb-profile-actions input[type=text],.vb-profile-actions input:not([type])');inputs[0].value='Alice A';inputs[1].value='alice_123';const form=w.document.querySelector('.vb-profile-actions form')||w.document.querySelector('form.vb-profile-actions');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,15));assert.equal(w.localStorage.getItem('user'),'alice');assert.equal(w.sessionStorage.getItem('profile-token-owner'),'alice');
 }finally{w.close();}
});
test('unknown chat senders are not displayed as Telegram identifiers',async()=>{
 const dom=await app({user:'alice',fetch:async(url)=>{if(url.includes('/messages/global'))return response([{id:1,sender:'telegram_private_name',text:'hello'}]);if(url.includes('/profile/public/'))return response({},404);return response([])}});const w=dom.window;try{
  await new Promise(resolve=>setTimeout(resolve,20));const list=w.document.getElementById('message-list');assert.ok(list.textContent.includes('hello'));assert.equal(list.textContent.includes('telegram_private_name'),false);
 }finally{w.close();}
});
test('wallpaper selection restores the saved image, changes locally and leaves the server untouched',async()=>{
 const image='data:image/jpeg;base64,YWJj';let requests=[];
 const dom=await app({user:'alice',initial:{'vb-wallpaper-image':image,'vb-wallpaper-mode':'custom'},fetch:async(url)=>{requests.push(url);return response([])}});const w=dom.window;try{
  const conversation=w.document.getElementById('conversation');assert.ok(conversation.style.backgroundImage.includes(image));
  w.document.getElementById('settings-button').click();openSection(w,'appearance');
  assert.equal(w.document.querySelector('[data-wallpaper-preview]').dataset.wallpaperPreview,'custom');
  const initialRequests=requests.length;
  w.document.querySelector('[data-wallpaper-mode="plain"]').click();assert.equal(w.localStorage.getItem('vb-wallpaper-mode'),'plain');assert.equal(w.localStorage.getItem('bg-static'),'false');assert.equal(conversation.style.backgroundImage,'');
  w.document.querySelector('[data-wallpaper-mode="custom"]').click();assert.equal(w.localStorage.getItem('vb-wallpaper-mode'),'custom');assert.ok(conversation.style.backgroundImage.includes(image));
  w.document.querySelector('[data-wallpaper-remove]').click();assert.equal(w.localStorage.getItem('vb-wallpaper-image'),null);assert.equal(w.localStorage.getItem('vb-wallpaper-mode'),'pattern');assert.equal(conversation.style.backgroundImage,'');
  assert.equal(requests.length,initialRequests);
 }finally{w.close();}
});
test('upload resizes and saves a custom wallpaper locally and handles invalid files',async()=>{
 const encoded='data:image/jpeg;base64,YWJj';let drawn;
 const dom=await app({user:'alice',setup(w){
  w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
  w.Image=class {constructor(){this.naturalWidth=2880;this.naturalHeight=1440;}set src(v){setTimeout(()=>this.onload(),0)}};
  w.HTMLCanvasElement.prototype.getContext=function(){return {drawImage:(_img,x,y,width,height)=>drawn={x,y,width,height}}};
  w.HTMLCanvasElement.prototype.toDataURL=()=>encoded;
 }});const w=dom.window;try{
  w.document.getElementById('settings-button').click();openSection(w,'appearance');
  const input=w.document.querySelector('[data-wallpaper-input]');Object.defineProperty(input,'files',{value:[new w.File(['x'],'a.png',{type:'image/png'})]});input.dispatchEvent(new w.Event('change'));
  await new Promise(resolve=>setTimeout(resolve,20));assert.deepEqual(drawn,{x:0,y:0,width:1440,height:720});assert.equal(w.localStorage.getItem('vb-wallpaper-image'),encoded);assert.equal(w.localStorage.getItem('vb-wallpaper-mode'),'custom');assert.ok(w.document.getElementById('conversation').style.backgroundImage.includes(encoded));
  const invalid=w.document.querySelector('[data-wallpaper-input]');Object.defineProperty(invalid,'files',{value:[new w.File(['x'],'bad.svg',{type:'image/svg+xml'})]});invalid.dispatchEvent(new w.Event('change'));assert.equal(w.localStorage.getItem('vb-wallpaper-image'),encoded);assert.ok(w.document.getElementById('toast-text').textContent.includes('PNG'));
 }finally{w.close();}
});
test('a storage failure does not replace the previous wallpaper',async()=>{
 const original='data:image/jpeg;base64,b2xk';const dom=await app({user:'alice',initial:{'vb-wallpaper-image':original,'vb-wallpaper-mode':'custom'},setup(w){
  w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.Image=class {constructor(){this.naturalWidth=100;this.naturalHeight=100;}set src(v){setTimeout(()=>this.onload(),0)}};
  w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,bmV3';
 }});const w=dom.window;try{
  const proto=Object.getPrototypeOf(w.localStorage), real=proto.setItem;proto.setItem=function(k,v){if(k==='vb-wallpaper-image')throw new Error('quota');return real.call(this,k,v)};
  w.document.getElementById('settings-button').click();openSection(w,'appearance');const input=w.document.querySelector('[data-wallpaper-input]');Object.defineProperty(input,'files',{value:[new w.File(['x'],'a.jpg',{type:'image/jpeg'})]});input.dispatchEvent(new w.Event('change'));await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(w.localStorage.getItem('vb-wallpaper-image'),original);assert.equal(w.localStorage.getItem('vb-wallpaper-mode'),'custom');assert.ok(w.document.getElementById('conversation').style.backgroundImage.includes(original));assert.ok(w.document.getElementById('toast-text').textContent.includes('недостаточно места'));
  proto.setItem=real;
 }finally{w.close();}
});

 test('Android app-assets origin sends API requests to the real HTTPS server',async()=>{
 let requests=[];const dom=await app({url:'https://appassets.androidplatform.net/index.html',fetch:async(url)=>{requests.push(url);return response({status:'error',detail:'test'});}});const w=dom.window;try{
  w.showForm(false);w.document.getElementById('input-tg').value='alice';w.document.getElementById('input-pass').value='password';await w.submitAuth();
  assert.ok(requests.includes('https://material-caht.onrender.com/api/send_code'));
 }finally{w.close();}
});
test('profile editor opens without a password dialog but does not save without a session',async()=>{
 let requests=[];const dom=await app({user:'alice',fetch:async(url,opt={})=>{requests.push({url,opt});return response([])}});const w=dom.window;try{
  w.document.getElementById('account-button').click();buttonByText(w,'✎  Редактировать профиль').click();
  assert.ok(w.document.querySelector('form.vb-profile-actions'));assert.equal(w.document.querySelector('.vb-modal input[type=password]'),null);
  const form=w.document.querySelector('form.vb-profile-actions');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(requests.some(r=>r.opt.method==='PUT'),false);assert.match(w.document.getElementById('toast-text').textContent,/Войдите заново/);
 }finally{w.close();}
});
test('auth form uses a bare input view and returns to the first card',async()=>{
 const dom=await app();const w=dom.window;try{
  const card=w.document.querySelector('.auth-card');w.showForm(true);assert.ok(card.classList.contains('auth-form-view'));assert.ok(w.document.querySelector('#input-pass'));
  w.closeForm();assert.equal(card.classList.contains('auth-form-view'),false);assert.equal(w.document.getElementById('start-buttons').style.display,'flex');
 }finally{w.close();}
});
test('video attachment uses multipart upload and sends a normalized HTTPS media URL',async()=>{
 let requests=[];const dom=await app({user:'alice',url:'https://appassets.androidplatform.net/index.html',fetch:async(url,opt={})=>{
  requests.push({url,opt});if(url.endsWith('/upload'))return response({url:'http://material-caht.onrender.com/uploads/movie.mp4'});return response([]);
 },setup(w){const old=w.HTMLInputElement.prototype.click;w.HTMLInputElement.prototype.click=function(){if(this.type==='file'){Object.defineProperty(this,'files',{configurable:true,value:[new w.File(['video'],'видео.mp4',{type:'video/mp4'})]});this.dispatchEvent(new w.Event('change'));}else old.call(this);};}});const w=dom.window;try{
  w.document.getElementById('attach-button').click();buttonByText(w,'Выберите фото или видео').click();await new Promise(resolve=>setTimeout(resolve,30));
  const up=requests.find(r=>r.url.endsWith('/upload'));assert.ok(up);assert.equal(up.opt.headers,undefined);const file=up.opt.body.get('file');assert.match(file.name,/^media_.*\.mp4$/);assert.equal(file.type,'video/mp4');
  const msg=requests.find(r=>r.url.endsWith('/messages')&&r.opt.method==='POST');assert.ok(msg);assert.deepEqual(JSON.parse(msg.opt.body),{chat_id:'global',sender:'alice',media_url:'https://material-caht.onrender.com/uploads/movie.mp4',msg_type:'video'});
 }finally{w.close();}
});
test('failed media upload never creates a message',async()=>{
 let requests=[];const dom=await app({user:'alice',fetch:async(url,opt={})=>{requests.push({url,opt});return url.endsWith('/upload')?response({detail:'upload failed'},500):response([])},setup(w){w.HTMLInputElement.prototype.click=function(){if(this.type==='file'){Object.defineProperty(this,'files',{configurable:true,value:[new w.File(['photo'],'pic.png',{type:'image/png'})]});this.dispatchEvent(new w.Event('change'));}};}});const w=dom.window;try{
  w.document.getElementById('attach-button').click();buttonByText(w,'Выберите фото или видео').click();await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(requests.some(r=>r.url.endsWith('/messages')&&r.opt.method==='POST'),false);assert.match(w.document.getElementById('toast-text').textContent,/upload failed/);
 }finally{w.close();}
});
test('voice and round video record, release tracks, and upload the correct message types',async()=>{
 let requests=[], stopped=0, constraints=[];const dom=await app({user:'alice',fetch:async(url,opt={})=>{requests.push({url,opt});return url.endsWith('/upload')?response({url:'https://material-caht.onrender.com/uploads/record.webm'}):response([])},setup(w){
  Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async c=>{constraints.push(c);return {getTracks:()=>[{stop:()=>stopped++}]}}}});
  w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};w.HTMLMediaElement.prototype.play=()=>Promise.resolve();
  w.MediaRecorder=class {static isTypeSupported(){return true}constructor(stream,opt){this.mimeType=opt.mimeType;this.state='inactive'}start(){this.state='recording'}stop(){this.state='inactive';this.ondataavailable({data:new w.Blob(['record'],{type:this.mimeType})});this.onstop()}};
 }});const w=dom.window;try{
  for(const [label,type] of [['Голосовое сообщение','audio'],['Записать кружок','circle']]){
   w.document.getElementById('attach-button').click();buttonByText(w,label).click();buttonByText(w,'Начать запись').click();await new Promise(resolve=>setTimeout(resolve,5));
   buttonByText(w,'Остановить запись').click();buttonByText(w,'Отправить запись').click();await new Promise(resolve=>setTimeout(resolve,25));
   assert.ok(requests.some(r=>r.url.endsWith('/messages')&&r.opt.method==='POST'&&JSON.parse(r.opt.body).msg_type===type));
  }
  assert.equal(constraints[0].video,false);assert.equal(constraints[1].video.facingMode,'user');assert.equal(stopped,2);
 }finally{w.close();}
});
test('closing a recording releases the microphone even if permission arrives late',async()=>{
 let finish,stopped=0;const dom=await app({user:'alice',setup(w){Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:()=>new Promise(resolve=>{finish=()=>resolve({getTracks:()=>[{stop:()=>stopped++}]})})}});w.MediaRecorder=class{};}});const w=dom.window;try{
  w.document.getElementById('attach-button').click();buttonByText(w,'Голосовое сообщение').click();buttonByText(w,'Начать запись').click();buttonByText(w,'Отмена').click();finish();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(stopped,1);
 }finally{w.close();}
});
test('old same-server HTTP media is shown via HTTPS and round videos are circular',async()=>{
 const dom=await app({user:'alice',url:'https://appassets.androidplatform.net/index.html',fetch:async(url)=>url.endsWith('/messages/global')?response([{id:1,sender:'alice',text:'',media_url:'http://material-caht.onrender.com/uploads/test.webm',type:'circle'}]):response([])});const w=dom.window;try{
  await new Promise(resolve=>setTimeout(resolve,15));const video=w.document.querySelector('.vb-bubble video');assert.ok(video);assert.equal(video.src,'https://material-caht.onrender.com/uploads/test.webm');assert.ok(video.classList.contains('vb-circle-video'));assert.equal(video.controls,true);
 }finally{w.close();}
});
test('message API error after an upload is not reported as sent',async()=>{
 let requests=[];const dom=await app({user:'alice',fetch:async(url,opt={})=>{requests.push({url,opt});if(url.endsWith('/upload'))return response({url:'https://material-caht.onrender.com/uploads/pic.png'});if(url.endsWith('/messages')&&opt.method==='POST')return response({status:'error',detail:'failed'});return response([])},setup(w){w.HTMLInputElement.prototype.click=function(){if(this.type==='file'){Object.defineProperty(this,'files',{configurable:true,value:[new w.File(['photo'],'pic.png',{type:'image/png'})]});this.dispatchEvent(new w.Event('change'));}};}});const w=dom.window;try{
  w.document.getElementById('attach-button').click();buttonByText(w,'Выберите фото или видео').click();await new Promise(resolve=>setTimeout(resolve,20));
  assert.match(w.document.getElementById('toast-text').textContent,/failed/);
 }finally{w.close();}
});
test('main app is branded Material Chat without a variant label',async()=>{
 const dom=await app();const w=dom.window;try{
  assert.equal(w.document.title,'Material Chat');assert.equal(w.document.querySelector('.vb-detail-footer').textContent.trim(),'MATERIAL CHAT');
  assert.doesNotMatch(w.document.body.textContent,/вариант\s*b/i);
 }finally{w.close();}
});
test('homepage points to the main HTML and preserves query and fragment',()=>{
 const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
 assert.match(index,/location\.replace\('\.\/variant-b\.html'\s*\+\s*location\.search\s*\+\s*location\.hash\)/);
 assert.match(index,/<a href="\.\/variant-b\.html">/);
});
test('layout constrains the page and scrolls the sidebar, settings and message history independently',()=>{
 assert.match(html,/html, body\s*\{[^}]*overflow:hidden/);
 assert.match(html,/\.vb-app \.vb-shell\s*\{[^}]*height:100dvh[^}]*overflow:hidden/);
 assert.match(html,/\.vb-sidebar-scroll\s*\{[^}]*overflow-y: auto/);
 assert.match(html,/\.vb-detail-body\s*\{[^}]*overflow-y: auto/);
 assert.match(html,/\.vb-conversation\s*\{[^}]*overflow-y: auto/);
});
test('clicking a photo opens viewer and can download and send an edited copy',async()=>{
 let requests=[], downloads=[], revoked=[];const dom=await app({user:'alice',fetch:async(url,opt={})=>{
  requests.push({url,opt});if(url.endsWith('/messages/global'))return response([{id:1,sender:'alice',text:'',media_url:'https://material-caht.onrender.com/uploads/a.png',type:'image'}]);
  if(url.endsWith('/uploads/a.png'))return {ok:true,blob:async()=>new dom.window.Blob(['photo'],{type:'image/png'})};
  if(url.endsWith('/upload'))return response({url:'https://material-caht.onrender.com/uploads/edited.png'});return response([]);
 },setup(w){
  w.URL.createObjectURL=()=> 'blob:download';w.URL.revokeObjectURL=url=>revoked.push(url);
  w.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download)};
  w.HTMLCanvasElement.prototype.getContext=function(){return {save(){},translate(){},rotate(){},scale(){},drawImage(){},restore(){}}};
  w.HTMLCanvasElement.prototype.toBlob=function(cb){cb(new w.Blob(['edited'],{type:'image/png'}));};
  w.Image=class {constructor(){this.width=800;this.height=400;this.naturalWidth=800;this.naturalHeight=400}set src(v){setTimeout(()=>this.onload(),0)}};
 }});const w=dom.window;try{
  await new Promise(r=>setTimeout(r,20));const img=w.document.querySelector('.vb-message-photo');assert.ok(img);img.click();assert.ok(w.document.querySelector('.vb-photo-modal'));
  buttonByText(w,'Скачать фото').click();await new Promise(r=>setTimeout(r,5));assert.deepEqual(downloads,['material-chat-photo.png']);
  buttonByText(w,'Редактировать фото').click();await new Promise(r=>setTimeout(r,10));const canvas=w.document.querySelector('.vb-photo-stage canvas');assert.equal(canvas.width,800);assert.equal(canvas.height,400);
  buttonByText(w,'Повернуть вправо').click();assert.equal(canvas.width,400);assert.equal(canvas.height,800);
  buttonByText(w,'Отразить').click();buttonByText(w,'Отправить копию').click();await new Promise(r=>setTimeout(r,30));
  assert.ok(requests.some(r=>r.url.endsWith('/upload')));const posted=requests.find(r=>r.url.endsWith('/messages')&&r.opt.method==='POST');assert.equal(JSON.parse(posted.opt.body).msg_type,'image');
 }finally{w.close();}
});
test('reactions load, toggle and display without exposing sender IDs',async()=>{
 let requests=[];let reaction={emoji:'👍',count:1,reacted:true};const dom=await app({user:'alice',session:{'profile-token':'tok','profile-token-owner':'alice'},fetch:async(url,opt={})=>{
  requests.push({url,opt});if(url.endsWith('/messages/global'))return response([{id:1,sender:'alice',text:'hello'}]);
  if(url.includes('/reactions?'))return response({messages:{'1':[reaction]}});
  if(url.endsWith('/reactions')&&opt.method==='POST'){reaction={emoji:'👍',count:2,reacted:true};return response({reactions:[reaction]})}return response([]);
 }});const w=dom.window;try{
  await new Promise(r=>setTimeout(r,20));const chip=w.document.querySelector('.vb-reaction-chip');assert.equal(chip.textContent,'👍 1');assert.ok(chip.classList.contains('vb-reacted'));chip.click();await new Promise(r=>setTimeout(r,20));
  assert.equal(w.document.querySelector('.vb-reaction-chip').textContent,'👍 2');const post=requests.find(r=>r.url.endsWith('/reactions')&&r.opt.method==='POST');assert.equal(post.opt.headers.Authorization,'Bearer tok');
 }finally{w.close();}
});
test('missing reaction backend is reported and no local reaction is faked',async()=>{
 const dom=await app({user:'alice',fetch:async(url,opt={})=>{if(url.endsWith('/messages/global'))return response([{id:1,sender:'alice',text:'hello'}]);if(url.includes('/reactions'))return response({},404);return response([])}});const w=dom.window;try{
  await new Promise(r=>setTimeout(r,10));w.document.querySelector('.vb-reaction-add').click();buttonByText(w,'👍').click();await new Promise(r=>setTimeout(r,10));
  assert.match(w.document.getElementById('toast-text').textContent,/Сервер реакций ещё не подключён/);assert.equal(w.document.querySelectorAll('.vb-reaction-chip').length,0);
 }finally{w.close();}
});

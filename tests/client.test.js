const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '..');
class Assets extends ResourceLoader {
  fetch(url) {
    const pathname = new URL(url).pathname;
    if (pathname.startsWith('/assets/')) return Promise.resolve(fs.readFileSync(path.join(root, pathname)));
    return null;
  }
}
async function app(initial = {}) {
  const errors = [];
  const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(fs.readFileSync(path.join(root,'manager.html'),'utf8'), {
    url:'http://localhost/manager.html', runScripts:'dangerously', resources:new Assets(), virtualConsole:console,
    beforeParse(window) {
      Object.entries(initial).forEach(([key,value]) => window.localStorage.setItem(key,value));
      window.fetch = async () => ({ok:true, json:async () => []});
      window.confirm = () => true;
    }
  });
  await new Promise(resolve => dom.window.addEventListener('load', resolve));
  assert.deepEqual(errors, []);
  return dom;
}
test('language selection translates interface and persists', async () => {
  const dom = await app(); const w = dom.window;
  w.setLanguage('fr');
  assert.equal(w.document.documentElement.lang,'fr');
  assert.equal(w.document.querySelector('#nav-settings .label').textContent,'Paramètres');
  assert.equal(w.document.getElementById('input-pass').placeholder,'Mot de passe');
  assert.equal(w.localStorage.getItem('language'),'fr');
  w.setLanguage('uk'); assert.equal(w.document.querySelector('#nav-chats .label').textContent,'Чати');
  dom.window.close();
});
test('folders are per account, filter chats, and survive rendering', async () => {
  const dom = await app({user:'alice'}); const w = dom.window;
  w.prompt = () => 'Friends'; w.createFolder();
  let f = JSON.parse(w.localStorage.getItem('chat-folders:alice'));
  assert.equal(f[0].name,'Friends');
  const checkbox = w.document.querySelector('.folder-check input'); checkbox.click();
  f = JSON.parse(w.localStorage.getItem('chat-folders:alice')); assert.deepEqual(f[0].chats,['saved']);
  assert.equal(w.document.querySelector('[data-chat-id="saved"]').style.display,'');
  assert.equal(w.document.querySelector('[data-chat-id="global"]').style.display,'none');
  w.manageFolder(); w.document.querySelector('#modal-body button:last-child').click();
  assert.equal(JSON.parse(w.localStorage.getItem('chat-folders:alice')).length,0);
  assert.equal(w.document.querySelector('[data-chat-id="global"]').style.display,'');
  dom.window.close();
});
test('power, privacy and theme persist independently', async () => {
  const dom = await app({user:'alice'}); const w = dom.window;
  w.document.getElementById('power-saving').click();
  w.document.getElementById('privacy-name').click();
  w.document.getElementById('privacy-blur').click();
  w.setTheme('dark');
  assert.equal(w.localStorage.getItem('power-saving'),'true');
  assert.ok(w.document.body.classList.contains('power-saving'));
  assert.ok(w.document.body.classList.contains('privacy-blur'));
  assert.equal(w.document.getElementById('profile-username').textContent,'••••••');
  w.document.getElementById('power-saving').click();
  assert.ok(!w.document.body.classList.contains('power-saving'));
  assert.ok(w.document.body.classList.contains('theme-dark'));
  dom.window.close();
});
test('emoji catalog searches and inserts at the caret', async () => {
  const dom = await app({user:'alice'}); const w = dom.window;
  w.openChat('global','Global Chat'); w.toggleEmoji();
  const search = w.document.getElementById('emoji-search'); search.value='grinning face'; search.dispatchEvent(new w.Event('input'));
  const button = w.document.querySelector('#emoji-grid button'); assert.equal(button.textContent,'😀');
  const input = w.document.getElementById('msg-input'); input.value='ab'; input.setSelectionRange(1,1); button.click();
  assert.equal(input.value,'a😀b');
  assert.ok(w.EMOJI_DATA.length > 3000);
  dom.window.close();
});
test('message sending reports HTTP and network errors and restores the text', async () => {
  const dom = await app({user:'alice'}); const w = dom.window;
  try {
    w.openChat('global','Global Chat');
    const input = w.document.getElementById('msg-input');
    input.value = 'Hello';
    w.fetch = async () => ({ok:false,status:503});
    await w.sendMessage();
    assert.equal(input.value, 'Hello');
    assert.match(w.document.getElementById('toast').innerText, /HTTP 503/);
    w.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await w.sendMessage();
    assert.equal(input.value, 'Hello');
    assert.match(w.document.getElementById('toast').innerText, /соединения/);
  } finally { dom.window.close(); }
});
test('AI chat uses configured endpoint, keeps key out of storage and stores history locally', async () => {
  const dom = await app({user:'alice'}); const w = dom.window;
  try {
    w.openChat('ai','AI');
    w.openAISettings();
    const form = w.document.querySelector('.ai-form');
    const [endpoint, model, key] = form.querySelectorAll('input');
    endpoint.value='https://ai.example.com/v1/chat/completions';
    model.value='test-model'; key.value='test-key';
    form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(w.localStorage.getItem('ai-endpoint'), endpoint.value);
    assert.ok(!Object.values(w.localStorage).includes('test-key'));
    let request;
    w.fetch = async (url, options) => { request = {url, options}; return {ok:true,json:async()=>({choices:[{message:{content:'Hello!'}}]})}; };
    const input = w.document.getElementById('msg-input'); input.value='Hi';
    await w.sendMessage();
    assert.equal(request.url, endpoint.value);
    assert.equal(request.options.headers.Authorization,'Bearer test-key');
    assert.equal(JSON.parse(request.options.body).messages[0].content,'Hi');
    const history = JSON.parse(w.localStorage.getItem('ai-history:alice'));
    assert.deepEqual(history.map(x => x.role),['user','assistant']);
    assert.equal(history[1].content,'Hello!');
    assert.match(w.document.getElementById('messages-container').textContent,/Hello!/);
  } finally { dom.window.close(); }
});
test('AI rejects insecure endpoint and does not transmit input without configuration', async () => {
  const dom = await app({user:'alice'}); const w = dom.window;
  try {
    w.openChat('ai','AI'); const input = w.document.getElementById('msg-input'); input.value='private';
    let called = false; w.fetch = async () => { called=true; throw new Error('unexpected'); };
    await w.sendMessage(); assert.equal(called,false); assert.equal(input.value,'private');
    const form=w.document.querySelector('.ai-form'); const fields=form.querySelectorAll('input');
    fields[0].value='http://example.com/api'; fields[1].value='model';
    form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(w.localStorage.getItem('ai-endpoint'),null);
  } finally { dom.window.close(); }
});
test('polling backs off after failures and stops in hidden tabs', async () => {
  const dom = await app({user:'alice'}); const w = dom.window;
  try {
    Object.defineProperty(w.document, 'hidden', {configurable:true, value:false});
    const timers = [];
    w.setTimeout = (callback, delay) => { timers.push({callback, delay}); return timers.length; };
    w.clearTimeout = () => {};
    w.fetch = async () => { throw new Error('network'); };
    w.openChat('global','Global Chat');
    assert.equal(timers.at(-1).delay, 15000);
    await timers.at(-1).callback();
    assert.equal(timers.at(-1).delay, 30000);
    await timers.at(-1).callback();
    assert.equal(timers.at(-1).delay, 60000);
    const count = timers.length;
    Object.defineProperty(w.document, 'hidden', {configurable:true, value:true});
    w.document.dispatchEvent(new w.Event('visibilitychange'));
    await timers.at(-1).callback();
    assert.equal(timers.length, count);
    Object.defineProperty(w.document, 'hidden', {configurable:true, value:false});
    w.document.dispatchEvent(new w.Event('visibilitychange'));
    assert.equal(timers.length, count + 1);
  } finally { dom.window.close(); }
});
test('authentication menus transition in sequence and ignore rapid repeat clicks', async () => {
  const dom = await app(); const w = dom.window;
  try {
    const start = w.document.getElementById('start-buttons');
    const form = w.document.getElementById('auth-form');
    w.showForm(true);
    assert.ok(start.classList.contains('auth-step-leave'));
    assert.equal(start.style.display, 'flex');
    assert.ok(!form.classList.contains('active'));
    w.showForm(false);
    await new Promise(resolve => setTimeout(resolve, 390));
    assert.equal(start.style.display, 'none');
    assert.ok(form.classList.contains('active'));
    assert.ok(form.classList.contains('auth-step-enter'));
    assert.equal(w.document.getElementById('input-chat-nick'), null);
    await new Promise(resolve => setTimeout(resolve, 450));
    w.closeForm();
    assert.ok(form.classList.contains('auth-step-leave'));
    await new Promise(resolve => setTimeout(resolve, 390));
    assert.equal(start.style.display, 'flex');
    assert.ok(!form.classList.contains('active'));
    await new Promise(resolve => setTimeout(resolve, 450));
    w.showForm(false);
    await new Promise(resolve => setTimeout(resolve, 390));
    assert.equal(w.document.getElementById('input-chat-nick'), null);
  } finally { dom.window.close(); }
});
test('authentication menus switch immediately with animations disabled', async () => {
  const dom = await app({anim:'false'}); const w = dom.window;
  try {
    w.showForm(true);
    assert.equal(w.document.getElementById('start-buttons').style.display, 'none');
    assert.ok(w.document.getElementById('auth-form').classList.contains('active'));
    w.closeForm();
    assert.equal(w.document.getElementById('start-buttons').style.display, 'flex');
    assert.ok(!w.document.getElementById('auth-form').classList.contains('active'));
  } finally { dom.window.close(); }
});
test('registration requires Telegram code but no nickname or public username', async () => {
  const dom = await app({anim:'false'}); const w = dom.window;
  try {
    const requests=[];
    w.fetch = async (url, options) => {
      requests.push({url, body:JSON.parse(options.body)});
      if (url.endsWith('/send_code')) return {ok:true, status:200, json:async()=>({status:'ok'})};
      if (url.endsWith('/profile/register')) return {ok:true, status:200, json:async()=>({token:'token-123'})};
      return {ok:true,status:200,json:async()=>({nickname:'',handle:'',avatar:''})};
    };
    w.showForm(false);
    assert.equal(w.document.getElementById('input-chat-nick'), null);
    w.document.getElementById('input-tg').value = 'Alice';
    w.document.getElementById('input-pass').value = 'password';
    await w.submitAuth();
    assert.equal(requests[0].body.tg_username,'Alice');
    assert.equal(w.document.getElementById('code-field').style.display,'block');
    w.document.getElementById('input-code').value = '1234';
    await w.submitAuth();
    assert.deepEqual(requests[1].body,{tg_username:'Alice', password:'password', code:'1234'});
    assert.equal(w.localStorage.getItem('user'),'Alice');
    assert.equal(w.sessionStorage.getItem('profile-token'),'token-123');
    assert.equal(w.sessionStorage.getItem('profile-token-owner'),'Alice');
  } finally { dom.window.close(); }
});
test('profile editor saves nickname and handle to the server, not local storage', async () => {
  const dom = await app({user:'alice'}); const w = dom.window;
  try {
    w.sessionStorage.setItem('profile-token','test-token'); w.sessionStorage.setItem('profile-token-owner','alice');
    let saved;
    w.fetch = async (url,options={}) => {
      if (options.method === 'PUT') { saved={url, headers:options.headers, data:JSON.parse(options.body)}; return {ok:true,json:async()=>saved.data}; }
      return {ok:true,json:async()=>({nickname:'',handle:'',avatar:''})};
    };
    await w.openProfileEditor();
    const form=w.document.querySelector('.profile-form');
    const [nickname,handle]=form.querySelectorAll('input[type=text]'); nickname.value='Alice A'; handle.value='@Alice_123';
    await form.onsubmit({preventDefault(){}});
    assert.deepEqual(saved.data,{nickname:'Alice A',handle:'alice_123',avatar:''});
    assert.equal(saved.headers.Authorization,'Bearer test-token');
    assert.equal(w.document.getElementById('profile-display-name').textContent,'Alice A');
    assert.equal(w.document.getElementById('profile-username').textContent,'@alice_123');
    assert.equal(w.localStorage.getItem('profile-token'),null);
  } finally { dom.window.close(); }
});
test('global chat displays public profile names without interpreting HTML', async () => {
  const dom = await app({user:'alice'}); const w = dom.window;
  try {
    w.fetch = async url => {
      if (url.includes('/messages/')) return {ok:true,json:async()=>[{id:7,sender:'bob',text:'hello',type:'text'}]};
      if (url.includes('/profile/public/')) return {ok:true,json:async()=>({nickname:'<b>Bob</b>',handle:'bob',avatar:''})};
      throw Error('unexpected');
    };
    w.openChat('global','Global Chat'); await w.loadMessages();
    await new Promise(resolve => setTimeout(resolve, 10));
    const name=w.document.querySelector('.message-author span:last-child');
    assert.equal(name.textContent,'<b>Bob</b>'); assert.equal(name.children.length,0);
  } finally { dom.window.close(); }
});
test('legacy server supports sign-in and code-verified registration before profile deployment', async () => {
  const dom = await app({anim:'false'}); const w=dom.window;
  try {
    let requests=[];
    w.fetch = async (url, options={}) => {
      requests.push({url, body:options.body && JSON.parse(options.body)});
      if (url.endsWith('/profile/session') || url.endsWith('/profile/register')) return {ok:false,status:404};
      if (url.endsWith('/send_code') || url.endsWith('/verify_code') || url.endsWith('/auth')) return {ok:true,status:200,json:async()=>({status:'ok'})};
      return {ok:true,status:200,json:async()=>[]};
    };
    w.showForm(false); w.document.getElementById('input-tg').value='Alice'; w.document.getElementById('input-pass').value='password';
    await w.submitAuth(); w.document.getElementById('input-code').value='1234'; await w.submitAuth();
    assert.ok(requests.some(r => r.url.endsWith('/verify_code') && r.body.code === '1234'));
    const auth=requests.find(r => r.url.endsWith('/auth'));
    assert.match(auth.body.username, /^u_[0-9a-f]{32}$/);
    assert.equal(w.localStorage.getItem('user'),'Alice');
    assert.equal(w.sessionStorage.getItem('profile-token'),null);
  } finally { dom.window.close(); }
});
test('existing sessions ask for a password before editing a shared profile', async () => {
  const dom=await app({user:'alice'}); const w=dom.window;
  try {
    await w.openProfileEditor();
    const form=w.document.querySelector('.profile-form');
    const password=form.querySelector('input[type=password]'); password.value='secret';
    let sessionBody;
    w.fetch = async (url,options={}) => {
      if (url.endsWith('/profile/session')) { sessionBody=JSON.parse(options.body); return {ok:true,json:async()=>({token:'new-token'})}; }
      if (url.endsWith('/profile/me')) return {ok:true,json:async()=>({nickname:'Alice',handle:'alice',avatar:''})};
      throw Error('unexpected request');
    };
    await form.onsubmit({preventDefault(){}});
    assert.deepEqual(sessionBody,{identifier:'alice',password:'secret'});
    assert.equal(w.sessionStorage.getItem('profile-token'),'new-token');
    assert.equal(w.localStorage.getItem('password'),null);
    assert.ok(w.document.querySelector('.profile-form input[type=file]'));
  } finally { dom.window.close(); }
});

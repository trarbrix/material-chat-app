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

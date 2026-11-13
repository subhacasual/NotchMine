'use strict';
/* Phone → PC drop.
   A tiny upload server that only runs while the "From phone" panel is open:
   - listens on your local network only (phones on the same Wi-Fi)
   - every session gets a fresh random 128-bit link (shown as a QR code); anything else gets 404
   - stops by itself after 10 minutes without activity, or when you close the panel
   - files land in Downloads\NotchMine Phone Drop and appear on the Shelf */

const http = require('http');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const MAX_BYTES = 32 * 1024 ** 3;        // per file (long 4K videos are big)
const CHUNK_MAX = 64 * 1024 * 1024;      // largest piece we accept in one request (the page sends 8 MB)
const IDLE_MS = 10 * 60 * 1000;          // switches off after 10 minutes with no transfer activity

let server = null;
let sessions = null;
let state = { running: false };
let idleTimer = null;
let hooks = {};

function lanAddress() {
  const all = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Bluetooth/i.test(name)) continue;
      const score = a.address.startsWith('192.168.') ? 0 : a.address.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 5;
      all.push({ name, address: a.address, score: score + (/wi-?fi|wlan|wireless/i.test(name) ? 0 : 0.5) });
    }
  }
  all.sort((a, b) => a.score - b.score);
  return all[0] || null;
}

function safeName(name) {
  let n = path.basename(String(name || 'file')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim();
  if (!n) n = 'file';
  return n.slice(0, 180);
}
function uniquePath(dir, name) {
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name), i = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}

function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => stop('idle'), IDLE_MS);
}

// The upload page the phone opens. Plain HTML/JS, no outside resources.
function page(token, info) {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#000000"><title>Send to ${esc(info.pc)} · NotchMine</title>
<style>
:root{color-scheme:dark;--a:#a78bfa;--g:#30d158;--r:#ff453a;--m:#a1a1aa;--c:#141416;--l:rgba(255,255,255,.08)}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;font:15px/1.45 -apple-system,system-ui,"Segoe UI",Roboto,sans-serif;background:radial-gradient(120% 60% at 50% -10%,rgba(167,139,250,.28),transparent 60%),#000;color:#f5f5f7;min-height:100vh;padding:0 16px 40px}
.wrap{max-width:460px;margin:0 auto}
.pill{width:120px;height:28px;border-radius:0 0 16px 16px;background:#000;margin:0 auto 22px;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 0 30px rgba(167,139,250,.35)}
.pc{display:flex;align-items:center;gap:12px;padding:14px;border-radius:18px;background:var(--c);box-shadow:inset 0 0 0 1px var(--l)}
.pc .ic{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:rgba(167,139,250,.18);font-size:22px;flex:none}
.pc b{display:block;font-size:16px}.pc small{color:var(--m);font-size:12.5px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--g);box-shadow:0 0 8px var(--g);margin-right:6px;vertical-align:1px}
.dot.off{background:var(--r);box-shadow:0 0 8px var(--r)}
h1{font-size:24px;margin:26px 0 4px;letter-spacing:-.3px}p.sub{margin:0 0 18px;color:var(--m)}
.pick{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:62px;border-radius:20px;background:var(--a);color:#000;font-weight:700;font-size:17px;border:0;box-shadow:0 10px 30px rgba(167,139,250,.35)}
.pick:active{transform:scale(.98)}input{display:none}
.total{display:none;margin-top:18px;padding:14px;border-radius:18px;background:var(--c);box-shadow:inset 0 0 0 1px var(--l)}
.total.on{display:block}.trow{display:flex;justify-content:space-between;font-size:13px;color:var(--m)}.trow b{color:#fff;font-size:15px}
.bar{height:8px;border-radius:4px;background:#2a2a2e;margin:10px 0 8px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7b5cff,var(--a));border-radius:4px;transition:width .25s}
.total.done .bar i{background:var(--g)}
ul{list-style:none;padding:0;margin:14px 0 0}
li{display:flex;gap:12px;align-items:center;background:var(--c);border-radius:16px;padding:10px;margin-bottom:8px;box-shadow:inset 0 0 0 1px var(--l)}
.th{width:52px;height:52px;border-radius:10px;background:#222 center/cover;flex:none;display:grid;place-items:center;font-size:22px;overflow:hidden}
.th video{width:100%;height:100%;object-fit:cover}
.meta{flex:1;min-width:0}.n{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fb{height:5px;border-radius:3px;background:#2a2a2e;margin-top:7px;overflow:hidden}.fb i{display:block;height:100%;width:0;background:var(--a);transition:width .2s}
.ok .fb i{background:var(--g)}.err .fb i{background:var(--r)}
.s{font-size:12px;color:var(--m);margin-top:5px;display:flex;justify-content:space-between}
.st{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;flex:none;font-size:14px;background:#222}
.ok .st{background:rgba(48,209,88,.2);color:var(--g)}.err .st{background:rgba(255,69,58,.2);color:var(--r)}
.note{margin-top:22px;padding:12px 14px;border-radius:14px;background:rgba(255,159,10,.08);box-shadow:inset 0 0 0 1px rgba(255,159,10,.2);color:#d6b98a;font-size:12.5px}
.note b{color:#ffcc80}
.prep{display:none;margin-top:14px;padding:14px;border-radius:18px;background:var(--c);box-shadow:inset 0 0 0 1px var(--l);gap:12px;align-items:center}
.prep.on{display:flex}.prep b{display:block;font-size:14.5px}.prep small{display:block;color:var(--m);font-size:12.5px;margin-top:2px}
.spin{width:26px;height:26px;border-radius:50%;border:3px solid rgba(167,139,250,.25);border-top-color:var(--a);animation:sp 1s linear infinite;flex:none}
@keyframes sp{to{transform:rotate(360deg)}}
.ibar{height:5px;border-radius:3px;background:#2a2a2e;margin-top:9px;overflow:hidden;position:relative}
.ibar i{position:absolute;top:0;bottom:0;width:35%;border-radius:3px;background:var(--a);animation:ib 1.3s ease-in-out infinite}
@keyframes ib{0%{left:-35%}100%{left:100%}}
.prep .x{margin-left:auto;align-self:flex-start;color:var(--m);font-size:13px;background:none;border:0;padding:2px 4px}
.err-line{color:#ff9f90}
</style></head><body><div class="wrap">
<div class="pill"></div>
<div class="pc"><div class="ic">💻</div><div><b>${esc(info.pc)}</b><small><span class="dot" id="dot"></span><span id="conn">Connected</span> · ${esc(info.network)} · NotchMine</small></div></div>
<h1>Send to your PC</h1><p class="sub">Photos, videos and files land on the NotchMine shelf on <b>${esc(info.pc)}</b>.</p>
<label class="pick" id="pick">＋ Choose photos or files<input id="f" type="file" multiple></label>
<div class="prep" id="prep"><div class="spin"></div><div style="flex:1;min-width:0"><b id="prepT">Getting your files ready…</b><small id="prepS">Big videos can take a while: your phone copies them before they can be sent.</small><div class="ibar"><i></i></div></div><button class="x" id="prepX">Hide</button></div>
<div class="total" id="total">
  <div class="trow"><span id="tcount">Sending…</span><b id="tpct">0%</b></div>
  <div class="bar"><i id="tbar"></i></div>
  <div class="trow"><span id="tsize"></span><span id="tspeed"></span></div>
</div>
<ul id="l"></ul>
<div class="note"><b>Only use this on your own Wi-Fi.</b> The link works only while NotchMine shows its QR code on the PC, and only on this network. The transfer isn't encrypted, so avoid public or shared Wi-Fi.<br><br><b>Big videos:</b> keep this page open with the screen on until it finishes. If it pauses (screen off, Wi-Fi blip) it continues from where it stopped.</div>
</div>
<script>
const $=id=>document.getElementById(id),f=$('f'),l=$('l');
const size=b=>b<1024?b+' B':b<1048576?(b/1024).toFixed(0)+' KB':b<1073741824?(b/1048576).toFixed(1)+' MB':(b/1073741824).toFixed(2)+' GB';
const dur=s=>!isFinite(s)||s<0?'':s<60?Math.ceil(s)+' s left':Math.floor(s/60)+' min '+Math.ceil(s%60)+' s left';
let queue=[],totalBytes=0,sentBytes=0,doneFiles=0,failed=0,busy=false,t0=0,lastB=0,lastT=0,speed=0;
async function ping(){try{const r=await fetch('/${token}/ping',{cache:'no-store'});ok(r.ok)}catch(e){ok(false)}}
function ok(on){$('dot').className='dot'+(on?'':' off');$('conn').textContent=on?'Connected':'Not reachable: is NotchMine still showing the QR code?'}
setInterval(ping,5000);
// diagnostics: each step is reported to the PC (written to NotchMine's phone-drop.log)
function log(ev,d){try{fetch('/${token}/log',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({ev:ev,t:Date.now()},d||{}))}).catch(()=>{})}catch(e){}}
window.addEventListener('error',e=>log('js-error',{msg:String(e.message),line:e.lineno}));
window.addEventListener('unhandledrejection',e=>log('js-error',{msg:String(e.reason)}));
log('page',{ua:navigator.userAgent,w:screen.width,h:screen.height});
// 'preparing' card: from the tap until the browser hands us the files (phones copy big videos first)
let prepAt=0,prepTimer=0;
function prep(on){clearInterval(prepTimer);$('prep').classList.toggle('on',on);if(on){prepAt=Date.now();$('prepT').textContent='Getting your files ready…';prepTimer=setInterval(()=>{const s=Math.round((Date.now()-prepAt)/1000);$('prepT').textContent='Getting your files ready… '+s+' s'},1000)}}
$('pick').addEventListener('click',()=>{prep(true);log('pick-open')});
$('prepX').addEventListener('click',e=>{e.preventDefault();prep(false)});
f.addEventListener('cancel',()=>{prep(false);log('pick-cancel')});
f.onchange=()=>{const files=[...f.files];const waited=Date.now()-prepAt;prep(false);
  log('picked',{n:files.length,waitedMs:waited,files:files.map(x=>({name:x.name,size:x.size,type:x.type}))});
  for(const file of files)add(file);f.value='';run()};
function add(file){
  const li=document.createElement('li');
  li.innerHTML='<div class="th"></div><div class="meta"><div class="n"></div><div class="fb"><i></i></div><div class="s"><span class="p">Waiting</span><span class="z"></span></div></div><div class="st">⏳</div>';
  li.querySelector('.n').textContent=file.name;li.querySelector('.z').textContent=size(file.size);
  // thumbnails only for small photos: loading big videos into a player can freeze phone browsers
  const th=li.querySelector('.th');
  if(file.type.startsWith('image/')&&file.size<15*1048576)th.style.backgroundImage='url('+URL.createObjectURL(file)+')';
  else th.textContent=file.type.startsWith('video/')?'🎬':file.type.startsWith('image/')?'🖼️':'📄';
  l.appendChild(li);queue.push({file,li});totalBytes+=file.size;
  $('total').classList.add('on');$('total').classList.remove('done');
}
function overall(){
  const pct=totalBytes?Math.min(100,sentBytes/totalBytes*100):0;
  $('tbar').style.width=pct+'%';$('tpct').textContent=Math.round(pct)+'%';
  const all=queue.length+doneFiles+(busy?1:0);
  $('tcount').textContent=busy&&pausedNow?'Paused, reconnecting… it will continue by itself':busy?('Sending '+(doneFiles+1)+' of '+all):(failed?doneFiles+' sent, '+failed+' failed':'All '+doneFiles+' sent ✓');
  $('tsize').textContent=size(sentBytes)+' of '+size(totalBytes);
  $('tspeed').textContent=busy&&speed>0?size(speed)+'/s · '+dur((totalBytes-sentBytes)/speed):'';
}
async function run(){
  if(busy)return;busy=true;t0=t0||performance.now();try{navigator.wakeLock&&navigator.wakeLock.request('screen').catch(()=>{})}catch(e){}
  while(queue.length){const j=queue.shift();await up(j.file,j.li)}
  busy=false;overall();if(!failed)$('total').classList.add('done');
}
const CHUNK=8*1048576;let pausedNow=false;
const wait=ms=>new Promise(r=>{let t;const done=()=>{clearTimeout(t);document.removeEventListener('visibilitychange',vis);window.removeEventListener('online',done);r()};const vis=()=>{if(!document.hidden)done()};t=setTimeout(done,ms);document.addEventListener('visibilitychange',vis);window.addEventListener('online',done)});
function call(method,p,body,onprog){return new Promise((res,rej)=>{const x=new XMLHttpRequest();x.open(method,'/${token}/'+p);x.timeout=180000;
  if(onprog)x.upload.onprogress=e=>{if(e.lengthComputable)onprog(e.loaded)};
  x.onload=()=>{let j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===200||x.status===409)res({code:x.status,j});else rej(new Error('HTTP '+x.status))};
  x.onerror=()=>rej(new Error('network'));x.ontimeout=()=>rej(new Error('timeout'));x.send(body||null)})}
function paused(li,on,why){pausedNow=on;const p=li.querySelector('.p');if(on){p.textContent='Paused ('+(why||'connection')+'), retrying…';p.classList.add('err-line');li.querySelector('.st').textContent='⏸'}else{p.classList.remove('err-line');li.querySelector('.st').textContent='⬆'}overall()}
async function up(file,li){
  const base=sentBytes,p=li.querySelector('.p'),bar=li.querySelector('.fb i'),st=li.querySelector('.st');
  const show=done=>{sentBytes=base+done;const pct=file.size?done/file.size*100:100;bar.style.width=pct+'%';p.textContent=Math.round(pct)+'%';
    const now=performance.now();if(now-lastT>400){const s=(sentBytes-lastB)/((now-lastT)/1000);if(s>=0)speed=speed?speed*.6+s*.4:s;lastB=sentBytes;lastT=now}overall()};
  lastB=base;lastT=performance.now();st.textContent='⬆';p.textContent='Starting…';
  let id=null,off=0,tries=0;
  while(true){
    try{
      if(!id){const r=await call('POST','begin?name='+encodeURIComponent(file.name)+'&size='+file.size);if(!r.j.id)throw new Error('begin refused ('+r.code+')');id=r.j.id;log('begin',{name:file.name,size:file.size})}
      if(off>=file.size){p.textContent='Finishing…';const r=await call('POST','finish?id='+id);if(r.code===200){log('finish',{name:file.name});break}off=r.j.received;continue}
      const from=off,end=Math.min(file.size,off+CHUNK);
      const r=await call('POST','chunk?id='+id+'&offset='+from,file.slice(from,end),n=>show(from+n));
      off=r.j.received;show(off);tries=0;if(pausedNow)paused(li,false);ok(true);
    }catch(e){
      log('piece-failed',{name:file.name,off:off,err:String(e.message||e),try:tries+1,hidden:document.hidden});
      if(++tries>60){failed++;sentBytes=base+file.size;li.classList.add('err');st.textContent='!';p.textContent='Failed: '+(e.message||'lost connection');pausedNow=false;overall();log('gave-up',{name:file.name,off:off});return}
      ok(false);paused(li,true,(e.message||'connection')+(tries>1?', try '+tries:''));
      await wait(Math.min(10000,800*tries));
      if(id){try{const r=await call('GET','status?id='+id);off=r.j.received;show(off)}catch(e2){}}
    }
  }
  doneFiles++;sentBytes=base+file.size;li.classList.add('ok');bar.style.width='100%';st.textContent='✓';p.textContent='Sent';overall();
}</script></body></html>`;
}

// diagnostics log (phone-drop.log): what the phone did and what the PC saw, to find where big transfers stall
let logFile = null;
function logLine(src, obj) {
  if (!logFile) return;
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) fs.renameSync(logFile, logFile + '.old');
    fs.appendFileSync(logFile, `${new Date().toISOString()} [${src}] ${JSON.stringify(obj)}\n`);
  } catch { /* ignore */ }
}

async function start({ destDir, onFile, onStatus, log }) {
  if (server) return state;
  hooks = { onFile, onStatus };
  logFile = log || null;
  const lan = lanAddress();
  if (!lan) { state = { running: false, error: 'Not connected to a local network (Wi-Fi or Ethernet).' }; return state; }
  fs.mkdirSync(destDir, { recursive: true });
  const token = crypto.randomBytes(16).toString('hex');
  let received = 0;
  const info = { pc: os.hostname(), network: lan.name };
  // live "receiving…" progress for the PC side (throttled)
  let progAt = 0;
  const progress = p => {
    const now = Date.now();
    if (p && now - progAt < 250) return;
    progAt = now;
    state.receiving = p;
    hooks.onStatus && hooks.onStatus({ ...state });
  };

  // Uploads are chunked and resumable: begin → chunk (8 MB pieces, each says where it starts) → finish.
  // If the phone's screen turns off or Wi-Fi blips, the phone asks how much arrived and carries on.
  const incoming = path.join(destDir, '.incoming');
  fs.mkdirSync(incoming, { recursive: true });
  sessions = new Map();               // id → { name, size, part, received, started, lastAt }
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== token) { res.writeHead(404); res.end(); return; }
    touch();
    const op = parts[1] || '';
    if (req.method === 'GET' && !op) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page(token, info));
      return;
    }
    if (req.method === 'GET' && op === 'ping') return json(res, 200, { ok: true });

    if (req.method === 'POST' && op === 'log') {                 // the phone page reporting what it's doing
      let body = '';
      req.on('data', c => { if (body.length < 16384) body += c; });
      req.on('end', () => {
        let o; try { o = JSON.parse(body); } catch { o = { raw: body.slice(0, 500) }; }
        o.from = req.socket.remoteAddress;
        logLine('phone', o);
        json(res, 200, { ok: true });
      });
      return;
    }

    if (req.method === 'POST' && op === 'begin') {
      const size = Number(url.searchParams.get('size'));
      if (!Number.isFinite(size) || size < 0) return json(res, 400, { error: 'size' });
      if (size > MAX_BYTES) return json(res, 413, { error: 'too big' });
      const id = crypto.randomBytes(8).toString('hex');
      const part = path.join(incoming, id + '.part');
      fs.writeFileSync(part, '');
      sessions.set(id, { name: safeName(url.searchParams.get('name')), size, part, received: 0, started: Date.now(), lastAt: Date.now() });
      logLine('pc', { ev: 'begin', id, name: safeName(url.searchParams.get('name')), size });
      return json(res, 200, { id });
    }

    const s = sessions.get(url.searchParams.get('id') || '');
    if ((op === 'chunk' || op === 'status' || op === 'finish') && !s) return json(res, 404, { error: 'unknown upload' });

    if (req.method === 'GET' && op === 'status') return json(res, 200, { received: s.received, size: s.size });

    if (req.method === 'POST' && op === 'chunk') {
      const offset = Number(url.searchParams.get('offset'));
      const len = Number(req.headers['content-length'] || 0);
      if (s.busy) { logLine('pc', { ev: 'piece-while-busy', name: s.name, offset, have: s.received }); req.resume(); return json(res, 409, { received: s.received }); }
      if (offset !== s.received) { logLine('pc', { ev: 'piece-offset-mismatch', name: s.name, offset, have: s.received }); req.resume(); return json(res, 409, { received: s.received }); }
      if (len > CHUNK_MAX || offset + len > s.size) { logLine('pc', { ev: 'piece-too-big', name: s.name, offset, len }); req.resume(); return json(res, 413, { received: s.received }); }
      s.busy = true;
      const out = fs.createWriteStream(s.part, { flags: 'r+', start: offset });
      let got = 0;
      req.on('data', c => {
        got += c.length;
        s.lastAt = Date.now();
        touch();                                                                 // a long transfer is not "idle"
        const secs = (Date.now() - s.started) / 1000;
        progress({ name: s.name, bytes: s.received + got, total: s.size, speed: secs > 0.5 ? (s.received + got) / secs : 0 });
      });
      req.pipe(out);
      out.on('finish', () => {
        s.busy = false;
        if (got === len) s.received += got;                                     // only whole pieces count
        else { fs.truncate(s.part, s.received, () => {}); logLine('pc', { ev: 'piece-short', name: s.name, offset, got, len }); }
        json(res, 200, { received: s.received });
      });
      const broke = () => {
        if (!s.busy) return;
        s.busy = false; out.destroy(); fs.truncate(s.part, s.received, () => {});
        logLine('pc', { ev: 'piece-broken', name: s.name, offset, got, len, have: s.received });
      };
      req.on('aborted', broke);
      req.on('error', broke);
      out.on('error', () => { s.busy = false; if (!res.headersSent) json(res, 500, { received: s.received }); });
      return;
    }

    if (req.method === 'POST' && op === 'finish') {
      if (s.received !== s.size) return json(res, 409, { received: s.received });
      const dest = uniquePath(destDir, s.name);
      fs.rename(s.part, dest, err => {
        if (err) return json(res, 500, { error: 'save failed' });
        sessions.delete(url.searchParams.get('id'));
        logLine('pc', { ev: 'saved', name: path.basename(dest), size: s.size, secs: Math.round((Date.now() - s.started) / 1000) });
        received++;
        state.received = received;
        progAt = 0;
        progress(null);
        hooks.onFile && hooks.onFile(dest);
        json(res, 200, { ok: true, name: path.basename(dest) });
      });
      return;
    }
    res.writeHead(405); res.end();
  });
  server.requestTimeout = 0;            // big pieces over slow Wi-Fi must never be cut off by a timer
  server.keepAliveTimeout = 30000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', resolve);
  }).catch(err => { server = null; state = { running: false, error: err.message }; });
  if (!server) return state;

  const url = `http://${lan.address}:${server.address().port}/${token}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#000000', light: '#ffffff' } });
  state = { running: true, url, qr, network: lan.name, pc: info.pc, received: 0, folder: destDir, receiving: null };
  touch();
  return state;
}

function stop(reason) {
  clearTimeout(idleTimer);
  if (server) { try { server.close(); server.closeAllConnections?.(); } catch { /* ignore */ } }
  server = null;
  // throw away half-finished uploads
  for (const s of (sessions || new Map()).values()) { logLine('pc', { ev: 'discarded-unfinished', name: s.name, have: s.received, size: s.size }); fs.rm(s.part, () => {}); }
  logLine('pc', { ev: 'stopped', reason: reason || 'closed' });
  sessions = null;
  state = { running: false, stoppedBecause: reason || 'closed' };
  hooks.onStatus && hooks.onStatus({ ...state });
  return state;
}

module.exports = { start, stop, status: () => state, __page: page };

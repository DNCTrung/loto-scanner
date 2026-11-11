import {
  makeCard, normalizeRows, validateCard, isCardComplete, isMarked, evaluateCard,
  parseCallInput, calledSet, cardNumbers, lastCalled, uid, RULES, HEADERS,
} from './lib.js';

const KEY = 'loto-scanner-state-v1';
let state = load();
let view = state.cards.length ? 'home' : 'add';
let editingId = null;
let ocrPreview = '';

function load() {
  try {
    const x = JSON.parse(localStorage.getItem(KEY));
    return { cards: Array.isArray(x?.cards) ? x.cards.map(c => ({...c, grid: normalizeRows(c.grid)})) : [], called: Array.isArray(x?.called) ? x.called : [], rule: x?.rule || 'line' };
  } catch { return { cards: [], called: [], rule: 'line' }; }
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
function esc(x) { return String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(msg) { const el = document.querySelector('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }
function render() { document.querySelector('#app').innerHTML = view === 'play' ? playView() : view === 'add' ? addView() : homeView(); bind(); }
function header(title, back = 'home') { return `<div class="play-top"><button class="ghost small" data-action="view" data-view="${back}">← Quay lại</button><strong>${esc(title)}</strong><span></span></div>`; }
function grid(card, called, compact = false, highlight = []) { const set = calledSet(called); return `<div class="grid ${compact ? 'compact' : ''}">${card.flatMap((row,r) => row.map((n,c) => `<div class="cell ${n === null ? 'free' : ''} ${isMarked(card,r,c,set) ? 'marked' : ''} ${highlight.some(([rr,cc]) => rr===r&&cc===c) ? 'on-line' : ''} ${n === lastCalled(called) ? 'last' : ''}">${n === null ? 'FREE' : esc(n)}</div>`)).join('')}</div>`; }
function homeView() {
  return `<section class="hero"><h1>🎱 Loto Scanner</h1><p>Chụp vé, lưu trên máy này, rồi nhập số được gọi để tự highlight.</p></section>
    <div class="row"><button class="primary" data-action="view" data-view="add">＋ Thêm vé</button>${state.cards.length ? `<button data-action="view" data-view="play">▶ Bắt đầu chơi</button>` : ''}</div><div class="spacer"></div>
    ${state.cards.length ? `<ul class="card-list">${state.cards.map((c,i) => `<li class="card-box"><div class="card-head"><span class="card-title">${esc(c.name || `Vé ${i+1}`)}</span><span class="card-sub">${cardNumbers(c.grid).length}/24 số</span></div>${grid(c.grid,state.called,true)}<div class="row" style="margin-top:10px"><button class="small" data-action="edit" data-id="${c.id}">Sửa</button><button class="small danger" data-action="delete" data-id="${c.id}">Xóa</button></div></li>`).join('')}</ul>` : `<div class="empty card-box"><div class="big">📸</div><div>Chưa có vé nào</div><p>Thêm vé bằng cách chụp ảnh hoặc nhập số tay.</p></div>`}
    <p class="footer-note">Dữ liệu hiện lưu cục bộ trên thiết bị/trình duyệt.</p>`;
}
function addView() {
  const card = editingId ? state.cards.find(c => c.id === editingId)?.grid : normalizeRows(Array.from({ length: 5 }, () => Array(5).fill(null)));
  const title = editingId ? 'Sửa vé' : 'Thêm vé mới';
  return `${header(title)}<div class="card-box"><h2>Nhập bằng ảnh</h2><div class="dropzone" id="dropzone">📷 Chọn hoặc chụp ảnh vé<br><small>AI sẽ đọc bảng 5×5, pa kiểm tra lại trước khi lưu</small><input id="photo" type="file" accept="image/*" capture="environment" hidden></div><img id="preview" class="preview" ${ocrPreview ? `src="${ocrPreview}"` : 'hidden'} /><div class="row"><button data-action="choose">Chọn ảnh / chụp</button><button data-action="ocr" id="ocr-btn" ${ocrPreview ? '' : 'disabled'}>Đọc vé bằng AI</button></div></div>
    <div class="card-box"><h2>Số trên vé</h2><input id="card-name" class="grow" placeholder="Tên vé (tuỳ chọn)" value="${esc(editingId ? state.cards.find(c=>c.id===editingId)?.name : '')}" style="width:100%;margin-bottom:12px;padding:11px;border-radius:10px;background:var(--bg-2);border:1px solid var(--line);color:var(--text);font:inherit"/><div class="col-heads">${HEADERS.map(x=>`<span>${x}</span>`).join('')}</div><div class="edit-grid">${card.flatMap((row,r)=>row.map((n,c)=>`<input ${r===2&&c===2?'class="free" readonly value="FREE"':'type="number" min="1" max="75" inputmode="numeric" value="'+(n ?? '')+'"'} data-r="${r}" data-c="${c}" />`)).join('')}</div><div class="errors" id="errors"></div><div class="row" style="margin-top:12px"><button class="primary grow" data-action="save-card">${editingId ? 'Lưu thay đổi' : 'Lưu vé'}</button></div></div>`;
}
function playView() {
  const set = calledSet(state.called), last = lastCalled(state.called);
  return `${header('Đang chơi', 'home')}<div class="last-called"><div class="num">${last ?? '—'}</div><div><div class="lbl">Số vừa gọi</div><div class="sub">Đã gọi ${state.called.length} số</div></div></div><form class="call-form" id="call-form"><input id="call" type="number" min="1" max="75" placeholder="Nhập số 1–75" autofocus/><button class="primary">Gọi số</button></form><div class="card-box"><h2>Bảng số</h2><div class="board">${Array.from({length:75},(_,i)=>i+1).map(n=>`<button class="${set.has(n)?'called':''}" data-action="call-number" data-number="${n}">${n}</button>`).join('')}</div><div class="row"><label class="grow">Luật thắng<br><select id="rule">${Object.values(RULES).map(r=>`<option value="${r.id}" ${state.rule===r.id?'selected':''}>${r.label}</option>`).join('')}</select></label><button class="danger" data-action="reset-called">Xóa số đã gọi</button></div></div>${state.cards.map(c=>{const e=evaluateCard(c.grid,set,state.rule);const win=e.wins.length;return `<div class="card-box"><div class="card-head"><span class="card-title">${esc(c.name||'Vé')}</span><span class="badge ${win?'win':''}">${win?'🎉 THẮNG':'Tốt nhất '+e.progress.best+'/5'}</span></div>${grid(c.grid,state.called,false,e.progress.line?.cells.filter(x=>x.marked).map(x=>[x.r,x.c])||[])}${win?`<div class="win-banner">🎉 Chúc mừng! ${e.wins.map(x=>x.name).join(', ')} đã đủ.</div>`:''}</div>`}).join('')}`;
}
function readInputs() { const card = Array.from({length:5},(_,r)=>Array.from({length:5},(_,c)=>{const el=document.querySelector(`[data-r="${r}"][data-c="${c}"]`); return r===2&&c===2 ? null : (el?.value ? Number(el.value) : null);})); return makeCard(card); }
function validateEdit() { const errors=validateCard(readInputs()); document.querySelector('#errors').innerHTML=errors.length?`<ul>${errors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''; return errors; }
function bind() {
  document.querySelectorAll('[data-action="view"]').forEach(b=>b.onclick=()=>{view=b.dataset.view; editingId=null; ocrPreview=''; render();});
  document.querySelectorAll('[data-action="edit"]').forEach(b=>b.onclick=()=>{editingId=b.dataset.id;view='add';render();});
  document.querySelectorAll('[data-action="delete"]').forEach(b=>b.onclick=()=>{if(confirm('Xóa vé này?')){state.cards=state.cards.filter(c=>c.id!==b.dataset.id);save();render();}});
  document.querySelector('[data-action="choose"]')?.addEventListener('click',()=>document.querySelector('#photo').click());
  document.querySelector('#photo')?.addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;ocrPreview=URL.createObjectURL(f);document.querySelector('#preview').src=ocrPreview;document.querySelector('#preview').hidden=false;document.querySelector('#ocr-btn').disabled=false;document.querySelector('#ocr-btn').dataset.file='1';});
  document.querySelector('#ocr-btn')?.addEventListener('click',async()=>{const file=document.querySelector('#photo').files[0];if(!file)return;const btn=document.querySelector('#ocr-btn');btn.disabled=true;btn.innerHTML='<span class="spin"></span>Đang đọc…';try{const res=await fetch('/api/ocr',{method:'POST',headers:{'content-type':file.type},body:file});const data=await res.json();if(!res.ok)throw Error(data.error||'OCR lỗi');data.rows.flatMap((row,r)=>row.map((n,c)=>{const el=document.querySelector(`[data-r="${r}"][data-c="${c}"]`);if(el&&!el.readOnly)el.value=n??'';}));validateEdit();toast('Đã đọc xong, kiểm tra lại số nha pa');}catch(e){toast(e.message)}finally{btn.disabled=false;btn.textContent='Đọc vé bằng AI';}});
  document.querySelectorAll('.edit-grid input').forEach(i=>i.addEventListener('input',validateEdit));
  document.querySelector('[data-action="save-card"]')?.addEventListener('click',()=>{const errors=validateEdit();if(errors.length)return toast('Còn lỗi, kiểm tra lại vé nha');const card=readInputs();const name=document.querySelector('#card-name').value.trim();if(editingId){const c=state.cards.find(x=>x.id===editingId);c.grid=card;c.name=name;}else state.cards.push({id:uid(),name,grid:card});save();view='home';editingId=null;ocrPreview='';render();toast('Đã lưu vé');});
  document.querySelector('#call-form')?.addEventListener('submit',e=>{e.preventDefault();call(document.querySelector('#call').value);});
  document.querySelectorAll('[data-action="call-number"]').forEach(b=>b.onclick=()=>call(b.dataset.number));
  document.querySelector('[data-action="reset-called"]')?.addEventListener('click',()=>{if(confirm('Xóa toàn bộ số đã gọi?')){state.called=[];save();render();}});
  document.querySelector('#rule')?.addEventListener('change',e=>{state.rule=e.target.value;save();render();});
}
function call(raw) { const n=parseCallInput(raw); if(!n)return toast('Nhập số từ 1 đến 75');if(state.called.includes(n))return toast(`Số ${n} đã gọi rồi`);state.called.push(n);save();render(); }
render();

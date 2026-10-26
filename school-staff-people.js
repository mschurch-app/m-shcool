/* School personnel only. The API validates the authenticated school manager. */
(() => {
  'use strict';
  const dialog=document.createElement('dialog');
  dialog.id='school-staff-people';dialog.className='school-sheet school-staff-people';
  dialog.setAttribute('aria-labelledby','school-staff-people-title');
  dialog.innerHTML=`<div class="school-sheet-heading"><h2 id="school-staff-people-title">老師與工讀生管理</h2><button type="button" class="school-close" data-staff-close aria-label="關閉人員管理">×</button></div>
  <div class="school-sheet-body"><p class="school-form-note">僅管理課輔人員資料。新增人員不會建立教會 OS 帳號或授予登入權限。刪除會移至已刪除名單，保留班表與出勤紀錄；恢復人員不會自動恢復登入。</p>
  <p id="school-staff-status" role="status" aria-live="polite"></p>
  <div class="school-staff-toolbar"><label for="school-staff-search">搜尋姓名或編號<input id="school-staff-search" type="search" autocomplete="off"></label><label><input id="school-staff-archived" type="checkbox">顯示已刪除／離職</label><button type="button" data-staff-reload class="school-secondary">重新載入名單</button><button type="button" data-staff-new class="school-primary">新增人員</button></div>
  <div class="school-staff-columns"><section aria-label="老師與工讀生名單"><div id="school-staff-list"></div></section>
  <form id="school-staff-form"><h3 id="school-staff-form-title">新增人員</h3>
  <p id="school-staff-number">人員編號由系統自動編列</p>
  <label for="school-staff-name">姓名（必填）</label><input id="school-staff-name" name="name" required maxlength="80" autocomplete="name">
  <label for="school-staff-role">課輔類別</label><select id="school-staff-role" name="role_type"><option value="工讀生">工讀生</option><option value="老師">老師</option></select>
  <label for="school-staff-phone">電話（選填）</label><input id="school-staff-phone" name="phone" type="tel" maxlength="80" autocomplete="tel">
  <label for="school-staff-address">地址（選填）</label><input id="school-staff-address" name="address" maxlength="300" autocomplete="street-address">
  <label for="school-staff-note">備註（選填）</label><textarea id="school-staff-note" name="note" maxlength="2000" rows="3"></textarea>
  <label for="school-staff-person-status">人員狀態</label><select id="school-staff-person-status" name="status"><option value="在職">在職</option><option value="在班">在班（既有狀態）</option><option value="離職">離職／已刪除</option></select>
  <p class="school-form-note">編輯課輔類別不會變更登入角色；登入權限由既有管理流程另行核定。</p>
  <div class="school-actions"><button type="submit" class="school-primary" id="school-staff-save">新增並儲存</button><button type="button" data-staff-delete class="school-secondary" hidden>刪除此人員</button></div></form></div></div>`;
  document.body.append(dialog);
  const $=id=>document.getElementById('school-staff-'+id);
  const api=()=>window.schoolInterface.staffPeople;
  let rows=[],selected=null,dirty=false,busy=false,loading=false,loaded=false,pending=null,generation=0;
  const allowed=()=>api()?.allowed();
  const say=message=>{$('status').textContent=message;};
  const clearDirty=()=>{dirty=false;window.SchoolUI?.clearDraft('school-staff-form');window.SchoolUI?.clearDraft(dialog.id);};
  async function leave(){if(busy||loading){say('正在處理，請稍候。');return false;}return !dirty||await window.SchoolUI.confirm('尚有未儲存的人員資料。要放棄修改嗎？');}
  function reset(person=null){selected=person;pending=null;const form=$('form');form.reset();
    for(const key of ['name','phone','address','note'])form.elements[key].value=person?.[key]||'';
    form.elements.role_type.value=person?.role_type||'工讀生';form.elements.status.value=person?.status||'在職';
    $('form-title').textContent=person?'編輯課輔人員':'新增課輔人員';$('number').textContent=person?`編號：${person.id}`:'人員編號由系統自動編列';
    $('save').textContent=person?'儲存修改':'新增並儲存';dialog.querySelector('[data-staff-delete]').hidden=!person||person.status==='離職';clearDirty();lock();}
  function lock(){for(const el of dialog.querySelectorAll('input,select,textarea,button'))el.disabled=busy||loading;
    if(!loaded)for(const el of $('form').elements)el.disabled=true;
    if(selected?.editable===false)for(const el of $('form').elements)el.disabled=true;}
  function render(){const box=$('list');box.replaceChildren();const q=$('search').value.trim().toLocaleLowerCase();
    const found=rows.filter(r=>($('archived').checked||r.status!=='離職')&&`${r.name} ${r.id}`.toLocaleLowerCase().includes(q));
    for(const person of found){const button=document.createElement('button');button.type='button';button.className='school-staff-person';button.disabled=busy||loading||!loaded;
      const title=document.createElement('strong'),detail=document.createElement('small');title.textContent=person.name;detail.textContent=`${person.id} · ${person.role_type} · ${person.status==='離職'?'已刪除／離職':person.status||'在職'}`;
      button.append(title,detail);button.setAttribute('aria-pressed',String(selected?.id===person.id));button.addEventListener('click',async()=>{if(await leave()){reset(person);render();if(!person.editable)say('此人員有課輔管理角色，請使用既有管理權限設定。');}});box.append(button);}
    if(!found.length){const p=document.createElement('p');p.textContent=loaded?'沒有符合的人員。':'尚未載入名單。';box.append(p);}}
  async function load(){const seq=++generation;loading=true;loaded=false;say('正在載入老師與工讀生…');lock();
    try{const data=await api().request('/staff-people');if(seq!==generation||!allowed())return;rows=data;loaded=true;render();say(`已載入 ${rows.filter(r=>r.status!=='離職').length} 位在職人員。`);}
    catch(error){if(seq===generation)say(`名單載入失敗：${error.message}。請按「重新載入名單」。`);}
    finally{if(seq===generation){loading=false;lock();render();}}}
  async function open(){if(!allowed())return;window.schoolInterface.navigate('schedules');reset();dialog.showModal();await load();}
  async function close(){if(await leave()){clearDirty();dialog.close();}}
  async function save(action){if(busy||loading||!loaded||!allowed()||selected?.editable===false)return;
    const form=$('form');if(action!=='delete'&&!form.reportValidity())return;
    if(action==='delete'&&(!selected||!await window.SchoolUI.confirm(`刪除「${selected.name}」？人員會移出可排班名單，保留歷史班表與出勤；課輔登入會停用，其他模組權限不變。`)))return;
    const input=action==='delete'?{}:Object.fromEntries(new FormData(form));input.name=action==='delete'?undefined:String(input.name||'').trim();if(action==='delete')delete input.name;
    const payload={action,id:selected?.id||null,input,expected:selected?.version||null};const fingerprint=JSON.stringify(payload);
    if(pending&&pending.fingerprint!==fingerprint){say('上次儲存結果尚未確認。請先重試原內容，或重新載入名單核對。');return;}
    pending??={fingerprint,request_id:crypto.randomUUID()};busy=true;lock();say(action==='delete'?'正在刪除，請稍候…':'正在儲存，請稍候…');
    try{await api().request('/staff-people',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,request_id:pending.request_id})});pending=null;clearDirty();busy=false;
      reset();await load();try{await api().refresh();say(action==='delete'?'已刪除，歷史紀錄已保留。':'已儲存，排班人員名單已更新。');}catch{say('人員資料已儲存；排班名單更新失敗，請關閉視窗後重新載入排班。');}}
    catch(error){if([400,401,403,409].includes(error.status))pending=null;say(`操作尚未確認：${error.message}。已保留輸入；網路中斷時可按同一按鈕重試。`);}
    finally{busy=false;lock();render();}}
  $('form').addEventListener('submit',event=>{event.preventDefault();save(selected?'update':'create');});
  $('form').addEventListener('input',()=>{dirty=true;});$('form').addEventListener('change',()=>{dirty=true;});
  $('search').addEventListener('input',render);$('archived').addEventListener('change',render);
  dialog.querySelector('[data-staff-close]').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.querySelector('[data-staff-new]').addEventListener('click',async()=>{if(await leave()){reset();render();say('填寫姓名與課輔類別後儲存。');}});
  dialog.querySelector('[data-staff-delete]').addEventListener('click',()=>save('delete'));
  dialog.querySelector('[data-staff-reload]').addEventListener('click',async()=>{if(await leave()){reset();await load();}});
  function sync(){const entry=document.getElementById('btn-school-staff-people');if(entry)entry.hidden=!allowed();
    if(!allowed()){generation++;loading=false;loaded=false;rows=[];selected=null;pending=null;clearDirty();$('form').reset();$('list').replaceChildren();if(dialog.open)dialog.close();}}
  window.SchoolStaffPeople=Object.freeze({open,sync,get busy(){return busy||loading;}});sync();
})();

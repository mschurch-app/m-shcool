/* Presentation adapter only. The existing handlers and server continue to authorize writes. */
(() => {
  'use strict';
  const roles = ['同工', '老師', '工讀生'];
  const catalog = Object.freeze([
    {key:'checkin',title:'到班打卡',description:'學生到班與同工上下班',group:'學生與到班',symbol:'check',route:'checkin',roles:['public',...roles]},
    {key:'students',title:'學生名冊',description:'基本資料、照片與夢想點數',group:'學生與到班',symbol:'student',route:'students',scope:'students',roles},
    {key:'enrollment',title:'學生建檔',description:'公共工作站拍照建檔',group:'學生與到班',symbol:'camera',href:'enrollment.html',roles:['public',...roles]},
    {key:'rollcall',title:'課堂點名',description:'出席、作業與聯絡簿',group:'課堂紀錄',symbol:'clipboard',route:'rollcall',roles},
    {key:'schedules',title:'排班行事曆',description:'查看班表與安排時段',group:'同工與排班',symbol:'calendar',route:'schedules',roles},
    {key:'staff',title:'教職同工',description:'老師、工讀生與同工名冊',group:'同工與排班',symbol:'people',route:'students',scope:'staff',roles},
    {key:'counseling',title:'個別輔導',description:'陪伴紀錄與後續追蹤',group:'關懷與聯繫',symbol:'heart',route:'counseling',roles},
    {key:'messages',title:'家長留言',description:'查看訊息與回覆家長',group:'關懷與聯繫',symbol:'chat',route:'messages',roles},
    {key:'print',title:'報表與列印',description:'出席、工時、名冊與條碼卡',group:'管理工具',symbol:'printer',route:'print-center',roles:['同工']},
    {key:'import',title:'資料匯入',description:'先預覽、再確認匯入資料',group:'管理工具',symbol:'box',route:'import',roles:['同工']},
  ].map(item=>Object.freeze({...item,roles:Object.freeze(item.roles)})));
  const $ = id => document.getElementById(id);
  let user = null, activeKey = 'checkin', stack = [], scrollY = 0;
  const drafts = new Set(), bypass = new WeakSet(), inertBefore = new Map();
  const roots = () => [...document.querySelectorAll('body > [id^="modal-"], body > dialog, body > .school-overlay')];
  const visible = element => element instanceof HTMLDialogElement ? element.open : !element.classList.contains('hidden') && !element.hidden;
  const busy = () => Boolean(window.schoolInterface?.state().busy || (!$('school-main') && $('cancel')?.disabled) || ['counsel-submit-button','staff-access-save'].some(id=>$(id)?.disabled && $(id).getClientRects().length));
  const permitted = item => item.roles.includes(user?.role_type || 'public');
  const icon = (symbol, tile=false) => {
    const element=document.createElement('span');element.className=tile?'school-icon-tile':'school-symbol';element.dataset.symbol=symbol;element.setAttribute('aria-hidden','true');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('focusable','false');
    svg.innerHTML=window.SCHOOL_ICON_PATHS[symbol] || window.SCHOOL_ICON_PATHS.grid;
    if(!tile)svg.innerHTML=svg.innerHTML.replace(/fill="(#[^"]+)"/g,(_,color)=>'fill="'+(color==='#fff'?'currentColor':'var(--school-symbol-cutout,#fff)')+'"').replace(/stroke="#[^"]+"/g,'stroke="var(--school-symbol-cutout,#fff)"');
    element.append(svg);return element;
  };
  const text = (tag,value,className='') => {const element=document.createElement(tag);element.textContent=value;element.className=className;return element;};
  function featureButton(item, placement) {
    const button=document.createElement(item.href?'a':'button');if(item.href)button.href=item.href;else button.type='button';
    button.dataset.schoolFeature=item.key;button.className=placement==='tile'?'school-feature':'school-nav-item';
    button.append(icon(item.symbol,placement==='tile'),text('span',item.title));
    if(placement==='tile')button.append(text('small',item.description));
    if(item.key===activeKey)button.setAttribute('aria-current','page');
    return button;
  }
  function sync(nextUser) {
    user=nextUser||null;
    if (!$('school-main')) return;
    const desktop=$('school-desktop-nav');desktop.replaceChildren();
    for(const item of catalog.filter(permitted).filter(item=>!item.href && item.key!=='staff')) {
      const button=featureButton(item,'nav');button.id='nav-'+item.key;desktop.append(button);
    }
    // Legacy authorization UI still references these IDs even for unauthenticated users.
    for(const key of ['print','import'])if(!$('nav-'+key)){const button=document.createElement('button');button.id='nav-'+key;button.className='hidden';desktop.append(button);}
    const dock=$('mobile-bottom-dock');dock.replaceChildren();dock.setAttribute('aria-label','課輔主要導覽');
    for(const key of ['checkin','rollcall','students']){const item=catalog.find(item=>item.key===key);const button=featureButton(item,'nav');button.id='m-nav-'+key;dock.append(button);}
    const more=document.createElement('button');more.type='button';more.dataset.schoolOpenTools='';more.append(icon('grid'),text('span','更多'));more.setAttribute('aria-label','開啟功能收納盒');dock.append(more);
    const launcher=$('school-feature-launcher');launcher.hidden=!user;launcher.replaceChildren();
    launcher.append(text('p',user ? `${user.name}，今天也一起陪伴孩子成長。` : '', 'school-welcome'),text('h2','常用功能'));
    const grid=document.createElement('div');grid.className='school-feature-grid';
    for(const key of ['students','rollcall','schedules','counseling','messages','staff']){const item=catalog.find(item=>item.key===key);if(permitted(item))grid.append(featureButton(item,'tile'));}
    launcher.append(grid);
    $('school-page-bar').hidden=!user;
    renderTools();onNavigate(activeKey==='staff'?'students':(catalog.find(item=>item.key===activeKey)?.route||'checkin'));
  }
  function renderTools() {
    const query=$('school-feature-search').value.trim().toLocaleLowerCase();
    const found=catalog.filter(permitted).filter(item=>(item.title+item.description+item.group).toLocaleLowerCase().includes(query));
    const container=$('school-feature-groups');container.replaceChildren();
    for(const group of [...new Set(found.map(item=>item.group))]){
      const section=document.createElement('section');section.append(text('h3',group));const grid=document.createElement('div');grid.className='school-feature-grid';
      for(const item of found.filter(item=>item.group===group))grid.append(featureButton(item,'tile'));
      section.append(grid);container.append(section);
    }
    if(!found.length)container.append(text('p','沒有符合的功能，請換個關鍵字。','school-empty'));
  }
  function onNavigate(route) {
    if (!$('school-main')) return;
    const scope=$('user-role-scope').value;
    activeKey=route==='students'&&scope==='staff'?'staff':catalog.find(item=>item.route===route&&!item.scope)?.key || (route==='students'?'students':route);
    const item=catalog.find(item=>item.key===activeKey);
    if(item){$('school-page-title').textContent=item.title;$('school-page-group').textContent=item.group;document.title=`${item.title} · M+ 課輔`;}
    for(const button of document.querySelectorAll('[data-school-feature]')){
      if(button.dataset.schoolFeature===activeKey)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    }
    $('m-nav-students')?.toggleAttribute('data-current',route==='students');
  }
  function dirtyOwner(element) {return element.closest('[id^="modal-"], #tab-rollcall, #tab-import, #student-form, #device-form');}
  function clearDraft(id) {drafts.delete(id);}
  async function allowLeave(owner) {
    if(busy()){notify('正在處理，請稍候。');return false;}
    if(!owner || !drafts.has(owner.id))return true;
    const accepted=await question('尚有未儲存的修改。要放棄修改並離開嗎？',false,'放棄修改');
    if(accepted)drafts.delete(owner.id);return accepted;
  }
  async function navigate(key) {
    const item=catalog.find(item=>item.key===key);if(!item||!permitted(item))return;
    const panel=document.querySelector('main > [id^="tab-"]:not(.hidden)');
    if(!await allowLeave(panel))return;
    $('school-tools').close();
    if(item.href){location.assign(item.href);return;}
    if(item.scope)window.schoolInterface.roster(item.scope);else window.schoolInterface.navigate(item.route);
    window.scrollTo({top:0,behavior:'auto'});
  }
  function makeDialog(id,title) {
    const dialog=document.createElement('dialog');dialog.id=id;dialog.className='school-sheet';dialog.setAttribute('aria-labelledby',id+'-title');
    const heading=document.createElement('div');heading.className='school-sheet-heading';heading.append(text('h2',title));heading.firstChild.id=id+'-title';
    const close=text('button','×','school-close');close.type='button';close.setAttribute('aria-label','關閉'+title);close.addEventListener('click',()=>dialog.close());heading.append(close);
    const body=document.createElement('div');body.className='school-sheet-body';dialog.append(heading,body);document.body.append(dialog);return {dialog,body};
  }
  const {dialog:tools,body:toolsBody}=makeDialog('school-tools','功能收納盒');
  const searchLabel=text('label','尋找功能');searchLabel.htmlFor='school-feature-search';
  const search=document.createElement('input');search.type='search';search.id='school-feature-search';search.placeholder='例如：留言、工時、匯入';search.autocomplete='off';
  const groups=document.createElement('div');groups.id='school-feature-groups';toolsBody.append(searchLabel,search,groups);search.addEventListener('input',renderTools);
  const {dialog:recordSheet,body:recordBody}=makeDialog('school-record','紀錄');
  const {dialog:questionSheet,body:questionBody}=makeDialog('school-question','請確認');
  // This dialog is owned by the current question; one result resolves it exactly once.
  questionSheet.querySelector('.school-close').remove();
  let pendingQuestion=null;
  function question(message,withInput=false,action='確認') {
    if(pendingQuestion)return Promise.resolve(withInput?null:false);
    questionBody.replaceChildren();const description=text('p',String(message),'school-question-copy');description.id='school-question-description';questionBody.append(description);questionSheet.setAttribute('aria-describedby',description.id);
    let field;
    if(withInput){const label=text('label','請填寫內容');label.htmlFor='school-question-input';field=document.createElement('textarea');field.id='school-question-input';field.rows=4;field.maxLength=4000;field.required=true;questionBody.append(label,field);}
    const actions=document.createElement('div');actions.className='school-actions';const cancel=text('button','取消','school-secondary'),confirm=text('button',action,'school-primary');cancel.type=confirm.type='button';actions.append(cancel,confirm);questionBody.append(actions);
    return new Promise(resolve=>{
      pendingQuestion=value=>{pendingQuestion=null;questionSheet.close();resolve(value);};
      cancel.onclick=()=>pendingQuestion?.(withInput?null:false);
      confirm.onclick=()=>{if(field&&!field.value.trim()){field.setCustomValidity('請填寫內容。');field.reportValidity();return;}pendingQuestion?.(field?field.value:true);};
      if(field)field.oninput=()=>field.setCustomValidity('');
      questionSheet.showModal();refreshModals();(field||cancel).focus();
    });
  }
  questionSheet.addEventListener('cancel',event=>{event.preventDefault();pendingQuestion?.(questionBody.querySelector('textarea')?null:false);});
  function record(title,message) {$('school-record-title').textContent=title;recordBody.replaceChildren();for(const line of String(message).split('\n'))recordBody.append(text('p',line,'school-record-row'));recordSheet.showModal();refreshModals();}
  const live=document.createElement('div');live.id='school-feedback';live.setAttribute('aria-live','polite');live.setAttribute('aria-atomic','true');document.body.append(live);
  let toastTimer;
  function notify(message) {
    const value=String(message).replace(/^[✅⛔]\s*/u,'');
    const error=/失敗|無法|不足|未確認|錯誤|中斷|請先|尚未/.test(value);
    const top=stack.at(-1)?.element;const target=top?.querySelector('form')||null;
    if(target){let status=target.querySelector('.school-form-status');if(!status){status=text('div','','school-form-status');target.prepend(status);}status.textContent=value;status.dataset.tone=error?'error':'info';status.setAttribute('role',error?'alert':'status');}
    live.textContent=value;live.dataset.tone=error?'error':'info';live.classList.add('is-visible');clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>live.classList.remove('is-visible'),error?10000:5000);
  }
  const focusables=element=>[...element.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter(item=>!item.disabled && item.getClientRects().length && !item.closest('[hidden],.hidden'));
  function restoreInert(){for(const [element,old] of inertBefore)element.inert=old;inertBefore.clear();}
  function refreshModals() {
    const open=roots().filter(visible);const removed=stack.filter(entry=>!open.includes(entry.element));stack=stack.filter(entry=>open.includes(entry.element));
    for(const entry of removed)drafts.delete(entry.element.id);
    for(const element of open)if(!stack.some(entry=>entry.element===element)){
      const entry={element,returnFocus:document.activeElement};stack.push(entry);
      element.setAttribute('role','dialog');element.setAttribute('aria-modal','true');
      const heading=element.querySelector('h2,h3');if(heading){if(!heading.id)heading.id=element.id+'-heading';element.setAttribute('aria-labelledby',heading.id);}
      queueMicrotask(()=>{if(stack.at(-1)===entry&&!element.contains(document.activeElement))(focusables(element)[0]||element).focus();});
    }
    restoreInert();
    if(stack.length){
      if(!document.body.classList.contains('school-modal-open')){scrollY=window.scrollY;document.body.style.top=`-${scrollY}px`;document.body.classList.add('school-modal-open');}
      const top=stack.at(-1).element;
      for(const child of document.body.children){if(child===top||child.contains(top)||child.id==='school-feedback'||child.tagName==='SCRIPT')continue;inertBefore.set(child,child.inert);child.inert=true;}
      stack.forEach((entry,index)=>entry.element.style.zIndex=String(80+index*10));
    }else if(document.body.classList.contains('school-modal-open')){document.body.classList.remove('school-modal-open');document.body.style.top='';window.scrollTo(0,scrollY);}
    if(removed.length){const top=stack.at(-1)?.element;const prior=removed.at(-1).returnFocus;if(prior?.isConnected&&(!top||top.contains(prior)))prior.focus();else if(top)focusables(top)[0]?.focus();}
  }
  document.addEventListener('keydown',event=>{
    const top=stack.at(-1)?.element;if(!top)return;
    if(event.key==='Escape'&&top!==questionSheet){event.preventDefault();event.stopImmediatePropagation();if(busy()){notify('正在處理，請稍候。');return;}
      const close=top.querySelector('.school-close,button[onclick^="close"],button[onclick="closeStaffAccess()"]');if(close)close.click();else if(top instanceof HTMLDialogElement)top.close();
    }
    if(event.key==='Tab'){const nodes=focusables(top);const first=nodes[0],last=nodes.at(-1);if(!first){event.preventDefault();return;}if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  },true);
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button,a');if(!button)return;
    if(button.hasAttribute('data-school-open-tools')){event.preventDefault();renderTools();tools.showModal();refreshModals();search.focus();return;}
    if(button.dataset.schoolFeature){event.preventDefault();event.stopImmediatePropagation();await navigate(button.dataset.schoolFeature);return;}
    if(bypass.has(button)){bypass.delete(button);return;}
    if (!$('school-main')) {
      const form=$('student-form');
      if(form && !form.hidden && (button.matches('#cancel,#new,#lock,#finish,#students button') || button.matches('a[href]')) && (drafts.has(form.id)||busy())) {
        event.preventDefault();event.stopImmediatePropagation();if(await allowLeave(form)){bypass.add(button);button.click();}return;
      }
    }
    const owner=button.closest('[id^="modal-"]');const isClose=/^(close|cancel)/.test(button.getAttribute('onclick')||'');
    const href=button.getAttribute('href');const panel=href&&!href.startsWith('#')?document.querySelector('main > [id^="tab-"]:not(.hidden)'):null;
    if((isClose&&owner&&(busy()||drafts.has(owner.id)))||(panel&&drafts.has(panel.id))){event.preventDefault();event.stopImmediatePropagation();if(await allowLeave(owner||panel)){bypass.add(button);button.click();}}
  },true);
  document.addEventListener('change',async event=>{
    if(event.target.id!=='rollcall-date-picker'||!drafts.has('tab-rollcall'))return;
    event.stopImmediatePropagation();const chosen=event.target.value,prior=window.schoolInterface.state().rollCallDate;
    event.target.value=prior||chosen;
    if(await allowLeave($('tab-rollcall')))await window.schoolInterface.reloadRollCall(chosen);
  },true);
  for(const name of ['input','change'])document.addEventListener(name,event=>{
    if(!event.isTrusted)return;const owner=dirtyOwner(event.target);
    if(owner?.id==='tab-rollcall'&&!event.target.hasAttribute('data-rc-field'))return;
    if(owner)drafts.add(owner.id);
  });
  document.addEventListener('click',event=>{if(event.target.closest('[id^=rollcall-batch-]'))drafts.add('tab-rollcall');});
  document.addEventListener('click',event=>{const tag=event.target.closest('#family-tags-container button,#health-tags-container button,[id^=counsel-][id$=-tags] button');if(tag)drafts.add(tag.closest('[id^="modal-"]').id);});
  window.addEventListener('beforeunload',event=>{if(drafts.size){event.preventDefault();event.returnValue='';}});
  const faMap={'circle-check':'check','check':'check','check-double':'check','circle-info':'alert','triangle-exclamation':'alert','file-lines':'book','file-arrow-up':'box','download':'printer','upload':'box','arrow-right':'more','arrow-left':'more','arrow-rotate-right':'clock','arrow-rotate-left':'clock','xmark':'more','eye':'camera','lock':'gear','circle-plus':'check','table':'grid','list':'clipboard','file-invoice-dollar':'chart','users':'people','user':'people','filter':'sliders','envelope':'chat','calendar':'calendar','calendar-days':'calendar','calendar-plus':'calendar','list-ul':'clipboard','qrcode':'check','user-graduate':'student','chalkboard-user':'people','coins':'star','calendar-day':'calendar','calendar-check':'calendar','clipboard-check':'clipboard','address-book':'people','hand-holding-heart':'heart','comments':'chat','file-export':'printer','file-csv':'box','house':'home','camera':'camera','face-smile':'camera','user-plus':'people','floppy-disk':'check','print':'printer','trash':'box','pen-to-square':'clipboard','pen':'clipboard','pen-nib':'book','chevron-left':'chevron-left','chevron-right':'chevron-right','people-roof':'people','notes-medical':'heart','circle-notch':'clock','magnifying-glass':'grid','link':'link','plus':'plus','rotate':'clock','file-import':'box','arrows-rotate':'clock'};
  function enhance(scope=document) {
    for(const node of scope.querySelectorAll('i.fa-solid,i.fa-regular')){const key=[...node.classList].find(name=>faMap[name.replace('fa-','')]);const replacement=icon(faMap[key?.replace('fa-','')]||'grid');if(node.classList.contains('fa-spin'))replacement.classList.add('school-spin');node.replaceWith(replacement);}
    for(const button of scope.querySelectorAll('button'))if(button.textContent.trim()==='×'&&!button.hasAttribute('aria-label'))button.setAttribute('aria-label','關閉視窗');
    const actionNames={prevMonth:'上一個月',nextMonth:'下一個月',openUserModal:'編輯個人資料',deleteUser:'刪除人員',showPointsHistory:'查看點數紀錄',changePoints:'調整夢想點數',openScheduleModal:'編輯排班',deleteSchedule:'刪除排班'};
    for(const button of scope.querySelectorAll('button'))if(!button.textContent.trim()&&!button.hasAttribute('aria-label')){
      const action=(button.getAttribute('onclick')||'').match(/([a-zA-Z]+)\(/)?.[1];button.setAttribute('aria-label',actionNames[action]||button.title||'開啟操作');
    }
    for(const label of scope.querySelectorAll('label'))if(!label.htmlFor){const control=label.querySelector('input,select,textarea')||label.parentElement.querySelector('input:not([type=hidden]),select,textarea');if(control?.id)label.htmlFor=control.id;}
    const names={'user-filter':'搜尋人員','user-status-filter':'人員狀態','scan-code-input':'條碼或學號','csv-raw-textarea':'CSV 資料','print-report-type':'報表種類'};
    for(const [id,name] of Object.entries(names))$(id)?.setAttribute('aria-label',name);
    for(const control of scope.querySelectorAll('input:not([type=hidden]),select,textarea'))if(!control.labels?.length&&!control.hasAttribute('aria-label'))control.setAttribute('aria-label',control.placeholder||control.title||control.id.replaceAll('-',' '));
    for(const scroller of scope.querySelectorAll('.overflow-x-auto')){scroller.setAttribute('tabindex','0');if(!scroller.hasAttribute('aria-label'))scroller.setAttribute('aria-label','可左右捲動的表格');}
    for(const form of scope.querySelectorAll('#modal-user form,#modal-schedule form')){if(form.querySelector('.school-form-note'))continue;const note=text('p','標示 * 為必填，其餘可稍後補充。','school-form-note');form.prepend(note);}
  }
  const observer=new MutationObserver(records=>{
    for(const entry of records)if(entry.type==='attributes'&&entry.attributeName==='hidden'&&entry.target.id==='student-form'&&entry.target.hidden)clearDraft('student-form');
    if(records.some(record=>record.type==='attributes'&&record.target.matches('[id^="modal-"],dialog.school-sheet,#kiosk-device-dialog')))refreshModals();
    for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1 && !node.closest('.school-symbol,.school-icon-tile'))enhance(node);
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','open','hidden']});
  for(const dialog of roots().filter(element=>element instanceof HTMLDialogElement))dialog.addEventListener('close',refreshModals);
  enhance();
  window.SchoolUI=Object.freeze({catalog,sync,onNavigate,notify,record,confirm:message=>question(message),prompt:message=>question(message,true),clearDraft});
  sync(window.schoolInterface?.state().user);refreshModals();
})();

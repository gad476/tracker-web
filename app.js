/* =========================================================
   مسار التأسيس — تتبع تنفيذي لإطلاق منصة تسويق ووساطة عقارية
   تخزين البيانات المشتركة (المهام والفريق): Firebase Firestore
   — كل من يفتح هذه الصفحة بنفس إعدادات config.js يرى نفس البيانات
     ويتحدّث لديه تلقائيًا فور تعديل أي عضو آخر (تزامن لحظي).
   "أنت الآن" (currentUser) محفوظ محليًا في متصفح كل شخص فقط،
     حتى يحتفظ كل جهاز بهويته الخاصة رغم اشتراك الجميع بنفس البيانات.
   ========================================================= */

const LOCAL_USER_KEY = 'rp_current_user_v1';

const COLORS = ['#2F6F62','#B08D57','#A6472F','#3F7D5C','#6C5B7B','#1C6E8C','#8C6D3F','#4B5B57'];

function uid(prefix){ return prefix + '_' + Math.random().toString(36).slice(2,9); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function fmtDate(iso){
  if(!iso) return '—';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('ar-EG-u-nu-latn', {year:'numeric', month:'short', day:'numeric'});
}
function daysBetween(a,b){
  const A = new Date(a+'T00:00:00'), B = new Date(b+'T00:00:00');
  return Math.round((B-A)/86400000);
}
function fmtDateTime(iso){
  if(!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ar-EG-u-nu-latn', {year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
}

/* ---------- progress → status (single source of truth is task.progress, 0-100) ---------- */
function taskStatus(t){
  const p = t.progress || 0;
  if(p >= 100) return 'done';
  if(p <= 0) return 'not_started';
  return 'in_progress';
}

/* ---------- activity log ---------- */
const ACTION_LABELS = {
  created:'أنشأ المهمة', edited:'عدّل بيانات المهمة', progress:'حدّث نسبة الإنجاز',
  completed:'أنجز المهمة', reopened:'أعاد فتح المهمة',
};
function logAction(task, action, note){
  if(!task.history) task.history = [];
  task.history.push({ action, by: currentUser, at: new Date().toISOString(), note: note || '' });
}

/* ---------- migrate legacy tasks (from before the progress-slider model) ---------- */
function migrateTask(t){
  if(typeof t.progress !== 'number'){
    t.progress = t.status==='done' ? 100 : t.status==='in_progress' ? 50 : 0;
  }
  if(!t.history) t.history = [];
  return t;
}

/* ---------- Default / reset data: مرحلة واحدة تحتوي على المهام المطلوبة حاليًا ----------
   تُستخدم عند إنشاء قاعدة بيانات جديدة تمامًا، وأيضًا مرة واحدة تلقائيًا لأي
   قاعدة بيانات قديمة لا تحتوي على حقل "phases" (أي أُنشئت قبل إضافة ميزة
   إدارة المراحل) — لتفريغ المراحل والمهام القديمة والبدء بمرحلة واحدة فقط. */
function buildFreshPhaseAndTasks(existingMembers){
  const fallback = (existingMembers && existingMembers[0]) ? existingMembers[0].id : 'm1';
  const phases = [{ id: uid('p'), name:'المرحلة الأولى' }];
  const pid = phases[0].id;
  const mk = (title, desc)=>{
    const now = new Date().toISOString();
    return {
      id: uid('t'), phase: pid, title, desc: desc || '',
      assignee: fallback, addedBy: fallback,
      dateAdded: todayISO(), due: shiftDate(14), progress: 0,
      completedDate: null, completedBy: null,
      history: [{ action:'created', by: fallback, at: now, note:'' }],
    };
  };
  const tasks = [
    mk('اختيار أربعة أسماء مقترحة للشركة', 'تمهيدًا لاستخراج شهادة عدم التباس من الهيئة العامة للاستثمار.'),
    mk('استخراج شهادة عدم التباس من الهيئة العامة للاستثمار'),
    mk('إنشاء صفحات الشركة على منصات التواصل الاجتماعي'),
    mk('تحديد الهيكل والخطة الأولية للشركة', 'اختصاصات فريق العمل وتقسيم المسؤوليات، الرؤية الاستراتيجية، الخدمات المقدَّمة، المشاكل التي تُحل للعملاء، النفقات المطلوبة، ومصادر الإيرادات — خطة مبدئية قابلة للتعديل.'),
    mk('الترويج للشركة', 'على منصات التواصل الاجتماعي وعلى الأرض.'),
    mk('إنشاء وإطلاق منصة الشركة الإلكترونية'),
    mk('جمع بيانات السوق', 'بيانات عن الوحدات العقارية والمشترين المحتملين.'),
    mk('تجهيز المقر'),
  ];
  return { phases, tasks };
}

function seedData(){
  const members = [
    { id:'m1', name:'مدير المشروع', role:'الإدارة العامة', color:COLORS[0] },
  ];
  const { phases, tasks } = buildFreshPhaseAndTasks(members);
  return { members, phases, tasks };
}
function shiftDate(days){
  const d = new Date();
  d.setDate(d.getDate()+days);
  return d.toISOString().slice(0,10);
}

/* ---------- Shared state (Firestore) ---------- */
let state = { members: [], phases: [], tasks: [] };
let currentUser = localStorage.getItem(LOCAL_USER_KEY) || null;
let dataReady = false;
let docRef = null;

function setSyncStatus(mode, text){
  const el = document.getElementById('syncStatus');
  el.className = 'sync-status ' + mode;
  el.textContent = text;
}

function isConfigFilled(){
  return typeof firebaseConfig !== 'undefined'
    && firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('ضع_')
    && firebaseConfig.projectId && !firebaseConfig.projectId.includes('ضع_');
}

function initFirestore(){
  if(!isConfigFilled()){
    document.getElementById('connectingOverlay').style.display = 'none';
    document.getElementById('setupOverlay').style.display = 'flex';
    setSyncStatus('err', '● لم يُعدّ الاتصال بعد');
    return;
  }
  try{
    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();
    docRef = db.collection('workspaces').doc(typeof WORKSPACE_ID !== 'undefined' ? WORKSPACE_ID : 'default');
  }catch(e){
    console.error(e);
    showSetupError('تعذّر تهيئة Firebase. تأكد من صحة القيم في config.js. رسالة الخطأ: ' + e.message);
    return;
  }

  docRef.onSnapshot(snap=>{
    if(snap.exists){
      const data = snap.data();
      if(!data.phases){
        // مستند قديم من قبل إضافة إدارة المراحل — تفريغ تلقائي لمرة واحدة
        // إلى مرحلة واحدة بالمهام المطلوبة حاليًا، مع الإبقاء على أعضاء الفريق الحاليين.
        const members = data.members || [];
        const fresh = buildFreshPhaseAndTasks(members);
        state = { members, phases: fresh.phases, tasks: fresh.tasks };
        docRef.set(state).catch(e=>console.error('تعذر حفظ إعادة التعيين', e));
      } else {
        state = { members: data.members || [], phases: data.phases || [], tasks: (data.tasks || []).map(migrateTask) };
      }
    } else {
      state = seedData();
      docRef.set(state).catch(e=>console.error('تعذر إنشاء البيانات الأولية', e));
    }
    if(!currentUser || !state.members.find(m=>m.id===currentUser)){
      currentUser = state.members[0] ? state.members[0].id : null;
      if(currentUser) localStorage.setItem(LOCAL_USER_KEY, currentUser);
    }
    dataReady = true;
    document.getElementById('connectingOverlay').style.display = 'none';
    setSyncStatus('ok', '● متزامن');
    renderAll();
  }, err=>{
    console.error(err);
    showSetupError('تعذّر الاتصال بقاعدة البيانات. تحقق من صحة القيم في config.js، ومن قواعد الأمان (Firestore Rules)، ومن اتصالك بالإنترنت. رسالة الخطأ: ' + err.message);
  });
}

function showSetupError(msg){
  document.getElementById('connectingOverlay').style.display = 'none';
  document.getElementById('setupOverlay').style.display = 'flex';
  document.getElementById('setupMessage').textContent = msg;
  setSyncStatus('err', '● تعذّر الاتصال');
}

function persist(){
  if(!docRef) return;
  setSyncStatus('saving', '● جارٍ الحفظ…');
  docRef.set(state).then(()=>{
    setSyncStatus('ok', '● متزامن');
  }).catch(e=>{
    console.error(e);
    setSyncStatus('err', '● تعذّر الحفظ');
    alert('تعذّر حفظ التغيير على قاعدة البيانات المشتركة. تحقق من اتصالك بالإنترنت وحاول مجددًا.');
  });
}

function setCurrentUser(id){
  currentUser = id;
  localStorage.setItem(LOCAL_USER_KEY, id);
}

let activePhase = 'all';
let activeMemberFilter = 'all';
let statusChart, memberChart;
let memberPctChart, memberCountChart, memberDelayChart;

/* ---------- Derived helpers ---------- */
function memberById(id){ return state.members.find(m=>m.id===id); }
function memberName(id){ const m = memberById(id); return m ? m.name : '—'; }
function phaseById(id){ return state.phases.find(p=>p.id===id); }

function taskDelayInfo(t){
  // returns {lateDays, isLate, isOngoingLate}
  if(taskStatus(t) === 'done'){
    const d = daysBetween(t.due, t.completedDate);
    return { lateDays: Math.max(d,0), isLate: d>0, isOngoingLate:false };
  }
  const d = daysBetween(t.due, todayISO());
  return { lateDays: Math.max(d,0), isLate:false, isOngoingLate: d>0 };
}

function tasksForPhase(phaseId){
  return phaseId==='all' ? state.tasks : state.tasks.filter(t=>t.phase===phaseId);
}

function completionPct(list){
  // نسبة الإنجاز الكلية = متوسط نسبة إنجاز كل مهمة (وليس فقط عدد المهام المنجزة بالكامل)
  if(!list.length) return 0;
  return Math.round(list.reduce((s,t)=>s+(t.progress||0),0) / list.length);
}

/* =========================================================
   RENDER
   ========================================================= */
function renderAll(){
  // كل قسم مُعزول في try/catch خاص به: فشل قسم واحد (كرسم بياني تعذّر تحميله)
  // لن يمنع بعد الآن بقية الأقسام (المراحل، المهام، الفريق) من الظهور.
  try{ renderCurrentUserSelect(); }catch(e){ console.error('renderCurrentUserSelect failed:', e); }
  try{ renderDashboard(); }catch(e){ console.error('renderDashboard failed:', e); }
  try{ renderTimeline(); }catch(e){ console.error('renderTimeline failed:', e); }
  try{ renderTaskList(); }catch(e){ console.error('renderTaskList failed:', e); }
  try{ renderTeam(); }catch(e){ console.error('renderTeam failed:', e); }
  try{ renderTeamCompare(); }catch(e){ console.error('renderTeamCompare failed:', e); }
  try{ fillFormSelectors(); }catch(e){ console.error('fillFormSelectors failed:', e); }
}

function renderCurrentUserSelect(){
  const sel = document.getElementById('currentUserSelect');
  sel.innerHTML = state.members.map(m=>`<option value="${m.id}" ${m.id===currentUser?'selected':''}>${escapeHtml(m.name)}</option>`).join('');
  const meAvatar = document.getElementById('meAvatar');
  const me = memberById(currentUser) || state.members[0];
  if(me){
    meAvatar.style.background = me.color;
    meAvatar.textContent = initials(me.name);
  }
  sel.onchange = ()=>{ setCurrentUser(sel.value); renderAll(); };
}

function initials(name){
  return (name||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
}
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderDashboard(){
  const el = document.getElementById('dashboard');
  const total = state.tasks.length;
  const done = state.tasks.filter(t=>taskStatus(t)==='done').length;
  const ongoingLate = state.tasks.filter(t=>taskDelayInfo(t).isOngoingLate).length;
  const pct = completionPct(state.tasks);
  const closedWithDue = state.tasks.filter(t=>taskStatus(t)==='done');
  const avgDelay = closedWithDue.length ? Math.round(closedWithDue.reduce((s,t)=>s+taskDelayInfo(t).lateDays,0)/closedWithDue.length) : 0;

  el.innerHTML = `
    <div class="stat-card">
      <div class="num">${pct}%</div>
      <div class="lbl">نسبة الإنجاز الكلي (متوسط إنجاز ${total} مهمة)</div>
    </div>
    <div class="stat-card">
      <div class="num">${state.members.length}</div>
      <div class="lbl">أعضاء فريق العمل</div>
    </div>
    <div class="stat-card ${ongoingLate? 'warn':''}">
      <div class="num">${ongoingLate}</div>
      <div class="lbl">مهام متأخرة حاليًا عن موعدها</div>
    </div>
    <div class="stat-card">
      <div class="num">${avgDelay}</div>
      <div class="lbl">متوسط أيام التأخير للمهام المنجزة</div>
    </div>
    <div class="chart-card">
      <canvas id="statusChartCanvas" width="96" height="96"></canvas>
      <div class="chart-legend">
        <span><i class="dot" style="background:#3F7D5C"></i> منجزة</span>
        <span><i class="dot" style="background:#C99A46"></i> قيد التنفيذ</span>
        <span><i class="dot" style="background:#B7B9AC"></i> لم تبدأ</span>
        <span><i class="dot" style="background:#A6472F"></i> متأخرة</span>
      </div>
    </div>
  `;

  const notStarted = state.tasks.filter(t=>taskStatus(t)==='not_started' && !taskDelayInfo(t).isOngoingLate).length;
  const inProgress = state.tasks.filter(t=>taskStatus(t)==='in_progress' && !taskDelayInfo(t).isOngoingLate).length;
  const doneCount = done;
  const lateCount = ongoingLate;

  const ctx = document.getElementById('statusChartCanvas');
  try{
    if(typeof Chart === 'undefined') throw new Error('مكتبة Chart.js لم تُحمّل (رابط CDN محجوب أو تعذّر الاتصال)');
    if(statusChart) statusChart.destroy();
    statusChart = new Chart(ctx, {
      type:'doughnut',
      data:{
        labels:['منجزة','قيد التنفيذ','لم تبدأ','متأخرة'],
        datasets:[{ data:[doneCount, inProgress, notStarted, lateCount],
          backgroundColor:['#3F7D5C','#C99A46','#B7B9AC','#A6472F'], borderWidth:0 }]
      },
      options:{ plugins:{legend:{display:false}, tooltip:{rtl:true}}, cutout:'62%' }
    });
  }catch(e){
    console.warn('تعذّر رسم الرسم البياني الدائري:', e.message);
    const chartCard = ctx ? ctx.closest('.chart-card') : null;
    if(chartCard) chartCard.style.display = 'none';
  }
}

function renderTimeline(){
  const el = document.getElementById('timeline');
  const allChip = `
    <div class="phase-chip all-chip ${activePhase==='all'?'active':''}" data-phase="all">
      <span class="idx">•</span>
      <div class="name">كل المراحل</div>
      <div class="phase-bar"><i style="width:${completionPct(state.tasks)}%"></i></div>
      <span class="pct">${completionPct(state.tasks)}% منجز</span>
    </div>`;
  const chips = state.phases.map((p,i)=>{
    const list = tasksForPhase(p.id);
    const pct = completionPct(list);
    return `
      <div class="phase-chip ${activePhase===p.id?'active':''}" data-phase="${p.id}">
        <div class="phase-chip-tools">
          <button class="btn-icon" data-phase-action="edit" data-phase-id="${p.id}" title="تعديل اسم المرحلة">✎</button>
          <button class="btn-icon" data-phase-action="delete" data-phase-id="${p.id}" title="حذف المرحلة">✕</button>
        </div>
        <span class="idx">${i+1}</span>
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="phase-bar"><i style="width:${pct}%"></i></div>
        <span class="pct">${pct}% منجز · ${list.length} مهمة</span>
      </div>`;
  }).join('');
  const addChip = `
    <button class="phase-chip add-phase-chip" id="addPhaseChip" type="button">
      <span class="add-plus">+</span>
      <div class="name">إضافة مرحلة</div>
    </button>`;
  el.innerHTML = allChip + chips + addChip;

  el.querySelectorAll('.phase-chip[data-phase]').forEach(chip=>{
    chip.onclick = (e)=>{
      if(e.target.closest('[data-phase-action]')) return;
      activePhase = chip.dataset.phase; renderTimeline(); renderTaskList();
    };
  });
  el.querySelectorAll('[data-phase-action="edit"]').forEach(btn=>{
    btn.onclick = (e)=>{ e.stopPropagation(); openPhaseModal(btn.dataset.phaseId); };
  });
  el.querySelectorAll('[data-phase-action="delete"]').forEach(btn=>{
    btn.onclick = (e)=>{ e.stopPropagation(); deletePhase(btn.dataset.phaseId); };
  });
  document.getElementById('addPhaseChip').onclick = ()=>openPhaseModal(null);
}

function renderTaskList(){
  const title = document.getElementById('taskListTitle');
  const phaseObj = phaseById(activePhase);

  // تعبئة قائمة تصفية الأعضاء (مع الحفاظ على الاختيار الحالي إن كان لا يزال صالحًا)
  const memberSel = document.getElementById('memberFilterSelect');
  const prevSelection = activeMemberFilter;
  memberSel.innerHTML = `<option value="all">كل الأعضاء</option>` +
    state.members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  if(prevSelection!=='all' && !memberById(prevSelection)) activeMemberFilter = 'all';
  memberSel.value = activeMemberFilter;
  memberSel.onchange = ()=>{ activeMemberFilter = memberSel.value; renderTaskList(); };

  const titleParts = [];
  titleParts.push(phaseObj ? `مرحلة: ${phaseObj.name}` : 'كل المراحل');
  if(activeMemberFilter!=='all') titleParts.push(`العضو: ${memberName(activeMemberFilter)}`);
  title.textContent = titleParts.length>1 ? titleParts.join(' — ') : (phaseObj ? `مهام مرحلة: ${phaseObj.name}` : 'كل المهام');

  let list = tasksForPhase(activePhase);
  if(activeMemberFilter!=='all') list = list.filter(t=>t.assignee===activeMemberFilter);
  list = list.slice().sort((a,b)=> (a.due||'').localeCompare(b.due||''));
  const el = document.getElementById('taskList');

  if(!list.length){
    el.innerHTML = `<div class="empty-state">لا توجد مهام تطابق هذه التصفية بعد.</div>`;
    return;
  }

  el.innerHTML = list.map(t=>{
    const delay = taskDelayInfo(t);
    const assignee = memberById(t.assignee);
    const st = taskStatus(t);
    const progress = t.progress || 0;
    const statusLabel = {not_started:'لم تبدأ', in_progress:'قيد التنفيذ', done:'منجزة'}[st];
    let badges = `<span class="badge ${st}">${statusLabel} · ${progress}%</span>`;
    if(delay.isOngoingLate) badges += `<span class="badge late">متأخرة ${delay.lateDays} يوم</span>`;
    if(st==='done' && delay.isLate) badges += `<span class="badge late">أُنجزت متأخرة ${delay.lateDays} يوم</span>`;
    if(t.groupId){
      const siblings = state.tasks.filter(x=>x.groupId===t.groupId).length;
      badges += `<span class="task-group-badge">مهمة مشتركة (${siblings} أعضاء)</span>`;
    }

    return `
    <div class="task-card" data-id="${t.id}">
      <div class="task-main">
        <div class="task-title-row">
          <span class="task-title">${escapeHtml(t.title)}</span>
          ${badges}
        </div>
        ${t.desc ? `<div class="task-desc">${escapeHtml(t.desc)}</div>` : ''}
        <div class="task-meta">
          <span class="assignee"><span class="avatar" style="width:20px;height:20px;font-size:.62rem;background:${assignee?assignee.color:'#999'}">${assignee?initials(assignee.name):'?'}</span> <b>${escapeHtml(memberName(t.assignee))}</b> مسؤول التنفيذ</span>
          <span>أضافها: <b>${escapeHtml(memberName(t.addedBy))}</b> بتاريخ ${fmtDate(t.dateAdded)}</span>
          <span>الاستحقاق: <b>${fmtDate(t.due)}</b></span>
          <span>الإنجاز: <b>${t.completedDate ? fmtDate(t.completedDate) + (t.completedBy? ' — بواسطة '+escapeHtml(memberName(t.completedBy)) : '') : '—'}</b></span>
        </div>
        <div class="progress-row">
          <input type="range" class="progress-slider" min="0" max="100" step="5" value="${progress}" data-id="${t.id}">
          <span class="progress-num">${progress}%</span>
        </div>
      </div>
      <div class="task-actions">
        <div class="row">
          <button class="btn-icon" data-action="history" title="سجل الإجراءات">🕘</button>
          <button class="btn-icon" data-action="edit" title="تعديل">✎</button>
          <button class="btn-icon" data-action="delete" title="حذف">✕</button>
        </div>
        ${st!=='done' ? `<button class="btn-primary btn-sm" data-action="complete">تمييز كمُنجزة</button>` : `<button class="btn-ghost btn-sm" data-action="reopen">إعادة فتح</button>`}
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.task-card').forEach(card=>{
    const id = card.dataset.id;
    card.querySelector('[data-action="edit"]').onclick = ()=>openTaskModal(id);
    card.querySelector('[data-action="history"]').onclick = ()=>openHistoryModal(id);
    card.querySelector('[data-action="delete"]').onclick = ()=>{
      if(confirm('حذف هذه المهمة نهائيًا؟')){
        state.tasks = state.tasks.filter(t=>t.id!==id);
        persist(); renderAll();
      }
    };
    const completeBtn = card.querySelector('[data-action="complete"]');
    if(completeBtn) completeBtn.onclick = ()=>{
      const t = state.tasks.find(t=>t.id===id);
      t.progress = 100; t.completedDate = todayISO(); t.completedBy = currentUser;
      logAction(t, 'completed');
      persist(); renderAll();
    };
    const reopenBtn = card.querySelector('[data-action="reopen"]');
    if(reopenBtn) reopenBtn.onclick = ()=>{
      const t = state.tasks.find(t=>t.id===id);
      t.progress = 50; t.completedDate = null; t.completedBy = null;
      logAction(t, 'reopened');
      persist(); renderAll();
    };
    const slider = card.querySelector('.progress-slider');
    const numLbl = card.querySelector('.progress-num');
    slider.addEventListener('input', ()=>{ numLbl.textContent = slider.value + '%'; });
    slider.addEventListener('change', ()=>{
      const t = state.tasks.find(t=>t.id===id);
      const wasDone = taskStatus(t)==='done';
      t.progress = Number(slider.value);
      logAction(t, 'progress', `${t.progress}%`);
      const nowDone = taskStatus(t)==='done';
      if(nowDone && !wasDone){ t.completedDate = todayISO(); t.completedBy = currentUser; logAction(t,'completed'); }
      if(!nowDone && wasDone){ t.completedDate = null; t.completedBy = null; logAction(t,'reopened'); }
      persist(); renderAll();
    });
  });
}

function renderTeam(){
  const el = document.getElementById('teamGrid');
  el.innerHTML = state.members.map(m=>{
    const assigned = state.tasks.filter(t=>t.assignee===m.id);
    const done = assigned.filter(t=>taskStatus(t)==='done').length;
    const pct = completionPct(assigned);
    const added = state.tasks.filter(t=>t.addedBy===m.id).length;
    return `
    <div class="member-card ${activeMemberFilter===m.id?'active':''}" data-member-id="${m.id}" title="اضغط لعرض مهام هذا العضو فقط">
      <div class="member-top">
        <span class="avatar" style="background:${m.color}">${initials(m.name)}</span>
        <div style="flex:1; min-width:0;">
          <div class="member-name">${escapeHtml(m.name)}</div>
          <div class="member-role">${escapeHtml(m.role||'—')}</div>
        </div>
        <div class="member-tools">
          <button class="btn-icon" data-member-action="edit" data-member-id="${m.id}" title="تعديل">✎</button>
          <button class="btn-icon" data-member-action="delete" data-member-id="${m.id}" title="حذف">✕</button>
        </div>
      </div>
      <div class="member-stats">
        <span>مُكلَّف بـ<b>${assigned.length}</b></span>
        <span>أنجز<b>${done}</b></span>
        <span>أضاف<b>${added}</b></span>
        <span>الإنجاز<b>${pct}%</b></span>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.member-card').forEach(card=>{
    card.onclick = (e)=>{
      if(e.target.closest('[data-member-action]')) return;
      const id = card.dataset.memberId;
      activeMemberFilter = (activeMemberFilter===id) ? 'all' : id;
      renderTaskList();
      renderTeam();
      const titleEl = document.getElementById('taskListTitle');
      if(titleEl.scrollIntoView) titleEl.scrollIntoView({behavior:'smooth', block:'center'});
    };
  });
  el.querySelectorAll('[data-member-action="edit"]').forEach(btn=>{
    btn.onclick = (e)=>{ e.stopPropagation(); openMemberModal(btn.dataset.memberId); };
  });
  el.querySelectorAll('[data-member-action="delete"]').forEach(btn=>{
    btn.onclick = (e)=>{ e.stopPropagation(); deleteMember(btn.dataset.memberId); };
  });
}

/* ---------- Team comparison dashboard (per-member charts) ---------- */
function renderTeamCompare(){
  if(typeof Chart === 'undefined'){
    console.warn('تعذّر رسم لوحة مقارنة الفريق: مكتبة Chart.js لم تُحمّل.');
    return;
  }
  const labels = state.members.map(m=>m.name);

  // --- بيانات لكل عضو ---
  const rows = state.members.map(m=>{
    const assigned = state.tasks.filter(t=>t.assignee===m.id);
    const doneList = assigned.filter(t=>taskStatus(t)==='done');
    const inProgressCount = assigned.filter(t=>taskStatus(t)==='in_progress').length;
    const notStartedCount = assigned.filter(t=>taskStatus(t)==='not_started').length;
    const avgDelay = doneList.length
      ? Math.round(doneList.reduce((s,t)=>s+taskDelayInfo(t).lateDays,0)/doneList.length)
      : 0;
    return {
      member: m,
      pct: completionPct(assigned),
      done: doneList.length,
      inProgress: inProgressCount,
      notStarted: notStartedCount,
      avgDelay,
    };
  });

  /* 1) نسبة الإنجاز لكل عضو — مرتّبة تنازليًا لسهولة المقارنة */
  try{
    const sorted = rows.slice().sort((a,b)=> b.pct - a.pct);
    const ctx = document.getElementById('memberPctChart');
    if(memberPctChart) memberPctChart.destroy();
    memberPctChart = new Chart(ctx, {
      type:'bar',
      data:{
        labels: sorted.map(r=>r.member.name),
        datasets:[{ data: sorted.map(r=>r.pct), backgroundColor: sorted.map(r=>r.member.color), borderRadius:4 }],
      },
      options:{
        indexAxis:'y',
        responsive:true, maintainAspectRatio:false,
        scales:{ x:{ min:0, max:100, ticks:{ callback:v=>v+'%' } } },
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>c.parsed.x+'% إنجاز' } } },
      }
    });
  }catch(e){ console.warn('تعذّر رسم مخطط نسبة الإنجاز', e); }

  /* 2) عدد المهام حسب الحالة لكل عضو — أعمدة مكدّسة */
  try{
    const ctx = document.getElementById('memberCountChart');
    if(memberCountChart) memberCountChart.destroy();
    memberCountChart = new Chart(ctx, {
      type:'bar',
      data:{
        labels,
        datasets:[
          { label:'منجزة', data: rows.map(r=>r.done), backgroundColor:'#3F7D5C', borderRadius:3 },
          { label:'قيد التنفيذ', data: rows.map(r=>r.inProgress), backgroundColor:'#C99A46', borderRadius:3 },
          { label:'لم تبدأ', data: rows.map(r=>r.notStarted), backgroundColor:'#B7B9AC', borderRadius:3 },
        ],
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        scales:{ x:{ stacked:true }, y:{ stacked:true, ticks:{ precision:0 } } },
        plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, font:{size:10} } } },
      }
    });
  }catch(e){ console.warn('تعذّر رسم مخطط عدد المهام', e); }

  /* 3) متوسط أيام التأخير لكل عضو */
  try{
    const ctx = document.getElementById('memberDelayChart');
    if(memberDelayChart) memberDelayChart.destroy();
    memberDelayChart = new Chart(ctx, {
      type:'bar',
      data:{
        labels,
        datasets:[{
          data: rows.map(r=>r.avgDelay),
          backgroundColor: rows.map(r=> r.avgDelay>0 ? '#A6472F' : '#3F7D5C'),
          borderRadius:4,
        }],
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } },
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=> c.parsed.y+' يوم تأخير بالمتوسط' } } },
      }
    });
  }catch(e){ console.warn('تعذّر رسم مخطط التأخير', e); }
}

function fillFormSelectors(){
  const phaseSel = document.getElementById('taskPhase');
  phaseSel.innerHTML = state.phases.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  const assigneeSel = document.getElementById('taskAssignee');
  assigneeSel.innerHTML = state.members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
}

function renderAssigneeChecklist(selectedIds){
  const list = document.getElementById('assigneeList');
  list.innerHTML = state.members.map(m=>`
    <label class="assignee-item">
      <input type="checkbox" class="assignee-checkbox" value="${m.id}" ${selectedIds.includes(m.id)?'checked':''}>
      <span class="avatar" style="background:${m.color}">${initials(m.name)}</span>
      ${escapeHtml(m.name)}
    </label>`).join('');
  syncSelectAllToggle();
  list.querySelectorAll('.assignee-checkbox').forEach(cb=>{
    cb.addEventListener('change', syncSelectAllToggle);
  });
}
function syncSelectAllToggle(){
  const boxes = document.querySelectorAll('.assignee-checkbox');
  const allChecked = boxes.length>0 && Array.from(boxes).every(b=>b.checked);
  document.getElementById('assigneeAllToggle').checked = allChecked;
}
document.getElementById('assigneeAllToggle').addEventListener('change', e=>{
  document.querySelectorAll('.assignee-checkbox').forEach(cb=>{ cb.checked = e.target.checked; });
});

/* =========================================================
   MODALS
   ========================================================= */
function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
window.closeModal = closeModal;

function openTaskModal(editId){
  fillFormSelectors();
  const form = document.getElementById('taskForm');
  form.reset();
  document.getElementById('taskId').value = editId || '';
  document.getElementById('taskModalTitle').textContent = editId ? 'تعديل المهمة' : 'إضافة مهمة جديدة';
  const singleWrap = document.getElementById('taskAssigneeSingleWrap');
  const multiWrap = document.getElementById('taskAssigneeMultiWrap');
  if(editId){
    singleWrap.style.display = '';
    multiWrap.style.display = 'none';
    const t = state.tasks.find(t=>t.id===editId);
    document.getElementById('taskTitle').value = t.title;
    document.getElementById('taskDesc').value = t.desc||'';
    document.getElementById('taskPhase').value = t.phase;
    document.getElementById('taskAssignee').value = t.assignee;
    document.getElementById('taskDue').value = t.due;
    document.getElementById('taskProgress').value = t.progress || 0;
    document.getElementById('taskProgressNum').textContent = (t.progress||0) + '%';
  } else {
    singleWrap.style.display = 'none';
    multiWrap.style.display = '';
    renderAssigneeChecklist([]);
    document.getElementById('taskPhase').value = (activePhase!=='all' && phaseById(activePhase)) ? activePhase : (state.phases[0] ? state.phases[0].id : '');
    document.getElementById('taskDue').value = shiftDate(7);
    document.getElementById('taskProgress').value = 0;
    document.getElementById('taskProgressNum').textContent = '0%';
  }
  openModal('taskOverlay');
}
document.getElementById('taskProgress').addEventListener('input', e=>{
  document.getElementById('taskProgressNum').textContent = e.target.value + '%';
});

document.getElementById('addTaskBtn').onclick = ()=>{
  if(!state.phases.length){ alert('أضف مرحلة واحدة على الأقل أولًا قبل إضافة مهمة.'); return; }
  openTaskModal(null);
};

document.getElementById('taskForm').addEventListener('submit', e=>{
  e.preventDefault();
  const id = document.getElementById('taskId').value;
  const base = {
    title: document.getElementById('taskTitle').value.trim(),
    desc: document.getElementById('taskDesc').value.trim(),
    phase: document.getElementById('taskPhase').value,
    due: document.getElementById('taskDue').value,
    progress: Number(document.getElementById('taskProgress').value),
  };
  if(id){
    const t = state.tasks.find(t=>t.id===id);
    const wasDone = taskStatus(t)==='done';
    Object.assign(t, base, { assignee: document.getElementById('taskAssignee').value });
    logAction(t, 'edited');
    const nowDone = taskStatus(t)==='done';
    if(nowDone && !wasDone){ t.completedDate = todayISO(); t.completedBy = currentUser; logAction(t,'completed'); }
    if(!nowDone && wasDone){ t.completedDate = null; t.completedBy = null; logAction(t,'reopened'); }
  } else {
    const selectedIds = Array.from(document.querySelectorAll('.assignee-checkbox:checked')).map(cb=>cb.value);
    if(!selectedIds.length){ alert('اختر عضوًا واحدًا على الأقل مسؤولًا عن هذه المهمة.'); return; }
    const groupId = selectedIds.length > 1 ? uid('grp') : null;
    selectedIds.forEach(memberId=>{
      const t = {
        id: uid('t'), ...base, assignee: memberId, groupId,
        addedBy: currentUser,
        dateAdded: todayISO(),
        completedDate: base.progress>=100 ? todayISO() : null,
        completedBy: base.progress>=100 ? currentUser : null,
        history: [],
      };
      logAction(t, 'created');
      state.tasks.push(t);
    });
  }
  persist(); renderAll();
  closeModal('taskOverlay');
});

/* Member modal (add + edit) */
function openMemberModal(editId){
  const sw = document.getElementById('colorSwatches');
  const existing = editId ? memberById(editId) : null;
  const currentColor = existing ? existing.color : COLORS[state.members.length % COLORS.length];
  sw.innerHTML = COLORS.map(c=>`<span class="swatch ${c===currentColor?'sel':''}" style="background:${c}" data-color="${c}"></span>`).join('');
  document.getElementById('memberColor').value = currentColor;
  sw.querySelectorAll('.swatch').forEach(s=>{
    s.onclick = ()=>{
      sw.querySelectorAll('.swatch').forEach(x=>x.classList.remove('sel'));
      s.classList.add('sel');
      document.getElementById('memberColor').value = s.dataset.color;
    };
  });
  document.getElementById('memberForm').reset();
  document.getElementById('memberId').value = editId || '';
  document.querySelector('#memberOverlay h3').textContent = editId ? 'تعديل بيانات العضو' : 'إضافة عضو إلى فريق العمل';
  document.querySelector('#memberOverlay button[type="submit"]').textContent = editId ? 'حفظ التعديلات' : 'إضافة العضو';
  if(existing){
    document.getElementById('memberName').value = existing.name;
    document.getElementById('memberRole').value = existing.role || '';
  }
  openModal('memberOverlay');
}
document.getElementById('addMemberBtn').onclick = ()=>openMemberModal(null);

document.getElementById('memberForm').addEventListener('submit', e=>{
  e.preventDefault();
  const id = document.getElementById('memberId').value;
  const name = document.getElementById('memberName').value.trim();
  const role = document.getElementById('memberRole').value.trim();
  const color = document.getElementById('memberColor').value || COLORS[state.members.length % COLORS.length];
  if(!name) return;
  if(id){
    const m = memberById(id);
    Object.assign(m, { name, role, color });
  } else {
    state.members.push({ id: uid('m'), name, role, color });
  }
  persist(); renderAll();
  closeModal('memberOverlay');
});

function deleteMember(id){
  if(state.members.length <= 1){
    alert('يجب أن يبقى عضو واحد على الأقل في فريق العمل.');
    return;
  }
  const assignedCount = state.tasks.filter(t=>t.assignee===id || t.addedBy===id).length;
  const m = memberById(id);
  const warn = assignedCount
    ? `هذا العضو مرتبط بـ${assignedCount} مهمة (كمسؤول تنفيذ أو مُضيف). حذفه لن يحذف هذه المهام، لكن اسمه سيظهر كـ"—" فيها. `
    : '';
  if(confirm(`${warn}هل تريد حذف "${m.name}" من فريق العمل؟`)){
    state.members = state.members.filter(m=>m.id!==id);
    persist(); renderAll();
  }
}

/* Phase modal (add + edit) */
function openPhaseModal(editId){
  const existing = editId ? phaseById(editId) : null;
  document.getElementById('phaseForm').reset();
  document.getElementById('phaseId').value = editId || '';
  document.getElementById('phaseModalTitle').textContent = editId ? 'تعديل اسم المرحلة' : 'إضافة مرحلة جديدة';
  if(existing) document.getElementById('phaseName').value = existing.name;
  openModal('phaseOverlay');
}

document.getElementById('phaseForm').addEventListener('submit', e=>{
  e.preventDefault();
  const id = document.getElementById('phaseId').value;
  const name = document.getElementById('phaseName').value.trim();
  if(!name) return;
  if(id){
    const p = phaseById(id);
    p.name = name;
  } else {
    state.phases.push({ id: uid('p'), name });
  }
  persist(); renderAll();
  closeModal('phaseOverlay');
});

function deletePhase(id){
  if(state.phases.length <= 1){
    alert('يجب أن تبقى مرحلة واحدة على الأقل.');
    return;
  }
  const p = phaseById(id);
  const count = tasksForPhase(id).length;
  const warn = count
    ? `تحتوي هذه المرحلة على ${count} مهمة. حذف المرحلة لن يحذفها، لكنها لن تظهر ضمن أي مرحلة محددة بعد الآن (ستبقى ظاهرة ضمن "كل المراحل"). `
    : '';
  if(confirm(`${warn}هل تريد حذف مرحلة "${p.name}"؟`)){
    state.phases = state.phases.filter(p=>p.id!==id);
    if(activePhase===id) activePhase = 'all';
    persist(); renderAll();
  }
}

document.querySelectorAll('.overlay').forEach(ov=>{
  ov.addEventListener('click', e=>{ if(e.target===ov) closeModal(ov.id); });
});

function openHistoryModal(taskId){
  const t = state.tasks.find(t=>t.id===taskId);
  const list = document.getElementById('historyList');
  document.getElementById('historyTaskTitle').textContent = t.title;
  const entries = (t.history || []).slice().sort((a,b)=> new Date(b.at) - new Date(a.at));
  if(!entries.length){
    list.innerHTML = `<div class="empty-state">لا يوجد سجل إجراءات لهذه المهمة بعد.</div>`;
  } else {
    list.innerHTML = entries.map(h=>`
      <div class="history-item">
        <span class="avatar" style="width:26px;height:26px;font-size:.7rem;background:${memberById(h.by)?memberById(h.by).color:'#999'}">${memberById(h.by)?initials(memberById(h.by).name):'?'}</span>
        <div class="history-text">
          <div><b>${escapeHtml(memberName(h.by))}</b> — ${ACTION_LABELS[h.action] || h.action}${h.note?` <span class="history-note">(${escapeHtml(h.note)})</span>`:''}</div>
          <div class="history-date">${fmtDateTime(h.at)}</div>
        </div>
      </div>`).join('');
  }
  openModal('historyOverlay');
}

/* =========================================================
   EXPORT / IMPORT (manual sync between team members)
   ========================================================= */
document.getElementById('exportBtn').onclick = ()=>{
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `مسار-التأسيس-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

document.getElementById('importBtn').onclick = ()=> document.getElementById('importFile').click();
document.getElementById('importFile').addEventListener('change', e=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const incoming = JSON.parse(reader.result);
      if(!incoming.tasks && !incoming.members && !incoming.phases) throw new Error('صيغة غير صحيحة');
      const parts = [];
      if(incoming.members) parts.push('أعضاء الفريق');
      if(incoming.phases) parts.push('المراحل');
      if(incoming.tasks) parts.push('المهام');
      if(confirm(`سيستبدل هذا الملف: ${parts.join('، ')} — لكل أعضاء الفريق (وليس هذا المتصفح فقط). أي جزء غير موجود في الملف يبقى كما هو حاليًا. هل تريد المتابعة؟`)){
        state = {
          members: incoming.members || state.members,
          phases: incoming.phases || state.phases,
          tasks: incoming.tasks || state.tasks,
        };
        persist(); renderAll();
      }
    }catch(err){
      alert('تعذر قراءة الملف. تأكد أنه ملف تصدير صحيح من هذه الصفحة.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ---------- init ---------- */
initFirestore();

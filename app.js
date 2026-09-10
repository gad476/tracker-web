/* =========================================================
   مسار التأسيس — تتبع تنفيذي لإطلاق منصة تسويق ووساطة عقارية
   تخزين البيانات المشتركة (المهام والفريق): Firebase Firestore
   — كل من يفتح هذه الصفحة بنفس إعدادات config.js يرى نفس البيانات
     ويتحدّث لديه تلقائيًا فور تعديل أي عضو آخر (تزامن لحظي).
   "أنت الآن" (currentUser) محفوظ محليًا في متصفح كل شخص فقط،
     حتى يحتفظ كل جهاز بهويته الخاصة رغم اشتراك الجميع بنفس البيانات.
   ========================================================= */

const LOCAL_USER_KEY = 'rp_current_user_v1';

const PHASES = [
  { id:'p1', name:'الدراسة والتخطيط' },
  { id:'p2', name:'التأسيس القانوني' },
  { id:'p3', name:'البنية التقنية للمنصة' },
  { id:'p4', name:'بناء الفريق' },
  { id:'p5', name:'العلامة والتسويق' },
  { id:'p6', name:'تشغيل الوساطة العقارية' },
  { id:'p7', name:'الإطلاق' },
  { id:'p8', name:'ما بعد الإطلاق والتطوير' },
];

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

/* ---------- Default seed data (first run only) ---------- */
function seedData(){
  const members = [
    { id:'m1', name:'مدير المشروع', role:'الإدارة العامة', color:COLORS[0] },
  ];
  const mk = (over)=>({ history:[{action:'created', by:'m1', at:new Date(over.dateAdded+'T09:00:00').toISOString(), note:''}], ...over });
  const tasks = [
    mk({ id:uid('t'), phase:'p1', title:'دراسة السوق العقاري المستهدف', desc:'تحليل حجم السوق والمنافسين والفرص في المناطق المستهدفة.', assignee:'m1', addedBy:'m1', dateAdded: shiftDate(-20), due: shiftDate(-8), progress:100, completedDate: shiftDate(-9), completedBy:'m1' }),
    mk({ id:uid('t'), phase:'p1', title:'إعداد دراسة الجدوى المالية', desc:'تقدير التكاليف التأسيسية والتشغيلية ونقطة التعادل.', assignee:'m1', addedBy:'m1', dateAdded: shiftDate(-20), due: shiftDate(-2), progress:100, completedDate: shiftDate(2), completedBy:'m1' }),
    mk({ id:uid('t'), phase:'p2', title:'استخراج السجل التجاري والترخيص العقاري', desc:'استكمال إجراءات الترخيص لدى الجهات المختصة.', assignee:'m1', addedBy:'m1', dateAdded: shiftDate(-14), due: shiftDate(5), progress:40, completedDate:null, completedBy:null }),
    mk({ id:uid('t'), phase:'p3', title:'تصميم قاعدة بيانات العقارات', desc:'نمذجة بيانات الوحدات والعملاء والعقود.', assignee:'m1', addedBy:'m1', dateAdded: shiftDate(-10), due: shiftDate(10), progress:0, completedDate:null, completedBy:null }),
    mk({ id:uid('t'), phase:'p5', title:'تصميم الهوية البصرية للمنصة', desc:'الشعار والألوان ودليل الاستخدام.', assignee:'m1', addedBy:'m1', dateAdded: shiftDate(-6), due: shiftDate(6), progress:0, completedDate:null, completedBy:null }),
  ];
  return { members, tasks };
}
function shiftDate(days){
  const d = new Date();
  d.setDate(d.getDate()+days);
  return d.toISOString().slice(0,10);
}

/* ---------- Shared state (Firestore) ---------- */
let state = { members: [], tasks: [] };
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
      state = { members: data.members || [], tasks: (data.tasks || []).map(migrateTask) };
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
let statusChart, memberChart;

/* ---------- Derived helpers ---------- */
function memberById(id){ return state.members.find(m=>m.id===id); }
function memberName(id){ const m = memberById(id); return m ? m.name : '—'; }

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
  renderCurrentUserSelect();
  renderDashboard();
  renderTimeline();
  renderTaskList();
  renderTeam();
  fillFormSelectors();
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
}

function renderTimeline(){
  const el = document.getElementById('timeline');
  const allChip = `
    <div class="phase-chip ${activePhase==='all'?'active':''}" data-phase="all">
      <span class="idx">•</span>
      <div class="name">كل المراحل</div>
      <div class="phase-bar"><i style="width:${completionPct(state.tasks)}%"></i></div>
      <span class="pct">${completionPct(state.tasks)}% منجز</span>
    </div>`;
  const chips = PHASES.map((p,i)=>{
    const list = tasksForPhase(p.id);
    const pct = completionPct(list);
    return `
      <div class="phase-chip ${activePhase===p.id?'active':''}" data-phase="${p.id}">
        <span class="idx">${i+1}</span>
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="phase-bar"><i style="width:${pct}%"></i></div>
        <span class="pct">${pct}% منجز · ${list.length} مهمة</span>
      </div>`;
  }).join('');
  el.innerHTML = allChip + chips;
  el.querySelectorAll('.phase-chip').forEach(chip=>{
    chip.onclick = ()=>{ activePhase = chip.dataset.phase; renderTimeline(); renderTaskList(); };
  });
}

function renderTaskList(){
  const title = document.getElementById('taskListTitle');
  const phaseObj = PHASES.find(p=>p.id===activePhase);
  title.textContent = phaseObj ? `مهام مرحلة: ${phaseObj.name}` : 'كل المهام';

  const list = tasksForPhase(activePhase).slice().sort((a,b)=> (a.due||'').localeCompare(b.due||''));
  const el = document.getElementById('taskList');

  if(!list.length){
    el.innerHTML = `<div class="empty-state">لا توجد مهام هنا بعد — اضغط "إضافة مهمة جديدة" لبدء تسجيل الخطوات.</div>`;
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
    <div class="member-card">
      <div class="member-top">
        <span class="avatar" style="background:${m.color}">${initials(m.name)}</span>
        <div>
          <div class="member-name">${escapeHtml(m.name)}</div>
          <div class="member-role">${escapeHtml(m.role||'—')}</div>
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
}

function fillFormSelectors(){
  const phaseSel = document.getElementById('taskPhase');
  phaseSel.innerHTML = PHASES.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  const assigneeSel = document.getElementById('taskAssignee');
  assigneeSel.innerHTML = state.members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
}

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
  if(editId){
    const t = state.tasks.find(t=>t.id===editId);
    document.getElementById('taskTitle').value = t.title;
    document.getElementById('taskDesc').value = t.desc||'';
    document.getElementById('taskPhase').value = t.phase;
    document.getElementById('taskAssignee').value = t.assignee;
    document.getElementById('taskDue').value = t.due;
    document.getElementById('taskProgress').value = t.progress || 0;
    document.getElementById('taskProgressNum').textContent = (t.progress||0) + '%';
  } else {
    document.getElementById('taskPhase').value = activePhase!=='all' ? activePhase : PHASES[0].id;
    document.getElementById('taskDue').value = shiftDate(7);
    document.getElementById('taskProgress').value = 0;
    document.getElementById('taskProgressNum').textContent = '0%';
  }
  openModal('taskOverlay');
}
document.getElementById('taskProgress').addEventListener('input', e=>{
  document.getElementById('taskProgressNum').textContent = e.target.value + '%';
});

document.getElementById('addTaskBtn').onclick = ()=>openTaskModal(null);

document.getElementById('taskForm').addEventListener('submit', e=>{
  e.preventDefault();
  const id = document.getElementById('taskId').value;
  const data = {
    title: document.getElementById('taskTitle').value.trim(),
    desc: document.getElementById('taskDesc').value.trim(),
    phase: document.getElementById('taskPhase').value,
    assignee: document.getElementById('taskAssignee').value,
    due: document.getElementById('taskDue').value,
    progress: Number(document.getElementById('taskProgress').value),
  };
  if(id){
    const t = state.tasks.find(t=>t.id===id);
    const wasDone = taskStatus(t)==='done';
    Object.assign(t, data);
    logAction(t, 'edited');
    const nowDone = taskStatus(t)==='done';
    if(nowDone && !wasDone){ t.completedDate = todayISO(); t.completedBy = currentUser; logAction(t,'completed'); }
    if(!nowDone && wasDone){ t.completedDate = null; t.completedBy = null; logAction(t,'reopened'); }
  } else {
    const t = {
      id: uid('t'), ...data,
      addedBy: currentUser,
      dateAdded: todayISO(),
      completedDate: data.progress>=100 ? todayISO() : null,
      completedBy: data.progress>=100 ? currentUser : null,
      history: [],
    };
    logAction(t, 'created');
    state.tasks.push(t);
  }
  persist(); renderAll();
  closeModal('taskOverlay');
});

/* Member modal */
document.getElementById('addMemberBtn').onclick = ()=>{
  const sw = document.getElementById('colorSwatches');
  sw.innerHTML = COLORS.map((c,i)=>`<span class="swatch ${i===0?'sel':''}" style="background:${c}" data-color="${c}"></span>`).join('');
  document.getElementById('memberColor').value = COLORS[0];
  sw.querySelectorAll('.swatch').forEach(s=>{
    s.onclick = ()=>{
      sw.querySelectorAll('.swatch').forEach(x=>x.classList.remove('sel'));
      s.classList.add('sel');
      document.getElementById('memberColor').value = s.dataset.color;
    };
  });
  document.getElementById('memberForm').reset();
  openModal('memberOverlay');
};

document.getElementById('memberForm').addEventListener('submit', e=>{
  e.preventDefault();
  const name = document.getElementById('memberName').value.trim();
  const role = document.getElementById('memberRole').value.trim();
  const color = document.getElementById('memberColor').value || COLORS[state.members.length % COLORS.length];
  if(!name) return;
  state.members.push({ id: uid('m'), name, role, color });
  persist(); renderAll();
  closeModal('memberOverlay');
});

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
      if(!incoming.tasks || !incoming.members) throw new Error('صيغة غير صحيحة');
      if(confirm('سيؤدي الاستيراد إلى استبدال البيانات المشتركة الحالية لكل أعضاء الفريق (وليس هذا المتصفح فقط). هل تريد المتابعة؟')){
        state = { members: incoming.members, tasks: incoming.tasks };
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

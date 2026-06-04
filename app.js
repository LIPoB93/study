
const LS_KEY='electricalStudyStateV1';
const SYNC_KEY='electricalStudySyncConfigV1';
const DEFAULT_SYNC_URL='https://script.google.com/macros/s/AKfycbyjDWSCIZfp_wpJ33QU75cohPsdLH5jAC50uTB1koXeVojP6oHIovbtbhzbeb0Nrk0z/exec';
const subjects=window.COURSE_DATA;
const requiredSubjects=()=>subjects.filter(s=>s.required || state.settings.includeControl);
const allModules=()=>requiredSubjects().flatMap(s=>s.modules);
const byId=(id)=>document.getElementById(id);
const fmtDate=(d)=>new Date(d).toISOString().slice(0,10);
const today=()=>fmtDate(new Date());
const addDays=(date,n)=>{const d=new Date(date+'T00:00:00');d.setDate(d.getDate()+n);return fmtDate(d)};
const escapeHtml=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

let state=loadState();
let syncConfig=loadSyncConfig();
let syncTimer=null,syncBusy=false;
let timerSeconds=0,timerHandle=null,pendingModule=null,deferredInstallPrompt=null;
let memorizeLimit=10;

function defaultState(){
 return {settings:{targetDate:'2026-08-07',dailyMinutes:90,includeControl:false,flexcilDocument:'전기기사 필기 치트키',flexcilUrl:''},completed:{},reviews:[],wrong:[],exams:[],studyLog:{},minimumMode:false};
}
function normalizedState(value={}){
 const base=defaultState();
 return {...base,...value,settings:{...base.settings,...(value.settings||{})},completed:value.completed||{},reviews:Array.isArray(value.reviews)?value.reviews:[],wrong:Array.isArray(value.wrong)?value.wrong:[],exams:Array.isArray(value.exams)?value.exams:[],studyLog:value.studyLog||{}};
}
function loadState(){try{return normalizedState(JSON.parse(localStorage.getItem(LS_KEY)||'{}'))}catch{return defaultState()}}
function saveState(skipSync=false){localStorage.setItem(LS_KEY,JSON.stringify(state));if(!skipSync)queueAutoSync()}
function loadSyncConfig(){try{return {url:DEFAULT_SYNC_URL,key:'',auto:false,...JSON.parse(localStorage.getItem(SYNC_KEY)||'{}')}}catch{return {url:DEFAULT_SYNC_URL,key:'',auto:false}}}
function saveSyncConfig(){localStorage.setItem(SYNC_KEY,JSON.stringify(syncConfig))}
function setSyncStatus(message,type=''){const el=byId('syncStatus');if(!el)return;el.textContent=message;el.className='resource-status '+type}
function hasSyncConfig(){return Boolean(syncConfig.url&&syncConfig.key)}
function queueAutoSync(){if(!syncConfig.auto||!hasSyncConfig())return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncPush(false,true),1200)}
function jsonp(url){return new Promise((resolve,reject)=>{const cb='__studySync_'+Date.now()+'_'+Math.random().toString(36).slice(2);const script=document.createElement('script');const timer=setTimeout(()=>cleanup(new Error('서버 응답 시간이 초과되었습니다.')),12000);function cleanup(err,data){clearTimeout(timer);delete window[cb];script.remove();err?reject(err):resolve(data)}window[cb]=data=>cleanup(null,data);script.onerror=()=>cleanup(new Error('서버 연결에 실패했습니다.'));script.src=url+(url.includes('?')?'&':'?')+'callback='+encodeURIComponent(cb)+'&_='+Date.now();document.head.appendChild(script)})}
async function apiGetState(){if(!hasSyncConfig())throw new Error('GAS 주소와 API_KEY를 먼저 저장하세요.');const data=await jsonp(syncConfig.url+'?action=getState&key='+encodeURIComponent(syncConfig.key));if(!data.ok)throw new Error(data.error||'상태 조회에 실패했습니다.');return data}
async function apiPostState(force=false){const body={key:syncConfig.key,action:'saveState',baseRevision:Number(state.meta?.revision||0),force:Boolean(force),payload:{state}};await fetch(syncConfig.url,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body)});await new Promise(r=>setTimeout(r,900))}
async function testSync(){try{setSyncStatus('연결 확인 중...');const ping=await jsonp(syncConfig.url+'?action=ping');if(!ping.ok)throw new Error(ping.error||'ping 실패');const remote=await apiGetState();setSyncStatus('연결 성공 · 서버 버전 '+Number(remote.revision||0),'sync-good')}catch(err){setSyncStatus('연결 실패: '+err.message,'sync-bad')}}
async function syncPull(silent=false){if(syncBusy)return;syncBusy=true;try{if(!silent)setSyncStatus('서버 기록을 불러오는 중...');const remote=await apiGetState();state=normalizedState(remote.state||defaultState());saveState(true);renderAll();setSyncStatus('불러오기 완료 · 서버 버전 '+Number(remote.revision||0),'sync-good')}catch(err){setSyncStatus('불러오기 실패: '+err.message,'sync-bad')}finally{syncBusy=false}}
async function syncPush(force=false,silent=false){if(syncBusy||!hasSyncConfig())return;syncBusy=true;try{if(!silent)setSyncStatus('현재 기록을 서버에 저장하는 중...');const remote=await apiGetState();const localRev=Number(state.meta?.revision||0),remoteRev=Number(remote.revision||0);if(!force&&localRev!==remoteRev){setSyncStatus('다른 기기의 최신 기록이 있습니다. 먼저 서버 기록을 불러오세요.','sync-warn');return}await apiPostState(force);const after=await apiGetState();state=normalizedState(after.state||state);saveState(true);renderAll();setSyncStatus('동기화 완료 · 서버 버전 '+Number(after.revision||0),'sync-good')}catch(err){setSyncStatus('저장 실패: '+err.message,'sync-bad')}finally{syncBusy=false}}

function subj(id){return subjects.find(s=>s.id===id)}
function moduleById(id){return subjects.flatMap(s=>s.modules).find(m=>m.id===id)}
function completion(m){return state.completed[m.id]}
function daysUntil(date){return Math.ceil((new Date(date+'T00:00:00')-new Date(today()+'T00:00:00'))/86400000)}
function subjectProgress(s){const ms=s.modules,done=ms.filter(m=>completion(m)).length;return {done,total:ms.length,pct:Math.round(done/ms.length*100)}}
function overallPct(){const ms=allModules();return ms.length?Math.round(ms.filter(m=>completion(m)).length/ms.length*100):0}
function dueReviews(){return state.reviews.filter(r=>!r.done&&r.due<=today()&&moduleById(r.moduleId))}
function dueWrong(){return state.wrong.filter(w=>(w.status||'복습대기')!=='해결'&&(w.nextReview||today())<=today())}
function currentStreak(){let streak=0,d=new Date(today()+'T00:00:00');for(let i=0;i<500;i++){const k=fmtDate(d);if((state.studyLog[k]||0)>0)streak++;else if(i!==0)break;d.setDate(d.getDate()-1)}return streak}
function recordMinutes(mins){if(!mins)return;state.studyLog[today()]=(state.studyLog[today()]||0)+mins;saveState();renderHome()}
function scheduleReview(moduleId,understanding){const days={1:1,2:3,3:7,4:14}[understanding]||7;state.reviews.push({id:crypto.randomUUID(),moduleId,due:addDays(today(),days),done:false,understanding:Number(understanding)})}
function completeModule(id,understanding){state.completed[id]={date:today(),understanding:Number(understanding)};scheduleReview(id,understanding);saveState();renderAll()}
function getTodayTasks(){
 const reviews=dueReviews().slice(0,state.minimumMode?2:4).map(r=>({type:'review',review:r,module:moduleById(r.moduleId),minutes:state.minimumMode?10:15}));
 let budget=Math.max(0,(state.minimumMode?40:state.settings.dailyMinutes)-reviews.reduce((a,b)=>a+b.minutes,0));
 const lessons=[];
 for(const m of allModules().filter(m=>!completion(m))){if(budget<=0&&lessons.length)break;const mins=Math.min(m.minutes,budget||m.minutes);lessons.push({type:'lesson',module:m,minutes:mins});budget-=mins;if(lessons.length>=2)break}
 return [...reviews,...lessons];
}
async function copyText(text,message='복사했습니다.'){
 try{await navigator.clipboard.writeText(text);toast(message)}
 catch{prompt('아래 내용을 복사하세요.',text)}
}
function pageLabel(start,end=start){return start===end?`${start}페이지`:`${start}~${end}페이지`}
function copyPages(start,end=start){return copyText(pageLabel(Number(start),Number(end)),'플렉슬에서 볼 페이지를 복사했습니다.')}
function openFlexcil(start,end=start){
 copyPages(start,end);
 const link=String(state.settings.flexcilUrl||'').trim();
 if(link){setTimeout(()=>{window.location.href=link},200)}
 else toast('페이지를 복사했습니다. 플렉슬로 전환하세요.');
}
function toast(message){let el=byId('toast');if(!el){el=document.createElement('div');el.id='toast';el.className='toast';document.body.appendChild(el)}el.textContent=message;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),2200)}

function renderHome(){
 const d=daysUntil(state.settings.targetDate);
 byId('dDay').textContent=d>=0?`D-${d}`:`D+${Math.abs(d)}`;
 byId('dailyGoal').textContent=`${state.minimumMode?40:state.settings.dailyMinutes}분`;
 byId('streak').textContent=`${currentStreak()}일`;
 byId('overallProgress').textContent=`${overallPct()}%`;
 byId('reviewCount').textContent=`${dueReviews().length+dueWrong().length}개`;
 const tasks=getTodayTasks(),first=tasks[0];
 byId('todayTitle').textContent=first?(first.type==='review'?'복습부터 시작하세요':'플렉슬에서 첫 PART를 시작하세요'):'오늘 계획을 모두 끝냈습니다';
 byId('todaySubtitle').textContent=first?`${subj(first.module.subjectId).name} · ${first.module.part} · 플렉슬 ${pageLabel(first.module.startPage,first.module.endPage)}`:'암기 탭에서 오답 복습을 확인하세요.';
 byId('minimumMode').textContent=state.minimumMode?'기본 분량':'최소 분량';
 byId('todayTasks').innerHTML=tasks.length?tasks.map(taskCard).join(''):'<div class="card empty">오늘 배정된 일이 없습니다.</div>';
 renderScoreSummary();
}
function taskCard(t){
 const s=subj(t.module.subjectId),isReview=t.type==='review',m=t.module;
 return `<div class="card task">
  <div><span class="tag ${isReview?'review':''}">${isReview?'복습':'개념'}</span><span class="tag">${escapeHtml(s.name)}</span>
  <h3>${escapeHtml(m.part)} · ${escapeHtml(m.title)}</h3>
  <div class="task-meta">플렉슬 ${pageLabel(m.startPage,m.endPage)} · 예상 ${t.minutes}분</div></div>
  <div class="task-actions">
    <button class="secondary" onclick="copyPages(${m.startPage},${m.endPage})">페이지 복사</button>
    <button class="secondary" onclick="openFlexcil(${m.startPage},${m.endPage})">플렉슬로 공부</button>
    ${isReview?`<button class="primary" onclick="finishReview('${t.review.id}')">복습 완료</button>`:`<button class="primary" onclick="askComplete('${m.id}')">학습 완료</button>`}
  </div></div>`;
}
function renderProgress(){
 byId('subjectProgress').innerHTML=requiredSubjects().map(s=>{const p=subjectProgress(s);return `<div class="card"><div class="subject-title"><div><h3>${escapeHtml(s.name)} ${!s.required?'<span class="tag optional">선택</span>':''}</h3><div class="muted small">플렉슬 ${s.startPage}~${s.endPage}페이지 · ${p.done}/${p.total} PART 완료</div></div><strong>${p.pct}%</strong></div><div class="progress-wrap"><div class="progress-bar" style="width:${p.pct}%"></div></div><div>${s.modules.map(moduleRow).join('')}</div></div>`}).join('');
}
function moduleRow(m){const c=completion(m);return `<div class="module-row ${c?'done':''}"><div><h4>${escapeHtml(m.part)} · ${escapeHtml(m.title)}</h4><div class="task-meta">플렉슬 ${pageLabel(m.startPage,m.endPage)} · 약 ${m.minutes}분 ${c?'· 완료 '+c.date:''}</div></div><div class="right-actions"><button class="secondary" onclick="copyPages(${m.startPage},${m.endPage})">복사</button>${c?`<button class="secondary" onclick="undoModule('${m.id}')">취소</button>`:`<button class="primary" onclick="askComplete('${m.id}')">완료</button>`}</div></div>`}
function askComplete(id){pendingModule=id;byId('understandingDialog').showModal()}
byId('understandingDialog').addEventListener('close',()=>{const v=byId('understandingDialog').returnValue;if(v!=='cancel'&&pendingModule)completeModule(pendingModule,v);pendingModule=null})
function undoModule(id){delete state.completed[id];state.reviews=state.reviews.filter(r=>r.moduleId!==id);saveState();renderAll()}
function finishReview(id){const r=state.reviews.find(x=>x.id===id);if(!r)return;r.done=true;state.reviews.push({id:crypto.randomUUID(),moduleId:r.moduleId,due:addDays(today(),r.understanding<=2?3:14),done:false,understanding:r.understanding});saveState();renderAll()}

function renderWrong(){
 const list=[...state.wrong].sort((a,b)=>(b.created||'').localeCompare(a.created||''));
 byId('wrongList').innerHTML=list.length?list.map(w=>`<div class="card task"><div><span class="tag">${escapeHtml(subj(w.subjectId)?.name||'기타')}</span><span class="tag ${w.status==='해결'?'solved':'review'}">${escapeHtml(w.status||'복습대기')}</span><h3>${escapeHtml(w.number||'문제번호 없음')} · ${escapeHtml(w.reason)}</h3><div class="task-meta">플렉슬 ${escapeHtml(w.page||'-')}페이지 · 다음 복습 ${escapeHtml(w.nextReview||'-')}<br>${escapeHtml(w.memo||'')}</div></div><div class="task-actions"><button class="secondary" onclick="copyPages(${Number(w.page)||1})">페이지 복사</button><button class="secondary" onclick="wrongAgain('${w.id}')">또 틀림</button><button class="primary" onclick="wrongSolved('${w.id}')">해결</button><button class="secondary" onclick="deleteWrong('${w.id}')">삭제</button></div></div>`).join(''):'<div class="card empty">아직 등록한 오답이 없습니다.</div>';
}
function deleteWrong(id){state.wrong=state.wrong.filter(w=>w.id!==id);saveState();renderAll()}
function wrongAgain(id){const w=state.wrong.find(x=>x.id===id);if(!w)return;w.status='복습대기';w.nextReview=addDays(today(),1);w.repeatCount=Number(w.repeatCount||0)+1;saveState();renderAll();toast('내일 다시 복습하도록 배정했습니다.')}
function wrongSolved(id){const w=state.wrong.find(x=>x.id===id);if(!w)return;w.status='해결';w.nextReview=addDays(today(),14);saveState();renderAll();toast('해결 처리했습니다.')}
byId('addWrongBtn').onclick=()=>byId('wrongDialog').showModal();
byId('wrongForm').addEventListener('submit',e=>{e.preventDefault();const action=e.submitter?.value;if(action==='save'){state.wrong.push({id:crypto.randomUUID(),subjectId:byId('wrongSubject').value,page:byId('wrongPage').value,number:byId('wrongNumber').value,reason:byId('wrongReason').value,memo:byId('wrongMemo').value,nextReview:addDays(today(),1),created:new Date().toISOString(),status:'복습대기',repeatCount:0});saveState();renderAll();e.target.reset()}byId('wrongDialog').close(action||'cancel')})

function setMemorizeLimit(n){memorizeLimit=n;renderMemorize()}
function renderMemorize(){
 const wrongCards=dueWrong().map(w=>({type:'wrong',item:w}));
 const reviewCards=dueReviews().map(r=>({type:'module',item:r,module:moduleById(r.moduleId)}));
 const cards=[...wrongCards,...reviewCards].slice(0,memorizeLimit);
 byId('memorizeList').innerHTML=cards.length?cards.map(memorizeCard).join(''):'<div class="card empty">오늘 복습할 카드가 없습니다.</div>';
}
function memorizeCard(card){
 if(card.type==='wrong'){
  const w=card.item;
  return `<div class="card memory-card"><span class="tag review">오답</span><span class="tag">${escapeHtml(subj(w.subjectId)?.name||'기타')}</span><h3>${escapeHtml(w.number||'문제번호 없음')} · ${escapeHtml(w.reason)}</h3><div class="memory-question">플렉슬 ${escapeHtml(w.page||'-')}페이지를 떠올려보세요.</div><details><summary>메모 보기</summary><p>${escapeHtml(w.memo||'메모 없음')}</p></details><div class="inline-actions"><button class="secondary" onclick="copyPages(${Number(w.page)||1})">페이지 복사</button><button class="secondary" onclick="wrongAgain('${w.id}')">헷갈림</button><button class="primary" onclick="wrongSolved('${w.id}')">암기 완료</button></div></div>`;
 }
 const r=card.item,m=card.module;
 return `<div class="card memory-card"><span class="tag review">PART 복습</span><span class="tag">${escapeHtml(subj(m.subjectId)?.name||'')}</span><h3>${escapeHtml(m.part)} · ${escapeHtml(m.title)}</h3><div class="memory-question">핵심 개념과 공식을 말로 떠올려보세요.</div><details><summary>페이지 보기</summary><p>플렉슬 ${pageLabel(m.startPage,m.endPage)}</p></details><div class="inline-actions"><button class="secondary" onclick="copyPages(${m.startPage},${m.endPage})">페이지 복사</button><button class="secondary" onclick="rescheduleReview('${r.id}',1)">헷갈림</button><button class="primary" onclick="finishReview('${r.id}')">암기 완료</button></div></div>`;
}
function rescheduleReview(id,days=1){const r=state.reviews.find(x=>x.id===id);if(!r)return;r.due=addDays(today(),days);r.understanding=Math.min(Number(r.understanding||2),2);saveState();renderAll();toast('내일 다시 복습하도록 배정했습니다.')}

function renderExamInputs(){byId('examScoreInputs').innerHTML=subjects.filter(s=>s.required).map(s=>`<label>${escapeHtml(s.name)}<input type="number" min="0" max="100" step="5" data-score="${s.id}" placeholder="점수" /></label>`).join('')}
byId('addExamBtn').onclick=()=>{byId('examDate').value=today();byId('examDialog').showModal()}
byId('examForm').addEventListener('submit',e=>{e.preventDefault();const action=e.submitter?.value;if(action==='save'){const scores={};document.querySelectorAll('[data-score]').forEach(i=>scores[i.dataset.score]=Number(i.value||0));state.exams.push({id:crypto.randomUUID(),date:byId('examDate').value||today(),label:byId('examLabel').value||'기출 연습',scores});saveState();renderAll();e.target.reset()}byId('examDialog').close(action||'cancel')})
function examAvg(ex){const vals=subjects.filter(s=>s.required).map(s=>Number(ex.scores[s.id]||0));return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length)}
function scoreCells(ex){return subjects.filter(s=>s.required).map(s=>`<div class="score-cell"><span>${escapeHtml(s.name)}</span><strong class="${Number(ex.scores[s.id])<40?'risk':'safe'}">${Number(ex.scores[s.id]||0)}</strong></div>`).join('')}
function renderExams(){const list=[...state.exams].sort((a,b)=>b.date.localeCompare(a.date));byId('examList').innerHTML=list.length?list.map(ex=>`<div class="card"><div class="subject-title"><div><h3>${escapeHtml(ex.label)}</h3><div class="muted small">${ex.date}</div></div><strong class="${examAvg(ex)>=60?'safe':'risk'}">평균 ${examAvg(ex)}점</strong></div><div class="score-grid">${scoreCells(ex)}</div><div class="inline-actions" style="margin-top:10px"><button class="secondary" onclick="deleteExam('${ex.id}')">삭제</button></div></div>`).join(''):'<div class="card empty">산업기사 기출을 풀고 점수를 기록하세요.</div>'}
function deleteExam(id){state.exams=state.exams.filter(x=>x.id!==id);saveState();renderAll()}
function renderScoreSummary(){const ex=[...state.exams].sort((a,b)=>b.date.localeCompare(a.date))[0];byId('scoreSummary').innerHTML=ex?`<div class="subject-title"><div><h3>${escapeHtml(ex.label)}</h3><div class="muted small">${ex.date}</div></div><strong class="${examAvg(ex)>=60?'safe':'risk'}">평균 ${examAvg(ex)}점</strong></div><div class="score-grid">${scoreCells(ex)}</div>`:'<div class="empty">기출 점수를 아직 기록하지 않았습니다.</div>'}

function updateSettingsUI(){byId('targetDate').value=state.settings.targetDate;byId('dailyMinutes').value=state.settings.dailyMinutes;byId('includeControl').checked=state.settings.includeControl;byId('flexcilDocument').value=state.settings.flexcilDocument||'';byId('flexcilUrl').value=state.settings.flexcilUrl||'';byId('syncApiUrl').value=syncConfig.url||DEFAULT_SYNC_URL;byId('syncApiKey').value=syncConfig.key||'';byId('autoSync').checked=Boolean(syncConfig.auto)}
byId('settingsForm').addEventListener('submit',e=>{e.preventDefault();state.settings.targetDate=byId('targetDate').value;state.settings.dailyMinutes=Number(byId('dailyMinutes').value||90);state.settings.includeControl=byId('includeControl').checked;state.settings.flexcilDocument=byId('flexcilDocument').value.trim()||'전기기사 필기 치트키';state.settings.flexcilUrl=byId('flexcilUrl').value.trim();saveState();renderAll();toast('설정을 저장했습니다.')})
byId('saveSyncConfigBtn').onclick=()=>{syncConfig={url:(byId('syncApiUrl').value||DEFAULT_SYNC_URL).trim(),key:byId('syncApiKey').value.trim(),auto:byId('autoSync').checked};saveSyncConfig();setSyncStatus('연결 설정을 저장했습니다. 연결 확인을 눌러주세요.')}
byId('testSyncBtn').onclick=()=>{syncConfig={url:(byId('syncApiUrl').value||DEFAULT_SYNC_URL).trim(),key:byId('syncApiKey').value.trim(),auto:byId('autoSync').checked};saveSyncConfig();testSync()}
byId('pullSyncBtn').onclick=()=>syncPull(false)
byId('pushSyncBtn').onclick=async()=>{if(!hasSyncConfig()){setSyncStatus('GAS 주소와 API_KEY를 먼저 저장하세요.','sync-warn');return}const remote=await apiGetState().catch(err=>{setSyncStatus('서버 확인 실패: '+err.message,'sync-bad');return null});if(!remote)return;const localRev=Number(state.meta?.revision||0),remoteRev=Number(remote.revision||0);if(localRev!==remoteRev&&!confirm('서버와 현재 기기의 버전이 다릅니다. 현재 기기 기록으로 덮어쓸까요?'))return;syncPush(localRev!==remoteRev,false)}
byId('resetDataBtn').onclick=()=>{if(confirm('학습 기록을 초기화할까요?')){const settings=state.settings;state=defaultState();state.settings=settings;saveState();renderAll()}}

function renderTimer(){const h=String(Math.floor(timerSeconds/3600)).padStart(2,'0'),m=String(Math.floor(timerSeconds%3600/60)).padStart(2,'0'),s=String(timerSeconds%60).padStart(2,'0');byId('timerText').textContent=`${h}:${m}:${s}`}
byId('timerToggle').onclick=()=>{if(timerHandle){clearInterval(timerHandle);timerHandle=null;byId('timerToggle').textContent='시작'}else{timerHandle=setInterval(()=>{timerSeconds++;renderTimer()},1000);byId('timerToggle').textContent='일시정지'}}
byId('timerReset').onclick=()=>{if(timerHandle){clearInterval(timerHandle);timerHandle=null}timerSeconds=0;renderTimer();byId('timerToggle').textContent='시작'}
byId('saveTime').onclick=()=>{const mins=Math.max(1,Math.round(timerSeconds/60));recordMinutes(mins);timerSeconds=0;renderTimer();toast(`${mins}분을 저장했습니다.`)}
byId('minimumMode').onclick=()=>{state.minimumMode=!state.minimumMode;saveState();renderHome()}

byId('exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`전기산업기사-학습기록-${today()}.json`;a.click()}
byId('importInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{state=normalizedState(JSON.parse(await f.text()));saveState();renderAll();toast('기록을 불러왔습니다.')}catch{alert('올바른 백업 파일이 아닙니다.')}}

function showView(name){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));byId('view-'+name).classList.add('active');document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));if(name==='memorize')renderMemorize()}
document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>showView(b.dataset.view))
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;byId('installBtn').hidden=false})
byId('installBtn').onclick=async()=>{if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;byId('installBtn').hidden=true}}

function renderAll(){renderHome();renderProgress();renderWrong();renderMemorize();renderExams();updateSettingsUI()}
byId('wrongSubject').innerHTML=subjects.filter(s=>s.required).map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')
renderExamInputs();renderAll();renderTimer();
if(hasSyncConfig()){setSyncStatus('연결 정보가 저장되어 있습니다. 서버 기록을 확인 중...');syncPull(true)}else{setSyncStatus('API_KEY를 입력한 뒤 연결 확인을 눌러주세요.')}
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js?v=6').catch(()=>{});

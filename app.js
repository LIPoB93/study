
const LS_KEY='electricalStudyStateV1';
const SYNC_KEY='electricalStudySyncConfigV1';
const DEFAULT_SYNC_URL='https://script.google.com/macros/s/AKfycbyjDWSCIZfp_wpJ33QU75cohPsdLH5jAC50uTB1koXeVojP6oHIovbtbhzbeb0Nrk0z/exec';
const subjects=window.COURSE_DATA;
const requiredSubjects=()=>subjects.filter(s=>s.required || state.settings.includeControl);
const allModules=()=>requiredSubjects().flatMap(s=>s.modules);
const byId=(id)=>document.getElementById(id);
const fmtDate=(d)=>new Date(d).toISOString().slice(0,10);
const today=()=>fmtDate(new Date());
const addDays=(date, n)=>{const d=new Date(date+'T00:00:00');d.setDate(d.getDate()+n);return fmtDate(d)};
const escapeHtml=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

let state=loadState();
let syncConfig=loadSyncConfig();
let syncTimer=null, syncBusy=false;
let timerSeconds=0, timerHandle=null, pendingModule=null, deferredInstallPrompt=null;

function defaultState(){
 return {settings:{targetDate:'2026-08-07',dailyMinutes:90,includeControl:false},completed:{},reviews:[],wrong:[],exams:[],studyLog:{},minimumMode:false};
}
function loadState(){try{return {...defaultState(),...JSON.parse(localStorage.getItem(LS_KEY)||'{}')}}catch{return defaultState()}}
function saveState(skipSync=false){localStorage.setItem(LS_KEY,JSON.stringify(state));if(!skipSync)queueAutoSync()}
function loadSyncConfig(){try{return {url:DEFAULT_SYNC_URL,key:'',auto:false,...JSON.parse(localStorage.getItem(SYNC_KEY)||'{}')}}catch{return {url:DEFAULT_SYNC_URL,key:'',auto:false}}}
function saveSyncConfig(){localStorage.setItem(SYNC_KEY,JSON.stringify(syncConfig))}
function setSyncStatus(message,type=''){const el=byId('syncStatus');if(!el)return;el.textContent=message;el.className='resource-status '+type}
function hasSyncConfig(){return Boolean(syncConfig.url&&syncConfig.key)}
function queueAutoSync(){if(!syncConfig.auto||!hasSyncConfig())return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncPush(false,true),1200)}
function jsonp(url){return new Promise((resolve,reject)=>{const cb='__studySync_'+Date.now()+'_'+Math.random().toString(36).slice(2);const script=document.createElement('script');const timer=setTimeout(()=>cleanup(new Error('서버 응답 시간이 초과되었습니다.')),12000);function cleanup(err,data){clearTimeout(timer);delete window[cb];script.remove();err?reject(err):resolve(data)}window[cb]=data=>cleanup(null,data);script.onerror=()=>cleanup(new Error('서버 연결에 실패했습니다.'));script.src=url+(url.includes('?')?'&':'?')+'callback='+encodeURIComponent(cb)+'&_='+Date.now();document.head.appendChild(script)})}
async function apiGetState(){if(!hasSyncConfig())throw new Error('GAS 주소와 API_KEY를 먼저 저장하세요.');const url=syncConfig.url+'?action=getState&key='+encodeURIComponent(syncConfig.key);const data=await jsonp(url);if(!data.ok)throw new Error(data.error||'상태 조회에 실패했습니다.');return data}
async function apiPostState(force=false){const body={key:syncConfig.key,action:'saveState',baseRevision:Number(state.meta?.revision||0),force:Boolean(force),payload:{state}};await fetch(syncConfig.url,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body)});await new Promise(r=>setTimeout(r,900))}
async function testSync(){try{setSyncStatus('연결 확인 중...');const ping=await jsonp(syncConfig.url+'?action=ping');if(!ping.ok)throw new Error(ping.error||'ping 실패');const remote=await apiGetState();setSyncStatus('연결 성공 · 서버 버전 '+Number(remote.revision||0),'sync-good')}catch(err){setSyncStatus('연결 실패: '+err.message,'sync-bad')}}
async function syncPull(silent=false){if(syncBusy)return;syncBusy=true;try{if(!silent)setSyncStatus('서버 기록을 불러오는 중...');const remote=await apiGetState();state=remote.state||defaultState();saveState(true);renderAll();setSyncStatus('불러오기 완료 · 서버 버전 '+Number(remote.revision||0),'sync-good')}catch(err){setSyncStatus('불러오기 실패: '+err.message,'sync-bad')}finally{syncBusy=false}}
async function syncPush(force=false,silent=false){if(syncBusy||!hasSyncConfig())return;syncBusy=true;try{if(!silent)setSyncStatus('현재 기록을 서버에 저장하는 중...');const remote=await apiGetState();const localRev=Number(state.meta?.revision||0), remoteRev=Number(remote.revision||0);if(!force&&localRev!==remoteRev){setSyncStatus('다른 기기의 최신 기록이 있습니다. 먼저 서버 기록을 불러오세요.','sync-warn');return}await apiPostState(force);const after=await apiGetState();state=after.state||state;saveState(true);renderAll();setSyncStatus('동기화 완료 · 서버 버전 '+Number(after.revision||0),'sync-good')}catch(err){setSyncStatus('저장 실패: '+err.message,'sync-bad')}finally{syncBusy=false}}
function subj(id){return subjects.find(s=>s.id===id)}
function moduleById(id){return subjects.flatMap(s=>s.modules).find(m=>m.id===id)}
function completion(m){return state.completed[m.id]}
function recordMinutes(mins){if(!mins)return;state.studyLog[today()]=(state.studyLog[today()]||0)+mins;saveState();renderHome()}
function daysUntil(date){return Math.ceil((new Date(date+'T00:00:00')-new Date(today()+'T00:00:00'))/86400000)}
function subjectProgress(s){const ms=s.modules;const done=ms.filter(m=>completion(m)).length;return {done,total:ms.length,pct:Math.round(done/ms.length*100)}}
function overallPct(){const ms=allModules();return ms.length?Math.round(ms.filter(m=>completion(m)).length/ms.length*100):0}
function dueReviews(){return state.reviews.filter(r=>!r.done && r.due<=today())}
function currentStreak(){
 let streak=0,d=new Date(today()+'T00:00:00');
 for(let i=0;i<500;i++){const k=fmtDate(d); if((state.studyLog[k]||0)>0)streak++;else if(i===0){} else break; d.setDate(d.getDate()-1)}
 return streak;
}
function scheduleReview(moduleId, understanding){
 const days={1:1,2:3,3:7,4:14}[understanding]||7;
 state.reviews.push({id:crypto.randomUUID(),moduleId,due:addDays(today(),days),done:false,understanding:Number(understanding)});
}
function completeModule(id, understanding){
 state.completed[id]={date:today(),understanding:Number(understanding)};
 scheduleReview(id,understanding); saveState(); renderAll();
}
function getTodayTasks(){
 const reviews=dueReviews().slice(0,state.minimumMode?2:5).map(r=>({type:'review',review:r,module:moduleById(r.moduleId),minutes:state.minimumMode?10:15}));
 let budget=Math.max(0,(state.minimumMode?40:state.settings.dailyMinutes)-reviews.reduce((a,b)=>a+b.minutes,0));
 const next=allModules().filter(m=>!completion(m));
 const lessons=[];
 for(const m of next){ if(budget<=0 && lessons.length)break; const mins=Math.min(m.minutes,budget||m.minutes); lessons.push({type:'lesson',module:m,minutes:mins}); budget-=mins; if(lessons.length>=2)break;}
 return [...reviews,...lessons];
}
function renderHome(){
 const d=daysUntil(state.settings.targetDate);
 byId('dDay').textContent=d>=0?`D-${d}`:`D+${Math.abs(d)}`;
 byId('dailyGoal').textContent=`${state.minimumMode?40:state.settings.dailyMinutes}분`;
 byId('streak').textContent=`${currentStreak()}일`;
 byId('overallProgress').textContent=`${overallPct()}%`;
 byId('reviewCount').textContent=`${dueReviews().length}개`;
 const tasks=getTodayTasks();
 const first=tasks[0];
 byId('todayTitle').textContent=first? (first.type==='review'?'복습부터 가볍게 시작':'첫 학습을 시작하세요'):'오늘 계획을 모두 끝냈습니다';
 byId('todaySubtitle').textContent=first?`${subj(first.module.subjectId).name} · ${first.module.part} · PDF ${first.module.startPage}~${first.module.endPage}페이지`:'오답노트나 기출 점수를 확인해보세요.';
 byId('minimumMode').textContent=state.minimumMode?'기본 분량':'최소 분량';
 byId('todayTasks').innerHTML=tasks.length?tasks.map(taskCard).join(''):'<div class="card empty">오늘 배정된 일이 없습니다.</div>';
 renderScoreSummary();
}
function taskCard(t){
 const s=subj(t.module.subjectId);
 const isReview=t.type==='review';
 return `<div class="card task">
  <div><span class="tag ${isReview?'review':''}">${isReview?'복습':'개념'}</span><span class="tag">${escapeHtml(s.name)}</span>
  <h3>${escapeHtml(t.module.part)} · ${escapeHtml(t.module.title)}</h3>
  <div class="task-meta">PDF ${t.module.startPage}~${t.module.endPage}페이지 · 예상 ${t.minutes}분</div></div>
  <div class="task-actions">
   <button class="secondary" onclick="openMainPdf(${t.module.startPage})">PDF 열기</button>
   ${isReview?`<button class="primary" onclick="finishReview('${t.review.id}')">복습 완료</button>`:`<button class="primary" onclick="askComplete('${t.module.id}')">학습 완료</button>`}
  </div></div>`;
}
function renderProgress(){
 byId('subjectProgress').innerHTML=subjects.filter(s=>s.required||state.settings.includeControl).map(s=>{
  const p=subjectProgress(s);
  return `<div class="card"><div class="subject-title"><div><h3>${escapeHtml(s.name)} ${!s.required?'<span class="tag optional">선택</span>':''}</h3><div class="muted small">PDF ${s.startPage}~${s.endPage}페이지 · ${p.done}/${p.total} PART 완료</div></div><strong>${p.pct}%</strong></div>
  <div class="progress-wrap"><div class="progress-bar" style="width:${p.pct}%"></div></div>
  <div>${s.modules.map(m=>moduleRow(m)).join('')}</div></div>`;
 }).join('');
}
function moduleRow(m){
 const c=completion(m);
 return `<div class="module-row ${c?'done':''}"><div><h4>${escapeHtml(m.part)} · ${escapeHtml(m.title)}</h4><div class="task-meta">PDF ${m.startPage}~${m.endPage}페이지 · 약 ${m.minutes}분 ${c?'· 완료 '+c.date:''}</div></div>
 <div class="right-actions"><button class="secondary" onclick="openMainPdf(${m.startPage})">PDF</button>${c?`<button class="secondary" onclick="undoModule('${m.id}')">취소</button>`:`<button class="primary" onclick="askComplete('${m.id}')">완료</button>`}</div></div>`;
}
function askComplete(id){pendingModule=id;byId('understandingDialog').showModal()}
byId('understandingDialog').addEventListener('close',()=>{const v=byId('understandingDialog').returnValue;if(v!=='cancel'&&pendingModule)completeModule(pendingModule,v);pendingModule=null})
function undoModule(id){delete state.completed[id];state.reviews=state.reviews.filter(r=>r.moduleId!==id);saveState();renderAll()}
function finishReview(id){const r=state.reviews.find(x=>x.id===id);if(r){r.done=true; const nextDays=r.understanding<=2?3:14;state.reviews.push({id:crypto.randomUUID(),moduleId:r.moduleId,due:addDays(today(),nextDays),done:false,understanding:r.understanding});saveState();renderAll()}}

function renderWrong(){
 const list=[...state.wrong].sort((a,b)=>b.created.localeCompare(a.created));
 byId('wrongList').innerHTML=list.length?list.map(w=>`<div class="card task"><div><span class="tag">${escapeHtml(subj(w.subjectId)?.name||'기타')}</span><h3>${escapeHtml(w.number||'문제번호 없음')} · ${escapeHtml(w.reason)}</h3><div class="task-meta">PDF ${w.page||'-'}페이지 · 다음 복습 ${w.nextReview}<br>${escapeHtml(w.memo||'')}</div></div><div class="task-actions"><button class="secondary" onclick="openMainPdf(${Number(w.page)||1})">PDF</button><button class="secondary" onclick="deleteWrong('${w.id}')">삭제</button></div></div>`).join(''):'<div class="card empty">아직 등록한 오답이 없습니다.</div>';
}
function deleteWrong(id){state.wrong=state.wrong.filter(w=>w.id!==id);saveState();renderWrong()}
byId('addWrongBtn').onclick=()=>byId('wrongDialog').showModal();
byId('wrongForm').addEventListener('submit',e=>{e.preventDefault(); const action=e.submitter?.value;if(action==='save'){state.wrong.push({id:crypto.randomUUID(),subjectId:byId('wrongSubject').value,page:byId('wrongPage').value,number:byId('wrongNumber').value,reason:byId('wrongReason').value,memo:byId('wrongMemo').value,nextReview:addDays(today(),3),created:new Date().toISOString()});saveState();renderWrong();e.target.reset()}byId('wrongDialog').close(action||'cancel')})

function renderExamInputs(){byId('examScoreInputs').innerHTML=subjects.filter(s=>s.required).map(s=>`<label>${escapeHtml(s.name)}<input type="number" min="0" max="100" step="5" data-score="${s.id}" placeholder="점수" /></label>`).join('')}
byId('addExamBtn').onclick=()=>{byId('examDate').value=today();byId('examDialog').showModal()}
byId('examForm').addEventListener('submit',e=>{e.preventDefault();const action=e.submitter?.value;if(action==='save'){const scores={};document.querySelectorAll('[data-score]').forEach(i=>scores[i.dataset.score]=Number(i.value||0));state.exams.push({id:crypto.randomUUID(),date:byId('examDate').value||today(),label:byId('examLabel').value||'기출 연습',scores});saveState();renderAll();e.target.reset()}byId('examDialog').close(action||'cancel')})
function examAvg(ex){const vals=subjects.filter(s=>s.required).map(s=>Number(ex.scores[s.id]||0));return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length)}
function renderExams(){
 const list=[...state.exams].sort((a,b)=>b.date.localeCompare(a.date));
 byId('examList').innerHTML=list.length?list.map(ex=>`<div class="card"><div class="subject-title"><div><h3>${escapeHtml(ex.label)}</h3><div class="muted small">${ex.date}</div></div><strong class="${examAvg(ex)>=60?'safe':'risk'}">평균 ${examAvg(ex)}점</strong></div><div class="score-grid">${subjects.filter(s=>s.required).map(s=>`<div class="score-cell"><span>${escapeHtml(s.name)}</span><strong class="${Number(ex.scores[s.id])<40?'risk':'safe'}">${Number(ex.scores[s.id]||0)}</strong></div>`).join('')}</div><div class="inline-actions" style="margin-top:10px"><button class="secondary" onclick="deleteExam('${ex.id}')">삭제</button></div></div>`).join(''):'<div class="card empty">산업기사 기출을 풀고 점수를 기록하세요.</div>';
}
function deleteExam(id){state.exams=state.exams.filter(x=>x.id!==id);saveState();renderAll()}
function renderScoreSummary(){
 const ex=[...state.exams].sort((a,b)=>b.date.localeCompare(a.date))[0];
 if(!ex){byId('scoreSummary').innerHTML='<div class="empty">기출 점수를 아직 기록하지 않았습니다.</div>';return}
 byId('scoreSummary').innerHTML=`<div class="subject-title"><div><h3>${escapeHtml(ex.label)}</h3><div class="muted small">${ex.date}</div></div><strong class="${examAvg(ex)>=60?'safe':'risk'}">평균 ${examAvg(ex)}점</strong></div><div class="score-grid">${subjects.filter(s=>s.required).map(s=>`<div class="score-cell"><span>${escapeHtml(s.name)}</span><strong class="${Number(ex.scores[s.id])<40?'risk':'safe'}">${Number(ex.scores[s.id]||0)}</strong></div>`).join('')}</div>`;
}

function updateSettingsUI(){byId('targetDate').value=state.settings.targetDate;byId('dailyMinutes').value=state.settings.dailyMinutes;byId('includeControl').checked=state.settings.includeControl;byId('syncApiUrl').value=syncConfig.url||DEFAULT_SYNC_URL;byId('syncApiKey').value=syncConfig.key||'';byId('autoSync').checked=Boolean(syncConfig.auto)}
byId('settingsForm').addEventListener('submit',e=>{e.preventDefault();state.settings.targetDate=byId('targetDate').value;state.settings.dailyMinutes=Number(byId('dailyMinutes').value||90);state.settings.includeControl=byId('includeControl').checked;saveState();renderAll();alert('설정을 저장했습니다.')})
byId('saveSyncConfigBtn').onclick=()=>{syncConfig={url:(byId('syncApiUrl').value||DEFAULT_SYNC_URL).trim(),key:byId('syncApiKey').value.trim(),auto:byId('autoSync').checked};saveSyncConfig();setSyncStatus('연결 설정을 저장했습니다. 연결 확인을 눌러주세요.');}
byId('testSyncBtn').onclick=()=>{syncConfig={url:(byId('syncApiUrl').value||DEFAULT_SYNC_URL).trim(),key:byId('syncApiKey').value.trim(),auto:byId('autoSync').checked};saveSyncConfig();testSync()}
byId('pullSyncBtn').onclick=()=>syncPull(false)
byId('pushSyncBtn').onclick=async()=>{if(!hasSyncConfig()){setSyncStatus('GAS 주소와 API_KEY를 먼저 저장하세요.','sync-warn');return}const remote=await apiGetState().catch(err=>{setSyncStatus('서버 확인 실패: '+err.message,'sync-bad');return null});if(!remote)return;const localRev=Number(state.meta?.revision||0), remoteRev=Number(remote.revision||0);if(localRev!==remoteRev&&!confirm('서버와 현재 기기의 버전이 다릅니다. 현재 기기 기록으로 덮어쓸까요?'))return;syncPush(localRev!==remoteRev,false)}
byId('resetDataBtn').onclick=()=>{if(confirm('학습 기록을 초기화할까요? PDF는 삭제되지 않습니다.')){const settings=state.settings;state=defaultState();state.settings=settings;saveState();renderAll()}}

function renderTimer(){const h=String(Math.floor(timerSeconds/3600)).padStart(2,'0'),m=String(Math.floor(timerSeconds%3600/60)).padStart(2,'0'),s=String(timerSeconds%60).padStart(2,'0');byId('timerText').textContent=`${h}:${m}:${s}`}
byId('timerToggle').onclick=()=>{if(timerHandle){clearInterval(timerHandle);timerHandle=null;byId('timerToggle').textContent='시작'}else{timerHandle=setInterval(()=>{timerSeconds++;renderTimer()},1000);byId('timerToggle').textContent='일시정지'}}
byId('timerReset').onclick=()=>{if(timerHandle){clearInterval(timerHandle);timerHandle=null}timerSeconds=0;renderTimer();byId('timerToggle').textContent='시작'}
byId('saveTime').onclick=()=>{const mins=Math.max(1,Math.round(timerSeconds/60));recordMinutes(mins);timerSeconds=0;renderTimer();alert(`${mins}분을 저장했습니다.`)}
byId('minimumMode').onclick=()=>{state.minimumMode=!state.minimumMode;saveState();renderHome()}

const DB='electricalStudyFiles'; const STORE='files';
function dbOpen(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE,{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function putFile(record){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function getFile(id){const db=await dbOpen();return new Promise((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function getAllFiles(){const db=await dbOpen();return new Promise((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function delFile(id){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
byId('mainPdfInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;await putFile({id:'main',type:'main',name:f.name,blob:f,created:new Date().toISOString()});renderResources();alert('기본 교재 PDF를 이 기기에 저장했습니다.')}
byId('pastPdfInput').onchange=async e=>{for(const f of e.target.files){await putFile({id:'past-'+crypto.randomUUID(),type:'past',name:f.name,blob:f,created:new Date().toISOString()})}renderResources()}
async function openMainPdf(page=1){
 const popup=window.open('about:blank','_blank');
 try{
  const f=await getFile('main');
  if(!f){if(popup)popup.close();alert('자료 메뉴에서 기본 교재 PDF를 먼저 선택하세요.');showView('resources');return}
  const url=URL.createObjectURL(f.blob);
  const target=`${url}#page=${page}`;
  if(popup){popup.location.href=target}else{window.location.href=target}
  setTimeout(()=>URL.revokeObjectURL(url),30*60*1000);
 }catch(err){if(popup)popup.close();alert('PDF를 열지 못했습니다. 자료 메뉴에서 PDF를 다시 등록해주세요.');console.error(err)}
}
async function openResource(id){
 const popup=window.open('about:blank','_blank');
 try{
  const f=await getFile(id);
  if(!f){if(popup)popup.close();return}
  const url=URL.createObjectURL(f.blob);
  if(popup){popup.location.href=url}else{window.location.href=url}
  setTimeout(()=>URL.revokeObjectURL(url),30*60*1000);
 }catch(err){if(popup)popup.close();alert('PDF를 열지 못했습니다. 파일을 다시 등록해주세요.');console.error(err)}
}
async function deleteResource(id){if(confirm('이 기기에서 PDF를 삭제할까요?')){await delFile(id);renderResources()}}
async function renderResources(){const files=await getAllFiles();const main=files.find(f=>f.id==='main');byId('mainPdfStatus').innerHTML=main?`저장됨: ${escapeHtml(main.name)} <button class="secondary" onclick="openMainPdf(1)">열기</button> <button class="secondary" onclick="deleteResource('main')">삭제</button>`:'아직 저장된 교재 PDF가 없습니다.';const past=files.filter(f=>f.type==='past');byId('pastPdfList').innerHTML=past.length?past.map(f=>`<div class="module-row"><div><h4>${escapeHtml(f.name)}</h4><div class="task-meta">${new Date(f.created).toLocaleDateString()}</div></div><div class="right-actions"><button class="secondary" onclick="openResource('${f.id}')">열기</button><button class="secondary" onclick="deleteResource('${f.id}')">삭제</button></div></div>`).join(''):'<div class="resource-status">추가된 기출 PDF가 없습니다.</div>'}
byId('exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`전기산업기사-학습기록-${today()}.json`;a.click()}
byId('importInput').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{state={...defaultState(),...JSON.parse(await f.text())};saveState();renderAll();alert('기록을 불러왔습니다.')}catch{alert('올바른 백업 파일이 아닙니다.')}}

function showView(name){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));byId('view-'+name).classList.add('active');document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));if(name==='resources')renderResources()}
document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>showView(b.dataset.view))
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;byId('installBtn').hidden=false})
byId('installBtn').onclick=async()=>{if(deferredInstallPrompt){deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;byId('installBtn').hidden=true}}

function renderAll(){renderHome();renderProgress();renderWrong();renderExams();updateSettingsUI()}
byId('wrongSubject').innerHTML=subjects.filter(s=>s.required).map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')
renderExamInputs();renderAll();renderResources();renderTimer();
if(hasSyncConfig()){setSyncStatus('연결 정보가 저장되어 있습니다. 서버 기록을 확인 중...');syncPull(true)}else{setSyncStatus('API_KEY를 입력한 뒤 연결 확인을 눌러주세요.')}
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});

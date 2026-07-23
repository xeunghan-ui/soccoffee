/* ============================================================
    설정 — 여기에 Supabase 정보를 넣으세요 (안내서 참고)
   비워두면 데모 모드(localStorage)로 작동합니다.
   ============================================================ */
const SUPABASE_URL = "https://fjgxhguogsuypcdzcieg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_K7TsALmaFyb2pPOZO-2i2w_UeirVr8l";

const PAGE_PASSWORD = "soccoffee";  // 입장 비밀번호 (바꾸려면 여기만 수정)
const ADMIN_PASSWORD = "soccoffee1234";  // 관리자 비밀번호 (모든 카풀 삭제 권한)
/* ============================================================ */

const TREATS = ['커피 한 잔', '음료수', '과일', '간식', '직접 입력'];
const USE_DB = SUPABASE_URL && SUPABASE_ANON_KEY;
const STORE = 'socoffee_carpool_v1';
let sb = null;

if (USE_DB) {
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  document.getElementById('demoNote').classList.remove('hidden');
}

/* ---------- 데이터 계층 (DB 또는 로컬) ---------- */
async function fetchRides() {
  if (USE_DB) {
    const { data, error } = await sb.from('rides').select('*').order('created_at', { ascending: false });
    if (error) { toast('불러오기 오류: ' + error.message); return []; }
    return data.map(r => ({
      id: r.id, driver: r.driver, place: r.place, date: r.ride_date,
      time: r.ride_time, seats: r.seats, dest: r.dest, riders: r.riders || []
    }));
  }
  try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch (e) { return []; }
}

async function insertRide(r) {
  if (USE_DB) {
    const { data, error } = await sb.from('rides').insert({
      driver: r.driver, place: r.place, ride_date: r.date, ride_time: r.time,
      seats: r.seats, dest: r.dest, riders: []
    }).select('id').single();
    if (error) { toast('등록 오류: ' + error.message); return null; }
    return data.id;
  }
  const local = await fetchRides();
  const id = Date.now();
  local.unshift({ ...r, id, riders: [] });
  localStorage.setItem(STORE, JSON.stringify(local));
  return id;
}

/* ---------- 내가 만든 카풀 (이 브라우저 기준) ---------- */
const MINE_KEY = 'socoffee_my_rides';
function getMyRides() { try { return JSON.parse(localStorage.getItem(MINE_KEY)) || []; } catch (e) { return []; } }
function addMyRide(id) { const a = getMyRides(); a.push(id); localStorage.setItem(MINE_KEY, JSON.stringify(a)); }
function isMine(id) { return getMyRides().map(String).includes(String(id)); }

/* ---------- 내가 신청한 좌석 (이 브라우저 기준) + 취소 규칙 ---------- */
const APPS_KEY = 'socoffee_my_apps';
function getMyApps() { try { return JSON.parse(localStorage.getItem(APPS_KEY)) || []; } catch (e) { return []; } }
function addMyApp(rid) { const a = getMyApps(); a.push(rid); localStorage.setItem(APPS_KEY, JSON.stringify(a)); }
function removeMyApp(rid) { localStorage.setItem(APPS_KEY, JSON.stringify(getMyApps().filter(x => x !== rid))); }
function isMyApp(rid) { return getMyApps().includes(rid); }
function departureMs(r) { return new Date(r.date + 'T' + (r.time || '00:00')).getTime(); }
function cancelable(r) { return Date.now() < departureMs(r) - 30 * 60 * 1000; }  // 출발 30분 전까지

// rid가 있으면 rid로, 없으면 순서(index)로 탑승자 제거
function dropRider(riders, index, target) {
  if (target && target.rid) return riders.filter(x => x.rid !== target.rid);
  return riders.filter((_, i) => i !== index);
}
async function removeRiderByIndex(rideId, index, target) {
  if (USE_DB) {
    const { data, error } = await sb.from('rides').select('riders').eq('id', rideId).single();
    if (error) { toast('오류: ' + error.message); return false; }
    const riders = dropRider(data.riders || [], index, target);
    const { error: e2 } = await sb.from('rides').update({ riders }).eq('id', rideId);
    if (e2) { toast('처리 오류: ' + e2.message); return false; }
    return true;
  }
  const local = await fetchRides();
  const r = local.find(x => x.id === rideId);
  if (!r) return false;
  r.riders = dropRider(r.riders, index, target);
  localStorage.setItem(STORE, JSON.stringify(local));
  return true;
}

/* ---------- 운영진 권한 (로그인한 사람이 운영진 명단에 있으면 자동) ---------- */
const ADMIN_NAMES = ['박승한'];                                  // 총괄관리자 — 전체 편집(최종 수정)
const SUB_ADMIN_NAMES = ['원재식','홍순인','최승호','정희범'];    // 일반 관리자 — 회비 현황 확인(읽기전용)만
const INJURED_NAMES = ['함지상'];   // 부상자 — 랭킹에서 제외
// 멤버 역할(표시용). type:'admin'=운영진 색, 'role'=그외 역할 색
const MEMBER_ROLES = {
  '박승한':{role:'구장 예약 및 총괄',type:'admin'},
  '원재식':{role:'총무',type:'admin'},
  '홍순인':{role:'경기 및 팀 운영',type:'admin'},
  '정희범':{role:'사진',type:'admin'},
  '최승호':{role:'장비',type:'admin'},
  '김이연':{role:'사진',type:'role'},
  '조은애':{role:'브랜드 및 디자인',type:'role'},
  '김균원':{role:'MD',type:'role'},
};
// 멤버 스킬(스파이더 차트) — club_settings.current.skills[memberId] = [{name,level(1~5)}]
async function getMemberSkills(id){ const s = await fetchSettings(); return ((s.skills||{})[id]) || []; }
async function saveMemberSkills(id, arr){
  const s = await fetchSettings();
  const skills = { ...(s.skills||{}) };
  if (arr && arr.length) skills[id] = arr; else delete skills[id];
  return await saveSettings({ skills });
}
function isAdmin() {   // 총괄관리자(전체 편집)
  const p = PLAYERS.find(x => x.id === getMe());
  return !!(p && ADMIN_NAMES.includes(p.name));
}
function isSubAdmin() {   // 일반 관리자 — 회비 현황 확인만
  const p = PLAYERS.find(x => x.id === getMe());
  return !!(p && SUB_ADMIN_NAMES.includes(p.name));
}
function isDuesViewer() { return isAdmin() || isSubAdmin(); }   // 회비 현황 열람 권한
function updateAdminBtn() {
  const opsTab = document.getElementById('opsTab');
  if (opsTab) opsTab.classList.toggle('hidden', !isAdmin());
  const ml = document.getElementById('meLabel');
  if (ml) ml.textContent = (typeof meName === 'function' && getMe()) ? `${meName()} 님${isAdmin() ? ' · 운영진' : ''}` : '';
  const tabOps = document.getElementById('tab-ops');
  if (!isAdmin() && tabOps && !tabOps.classList.contains('hidden')) switchTab('home');
}

// 좌석을 다시 확인하고 탑승자를 추가 (초과 예약 방지)
async function addRider(id, rider) {
  if (USE_DB) {
    const { data, error } = await sb.from('rides').select('seats, riders').eq('id', id).single();
    if (error) { toast('오류: ' + error.message); return false; }
    const riders = data.riders || [];
    if (riders.length >= data.seats) return 'full';
    riders.push(rider);
    const { error: e2 } = await sb.from('rides').update({ riders }).eq('id', id);
    if (e2) { toast('신청 오류: ' + e2.message); return false; }
    return true;
  }
  const local = await fetchRides();
  const r = local.find(x => x.id === id);
  if (!r) return false;
  if (r.riders.length >= r.seats) return 'full';
  r.riders.push(rider);
  localStorage.setItem(STORE, JSON.stringify(local));
  return true;
}

async function deleteRide(id) {
  if (USE_DB) {
    const { error } = await sb.from('rides').delete().eq('id', id);
    if (error) { toast('삭제 오류: ' + error.message); return false; }
    return true;
  }
  const local = (await fetchRides()).filter(r => r.id !== id);
  localStorage.setItem(STORE, JSON.stringify(local));
  return true;
}

/* ---------- UI ---------- */
const ALL_TABS = ['home','att','dues','list','potm','rank','more','mine','faq','squad','ops','draft'];
const _tabScroll = {};   // 탭별 마지막 스크롤 위치 — 탭을 오가도 보던 자리 유지
function switchTab(tab, mode) {
  if (tab === 'ops' && !isAdmin()) tab = 'home';   // 운영진 전용 탭은 비운영진 직접 접근 차단
  const prevTab = ALL_TABS.find(t => { const el = document.getElementById('tab-' + t); return el && !el.classList.contains('hidden'); });
  if (prevTab) _tabScroll[prevTab] = window.scrollY;
  const memberTabs = ['squad','list','potm','rank'];   // 멤버 탭 묶음(멤버현황·카풀·투표·랭킹)
  const navActive = memberTabs.includes(tab) ? 'member' : (['home','att'].includes(tab) ? tab : 'more');
  document.querySelectorAll('.bnav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === navActive));
  ALL_TABS.forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (el) el.classList.toggle('hidden', t !== tab);
  });
  // 멤버 서브탭 바 표시/활성
  const msub = document.getElementById('memberSubnav');
  if (msub) {
    msub.classList.toggle('hidden', !memberTabs.includes(tab));
    msub.querySelectorAll('.msub').forEach(b => b.classList.toggle('on', b.dataset.sub === tab));
  }
  // 히스토리: 기본은 pushState(탭마다 항목 → 뒤로가기로 탭 이동). 'replace'=초기/대체, 'none'=뒤로가기 처리 중(조작 안 함)
  if (mode !== 'none' && location.hash.slice(1) !== tab) {
    try {
      if (mode === 'replace') history.replaceState(null, '', '#' + tab);
      else history.pushState(null, '', '#' + tab);
    } catch(e){ location.hash = tab; }
  }
  // 스크롤: 같은 탭 재클릭이면 그대로 두고, 다른 탭이면 그 탭에서 마지막 보던 위치 복원(첫 방문은 맨 위)
  if (mode !== 'none' && prevTab !== tab) {
    const _y = _tabScroll[tab] || 0;
    try { window.scrollTo(0, _y); document.scrollingElement.scrollTop = _y; } catch(e){}
  }
  if (tab === 'home') renderHome();
  if (tab === 'att')  renderAtt();
  if (tab === 'dues') renderDues();
  if (tab === 'list') render();
  if (tab === 'potm') renderPotm();
  if (tab === 'rank') renderRank();
  if (tab === 'ops')  renderOps();
  if (tab === 'more') renderMore();
  if (tab === 'mine') renderMine();
  if (tab === 'faq')  renderFaq();
  if (tab === 'squad') renderSquad();
  if (tab === 'draft') draftRender();
}

// 카풀 등록 패널 펼치기/접기 (등록 탭을 카풀 탭으로 통합)
function toggleCreate(forceClose) {
  const panel = document.getElementById('createPanel');
  const btn = document.getElementById('createToggle');
  if (!panel) return;
  const open = forceClose ? false : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !open);
  if (btn) btn.textContent = open ? '닫기' : '+ 카풀 등록하기';
  if (open) { setDefaults(); const f = document.getElementById('f-driver'); if (f) { if (!f.value) f.value = meName(); f.focus(); } }
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2400);
}

function val(id) { return document.getElementById(id).value.trim(); }

function onDestChange() {
  const custom = document.getElementById('f-dest');
  custom.classList.toggle('hidden', document.getElementById('f-dest-sel').value !== '__custom__');
  if (document.getElementById('f-dest-sel').value === '__custom__') custom.focus();
}

// 기본값: 다음 수요일(오늘이 수요일이면 오늘), 오후 8시
function setDefaults() {
  const now = new Date();
  let diff = (3 - now.getDay() + 7) % 7;            // 3 = 수요일
  if (diff === 0 && now.getHours() >= 21) diff = 7;  // 오늘 수요일이고 밤이면 다음 주
  const wed = new Date(now); wed.setDate(now.getDate() + diff);
  const yyyy = wed.getFullYear(), mm = String(wed.getMonth() + 1).padStart(2, '0'), dd = String(wed.getDate()).padStart(2, '0');
  const dateEl = document.getElementById('f-date'), timeEl = document.getElementById('f-time');
  if (!dateEl.value) dateEl.value = `${yyyy}-${mm}-${dd}`;
  if (!timeEl.value) timeEl.value = '20:00';
}
setDefaults();

async function createRide() {
  const driver = val('f-driver'), place = val('f-place'),
        date = val('f-date'), time = val('f-time'),
        seats = parseInt(val('f-seats'));
  const destSel = document.getElementById('f-dest-sel').value;
  const dest = destSel === '__custom__' ? val('f-dest') : destSel;
  if (!driver) return toast('이름을 입력해 주세요');
  if (!place)  return toast('출발 장소를 입력해 주세요');
  if (!date || !time) return toast('출발 날짜와 시간을 입력해 주세요');

  const btn = document.getElementById('createBtn');
  btn.disabled = true; btn.textContent = '등록 중...';
  const newId = await insertRide({ driver, place, date, time, seats, dest });
  btn.disabled = false; btn.textContent = '카풀 등록하기';
  if (!newId) return;
  addMyRide(newId);

  ['f-driver','f-place','f-dest'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-seats').value = '3';
  document.getElementById('f-dest-sel').value = '상암 풋살장';
  onDestChange();
  setDefaults();
  await rerender(render);
  toggleCreate(true);
  toast('카풀이 등록됐어요');
}

function fmtDate(d, t) {
  if (!d) return '';
  const dt = new Date(d + 'T' + (t || '00:00'));
  const days = ['일','월','화','수','목','금','토'];
  const m = dt.getMonth() + 1, day = dt.getDate(), wd = days[dt.getDay()];
  let hh = dt.getHours(), mm = String(dt.getMinutes()).padStart(2, '0');
  const ampm = hh < 12 ? '오전' : '오후';
  let h12 = hh % 12; if (h12 === 0) h12 = 12;
  return `${m}/${day}(${wd}) ${ampm} ${h12}:${mm}`;
}

function rideCard(r, past) {
  const taken = r.riders.length, left = r.seats - taken, full = left <= 0;
  // 제작자 판별: 로그인 이름(=driver) 일치 or 등록한 기기(isMine). 운영진은 관리 권한으로 삭제 가능.
  const _meNm = (typeof meName==='function') ? (meName()||'') : '';
  const isCreator = isMine(r.id) || (!!_meNm && !!r.driver && _meNm.trim() === String(r.driver).trim());
  const owner = isCreator || isAdmin();
  const ridersHtml = taken === 0
    ? `<div class="empty-riders">${past ? '신청자가 없었어요.' : '아직 신청자가 없어요. 첫 탑승자가 되어보세요!'}</div>`
    : r.riders.map((rd, i) => {
        if (past) return `<span class="rider-chip">${esc(rd.name)}${rd.treat ? ` · <span class="treat">${esc(rd.treat)}</span>` : ''}</span>`;
        const own = !!(rd.rid && isMyApp(rd.rid));
        const canShow = own || isAdmin();
        const canX = isAdmin() || (own && cancelable(r));
        const x = canShow ? `<button class="chip-x" onclick="cancelSeat('${r.id}',${i},${own})" title="${canX ? (isAdmin() && !own ? '탑승자 빼기' : '탑승 취소') : '출발 30분 전이라 취소 불가'}" ${canX ? '' : 'disabled'}>✕</button>` : '';
        return `<span class="rider-chip">${esc(rd.name)}${rd.treat ? ` · <span class="treat">${esc(rd.treat)}</span>` : ''}${x}</span>`;
      }).join('');

  const actions = past
    ? `${owner ? `<button class="btn accent sm" onclick="repostRide('${r.id}')">다시 올리기</button>` : `<span class="past-hint">지난 카풀이에요</span>`}
       ${owner ? `<button class="btn ghost sm" onclick="toggleManage('${r.id}')" title="관리"></button>` : ''}`
    : `${full ? `<button class="btn sm" disabled>좌석 마감</button>`
              : `<button class="btn accent sm" onclick="toggleApply('${r.id}')">탑승 신청</button>`}
       ${owner ? `<button class="btn ghost sm" onclick="toggleManage('${r.id}')" title="관리"></button>` : ''}`;

  return `
    <div class="ride ${(full && !past) ? 'full' : ''} ${past ? 'past' : ''}">
      <div class="ride-top">
        <div class="driver">${esc(r.driver)} 님</div>
        <div class="seats-badge ${past ? 'done' : (full ? 'full' : '')}">${past ? '종료' : (full ? '마감' : `잔여 ${left}석`)}</div>
      </div>
      <div class="ride-meta">
        <div class="meta-line meta-place">${esc(r.place)}${r.dest ? ` <span class="dest-part"><span class="sep">→</span> ${esc(r.dest)}</span>` : ''}</div>
        <div class="meta-line">${fmtDate(r.date, r.time)} <span class="sep">·</span> ${taken}/${r.seats}명</div>
      </div>
      <div class="riders">
        <button class="riders-toggle" onclick="toggleRiders('${r.id}')">
          <span>탑승자 ${taken}명</span><span class="chev" id="chev-${r.id}">▾</span>
        </button>
        <div class="riders-body" id="riders-${r.id}">${ridersHtml}</div>
      </div>
      <div class="ride-actions">${actions}</div>
      ${owner ? `<div class="manage-panel" id="manage-${r.id}">
        <span class="manage-label">${isCreator ? '내가 등록한 카풀이에요' : '관리자 권한으로 삭제'}</span>
        <button class="btn ghost sm" onclick="removeRide('${r.id}')" style="color:var(--red)">삭제하기</button>
      </div>` : ''}
      ${past ? '' : `<div class="apply-panel" id="apply-${r.id}">
        <p class="apply-note" style="margin-bottom:10px"><b>${esc(meName())}</b> 님으로 신청해요.</p>
        <div class="field">
          <label>답례 <span style="color:var(--muted);font-weight:400">(선택 — 안 골라도 신청 가능)</span></label>
          <div class="treat-chips" id="tc-${r.id}">
            ${TREATS.map(t => `<span class="treat-opt" onclick="pickTreat('${r.id}', this, '${t}')">${t}</span>`).join('')}
          </div>
          <input class="hidden" id="tcustom-${r.id}" placeholder="직접 입력 (예: 아이스아메리카노 살게요)" maxlength="30" style="margin-top:8px">
        </div>
        <p class="apply-note">신청 후 <b>출발 30분 전까지</b> 직접 취소할 수 있어요. (탑승자 목록에서 내 이름 옆 ✕)</p>
        <button class="btn accent sm" onclick="applyRide('${r.id}')">신청 완료</button>
      </div>`}
    </div>`;
}

async function render() {
  const list = document.getElementById('rideList');
  const pastSection = document.getElementById('pastSection');
  const pastList = document.getElementById('pastList');
  if (!list.innerHTML.trim()) list.innerHTML = `<div class="empty">불러오는 중...</div>`;
  const rides = await fetchRides();
  const _lt = document.getElementById('tab-list');
  if (_lt && !_lt.classList.contains('hidden')) markRidesSeen(rides);  // 카풀 탭이 실제로 열려 있을 때만 신규 점 해제
  else refreshNewBadges();
  const now = Date.now();
  // 지난 카풀은 '전월 1일' 이후만 표시(그 이전은 자동 숨김). 데이터는 지우지 않음.
  const _nd = new Date();
  const _cut = `${new Date(_nd.getFullYear(), _nd.getMonth()-1, 1).getFullYear()}-${String(new Date(_nd.getFullYear(), _nd.getMonth()-1, 1).getMonth()+1).padStart(2,'0')}-01`;
  const active = rides.filter(r => departureMs(r) >= now);
  const past = rides.filter(r => departureMs(r) < now && (r.date||'') >= _cut).sort((a, b) => departureMs(b) - departureMs(a));

  list.innerHTML = active.length === 0
    ? `<div class="empty"><div class="big"></div><div>진행 중인 카풀이 없어요.<br>새 카풀을 등록해 보세요!</div></div>`
    : active.map(r => rideCard(r, false)).join('');

  if (past.length === 0) {
    pastSection.classList.add('hidden');
    pastList.innerHTML = '';
  } else {
    pastSection.classList.remove('hidden');
    document.getElementById('pastCount').textContent = `${past.length}건`;
    pastList.innerHTML = past.map(r => rideCard(r, true)).join('');
  }
}

// 같은 요일·시간 그대로, 다음 주(미래)로 날짜만 이동
function nextWeekDate(origDateStr) {
  const d = new Date((origDateStr || '') + 'T00:00');
  if (isNaN(d.getTime())) return origDateStr;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  while (d <= today) d.setDate(d.getDate() + 7);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

async function repostRide(id) {
  const rides = await fetchRides();
  const r = rides.find(x => String(x.id) === String(id));
  if (!r) return;
  const newDate = nextWeekDate(r.date);
  const newId = await insertRide({ driver: r.driver, place: r.place, date: newDate, time: r.time, seats: r.seats, dest: r.dest });
  if (!newId) return;
  addMyRide(newId);
  await rerender(render);
  toast(`다시 올렸어요 — ${fmtDate(newDate, r.time)} `);
}

function togglePast() {
  document.getElementById('pastList').classList.toggle('open');
  document.getElementById('pastChev').classList.toggle('open');
}

function toggleApply(id) {
  const p = document.getElementById('apply-' + id);
  document.querySelectorAll('.apply-panel').forEach(el => { if (el !== p) el.classList.remove('open'); });
  p.classList.toggle('open');
}

function toggleRiders(id) {
  document.getElementById('riders-' + id).classList.toggle('open');
  document.getElementById('chev-' + id).classList.toggle('open');
}

function toggleManage(id) {
  const p = document.getElementById('manage-' + id);
  document.querySelectorAll('.manage-panel').forEach(el => { if (el !== p) el.classList.remove('open'); });
  p.classList.toggle('open');
}

const treatPick = {};
function pickTreat(id, el, label) {
  const box = document.getElementById('tc-' + id);
  box.querySelectorAll('.treat-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  const custom = document.getElementById('tcustom-' + id);
  if (label === '직접 입력') { custom.classList.remove('hidden'); custom.focus(); treatPick[id] = '__custom__'; }
  else { custom.classList.add('hidden'); treatPick[id] = label; }
}

async function applyRide(id) {
  const name = meName();
  if (!name) return toast('로그인이 필요해요');
  // 1인 1신청: 아직 출발 안 한 카풀 중 이미 내 이름으로 신청된 게 있으면 차단(같은 카풀 중복 포함)
  if (!isAdmin()) {
    const _rides = await fetchRides();
    const _dup = _rides.find(x => departureMs(x) > Date.now() && (x.riders||[]).some(rd => (rd.name||'').trim() === name.trim()));
    if (_dup) { toast(`이미 '${_dup.driver} 님' 카풀에 신청돼 있어요. 바꾸려면 먼저 취소해 주세요.`); return; }
  }
  let treat = treatPick[id] || '';
  if (treat === '__custom__') treat = document.getElementById('tcustom-' + id).value.trim();

  const rid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const res = await addRider(idCast(id), { name, treat, rid });
  if (res === 'full') { await render(); return toast('아쉽게도 좌석이 마감됐어요'); }
  if (!res) return;
  addMyApp(rid);
  delete treatPick[id];
  await rerender(render);
  toast('탑승 신청 완료! ');
}

async function cancelSeat(rideId, index, own) {
  const admin = isAdmin();
  const rides = await fetchRides();
  const r = rides.find(x => String(x.id) === String(rideId));
  if (!r) return;
  if (!admin && !(own && cancelable(r))) return toast('출발 30분 전부터는 취소할 수 없어요');
  const target = r.riders[index];
  const msg = admin && !own ? `'${target ? target.name : ''}' 님을 탑승에서 뺄까요?` : '탑승을 취소할까요?';
  if (!confirm(msg)) return;
  const ok = await removeRiderByIndex(idCast(rideId), index, target);
  if (!ok) return;
  if (target && target.rid) removeMyApp(target.rid);
  await rerender(render);
  toast(admin && !own ? '탑승자를 뺐어요' : '탑승을 취소했어요');
}

async function removeRide(id) {
  if (!confirm('이 카풀을 삭제할까요?')) return;
  const ok = await deleteRide(idCast(id));
  if (!ok) return;
  await rerender(render);
  toast('삭제했어요');
}

// DB는 숫자 id, 로컬은 숫자 id → 문자열로 넘어온 걸 복원
function idCast(id) { return USE_DB ? Number(id) : Number(id); }

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
// HTML 이스케이프 후 URL을 클릭 가능한 링크로
function linkify(s) {
  return esc(s).replace(/(https?:\/\/[^\s<]+)/g,
    u => `<a href="${u}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline;word-break:break-all">${u}</a>`);
}
// 노출 기간: 시작(publish_at) 전이거나 종료(hide_at) 후면 숨김
function noticeVisible(n){
  const now = new Date();
  if (n.publish_at && new Date(n.publish_at) > now) return false;
  if (n.hide_at && new Date(n.hide_at) < now) return false;
  return true;
}
function toDateInput(iso){ if(!iso) return ''; const d=new Date(iso); if(isNaN(d))return ''; const p=x=>String(x).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }
function mdLabel(iso){ const d=new Date(iso); if(isNaN(d))return ''; return `${d.getMonth()+1}/${d.getDate()}`; }
let opsEditNoticeId = null;
let opsEditSessionId = null;
let opsAddSessionOpen = false;

// 실시간 갱신 (DB 모드일 때, 다른 사람의 변경을 자동 반영)
if (USE_DB) {
  sb.channel('rides-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => rerender(render))
    .subscribe();
}

/* ============================================================
   이달의 선수 (POTM) 투표
   - 명단 스냅샷: soccoffee-team-builder 기준 (명단 변경 시 ROSTER만 수정)
   - 후보/투표자 = 해당 월 '활동 회원' (휴면·친구등급·미가입 제외)
   - 규칙: 본인 이름 선택 → 1인 1표(엄격), 본인 투표 금지
   - 결과: 본인이 투표한 뒤(또는 관리자)에만 열람
   ============================================================ */
const ROSTER_SEED = [
  {id:1, name:'박승한', tier:1, status:'active', joinDate:'2024-09-04'},
  {id:2, name:'홍순인', tier:1, status:'active', joinDate:'2024-09-04'},
  {id:3, name:'손다희', tier:2, status:'active', joinDate:'2024-09-04'},
  {id:4, name:'정희범', tier:4, status:'active', joinDate:'2024-09-04'},
  {id:5, name:'김이연', tier:2, status:'active', joinDate:'2024-09-25', dormantMonths:["2026-06"]},
  {id:6, name:'원재식', tier:3, status:'active', joinDate:'2024-09-04'},
  {id:7, name:'장세영', tier:3, status:'active', joinDate:'2024-09-04'},
  {id:8, name:'김우경', tier:2, status:'active', joinDate:'2024-09-04'},
  {id:9, name:'최승호', tier:2, status:'active', joinDate:'2024-09-11'},
  {id:10, name:'마상현', tier:3, status:'active', joinDate:'2024-09-11'},
  {id:11, name:'박지원', tier:2, status:'active', joinDate:'2024-09-25'},
  {id:12, name:'신동헌', tier:1, status:'active', joinDate:'2024-09-25'},
  {id:13, name:'정민주', tier:2, status:'friends', joinDate:'2024-09-25', friendsSince:'2026-06', dormantMonths:["2025-11","2025-12","2026-02","2026-03","2026-04","2026-05"]},
  {id:14, name:'임한', tier:2, status:'active', joinDate:'2024-10-24'},
  {id:15, name:'이민국', tier:4, status:'active', joinDate:'2024-10-31'},
  {id:16, name:'정하림', tier:1, status:'active', joinDate:'2024-12-05'},
  {id:17, name:'박원주', tier:2, status:'active', joinDate:'2025-01-02'},
  {id:18, name:'김두은', tier:1, status:'active', joinDate:'2025-04-02'},
  {id:19, name:'표승철', tier:2, status:'active', joinDate:'2025-05-07'},
  {id:20, name:'한승재', tier:2, status:'active', joinDate:'2025-06-04'},
  {id:21, name:'도민환', tier:2, status:'active', joinDate:'2025-06-04', dormantMonths:["2026-05"]},
  {id:22, name:'조수경', tier:1, status:'active', joinDate:'2025-08-06', dormantMonths:["2026-05"]},
  {id:23, name:'안재영', tier:2, status:'active', joinDate:'2025-04-02', dormantMonths:["2026-05"]},
  {id:24, name:'브루노', tier:2, status:'active', joinDate:'2025-08-06'},
  {id:25, name:'박우성', tier:1, status:'active', joinDate:'2024-09-11', dormantMonths:["2026-05"]},
  {id:26, name:'조은애', tier:3, status:'active', joinDate:'2025-09-03'},
  {id:27, name:'함지상', tier:3, status:'dormant', joinDate:'2025-09-10', dormantMonths:["2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06"]},
  {id:28, name:'조수연', tier:2, status:'active', joinDate:'2025-10-01'},
  {id:29, name:'한재욱', tier:2, status:'active', joinDate:'2025-10-01'},
  {id:30, name:'정은용', tier:2, status:'active', joinDate:'2025-11-05'},
  {id:31, name:'박광우', tier:2, status:'active', joinDate:'2025-03-12'},
  {id:32, name:'이일웅', tier:1, status:'active', joinDate:'2024-10-16'},
  {id:33, name:'허은혜', tier:3, status:'active', joinDate:'2026-03-04'},
  {id:34, name:'심소른', tier:3, status:'active', joinDate:'2026-04-01'},
  {id:35, name:'김균원', tier:3, status:'active', joinDate:'2024-10-16'},
  {id:36, name:'조지훈', tier:3, status:'active', joinDate:'2026-04-01'},
  {id:37, name:'이희성', tier:3, status:'active', joinDate:'2026-04-15'},
  {id:38, name:'김유솔', tier:2, status:'active', joinDate:'2026-05-06'},
  {id:39, name:'김재유', tier:3, status:'active', joinDate:'2026-05-06'},
];

/* 이번 달 팀 시트 (WHITE / BLACK) — 팀 편성이 바뀌면 여기만 수정 */
const TEAM_SHEET_SEED = {
  // WHITE
  '장세영':{jersey:3,  eng:'JANG SAEYOUNG',        team:'WHITE'},
  '한승재':{jersey:6,  eng:'HAN SEUNGJAE',         team:'WHITE'},
  '최승호':{jersey:7,  eng:'CHOI SEUNGHO',         team:'WHITE'},
  '박승한':{jersey:9,  eng:'PARK SEUNGHAN',        team:'WHITE'},
  '조수경':{jersey:12, eng:'CHO SOOKYUNG',         team:'WHITE'},
  '마상현':{jersey:13, eng:'MA SANGHYUN',          team:'WHITE'},
  '김우경':{jersey:14, eng:'KIM WOOKYUNG',         team:'WHITE'},
  '조수연':{jersey:15, eng:'CHO SOOYEON',          team:'WHITE', cap:true},
  '정희범':{jersey:18, eng:'JEONG HEEBEOM',        team:'WHITE'},
  '이일웅':{jersey:21, eng:'LEE ILWOONG',          team:'WHITE'},
  '박우성':{jersey:26, eng:'PARK WOOSUNG',         team:'WHITE'},
  '김두은':{jersey:32, eng:'KIM DOOEUN',           team:'WHITE'},
  '이민국':{jersey:33, eng:'LEE MINKUK',           team:'WHITE'},
  '김유솔':{jersey:55, eng:'KEEMYOU SOL',          team:'WHITE'},
  '조은애':{jersey:89, eng:'CHO EUNAE',            team:'WHITE'},
  '브루노':{jersey:93, eng:'DA CONCEICAO BRUNO',   team:'WHITE'},
  '안재영':{jersey:22, eng:'AN JAEYOUNG',          team:'WHITE'},
  '원재식':{jersey:99, eng:'WON JAESIK',           team:'WHITE'},
  // BLACK
  '박광우':{jersey:4,   eng:'PARK KWANGWOO',        team:'BLACK'},
  '신동헌':{jersey:5,   eng:'SHIN DONGHUN',         team:'BLACK'},
  '홍순인':{jersey:10,  eng:'HONG SUNIN',           team:'BLACK'},
  '정은용':{jersey:11,  eng:'CHUNG EUNYONG',        team:'BLACK'},
  '김균원':{jersey:16,  eng:'KIM KYUNWON',          team:'BLACK'},
  '임한':  {jersey:17,  eng:'LIM HAN',              team:'BLACK', cap:true},
  '심소른':{jersey:19,  eng:'SIM SORUN',            team:'BLACK'},
  '정하림':{jersey:23,  eng:'JEONG HARIM',          team:'BLACK'},
  '박원주':{jersey:25,  eng:'PARK WONJU',           team:'BLACK'},
  '박지원':{jersey:29,  eng:'PARK JIWON',           team:'BLACK'},
  '조지훈':{jersey:37,  eng:'JO JIHOON',            team:'BLACK'},
  '김재유':{jersey:58,  eng:'KIM JAEYU',            team:'BLACK'},
  '한재욱':{jersey:62,  eng:'HAN JAEWOOK',          team:'BLACK'},
  '도민환':{jersey:76,  eng:'DO MINHWAN',           team:'BLACK'},
  '이희성':{jersey:77,  eng:'LEE HEESUNG',          team:'BLACK'},
  '손다희':{jersey:87,  eng:'SON DAHEE',            team:'BLACK'},
  '허은혜':{jersey:88,  eng:'HEO EUNHYE',           team:'BLACK'},
  '표승철':{jersey:328, eng:'PYO SEUNGCHUL',        team:'BLACK'},
};

/* ---------- 명단(players) — 운영진 탭에서 편집, Supabase(club_settings.roster)에 저장 ----------
   ROSTER / TEAM_SHEET 는 players 배열에서 파생됩니다.
   저장된 명단이 없으면 위 SEED로 시작하고, 운영진이 편집하면 그게 source of truth가 됩니다. */
function seedPlayers() {
  return ROSTER_SEED.map(r => {
    const t = TEAM_SHEET_SEED[r.name] || {};
    return { id:r.id, name:r.name, tier:r.tier, status:r.status||'active',
      joinDate:r.joinDate||'', friendsSince:r.friendsSince||null,
      dormantMonths:(r.dormantMonths||[]).slice(),
      jersey:(t.jersey!=null?t.jersey:null), eng:t.eng||'', team:t.team||'기타', cap:!!t.cap };
  });
}
let PLAYERS = seedPlayers();
let ROSTER = [];
let TEAM_SHEET = {};
function applyPlayers(players) {
  PLAYERS = players;
  ROSTER = players.map(p => {
    const o = { id:p.id, name:p.name, tier:p.tier, status:p.status||'active',
      joinDate:p.joinDate||'', dormantMonths:(p.dormantMonths||[]).slice(), activeMonths:(p.activeMonths||[]).slice() };
    if (p.friendsSince) o.friendsSince = p.friendsSince;
    return o;
  });
  TEAM_SHEET = {};
  players.forEach(p => {
    TEAM_SHEET[p.name] = { jersey:(p.jersey!=null?p.jersey:null), eng:p.eng||'', team:p.team||'기타', cap:!!p.cap };
  });
}
applyPlayers(PLAYERS);   // 초기엔 SEED 기준 (시작 시 Supabase 명단으로 덮어씀)

// 팀빌더에만 있는 멤버를 사이트 명단에 병합 → 로그인·참석·회비 가능
async function mergeTbMembers() {
  let tb = null;
  try { tb = await fetchTeamBuilder(); } catch(e) {}
  if (!tb || !Array.isArray(tb.players)) return;
  // 팀빌더를 명단 단일 출처로: 등번호·티어·상태·휴면을 팀빌더 기준으로 구성(전 멤버 동기화)
  const seen = new Set();
  const players = [];
  tb.players.forEach(tp => {
    if ((tp.status||'active') === 'former') return;   // 탈퇴 제외
    if (seen.has(tp.name)) return;                     // 중복 이름 방지
    seen.add(tp.name);
    const t = TEAM_SHEET[tp.name] || {};               // 팀(WHITE/BLACK)은 사이트 배정 유지
    players.push({ id:tp.id, name:tp.name, tier:tp.tier, status:tp.status||'active',
      joinDate:tp.joinDate||'', friendsSince:tp.friendsSince||null,
      dormantMonths:(tp.dormantMonths||[]).slice(), activeMonths:(tp.activeMonths||[]).slice(),
      jersey:(tp.jersey!=null?tp.jersey:null), eng:tp.engName||'',
      team:t.team||'기타', cap:!!t.cap });
  });
  if (players.length) applyPlayers(players);
}

async function fetchRoster() {
  const s = await fetchSettings();
  return Array.isArray(s.roster) && s.roster.length ? s.roster : null;
}

const POTM_STORE = 'socoffee_potm_votes_v1'; // 데모 모드 저장소
const POTM_VOTER_KEY = 'socoffee_potm_voter'; // 이 브라우저의 투표자 이름(편의용)

function potmMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function potmMonthLabel(m) {
  const [y, mo] = m.split('-');
  return `${y}년 ${parseInt(mo)}월`;
}
// 연간 운영 시즌: 팀 리그(3·5·9·11월) vs 일반(그 외 전부 — 혹서기·혹한기 포함). 팀 리그는 20–23시.
const LEAGUE_MONTHS = [3, 5, 9, 11];
function monthNumOf(dateOrMonth) {
  if (dateOrMonth == null) return new Date().getMonth() + 1;
  if (typeof dateOrMonth === 'number') return dateOrMonth;
  const s = String(dateOrMonth); const p = s.split('-');
  if (p.length >= 2) return parseInt(p[1], 10);
  const d = new Date(s); return isNaN(d) ? new Date().getMonth() + 1 : d.getMonth() + 1;
}
function isLeague(dateOrMonth) { return LEAGUE_MONTHS.includes(monthNumOf(dateOrMonth)); }
function seasonLabel(dateOrMonth) { return isLeague(dateOrMonth) ? '팀 리그' : '일반'; }
// 시즌별 기본 세션 시간: 팀 리그 20:00–23:00, 일반 21:00–23:00
function seasonDefaultTime(dateOrMonth) { return isLeague(dateOrMonth) ? { start:'20:00', end:'23:00' } : { start:'21:00', end:'23:00' }; }
// 회비 표시 월: 매월 15일부터 다음 달 회비를 띄움 (활동/휴면 확인·투표와 동일 기준)
function duesMonth() {
  const d = new Date();
  let y = d.getFullYear(), m = d.getMonth(); // 0-indexed
  if (d.getDate() >= 15) { m += 1; if (m > 11) { m = 0; y += 1; } }
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}
// 홈 상태박스 기준월: 매월 15일부터 다음 달
// 다음 달 '활동/휴면 셀프 토글·자동 롤오버' 기능 시작일. 이 날 전에는 토글 대신 상태 뱃지만(저장 없음).
// (월 표시 자체는 기존대로 15일부터 다음 달 — 회비 탭과 일관)
const DORM_FEATURE_START = new Date('2026-07-15T00:00:00');
function dormFeatureOn() { return new Date() >= DORM_FEATURE_START; }
function statusMonth() {
  const d = new Date();
  let y = d.getFullYear(), m = d.getMonth();
  if (d.getDate() >= 15) { m += 1; if (m > 11) { m = 0; y += 1; } }
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

// 투표 오픈 시각: 그 달 25일 0시 (= 매월 25일부터 말일까지 그 달 MVP·성장 투표)
function votingOpensAt() {
  const d = new Date();
  d.setDate(25);
  d.setHours(0, 0, 0, 0);
  return d;
}
// 투표 가능: 매월 25일 0시 ~ 말일 끝(1~24일은 잠금). 다음 달 25일 전까지 닫혀 있어 "그 달까지만" 투표됨.
function isVotingOpen() { return Date.now() >= votingOpensAt().getTime(); }
function fmtOpenTime(d) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${days[d.getDay()]})`;
}

// 전 달(확정) MVP·성장 당선자 id (홈·이미지·소개 공용). 캐시.
let _prevWinners = null;
async function getPrevWinners(){
  if (_prevWinners) return _prevWinners;
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-1);
  const pm = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const topId = votes => { const t={}; (votes||[]).forEach(v=>{ t[v.candidate_id]=(t[v.candidate_id]||0)+1; }); let b=null,bc=0; for(const k in t){ if(t[k]>bc){bc=t[k]; b=Number(k);} } return b; };
  try {
    const [mvp, growth] = await Promise.all([fetchVotes(pm,'mvp'), fetchVotes(pm,'growth')]);
    _prevWinners = { mvp: topId(mvp), growth: topId(growth), month: pm };
  } catch(e){ _prevWinners = { mvp:null, growth:null, month:pm }; }
  return _prevWinners;
}
function myWinTitles(id, w){ return [(id!=null&&id===w.mvp)?'MVP':'', (id!=null&&id===w.growth)?'성장':''].filter(Boolean); }

// 올해 모범생 랭킹 등수 (renderRank model과 동일 계산) — {rank,total} 또는 null
async function getModelRank(memberId){
  try{
    const tb = await fetchTeamBuilder();
    if(!tb || !Array.isArray(tb.sessions) || !tb.sessions.length) return null;
    const year = String(new Date().getFullYear());
    const sess = tb.sessions.filter(s=>(s.date||'').startsWith(year));
    if(!sess.length) return null;
    const players = (tb.players||[]).filter(p=>{ const st=p.status||'active'; return st!=='former'&&st!=='friends'; });
    const min = Math.ceil(sess.length*0.5);
    const vs = await getVoteStats(year);
    const voteRate = p => { if(!vs.voteMonths.length) return 1; const c=vs.voteMonths.filter(mo=>vs.voterByMonth[mo].has(p.id)).length; return c/vs.voteMonths.length; };
    const data = players.map(p=>{ const r=rkAtt(p,sess); if(r.counted<min) return null; const pm=new Set(sess.filter(s=>rkInPool(p,s.date)).map(s=>s.date.slice(0,7))); const dm=new Set((p.dormantMonths||[]).filter(mo=>pm.has(mo))); const dr=pm.size>0?Math.round(dm.size/pm.size*1000)/10:0; const poolS=sess.filter(s=>rkInPool(p,s.date)&&!rkDormant(p,s.date.slice(0,7))); const lmaCnt=poolS.filter(s=>(s.lastMinuteAbsentIds||[]).includes(p.id)).length; const lmaRate=poolS.length>0?Math.round(lmaCnt/poolS.length*1000)/10:0; const vr=voteRate(p); const win=vs.winsByMember[p.id]||0; const misV=Math.round((1-vr)*100); const s=Math.max(0,Math.round((r.rate - dr*0.3 - lmaRate*MODEL_LMA_PENALTY - misV*0.1 + win*MODEL_WIN_BONUS)*10)/10); return {id:p.id,_ar:r.rate,_s:s}; }).filter(Boolean).sort((a,b)=>b._s-a._s||b._ar-a._ar);
    if(!data.length) return null;
    const ranks = rkRanks(data, x=>String(x._s));
    const idx = data.findIndex(x=>x.id===memberId);
    if(idx<0) return null;
    return { rank: ranks[idx], total: data.length };
  }catch(e){ return null; }
}

// 전체 월 누적 MVP·성장 수상 횟수 (memberId -> 합계). 캐시.
let _winCounts = null;
async function getWinCounts(){
  if (_winCounts) return _winCounts;
  let rows = [];
  try {
    if (typeof USE_DB !== 'undefined' && USE_DB) { const { data } = await sb.from('potm_votes').select('month,category,candidate_id'); rows = data || []; }
    else { rows = JSON.parse(localStorage.getItem(POTM_STORE)) || []; }
  } catch(e) {}
  const top = (m,c) => { const t={}; rows.filter(v=>v.month===m&&v.category===c).forEach(v=>{ t[v.candidate_id]=(t[v.candidate_id]||0)+1; }); let b=null,bc=0; for(const k in t){ if(t[k]>bc){bc=t[k]; b=Number(k);} } return b; };
  const months = [...new Set(rows.map(v=>v.month))];
  const map = {};
  months.forEach(m => ['mvp','growth'].forEach(c => { const w = top(m,c); if (w!=null) map[w] = (map[w]||0)+1; }));
  _winCounts = map;
  return map;
}
const MODEL_WIN_BONUS = 2;    // 모범생: MVP·성장 수상 1회당 +점수(출석율 우선 위해 소폭)
const MODEL_LMA_PENALTY = 0.5; // 모범생: 당일불참율 1%당 −점수
// 투표 통계 (연도 접두어 필터): 투표 참여 월/투표자 + 월별 수상자 집계
async function getVoteStats(yearPrefix){
  let rows = [];
  try {
    if (typeof USE_DB !== 'undefined' && USE_DB) { const { data } = await sb.from('potm_votes').select('voter_id,candidate_id,month,category'); rows = data || []; }
    else { rows = JSON.parse(localStorage.getItem(POTM_STORE)) || []; }
  } catch(e) {}
  if (yearPrefix) rows = rows.filter(v => String(v.month||'').startsWith(yearPrefix));
  const voterByMonth = {}, byMC = {};
  rows.forEach(v => {
    (voterByMonth[v.month] = voterByMonth[v.month] || new Set()).add(v.voter_id);
    const key = v.month + '|' + (v.category||'mvp');
    (byMC[key] = byMC[key] || {}); byMC[key][v.candidate_id] = (byMC[key][v.candidate_id]||0) + 1;
  });
  const winsByMember = {};
  Object.keys(byMC).forEach(key => { const t=byMC[key]; let b=null,bc=0; for(const k in t){ if(t[k]>bc){bc=t[k]; b=Number(k);} } if(b!=null) winsByMember[b]=(winsByMember[b]||0)+1; });
  return { voteMonths: Object.keys(voterByMonth), voterByMonth, winsByMember };
}

// 해당 월 활동 회원 (team-builder 월별 현황과 동일 로직)
// 휴면은 팀빌더에서 읽어 반영 (이름 기준). 팀빌더에 없으면 사이트 명단의 값 사용
let TB_DORMANT = {};
let TB_ACTIVE = {};   // 월별 '활동' 예외(영구 휴면 회원이 특정 달만 활동으로 되돌림)
function dormantMonthsOf(p){
  const tb = TB_DORMANT[p.name];
  const seed = p.dormantMonths || [];
  if (tb === undefined) return seed;
  return Array.from(new Set([...(tb||[]), ...seed]));
}
// 활동 예외 월: 이 달에는 (영구 휴면이라도) 활동으로 간주 — 홈 토글로 멤버가 직접 지정
function activeMonthsOf(p){
  const tb = TB_ACTIVE[p.name];
  const seed = p.activeMonths || [];
  if (tb === undefined) return seed;
  return Array.from(new Set([...(tb||[]), ...seed]));
}
async function loadTbDormant(){
  try {
    const tb = await fetchTeamBuilder();
    const m = {}, am = {};
    if (tb && Array.isArray(tb.players)) tb.players.forEach(p => { m[p.name] = p.dormantMonths || []; am[p.name] = p.activeMonths || []; });
    TB_DORMANT = m; TB_ACTIVE = am;
  } catch(e) {}
}
// 이번(현재) 달 'YYYY-MM'
function nowMonthStr(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
// 휴면 판정(회비·출석 공용): ⓪ 활동 예외 월이면 활동 ① 영구 휴면(status:'dormant') ② 대상 월 휴면 ③ 이번 달 휴면.
// ③은 팀빌더가 보통 이번 달까지만 휴면을 갱신하므로, 대상 월이 다음 달일 때 기존 휴면 회원이 누락되지 않게 함.
function isDormantFor(p, monthStr){
  if (activeMonthsOf(p).includes(monthStr)) return false;   // 멤버가 이 달을 '활동'으로 지정
  if ((p.status||'active')==='dormant') return true;
  const dm = dormantMonthsOf(p);
  return dm.includes(monthStr) || dm.includes(nowMonthStr());
}

function activeMembers(monthStr) {
  const [yN, moN] = monthStr.split('-').map(Number);
  const monthEnd = new Date(yN, moN, 0);
  const relevant = ROSTER.filter(p => {
    const st = p.status || 'active';
    if (st === 'former') return false;
    if (st === 'friends') return p.friendsSince && monthStr < p.friendsSince;
    if (!p.joinDate) return false;
    return new Date(p.joinDate) <= monthEnd;
  });
  const TEAM_ORDER = { 'WHITE': 0, 'BLACK': 1, '기타': 2 };
  return relevant.filter(p => !dormantMonthsOf(p).includes(monthStr))
                 .map(p => {
                   const t = TEAM_SHEET[p.name] || { team: '기타' };
                   return { ...p, jersey: t.jersey, eng: t.eng || '', team: t.team, cap: !!t.cap };
                 })
                 .sort((a, b) => (TEAM_ORDER[a.team] - TEAM_ORDER[b.team]) ||
                                 ((a.jersey ?? 999) - (b.jersey ?? 999)) ||
                                 a.name.localeCompare(b.name, 'ko'));
}

// 투표 대상: 가입한 회원 중 해당 월 활동 회원. 탈퇴·싸커피 친구·해당 월 휴면 제외
function votingMembers(monthStr) {
  const [yN, moN] = monthStr.split('-').map(Number);
  const monthEnd = new Date(yN, moN, 0);
  const TEAM_ORDER = { 'WHITE': 0, 'BLACK': 1, '기타': 2 };
  return ROSTER.filter(p => {
      const st = p.status || 'active';
      if (st === 'former' || st === 'friends') return false;
      if (isDormantFor(p, monthStr)) return false;   // 휴면은 투표 불가(후보·투표자 모두 제외)
      return p.joinDate && new Date(p.joinDate) <= monthEnd;
    })
    .map(p => { const t = TEAM_SHEET[p.name] || { team: '기타' }; return { ...p, jersey: t.jersey, eng: t.eng || '', team: t.team, cap: !!t.cap }; })
    .sort((a, b) => (TEAM_ORDER[a.team] - TEAM_ORDER[b.team]) || ((a.jersey ?? 999) - (b.jersey ?? 999)) || a.name.localeCompare(b.name, 'ko'));
}

// 세션 참석 자격: 세션 속성 반영 — duesOnly(그 달 회비 납부자만) · allowDormant(휴면도 허용)
// reason: former | friends | notjoined | dormant | unpaid (month 포함) | none
async function sessAttEligible(sess, memberId){
  const meP = ROSTER.find(x => x.id === memberId);
  if (!meP) return { ok:false, reason:'none' };
  const st = meP.status || 'active';
  if (st === 'former') return { ok:false, reason:'former' };
  if (st === 'friends') return { ok:false, reason:'friends' };
  const sm = ((sess && sess.date) ? sess.date : '').slice(0,7);
  const [yN, moN] = sm.split('-').map(Number);
  const monthEnd = new Date(yN, moN, 0);
  if (!(meP.joinDate && new Date(meP.joinDate) <= monthEnd)) return { ok:false, reason:'notjoined' };
  if (!(sess && sess.allowDormant) && isDormantFor(meP, sm)) return { ok:false, reason:'dormant', month:sm };
  if (sess && sess.duesOnly) {
    const dd = await fetchDues(sm);
    if (!dd.some(d => d.member_id === memberId && d.paid)) return { ok:false, reason:'unpaid', month:sm };
  }
  return { ok:true };
}

/* ---------- 투표 데이터 계층 (Supabase 또는 로컬) — 부문(category)별 ---------- */
const VOTE_CATS = [
  { key:'mvp',    label:'이달의 선수',     pick:'이달의 선수를 골라주세요',      sub:'가장 좋았던 한 명을 선택하세요. (본인 제외)' },
  { key:'growth', label:'가장 성장한 선수', pick:'가장 성장한 선수를 골라주세요',  sub:'이번 달 가장 성장한 한 명을 선택하세요. (본인 제외)' },
];
let potmCat = 'mvp';        // 현재 보고 있는 부문

async function fetchVotes(month, cat) {
  if (USE_DB) {
    const { data, error } = await sb.from('potm_votes').select('voter_id, candidate_id').eq('month', month).eq('category', cat);
    if (error) { return []; }
    return data;
  }
  try {
    return (JSON.parse(localStorage.getItem(POTM_STORE)) || []).filter(v => v.month === month && (v.category||'mvp') === cat);
  } catch (e) { return []; }
}

async function castVote(month, cat, voterId, candidateId) {
  if (USE_DB) {
    const { error } = await sb.from('potm_votes').insert({ month, category: cat, voter_id: voterId, candidate_id: candidateId });
    if (error) {
      if (error.code === '23505') return 'dup'; // unique 위반 = 이미 투표
      toast('투표 오류: ' + error.message); return false;
    }
    return true;
  }
  const all = JSON.parse(localStorage.getItem(POTM_STORE) || '[]');
  if (all.some(v => v.month === month && (v.category||'mvp') === cat && v.voter_id === voterId)) return 'dup';
  all.push({ month, category: cat, voter_id: voterId, candidate_id: candidateId });
  localStorage.setItem(POTM_STORE, JSON.stringify(all));
  return true;
}

async function resetVotes(month, cat) {
  if (USE_DB) {
    const { error } = await sb.from('potm_votes').delete().eq('month', month).eq('category', cat);
    if (error) { toast('초기화 오류: ' + error.message); return false; }
    return true;
  }
  const all = (JSON.parse(localStorage.getItem(POTM_STORE) || '[]')).filter(v => !(v.month === month && (v.category||'mvp') === cat));
  localStorage.setItem(POTM_STORE, JSON.stringify(all));
  return true;
}

/* ---------- 투표 상태 & 렌더 ---------- */
let potmVoterId = null;     // 로그인한 본인 (getMe)
let potmPick = { mvp:null, growth:null };   // 부문별 선택 (한 번에 두 명)

function refreshPotmIfOpen() {
  if (!document.getElementById('tab-potm').classList.contains('hidden')) rerender(renderPotm);
}

async function renderPotm() {
  const el = document.getElementById('potmContent');
  const month = potmMonth();
  const members = votingMembers(month);   // 투표 대상: 그 달 활동 회원(친구·탈퇴·휴면 제외)
  potmVoterId = getMe();   // 로그인한 본인

  // 1~24일(현재 달 투표 잠금 기간) → 전 달 확정 결과를 모두에게 노출 (투표 없음)
  if (!isVotingOpen()) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    const pMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const pMembers = votingMembers(pMonth);
    if (!el.innerHTML.trim()) el.innerHTML = `<div class="empty">불러오는 중...</div>`;
    const [pMvp, pGrowth] = await Promise.all([fetchVotes(pMonth, 'mvp'), fetchVotes(pMonth, 'growth')]);
    const adminP = isAdmin();
    el.innerHTML = `
      <div class="potm-hero">
        <span class="trophy">🏆</span>
        <h2>지난 투표 결과</h2>
        <div class="month">${potmMonthLabel(pMonth)} · 참여 ${pMvp.length}명</div>
        <div class="turnout">${parseInt(month.slice(5))}월 투표는 <b>25일</b>부터 열려요</div>
      </div>
      <div class="card"><h2>이달의 선수 결과</h2>${resultsHtml(pMvp, pMembers, adminP)}</div>
      <div class="card"><h2>가장 성장한 선수 결과</h2>${resultsHtml(pGrowth, pMembers, adminP)}</div>`;
    return;
  }

  if (!el.innerHTML.trim()) el.innerHTML = `<div class="empty">불러오는 중...</div>`;
  const [votesMvp, votesGrowth] = await Promise.all([fetchVotes(month,'mvp'), fetchVotes(month,'growth')]);
  const total = members.length;

  let body = `
    <div class="potm-hero">
      <h2>이달의 투표</h2>
      <div class="month">${potmMonthLabel(month)} · 투표 대상 ${total}명</div>
      <div class="turnout"><b>${votesMvp.length}</b>명 참여 · 매월 1일 새 투표</div>
    </div>`;

  if (total === 0) {
    el.innerHTML = body + `<div class="card"><div class="empty">이번 달 활동 회원 정보가 없어요.</div></div>`;
    return;
  }

  const voter = members.find(m => m.id === potmVoterId) || null;
  const admin = isAdmin();
  const bothResults = () =>
    `<div class="card"><h2>이달의 선수 결과</h2>${resultsHtml(votesMvp, members, admin)}</div>
     <div class="card"><h2>가장 성장한 선수 결과</h2>${resultsHtml(votesGrowth, members, admin)}</div>`;

  // 1) 로그인 안 됐거나 이번 달 활동 회원이 아님
  if (!voter) {
    body += potmVoterId
      ? `<div class="card"><h2>${esc(meName())} 님</h2><p class="sub">이번 달 활동 회원이 아니라 투표 대상이 아니에요.</p></div>`
      : `<div class="card"><div class="empty">로그인이 필요해요.</div></div>`;
    if (admin) body += bothResults();
    el.innerHTML = body;
    return;
  }

  // 투표자 바
  body += `
    <div class="voter-bar">
      <span class="who">투표자: <b>${esc(voter.name)}</b> 님</span>
    </div>`;

  const myMvp = votesMvp.find(v => v.voter_id === voter.id);
  const myGrowth = votesGrowth.find(v => v.voter_id === voter.id);

  // 2) 두 부문 모두 투표함 → 결과
  if (myMvp && myGrowth) {
    const pm = members.find(m => m.id === myMvp.candidate_id);
    const pg = members.find(m => m.id === myGrowth.candidate_id);
    body += `<div class="card"><h2>투표 완료</h2>
      <p class="sub">이달의 선수 <b>${pm?esc(pm.name):'-'}</b> · 가장 성장한 선수 <b>${pg?esc(pg.name):'-'}</b></p></div>`;
    body += bothResults();
    el.innerHTML = body;
    return;
  }

  // 4) 두 부문 동시 선택 (본인 제외)
  const candidates = members.filter(m => m.id !== voter.id);
  body += `
    <div class="card">
      <h2>이달의 선수</h2>
      <p class="sub">가장 좋았던 한 명 (본인 제외)</p>
      ${candSelect(candidates, 'mvp')}
    </div>
    <div class="card">
      <h2>가장 성장한 선수</h2>
      <p class="sub">이번 달 가장 성장한 한 명 (본인 제외)</p>
      ${candSelect(candidates, 'growth')}
    </div>
    <div class="vote-cta">
      <button class="btn accent" id="potmVoteBtn" onclick="submitVote()" disabled>두 부문 투표하기</button>
    </div>
    <p class="potm-note">두 부문 모두 선택해야 제출돼요. 투표 후엔 변경할 수 없어요.</p>`;
  if (admin) body += bothResults();
  el.innerHTML = body;
  syncVoteBtn();
}

const TEAM_BADGE = { 'WHITE': 'WHITE', 'BLACK': 'BLACK', '기타': '기타' };
function voterOptions(members) {
  return [...members].sort(byName)
    .map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
}
function byJersey(a, b) {
  return (a.jersey ?? 9999) - (b.jersey ?? 9999) || a.name.localeCompare(b.name, 'ko');
}
function byName(a, b) { return (a.name||'').localeCompare(b.name||'', 'ko'); }   // 이름순(등번호 불필요한 리스트 기본)
// 후보를 드롭다운(스크롤 선택)으로
function candSelect(candidates, cat) {
  const sorted = [...candidates].sort(byName);
  return `<select class="vote-sel" id="voteSel-${cat}" onchange="pickCandSel('${cat}', this.value)">
    <option value="">— 이름 선택 —</option>
    ${sorted.map(m => `<option value="${m.id}" ${potmPick[cat]===m.id?'selected':''}>${m.jersey!=null?m.jersey+' · ':''}${esc(m.name)}${m.cap?' (C)':''}</option>`).join('')}
  </select>`;
}
function pickCandSel(cat, val) {
  potmPick[cat] = val ? Number(val) : null;
  syncVoteBtn();
}

function resultsHtml(votes, members, showVoters) {
  const tally = {};
  votes.forEach(v => { tally[v.candidate_id] = (tally[v.candidate_id] || 0) + 1; });
  // 이름/등번호는 전체 명단(ROSTER)에서 찾음 — 투표 당시 활동회원이 지금 휴면이어도 결과엔 표시돼야 함
  const infoOf = id => {
    const m = members.find(x => x.id === id) || ROSTER.find(x => x.id === id);
    if (!m) return { id, name: '#' + id, jersey: null };
    const j = (m.jersey != null) ? m.jersey : (TEAM_SHEET[m.name] ? TEAM_SHEET[m.name].jersey : null);
    return { id, name: m.name, jersey: (j != null ? j : null) };
  };
  const ranked = Object.keys(tally).map(id => { const info = infoOf(Number(id)); return { ...info, c: tally[id] }; })
    .filter(m => m.c > 0)
    .sort((a, b) => b.c - a.c || (a.name || '').localeCompare(b.name || '', 'ko'));
  // 운영진 전용: 누가 누구에게 투표했는지
  const nameOf = id => infoOf(id).name;
  const votersBlock = (showVoters && votes.length)
    ? `<div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);line-height:1.7">
         <b style="color:var(--coffee-2)">투표자 ${votes.length}명</b><br>${votes.map(v => esc(nameOf(v.voter_id))).join(', ')}</div>`
    : '';
  if (ranked.length === 0) return `<div class="res-locked"><div class="big"></div>아직 집계된 표가 없어요.</div>${votersBlock}`;
  const max = ranked[0].c;
  let _rk = 0, _prevC = null;
  const _rankOf = (m, i) => { if (m.c !== _prevC) { _rk = i + 1; _prevC = m.c; } return _rk; };
  return `<div style="margin-top:16px">` + ranked.map((m, i) => `
    <div class="res-row">
      <div class="res-rank ${m.c === max ? 'top' : ''}">${_rankOf(m, i)}</div>
      <div class="res-main">
        <div class="res-name"><span>${m.jersey != null ? `<span style="color:var(--muted)">${m.jersey}</span> ` : ''}${esc(m.name)}</span><span class="cnt">${m.c}표</span></div>
        <div class="res-bar"><div style="width:${Math.round(m.c / max * 100)}%"></div></div>
      </div>
    </div>`).join('') + `</div>` + votersBlock;
}

function adminPanel(cat, month, votes, members) {
  return `
    <div class="card" style="border:1.5px dashed var(--accent)">
      <h2>운영진 — ${cat.label} 실시간 결과</h2>
      <p class="sub">${potmMonthLabel(month)} · 총 ${votes.length}표</p>
      ${resultsHtml(votes, members, true)}
      <button class="btn ghost sm" style="color:var(--red);margin-top:14px" onclick="adminResetPotm()">이 부문 투표 초기화</button>
    </div>`;
}

function syncVoteBtn() {
  const btn = document.getElementById('potmVoteBtn');
  if (btn) btn.disabled = !(potmPick.mvp && potmPick.growth);
}
async function submitVote() {
  if (!potmVoterId) return;
  // 투표 대상(그 달 활동 회원, 친구·휴면 제외)만 투표 가능 — UI 우회·명단 변동 대비 제출 시 재검증
  if (!votingMembers(potmMonth()).some(m => m.id === potmVoterId)) { toast('투표 대상이 아니에요'); return rerender(renderPotm); }
  if (!potmPick.mvp || !potmPick.growth) return toast('두 부문 모두 선택해 주세요');
  if (!isVotingOpen() && !isAdmin()) { toast(`투표는 ${fmtOpenTime(votingOpensAt())}부터 가능해요`); return rerender(renderPotm); }
  const pm = ROSTER.find(m => m.id === potmPick.mvp), pg = ROSTER.find(m => m.id === potmPick.growth);
  if (!confirm(`이달의 선수: ${pm?pm.name:''}\n가장 성장한 선수: ${pg?pg.name:''}\n\n제출할까요? 투표 후엔 변경할 수 없어요.`)) return;
  const btn = document.getElementById('potmVoteBtn');
  if (btn) { btn.disabled = true; btn.textContent = '투표 중...'; }
  const m = potmMonth();
  const r1 = await castVote(m, 'mvp', potmVoterId, potmPick.mvp);
  const r2 = await castVote(m, 'growth', potmVoterId, potmPick.growth);
  potmPick = { mvp:null, growth:null };
  await rerender(renderPotm);
  refreshNewBadges();
  toast((r1 === 'dup' || r2 === 'dup') ? '이미 이번 달 투표를 하셨어요' : '투표 완료!');
}
async function adminResetPotm() {
  if (!isAdmin()) return;
  const cat = VOTE_CATS.find(c=>c.key===potmCat) || VOTE_CATS[0];
  if (!confirm(`[${cat.label}] 이번 달 투표를 모두 초기화할까요? 되돌릴 수 없어요.`)) return;
  const ok = await resetVotes(potmMonth(), potmCat);
  if (!ok) return;
  await rerender(renderPotm);
  toast('이 부문 투표를 초기화했어요');
}

// 실시간 갱신 (DB 모드 + POTM 탭이 열려 있을 때)
if (USE_DB) {
  sb.channel('potm-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'potm_votes' }, () => {
      if (!document.getElementById('tab-potm').classList.contains('hidden')) rerender(renderPotm);
    })
    .subscribe();
}

/* ============================================================
   공지 · 참석 · 회비 · 운영진
   - 멤버: 보기 + 참여(참석/투표). 운영진: 작성/수정/마감
   - 데이터: Supabase (notices / attendance / dues / club_settings)
     데모 모드(키 없음)에선 localStorage로 동작
   ============================================================ */

/* 인별 월 회비(원) — 회비 장부 기준 기본값. 없으면 30000 */
const DUES_DEFAULT = {
  '박승한':10000,'홍순인':10000,'정희범':10000,'김이연':10000,'원재식':10000,'최승호':10000,'조은애':10000,
};
function dueAmount(name){ return DUES_DEFAULT[name] != null ? DUES_DEFAULT[name] : 30000; }
function won(n){ return (n||0).toLocaleString('ko-KR') + '원'; }

/* ---------- 공통: 다음 세션 날짜(다가오는 수요일) ---------- */
const ATTENDANCE_START = '2026-07-01';   // 출석 체크 시작일 (이전엔 첫 세션을 이 날로 고정)
function upcomingSessionDate() {
  const d = new Date(); d.setHours(0,0,0,0);
  let diff = (3 - d.getDay() + 7) % 7;               // 3 = 수요일
  if (diff === 0 && new Date().getHours() >= 23) diff = 7;
  d.setDate(d.getDate() + diff);
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0');
  const ds = `${y}-${m}-${dd}`;
  return ds < ATTENDANCE_START ? ATTENDANCE_START : ds;   // 시작일 전이면 7/1 세션으로
}
function fmtClock(t){
  if(!t) return '';
  const [h,m] = t.split(':').map(Number);
  return `${String(h).padStart(2,'0')}:${String(m||0).padStart(2,'0')}`;   // 24시간제
}
// 시작 시간 + 2시간 → 종료 입력칸 자동 채움
function endPlus2(startId, endId){
  const v = document.getElementById(startId);
  const e = document.getElementById(endId);
  if(!v || !e || !v.value) return;
  const [h,m] = v.value.split(':').map(Number);
  const eh = (h + 2) % 24;
  e.value = `${String(eh).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function fmtSessionDate(ds, time, endTime) {
  if (!ds) return '';
  const dt = new Date(ds + 'T' + (time||'20:00'));
  const days=['일','월','화','수','목','금','토'];
  const start = fmtClock(time||'20:00');
  const end = endTime ? ' - ' + fmtClock(endTime) : '';
  return `${dt.getMonth()+1}월 ${dt.getDate()}일 (${days[dt.getDay()]}) ${start}${end}`;
}

/* ---------- 클럽 설정(이번 세션 등) — jsonb 단일 행 ---------- */
const SETTINGS_STORE = 'socoffee_settings_v1';
let _settingsCache = null;
async function fetchSettings() {
  if (_settingsCache) return _settingsCache;
  let data = {};
  if (USE_DB) {
    const { data: row } = await sb.from('club_settings').select('data').eq('id','current').maybeSingle();
    data = (row && row.data) || {};
  } else {
    try { data = JSON.parse(localStorage.getItem(SETTINGS_STORE)) || {}; } catch(e) { data = {}; }
  }
  _settingsCache = data; return data;
}
async function saveSettings(patch) {
  // ⚠️ 저장 직전 DB 최신값을 다시 읽어 병합(오래된 캐시로 전체를 덮어써 유니폼 확정·사이즈 등이 리셋되던 버그 방지)
  let cur = {};
  if (USE_DB) {
    try { const { data: row } = await sb.from('club_settings').select('data').eq('id','current').maybeSingle(); cur = (row && row.data) || {}; }
    catch(e) { cur = _settingsCache || {}; }
  } else {
    try { cur = JSON.parse(localStorage.getItem(SETTINGS_STORE)) || {}; } catch(e) { cur = {}; }
  }
  const next = { ...cur, ...patch };
  _settingsCache = next;
  if (USE_DB) {
    const { error } = await sb.from('club_settings').upsert({ id:'current', data: next, updated_at: new Date().toISOString() });
    if (error) { toast('설정 저장 오류: ' + error.message); return false; }
  } else {
    localStorage.setItem(SETTINGS_STORE, JSON.stringify(next));
  }
  return true;
}
/* ---------- 세션(여러 개) — club_settings.sessions 배열에 저장 ---------- */
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
async function getSessions() {
  const s = await fetchSettings();
  const list = Array.isArray(s.sessions) ? s.sessions.slice() : [];
  return list.sort((a,b)=> ((a.date||'')+(a.time||'')).localeCompare((b.date||'')+(b.time||'')));
}
// 다가오는(오늘 이후) 세션. 등록된 게 없으면 자동 세션 1개.
async function upcomingSessions() {
  const t = todayStr();
  let list = (await getSessions()).filter(s => (s.date||'') >= t);
  if (!list.length) {
    const d = upcomingSessionDate();
    list = [{ id:'auto-'+d, date:d, time:'21:00', place:'상암 풋살장', label:'', auto:true }];
  }
  return list;
}
// 세션이 끝났는지(종료시간 경과). 종료시간 없으면 시작+2시간, 그것도 없으면 그날 끝.
function sessionEnded(s){
  if(!s || !s.date) return false;
  let end = s.endTime;
  if(!end && s.time){ const [h,m]=s.time.split(':').map(Number); end = String((h+2)%24).padStart(2,'0')+':'+String(m||0).padStart(2,'0'); }
  if(!end) end = '23:59';
  return new Date(s.date+'T'+end) < new Date();
}
// 세션 장소 — 링크 있으면 클릭 시 이동
function sessPlaceHtml(s){
  const url = s && s.placeUrl;
  if (url && /^https?:\/\//i.test(url)) return `<a href="${esc(url)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">${esc(s.place)} ↗</a>`;
  return esc(s.place);
}
async function nearestSession() { return (await upcomingSessions())[0]; }
async function currentSession() { return nearestSession(); }   // 하위호환
function sessChipLabel(s) {
  const [y,m,dd] = (s.date||'').split('-');
  const days=['일','월','화','수','목','금','토'];
  const wd = s.date ? days[new Date(s.date+'T00:00').getDay()] : '';
  const base = `${parseInt(m)}/${parseInt(dd)}(${wd})`;
  return s.label ? `${base} ${s.label}` : base;
}

/* ============================================================
   공지
   ============================================================ */
const NOTICE_STORE = 'socoffee_notices_v1';
async function fetchNotices() {
  if (USE_DB) {
    const { data, error } = await sb.from('notices').select('*').order('pinned',{ascending:false}).order('created_at',{ascending:false});
    if (error) { return []; }   // 테이블 생성 전이면 조용히 빈 목록
    return data;
  }
  let a=[]; try { a = JSON.parse(localStorage.getItem(NOTICE_STORE)) || []; } catch(e){}
  return a.sort((x,y)=> (y.pinned?1:0)-(x.pinned?1:0) || (y.created_at||'').localeCompare(x.created_at||''));
}
async function addNotice(n) {
  if (USE_DB) {
    const { error } = await sb.from('notices').insert({ title:n.title, body:n.body, pinned:!!n.pinned, publish_at:n.publish_at||null, hide_at:n.hide_at||null, link:n.link||null });
    if (error) { toast('등록 오류: ' + error.message); return false; }
    return true;
  }
  const a = await fetchNotices();
  a.unshift({ id:Date.now(), title:n.title, body:n.body, pinned:!!n.pinned, publish_at:n.publish_at||null, hide_at:n.hide_at||null, link:n.link||null, created_at:new Date().toISOString() });
  localStorage.setItem(NOTICE_STORE, JSON.stringify(a)); return true;
}
async function updateNotice(id, fields) {
  if (USE_DB) {
    const { error } = await sb.from('notices').update(fields).eq('id', id);
    if (error) { toast('수정 오류: ' + error.message); return false; }
    return true;
  }
  const a = await fetchNotices(); const n = a.find(x=>String(x.id)===String(id)); if(n) Object.assign(n, fields);
  localStorage.setItem(NOTICE_STORE, JSON.stringify(a)); return true;
}
async function deleteNotice(id) {
  if (USE_DB) { const { error } = await sb.from('notices').delete().eq('id', id); if (error){toast('삭제 오류: '+error.message);return false;} return true; }
  localStorage.setItem(NOTICE_STORE, JSON.stringify((await fetchNotices()).filter(n=>String(n.id)!==String(id)))); return true;
}
async function togglePinNotice(id, pinned) {
  if (USE_DB) { const { error } = await sb.from('notices').update({ pinned }).eq('id', id); if (error){toast('오류: '+error.message);return false;} return true; }
  const a = await fetchNotices(); const n = a.find(x=>String(x.id)===String(id)); if(n) n.pinned=pinned;
  localStorage.setItem(NOTICE_STORE, JSON.stringify(a)); return true;
}
// 공지 클릭 이동: 'tab:KEY'=내부 탭, 'http…'=외부 새 탭
function noticeGo(link){
  if(!link) return;
  if(/^tab:/.test(link)){ switchTab(link.slice(4)); window.scrollTo(0,0); return; }
  if(/^https?:\/\//i.test(link)) window.open(link,'_blank','noopener');
}
// 공지 폼: '외부 링크' 선택 시에만 URL 입력칸 노출
function opsLinkToggle(selId, wrapId){
  const sel=document.getElementById(selId), wrap=document.getElementById(wrapId);
  if(sel&&wrap) wrap.style.display = (sel.value==='url') ? '' : 'none';
}
function noticeDateLabel(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  return `${d.getMonth()+1}/${d.getDate()}`;
}
// 공지 표시 날짜: 마감일(hide_at)이 있으면 'M/D 마감'을 우선 표시, 없으면 게시일
function noticeWhenLabel(n) {
  if (n && n.hide_at) {
    const d = new Date(n.hide_at);
    if (!isNaN(d)) return `${d.getMonth()+1}/${d.getDate()}까지`;
  }
  return '';   // 마감(종료일) 없으면 날짜 미표시
}

// 팀 구분 안 하는 달 — 전체 팀원 단일 리스트
function fullSquadBlock(members) {
  const list = [...members].sort(byJersey);
  if (!list.length) return '';
  const row = m => `<div class="sq-row">
      <span class="no">${m.jersey!=null?String(m.jersey).padStart(2,'0'):'—'}</span>
      <span class="kr">${esc(m.name)}</span>
      <span class="en">${esc(m.eng||'')}</span>
    </div>`;
  const half = Math.ceil(list.length/2);
  const col = arr => `<div>${arr.map(row).join('')}</div>`;
  return `<div class="squad white">
    <div class="sq-title">전체 팀원 <span class="sq-n">${list.length}명</span></div>
    <div class="sq-two">${col(list.slice(0,half))}${col(list.slice(half))}</div>
  </div>`;
}

// 세션 캐러셀 — 스크롤 위치에 따라 도트/카운터 갱신
function updateSessDots() {
  const c = document.getElementById('sessCarousel'); if (!c) return;
  const i = Math.round(c.scrollLeft / c.clientWidth);
  document.querySelectorAll('#sessDots .sdot').forEach((d,idx)=> d.classList.toggle('on', idx===i));
  const cnt = document.getElementById('sessCount');
  if (cnt) cnt.textContent = `${i+1} / ${c.children.length}`;
}

// 팀 현황 — WHITE/BLACK 스쿼드 시트(등번호·한글·영문·주장)
function squadBlock(members, team) {
  const list = members.filter(m => m.team === team).sort(byJersey);
  if (!list.length) return '';
  return `<div class="squad ${team.toLowerCase()}">
    <div class="sq-title">${team} <span class="sq-n">${list.length}명</span></div>
    ${list.map(m => `<div class="sq-row">
      <span class="no">${m.jersey != null ? String(m.jersey).padStart(2,'0') : '—'}</span>
      <span class="kr">${esc(m.name)}${m.cap ? '<span class="sq-cap">C</span>' : ''}</span>
      <span class="en">${esc(m.eng || '')}</span>
    </div>`).join('')}
  </div>`;
}

/* ===== 더보기 메뉴 ===== */
let moreTab = 'use';   // 회원 메뉴 카테고리 탭: 'use'(이용) | 'set'(설정)
function setMoreTab(t){ moreTab = t; rerender(renderMore); }

/* ---------- 웹 푸시 알림 (2026-07) ---------- */
const VAPID_PUBLIC_KEY = 'BFRcgQIzaZzRhMqnEpfaLHEpSaS_0i7Rq-Rc6tQMShJP9_0LdF_veA3SrN1BakQbuNAtW-mzBnwfMyfTU8-a7ms';
const PUSH_SUPPORTED = ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const IS_STANDALONE = window.matchMedia && matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function _b64ToU8(s){ const p='='.repeat((4-s.length%4)%4); const b=atob((s+p).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from([...b].map(c=>c.charCodeAt(0))); }
async function _swReg(){ try { return await navigator.serviceWorker.register('sw.js'); } catch(e){ return null; } }
async function getPushSub(){ if(!PUSH_SUPPORTED) return null; const r=await navigator.serviceWorker.getRegistration('sw.js').catch(()=>null)||await _swReg(); if(!r) return null; return await r.pushManager.getSubscription(); }
async function enablePush(){
  if (!PUSH_SUPPORTED) { toast(IS_IOS ? '홈 화면에 추가한 뒤 앱에서 다시 열어 주세요.' : '이 브라우저는 알림을 지원하지 않아요.'); return; }
  if (IS_IOS && !IS_STANDALONE) { showAddHomeGuide && showAddHomeGuide(); toast('아이폰은 먼저 홈 화면에 추가해야 알림을 켤 수 있어요.'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('알림 권한이 거부됐어요. 브라우저 설정에서 허용해 주세요.'); return; }
  const reg = await _swReg();
  if (!reg) { toast('서비스 워커 등록에 실패했어요.'); return; }
  await navigator.serviceWorker.ready;
  let sub;
  try { sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:_b64ToU8(VAPID_PUBLIC_KEY) }); }
  catch(e){ toast('알림 등록에 실패했어요: '+e.message); return; }
  const me = getMe(); const mp = PLAYERS.find(x=>x.id===me);
  try {
    const { error } = await sb.from('push_subs').upsert({ endpoint: sub.endpoint, data: sub.toJSON(), member_id: me||null, member_name: mp?mp.name:null }, { onConflict:'endpoint' });
    if (error) { toast('저장 오류: '+error.message); return; }
  } catch(e){ toast('저장 중 오류가 났어요'); return; }
  toast('알림을 켰어요! 공지·세션 소식을 보내드릴게요.');
  rerender(renderMore);
}
async function disablePush(){
  const sub = await getPushSub();
  if (sub) {
    try { await sb.from('push_subs').delete().eq('endpoint', sub.endpoint); } catch(e){}
    await sub.unsubscribe().catch(()=>{});
  }
  toast('알림을 껐어요.');
  rerender(renderMore);
}

async function renderMore() {
  const el = document.getElementById('moreContent');
  const admin = isAdmin();
  const memberItems = [
    ['faq', '이용 가이드 / FAQ', '자주 묻는 질문 · 이용 방법'],
  ];
  // 운영진 메뉴 = 옛 운영진 탭의 내부 기능들을 개별 항목으로(공지·세션·회비·투표·설정 + 팀빌더)
  const adminItems = [
    ['notice',  '공지',   '공지 작성 · 노출 기간', 'ops'],
    ['session', '세션',   '세션 추가 · 마감 설정', 'ops'],
    ['dues',    '회비',   '이번 달 납부 현황',     'dues'],
    ['vote',    '투표',   '투표 결과 · 투표자',   'ops'],
    ['roster',  '설정',   'PIN 관리 · 팀 구분',   'ops'],
  ];
  const btn = ([t, name, desc]) =>
    `<button class="more-item" onclick="switchTab('${t}')"><div class="mi-name">${name}</div><div class="mi-desc">${desc}</div></button>`;
  const adminBtn = ([key, name, desc, kind]) => {
    const click = kind === 'ops' ? `openOps('${key}')` : `switchTab('${key}')`;
    return `<button class="more-item" onclick="${click}"><div class="mi-name">${name}</div><div class="mi-desc">${desc}</div></button>`;
  };
  const teamLink = `<a class="more-item" href="team/" target="_blank" rel="noopener"><div class="mi-name">팀빌더 ↗</div><div class="mi-desc">명단 · 등번호 · 휴면 · 팀 배분</div></a>`;
  const guideBtn = `<button class="more-item" onclick="showAddHomeGuide()"><div class="mi-name">홈 화면에 추가</div><div class="mi-desc">앱처럼 바로 열기 (설치 가이드)</div></button>`;
  const introLink = `<a class="more-item" href="index.html"><div class="mi-name">싸커피 소개</div><div class="mi-desc">소개(랜딩) 페이지로 이동 · 로그인 유지</div></a>`;
  const uniformBtn = `<button class="more-item" onclick="showUniform()"><div class="mi-name">유니폼 사이즈 조사</div><div class="mi-desc">2026 SS 유니폼 · 내 사이즈 입력·수정</div></button>`;
  const bankBtn = `<button class="more-item" onclick="showBankInfo()"><div class="mi-name">회비 계좌 안내</div><div class="mi-desc">입금 계좌 확인 · 복사</div></button>`;
  const pinBtn = `<button class="more-item" onclick="changeMyPin()"><div class="mi-name">내 PIN 변경</div><div class="mi-desc">로그인 PIN 4자리 바꾸기</div></button>`;
  let _pushOn = false; try { _pushOn = !!(await getPushSub()) && Notification.permission==='granted'; } catch(e){}
  const notifBtn = PUSH_SUPPORTED || IS_IOS
    ? (_pushOn
      ? `<button class="more-item" onclick="disablePush()"><div class="mi-name">알림 <span style="font-size:11px;color:var(--win);font-weight:800">켜짐</span></div><div class="mi-desc">공지·세션 리마인드 푸시 받는 중 · 눌러서 끄기</div></button>`
      : `<button class="more-item" onclick="enablePush()"><div class="mi-name">알림 받기</div><div class="mi-desc">공지·세션 리마인드를 폰 알림으로${IS_IOS&&!IS_STANDALONE?' (홈 화면 추가 필요)':''}</div></button>`)
    : '';
  const logoutBtn = `<button class="more-item" style="border-color:rgba(189,100,82,.45)" onclick="logout()"><div class="mi-name" style="color:#e08a76">로그아웃</div><div class="mi-desc">이 기기에서 로그아웃</div></button>`;
  const draftBtn = `<button class="more-item" onclick="openDraft()"><div class="mi-name">팀 뽑기 (드래프트)</div><div class="mi-desc">감독 2명이 번갈아 팀원 선발 · 팀 리그 현장용</div></button>`;
  // 회원 메뉴 = 카테고리 탭(이용 / 설정)
  const useGrid = memberItems.map(btn).join('') + draftBtn + bankBtn + introLink;   // 이용: FAQ·팀뽑기·회비계좌·소개
  const setGrid = notifBtn + pinBtn + guideBtn + logoutBtn;                                     // 설정: PIN·홈추가·로그아웃
  const mt = (moreTab === 'set') ? 'set' : 'use';
  const memberTabbed = `<div class="more-tabs">
      <button class="more-tab ${mt==='use'?'on':''}" onclick="setMoreTab('use')">이용</button>
      <button class="more-tab ${mt==='set'?'on':''}" onclick="setMoreTab('set')">설정</button>
    </div>
    <div class="more-grid">${mt==='set'?setGrid:useGrid}</div>`;
  let html = '';
  if (admin) {   // 총괄관리자(박승한) — 전체 운영진 메뉴
    html += `<div class="more-sec-title">회원 메뉴</div>` + memberTabbed;
    html += `<div class="more-sec-title">운영진 메뉴</div>`;
    html += `<div class="more-grid">` + adminItems.map(adminBtn).join('') + teamLink + `</div>`;
  } else if (isSubAdmin()) {   // 일반 관리자 — 회비 현황(읽기전용)만
    html += memberTabbed;
    html += `<div class="more-sec-title">운영진 메뉴</div>`;
    html += `<div class="more-grid"><button class="more-item" onclick="switchTab('dues')"><div class="mi-name">회비 현황</div><div class="mi-desc">이번 달 납부 현황 · 읽기전용</div></button></div>`;
  } else {
    html += memberTabbed;
  }
  el.innerHTML = html;
}

// 일정 하단탭 배지: 내 미응답(none) 일정 개수 — 미정/참석/불참은 응답으로 간주
async function refreshAttBadge(){
  const b = document.getElementById('attBadge'); if (!b) return;
  const me = getMe(); let cnt = 0;
  try{
    const meP = me != null ? PLAYERS.find(x=>x.id===me) : null;
    if (me != null && Array.isArray(sessions) && sessions.length && activeMembers(potmMonth()).some(m=>m.id===me)){
      const arr = await Promise.all(sessions.map(s=>fetchAttendance(s.id)));
      sessions.forEach((s,i)=>{
        if (meP && isDormantFor(meP, (s.date||'').slice(0,7))) return;   // 휴면 달 제외
        const a=(arr[i]||[]).find(x=>x.member_id===me); const st=a?a.status:'none'; if(st==='none') cnt++;
      });
    }
  }catch(e){}
  b.textContent = cnt>0 ? String(cnt) : '';
  b.style.display = cnt>0 ? '' : 'none';
}

// 신규 콘텐츠 점(dot): 카풀(새 글) · 투표(투표 가능·미투표) → 멤버 탭/서브탭에 표시
async function refreshNewBadges(){
  const me = getMe();
  let ridesNew = false, potmNew = false;
  try {
    const rides = await fetchRides();
    const newest = (rides[0] && rides[0].created_at) || '';
    const seen = localStorage.getItem('seen_rides') || '';
    ridesNew = !!newest && newest > seen;
  } catch(e){}
  try {
    if (me != null && isVotingOpen() && votingMembers(potmMonth()).some(m=>m.id===me)) {
      const mo = potmMonth();
      const [vm, vg] = await Promise.all([fetchVotes(mo,'mvp'), fetchVotes(mo,'growth')]);
      potmNew = !(vm.some(v=>v.voter_id===me) && vg.some(v=>v.voter_id===me));
    }
  } catch(e){}
  // 회비 미납 점: 표시달(dm) 활동 회원인데 아직 미납이면 표시
  // 홈 회비 행(dormStatus)과 동일하게 '그 달' 휴면만 본다(isDormantFor의 이번달 고정 규칙 제외) → 다음 달 활동 토글 반영
  const set = (id,on)=>{ const e=document.getElementById(id); if(e) e.style.display = on ? 'block' : 'none'; };
  set('dotList', ridesNew); set('dotPotm', potmNew); set('memberDot', ridesNew || potmNew);
}
function markRidesSeen(rides){
  const newest = (rides && rides[0] && rides[0].created_at) || new Date().toISOString();
  localStorage.setItem('seen_rides', newest);
  const e = document.getElementById('dotList'); if(e) e.style.display='none';
  refreshNewBadges();
}

/* ===== 마이페이지 ===== */
async function renderMine() {
  const el = document.getElementById('mineContent');
  if (!el.innerHTML.trim()) el.innerHTML = `<div class="empty">불러오는 중...</div>`;
  const me = getMe();
  const p = PLAYERS.find(x => x.id === me);
  if (!p) { el.innerHTML = `<div class="card"><div class="empty">로그인이 필요해요.</div></div>`; return; }
  const t = TEAM_SHEET[p.name] || {};
  const jersey = (t.jersey != null) ? t.jersey : '–';
  const team = (t.team && t.team !== '기타') ? t.team : '미배정';
  const month = duesMonth();
  const dues = await fetchDues(month);
  const myPaid = dues.some(d => d.member_id === me && d.paid);
  const dorm = isDormantFor(p, month);
  el.innerHTML = `
    <div class="mine-hero">
      <div class="num">${jersey === '–' ? '–' : jersey}</div>
      <div class="nm">${esc(p.name)} 님${isAdmin() ? ' · 운영진' : ''}</div>
      <div class="hint" style="margin-top:4px">${team} 팀${dorm ? ' · 이번 달 휴면' : ''}</div>
    </div>
    <div class="mine-stats">
      <div class="mine-stat"><div class="v" style="color:${myPaid ? 'var(--win)' : 'var(--alert)'}">${myPaid ? '납부' : '미납'}</div><div class="k">${potmMonthLabel(month)} 회비</div></div>
      <div class="mine-stat"><div class="v">T${p.tier || '–'}</div><div class="k">티어</div></div>
    </div>
    <button class="btn ghost" style="margin-top:14px" onclick="switchTab('rank')">출석 랭킹에서 내 순위 보기</button>
    <button class="btn ghost" style="margin-top:8px" onclick="switchTab('dues')">회비 화면으로</button>`;
}

/* ===== 회칙 · 안내 (FAQ) ===== */
let faqTab = 'rules';   // 회칙 | ref(참고·안내)
function setFaqTab(t){ faqTab = t; renderFaq(); }
function renderFaq() {
  const el = document.getElementById('faqContent');
  const rules = [
    ['연간 운영 시즌', ['<b>팀 리그</b> — 3·5·9·11월 · <b>20~23시</b> · 감독(캡틴)이 팀원 선발', '<b>일반 경기</b> — 그 외 전부(혹서기 7·8월 · 혹한기 12·1·2월 포함) · <b>21~23시</b>', '홈 배너·세션 카드에 이번 달 시즌 표시']],
    ['회비', ['매월 <b>15일</b>부터 다음 달 회비 표시', (BANK&&BANK.number)?`입금 계좌: <b>${esc(BANK.bank||'')} ${esc(BANK.number)}</b>${BANK.holder?` (${esc(BANK.holder)})`:''}`:'입금 계좌: 운영진에게 문의', '입금 후 회비 화면에서 <b>직접 납부 표시</b>', '전체 금액 비공개 · 납부/미납 인원만 공개']],
    ['참석 신청', ['<b>매치 직전 일요일 23:59</b> 마감', '당일 불참 시 반드시 <b>불참으로 체크</b>', '마감 후 참가는 <b>불참이 생긴 경우에만</b> 가능', '당일 참가도 <b>당일 불참이 생긴 경우에만</b> 가능']],
    ['게스트', ['싸커피 <b>인스타그램 세션 일정 댓글</b> 필히 작성', '게스트 확정은 <b>월요일</b> 인스타그램으로 전달', '확정 후 <b>계좌로 입금</b>']],
    ['휴면', ['한 달 단위로 활동 쉬기', '매월 <b>15일</b>부터 홈에서 다음 달 신청', '휴면 달은 회비 · 참석 · 명단 · 투표 제외', '휴면 중 특정 세션 참여: <b>일정 → 게스트로 신청</b> → 운영진 승인 후 참석 확정']],
    ['멤버 모집', ['현재 <b>신규 회원은 모집하지 않는 중</b>']],
  ];
  const refs = [
    ['로그인 / PIN', ['이름 선택 + <b>PIN 4자리</b>', '첫 로그인 때 PIN 등록', '변경: 더보기 → 내 PIN 변경', '잊으면 운영진에 초기화 요청']],
    ['참석 · 일정', ['홈/일정 탭에서 참석·불참·미정 선택', '홈에서 <b>미응답 일정 개수</b> 알림']],
    ['MVP · 성장 투표', ['매월 <b>25일~말일</b> 진행', '1~24일: 지난달 결과 표시', '대상: 그 달 <b>활동 회원</b> · <b>친구·휴면 제외</b>', '두 부문 1표씩 · 제출 후 변경 불가']],
    ['WHITE / BLACK 팀', ['경기 밸런스용 두 팀', '<b>팀 리그</b> 달: 감독(캡틴)이 팀원 선발', '팀 구분 켠 달엔 이름 옆 팀 표시']],
    ['카풀', ['운전자가 출발지 · 좌석 등록', '탑승자는 빈 좌석 눌러 신청', '지난 카풀은 접혀서 정리']],
    ['내 프로필 · 기록', ['홈에서 가입월 · 기간 · 참여 · 출석률 · 수상 확인', '스킬(스파이더 차트) 직접 편집', '<b>사진으로 저장</b>해 공유']],
    ['운영진', ['<b>박승한</b> · 팀 운영 · 경기장 예약', '<b>홍순인</b> · 경기 및 리그 운영', '<b>원재식</b> · 총무', '<b>최승호</b> · 장비', '<b>정희범</b> · 사진']],
    ['운영진 외', ['<b>조은애</b> · 브랜드 및 디자인', '<b>김균원</b> · MD', '<b>김이연</b> · 사진']],
  ];
  const render = arr => arr.map(([q, pts]) => `<div class="faq-q"><h4>${q}</h4><ul class="faq-ul">${pts.map(p=>`<li>${p}</li>`).join('')}</ul></div>`).join('');
  const ft = (faqTab === 'ref') ? 'ref' : 'rules';
  const tabBar = `<div class="more-tabs">
      <button class="more-tab ${ft==='rules'?'on':''}" onclick="setFaqTab('rules')">회칙</button>
      <button class="more-tab ${ft==='ref'?'on':''}" onclick="setFaqTab('ref')">참고 · 안내</button>
    </div>`;
  el.innerHTML = tabBar + (ft==='ref' ? render(refs) : render(rules)) +
    `<p class="hint" style="text-align:center;margin-top:12px">더 궁금한 건 인스타 <b style="color:var(--gold)">@soccoffee__</b> 또는 운영진에게 물어봐 주세요.</p>`;
}

// 홈에서 다음 매치 참석을 바로 변경 (마감 후 일반 멤버 차단)
async function homeQuickAtt(sid, status){
  const me = getMe(); if(!me || !sid) return;
  const sess = (await upcomingSessions()).find(s=>s.id===sid);
  if (!isAdmin()) {
    const _el = await sessAttEligible(sess, me);
    if (!_el.ok) {
      toast(_el.reason==='unpaid' ? `${parseInt(_el.month.split('-')[1])}월 회비 납부 완료 후 참석 신청할 수 있어요.`
          : _el.reason==='dormant' ? '이번 달 휴면이라 참석 신청 대상이 아니에요.'
          : '참석 신청 대상이 아니에요.');
      return;
    }
  }
  const dl = sess ? sessionDeadline(sess) : null;
  if (dl && new Date() > dl && !isAdmin()) { toast('신청이 마감됐어요. 운영진에 문의해 주세요.'); return; }
  const ok = await setAttendance(sid, me, status);
  if (!ok) return;
  toast({yes:'참석으로 표시했어요',no:'불참으로 표시했어요',maybe:'미정으로 표시했어요'}[status]);
  await rerender(renderHome);
  refreshAttBadge();
}
// 홈 상태박스: 본인 회비를 해당 월 납부/미납으로 토글 표시 (활동/휴면과 동일한 버튼 방식)
async function homeSetDue(memberId, month, paid){
  if (!getMe() || (memberId !== getMe() && !isAdmin())) return;
  const m = ROSTER.find(x=>x.id===memberId);
  const ok = await setDuesPaid(month, memberId, paid, dueAmount(m?m.name:''));
  if (!ok) return;
  toast(paid ? '납부로 표시했어요' : '미납으로 바꿨어요');
  await rerender(renderHome);
  refreshNewBadges();
}

async function renderHome() {
  const el = document.getElementById('homeContent');
  if (!el.innerHTML.trim()) el.innerHTML = `<div class="empty">불러오는 중...</div>`;
  const allUpcoming = await upcomingSessions();
  // 홈에서는 이미 끝난(마감) 세션은 숨김
  const sessions = allUpcoming.filter(s => !sessionEnded(s));
  const notices = await fetchNotices();
  const attBySess = {};
  await Promise.all(sessions.map(async s => { attBySess[s.id] = await fetchAttendance(s.id); }));
  const cnt = s => {
    const recs = attBySess[s.id] || [];
    const sMembers = activeMembers((s.date||'').slice(0,7));   // 세션 월 기준 활동 멤버
    const activeIds = new Set(sMembers.map(m=>m.id));
    const aRecs = recs.filter(a => activeIds.has(a.member_id));   // 활동 멤버 응답만 집계
    return {
      yes: aRecs.filter(a=>a.status==='yes').length,
      maybe: aRecs.filter(a=>a.status==='maybe').length,
      no: aRecs.filter(a=>a.status==='no').length,
      responded: aRecs.length,
      total: sMembers.length
    };
  };

  const month = potmMonth();
  const members = activeMembers(month);
  const white = members.filter(m=>m.team==='WHITE').length;
  const black = members.filter(m=>m.team==='BLACK').length;
  const dormant = ROSTER.filter(p=>dormantMonthsOf(p).includes(month)).length;

  // ── 내 현황(개인 대시보드) ──
  const me = getMe();
  // 본인 대시보드는 휴면이어도 노출해야 '휴면 중' 표시가 뜬다 → 활동회원이 아니라 명단 등록(탈퇴 제외) 기준
  const meActive = me != null && ROSTER.some(x => x.id === me && (x.status||'active') !== 'former');
  const dMonth = statusMonth();   // 홈 상태박스: 15일부터 다음 달
  const myDues = meActive ? await fetchDues(dMonth) : [];
  const myPaid = myDues.some(d => d.member_id === me && d.paid);
  const mySkills = meActive ? await getMemberSkills(me) : [];
  const myWins = meActive ? myWinTitles(me, await getPrevWinners()) : [];
  // 참여 세션·출석률·최근3개월·수상: 팀빌더 데이터 기반 (사이트 attendance 테이블은 최근분만 있음)
  let myAttended = 0, myAttRate = null, myRecent3 = null, myWinPct = null;
  if (meActive) { try { const _tb = await fetchTeamBuilder(); const _tp = (_tb && _tb.players || []).find(x => x.id === me); if (_tp) { myAttended = _tp.attCountAll ?? _tp.attCount ?? 0; myAttRate = _tp.attendanceAll ?? _tp.attendance ?? null; myRecent3 = recent3Rate(_tp, _tb.sessions); } const _mw = computeWinStats(_tb && _tb.matches)[me]; if (_mw && _mw.played) myWinPct = Math.round((_mw.w + _mw.d*0.5)/_mw.played*100); } catch(e){} }
  const myStatusOf = sid => { const a = (attBySess[sid]||[]).find(x=>x.member_id===me); return a ? a.status : 'none'; };
  const meP0 = me != null ? PLAYERS.find(x => x.id === me) : null;
  const pending = meActive ? sessions.filter(s => {
    if (meP0 && isDormantFor(meP0, (s.date||'').slice(0,7))) return false;   // 휴면 달 일정은 미응답에서 제외
    const st = myStatusOf(s.id); return st === 'none';   // 미정/참석/불참은 응답으로 간주
  }) : [];
  const nextSess = sessions[0];
  let dash = '';
  if (meActive) {
    const meP = PLAYERS.find(x => x.id === me) || {};
    const meT = TEAM_SHEET[meP.name] || {};
    const jersey = (meP.jersey != null) ? meP.jersey : ((meT.jersey != null) ? meT.jersey : '–');
    // 박스는 '해당 월'만 본다(isDormantFor의 이번달 고정 규칙 제외) — 다음 달 토글이 작동하도록
    const dormStatus = !activeMonthsOf(meP).includes(dMonth) && (((meP.status||'active')==='dormant') || dormantMonthsOf(meP).includes(dMonth));
    const confirmPhase = dormFeatureOn() && new Date().getDate() >= 15;   // 2026-07-15부터, 매월 15일 이후 다음 달 활동/휴면 확인
    const myTeam = (teamSplitOn && (meT.team === 'WHITE' || meT.team === 'BLACK')) ? meT.team : null;
    const teamPill = myTeam ? ` <span class="team-pill ${myTeam.toLowerCase()}">${myTeam}</span>` : '';
    const subline = [meP.status === 'friends' ? '싸커피 친구' : '', isAdmin() ? '운영진' : ''].filter(Boolean).join(' · ') || '멤버';
    const targetSess = sessions.find(s => { const dl = sessionDeadline(s); return !(dl && new Date() > dl); }) || nextSess;
    const targetSessMonth = targetSess ? (targetSess.date||'').slice(0,7) : null;
    const targetBlockedDorm = targetSess ? (isDormantFor(meP, targetSessMonth) && !targetSess.allowDormant) : false;
    let targetPaid = true;
    if (targetSess && targetSess.duesOnly) { const _td = await fetchDues(targetSessMonth); targetPaid = _td.some(d => d.member_id === me && d.paid); }
    const targetBlockedDues = targetSess ? (!!targetSess.duesOnly && !targetPaid && !targetBlockedDorm) : false;
    const targetMoNum = targetSessMonth ? parseInt(targetSessMonth.split('-')[1], 10) : '';
    const ns = targetSess ? myStatusOf(targetSess.id) : 'none';
    const qbtn = (st, lbl, bg, fg) => `<button style="flex:1;border-radius:9px;padding:9px;border:1px solid ${ns===st?bg:'var(--line)'};cursor:pointer;font-family:inherit;font-weight:800;font-size:13px;background:${ns===st?bg:'transparent'};color:${ns===st?fg:'var(--muted)'}" onclick="homeQuickAtt('${targetSess?targetSess.id:''}','${st}')">${lbl}</button>`;
    const moNum = parseInt(dMonth.split('-')[1], 10);
    const tp = (targetSess && targetSess.date) ? targetSess.date.split('-') : null;
    const sessLabel = tp ? `${parseInt(tp[1])}월 ${parseInt(tp[2])}일 세션` : '다음 세션';
    const sBadge = (ns === 'yes' || ns === 'no') ? ['done', '완료'] : ['no', '미완'];
    const myYes = sessions.filter(s => myStatusOf(s.id) === 'yes');
    // ── 묶음 ① 신원·스킬 / ② 현황(상태·참석예정·미확정) ──
    const statusHtml = `${confirmPhase
        ? `${dormStatus ? `<div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:6px">🌙 <b style="color:#ece6d2">${moNum}월엔 복귀하시나요?</b> 복귀하면 '활동', 계속 쉬면 '휴면'을 눌러 주세요.</div>` : ''}<div class="pc-stat"><span class="lbl">${moNum}월</span><span class="act-toggle"><button class="${!dormStatus?'on':''}" onclick="setMyDormancy(${me},'${dMonth}',false)">활동</button><button class="${dormStatus?'on':''}" onclick="setMyDormancy(${me},'${dMonth}',true)">휴면</button></span></div>`
        : `<div class="pc-stat"><span class="lbl">${moNum}월</span><span class="pc-badge ${dormStatus?'neutral':'done'}">${dormStatus?'휴면 중':'활동 중'}</span></div>`}
      ${!dormStatus
        ? `<div class="pc-stat"><span class="lbl">${moNum}월 회비${myPaid?'':' <span class="mini-dot"></span>'}</span><span class="act-toggle dues"><button class="paid ${myPaid?'on':''}" onclick="homeSetDue(${me},'${dMonth}',true)">완료</button><button class="unpaid ${!myPaid?'on':''}" onclick="homeSetDue(${me},'${dMonth}',false)">미납</button></span></div>`
        : ''}`;
    const respondHtml = targetSess ? (
      targetBlockedDorm
        ? `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)"><div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:9px">이번 달 휴면이에요. 게스트로 참여하려면 일정에서 신청할 수 있어요.</div><button class="btn accent" style="width:100%" onclick="openAtt('${targetSess.id}')">게스트로 신청 →</button></div>`
      : targetBlockedDues
        ? `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)"><div style="font-size:11px;color:var(--muted);font-weight:800;letter-spacing:.04em;margin-bottom:9px">${sessLabel} 참석</div><div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:9px">${targetMoNum}월 회비를 납부해야 이 세션에 참석 신청할 수 있어요.</div><button class="btn accent" style="width:100%" onclick="switchTab('dues')">회비 납부하러 가기</button></div>`
        : `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)"><div style="font-size:11px;color:var(--muted);font-weight:800;letter-spacing:.04em;margin-bottom:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sessLabel} 참석</div><div style="display:flex;gap:6px">${qbtn('yes','참석','var(--win)','var(--cream)')}${qbtn('no','불참','var(--alert)','var(--cream)')}${qbtn('maybe','미정','var(--accent)','#14281b')}</div></div>`) : '';
    const upcomingHtml = myYes.length ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)"><div style="font-size:11px;color:var(--muted);font-weight:800;letter-spacing:.04em;margin-bottom:4px">참석 예정 ${myYes.length}개</div>${myYes.map(s => `<div style="padding:5px 0;font-size:13px;color:var(--cream)"><div style="display:flex;align-items:center;gap:8px"><span style="color:var(--cream);font-size:7px;opacity:.7">●</span><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(sessChipLabel(s))}</span><span style="margin-left:auto;flex-shrink:0;color:var(--muted);font-size:12px">${esc((s.time||'').slice(0,5))}${s.endTime?'–'+esc(s.endTime.slice(0,5)):''}</span></div>${s.place ? `<div style="margin-left:17px;color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.place)}</div>` : ''}</div>`).join('')}</div>` : '';
    const pendingHtml = pending.length ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)"><button onclick="openAtt('${pending[0].id}')" style="width:100%;text-align:left;cursor:pointer;font-family:inherit;border:none;background:transparent;padding:0;display:flex;align-items:center;justify-content:space-between;gap:10px"><span style="font-size:13px;font-weight:600;color:#ece6d2">미응답한 일정 ${pending.length}개</span><span style="font-size:12px;font-weight:800;color:var(--accent)">응답하기 →</span></button></div>` : '';
    const skillHtml = mySkills.length>=3
        ? radarSvg(mySkills)
        : (mySkills.length
            ? `<div style="margin-top:8px">${mySkills.map(sk=>`<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--cream);padding:3px 0"><span>${esc(sk.name)}</span><span style="color:var(--accent);font-weight:800">${sk.level}/5</span></div>`).join('')}</div>`
            : `<div class="hint" style="margin-top:6px">스파이더 차트로 내 스킬을 표시해 보세요.</div>`);
    // 카드 ① 신원 + 스킬
    const joinFmt = meP.joinDate ? meP.joinDate.slice(0,7).replace('-','.') : '—';
    const monthsTogether = monthsSince(meP.joinDate);
    const monthsLabel = monthsTogether > 0 ? `${monthsTogether}개월` : '이번 달';
    const miniHtml = `<div class="pc-mini">
        <div><div class="v">${joinFmt}</div><div class="k">가입월</div></div>
        <div><div class="v">${monthsLabel}</div><div class="k">함께한 기간</div></div>
        <div><div class="v">${myAttended}회</div><div class="k">참여 세션</div></div>
        <div><div class="v">${myAttRate!=null?Math.round(myAttRate)+'%':'—'}</div><div class="k">전체 출석률</div></div>
        <div><div class="v">${myRecent3!=null?myRecent3+'%':'—'}</div><div class="k">최근 3개월</div></div>
        <div><div class="v">${myWinPct!=null?myWinPct+'%':'—'}</div><div class="k">승률</div></div>
      </div>`;
    dash += `<div class="card" style="padding:16px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:14px">
        <div class="pc-jersey" style="font-size:38px">${jersey}</div>
        <div style="min-width:0;flex:1"><div class="pc-name" style="margin:0">${esc(meName())}${myWins.map(t=>` <span class="win-badge ${t==='MVP'?'mvp':'grow'}">${t}</span>`).join('')}${teamPill}</div><div class="pc-team">${subline}</div></div>
        <button class="btn ghost sm" style="flex-shrink:0" onclick="openMemberCard(${me}, true)">${mySkills.length?'스킬 편집':'스킬 추가'}</button>
      </div>
      ${miniHtml}
      ${skillHtml}
      <button class="btn ghost sm" onclick="saveMyCard()" style="width:100%;margin-top:12px">사진으로 저장</button>
    </div>`;
    // 카드 ② 현황(상태 · 참석예정 · 미확정)
    dash += `<div class="card" style="padding:16px;margin-bottom:12px">
      <div class="pc-right">${statusHtml}</div>
      ${respondHtml}${upcomingHtml}${pendingHtml}
    </div>`;
  }

  const sessCards = sessions.map((s,i)=>{
    const c = cnt(s);
    return `
    <div class="session-card">
      ${s.label?`<div class="lbl">${esc(s.label)}</div>`:''}
      <div class="when">${fmtSessionDate(s.date, s.time, s.endTime)}</div>
      <div class="where">${sessPlaceHtml(s)}</div>
      <div class="att-mini">
        ${isAdmin()
          ? `<span><b>${c.yes}</b> 참석</span><span><b>${c.no}</b> 불참</span><span><b>${c.maybe}</b> 미정</span><span style="opacity:.6">응답 ${c.responded}/${c.total}</span>`
          : `<span><b>${c.yes}</b> 참석</span><span><b>${c.maybe}</b> 미정</span>`}
        <span style="margin-left:auto"><a href="#" onclick="openAtt('${s.id}');return false;" style="color:#14281b;text-decoration:underline">참석 체크 →</a></span>
      </div>
    </div>`;
  });

  let uniHome = '';
  if (meActive && me != null) {
    const _um = uniformRoster().find(x=>x.id===me);
    if (_um) {
      const _sz = uniformSizeOf(_um);
      const _conf = ((UNIFORM && UNIFORM.confirmedIds)||[]).includes(me);
      const _rt = _sz ? `내 사이즈 <b style="color:var(--accent)">${esc(_sz)}</b>${_conf?' · 확정됨':' · 수정 가능'}` : '아직 입력 안 함 — 눌러서 입력';
      uniHome = `<button class="card" style="width:100%;box-sizing:border-box;padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;font-family:inherit;text-align:left" onclick="showUniform()">
        <span style="min-width:0"><span style="display:block;font-size:14px;font-weight:800;color:#ece6d2">2026 SS 유니폼 사이즈</span><span style="display:block;font-size:12px;color:${_sz?'var(--muted)':'var(--accent)'};margin-top:2px">${_rt}</span></span>
        <span style="font-size:12px;font-weight:800;color:var(--accent);white-space:nowrap">${_sz?(_conf?'확인':'수정'):'입력'} →</span>
      </button>`;
    }
  }
  const _lgNow = isLeague();
  const seasonBanner = `<div style="display:flex;align-items:center;gap:9px;padding:10px 14px;margin-bottom:12px;border-radius:12px;background:${_lgNow?'rgba(224,165,48,.12)':'transparent'};border:1px solid ${_lgNow?'var(--gold)':'var(--line)'}">
      <span style="flex-shrink:0;font-size:11px;font-weight:800;letter-spacing:.04em;padding:3px 9px;border-radius:999px;background:${_lgNow?'var(--gold)':'var(--muted)'};color:${_lgNow?'#14281b':'#0d1420'}">${_lgNow?'팀 리그':'일반'}</span>
      <span style="font-size:12.5px;color:var(--cream);line-height:1.4">${_lgNow?'이번 달은 <b>팀 리그</b> · 20–23시 · 감독이 팀 선발':'이번 달은 <b>일반 경기</b> · 21–23시'}</span>
    </div>`;
  let html = seasonBanner + dash + uniHome + `<div class="section-title">다가오는 매치</div>`;
  html += sessions.length > 1
    ? `<div class="sess-carousel" id="sessCarousel" onscroll="updateSessDots()">${sessCards.join('')}</div>
       <div class="sess-dots">
         <span class="sess-count" id="sessCount">1 / ${sessions.length}</span>
         <span id="sessDots">${sessions.map((_,i)=>`<span class="sdot ${i===0?'on':''}"></span>`).join('')}</span>
       </div>`
    : sessCards.join('');

  const vnotices = notices.filter(noticeVisible);
  if (vnotices.length > 0) {
    html += `<div class="section-title">공지사항</div>`;
    html += vnotices.map(n => {
      const hasBody = !!(n.body && String(n.body).trim());
      const link = n.link || '';
      if (link) {
        // 링크 공지: 클릭 시 이동(아코디언 대신). 본문 있으면 그냥 보여줌.
        return `<div class="notice ${n.pinned?'pinned':''} has-link" onclick="noticeGo('${esc(link)}')">
          <div class="n-top">
            <div class="n-title">${n.pinned?'<span class="pin-tag">고정</span>':''}${esc(n.title)}</div>
            <div class="n-date">${noticeWhenLabel(n)}</div>
          </div>
          ${hasBody?`<div class="n-body" style="display:block">${linkify(n.body)}</div>`:''}
        </div>`;
      }
      return `<div class="notice ${n.pinned?'pinned':''}${hasBody?' has-body':''}">
        <div class="n-top"${hasBody?` onclick="this.parentNode.classList.toggle('open')"`:''}>
          <div class="n-title">${n.pinned?'<span class="pin-tag">고정</span>':''}${esc(n.title)}</div>
          <div class="n-date">${noticeWhenLabel(n)}</div>
        </div>
        ${hasBody?`<div class="n-body">${linkify(n.body)}</div>`:''}
      </div>`;
    }).join('');
  }

  el.innerHTML = html;
}

/* ===== 팀 현황(팀빌더 명단 연동) — 서브 페이지 ===== */
let squadFilter = 'active';   // 멤버 현황 필터: active(활동)/dormant(휴면)/staff(운영진)
let _squadGroups = null;
function setSquadFilter(f){
  squadFilter = f;
  const b = document.getElementById('squadListBody'); if (b && _squadGroups) b.innerHTML = _squadGroups[f] || '';
  document.querySelectorAll('#squadContent .att-counts .att-cnt').forEach(c=>c.classList.toggle('sel', c.dataset.sf===f));
}
async function renderSquad() {
  const el = document.getElementById('squadContent');
  if (!el.innerHTML.trim()) el.innerHTML = `<div class="empty">불러오는 중...</div>`;
  let tb = null;
  try { tb = await fetchTeamBuilder(); } catch(e) {}
  const month = potmMonth();
  const players = (tb && Array.isArray(tb.players) ? tb.players : []).filter(p => (p.status||'active') !== 'former');
  if (!players.length) { el.innerHTML = `<div class="section-title">팀 현황</div><div class="card"><div class="empty">명단을 불러오지 못했어요.</div></div>`; return; }
  const isDorm = p => (p.status === 'dormant') || (p.dormantMonths||[]).includes(month);
  const active = [], friends = [], dormant = [];
  players.forEach(p => { isDorm(p) ? dormant.push(p) : (p.status === 'friends' ? friends.push(p) : active.push(p)); });
  const sortJ = (a,b) => ((a.jersey==null?999:a.jersey) - (b.jersey==null?999:b.jersey)) || a.name.localeCompare(b.name,'ko');
  [active, friends, dormant].forEach(g => g.sort(sortJ));
  let skillsMap = {};
  try { skillsMap = (await fetchSettings()).skills || {}; } catch(e) {}
  const hasSkill = id => Array.isArray(skillsMap[id]) && skillsMap[id].length > 0;
  const w = await getPrevWinners();
  const chip = p => {
    const r = MEMBER_ROLES[p.name]; const rc = r ? (r.type==='admin'?' role-admin':' role-other') : '';
    const sk = hasSkill(p.id) ? ' has-skill' : '';
    const wb = `${p.id===w.mvp?'<span class="win-badge mvp" style="flex-shrink:0">MVP</span>':''}${p.id===w.growth?'<span class="win-badge grow" style="flex-shrink:0">성장</span>':''}`;
    return `<button class="sq-chip${rc}${sk}" onclick="openMemberCard(${p.id})"><span class="sq-no">${p.jersey!=null?p.jersey:'–'}</span><span class="sq-nm">${esc(p.name)}</span>${wb}<span class="sq-dot" title="${hasSkill(p.id)?'스킬 입력함':'스킬 미입력'}"></span></button>`;
  };
  const staff = players.filter(p => MEMBER_ROLES[p.name]).sort(sortJ);   // 운영진 = 역할 있는 멤버(활동/휴면 무관)
  const gridOf = (arr, dim) => arr.length ? `<div class="sq-grid${dim?' dim':''}">${arr.map(chip).join('')}</div>` : '<div class="empty" style="font-size:13px;padding:20px 0;text-align:center">해당 인원이 없어요.</div>';
  _squadGroups = { active: gridOf(active,false), dormant: gridOf(dormant,true), staff: gridOf(staff,false) };
  if (!['active','dormant','staff'].includes(squadFilter)) squadFilter = 'active';
  el.innerHTML = `<div class="section-title">${potmMonthLabel(month)} 팀 현황</div>
    <div class="att-counts" style="margin:6px 0 8px">
      <div class="att-cnt yes ${squadFilter==='active'?'sel':''}" data-sf="active" onclick="setSquadFilter('active')"><div class="num">${active.length}</div><div class="cap">활동</div></div>
      <div class="att-cnt none ${squadFilter==='dormant'?'sel':''}" data-sf="dormant" onclick="setSquadFilter('dormant')"><div class="num">${dormant.length}</div><div class="cap">휴면</div></div>
      <div class="att-cnt ${squadFilter==='staff'?'sel':''}" data-sf="staff" onclick="setSquadFilter('staff')"><div class="num">${staff.length}</div><div class="cap">운영진</div></div>
    </div>
    <div style="font-size:11px;color:var(--muted);margin:0 2px 10px;display:flex;align-items:center;gap:5px">
      <span style="width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block"></span>스킬 입력
      <span style="width:8px;height:8px;border-radius:50%;border:1.5px solid var(--muted);box-sizing:border-box;display:inline-block;margin-left:8px"></span>미입력
    </div>
    <div id="squadListBody">${_squadGroups[squadFilter]}</div>`;
}

/* ===== 멤버 카드 모달 (역할 + 스파이더 차트) ===== */
let mmState = null;
async function openMemberCard(id, startEdit){
  let p = (typeof PLAYERS!=='undefined'?PLAYERS:[]).find(x=>x.id===id);
  if(!p){ try{ const tb=await fetchTeamBuilder(); p=(tb&&tb.players||[]).find(x=>x.id===id); }catch(e){} }
  if(!p) return;
  const skills = await getMemberSkills(id);
  const wins = myWinTitles(id, await getPrevWinners());
  const own = (getMe()===id);
  let sk = skills.map(s=>({name:s.name,level:s.level}));
  const edit = !!startEdit && own;
  if (edit && !sk.length) sk = [{name:'',level:3}];   // 편집 진입 시 빈 스킬 1개 시드
  mmState = { id, name:p.name, jersey:(p.jersey!=null?p.jersey:null), role:(MEMBER_ROLES[p.name]||null),
    wins, skills:sk, edit, own };
  renderMemberCard();
}
function closeMemberCard(){ mmState=null; const h=document.getElementById('mmHost'); if(h) h.innerHTML=''; }
// 모달(mmHost)이 열려 있으면 배경(body) 스크롤 잠금 — 모든 모달에 일괄 적용
(function(){
  function sync(){ const h=document.getElementById('mmHost'); document.body.style.overflow = (h && h.innerHTML.trim()) ? 'hidden' : ''; }
  function attach(){ let h=document.getElementById('mmHost'); if(!h){ h=document.createElement('div'); h.id='mmHost'; document.body.appendChild(h); } new MutationObserver(sync).observe(h,{childList:true}); sync(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',attach); else attach();
})();
// 홈 화면에 추가 가이드(모달)
function showAddHomeGuide(){
  let h=document.getElementById('mmHost'); if(!h){ h=document.createElement('div'); h.id='mmHost'; document.body.appendChild(h); }
  const ol = `style="margin:6px 0 4px 18px;padding:0;font-size:13px;color:var(--cream);line-height:1.9"`;
  h.innerHTML = `<div class="mm-back" onclick="if(event.target===this)closeMemberCard()"><div class="mm-box">
    <div class="mm-head"><div class="mm-name">홈 화면에 추가</div><button class="mm-x" onclick="closeMemberCard()">×</button></div>
    <p class="hint" style="margin:2px 0 14px">앱처럼 한 번에 열 수 있어요. 기기에 맞게 따라 해 주세요.</p>
    <div class="mm-sec">아이폰 · Safari</div>
    <ol ${ol}><li>하단 <b>공유</b> 버튼 탭</li><li><b>홈 화면에 추가</b> 선택</li><li>오른쪽 위 <b>추가</b> 탭</li></ol>
    <div class="mm-sec">안드로이드 · Chrome</div>
    <ol ${ol}><li>오른쪽 위 <b>⋮ 메뉴</b> 탭</li><li><b>홈 화면에 추가</b> 선택</li><li><b>추가</b> 탭</li></ol>
  </div></div>`;
}
function mmEdit(on){ if(!mmState) return; mmState.edit=on; if(on && !mmState.skills.length) mmState.skills=[{name:'',level:3}]; renderMemberCard(); }
function mmAddSkill(){ if(mmState){ mmState.skills.push({name:'',level:3}); renderMemberCard(); } }
function mmDelSkill(i){ if(mmState){ mmState.skills.splice(i,1); renderMemberCard(); } }
function mmSetLevel(i,lv){ if(mmState){ mmState.skills[i].level=lv; renderMemberCard(); } }
function mmSetName(i,v){ if(mmState && mmState.skills[i]) mmState.skills[i].name=v; }
function mmMoveSkill(i,dir){ if(!mmState) return; const a=mmState.skills, j=i+dir; if(j<0||j>=a.length) return; const t=a[i]; a[i]=a[j]; a[j]=t; renderMemberCard(); }
async function mmSave(){
  if(!mmState) return;
  const arr = mmState.skills.map(s=>({name:(s.name||'').trim(), level:Math.max(1,Math.min(5,s.level||3))})).filter(s=>s.name);
  if(!(await saveMemberSkills(mmState.id, arr))){ toast('저장 오류'); return; }
  mmState.skills=arr; mmState.edit=false; toast('스킬을 저장했어요'); renderMemberCard();
}
function radarSvg(skills){
  const n=skills.length; if(n<3) return '';
  const cx=110,cy=110,R=82,rings=5; let g='';
  for(let k=1;k<=rings;k++){ const rr=R*k/rings; let pts=''; for(let i=0;i<n;i++){ const a=-Math.PI/2+i*2*Math.PI/n; pts+=(cx+rr*Math.cos(a)).toFixed(1)+','+(cy+rr*Math.sin(a)).toFixed(1)+' '; } g+=`<polygon points="${pts}" fill="none" stroke="#33492f" stroke-width="1"/>`; }
  for(let i=0;i<n;i++){ const a=-Math.PI/2+i*2*Math.PI/n; g+=`<line x1="${cx}" y1="${cy}" x2="${(cx+R*Math.cos(a)).toFixed(1)}" y2="${(cy+R*Math.sin(a)).toFixed(1)}" stroke="#33492f" stroke-width="1"/>`; }
  let dp=''; for(let i=0;i<n;i++){ const a=-Math.PI/2+i*2*Math.PI/n; const rr=R*(skills[i].level/5); dp+=(cx+rr*Math.cos(a)).toFixed(1)+','+(cy+rr*Math.sin(a)).toFixed(1)+' '; }
  g+=`<polygon points="${dp}" fill="rgba(221,214,182,.35)" stroke="#ddd6b6" stroke-width="2"/>`;
  for(let i=0;i<n;i++){ const a=-Math.PI/2+i*2*Math.PI/n; const lx=cx+(R+15)*Math.cos(a), ly=cy+(R+15)*Math.sin(a); const anc=Math.abs(Math.cos(a))<0.3?'middle':(Math.cos(a)>0?'start':'end'); g+=`<text x="${lx.toFixed(1)}" y="${(ly+3).toFixed(1)}" fill="#ece6d2" font-size="11" font-weight="600" text-anchor="${anc}">${esc(skills[i].name)} ${skills[i].level}</text>`; }
  return `<svg viewBox="0 0 220 220" style="width:100%;max-width:230px;display:block;margin:6px auto 0;overflow:visible">${g}</svg>`;
}
// 내 카드 이미지 저장 (SCF 로고 + 등번호·이름·역할 + 스킬 레이더)
async function saveMyCard(){
  const me=getMe(); if(me==null) return;
  const p=(typeof PLAYERS!=='undefined'?PLAYERS:[]).find(z=>z.id===me)||{};
  const skills=await getMemberSkills(me);
  const name=meName();
  const meT=(typeof TEAM_SHEET!=='undefined'?TEAM_SHEET[p.name]:null)||{};
  const jersey=(p.jersey!=null)?p.jersey:((meT.jersey!=null)?meT.jersey:'–');
  // 개인 스탯 (홈 카드와 동일 계산)
  let attCountAll=0, attRate=null, recent3=null;
  try{ const tb=await fetchTeamBuilder(); const tp=(tb&&tb.players||[]).find(z=>z.id===me); if(tp){ attCountAll=tp.attCountAll??tp.attCount??0; attRate=tp.attendanceAll??tp.attendance??null; recent3=recent3Rate(tp, tb.sessions);} }catch(e){}
  const winCount=(await getWinCounts())[me]||0;
  const joinFmt=p.joinDate?p.joinDate.slice(0,7).replace('-','.'):'—';
  const _mT=monthsSince(p.joinDate); const monthsLabel=_mT>0?_mT+'개월':'이번 달';
  const stats=[['가입월',joinFmt],['함께한 기간',monthsLabel],['참여 세션',attCountAll+'회'],['전체 출석률',attRate!=null?Math.round(attRate)+'%':'—'],['최근 3개월',recent3!=null?recent3+'%':'—'],['수상 횟수',winCount+'회']];
  const W=640,H=1050, c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d');
  try{ await document.fonts.ready; }catch(e){}
  const loadImg = src => new Promise(r=>{ const im=new Image(); im.onload=()=>r(im); im.onerror=()=>r(null); im.src=src; });
  const [bgImg, logoImg] = await Promise.all([loadImg('scf_bg.png'), loadImg('img/scf_logo_preview.png')]);
  // 잔디 배경(cover) + 어두운 오버레이
  x.fillStyle='#15281b'; x.fillRect(0,0,W,H);
  if(bgImg){ const s=Math.max(W/bgImg.naturalWidth, H/bgImg.naturalHeight), dw=bgImg.naturalWidth*s, dh=bgImg.naturalHeight*s; x.drawImage(bgImg,(W-dw)/2,(H-dh)/2,dw,dh); x.fillStyle='rgba(18,32,22,0.82)'; x.fillRect(0,0,W,H); }
  x.strokeStyle='#33492f'; x.lineWidth=2; x.strokeRect(16,16,W-32,H-32);
  x.textAlign='center';
  x.fillStyle='#ece6d2'; x.font='98px "Anton","Pretendard",sans-serif'; x.fillText(String(jersey), W/2, 168);
  x.font='800 36px "Pretendard",sans-serif'; x.fillText(name, W/2, 227);
  const wins = myWinTitles(me, await getPrevWinners());
  if(wins.length) drawWinPills(x, W/2, 261, wins);
  const dy = wins.length ? 289 : 275;
  x.strokeStyle='#33492f'; x.lineWidth=1; x.beginPath(); x.moveTo(90, dy); x.lineTo(W-90, dy); x.stroke();
  // 스탯 그리드 (3열 x 2행)
  const colX=[W/2-150, W/2, W/2+150], r0=dy+58, r1=r0+76;
  stats.forEach((s,i)=>{ const cx=colX[i%3], cy=(i<3)?r0:r1;
    x.textAlign='center'; x.fillStyle='#ece6d2'; x.font='800 24px "Pretendard",sans-serif'; x.fillText(s[1], cx, cy);
    x.fillStyle='#a4b39a'; x.font='400 14px "Pretendard",sans-serif'; x.fillText(s[0], cx, cy+21); });
  const dy2 = r1+72;
  x.strokeStyle='#33492f'; x.lineWidth=1; x.beginPath(); x.moveTo(90, dy2); x.lineTo(W-90, dy2); x.stroke();
  let radarBottom;
  if(skills.length>=3){ const rcy=dy2+222, R=146; drawRadarCanvas(x, W/2, rcy, R, skills); radarBottom=rcy+R+22; }
  else { x.fillStyle='#a4b39a'; x.textAlign='center'; x.font='400 18px "Pretendard",sans-serif'; x.fillText(skills.length?('스킬 '+skills.length+'개'):'스킬 미설정', W/2, dy2+70); radarBottom=dy2+90; }
  if(logoImg){ const lw=88, lh=lw*logoImg.naturalHeight/logoImg.naturalWidth; const yLogo=Math.max(radarBottom+30, H-lh-42); x.drawImage(logoImg,(W-lw)/2, yLogo, lw, lh); }
  let url; try{ url=c.toDataURL('image/png'); }catch(e){ toast('이미지 생성 실패'); return; }
  showCardPreview(url, name||'card');
}
// 카드 이미지 미리보기 → 저장
function showCardPreview(url, name){
  let h=document.getElementById('mmHost'); if(!h){ h=document.createElement('div'); h.id='mmHost'; document.body.appendChild(h); }
  h.innerHTML = `<div class="mm-back" onclick="if(event.target===this)closeMemberCard()"><div class="mm-box">
    <div class="mm-head"><div class="mm-name">사진 저장</div><button class="mm-x" onclick="closeMemberCard()">×</button></div>
    <img src="${url}" alt="내 카드" style="width:100%;border-radius:10px;display:block;border:1px solid var(--line)">
    <p class="hint" style="margin:10px 0 12px;font-size:11px">아이폰은 위 이미지를 길게 눌러 "사진에 저장"하세요.</p>
    <a href="${url}" download="싸커피_${name}.png" class="btn accent" style="display:block;text-align:center;text-decoration:none" onclick="setTimeout(closeMemberCard,300)">저장하기</a>
  </div></div>`;
}
function drawWinPills(x, cx, cy, wins){
  x.font='800 17px "Pretendard",sans-serif'; x.textAlign='center';
  const padX=13, gap=8, h=28;
  const ws = wins.map(t=>x.measureText(t).width + padX*2);
  const total = ws.reduce((a,b)=>a+b,0) + gap*(wins.length-1);
  let xx = cx - total/2;
  wins.forEach((t,i)=>{
    const w=ws[i], yy=cy-h/2, r=h/2;
    x.fillStyle = (t==='MVP') ? '#e0a530' : '#5a9277';
    x.beginPath(); x.moveTo(xx+r,yy); x.arcTo(xx+w,yy,xx+w,yy+h,r); x.arcTo(xx+w,yy+h,xx,yy+h,r); x.arcTo(xx,yy+h,xx,yy,r); x.arcTo(xx,yy,xx+w,yy,r); x.closePath(); x.fill();
    x.fillStyle = (t==='MVP') ? '#3a2600' : '#ffffff';
    x.fillText(t, xx+w/2, cy+6);
    xx += w + gap;
  });
}
function drawRadarCanvas(x, cx, cy, R, skills){
  const n=skills.length; if(n<3) return;
  for(let k=1;k<=5;k++){ x.beginPath(); for(let i=0;i<n;i++){ const a=-Math.PI/2+i*2*Math.PI/n; const px=cx+R*k/5*Math.cos(a), py=cy+R*k/5*Math.sin(a); i?x.lineTo(px,py):x.moveTo(px,py);} x.closePath(); x.strokeStyle='#33492f'; x.lineWidth=1; x.stroke(); }
  for(let i=0;i<n;i++){ const a=-Math.PI/2+i*2*Math.PI/n; x.beginPath(); x.moveTo(cx,cy); x.lineTo(cx+R*Math.cos(a),cy+R*Math.sin(a)); x.strokeStyle='#33492f'; x.lineWidth=1; x.stroke(); }
  x.beginPath(); for(let i=0;i<n;i++){ const a=-Math.PI/2+i*2*Math.PI/n; const rr=R*skills[i].level/5; const px=cx+rr*Math.cos(a), py=cy+rr*Math.sin(a); i?x.lineTo(px,py):x.moveTo(px,py);} x.closePath(); x.fillStyle='rgba(221,214,182,.35)'; x.fill(); x.strokeStyle='#ddd6b6'; x.lineWidth=2.5; x.stroke();
  x.fillStyle='#ece6d2'; x.font='600 18px "Pretendard",sans-serif';
  for(let i=0;i<n;i++){ const a=-Math.PI/2+i*2*Math.PI/n; const lx=cx+(R+22)*Math.cos(a), ly=cy+(R+22)*Math.sin(a); x.textAlign=Math.abs(Math.cos(a))<0.3?'center':(Math.cos(a)>0?'left':'right'); x.fillText(skills[i].name+' '+skills[i].level, lx, ly+6); }
}
function renderMemberCard(){
  let h=document.getElementById('mmHost'); if(!h){ h=document.createElement('div'); h.id='mmHost'; document.body.appendChild(h); }
  if(!mmState){ h.innerHTML=''; return; }
  const s=mmState;
  const roleHtml = s.role ? `<span class="mm-role ${s.role.type==='admin'?'admin':'other'}">${esc(s.role.role)}</span>` : '';
  const winHtml = (s.wins && s.wins.length) ? ' ' + s.wins.map(t=>`<span class="win-badge ${t==='MVP'?'mvp':'grow'}">${t}</span>`).join(' ') : '';
  let body;
  if(s.edit){
    body = `<div class="hint" style="margin-bottom:8px;font-size:11px">스킬명은 최대 5자 · 레벨 1~5 · ▲▼로 순서 이동</div>` + s.skills.map((sk,i)=>`<div class="sk-row"><span class="sk-mvs"><button class="sk-mv" onclick="mmMoveSkill(${i},-1)" ${i===0?'disabled':''} title="위로">▲</button><button class="sk-mv" onclick="mmMoveSkill(${i},1)" ${i===s.skills.length-1?'disabled':''} title="아래로">▼</button></span><input type="text" maxlength="5" value="${esc(sk.name)}" placeholder="스킬명 (5자)" oninput="mmSetName(${i},this.value)"><span class="sk-lv">${[1,2,3,4,5].map(lv=>`<button class="${sk.level===lv?'on':''}" onclick="mmSetLevel(${i},${lv})">${lv}</button>`).join('')}</span><button class="sk-del" onclick="mmDelSkill(${i})">×</button></div>`).join('')
      + `<button class="btn ghost sm" onclick="mmAddSkill()" style="margin-top:4px">＋ 스킬 추가</button><div style="display:flex;gap:8px;margin-top:14px"><button class="btn accent sm" onclick="mmSave()" style="flex:1">저장</button><button class="btn ghost sm" onclick="mmEdit(false)">취소</button></div>`;
  } else {
    const radar = radarSvg(s.skills);
    body = s.skills.length
      ? (radar || s.skills.map(sk=>`<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--cream);padding:4px 0"><span>${esc(sk.name)}</span><span style="color:var(--accent);font-weight:800">${sk.level}/5</span></div>`).join(''))
      : `<div class="empty" style="font-size:13px">${s.own?'아직 스킬이 없어요. 추가해보세요.':'아직 스킬 미설정'}</div>`;
    if(s.own) body += `<button class="btn ghost sm" onclick="mmEdit(true)" style="margin-top:12px;width:100%">스킬 편집</button>`;
  }
  h.innerHTML = `<div class="mm-back" onclick="if(event.target===this)closeMemberCard()"><div class="mm-box"><div class="mm-head"><span class="mm-no">${s.jersey!=null?s.jersey:'–'}</span><div><div class="mm-name">${esc(s.name)}${winHtml}</div>${roleHtml}</div><button class="mm-x" onclick="closeMemberCard()">×</button></div><div class="mm-sec">스킬</div>${body}</div></div>`;
}

/* ============================================================
   참석
   ============================================================ */
const ATT_STORE = 'socoffee_attendance_v1';
const ME_KEY = 'socoffee_me';            // 이 브라우저의 '나' (멤버 id)
function getMe(){ const v = localStorage.getItem(ME_KEY); return v?Number(v):null; }
function setMe(id){ localStorage.setItem(ME_KEY, String(id)); }

// ===== PIN 로그인 (등번호 대체) — PIN은 해시로만 저장(평문 미저장) =====
let CLUB_PINS = {};                      // { memberId: sha256hex }
let BANK = null;                         // { bank, number, holder } — 회비 계좌
let SURVEY = null;                        // { title, link, done:[memberId] } — 설문(링크 + 완료 자기보고)
const SURVEY_DEFAULT = { title:'클럽 설문', link:'', done:[] };
function curSurvey(){ return SURVEY ? SURVEY : Object.assign({}, SURVEY_DEFAULT); }
// 2026 SS 유니폼 사이즈 조사
let UNIFORM = null;                       // { sizes: { memberId: '120' } }
const UNIFORM_LOCKED = true;              // 주문 확정 → 사이즈 수정 잠금(읽기전용). 다시 열려면 false.
const UNIFORM_SIZES = ['65','70','75','80','85','90','95','100','105','110','115','120'];
const UNIFORM_SEED = { '손다희':'95','김이연':'105','장세영':'120','박광우':'115','신동헌':'105','한승재':'110','최승호':'105','함지상':'115','박승한':'115','홍순인':'120','정은용':'90','조수경':'100','마상현':'115','김우경':'90','조수연':'95','김균원':'120','임한':'100','정희범':'115','심소른':'90','이일웅':'100','안재영':'110','정하림':'100','심지수':'105','박원주':'100','박우성':'105','박지원':'95','정민주':'110','김두은':'95','이민국':'105','조지훈':'105','김유솔':'80','김재유':'100','한재욱':'105','도민환':'100','이희성':'110','허은혜':'90','조은애':'100','브루노':'105','원재식':'120','표승철':'105' };
function uniformSizeOf(m){ const s=(UNIFORM&&UNIFORM.sizes)||{}; return (s[m.id]!=null) ? s[m.id] : (UNIFORM_SEED[m.name]||null); }
// 유니폼 조사 대상: 전체 회원(탈퇴 제외 · 휴면·친구 포함)
function uniformRoster(){
  return ROSTER.filter(p => (p.status||'active')!=='former')
    .map(p => { const t=TEAM_SHEET[p.name]||{team:'기타'}; return {...p, jersey:t.jersey, eng:t.eng||'', team:t.team, cap:!!t.cap}; })
    .sort((a,b)=>((a.jersey==null?999:a.jersey)-(b.jersey==null?999:b.jersey)) || a.name.localeCompare(b.name,'ko'));
}
// 경기 결과(월별 승리 팀) — 운영진 입력. 멤버의 현재 팀(WHITE/BLACK) 기준으로 승률 계산.
let RESULTS = null;                       // { 'YYYY-MM': 'WHITE'|'BLACK'|'draw' }
const RESULTS_SEED = { '2026-06': 'BLACK' };
// 게스트 신청(휴면 멤버가 세션 게스트 참여 신청 → 운영진 승인). settings.guestReqs = [{sid,mid,name,at,status:'pending'|'approved'}]
let GUEST_REQS = [];
let GUEST_EXTRA = {};   // { sid: n } — 박승한이 직접 정하는 외부 게스트(명단 없는) 인원
async function freshGuestReqs(){
  try{ if(USE_DB){ const {data:row}=await sb.from('club_settings').select('data').eq('id','current').maybeSingle(); if(row&&row.data){ _settingsCache=row.data; GUEST_REQS=row.data.guestReqs||[]; GUEST_EXTRA=row.data.guestExtra||{}; } } else { const s=await fetchSettings(); GUEST_REQS=s.guestReqs||[]; GUEST_EXTRA=s.guestExtra||{}; } }catch(e){}
  return GUEST_REQS;
}
function guestCountOf(sid){ return GUEST_REQS.filter(g=>g.sid===sid&&g.status==='approved').length + (GUEST_EXTRA[sid]||0); }
let _attBase = null;   // renderAtt 카운트 베이스(게스트 즉시 반영용)
function changeGuestExtra(sid, delta){   // 박승한 전용 — 외부 게스트 인원. 즉시 DOM 반영 + 백그라운드 저장(전체 재렌더 X)
  if(!isAdmin()) return;
  const n = Math.max(0, (GUEST_EXTRA[sid]||0) + delta);
  const next = { ...GUEST_EXTRA }; if(n>0) next[sid]=n; else delete next[sid];
  GUEST_EXTRA = next;
  updateGuestDom(sid);
  saveSettings({ guestExtra: next }).then(ok=>{ if(!ok) toast('게스트 저장 중 오류가 났어요'); });
}
function updateGuestDom(sid){
  const b=_attBase; if(!b||b.sid!==sid) return;
  const gx=GUEST_EXTRA[sid]||0, gaCount=b.gaMember+gx;
  const set=(id,v)=>{ const e=document.getElementById(id); if(e) e.textContent=v; };
  set('gxNum', gx);
  set('gHdr', `게스트 ${gaCount}명`);
  set('attGuestNum', gaCount);   // 게스트는 멤버 참석과 별도 카운트
  set('attRosterStat', `멤버 ${b.yesM+b.no+b.maybe}/${b.membersLen} 응답${gaCount?` · 게스트 ${gaCount}`:''}`);
  const mn=document.getElementById('gxMinus'); if(mn) mn.disabled = gx<=0;
  if (attFilter==='guest') { if(_attRows) _attRows.guest = guestRowsHtml(sid); const lb=document.getElementById('attListBody'); if(lb) lb.innerHTML = guestRowsHtml(sid); }
}
function guestStatusOf(sid, mid){ const g=GUEST_REQS.find(x=>x.sid===sid&&x.mid===mid); return g?g.status:'none'; }
async function requestGuest(sid){
  const me=getMe(); if(me==null){ toast('로그인이 필요해요'); return; }
  await freshGuestReqs();
  if(GUEST_REQS.some(g=>g.sid===sid&&g.mid===me)){ toast('이미 신청했어요'); await rerender(renderAtt); return; }
  const nm=(ROSTER.find(x=>x.id===me)||{}).name||'';
  GUEST_REQS=[...GUEST_REQS,{sid,mid:me,name:nm,at:new Date().toISOString(),status:'pending'}];
  if(!(await saveSettings({guestReqs:GUEST_REQS}))){ toast('신청 중 오류가 났어요'); return; }
  toast('게스트로 신청했어요. 운영진 승인 후 확정돼요.');
  await rerender(renderAtt);
}
async function cancelGuest(sid, mid){
  const me=getMe(); if(!isAdmin() && mid!==me) return;
  await freshGuestReqs();
  const wasApproved = GUEST_REQS.some(g=>g.sid===sid&&g.mid===mid&&g.status==='approved');
  GUEST_REQS=GUEST_REQS.filter(g=>!(g.sid===sid&&g.mid===mid));
  if(!(await saveSettings({guestReqs:GUEST_REQS}))){ toast('처리 중 오류가 났어요'); return; }
  if(wasApproved){ try{ await setAttendance(sid, mid, 'no'); }catch(e){} }
  toast('게스트 신청을 취소했어요');
  await rerender(renderAtt);
}
async function approveGuest(sid, mid){
  if(!isAdmin()) return;
  await freshGuestReqs();
  GUEST_REQS=GUEST_REQS.map(g=> (g.sid===sid&&g.mid===mid)?{...g,status:'approved'}:g);
  if(!(await saveSettings({guestReqs:GUEST_REQS}))){ toast('승인 중 오류가 났어요'); return; }
  try{ await setAttendance(sid, mid, 'yes'); }catch(e){}   // 게스트 참석 확정
  toast('게스트를 승인했어요');
  await rerender(renderAtt);
}
function curResults(){ return Object.assign({}, RESULTS_SEED, (RESULTS||{})); }
function winRateOf(team){
  if (team!=='WHITE' && team!=='BLACK') return null;
  const res = curResults();
  const decided = Object.keys(res).filter(mo => res[mo]==='WHITE' || res[mo]==='BLACK');
  if (!decided.length) return null;
  const wins = decided.filter(mo => res[mo]===team).length;
  return { rate: Math.round(wins/decided.length*100), wins, total: decided.length };
}
// 팀빌더 matches로 멤버별 승/패 집계 → {id:{w,l,d,played}}
function computeWinStats(matches){
  const map = {};
  (matches||[]).forEach(m=>{
    const bs=Number(m.blackScore), ws=Number(m.whiteScore);
    if(isNaN(bs)||isNaN(ws)) return;
    const res = bs>ws ? ['w','l'] : (ws>bs ? ['l','w'] : ['d','d']);
    (m.black||[]).forEach(id=>{ const e=map[id]=map[id]||{w:0,l:0,d:0,played:0}; e[res[0]]++; e.played++; });
    (m.white||[]).forEach(id=>{ const e=map[id]=map[id]||{w:0,l:0,d:0,played:0}; e[res[1]]++; e.played++; });
  });
  return map;
}
const PIN_SALT = 'scf-pin-v1';
async function hashPin(id, pin){
  const data = new TextEncoder().encode(PIN_SALT + ':' + id + ':' + pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
function gateNameChanged(){
  const id = Number(document.getElementById('gateName').value);
  const h = document.getElementById('gateHint');
  if (!h) return;
  if (!id) { h.textContent = ''; return; }
  h.textContent = CLUB_PINS[id]
    ? '등록된 PIN을 입력하세요.'
    : '처음이에요 — 사용할 PIN 4자리를 정해 입력하면 등록돼요.';
}
async function resetPin(id){
  if (!isAdmin()) return;
  const p = PLAYERS.find(x => x.id === id);
  if (!confirm((p ? p.name : '') + ' 님의 PIN을 초기화할까요? 다음 로그인에서 새로 정하게 돼요.')) return;
  const bak = CLUB_PINS[id];
  delete CLUB_PINS[id];
  const ok = await saveSettings({ pins: CLUB_PINS });
  if (ok) { toast('PIN을 초기화했어요.'); rerender(renderOps); }
  else { CLUB_PINS[id] = bak; toast('초기화 중 오류가 났어요.'); }
}

// 본인 PIN 변경 (현재 PIN 확인 후 새 PIN)
async function changeMyPin(){
  const me = getMe(); if (me == null) { toast('로그인이 필요해요'); return; }
  if (CLUB_PINS[me]) {
    const cur = prompt('현재 PIN 4자리'); if (cur == null) return;
    if (await hashPin(me, cur.trim()) !== CLUB_PINS[me]) { toast('현재 PIN이 일치하지 않아요'); return; }
  }
  const np = prompt('새 PIN 4자리'); if (np == null) return;
  const v = np.trim(); if (!/^\d{4}$/.test(v)) { toast('PIN은 숫자 4자리예요'); return; }
  const np2 = prompt('새 PIN 4자리 확인'); if (np2 == null) return;
  if (np2.trim() !== v) { toast('새 PIN이 서로 달라요'); return; }
  const bak = CLUB_PINS[me];
  CLUB_PINS[me] = await hashPin(me, v);
  const ok = await saveSettings({ pins: CLUB_PINS });
  if (ok) toast('PIN을 변경했어요'); else { CLUB_PINS[me] = bak; toast('변경 중 오류가 났어요'); }
}
// 회비 계좌 안내 모달
function showBankInfo(){
  let h = document.getElementById('mmHost'); if(!h){ h=document.createElement('div'); h.id='mmHost'; document.body.appendChild(h); }
  const admin = isAdmin();
  let body;
  if (BANK && BANK.number) {
    const full = `${BANK.bank||''} ${BANK.number}`.trim();
    body = `<div style="font-size:13px;color:var(--muted);line-height:1.9">
        <div>은행 <b style="color:#ece6d2;float:right">${esc(BANK.bank||'-')}</b></div>
        <div>계좌 <b style="color:#ece6d2;float:right">${esc(BANK.number)}</b></div>
        <div>예금주 <b style="color:#ece6d2;float:right">${esc(BANK.holder||'-')}</b></div>
      </div>
      <button class="btn accent" style="width:100%;margin-top:14px" onclick="copyText('${esc(full)}')">계좌 복사</button>
      ${admin?`<button class="btn ghost sm" style="width:100%;margin-top:6px" onclick="setBankInfo()">계좌 수정</button>`:''}`;
  } else {
    body = `<div class="empty" style="font-size:13px">운영진이 아직 계좌를 등록하지 않았어요.</div>
      ${admin?`<button class="btn accent" style="width:100%;margin-top:12px" onclick="setBankInfo()">계좌 등록</button>`:''}`;
  }
  h.innerHTML = `<div class="mm-back" onclick="if(event.target===this)closeMemberCard()"><div class="mm-box"><div class="mm-head"><div class="mm-name">회비 계좌</div><button class="mm-x" onclick="closeMemberCard()">×</button></div>${body}</div></div>`;
}
function copyText(t){ try{ navigator.clipboard.writeText(t); toast('복사했어요'); }catch(e){ toast('복사 실패 — 길게 눌러 복사해 주세요'); } }
// 회비 화면 인라인 계좌 카드(복사 버튼 포함)
function bankInlineHtml(){
  if (!(BANK && BANK.number)) return '';
  const full = `${BANK.bank||''} ${BANK.number}`.trim();
  return `<div class="card" style="padding:14px 16px;margin-bottom:12px">
    <div style="font-size:12px;font-weight:800;color:var(--coffee);margin-bottom:8px">입금 계좌</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.9">
      <div>은행 <b style="color:var(--cream);float:right">${esc(BANK.bank||'-')}</b></div>
      <div>계좌 <b style="color:var(--cream);float:right">${esc(BANK.number)}</b></div>
      <div>예금주 <b style="color:var(--cream);float:right">${esc(BANK.holder||'-')}</b></div>
    </div>
    <button class="btn accent" style="width:100%;margin-top:12px" onclick="copyText('${esc(full)}')">계좌 복사</button>
  </div>`;
}
async function setBankInfo(){
  if(!isAdmin()) return;
  const bank = prompt('은행명', BANK?BANK.bank||'':''); if(bank==null) return;
  const number = prompt('계좌번호', BANK?BANK.number||'':''); if(number==null) return;
  const holder = prompt('예금주', BANK?BANK.holder||'':''); if(holder==null) return;
  const val = { bank:bank.trim(), number:number.trim(), holder:holder.trim() };
  const bak = BANK; BANK = val;
  const ok = await saveSettings({ bank: val });
  if(ok){ toast('계좌를 저장했어요'); showBankInfo(); } else { BANK=bak; toast('저장 중 오류가 났어요'); }
}
// 설문조사 (링크 + 완료 자기보고 · 참여자 추적)
function showSurvey(){
  let h = document.getElementById('mmHost'); if(!h){ h=document.createElement('div'); h.id='mmHost'; document.body.appendChild(h); }
  const sv = curSurvey(); const me = getMe(); const admin = isAdmin();
  const done = Array.isArray(sv.done) ? sv.done : [];
  const iDone = me != null && done.includes(me);
  const members = activeMembers(potmMonth());
  const doneCount = members.filter(m => done.includes(m.id)).length;
  const undone = members.filter(m => !done.includes(m.id));
  let body = `<p class="sub" style="margin:0 0 12px">${esc(sv.title||'설문')}</p>`;
  if (sv.link) body += `<a href="${esc(sv.link)}" target="_blank" rel="noopener" class="btn accent" style="display:block;text-align:center;text-decoration:none">설문 열기 ↗</a>`;
  if (me != null) body += `<button class="btn ${iDone?'ghost':'accent'} sm" style="width:100%;margin-top:8px" onclick="toggleSurveyDone()">${iDone?'✓ 완료함 (취소)':'완료로 표시'}</button>`;
  body += `<p class="hint" style="margin-top:10px">참여 <b style="color:#ece6d2">${doneCount}</b> / ${members.length}명</p>`;
  if (admin) {
    body += `<div style="margin-top:8px;border-top:1px solid var(--line);padding-top:10px">
      <div style="font-size:12px;font-weight:800;color:var(--red);margin-bottom:6px">미완료 ${undone.length}명</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.8">${undone.map(m=>esc(m.name)).join(', ') || '모두 완료!'}</div>
      <button class="btn ghost sm" style="width:100%;margin-top:12px" onclick="setSurvey()">설문 설정 (제목 · 링크)</button></div>`;
  }
  h.innerHTML = `<div class="mm-back" onclick="if(event.target===this)closeMemberCard()"><div class="mm-box"><div class="mm-head"><div class="mm-name">설문조사</div><button class="mm-x" onclick="closeMemberCard()">×</button></div>${body}</div></div>`;
}
async function toggleSurveyDone(){
  const me = getMe(); if(me==null){ toast('로그인이 필요해요'); return; }
  const sv = curSurvey(); const done = Array.isArray(sv.done) ? [...sv.done] : [];
  const i = done.indexOf(me); if(i>=0) done.splice(i,1); else done.push(me);
  const next = { title:sv.title||'', link:sv.link||'', done };
  const bak = SURVEY; SURVEY = next;
  const ok = await saveSettings({ survey: next });
  if(ok){ showSurvey(); } else { SURVEY = bak; toast('저장 중 오류가 났어요'); }
}
async function setSurvey(){
  if(!isAdmin()) return;
  const sv = curSurvey();
  const title = prompt('설문 제목', sv.title||''); if(title==null) return;
  const link = prompt('설문 링크 (구글폼 응답용 viewform 링크)', sv.link||''); if(link==null) return;
  const next = { title:title.trim(), link:link.trim(), done: Array.isArray(sv.done)?sv.done:[] };
  const bak = SURVEY; SURVEY = next;
  const ok = await saveSettings({ survey: next });
  if(ok){ toast('설문을 저장했어요'); showSurvey(); } else { SURVEY = bak; toast('저장 중 오류가 났어요'); }
}
// 2026 SS 유니폼 사이즈 조사 (앱 내 입력·수정 · 미응답 추적)
function _umBox(title, body){
  let h=document.getElementById('mmHost'); if(!h){h=document.createElement('div');h.id='mmHost';document.body.appendChild(h);}
  h.innerHTML = `<div class="mm-back" onclick="if(event.target===this)closeMemberCard()"><div class="mm-box"><div class="mm-head"><div class="mm-name">${title}</div><button class="mm-x" onclick="closeMemberCard()">×</button></div>${body}</div></div>`;
}

/* ===== 팀 뽑기(드래프트) — 팀 리그 현장용. 감독 2명이 번갈아 뽑기 1/2/2/…/2/1 스네이크 ===== */
let draftState = null;
function openDraft(){ draftState = null; switchTab('draft'); }   // 전체 화면(탭)으로 열기
function _draftInit(){ const mo = statusMonth(); return { step:'setup', month:mo, all:activeMembers(mo), capA:null, capB:null, absent:new Set(), poolAll:[], turns:[], picks:[] }; }
// 팀 뽑기 전체 화면 렌더 (상단 제목 + 닫기)
function _draftPage(title, body){
  const el = document.getElementById('draftContent'); if(!el) return;
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px">
      <div class="section-title" style="margin:0">${title}</div>
      <button class="btn ghost sm" onclick="switchTab('more')">닫기</button>
    </div>${body}`;
}
function draftMemName(id){ const m=(draftState.all||[]).find(x=>x.id===id); if(!m) return String(id); return `${esc(m.name)}${m.jersey!=null?` <span style="color:var(--muted);font-size:11px">${m.jersey}</span>`:''}`; }
function draftToggleCap(id){ const s=draftState; if(!s||s.step!=='setup')return; if(s.capA===id)s.capA=null; else if(s.capB===id)s.capB=null; else if(s.capA==null)s.capA=id; else if(s.capB==null)s.capB=id; else s.capB=id; s.absent.delete(id); draftRender(); }
function draftTogglePresent(id){ const s=draftState; if(!s||s.step!=='setup')return; if(id===s.capA||id===s.capB)return; if(s.absent.has(id))s.absent.delete(id); else s.absent.add(id); draftRender(); }
function buildDraftTurns(n){ const t=[]; let cap=0,rem=n; if(rem<=0)return t; t.push({cap:0,n:1}); rem--; cap=1; while(rem>0){ if(rem<=2){ t.push({cap,n:1}); rem--; if(rem>0){ cap=1-cap; t.push({cap,n:1}); rem--; } } else { t.push({cap,n:2}); rem-=2; cap=1-cap; } } return t; }
function draftStart(){ const s=draftState; if(!s)return; if(s.capA==null||s.capB==null){ toast('감독 2명을 선택해 주세요'); return; } s.poolAll=s.all.filter(m=>m.id!==s.capA&&m.id!==s.capB&&!s.absent.has(m.id)).map(m=>m.id); if(!s.poolAll.length){ toast('뽑을 인원이 없어요'); return; } s.turns=buildDraftTurns(s.poolAll.length); s.picks=[]; s.step='draft'; draftRender(); }
function draftCurTurn(){ const s=draftState; const k=s.picks.length; let acc=0; for(let i=0;i<s.turns.length;i++){ if(k<acc+s.turns[i].n) return {ti:i,inTurn:k-acc,turn:s.turns[i]}; acc+=s.turns[i].n; } return null; }
function draftPick(id){ const s=draftState; if(!s||s.step!=='draft')return; const c=draftCurTurn(); if(!c)return; s.picks.push({id,cap:c.turn.cap}); draftRender(); }
function draftUndo(){ const s=draftState; if(!s||!s.picks.length)return; s.picks.pop(); if(s.step==='done')s.step='draft'; draftRender(); }
function draftBack(){ const s=draftState; if(!s)return; s.step='setup'; s.picks=[]; draftRender(); }
function draftCopy(){ const s=draftState; if(!s)return; const nm=id=>{const m=s.all.find(x=>x.id===id);return m?m.name:id;}; const A=[s.capA,...s.picks.filter(p=>p.cap===0).map(p=>p.id)].map(nm); const B=[s.capB,...s.picks.filter(p=>p.cap===1).map(p=>p.id)].map(nm); copyText(`[팀 뽑기 · ${potmMonthLabel(s.month)}]\nA팀 (감독 ${nm(s.capA)}) ${A.length}명: ${A.join(', ')}\nB팀 (감독 ${nm(s.capB)}) ${B.length}명: ${B.join(', ')}`); }
function draftRender(){
  if(!draftState) draftState = _draftInit();
  const s=draftState;
  if(s.step==='setup'){
    const capChips = s.all.map(m=>{ const isA=s.capA===m.id,isB=s.capB===m.id; const bg=isA?'var(--win)':(isB?'#6d5db0':'transparent'); return `<button onclick="draftToggleCap(${m.id})" style="border:1px solid ${isA||isB?bg:'var(--line)'};background:${bg};color:${isA||isB?'#fff':'var(--cream)'};border-radius:999px;padding:5px 11px;margin:3px;font-family:inherit;font-size:13px;cursor:pointer">${esc(m.name)}${isA?' · A':isB?' · B':''}</button>`; }).join('');
    const presentList = s.all.filter(m=>m.id!==s.capA&&m.id!==s.capB).map(m=>{ const ob=s.absent.has(m.id); return `<button onclick="draftTogglePresent(${m.id})" style="border:1px solid ${ob?'var(--line)':'var(--accent)'};background:${ob?'transparent':'rgba(224,165,48,.12)'};color:${ob?'var(--muted)':'var(--cream)'};border-radius:999px;padding:5px 11px;margin:3px;font-family:inherit;font-size:13px;cursor:pointer">${esc(m.name)}${ob?' <span style="font-size:10px;opacity:.85">관전</span>':''}</button>`; }).join('');
    const nPresent = s.all.filter(m=>m.id!==s.capA&&m.id!==s.capB&&!s.absent.has(m.id)).length;
    const nObs = s.all.filter(m=>m.id!==s.capA&&m.id!==s.capB&&s.absent.has(m.id)).length;
    _draftPage('팀 뽑기 · 준비', `
      <p class="sub" style="margin:0 0 8px">${potmMonthLabel(s.month)} 활동 회원 기준. 감독 2명을 고르고, 경기 안 하고 <b>구경할 사람은 눌러서 관전자</b>로 빼세요. (감독이 1·2·2·…·2·1 순으로 번갈아 뽑아요)</p>
      <div style="font-size:12px;font-weight:800;color:var(--coffee);margin:12px 0 4px">감독 2명 <span style="color:var(--muted);font-weight:600">${(s.capA?1:0)+(s.capB?1:0)}/2</span></div>
      <div>${capChips}</div>
      <div style="font-size:12px;font-weight:800;color:var(--coffee);margin:14px 0 4px">참여 인원 <span style="color:var(--muted);font-weight:600">${nPresent}명 · 관전 ${nObs}명 (탭하면 관전자)</span></div>
      <div>${presentList||'<span class="hint">위에서 감독을 먼저 골라주세요</span>'}</div>
      <button class="btn accent" style="width:100%;margin-top:14px" onclick="draftStart()">뽑기 시작 (${nPresent}명)</button>`);
    return;
  }
  const teamA=[s.capA,...s.picks.filter(p=>p.cap===0).map(p=>p.id)];
  const teamB=[s.capB,...s.picks.filter(p=>p.cap===1).map(p=>p.id)];
  const picked=new Set(s.picks.map(p=>p.id));
  const pool=s.poolAll.filter(id=>!picked.has(id));
  const cur=draftCurTurn(); const done=!cur||!pool.length;
  const teamCol=(title,ids,color)=>`<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:800;color:${color};margin-bottom:6px">${title} <span style="color:var(--muted)">${ids.length}명</span></div>${ids.map((id,i)=>`<div style="font-size:13px;color:var(--cream);padding:3px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i===0?'<b style="color:'+color+'">[감독]</b> ':''}${draftMemName(id)}</div>`).join('')}</div>`;
  let head;
  if(done){ head=`<div style="text-align:center;padding:9px;background:rgba(224,165,48,.14);border-radius:10px;font-weight:800;color:var(--accent);margin-bottom:12px">뽑기 완료</div>`; }
  else { const capId=(cur.turn.cap===0?s.capA:s.capB); const nm=(s.all.find(x=>x.id===capId)||{}).name||''; const left=cur.turn.n-cur.inTurn; head=`<div style="text-align:center;padding:9px;background:${cur.turn.cap===0?'rgba(70,179,129,.16)':'rgba(109,93,176,.18)'};border-radius:10px;margin-bottom:12px"><b style="color:${cur.turn.cap===0?'var(--win)':'#9a8ad6'}">${esc(nm)} 감독</b> 차례 · <b>${left}명</b> 뽑기 <span style="color:var(--muted);font-size:12px">(이번 턴 ${cur.turn.n}명)</span></div>`; }
  const poolHtml = done? '' : `<div style="font-size:12px;font-weight:800;color:var(--coffee);margin:12px 0 4px">남은 인원 ${pool.length}</div><div>${pool.map(id=>`<button onclick="draftPick(${id})" style="border:1px solid var(--accent);background:rgba(224,165,48,.1);color:var(--cream);border-radius:999px;padding:6px 12px;margin:3px;font-family:inherit;font-size:13px;cursor:pointer">${draftMemName(id)}</button>`).join('')}</div>`;
  _draftPage('팀 뽑기', `
    ${head}
    <div style="display:flex;gap:14px;padding:10px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">${teamCol('A팀',teamA,'var(--win)')}${teamCol('B팀',teamB,'#9a8ad6')}</div>
    ${poolHtml}
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn ghost sm" style="flex:1" onclick="draftUndo()" ${s.picks.length?'':'disabled'}>되돌리기</button>
      ${done?`<button class="btn accent sm" style="flex:1" onclick="draftCopy()">결과 복사</button>`:''}
      <button class="btn ghost sm" style="flex:1" onclick="draftBack()">처음부터</button>
    </div>`);
}
async function showUniform(){
  try{ if(USE_DB){ const {data:row}=await sb.from('club_settings').select('data').eq('id','current').maybeSingle(); if(row&&row.data){ _settingsCache=row.data; UNIFORM=row.data.uniform||UNIFORM; } } }catch(e){}
  const me=getMe(); const admin=isAdmin();
  const roster=uniformRoster();
  const meM = me!=null ? roster.find(x=>x.id===me) : null;
  const mySize = meM ? uniformSizeOf(meM) : null;
  const confIds = (UNIFORM && UNIFORM.confirmedIds) || [];
  const myConfirmed = me!=null && confIds.includes(me);
  let body = `<p class="sub" style="margin:0 0 12px">2026 SS 유니폼 사이즈 ${UNIFORM_LOCKED?'— <b>주문 확정으로 마감</b>됨 (수정 불가)':'를 골라주세요. (단위 cm · 상의)'}</p>`;
  if(meM){
    if(UNIFORM_LOCKED){
      body += `<div class="field"><label>내 사이즈 <span style="color:var(--muted);font-weight:400">등번호 ${meM.jersey!=null?meM.jersey:'-'}</span></label>
        <div class="sv-text" style="opacity:.85">${mySize?esc(mySize):'미입력'}</div></div>
        <p class="hint" style="text-align:center;margin-top:6px">유니폼 주문이 확정되어 <b>수정할 수 없어요</b>. 변경이 필요하면 운영진(박승한)에게 문의해 주세요.</p>`;
    } else if(myConfirmed){
      body += `<div class="field"><label>내 사이즈 <span style="color:var(--muted);font-weight:400">등번호 ${meM.jersey!=null?meM.jersey:'-'}</span></label>
        <div class="sv-text" style="opacity:.85">${mySize?esc(mySize):'미입력'} <span style="color:var(--win);font-size:12px;font-weight:800;margin-left:4px">확정됨</span></div></div>
        <p class="hint" style="text-align:center;margin-top:6px">확정됐어요. 수정하려면 운영진(박승한)에게 문의해 주세요.</p>`;
    } else {
      body += `<div class="field"><label>내 사이즈 <span style="color:var(--muted);font-weight:400">등번호 ${meM.jersey!=null?meM.jersey:'-'}</span></label>
        <select id="unifSel" class="sv-text">${['<option value="">사이즈 선택</option>'].concat(UNIFORM_SIZES.map(s=>`<option value="${s}" ${mySize===s?'selected':''}>${s}</option>`)).join('')}</select></div>
        <button class="btn accent" style="width:100%;margin-top:8px" onclick="saveMyUniform()">${mySize?'수정 저장':'제출'}</button>
        ${mySize?`<button class="btn sm" style="width:100%;margin-top:6px;background:var(--win);color:#fff;border:none" onclick="confirmMyUniform()">사이즈 확정</button>`:''}`;
    }
  } else {
    body += `<div class="empty" style="font-size:13px">조사 대상이 아니에요.</div>`;
  }
  const doneCount = roster.filter(m=>uniformSizeOf(m)).length;
  const confCount = roster.filter(m=>confIds.includes(m.id)).length;
  body += `<p class="hint" style="margin-top:10px">응답 <b style="color:#ece6d2">${doneCount}</b> / ${roster.length}명 · 확정 <b style="color:var(--win)">${confCount}</b>명</p>`;
  if(admin && UNIFORM_LOCKED){
    body += `<div style="margin-top:8px;border-top:1px solid var(--line);padding-top:10px"><button class="btn ghost sm" style="width:100%" onclick="showUniformAll()">전체 응답 보기 (읽기전용)</button></div>`;
  } else if(admin){
    const undone = roster.filter(m=>!uniformSizeOf(m));
    body += `<div style="margin-top:8px;border-top:1px solid var(--line);padding-top:10px">
      <div style="font-size:12px;font-weight:800;color:var(--red);margin-bottom:6px">미응답 ${undone.length}명 <span style="color:var(--muted);font-weight:400">· 이름 눌러 대리 입력</span></div>
      <div style="line-height:2.1">${undone.length?undone.map(m=>`<button onclick="pickUniformFor(${m.id})" style="background:none;border:1px solid var(--line);border-radius:6px;color:var(--cream);font-family:inherit;font-size:12px;padding:3px 9px;margin:2px 4px 2px 0;cursor:pointer">${esc(m.name)}</button>`).join(''):'<span style="font-size:13px;color:var(--muted)">모두 완료!</span>'}</div>
      <button class="btn ghost sm" style="width:100%;margin-top:12px" onclick="showUniformAll()">전체 응답 보기</button></div>`;
    if(meName()==='박승한'){
      const confList = roster.filter(m=>confIds.includes(m.id));
      body += `<div style="margin-top:8px;border-top:1px solid var(--line);padding-top:10px">
        <div style="font-size:12px;font-weight:800;color:var(--win);margin-bottom:6px">확정 ${confList.length}명 <span style="color:var(--muted);font-weight:400">· 눌러서 확정 해제</span></div>
        <div style="line-height:2.1">${confList.length?confList.map(m=>`<button onclick="unconfirmUniformFor(${m.id})" style="background:var(--win-bg);border:1px solid var(--win);border-radius:6px;color:var(--win);font-family:inherit;font-size:12px;font-weight:800;padding:3px 9px;margin:2px 4px 2px 0;cursor:pointer">${esc(m.name)} ${esc(uniformSizeOf(m))} ✕</button>`).join(''):'<span style="font-size:13px;color:var(--muted)">아직 없음</span>'}</div></div>`;
    }
  }
  _umBox('유니폼 사이즈 조사', body);
}
// 유니폼 저장: DB 최신값을 다시 읽어 delta만 적용(동시 확정/변경 유실 방지). patchFn이 false 반환 시 중단.
async function saveUniformPatch(patchFn){
  let cur = {};
  try {
    if (USE_DB){ const {data:row}=await sb.from('club_settings').select('data').eq('id','current').maybeSingle(); cur=(row&&row.data)||{}; _settingsCache=cur; }
    else { cur = await fetchSettings(); }
  } catch(e){ try{ cur = await fetchSettings(); }catch(_){ cur={}; } }
  const uni = { sizes: Object.assign({}, (cur.uniform&&cur.uniform.sizes)||{}), confirmedIds: [...((cur.uniform&&cur.uniform.confirmedIds)||[])] };
  if (patchFn(uni) === false) return 'abort';
  UNIFORM = uni;
  return await saveSettings({ uniform: uni });
}
async function saveMyUniform(){
  if(UNIFORM_LOCKED){ toast('유니폼 주문이 확정되어 수정할 수 없어요'); return; }
  const me=getMe(); if(me==null){ toast('로그인이 필요해요'); return; }
  const sel=document.getElementById('unifSel'); const v=sel?sel.value:'';
  if(!v){ toast('사이즈를 선택해 주세요'); return; }
  const res=await saveUniformPatch(u=>{ if(u.confirmedIds.includes(me)) return false; u.sizes[me]=v; });
  if(res==='abort'){ toast('확정된 사이즈예요. 운영진(박승한)에게 문의해 주세요'); showUniform(); return; }
  if(res){ toast('저장했어요'); showUniform(); } else { toast('저장 중 오류가 났어요'); }
}
async function confirmMyUniform(){
  if(UNIFORM_LOCKED){ toast('유니폼 주문이 확정되어 수정할 수 없어요'); return; }
  const me=getMe(); if(me==null){ toast('로그인이 필요해요'); return; }
  const sz = uniformSizeOf(uniformRoster().find(x=>x.id===me)||{});
  if(!sz){ toast('먼저 사이즈를 선택·저장해 주세요'); return; }
  const res=await saveUniformPatch(u=>{ if(!u.confirmedIds.includes(me)) u.confirmedIds.push(me); });
  if(res && res!=='abort'){ toast('사이즈를 확정했어요'); showUniform(); } else if(res!=='abort'){ toast('저장 중 오류가 났어요'); }
}
async function unconfirmUniformFor(id){
  if(UNIFORM_LOCKED){ toast('유니폼 주문이 확정되어 수정할 수 없어요'); return; }
  if(meName()!=='박승한'){ toast('확정 해제는 박승한(운영진)만 가능해요'); return; }
  const res=await saveUniformPatch(u=>{ u.confirmedIds=u.confirmedIds.filter(x=>x!==id); });
  if(res && res!=='abort'){ toast('확정을 해제했어요'); showUniform(); } else if(res!=='abort'){ toast('저장 중 오류가 났어요'); }
}
function showUniformAll(){
  if(!isAdmin()) return;
  const roster=uniformRoster();
  const savedMap = (UNIFORM&&UNIFORM.sizes)||{};
  const rows=roster.map(m=>{
    const sz=uniformSizeOf(m);
    const seedSz=UNIFORM_SEED[m.name];
    const changed = savedMap[m.id]!=null && seedSz!=null && String(savedMap[m.id])!==String(seedSz);
    const tag = changed ? ` <span style="color:var(--win);font-size:11px;font-weight:800">변경</span> <span style="color:var(--muted);font-size:11px;font-weight:400">(${esc(seedSz)}→)</span>` : '';
    return `<div onclick="pickUniformFor(${m.id})" style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:8px 0;border-bottom:1px solid var(--line);cursor:pointer"><span style="color:var(--cream)">${m.jersey!=null?`<span style="color:var(--muted)">${m.jersey}</span> `:''}${esc(m.name)}</span><span style="color:${sz?'var(--accent)':'var(--muted)'};font-weight:800;white-space:nowrap">${tag}${sz||'미응답'} ›</span></div>`;
  }).join('');
  const changedCount = roster.filter(m=>{ const seedSz=UNIFORM_SEED[m.name]; return savedMap[m.id]!=null && seedSz!=null && String(savedMap[m.id])!==String(seedSz); }).length;
  _umBox('유니폼 전체 응답', `<p class="hint" style="margin:0 0 8px">${UNIFORM_LOCKED?'주문 확정 · 읽기전용':'이름 눌러 수정'} · 변경 ${changedCount}명</p>${rows}<button class="btn ghost sm" style="width:100%;margin-top:12px" onclick="showUniform()">← 돌아가기</button>`);
}
function pickUniformFor(id){
  if(!isAdmin()) return;
  if(UNIFORM_LOCKED){ toast('유니폼 주문이 확정되어 수정할 수 없어요'); return; }
  const m = uniformRoster().find(x=>x.id===id); if(!m) return;
  const cur = uniformSizeOf(m);
  _umBox('사이즈 대리 입력', `<p class="sub" style="margin:0 0 12px">${esc(m.name)} <span style="color:var(--muted)">등번호 ${m.jersey!=null?m.jersey:'-'}</span></p>
    <select id="unifSelA" class="sv-text">${['<option value="">사이즈 선택</option>'].concat(UNIFORM_SIZES.map(s=>`<option value="${s}" ${cur===s?'selected':''}>${s}</option>`)).join('')}</select>
    <button class="btn accent" style="width:100%;margin-top:10px" onclick="saveUniformFor(${id})">저장</button>
    <button class="btn ghost sm" style="width:100%;margin-top:6px" onclick="showUniform()">← 돌아가기</button>`);
}
async function saveUniformFor(id){
  if(!isAdmin()) return;
  if(UNIFORM_LOCKED){ toast('유니폼 주문이 확정되어 수정할 수 없어요'); return; }
  const sel=document.getElementById('unifSelA'); const v=sel?sel.value:'';
  if(!v){ toast('사이즈를 선택해 주세요'); return; }
  const res=await saveUniformPatch(u=>{ if(u.confirmedIds.includes(id)) return false; u.sizes[id]=v; });
  if(res==='abort'){ toast('확정된 사이즈예요. 확정 해제 후 변경해 주세요'); showUniform(); return; }
  if(res){ toast('저장했어요'); showUniform(); } else { toast('저장 중 오류가 났어요'); }
}
// 경기 결과 관리 (운영진)
function showResults(){
  if(!isAdmin()) return;
  const res = curResults();
  const months = Object.keys(res).sort().reverse();
  const rows = months.map(mo=>{ const w=res[mo]; const col=w==='BLACK'?'#ece6d2':(w==='WHITE'?'#ddd6b6':'var(--muted)'); const lbl=w==='draw'?'무승부':w+' 승'; return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)"><span style="color:var(--cream);font-size:13px">${potmMonthLabel(mo)}</span><span style="color:${col};font-weight:800;font-size:13px">${lbl}</span></div>`; }).join('');
  _umBox('경기 결과', `<p class="hint" style="margin:0 0 8px">월별 승리 팀</p>${rows||'<div class="empty" style="font-size:13px">기록이 없어요.</div>'}<button class="btn accent sm" style="width:100%;margin-top:12px" onclick="setResult()">결과 입력 / 수정</button>`);
}
async function setResult(){
  if(!isAdmin()) return;
  const mo = prompt('월 (YYYY-MM)', potmMonth()); if(mo==null) return;
  if(!/^\d{4}-\d{2}$/.test(mo.trim())){ toast('YYYY-MM 형식으로 입력해 주세요'); return; }
  const w = prompt('승리 팀 (WHITE / BLACK / draw)', 'BLACK'); if(w==null) return;
  const u = w.trim().toUpperCase(); const val = (u==='WHITE'||u==='BLACK') ? u : (w.trim().toLowerCase()==='draw' ? 'draw' : null);
  if(!val){ toast('WHITE / BLACK / draw 중 입력해 주세요'); return; }
  const results = Object.assign({}, curResults()); results[mo.trim()] = val;
  const bak = RESULTS; RESULTS = results;
  const ok = await saveSettings({ results });
  if(ok){ toast('저장했어요'); showResults(); } else { RESULTS = bak; toast('저장 중 오류가 났어요'); }
}
async function fetchAttendance(sessionId) {
  if (!sessionId) sessionId = (await nearestSession()).id;
  if (USE_DB) {
    const { data, error } = await sb.from('attendance').select('member_id, status').eq('session_id', sessionId);
    if (error) { return []; }
    return data;
  }
  let a=[]; try { a = JSON.parse(localStorage.getItem(ATT_STORE)) || []; } catch(e){}
  return a.filter(x=>x.session_id===sessionId);
}
// 최근 3개월 출석률(%): 팀빌더 sessions(과거 경기 기록) 기준. 가입 전·휴면 달은 분모에서 제외.
function recent3Rate(tp, sessions) {
  if (!tp || !Array.isArray(sessions)) return null;
  const cut = new Date(); cut.setMonth(cut.getMonth() - 3);
  const cutStr = cut.toISOString().slice(0, 10);
  const jd = tp.joinDate || '';
  const dorm = new Set(tp.dormantMonths || []);
  let den = 0, num = 0;
  sessions.forEach(s => {
    const d = s.date || ''; if (!d || d < cutStr) return;
    if (jd && d < jd) return;                 // 가입 전 제외
    if (dorm.has(d.slice(0, 7))) return;      // 휴면 달 제외
    den++;
    if (Array.isArray(s.attendees) && s.attendees.includes(tp.id)) num++;
  });
  return den ? Math.round(num / den * 100) : null;
}
// 가입일로부터 함께한 개월 수
function monthsSince(iso) {
  if (!iso) return 0;
  const j = new Date(iso); if (isNaN(j)) return 0;
  const n = new Date();
  let m = (n.getFullYear() - j.getFullYear()) * 12 + (n.getMonth() - j.getMonth());
  if (n.getDate() < j.getDate()) m -= 1;
  return Math.max(0, m);
}
async function setAttendance(sessionId, memberId, status) {
  if (USE_DB) {
    const { error } = await sb.from('attendance').upsert(
      { session_id:sessionId, member_id:memberId, status, updated_at:new Date().toISOString() },
      { onConflict:'session_id,member_id' });
    if (error) { toast('저장 오류: ' + error.message); return false; }
    return true;
  }
  let a=[]; try { a = JSON.parse(localStorage.getItem(ATT_STORE)) || []; } catch(e){}
  a = a.filter(x=>!(x.session_id===sessionId && x.member_id===memberId));
  a.push({ session_id:sessionId, member_id:memberId, status });
  localStorage.setItem(ATT_STORE, JSON.stringify(a)); return true;
}

let attMe = null;
let attSessionId = null;
let attTeamView = false;     // 참석 탭: 팀별 보기 on/off
let teamSplitOn = true;      // 이번 달 팀 구분(WHITE/BLACK) 사용 여부 (운영진 설정)
let attFilter = 'yes';       // 명단 현황 상태 필터: yes(참석)/no(불참)/maybe(미정)/none(미응답). 기본 참석
let _attRows = null;         // 상태별 명단 행 캐시(필터 즉시 전환용 · 재렌더 없이)
function toggleAttTeam(){ attTeamView = !attTeamView; rerender(renderAtt); }
function setAttFilter(st){
  attFilter = st;
  if (attTeamView) { attTeamView = false; rerender(renderAtt); return; }   // 팀뷰였으면 일반뷰로 전환
  const b = document.getElementById('attListBody'); if (b && _attRows) b.innerHTML = _attRows[st] || '';
  const lbl = document.getElementById('attFilterLabel'); if (lbl) lbl.textContent = ({yes:'참석',no:'불참',maybe:'미정',none:'미응답',guest:'게스트'})[st] || '명단';
  document.querySelectorAll('.att-counts .att-cnt').forEach(c=>c.classList.toggle('sel', c.classList.contains(st)));
}
// 게스트 명단 행(승인된 멤버 게스트 + 외부 게스트) — 게스트 필터 표시용
function guestRowsHtml(sid){
  const ga = GUEST_REQS.filter(g=>g.sid===sid&&g.status==='approved');
  const gx = GUEST_EXTRA[sid]||0;
  let r = ga.map(g=>`<div class="att-row"><span class="js"></span><span class="nm">${esc(g.name)} <span style="font-size:11px;color:var(--win);font-weight:800">게스트</span></span><span class="st"></span></div>`).join('');
  if (gx>0) r += `<div class="att-row"><span class="js"></span><span class="nm">외부 게스트</span><span class="st" style="color:var(--win);font-weight:800;font-size:13px">${gx}명</span></div>`;
  return r || '<div class="empty" style="font-size:13px;padding:16px 0;text-align:center">게스트가 없어요.</div>';
}
// 참석 신청 마감: 세션에 deadline이 있으면 그 날 23:59, 없으면 매치일 직전 일요일(전주 일요일)
function autoDeadline(dateStr){
  if(!dateStr) return null;
  const d = new Date(dateStr+'T00:00:00');
  const day = d.getDay();              // 0=일
  const back = day===0 ? 7 : day;      // 직전 일요일까지
  d.setDate(d.getDate()-back);
  d.setHours(23,59,59,999);
  return d;
}
function autoDeadlineStr(dateStr){
  const d = autoDeadline(dateStr);
  if(!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function sessionDeadline(s){
  if(!s) return null;
  if(s.deadline){ const d = new Date(s.deadline+'T23:59:59'); if(!isNaN(d)) return d; }
  return autoDeadline(s.date);
}
function deadlineLabel(dl){
  if(!dl) return '';
  const days=['일','월','화','수','목','금','토'];
  return `${dl.getMonth()+1}/${dl.getDate()}(${days[dl.getDay()]}) 23:59`;
}
// 운영진 일괄 수정용 드래프트 (출석) — 클릭은 로컬에만 반영, 저장 시 일괄 DB 반영
let attDraft = {};      // memberId -> 'yes'|'no'|'maybe'|'none'
let attMapDB = {};      // 현재 DB 상태 스냅샷
let attCollapsed = {};  // 명단 그룹 접힘 상태 (key -> true=접힘)
function toggleAttGrp(k, btn){ attCollapsed[k] = !attCollapsed[k]; if(btn && btn.parentNode) btn.parentNode.classList.toggle('collapsed', attCollapsed[k]); }
async function renderAtt() {
  const el = document.getElementById('attContent');
  if (!el.innerHTML.trim()) el.innerHTML = `<div class="empty">불러오는 중...</div>`;   // 첫 로드만 로딩 표시(세션 전환 시 깜빡임 방지)
  await freshGuestReqs();   // 게스트 신청 최신화
  const sessions = await upcomingSessions();
  if (attSessionId == null || !sessions.some(s=>s.id===attSessionId)) attSessionId = sessions[0].id;
  const sess = sessions.find(s=>s.id===attSessionId);
  const dl = sessionDeadline(sess);
  const closed = dl ? (new Date() > dl) : false;
  const admin = isAdmin();
  const month = potmMonth();
  // 참석 명단 = 세션 월 기준. 세션 속성 반영: allowDormant(휴면 포함) · duesOnly(회비 납부자만)
  const sessMonth = (sess.date||'').slice(0,7);
  const [smY, smM] = sessMonth.split('-').map(Number);
  const sessMonthEnd = new Date(smY, smM, 0);
  let members;
  if (sess.allowDormant) {
    // 싸커피 데이 등: 휴면 포함 전원(탈퇴·친구 제외, 가입월 이후)
    members = ROSTER.filter(p => { const st = p.status||'active'; if (st==='former'||st==='friends') return false; return p.joinDate && new Date(p.joinDate) <= sessMonthEnd; })
      .map(p => { const t = TEAM_SHEET[p.name] || { team:'기타' }; return { ...p, jersey:t.jersey, eng:t.eng||'', team:t.team, cap:!!t.cap }; });
  } else {
    members = activeMembers(sessMonth).filter(m => !isDormantFor(m, sessMonth));
  }
  let duesPaidSet = null;
  if (sess.duesOnly) {
    const _dd = await fetchDues(sessMonth);
    duesPaidSet = new Set(_dd.filter(d => d.paid).map(d => d.member_id));
    members = members.filter(m => duesPaidSet.has(m.id));
  }
  attMe = getMe();
  const att = await fetchAttendance(sess.id);
  const map = {}; att.forEach(a=>{ map[a.member_id]=a.status; });
  attMapDB = map;
  // 운영진 드래프트가 있으면 그 값을 우선 적용해 표시
  const eff = id => (id in attDraft) ? attDraft[id] : (map[id]||'none');
  const gaCount = guestCountOf(sess.id);   // 승인된 멤버 게스트 + 외부 게스트(박승한 지정) — 멤버 참석과 별도 집계
  const yesM = members.filter(m=>eff(m.id)==='yes').length;   // 멤버 참석
  const no  = members.filter(m=>eff(m.id)==='no').length;
  const maybe = members.filter(m=>eff(m.id)==='maybe').length;
  const none = members.length - yesM - no - maybe;   // 미응답(멤버 기준)
  const respondedCnt = yesM + no + maybe;            // 멤버 응답 인원(게스트 제외)
  _attBase = { sid: sess.id, yesM, no, maybe, membersLen: members.length, gaMember: GUEST_REQS.filter(g=>g.sid===sess.id&&g.status==='approved').length };
  const mine = attMe ? map[attMe] : null;
  const nDraft = admin ? Object.keys(attDraft).length : 0;

  // 세션별 내 응답 상태 → 미응답(none)인 세션 칩에 빨간 점 (미정/참석/불참은 '응답함'으로 간주)
  let sessNeedResp = {};
  if (attMe != null) {
    try {
      const _all = await Promise.all(sessions.map(s => fetchAttendance(s.id)));
      const _meP = ROSTER.find(x => x.id === attMe);
      sessions.forEach((s, i) => {
        const a = (_all[i]||[]).find(x => x.member_id === attMe);
        if ((a ? a.status : 'none') !== 'none') return;               // 이미 응답함
        const sm = (s.date||'').slice(0,7);
        if (_meP && !s.allowDormant && isDormantFor(_meP, sm)) return;  // 참여 대상 아님
        const _dl2 = sessionDeadline(s);
        if (_dl2 && new Date() > _dl2 && !isAdmin()) return;            // 마감됨
        sessNeedResp[s.id] = true;
      });
    } catch(e){}
  }

  let html = '';
  if (sessions.length > 1) {
    html += `<div class="sess-tabs">${sessions.map(s=>`<button class="sess-chip ${s.id===attSessionId?'on':''}" onclick="pickAttSession('${s.id}')">${esc(sessChipLabel(s))}${sessNeedResp[s.id]?'<span class="chip-dot"></span>':''}</button>`).join('')}</div>`;
  }
  const _alg = isLeague(sess.date);
  html += `
    <div class="session-card">
      <span style="display:inline-block;font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;margin-bottom:6px;background:${_alg?'var(--gold)':'rgba(255,255,255,.12)'};color:${_alg?'#14281b':'var(--cream)'}">${_alg?'팀 리그':'일반'}</span>
      <div class="lbl">${sess.label?esc(sess.label):'참석 체크'}</div>
      <div class="when">${fmtSessionDate(sess.date, sess.time, sess.endTime)}</div>
      <div class="where">${sessPlaceHtml(sess)}</div>
    </div>`;

  const meActive = attMe && members.some(m=>m.id===attMe);
  if (!attMe) {
    html += `<div class="card"><div class="empty">로그인이 필요해요.</div></div>`;
  } else if (!meActive) {
    const _meP = attMe != null ? ROSTER.find(x => x.id === attMe) : null;
    const _st = _meP ? (_meP.status||'active') : 'former';
    const _joined = _meP && _st!=='former' && _st!=='friends' && _meP.joinDate && new Date(_meP.joinDate) <= sessMonthEnd;
    const _dormBlocked = _joined && !sess.allowDormant && isDormantFor(_meP, sessMonth);
    const _baseOK = _joined && (sess.allowDormant || !isDormantFor(_meP, sessMonth));
    if (_dormBlocked) {
      const gs = guestStatusOf(sess.id, attMe);
      if (gs === 'approved') html += `<div class="card"><h2>${esc(meName())} 님</h2><p class="sub">게스트 참석이 <b style="color:var(--win)">확정</b>됐어요. 아래 명단 '게스트'에 표시돼요.</p></div>`;
      else if (gs === 'pending') html += `<div class="card"><h2>${esc(meName())} 님</h2><p class="sub">게스트 신청 완료 · <b>운영진 승인 대기중</b>이에요.</p><button class="btn ghost sm" style="margin-top:10px;width:100%" onclick="cancelGuest('${sess.id}',${attMe})">신청 취소</button></div>`;
      else html += `<div class="card"><h2>${esc(meName())} 님</h2><p class="sub">이번 달 휴면이에요. 이 세션에 <b>게스트로 참여</b>하려면 신청하세요. (운영진 승인 후 확정)</p><button class="btn accent" style="margin-top:10px;width:100%" onclick="requestGuest('${sess.id}')">게스트로 신청</button></div>`;
    } else if (sess.duesOnly && _baseOK && duesPaidSet && !duesPaidSet.has(attMe)) {
      html += `<div class="card"><h2>${esc(meName())} 님</h2><p class="sub">${smM}월 회비를 납부해야 참석 신청할 수 있어요.</p><button class="btn accent" style="margin-top:10px;width:100%" onclick="switchTab('dues')">회비 납부하러 가기</button></div>`;
    } else {
      html += `<div class="card"><h2>${esc(meName())} 님</h2><p class="sub">이번 달 활동 회원이 아니라 참석 체크 대상이 아니에요.</p></div>`;
    }
  } else if (!closed) {
    const segDisabled = closed && !admin;
    const seg = ['yes','no','maybe'].map(k=>{
      const lbl = {yes:'참석',no:'불참',maybe:'미정'}[k];
      return segDisabled
        ? `<button class="${k} ${mine===k?'on':''}" disabled style="opacity:.5;cursor:default">${lbl}</button>`
        : `<button class="${k} ${mine===k?'on':''}" onclick="markAtt('${k}')">${lbl}</button>`;
    }).join('');
    const hint = segDisabled
      ? `신청이 마감됐어요 (마감 ${deadlineLabel(dl)}). 변경은 운영진에 문의해 주세요.`
      : (closed
          ? ``   // 마감 후(운영진) 안내 노출 안 함
          : `신청 마감 ${deadlineLabel(dl)}`);
    html += `
      <div class="card">
        <h2>${segDisabled ? '참석 신청 마감' : '참석하시나요?'}</h2>
        <div class="att-seg">${seg}</div>
        ${hint ? `<p class="hint">${hint}</p>` : ''}
      </div>`;
  }

  const rosterRow = m => {
    const s = eff(m.id);
    const lbl = {yes:'참석',no:'불참',maybe:'미정',none:'—'}[s];
    const dirty = admin && (m.id in attDraft);
    const st = admin
      ? `<span class="st-set">`
        + `<button class="st yes ${s==='yes'?'on':''}" onclick="attDraftSet(${m.id},'yes')">참석</button>`
        + `<button class="st no ${s==='no'?'on':''}" onclick="attDraftSet(${m.id},'no')">불참</button>`
        + `<button class="st maybe ${s==='maybe'?'on':''}" onclick="attDraftSet(${m.id},'maybe')">미정</button>`
        + `</span>`
      : `<span class="st ${s}">${lbl}</span>`;
    return `<div class="att-row${dirty?' dirty':''}"><span class="js">${m.jersey!=null?m.jersey:''}</span><span class="nm">${esc(m.name)}${dirty?' <span class="dirty-dot">●</span>':''}</span>${st}</div>`;
  };
  const sortedM = [...members].sort(byName);
  const _emptyRow = '<div class="empty" style="font-size:13px;padding:16px 0;text-align:center">해당 인원이 없어요.</div>';
  // 상태별 명단 행 미리 생성(카운트 클릭 시 즉시 전환)
  _attRows = {}; ['yes','no','maybe','none'].forEach(st=>{ _attRows[st] = sortedM.filter(m=>eff(m.id)===st).map(rosterRow).join('') || _emptyRow; });
  _attRows.guest = guestRowsHtml(sess.id);
  let listHtml;
  if (teamSplitOn && attTeamView) {
    listHtml = [['WHITE','WHITE'],['BLACK','BLACK'],['기타','기타']].map(([key,label])=>{
      const gm = sortedM.filter(m=>(m.team||'기타')===key);
      if (!gm.length) return '';
      const gy = gm.filter(m=>eff(m.id)==='yes').length;
      return `<div class="att-grp${attCollapsed[key]?' collapsed':''}"><div class="att-grp-h" onclick="toggleAttGrp('${key}',this)">${label} <span>참석 ${gy} / ${gm.length}명</span><span class="grp-caret"></span></div><div class="att-grp-body">${gm.map(rosterRow).join('')}</div></div>`;
    }).join('');
  } else {
    listHtml = _attRows[attFilter] || _emptyRow;   // 선택된 상태(기본 참석)만 표시
  }

  html += `
    <div class="att-counts">
      <div class="att-cnt yes ${attFilter==='yes'?'sel':''}" onclick="setAttFilter('yes')"><div class="num" id="attYesNum">${yesM}</div><div class="cap">참석</div></div>
      <div class="att-cnt no ${attFilter==='no'?'sel':''}" onclick="setAttFilter('no')"><div class="num">${no}</div><div class="cap">불참</div></div>
      <div class="att-cnt maybe ${attFilter==='maybe'?'sel':''}" onclick="setAttFilter('maybe')"><div class="num">${maybe}</div><div class="cap">미정</div></div>
      <div class="att-cnt none ${attFilter==='none'?'sel':''}" onclick="setAttFilter('none')"><div class="num">${none}</div><div class="cap">미응답</div></div>
      <div class="att-cnt guest ${attFilter==='guest'?'sel':''}" onclick="setAttFilter('guest')"><div class="num" id="attGuestNum" style="color:var(--win)">${gaCount}</div><div class="cap">게스트</div></div>
    </div>
    <div class="card" style="margin-top:10px">
      <div class="section-title" style="margin:0 0 8px;display:flex;justify-content:space-between;align-items:center">
        <span><span id="attFilterLabel">${({yes:'참석',no:'불참',maybe:'미정',none:'미응답',guest:'게스트'})[attFilter]||'명단'}</span> 명단 <span id="attRosterStat" style="font-size:12px;color:var(--muted);font-weight: 600">멤버 ${respondedCnt}/${members.length} 응답${gaCount?` · 게스트 ${gaCount}`:''}</span></span>
        ${teamSplitOn?`<button class="btn ghost sm" onclick="toggleAttTeam()">${attTeamView?'전체 보기':'팀별 보기'}</button>`:''}
      </div>
      <div class="att-list" id="attListBody">${listHtml}</div>
    </div>
    ${(()=>{ const gp=GUEST_REQS.filter(g=>g.sid===sess.id&&g.status==='pending'); const ga=GUEST_REQS.filter(g=>g.sid===sess.id&&g.status==='approved'); const gx=GUEST_EXTRA[sess.id]||0; let s='';
      if(admin&&gp.length) s+=`<div class="card" style="margin-top:12px"><div style="font-size:12px;font-weight:800;color:var(--accent);margin-bottom:8px">게스트 신청 · 승인 대기 ${gp.length}명</div>${gp.map(g=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0"><span style="color:var(--cream);font-size:14px">${esc(g.name)}</span><span style="display:flex;gap:6px"><button class="btn accent sm" onclick="approveGuest('${sess.id}',${g.mid})">승인</button><button class="btn ghost sm" style="color:var(--red)" onclick="cancelGuest('${sess.id}',${g.mid})">거절</button></span></div>`).join('')}</div>`;
      if(ga.length||gx>0||admin) s+=`<div class="card" style="margin-top:12px"><div id="gHdr" style="font-size:12px;font-weight:800;color:var(--win);margin-bottom:8px">게스트 ${ga.length+gx}명</div>${ga.map(g=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0"><span style="color:var(--cream);font-size:14px">${esc(g.name)} <span style="font-size:11px;color:var(--win);font-weight:800">게스트</span></span>${admin?`<button class="btn ghost sm" style="color:var(--red)" onclick="cancelGuest('${sess.id}',${g.mid})">취소</button>`:''}</div>`).join('')}${(gx>0&&!admin)?`<div style="padding:5px 0;color:var(--cream);font-size:14px">외부 게스트 <b>${gx}명</b></div>`:''}${admin?`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0 2px;${ga.length?'border-top:1px solid var(--line);margin-top:6px':''}"><span style="color:var(--muted);font-size:13px">외부 게스트(명단 외)</span><span style="display:flex;align-items:center;gap:12px"><button class="btn ghost sm" id="gxMinus" onclick="changeGuestExtra('${sess.id}',-1)" ${gx<=0?'disabled':''}>−</button><b id="gxNum" style="min-width:18px;text-align:center;color:var(--cream)">${gx}</b><button class="btn ghost sm" onclick="changeGuestExtra('${sess.id}',1)">＋</button></span></div>`:''}</div>`;
      return s; })()}
    ${nDraft ? `<div class="save-bar"><span class="save-n">변경 ${nDraft}건 (미저장)</span><span class="sb-actions"><button class="cancel" onclick="attCancelDraft()">취소</button><button class="ok" onclick="attSaveDraft()">저장</button></span></div>` : ''}`;
  el.innerHTML = html;
  // 선택된 일정 칩을 가장 왼쪽으로 스크롤
  const _tabs = el.querySelector('.sess-tabs');
  const _on = _tabs && _tabs.querySelector('.sess-chip.on');
  if (_tabs && _on) _tabs.scrollLeft = Math.max(0, _on.offsetLeft - _tabs.offsetLeft);
}
function pickAttSession(id){ attSessionId = id; attDraft = {}; rerender(renderAtt); }
// 운영진 출석 일괄: 클릭은 드래프트에만 반영(같은 값 다시 누르면 미응답)
function attDraftSet(id, target){
  if(!isAdmin()) return;
  const cur = (id in attDraft) ? attDraft[id] : (attMapDB[id]||'none');
  const next = (cur===target) ? 'none' : target;
  if (next === (attMapDB[id]||'none')) delete attDraft[id]; else attDraft[id] = next;
  rerender(renderAtt);
}
async function attSaveDraft(){
  if(!isAdmin() || !attSessionId) return;
  const entries = Object.entries(attDraft);
  if(!entries.length) return;
  for(const [id,st] of entries){
    const mid = Number(id);
    if(st==='none') await clearAttendance(attSessionId, mid);
    else await setAttendance(attSessionId, mid, st);
  }
  attDraft = {};
  await rerender(renderAtt);
  toast(`출석 ${entries.length}건 저장했어요`);
  refreshAttBadge();
}
function attCancelDraft(){ attDraft = {}; rerender(renderAtt); }
function openAtt(id){ if(id) attSessionId = id; switchTab('att'); }
async function clearAttendance(sessionId, memberId){
  if (USE_DB) {
    const { error } = await sb.from('attendance').delete().eq('session_id',sessionId).eq('member_id',memberId);
    if (error) { toast('오류: '+error.message); return false; }
    return true;
  }
  let a=[]; try { a = JSON.parse(localStorage.getItem(ATT_STORE)) || []; } catch(e){}
  a = a.filter(x=>!(x.session_id===sessionId && x.member_id===memberId));
  localStorage.setItem(ATT_STORE, JSON.stringify(a)); return true;
}
// 재렌더 시 스크롤 위치 유지 (클릭해도 상단으로 튀지 않게)
async function rerender(fn){ const y=window.scrollY; await fn(); window.scrollTo(0,y); }
// 운영진: 명단에서 다른 멤버 참석을 직접 변경(미응답→참석→미정→불참→미응답 순환, 마감 무관)
async function adminCycleAtt(memberId, cur){
  if(!isAdmin() || !attSessionId) return;
  const order=['none','yes','maybe','no'];
  const next=order[(order.indexOf(cur)+1)%order.length];
  const ok = next==='none'
    ? await clearAttendance(attSessionId, memberId)
    : await setAttendance(attSessionId, memberId, next);
  if(ok) await rerender(renderAtt);
}
// 운영진: 참석/미정/불참 직접 선택 (같은 걸 다시 누르면 미응답으로 해제)
async function adminSetAtt(memberId, cur, target){
  if(!isAdmin() || !attSessionId) return;
  const ok = (cur===target)
    ? await clearAttendance(attSessionId, memberId)
    : await setAttendance(attSessionId, memberId, target);
  if(ok) await rerender(renderAtt);
}
async function markAtt(status){
  if(!attMe || !attSessionId) return;
  const _sess = (await upcomingSessions()).find(s=>s.id===attSessionId);
  const _dl = sessionDeadline(_sess);
  if (_dl && new Date() > _dl && !isAdmin()) { toast('신청이 마감됐어요. 운영진에 문의해 주세요.'); return; }
  if (!isAdmin()) {
    const _el = await sessAttEligible(_sess, attMe);
    if (!_el.ok) {
      toast(_el.reason==='unpaid' ? `${parseInt(_el.month.split('-')[1])}월 회비 납부 완료 후 참석 신청할 수 있어요.`
          : _el.reason==='dormant' ? '이번 달 휴면이라 참석 신청 대상이 아니에요.'
          : '참석 신청 대상이 아니에요.');
      return;
    }
  }
  const ok = await setAttendance(attSessionId, attMe, status);
  if(!ok) return;
  await rerender(renderAtt);
  toast({yes:'참석으로 표시했어요',no:'불참으로 표시했어요',maybe:'미정으로 표시했어요'}[status]);
  refreshAttBadge();
}

/* ============================================================
   회비 — 이번 달 납부 현황판
   ============================================================ */
const DUES_STORE = 'socoffee_dues_v1';
async function fetchDues(month) {
  if (USE_DB) {
    const { data, error } = await sb.from('dues').select('member_id, paid, amount').eq('month', month);
    if (error) { return []; }
    return data;
  }
  let a=[]; try { a = JSON.parse(localStorage.getItem(DUES_STORE)) || []; } catch(e){}
  return a.filter(x=>x.month===month);
}
async function setDuesPaid(month, memberId, paid, amount) {
  if (USE_DB) {
    // onConflict 유니크 제약에 의존하지 않도록 조회 후 update/insert (제약 없어도 동작)
    const { data: ex, error: selErr } = await sb.from('dues')
      .select('id').eq('month', month).eq('member_id', memberId).limit(1);
    if (selErr) { toast('저장 오류: ' + selErr.message); return false; }
    if (ex && ex.length) {
      const { error } = await sb.from('dues')
        .update({ paid, amount, updated_at:new Date().toISOString() }).eq('id', ex[0].id);
      if (error) { toast('저장 오류: ' + error.message); return false; }
    } else {
      const { error } = await sb.from('dues')
        .insert({ month, member_id:memberId, paid, amount, updated_at:new Date().toISOString() });
      if (error) { toast('저장 오류: ' + error.message); return false; }
    }
    return true;
  }
  let a=[]; try { a = JSON.parse(localStorage.getItem(DUES_STORE)) || []; } catch(e){}
  a = a.filter(x=>!(x.month===month && x.member_id===memberId));
  a.push({ month, member_id:memberId, paid, amount });
  localStorage.setItem(DUES_STORE, JSON.stringify(a)); return true;
}

// 운영진 일괄 수정용 드래프트 (회비)
const DUES_CONFIRM_NAMES = ['박승한','원재식'];   // 회비 입금 확인 권한(총괄 + 총무)
function isDuesConfirmer(){ const p = PLAYERS.find(x=>x.id===getMe()); return !!(p && DUES_CONFIRM_NAMES.includes(p.name)); }
let DUES_CONFIRMED = {};   // { 'YYYY-MM': [memberId] } — 실제 입금 확인(총무/총괄이 계좌 확인 후 체크)
function isDuesConfirmed(month, id){ return (DUES_CONFIRMED[month]||[]).includes(id); }
async function toggleDuesConfirm(month, id){
  if (!isDuesConfirmer()) return;
  let cur = {};
  try { if (USE_DB){ const {data:row}=await sb.from('club_settings').select('data').eq('id','current').maybeSingle(); cur=(row&&row.data)||{}; _settingsCache=cur; } else cur=await fetchSettings(); } catch(e){ cur=_settingsCache||{}; }
  const dc = Object.assign({}, cur.duesConfirmed||{});
  const arr = new Set(dc[month]||[]); if (arr.has(id)) arr.delete(id); else arr.add(id); dc[month] = [...arr];
  DUES_CONFIRMED = dc;
  if (!(await saveSettings({ duesConfirmed: dc }))) { toast('저장 중 오류가 났어요'); return; }
  await rerender(renderDues);
}
let duesDraft = {};     // memberId -> bool(paid)
let duesPaidDB = {};
async function renderDues() {
  const el = document.getElementById('duesContent');
  if (!el.innerHTML.trim()) el.innerHTML = `<div class="empty">불러오는 중...</div>`;
  const month = duesMonth();
  // 활동 멤버 — 휴면(isDormantFor)은 제외해 미납 인원/명단/집계에서 빠짐
  const members = activeMembers(month).filter(m => !isDormantFor(m, month));
  // 휴면이지만 그 외 가입 조건은 충족하는 멤버 — 명단엔 '휴면'으로 표시
  const [dyN, dmoN] = month.split('-').map(Number);
  const dMonthEnd = new Date(dyN, dmoN, 0);
  const dormantMembers = ROSTER.filter(p => {
    const st = p.status || 'active';
    let eligible;
    if (st === 'former') eligible = false;
    else if (st === 'friends') eligible = !!(p.friendsSince && month < p.friendsSince);
    else if (!p.joinDate) eligible = false;
    else eligible = new Date(p.joinDate) <= dMonthEnd;
    return eligible && isDormantFor(p, month);
  }).map(p => {
    const t = TEAM_SHEET[p.name] || { team: '기타' };
    return { ...p, jersey: t.jersey, eng: t.eng || '', team: t.team, cap: !!t.cap };
  }).sort(byName);
  const dues = await fetchDues(month);
  const paidMap = {}; dues.forEach(d=>{ paidMap[d.member_id]=d.paid; });
  duesPaidDB = paidMap;
  const admin = isAdmin();
  const me = getMe();
  // 운영진 드래프트 우선 적용 (상태: 'paid' | 'unpaid' | 'dormant')
  const effState = id => (id in duesDraft) ? duesDraft[id] : (paidMap[id] ? 'paid' : 'unpaid');
  const isPaid = id => effState(id) === 'paid';
  const isDraftDormant = id => effState(id) === 'dormant';
  const nDraft = admin ? Object.keys(duesDraft).length : 0;

  // 드래프트로 휴면 처리된 회원은 회비 집계/미납에서 제외
  const payMembers = members.filter(m => !isDraftDormant(m.id));
  const paidCount = payMembers.filter(m=>isPaid(m.id)).length;
  const total = payMembers.length;
  const collected = payMembers.filter(m=>isPaid(m.id)).reduce((s,m)=>s+dueAmount(m.name),0);
  const expected = payMembers.reduce((s,m)=>s+dueAmount(m.name),0);
  const pct = total ? Math.round(paidCount/total*100) : 0;
  const confirmedCount = payMembers.filter(m=>isDuesConfirmed(month, m.id)).length;   // 입금 확인 인원
  const meActive = me != null && members.some(x => x.id === me);
  const myState = effState(me);                  // 드래프트까지 반영
  const myPaid = myState === 'paid';
  const myConfd = isDuesConfirmed(month, me);
  const myName = (ROSTER.find(x=>x.id===me)||{}).name || '';
  const myDirty = admin && (me in duesDraft);    // 저장 전 변경 여부

  const myCard = meActive ? `<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;margin-bottom:12px">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:800;color:var(--coffee)">내 회비${myName?` — ${esc(myName)}`:''} · ${potmMonthLabel(month)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${myPaid ? (myConfd ? '납부 · <b style="color:var(--win)">입금 확인됨</b>' : '납부 표시됨 · 입금 확인 대기중') : '미납 상태예요'}${myDirty?' · 저장 전 (아래 저장 필요)':''}</div>
      </div>
      ${admin
        ? `<button class="dues-badge toggle ${myPaid?'paid':'unpaid'}" style="flex-shrink:0" onclick="duesDraftCardToggle(${me})">${myPaid ? '납부 취소' : '납부 표시'}</button>`
        : isSubAdmin()
          ? `<span class="dues-badge ${myPaid?'paid':'unpaid'}" style="flex-shrink:0;font-weight:800">${myPaid?'납부':'미납'}</span>`
          : `<button class="dues-badge toggle ${myPaid?'paid':'unpaid'}" style="flex-shrink:0" onclick="toggleDue(${me},${myPaid})">${myPaid ? '납부 취소' : '납부 표시'}</button>`}
    </div>` : '';

  // 일반 멤버(총괄·일반관리자 아님): 전체 납부현황 비공개 — 본인 회비만
  if (!isDuesViewer()) {
    el.innerHTML = `<div class="section-title">${potmMonthLabel(month)} 회비</div>${myCard}${bankInlineHtml()}<p class="hint" style="text-align:center;margin-top:8px">전체 납부 현황은 운영진이 관리해요. 위에서 본인 회비를 확인하고 직접 표시할 수 있어요.</p>`;
    return;
  }

  // 다음 달(statusMonth) 활동/휴면 셀프 변경 감지 (운영진용)
  const _sMon = statusMonth();
  const _curM = nowMonthStr();
  const _moLbl = parseInt(_sMon.split('-')[1], 10);
  // 휴면→활동 = 실제로 휴면 중이던(영구 휴면 or 이번 달 휴면) 회원이 다음 달을 활동으로 되돌린 경우만
  const toActive = ROSTER.filter(p => {
    const st = p.status||'active';
    if (st==='former'||st==='friends') return false;
    if (!activeMonthsOf(p).includes(_sMon)) return false;
    return st==='dormant' || dormantMonthsOf(p).includes(_curM);
  });
  const _toActiveIds = new Set(toActive.map(p=>p.id));
  const toDormant = ROSTER.filter(p => { const st = p.status||'active'; if (st!=='active') return false; if (_toActiveIds.has(p.id)) return false; const dm = dormantMonthsOf(p); return dm.includes(_sMon) && !dm.includes(_curM); });
  const transCard = (toActive.length || toDormant.length) ? `<div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:800;color:var(--coffee);margin-bottom:8px">${_moLbl}월 활동/휴면 변경 <span style="color:var(--muted);font-weight:600">· 멤버 셀프 신청</span></div>
      ${toActive.length?`<div style="font-size:13px;line-height:1.7${toDormant.length?';margin-bottom:6px':''}"><span style="color:var(--win);font-weight:800">휴면→활동</span> <span style="color:var(--muted)">${toActive.length}명</span> · ${[...toActive].sort(byName).map(m=>esc(m.name)).join(', ')}</div>`:''}
      ${toDormant.length?`<div style="font-size:13px;line-height:1.7"><span style="color:var(--alert);font-weight:800">활동→휴면</span> <span style="color:var(--muted)">${toDormant.length}명</span> · ${[...toDormant].sort(byName).map(m=>esc(m.name)).join(', ')}</div>`:''}
    </div>` : '';

  let html = `
    <div class="potm-hero" style="background:linear-gradient(135deg,#2f7a4f,#245f3e)">
      <div class="trophy"></div>
      <h2>${potmMonthLabel(month)} 회비</h2>
      <div class="month">${paidCount}/${total}명 납부 · 입금확인 ${confirmedCount}명</div>
    </div>
    <div class="dues-progress"><div style="width:${pct}%"></div></div>
    <div class="dues-summary">
      <div class="dues-stat paid"><div class="num">${paidCount}</div><div class="cap">납부</div></div>
      <div class="dues-stat unpaid"><div class="num">${total-paidCount}</div><div class="cap">미납</div></div>
    </div>
    ${transCard}
    ${myCard}
    ${(total-paidCount)>0 ? `<div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:800;color:var(--red);margin-bottom:6px">미납 ${total-paidCount}명</div>
      <div style="font-size:14px;line-height:1.7;color:var(--text)">${[...payMembers].filter(m=>effState(m.id)==='unpaid').sort(byName).map(m=>esc(m.name)).join(', ')}</div>
    </div>` : ''}
    <div class="ops-note">${admin ? '운영진 모드 — 납부 / 미납 / 휴면(다음달)을 직접 선택하고 아래 \'저장\'으로 반영돼요' : '읽기전용 현황 — 납부는 멤버가 홈에서 직접 표시해요.'}</div>
    <div class="card">
      <div class="att-list dues-grid">
        ${[...members].sort((a,b)=>{ const rk=s=>s==='unpaid'?0:(s==='paid'?1:2); return rk(effState(a.id))-rk(effState(b.id)) || byName(a,b); }).map(m=>{
          const stt = effState(m.id);
          const isMe = me===m.id;
          const dirty = admin && (m.id in duesDraft);
          const confd = isDuesConfirmed(month, m.id);
          const confChip = (stt==='paid')
            ? (isDuesConfirmer()
                ? `<button class="dues-conf ${confd?'on':''}" onclick="toggleDuesConfirm('${month}',${m.id})">${confd?'✓ 확인':'입금확인'}</button>`
                : (confd ? `<span class="dues-conf on ro">✓ 확인</span>` : ''))
            : '';
          const statusEl = admin
            ? `<span class="st-set"><button class="st paid ${stt==='paid'?'on':''}" onclick="duesDraftSet(${m.id},'paid')">납부</button><button class="st unpaid ${stt==='unpaid'?'on':''}" onclick="duesDraftSet(${m.id},'unpaid')">미납</button><button class="st dormant ${stt==='dormant'?'on':''}" onclick="duesDraftSet(${m.id},'dormant')">휴면</button></span>`
            : `<span style="flex-shrink:0;font-size:12px;font-weight:800;padding:4px 12px;border-radius:20px;background:${stt==='paid'?'rgba(70,179,129,.92)':'rgba(217,97,74,.92)'};color:#fff">${stt==='paid'?'납부':'미납'}</span>`;
          return `<div class="dues-row ${isMe?'me':''}${dirty?' dirty':''}">
            <span class="nm">${esc(m.name)}${isMe?' <span style="font-size:11px;color:var(--accent)">(나)</span>':''}${dirty?' <span class="dirty-dot">●</span>':''}</span>
            <span style="display:flex;align-items:center;gap:8px;flex-shrink:0">${confChip}${statusEl}</span>
          </div>`;
        }).join('')}
        ${dormantMembers.map(m=>{
          const isMe = me===m.id;
          return `<div class="dues-row ${isMe?'me':''}" style="opacity:.55">
            <span class="nm">${esc(m.name)}${isMe?' <span style="font-size:11px;color:var(--accent)">(나)</span>':''}</span>
            <span class="amt">—</span>
            <span class="dues-badge" style="background:#555;color:#ddd">휴면</span>
          </div>`;
        }).join('')}
      </div>
    </div>
    ${nDraft ? `<div class="save-bar"><span class="save-n">변경 ${nDraft}건 (미저장)</span><span class="sb-actions"><button class="cancel" onclick="duesCancelDraft()">취소</button><button class="ok" onclick="duesSaveDraft()">저장</button></span></div>` : ''}`;
  el.innerHTML = html;
}
// 본인/운영진 단건 즉시 토글 (회원 본인 self-service용)
async function toggleDue(memberId, currentlyPaid) {
  if (!isAdmin() && memberId !== getMe()) return;   // 운영진 or 본인만
  const y = window.scrollY;
  const m = ROSTER.find(x=>x.id===memberId);
  const ok = await setDuesPaid(duesMonth(), memberId, !currentlyPaid, dueAmount(m?m.name:''));
  if (!ok) return;
  await renderDues();
  window.scrollTo(0, y);
}
// 운영진 회비 일괄: 납부/미납/휴면 직접 선택 (드래프트에만 반영, DB 상태와 같으면 드래프트 제거)
function duesDraftSet(id, state){
  if(!isAdmin()) return;
  const base = duesPaidDB[id] ? 'paid' : 'unpaid';
  if (state === base) delete duesDraft[id]; else duesDraft[id] = state;
  rerender(renderDues);
}
// (구) 순환 방식 — 미사용
function duesDraftCycle(id){
  if(!isAdmin()) return;
  const order = ['unpaid','paid','dormant'];
  const base = duesPaidDB[id] ? 'paid' : 'unpaid';
  const cur = (id in duesDraft) ? duesDraft[id] : base;
  const next = order[(order.indexOf(cur)+1) % order.length];
  if (next === base) delete duesDraft[id]; else duesDraft[id] = next;
  rerender(renderDues);
}
// 운영진 '내 회비' 카드: 본인 납부/미납만 드래프트 토글 (휴면 제외)
function duesDraftCardToggle(id){
  if(!isAdmin()) return;
  const base = duesPaidDB[id] ? 'paid' : 'unpaid';
  const cur = (id in duesDraft) ? duesDraft[id] : base;
  const next = cur === 'paid' ? 'unpaid' : 'paid';
  if (next === base) delete duesDraft[id]; else duesDraft[id] = next;
  rerender(renderDues);
}
async function duesSaveDraft(){
  if(!isAdmin()) return;
  const entries = Object.entries(duesDraft);
  if(!entries.length) return;
  const mo = duesMonth();   // 회비 표시월 = 다음달(25일 이후)
  const dormIds = [];
  let anyErr = false;
  for(const [id,st] of entries){
    const mid = Number(id); const m = ROSTER.find(x=>x.id===mid);
    if (st === 'dormant') { dormIds.push(mid); }
    else { const ok = await setDuesPaid(mo, mid, st === 'paid', dueAmount(m?m.name:'')); if(!ok) anyErr = true; }
  }
  // 휴면: 팀빌더 명단에 해당 월 등록(roster에 쓰면 mergeTbMembers가 덮어쓰므로 팀빌더가 단일 출처)
  if (dormIds.length) {
    const tb = await fetchTeamBuilder();
    if (tb && Array.isArray(tb.players)) {
      tb.players.forEach(p => { if (dormIds.includes(p.id)) { const dm = p.dormantMonths || []; if(!dm.includes(mo)) dm.push(mo); p.dormantMonths = dm; } });
      if (await saveTeamBuilder(tb)) { await mergeTbMembers(); await loadTbDormant(); }
      else anyErr = true;
    } else anyErr = true;
  }
  duesDraft = {};
  await rerender(renderDues);
  toast(anyErr ? '일부 저장에 실패했어요' : `회비 ${entries.length}건 저장했어요`);
}
function duesCancelDraft(){ duesDraft = {}; rerender(renderDues); }

/* ============================================================
   운영진 — 관리 통합 (공지작성 · 세션설정 · 회비 · 투표)
   ============================================================ */
async function renderOps() {
  const el = document.getElementById('opsContent');
  if (!isAdmin()) { el.innerHTML = `<div class="card"><div class="empty">운영진 모드에서만 보여요.</div></div>`; return; }
  if (!el.innerHTML.trim()) el.innerHTML = `<div class="empty">불러오는 중...</div>`;
  const month = potmMonth();
  const [allSessions, notices, dues, votesMvp, votesGrowth] = await Promise.all([
    getSessions(), fetchNotices(), fetchDues(month), fetchVotes(month,'mvp'), fetchVotes(month,'growth')
  ]);
  const members = activeMembers(month);
  const paidCount = members.filter(m=>dues.find(d=>d.member_id===m.id && d.paid)).length;
  const defDate = upcomingSessionDate();

  // ---- 할 일 요약 (총괄관리자 대시보드) ----
  const _next = await nearestSession();
  let _noResp = 0, _nextLbl = '';
  if (_next && _next.date) {
    try {
      const _att = await fetchAttendance(_next.id);
      const _resp = new Set(_att.map(r => r.member_id));
      const _sm = activeMembers(_next.date.slice(0,7));
      _noResp = _sm.filter(m => !_resp.has(m.id)).length;
      const _p = _next.date.split('-');
      _nextLbl = Number(_p[1])+'/'+Number(_p[2]);
    } catch(e) {}
  }
  const _dm = duesMonth();
  const _duesRows = (_dm === month) ? dues : await fetchDues(_dm);
  const _dMembers = activeMembers(_dm);
  const _duesUnpaid = _dMembers.filter(m => !_duesRows.find(r => r.member_id === m.id && r.paid)).length;
  await freshGuestReqs();
  const _upIds = new Set(allSessions.filter(x=>(x.date||'')>=todayStr()).map(x=>String(x.id)));
  const _guestPend = GUEST_REQS.filter(g => g.status==='pending' && (_upIds.size===0 || _upIds.has(String(g.sid)))).length;
  const _pinMissing = PLAYERS.filter(p => p.status !== 'former' && !CLUB_PINS[p.id]).length;
  const _vPool = votingMembers(month);
  const _vDone = new Set(votesMvp.concat(votesGrowth).map(v=>v.voter_id));
  const _vMissing = _vPool.filter(m=>!_vDone.has(m.id));
  const _todoItems = [
    { n:_noResp,            label:'다음 세션 미응답'+(_nextLbl?' ('+_nextLbl+')':''), go:"switchTab('att')" },
    { n:_duesUnpaid, label:parseInt(_dm.split('-')[1])+'월 회비 미납', go:"switchTab('dues')" },
    { n:_vMissing.length,   label:'이달 투표 미참여', go:"opsSwitch('vote')" },
    { n:_guestPend,         label:'게스트 신청 대기', go:"switchTab('att')" },
    { n:_pinMissing,        label:'PIN 미설정(미로그인)', go:"opsSwitch('roster')" },
  ].filter(x => x.n > 0);
  const _todoHtml = `
    <div class="card" style="padding:13px 16px;margin-bottom:12px">
      <b style="color:#ece6d2;font-size:13px">할 일</b>
      ${_todoItems.length === 0
        ? `<div class="hint" style="margin:6px 0 0">지금 처리할 일이 없어요.</div>`
        : `<div style="display:grid;gap:6px;margin-top:9px">${_todoItems.map(x=>`
            <button onclick="${x.go}" style="display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;padding:9px 12px;border-radius:10px;border:1px solid var(--line);background:#18301f;color:var(--cream);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;text-align:left">
              <span>${x.label}</span>
              <span style="flex-shrink:0;display:inline-flex;align-items:center;gap:6px"><span class="dues-badge unpaid">${x.n}명</span><span style="color:var(--muted)">→</span></span>
            </button>`).join('')}</div>`}
    </div>`;

  const OPS_TABS = [
    { key:'notice',  label:'공지' },
    { key:'session', label:'세션' },
    { key:'dues',    label:'회비' },
    { key:'vote',    label:'투표' },
    { key:'roster',  label:'설정' },
  ];
  if (!OPS_TABS.some(t => t.key === opsTabSel)) opsTabSel = 'notice';

  const secNotice = `
    ${opsEditNoticeId ? `<p class="hint" style="margin:0 0 12px">공지 <b>수정 중</b>이에요 — 아래 목록에서 내용을 고치고 저장하거나, 취소를 눌러 주세요.</p>` : `
    <div class="field"><label>제목</label><input id="opsNoticeTitle" placeholder="예: 이번 주 우천 시 실내 대체" maxlength="60"></div>
    <div class="field"><label>내용 <span style="color:var(--muted);font-weight:400">(선택 · 링크 자동 연결)</span></label><textarea id="opsNoticeBody" rows="3" placeholder="자세한 내용을 적어주세요"></textarea></div>
    <div class="field"><label>클릭 시 이동 <span style="color:var(--muted);font-weight:400">(선택)</span></label>
      <select id="opsNoticeLinkType" onchange="opsLinkToggle('opsNoticeLinkType','opsNoticeLinkUrlWrap')">
        <option value="">없음 (본문 펼치기)</option>
        <option value="url">외부 링크 (URL)</option>
        <option value="tab:potm">투표 탭으로 이동</option>
        <option value="tab:att">일정 탭으로 이동</option>
        <option value="tab:list">카풀 탭으로 이동</option>
      </select>
    </div>
    <div class="field" id="opsNoticeLinkUrlWrap" style="display:none"><input id="opsNoticeLinkUrl" placeholder="https://..." maxlength="300"></div>
    <div class="row">
      <div class="field"><label>노출 시작</label><input id="opsNoticeFrom" type="date" value="${todayStr()}"></div>
      <div class="field"><label>노출 종료 <span style="color:var(--muted);font-weight:400">(비우면 무기한)</span></label><input id="opsNoticeUntil" type="date"></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:12px"><input type="checkbox" id="opsNoticePin" style="width:auto"> 상단 고정</label>
    <button class="btn accent sm" onclick="opsAddNotice()">공지 등록</button>`}
    <div style="margin-top:16px">
      ${notices.length===0?'<p class="hint">등록된 공지가 없어요.</p>':notices.map(n=>{
        if (String(n.id)===opsEditNoticeId) {
          return `<div class="notice">
            <div class="field"><label>제목</label><input id="opsEditTitle" value="${esc(n.title)}" maxlength="60"></div>
            <div class="field"><label>내용</label><textarea id="opsEditBody" rows="3">${esc(n.body||'')}</textarea></div>
            ${(()=>{ const _lk=n.link||''; const _isUrl=/^https?:\/\//i.test(_lk); const _lt=_isUrl?'url':_lk; const o=(v,t)=>`<option value="${v}" ${(_lt===v)?'selected':''}>${t}</option>`; return `
            <div class="field"><label>클릭 시 이동 <span style="color:var(--muted);font-weight:400">(선택)</span></label>
              <select id="opsEditLinkType" onchange="opsLinkToggle('opsEditLinkType','opsEditLinkUrlWrap')">
                ${o('','없음 (본문 펼치기)')}${o('url','외부 링크 (URL)')}${o('tab:potm','투표 탭으로 이동')}${o('tab:att','일정 탭으로 이동')}${o('tab:list','카풀 탭으로 이동')}
              </select>
            </div>
            <div class="field" id="opsEditLinkUrlWrap" style="display:${_isUrl?'':'none'}"><input id="opsEditLinkUrl" placeholder="https://..." maxlength="300" value="${_isUrl?esc(_lk):''}"></div>`; })()}
            <div class="row">
              <div class="field"><label>노출 시작</label><input id="opsEditFrom" type="date" value="${toDateInput(n.publish_at)||todayStr()}"></div>
              <div class="field"><label>노출 종료 <span style="color:var(--muted);font-weight:400">(비우면 무기한)</span></label><input id="opsEditUntil" type="date" value="${toDateInput(n.hide_at)}"></div>
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:10px"><input type="checkbox" id="opsEditPin" ${n.pinned?'checked':''} style="width:auto"> 상단 고정</label>
            <div class="n-actions">
              <button class="btn accent sm" onclick="opsSaveNotice('${n.id}')">저장</button>
              <button class="btn ghost sm" onclick="opsCancelEdit()">취소</button>
            </div>
          </div>`;
        }
        const _now = new Date();
        let badge = '';
        if (n.publish_at && new Date(n.publish_at) > _now) badge = `<span class="pin-tag" style="background:#7a5b2e;color:#fff">노출예정 ${mdLabel(n.publish_at)}~</span> `;
        else if (n.hide_at && new Date(n.hide_at) < _now) badge = `<span class="pin-tag" style="background:#5b5b5b;color:#fff">노출종료</span> `;
        else if (n.publish_at || n.hide_at) badge = `<span class="pin-tag" style="background:#3b6b46;color:#fff">노출 ${n.publish_at?mdLabel(n.publish_at):''}~${n.hide_at?mdLabel(n.hide_at):''}</span> `;
        return `<div class="notice ${n.pinned?'pinned':''}">
          <div class="n-top"><div class="n-title">${n.pinned?'<span class="pin-tag">고정</span>':''}${badge}${esc(n.title)}</div><div class="n-date">${noticeWhenLabel(n)}</div></div>
          ${n.body?`<div class="n-body">${linkify(n.body)}</div>`:''}
          <div class="n-actions">
            <button class="btn ghost sm" onclick="opsEditNotice('${n.id}')">수정</button>
            <button class="btn ghost sm" onclick="opsPin('${n.id}',${!n.pinned})">${n.pinned?'고정 해제':'고정'}</button>
            <button class="btn ghost sm" style="color:var(--red)" onclick="opsDelNotice('${n.id}')">삭제</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;

  const _t0 = todayStr();
  const _upSess = allSessions.filter(s=>(s.date||'')>=_t0);
  const _pastSess = allSessions.filter(s=>(s.date||'')<_t0).reverse();   // 최근 것부터
  const _sessRow = (s)=>{
        if (String(s.id)===opsEditSessionId) {
          return `<div class="ops-row" style="flex-direction:column;align-items:stretch;gap:0">
            <div class="row"><div class="field"><label>날짜</label><input id="esD" type="date" value="${s.date||''}"></div><div class="field"><label>시작</label><input id="esT" type="time" value="${s.time||'21:00'}" onchange="endPlus2('esT','esTe')"></div><div class="field"><label>종료 <span style="color:var(--muted);font-weight:400">(시작+2시간 기본)</span></label><input id="esTe" type="time" value="${s.endTime||''}"></div></div>
            <div class="field"><label>유형</label><select id="esType">${[['풋살','풋살 경기'],['축구','축구 경기'],['회식','회식'],['야유회','야유회'],['기타','기타']].map(([v,l])=>`<option value="${v}"${(s.type||'풋살')===v?' selected':''}>${l}</option>`).join('')}</select></div>
            <div class="field"><label>장소</label><input id="esP" value="${esc(s.place||'')}" maxlength="40"></div>
            <div class="field"><label>장소 링크 <span style="color:var(--muted);font-weight:400">(선택)</span></label><input id="esPu" value="${esc(s.placeUrl||'')}" placeholder="https://naver.me/..." maxlength="300"></div>
            <div class="field"><label>게스트 신청 링크 <span style="color:var(--muted);font-weight:400">(선택 · 소개 페이지 버튼)</span></label><input id="esGu" value="${esc(s.guestUrl||'')}" placeholder="https://forms.gle/..." maxlength="300"></div>
            <div class="field"><label>참석 신청 마감</label><input id="esDl" type="date" value="${s.deadline||autoDeadlineStr(s.date)}"></div>
            <div class="field"><label>이름/메모 <span style="color:var(--muted);font-weight:400">(예: EVENT, A매치)</span></label><input id="esL" value="${esc(s.label||'')}" maxlength="30"></div>
            <div class="field"><label>세부내용 <span style="color:var(--muted);font-weight:400">(클릭 시 펼쳐짐)</span></label><textarea id="esDesc" rows="2">${esc(s.desc||'')}</textarea></div>
            <div class="field"><label>참석 조건 <span style="color:var(--muted);font-weight:400">(선택)</span></label>
              <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--cream);margin-top:2px"><input type="checkbox" id="esDuesOnly" ${s.duesOnly?'checked':''}> 회비 납부자만 참석</label>
              <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--cream);margin-top:6px"><input type="checkbox" id="esAllowDorm" ${s.allowDormant?'checked':''}> 휴면도 참석 가능</label></div>
            <div class="n-actions"><button class="btn accent sm" onclick="opsSaveSession('${s.id}')">저장</button><button class="btn ghost sm" onclick="opsCancelSessionEdit()">취소</button></div>
          </div>`;
        }
        return `<div class="ops-row"><div style="min-width:0"><b>${fmtSessionDate(s.date,s.time,s.endTime)}</b>${s.label?` · ${esc(s.label)}`:''}<div class="hint" style="margin:0">${esc(s.place)} · 마감 ${deadlineLabel(sessionDeadline(s))}</div></div><span style="display:flex;gap:6px;flex-shrink:0"><button class="btn ghost sm" onclick="opsEditSession('${s.id}')">수정</button><button class="btn ghost sm" style="color:var(--red)" onclick="opsDelSession('${s.id}')">삭제</button></span></div>`;
      };
  const secSession = `
    ${opsEditSessionId ? '' : (opsAddSessionOpen ? `
    <div class="row"><div class="field"><label>날짜 <span style="color:var(--muted);font-weight:400">(<span id="opsSessSeasonLbl">${seasonLabel(defDate)} 시즌</span>)</span></label><input id="opsSessDate" type="date" value="${defDate}" onchange="opsSyncDeadline()"></div><div class="field"><label>시작</label><input id="opsSessTime" type="time" value="${seasonDefaultTime(defDate).start}" onchange="endPlus2('opsSessTime','opsSessEnd')"></div><div class="field"><label>종료 <span style="color:var(--muted);font-weight:400">(팀 리그 20–23시 · 일반 21–23시 자동)</span></label><input id="opsSessEnd" type="time" value="${seasonDefaultTime(defDate).end}"></div></div>
    <div class="field"><label>유형 <span style="color:var(--muted);font-weight:400">(팀빌더 통계 유형)</span></label><select id="opsSessType">${[['풋살','풋살 경기'],['축구','축구 경기'],['회식','회식'],['야유회','야유회'],['기타','기타']].map(([v,l])=>`<option value="${v}"${v==='풋살'?' selected':''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label>장소</label><input id="opsSessPlace" value="상암 풋살장" maxlength="40"></div>
    <div class="field"><label>장소 링크 <span style="color:var(--muted);font-weight:400">(지도 URL · 선택)</span></label><input id="opsSessPlaceUrl" placeholder="https://naver.me/..." maxlength="300"></div>
    <div class="field"><label>게스트 신청 링크 <span style="color:var(--muted);font-weight:400">(선택 · 소개 페이지에 '게스트 신청' 버튼 노출)</span></label><input id="opsSessGuestUrl" placeholder="https://forms.gle/..." maxlength="300"></div>
    <div class="field"><label>참석 신청 마감 <span style="color:var(--muted);font-weight:400">(기본: 전주 일요일 23:59)</span></label><input id="opsSessDeadline" type="date" value="${autoDeadlineStr(defDate)}"></div>
    <div class="field"><label>이름/메모 <span style="color:var(--muted);font-weight:400">(선택, 예: EVENT, A매치)</span></label><input id="opsSessLabel" maxlength="30" placeholder="예: EVENT, A매치"></div>
    <div class="field"><label>세부내용 <span style="color:var(--muted);font-weight:400">(선택 · 소개 페이지에서 클릭하면 펼쳐짐 · 링크 자동연결)</span></label><textarea id="opsSessDesc" rows="2" placeholder="행사 안내, 준비물, 링크 등"></textarea></div>
    <div class="field"><label>참석 조건 <span style="color:var(--muted);font-weight:400">(선택)</span></label>
      <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--cream);margin-top:2px"><input type="checkbox" id="opsSessDuesOnly"> 회비 납부자만 참석</label>
      <label style="display:flex;align-items:center;gap:7px;font-size:13px;color:var(--cream);margin-top:6px"><input type="checkbox" id="opsSessAllowDorm"> 휴면도 참석 가능</label></div>
    <div class="n-actions"><button class="btn accent sm" onclick="opsAddSession()">세션 추가</button><button class="btn ghost sm" onclick="opsCloseAddSession()">취소</button></div>` : `
    <div class="n-actions"><button class="btn accent sm" onclick="opsOpenAddSession()">＋ 세션 추가</button><button class="btn ghost sm" onclick="opsAddNextMonth()">다음 달 수요일 일괄 등록</button></div>`)}
    <div style="margin-top:16px">
      ${allSessions.length===0?'<p class="hint">등록된 세션이 없어요. (비우면 다가오는 수요일·상암 풋살장으로 자동 표시돼요)</p>':(_upSess.map(_sessRow).join('')||'<p class="hint">다가오는 세션이 없어요.</p>')+(_pastSess.length?`<details class="ops-past" style="margin-top:14px"><summary style="cursor:pointer;font-size:13px;color:var(--muted);font-weight:600">지난 세션 ${_pastSess.length}개 보기</summary><div style="margin-top:6px">${_pastSess.map(_sessRow).join('')}</div></details>`:'')}
    </div>
    <p class="hint" style="margin-top:10px">같은 날 여러 경기(A/B매치)도 따로 등록하면 참석을 각각 받아요.</p>`;

  const pinMembers = [...PLAYERS].filter(p => p.status !== 'former').sort((a,b)=>((CLUB_PINS[a.id]?1:0)-(CLUB_PINS[b.id]?1:0)) || a.name.localeCompare(b.name,'ko'));   // 미설정(챙길 사람) 먼저
  const pinDone = pinMembers.filter(p => CLUB_PINS[p.id]).length;
  const pinRows = pinMembers.map(p=>`<div class="dues-row"><span class="nm">${esc(p.name)}</span>${CLUB_PINS[p.id]
      ? `<span class="dues-badge paid">설정됨</span> <button class="btn ghost sm" onclick="resetPin(${p.id})">초기화</button>`
      : `<span class="dues-badge unpaid">미설정</span>`}</div>`).join('');
  const secRoster = `
    <div class="ops-row" style="border:none;padding:0 0 12px">
      <div style="min-width:0"><b style="color:#ece6d2">이번 달 팀 구분 (WHITE/BLACK)</b><div class="hint" style="margin:0">끄면 홈·참석이 전체 명단으로 표시돼요</div></div>
      <button class="dues-badge toggle ${teamSplitOn?'paid':'unpaid'}" style="flex-shrink:0" onclick="opsToggleTeamSplit()">${teamSplitOn?'사용 중':'미사용'}</button>
    </div>
    <p class="hint" style="margin-top:4px;line-height:1.6">선수 명단·등번호·티어·<b style="color:#ece6d2">휴면</b>은 <b style="color:#ece6d2">팀빌더</b>에서 관리해요(더 자세함).<br>휴면 상태는 팀빌더 데이터를 사이트가 자동으로 읽어 반영합니다.</p>
    <div style="margin-top:16px;border-top:1px solid #2a3d30;padding-top:14px">
      <b style="color:#ece6d2">PIN 관리 <span class="hint" style="font-weight: 600">(${pinDone}/${pinMembers.length} 설정)</span></b>
      <div class="hint" style="margin:2px 0 10px">미설정 멤버는 아직 첫 로그인을 안 한 거예요. 잊은 멤버는 초기화하면 다음 로그인에서 새로 정해요.</div>
      ${pinRows}
    </div>`;

  const secDues = `
    <p class="hint" style="margin-top:0">'회비' 탭에서 이름을 눌러 납부 처리하세요. 빠른 이동:</p>
    <button class="btn sm" onclick="switchTab('dues')">회비 현황판 열기</button>`;

  const secVote = `
    <p class="hint" style="margin:0 0 10px">투표 대상 ${_vPool.length}명 중 <b style="color:#ece6d2">${_vDone.size}명 참여</b>${_vMissing.length?` · 미투표 ${_vMissing.length}명`:''}</p>
    ${_vMissing.length?`<div style="font-size:12px;color:var(--muted);line-height:1.7;margin:0 0 14px;padding-bottom:12px;border-bottom:1px solid var(--line)"><b style="color:var(--coffee-2)">미투표</b> ${_vMissing.map(m=>esc(m.name)).join(', ')}</div>`:''}
    <p class="hint" style="margin:0 0 6px;font-weight:800;color:#ece6d2">이달의 선수 (${votesMvp.length}표)</p>
    ${resultsHtml(votesMvp, members, true)}
    <button class="btn ghost sm" style="color:var(--red);margin-top:10px" onclick="opsResetVote('mvp')">이달의 선수 초기화</button>
    <p class="hint" style="margin:18px 0 6px;font-weight:800;color:#ece6d2">가장 성장한 선수 (${votesGrowth.length}표)</p>
    ${resultsHtml(votesGrowth, members, true)}
    <button class="btn ghost sm" style="color:var(--red);margin-top:10px" onclick="opsResetVote('growth')">가장 성장한 선수 초기화</button>`;

  const bodyMap = { notice:secNotice, session:secSession, roster:secRoster, dues:secDues, vote:secVote };

  el.innerHTML = `
    <div class="ops-note">운영진 전용 화면입니다. 팀원에게는 보이지 않아요.</div>
    ${_todoHtml}
    <div class="ops-subtabs">
      ${OPS_TABS.map(t => `<button class="ops-subtab ${t.key===opsTabSel?'on':''}" onclick="opsSwitch('${t.key}')">${t.label}</button>`).join('')}
    </div>
    <div class="card">${bodyMap[opsTabSel]}</div>`;
}
async function opsResetVote(cat) {
  if (!isAdmin()) return;
  const c = VOTE_CATS.find(x=>x.key===cat) || VOTE_CATS[0];
  if (!confirm(`[${c.label}] 이번 달 투표를 초기화할까요? 되돌릴 수 없어요.`)) return;
  if (await resetVotes(potmMonth(), cat)) { await rerender(renderOps); toast('초기화했어요'); }
}
async function opsToggleTeamSplit() {
  if (!isAdmin()) return;
  const next = !teamSplitOn;
  if (!(await saveSettings({ teamSplit: next }))) return;
  teamSplitOn = next;
  await rerender(renderOps); refreshOpenMemberViews();
  toast(teamSplitOn ? '팀 구분 사용' : '팀 구분 미사용 (전체 명단)');
}

/* ---------- 운영진 내부 서브탭 ---------- */
let opsTabSel = 'notice';
function opsSwitch(key){ opsTabSel = key; rerender(renderOps); }
// 더보기에서 특정 운영진 기능으로 바로 진입
function openOps(sub){ if(!isAdmin()) return; if(sub) opsTabSel = sub; switchTab('ops'); }

/* 명단 관리는 팀빌더 단일 출처 — 사이트 측 편집 기능은 제거됨(2026-07-22) */
function refreshOpenMemberViews(){
  const open = id => !document.getElementById(id).classList.contains('hidden');
  if (open('tab-home')) rerender(renderHome);
  if (open('tab-att'))  rerender(renderAtt);
  if (open('tab-dues')) rerender(renderDues);
  if (open('tab-potm')) rerender(renderPotm);
}

async function opsAddNotice() {
  const title = document.getElementById('opsNoticeTitle').value.trim();
  if (!title) return toast('제목을 입력해 주세요');
  const body = document.getElementById('opsNoticeBody').value.trim();
  const pinned = document.getElementById('opsNoticePin').checked;
  const fromV = document.getElementById('opsNoticeFrom').value;
  const untilV = document.getElementById('opsNoticeUntil').value;
  const publish_at = fromV ? new Date(fromV+'T00:00:00').toISOString() : null;
  const hide_at = untilV ? new Date(untilV+'T23:59:59').toISOString() : null;
  const _lt = document.getElementById('opsNoticeLinkType').value;
  const link = _lt==='url' ? document.getElementById('opsNoticeLinkUrl').value.trim() : _lt;
  const ok = await addNotice({ title, body, pinned, publish_at, hide_at, link });
  if (!ok) return;
  await rerender(renderOps); toast('공지를 등록했어요');
}
function opsEditNotice(id){ opsEditNoticeId = String(id); rerender(renderOps); }
function opsCancelEdit(){ opsEditNoticeId = null; rerender(renderOps); }
async function opsSaveNotice(id){
  const title = document.getElementById('opsEditTitle').value.trim();
  if (!title) return toast('제목을 입력해 주세요');
  const body = document.getElementById('opsEditBody').value.trim();
  const pinned = document.getElementById('opsEditPin').checked;
  const fromV = document.getElementById('opsEditFrom').value;
  const untilV = document.getElementById('opsEditUntil').value;
  const publish_at = fromV ? new Date(fromV+'T00:00:00').toISOString() : null;
  const hide_at = untilV ? new Date(untilV+'T23:59:59').toISOString() : null;
  const _lt = document.getElementById('opsEditLinkType').value;
  const link = _lt==='url' ? document.getElementById('opsEditLinkUrl').value.trim() : _lt;
  if (await updateNotice(id, { title, body, pinned, publish_at, hide_at, link: link||null })) { opsEditNoticeId = null; await rerender(renderOps); toast('수정했어요'); }
}
async function opsDelNotice(id){ if(!confirm('이 공지를 삭제할까요?'))return; if(await deleteNotice(id)){ await rerender(renderOps); toast('삭제했어요'); } }
async function opsPin(id, pin){ if(await togglePinNotice(id, pin)){ await rerender(renderOps); } }
function opsSyncDeadline() {
  const dt = document.getElementById('opsSessDate');
  const dd = document.getElementById('opsSessDeadline');
  if (dt && dd) dd.value = autoDeadlineStr(dt.value);
  // 시즌별 기본 시간 자동(팀 리그 20–23시 · 일반 21–23시)
  const tt = document.getElementById('opsSessTime'), te = document.getElementById('opsSessEnd');
  if (dt && dt.value && tt && te) { const st = seasonDefaultTime(dt.value); tt.value = st.start; te.value = st.end; }
  const lbl = document.getElementById('opsSessSeasonLbl');
  if (dt && lbl) lbl.textContent = `${seasonLabel(dt.value)} 시즌`;
}
function opsOpenAddSession(){ opsAddSessionOpen = true; rerender(renderOps); }
function opsCloseAddSession(){ opsAddSessionOpen = false; rerender(renderOps); }
async function opsAddSession() {
  const date = document.getElementById('opsSessDate').value;
  if (!date) return toast('날짜를 선택해 주세요');
  const time = document.getElementById('opsSessTime').value || seasonDefaultTime(date).start;
  const endTime = document.getElementById('opsSessEnd').value || seasonDefaultTime(date).end;
  const place = document.getElementById('opsSessPlace').value.trim() || '상암 풋살장';
  const placeUrl = document.getElementById('opsSessPlaceUrl').value.trim();
  const guestUrl = document.getElementById('opsSessGuestUrl').value.trim();
  const type = document.getElementById('opsSessType').value || '풋살';
  const deadline = document.getElementById('opsSessDeadline').value || autoDeadlineStr(date);
  const label = document.getElementById('opsSessLabel').value.trim();
  const desc = document.getElementById('opsSessDesc').value.trim();
  const duesOnly = document.getElementById('opsSessDuesOnly').checked;
  const allowDormant = document.getElementById('opsSessAllowDorm').checked;
  const list = await getSessions();
  list.push({ id:'s'+Date.now().toString(36)+Math.random().toString(36).slice(2,5), date, time, endTime, type, place, placeUrl, guestUrl, deadline, label, desc, duesOnly, allowDormant });
  if (!(await saveSettings({ sessions: list }))) return;
  opsAddSessionOpen = false;
  await rerender(renderOps); toast('세션을 추가했어요');
}

// 다음 달 수요일 세션 일괄 등록 — 시즌 규칙(리그 20-23시·일반 21-23시) 자동 적용
async function opsAddNextMonth(){
  if (!isAdmin()) return;
  const now = new Date();
  const ny = now.getMonth()===11 ? now.getFullYear()+1 : now.getFullYear();
  const nm = now.getMonth()===11 ? 1 : now.getMonth()+2;
  const mStr = ny+'-'+String(nm).padStart(2,'0');
  const days = [];
  const d = new Date(ny, nm-1, 1);
  while (d.getMonth() === nm-1) {
    if (d.getDay() === 3) days.push(mStr+'-'+String(d.getDate()).padStart(2,'0'));
    d.setDate(d.getDate()+1);
  }
  const list = await getSessions();
  const exist = new Set(list.map(s=>s.date));
  const targets = days.filter(ds=>!exist.has(ds));
  if (!targets.length) return toast(nm+'월 수요일 세션은 이미 모두 등록돼 있어요');
  const t0 = seasonDefaultTime(mStr);
  const lbl = targets.map(ds=>{const p=ds.split('-');return Number(p[1])+'/'+Number(p[2]);}).join(', ');
  if (!confirm(nm+'월('+(isLeague(mStr)?'팀 리그':'일반')+' 시즌) 수요일 '+targets.length+'개 세션을 등록할까요?\n'+lbl+' · '+t0.start+'-'+t0.end+' · 상암 풋살장')) return;
  targets.forEach(ds=>{
    const t = seasonDefaultTime(ds);
    list.push({ id:'s'+Date.now().toString(36)+Math.random().toString(36).slice(2,5)+ds.slice(-2),
      date:ds, time:t.start, endTime:t.end, type:'풋살', place:'상암 풋살장', placeUrl:'', guestUrl:'',
      deadline:autoDeadlineStr(ds), label:'', desc:'', duesOnly:false, allowDormant:false });
  });
  if (!(await saveSettings({ sessions: list }))) return;
  await rerender(renderOps); toast(targets.length+'개 세션을 등록했어요');
}

async function opsDelSession(id) {
  if (!confirm('이 세션을 삭제할까요? 참석 기록도 더는 표시되지 않아요.')) return;
  const list = (await getSessions()).filter(s=>s.id!==id);
  if (!(await saveSettings({ sessions: list }))) return;
  await rerender(renderOps); toast('세션을 삭제했어요');
}
function opsEditSession(id){ opsEditSessionId = String(id); rerender(renderOps); }
function opsCancelSessionEdit(){ opsEditSessionId = null; rerender(renderOps); }
async function opsSaveSession(id) {
  const list = await getSessions();
  const s = list.find(x=>String(x.id)===String(id));
  if (!s) return;
  const date = document.getElementById('esD').value;
  if (!date) return toast('날짜를 선택해 주세요');
  s.date = date;
  s.time = document.getElementById('esT').value || '21:00';
  s.endTime = document.getElementById('esTe').value || '';
  s.type = document.getElementById('esType').value || '풋살';
  s.place = document.getElementById('esP').value.trim() || '상암 풋살장';
  s.placeUrl = document.getElementById('esPu').value.trim();
  s.guestUrl = document.getElementById('esGu').value.trim();
  s.deadline = document.getElementById('esDl').value || autoDeadlineStr(date);
  s.label = document.getElementById('esL').value.trim();
  s.desc = document.getElementById('esDesc').value.trim();
  s.duesOnly = document.getElementById('esDuesOnly').checked;
  s.allowDormant = document.getElementById('esAllowDorm').checked;
  if (!(await saveSettings({ sessions: list }))) return;
  opsEditSessionId = null;
  await rerender(renderOps); toast('세션을 수정했어요');
}

/* ---------- 실시간 갱신 (새 테이블) ---------- */
if (USE_DB) {
  ['notices','attendance','dues','club_settings'].forEach(tbl => {
    sb.channel(tbl+'-rt').on('postgres_changes', { event:'*', schema:'public', table:tbl }, async () => {
      _settingsCache = null;
      if (tbl === 'club_settings') { try { const r = await fetchRoster(); if (r) applyPlayers(r); await mergeTbMembers(); const s = await fetchSettings(); teamSplitOn = s.teamSplit !== false; await loadTbDormant(); } catch (e) {} }
      const open = id => !document.getElementById(id).classList.contains('hidden');
      if (open('tab-home')) rerender(renderHome);
      if (open('tab-att'))  rerender(renderAtt);
      if (open('tab-dues')) rerender(renderDues);
      if (open('tab-ops'))  rerender(renderOps);
    }).subscribe();
  });
}

/* ============================================================
   랭킹 — 팀빌더 클라우드 데이터(club_settings id='teambuilder')를 읽어 집계
   ============================================================ */
let rankTab = 'att', rankYear = '2026';
function switchRankTab(t){ rankTab = t; rerender(renderRank); }
function changeRankYear(y){ rankYear = y; rerender(renderRank); }

async function fetchTeamBuilder(){
  if (!USE_DB) return null;
  try { const { data } = await sb.from('club_settings').select('data').eq('id','teambuilder').maybeSingle(); return (data && data.data) || null; }
  catch(e){ return null; }
}
async function saveTeamBuilder(data){
  if (!USE_DB) return false;
  try { const { error } = await sb.from('club_settings').upsert({ id:'teambuilder', data, updated_at:new Date().toISOString() }); return !error; }
  catch(e){ return false; }
}
// 멤버 셀프: 해당 월 휴면 여부를 팀빌더 명단에 직접 반영
async function setMyDormancy(memberId, month, dormant){
  if (!getMe() || (memberId !== getMe() && !isAdmin())) return;
  const tb = await fetchTeamBuilder();
  if (!tb || !Array.isArray(tb.players)) { toast('명단을 불러오지 못했어요.'); return; }
  const p = tb.players.find(x => x.id === memberId);
  if (!p) { toast('명단에서 찾을 수 없어요.'); return; }
  let dm = (p.dormantMonths || []).slice();
  let am = (p.activeMonths || []).slice();
  if (dormant) {
    if (!dm.includes(month)) dm.push(month);
    am = am.filter(x => x !== month);
  } else {
    dm = dm.filter(x => x !== month);
    if (!am.includes(month)) am.push(month);   // 영구 휴면(status:'dormant')이어도 이 달만 활동으로 예외 처리
  }
  p.dormantMonths = dm;
  p.activeMonths = am;
  if (!(await saveTeamBuilder(tb))) { toast('저장 중 오류가 났어요.'); return; }
  await mergeTbMembers();
  await loadTbDormant();
  toast(dormant ? '다음 달 휴면으로 신청했어요' : '다음 달 활동으로 신청했어요');
  await rerender(renderHome);
}
// 15일 이후 '다음 달 휴면 자동추가'를 멤버앱 로드 시에도 1회 처리(누가 앱을 열든 자동).
// dormRollover 마커로 월 1회만 실행 → 멤버가 멤버앱에서 '활동'으로 바꾼 걸 덮어쓰지 않음.
async function rolloverDormancyIfNeeded(){
  if (!USE_DB) return;
  if (!dormFeatureOn()) return;   // 2026-07-15부터 작동
  const now = new Date();
  if (now.getDate() < 15) return;
  let ny = now.getFullYear(), nm = now.getMonth() + 1; if (nm > 11) { nm = 0; ny += 1; }
  const nextMonth = `${ny}-${String(nm + 1).padStart(2, '0')}`;
  let tb;
  try { tb = await fetchTeamBuilder(); } catch(e) { return; }
  if (!tb || !Array.isArray(tb.players)) return;
  if (tb.dormRollover === nextMonth) return;   // 이번 롤오버 이미 처리됨
  const curMonth = nowMonthStr();
  tb.players.forEach(p => {
    if ((p.status || 'active') === 'former') return;
    const dm = p.dormantMonths || [];
    const curDorm = dm.includes(curMonth) || (p.status || 'active') === 'dormant';
    if (curDorm && !dm.includes(nextMonth) && !(p.activeMonths||[]).includes(nextMonth)) { dm.push(nextMonth); p.dormantMonths = dm; }
  });
  tb.dormRollover = nextMonth;
  if (await saveTeamBuilder(tb)) { await mergeTbMembers(); await loadTbDormant(); }
}
function rkInPool(p, d){
  if (p.joinDate && d < p.joinDate) return false;
  if (p.leaveDate && p.rejoinDate){ if (d >= p.leaveDate && d < p.rejoinDate) return false; }
  else if (p.leaveDate && !p.rejoinDate){ if (d >= p.leaveDate) return false; }
  return true;
}
function rkDormant(p, mo){ return (p.dormantMonths||[]).includes(mo); }
function rkAtt(p, sess){
  let a=0,c=0;
  sess.forEach(s=>{ if(!rkInPool(p,s.date)) return; if(rkDormant(p,s.date.slice(0,7))) return; c++; if((s.attendees||[]).includes(p.id)) a++; });
  return { rate: c>0?Math.round(a/c*1000)/10:0, attended:a, counted:c };
}
function rkRanks(list, key){ const r=[]; list.forEach((x,i)=>{ if(i===0){r.push(1);return;} r.push(key(x)===key(list[i-1])?r[i-1]:i+1); }); return r; }

async function renderRank(){
  const el = document.getElementById('rankContent');
  if (!el.innerHTML.trim()) el.innerHTML = `<div class="empty">불러오는 중...</div>`;
  const tb = await fetchTeamBuilder();
  const _rkTabs = [['att','출석율'],['winrate','승률'],['model','모범생'],['lma','당일 불참'],['dorm','휴면율']];
  if (meName()==='박승한') _rkTabs.push(['bad','불량배']);   // 불량배는 나만 보기
  if (!_rkTabs.some(t=>t[0]===rankTab)) rankTab='att';
  const tabsHtml = `<div class="rk-tabs">${_rkTabs.map(([k,l])=>`<button class="rk-tab ${k===rankTab?'on':''}" onclick="switchRankTab('${k}')">${l}</button>`).join('')}</div>`;
  const hero = `<div class="potm-hero"><h2>랭킹</h2><div class="month">팀빌더 출석 기록 기준</div></div>`;
  if (!tb || !Array.isArray(tb.sessions) || !tb.sessions.length){
    el.innerHTML = hero + tabsHtml + `<div class="card"><div class="empty">아직 집계할 출석 데이터가 없어요.<br>팀빌더에서 세션 출석을 기록하면 여기에 랭킹이 나와요.</div></div>`;
    return;
  }
  const players = tb.players || [];
  const allSess = [...tb.sessions].sort((a,b)=>a.date.localeCompare(b.date));
  const years = [...new Set(allSess.map(s=>(s.date||'').slice(0,4)).filter(Boolean))].sort();
  if (rankYear && !years.includes(rankYear)) rankYear = '';
  const sess = rankYear ? allSess.filter(s=>(s.date||'').startsWith(rankYear)) : allSess;
  const yearLabel = rankYear ? `${rankYear}년` : '전체';
  const elig = players.filter(p=>{ const st=p.status||'active'; return st!=='former' && st!=='friends' && !INJURED_NAMES.includes(p.name); });

  let data, ranks, valFn, subFn, pctFn, note;
  if (rankTab==='att'){
    const tot=sess.length, min=Math.ceil(tot*0.5);
    data = elig.map(p=>{ const r=rkAtt(p,sess); return {p,_r:r.rate,_a:r.attended,_t:r.counted}; }).filter(x=>x._t>=min).sort((a,b)=>b._r-a._r);
    ranks = rkRanks(data,x=>x._a+'/'+x._t);
    valFn=x=>x._r+'%'; subFn=x=>`${x._a}/${x._t}세션`; pctFn=x=>x._r;
    note=`${yearLabel} · ${data.length}명 · 출석율 (${min}세션↑)`;
  } else if (rankTab==='winrate'){
    const ym = rankYear ? (tb.matches||[]).filter(m=>(m.date||'').startsWith(rankYear)) : (tb.matches||[]);
    const ws = computeWinStats(ym);
    data = elig.map(p=>{ const w=ws[p.id]; if(!w||!w.played) return null; return {p,_w:w.w,_l:w.l,_d:w.d,_pl:w.played,_r:Math.round((w.w + w.d*0.5)/w.played*100)}; }).filter(Boolean).sort((a,b)=>b._r-a._r||b._pl-a._pl);
    ranks = rkRanks(data,x=>x._r+'/'+x._pl);
    valFn=x=>x._r+'%'; subFn=x=>`${x._pl}전 ${x._w}승 ${x._l}패${x._d?` ${x._d}무`:''}`; pctFn=x=>x._r;
    note=`${yearLabel} · ${data.length}명 · 승률 (경기 참여 기준)`;
  } else if (rankTab==='lma'){
    data = elig.map(p=>{ const pool=sess.filter(s=>rkInPool(p,s.date)&&!rkDormant(p,s.date.slice(0,7))); const cnt=pool.filter(s=>(s.lastMinuteAbsentIds||[]).includes(p.id)).length; const rate=pool.length>0?Math.round(cnt/pool.length*1000)/10:0; return {p,_c:cnt,_r:rate,_t:pool.length}; }).filter(x=>x._c>0).sort((a,b)=>b._r-a._r||b._c-a._c);
    ranks = rkRanks(data,x=>x._c+'/'+x._t);
    valFn=x=>x._r+'%'; subFn=x=>`${x._c}회`; pctFn=x=>Math.round(x._r);
    note=`${yearLabel} · ${data.length}명 · 당일 불참율`;
  } else if (rankTab==='dorm'){
    data = elig.map(p=>{ const pm=new Set(sess.filter(s=>rkInPool(p,s.date)).map(s=>s.date.slice(0,7))); const dm=new Set((p.dormantMonths||[]).filter(mo=>pm.has(mo))); const rate=pm.size>0?Math.round(dm.size/pm.size*1000)/10:0; return {p,_r:rate,_d:dm.size,_m:pm.size}; }).filter(x=>x._r>0).sort((a,b)=>b._r-a._r);
    ranks = rkRanks(data,x=>x._d+'/'+x._m);
    valFn=x=>x._r+'%'; subFn=x=>`${x._d}/${x._m}개월`; pctFn=x=>x._r;
    note=`${yearLabel} · ${data.length}명 · 휴면율`;
  } else if (rankTab==='bad'){
    data = elig.map(p=>{
      const pool=sess.filter(s=>rkInPool(p,s.date)&&!rkDormant(p,s.date.slice(0,7)));
      const lmaCnt=pool.filter(s=>(s.lastMinuteAbsentIds||[]).includes(p.id)).length;
      const lmaRate=pool.length>0?Math.round(lmaCnt/pool.length*1000)/10:0;
      const pm=new Set(sess.filter(s=>rkInPool(p,s.date)).map(s=>s.date.slice(0,7)));
      const dm=new Set((p.dormantMonths||[]).filter(mo=>pm.has(mo)));
      const dr=pm.size>0?Math.round(dm.size/pm.size*1000)/10:0;
      return {p,_lma:lmaRate,_dr:dr,_c:lmaCnt,_s:Math.round((lmaRate*2+dr)*10)/10};
    }).filter(x=>x._s>0).sort((a,b)=>b._s-a._s);
    ranks = rkRanks(data,x=>String(x._s));
    const maxs = data.length?(data[0]._s||1):1;
    valFn=x=>x._s+'점'; subFn=x=>`당일불참 ${x._lma}% · 휴면 ${x._dr}%`; pctFn=x=>Math.round(x._s/maxs*100);
    note=`${yearLabel} · ${data.length}명 · 당일불참율×2+휴면율 (나만 보기)`;
  } else {
    const tot=sess.length, min=Math.ceil(tot*0.5);
    const vs = await getVoteStats(rankYear);   // 투표 참여 + 수상 집계
    const voteRate = p => { if(!vs.voteMonths.length) return 1; const c=vs.voteMonths.filter(mo=>vs.voterByMonth[mo].has(p.id)).length; return c/vs.voteMonths.length; };
    data = elig.map(p=>{ const r=rkAtt(p,sess); if(r.counted<min) return null; const pm=new Set(sess.filter(s=>rkInPool(p,s.date)).map(s=>s.date.slice(0,7))); const dm=new Set((p.dormantMonths||[]).filter(mo=>pm.has(mo))); const dr=pm.size>0?Math.round(dm.size/pm.size*1000)/10:0; const poolS=sess.filter(s=>rkInPool(p,s.date)&&!rkDormant(p,s.date.slice(0,7))); const lmaCnt=poolS.filter(s=>(s.lastMinuteAbsentIds||[]).includes(p.id)).length; const lmaRate=poolS.length>0?Math.round(lmaCnt/poolS.length*1000)/10:0; const vr=voteRate(p); const win=vs.winsByMember[p.id]||0; const misV=Math.round((1-vr)*100); const s=Math.max(0,Math.round((r.rate - dr*0.3 - lmaRate*MODEL_LMA_PENALTY - misV*0.1 + win*MODEL_WIN_BONUS)*10)/10); return {p,_ar:r.rate,_a:r.attended,_t:r.counted,_dr:dr,_vr:vr,_win:win,_lma:lmaRate,_s:s}; }).filter(Boolean).sort((a,b)=>b._s-a._s||b._ar-a._ar);
    ranks = rkRanks(data,x=>String(x._s));
    valFn=x=>x._s+'점'; subFn=x=>`출석 ${x._ar}% · 휴면 ${x._dr}% · 투표 ${Math.round(x._vr*100)}%${x._lma?` · 불참 ${x._lma}%`:''}${x._win?` · 수상 ${x._win}`:''}`; pctFn=x=>Math.max(2,Math.min(100,Math.round(x._s)));
    note=`${yearLabel} · ${data.length}명 · 출석 기준 − 휴면×0.3 − 불참×0.5 − 미투표×0.1 + 수상×2 (${min}세션↑)`;
  }

  let html = hero + tabsHtml;
  html += `<div class="rk-years">${['전체',...years].map(y=>{ const v=y==='전체'?'':y; return `<button class="rk-year ${rankYear===v?'on':''}" onclick="changeRankYear('${v}')">${y}</button>`; }).join('')}</div>`;
  html += `<div class="rk-note">${note}</div>`;
  if (!data.length){ el.innerHTML = html + `<div class="card"><div class="empty">${yearLabel} 대상이 없어요.</div></div>`; return; }

  const top = data.slice(0,3);
  html += `<div class="rk-podium" style="grid-template-columns:repeat(${top.length},1fr)">` + top.map((x,i)=>`
    <div class="rk-card">
      <div class="rkrank">${ranks[i]}</div>
      <div class="rknm">${esc(x.p.name)}</div>
      <div class="rkval">${valFn(x)}</div>
      <div class="rksub">${subFn(x)}</div>
    </div>`).join('') + `</div>`;
  if (data.length>3){
    html += data.slice(3).map((x,i)=>`
      <div class="rk-row">
        <div class="rk-main">
          <span class="rkr">${ranks[i+3]}</span>
          <span class="rkn">${esc(x.p.name)}</span>
          <span class="rkbar"><div style="width:${Math.max(2,Math.min(100,pctFn(x)))}%"></div></span>
          <span class="rkv">${valFn(x)}</span>
        </div>
        <div class="rk-sub">${subFn(x)}</div>
      </div>`).join('');
  }
  el.innerHTML = html;
}

/* ---------- 비밀번호 게이트 ---------- */
/* ---------- 로그인 (이름 + 등번호) ---------- */
const GATE_KEY = 'socoffee_unlocked';
const IS_LOCAL = location.protocol === 'file:' ||
  ['localhost','127.0.0.1','0.0.0.0',''].includes(location.hostname);

function gateNameOptions() {
  return [...PLAYERS].filter(p => p.status !== 'former')
    .sort((a,b) => a.name.localeCompare(b.name,'ko'))
    .map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
}
function populateGate() {
  const sel = document.getElementById('gateName');
  if (sel) sel.innerHTML = '<option value="">— 이름 선택 —</option>' + gateNameOptions();
}
function showGate(show) { document.getElementById('gate').classList.toggle('hidden', !show); }

async function gateLogin() {
  const err = document.getElementById('gate-err');
  const id = Number(document.getElementById('gateName').value);
  const pin = (document.getElementById('gatePin').value || '').trim();
  if (!id) { err.textContent = '이름을 선택해 주세요.'; return; }
  const p = PLAYERS.find(x => x.id === id);
  if (!p) { err.textContent = '명단에서 찾을 수 없어요.'; return; }
  if (!/^\d{4}$/.test(pin)) { err.textContent = 'PIN은 숫자 4자리예요.'; return; }
  let h;
  try { h = await hashPin(id, pin); }
  catch (e) { err.textContent = '이 환경에서는 로그인할 수 없어요(보안 컨텍스트 필요).'; return; }
  const stored = CLUB_PINS[id];
  if (!stored) {
    CLUB_PINS[id] = h;
    const ok = await saveSettings({ pins: CLUB_PINS });
    if (!ok) { delete CLUB_PINS[id]; err.textContent = 'PIN 등록 중 오류가 났어요. 다시 시도해 주세요.'; return; }
    toast('PIN이 설정됐어요. 다음부터 이 PIN으로 로그인해요.');
  } else if (stored !== h) {
    err.textContent = 'PIN이 일치하지 않아요.'; document.getElementById('gatePin').value = ''; return;
  }
  setMe(id);
  localStorage.setItem(GATE_KEY, '1');
  attMe = null; potmVoterId = null;
  err.textContent = '';
  showGate(false);
  updateAdminBtn();
  switchTab('home');
  setTimeout(()=>{ try{ preloadTabs(); }catch(e){} }, 300);   // 로그인 후 주요 탭 미리 렌더
}
function logout() {
  if (!confirm('로그아웃할까요?')) return;
  localStorage.removeItem(GATE_KEY);
  localStorage.removeItem(ME_KEY);
  location.reload();
}
function meName() {
  const p = PLAYERS.find(x => x.id === getMe());
  return p ? p.name : '';
}

// 주요 탭을 백그라운드로 미리 렌더 → 탭 전환 시 즉시 표시(깜빡임 없음). 숨겨진 탭 div에 채워둠.
function preloadTabs(){
  [renderAtt, renderMine, renderSquad, renderRank, renderPotm, renderFaq, renderMore].forEach(fn=>{ try{ fn(); }catch(e){} });
  if (isDuesViewer()) { try{ renderDues(); }catch(e){} }
  if (isAdmin()) { try{ renderOps(); }catch(e){} }
}
async function initApp() {
  updateAdminBtn();
  try { const r = await fetchRoster(); if (r) applyPlayers(r); } catch (e) {}
  await mergeTbMembers();   // 팀빌더에만 있는 멤버도 로그인 가능하게 병합
  try { const s = await fetchSettings(); teamSplitOn = s.teamSplit !== false; CLUB_PINS = s.pins || {}; BANK = s.bank || null; SURVEY = s.survey || null; UNIFORM = s.uniform || null; RESULTS = s.results || null; GUEST_REQS = s.guestReqs || []; GUEST_EXTRA = s.guestExtra || {}; DUES_CONFIRMED = s.duesConfirmed || {}; } catch (e) {}
  await loadTbDormant();
  await rolloverDormancyIfNeeded();   // 15일 이후 다음 달 휴면 자동 롤오버(월 1회) — 누가 앱을 열든 자동
  // 로컬 미리보기: 첫 활동 회원으로 자동 로그인
  if (IS_LOCAL && getMe() == null) {
    const ms = activeMembers(potmMonth());
    const def = ms.find(m => ADMIN_NAMES.includes(m.name)) || ms[0];
    if (def) setMe(def.id);
  }
  const loggedIn = (IS_LOCAL || localStorage.getItem(GATE_KEY) === '1') && getMe() != null;
  if (loggedIn) { showGate(false); }
  else { populateGate(); showGate(true); }
  updateAdminBtn();
  const start = (location.hash.slice(1) || 'home');
  const ok = ALL_TABS.includes(start) && (start !== 'ops' || isAdmin());
  switchTab(ok ? start : 'home', 'replace');   // 초기 진입은 히스토리 대체(중복 항목 방지)
  render();  // 카풀 데이터 미리 로드(실시간 구독 대비)
  refreshAttBadge();   // 일정 탭 미응답 배지
  refreshNewBadges();  // 신규 콘텐츠 점(카풀·투표)
  if (loggedIn) setTimeout(()=>{ try{ preloadTabs(); }catch(e){} }, 300);   // 주요 탭 미리 렌더
}
// 뒤로/앞으로 가기(해시 변경) → 해당 탭으로(히스토리 조작 없이)
window.addEventListener('hashchange', () => {
  const t = location.hash.slice(1) || 'home';
  if (ALL_TABS.includes(t) && (t !== 'ops' || isAdmin())) switchTab(t, 'none');
});
initApp();

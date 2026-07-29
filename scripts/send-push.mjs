// 싸커피 웹 푸시 발송 — GitHub Actions 매시간 실행 (또는 수동 발송)
// 트리거: ①마감 전날 미응답·미정(타겟) ②투표 시작(25일) ③카풀 게시 ④세션 게시
//         ⑤회비 시작(15일) ⑥회비 마감(25일) 전날 미납(타겟) ⑦공지 게시 ⑧내일 세션 리마인드
import webpush from 'web-push';

const SB_URL = 'https://fjgxhguogsuypcdzcieg.supabase.co';
const SB_KEY = 'sb_publishable_K7TsALmaFyb2pPOZO-2i2w_UeirVr8l';   // anon(공개) 키
const { VAPID_PUBLIC_KEY: PUB, VAPID_PRIVATE_KEY: PRIV, MANUAL_TITLE = '', MANUAL_BODY = '' } = process.env;
if (!PUB || !PRIV) { console.error('VAPID 키 시크릿이 없습니다'); process.exit(1); }
webpush.setVapidDetails('mailto:tmdgks15@gmail.com', PUB, PRIV);

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
const rest = (p, o = {}) => fetch(`${SB_URL}/rest/v1/${p}`, { ...o, headers: { ...H, ...(o.headers || {}) } });   // 주의: headers를 o 뒤에 병합해야 apikey가 유지됨
const j = async r => { try { return await r.json(); } catch (e) { return null; } };

// ---- KST 시간 유틸 ----
const nowKST = () => new Date(Date.now() + 9 * 3600 * 1000);
const kstDate = (off = 0) => new Date(Date.now() + 9 * 3600 * 1000 + off * 86400 * 1000).toISOString().slice(0, 10);
const kstHour = () => nowKST().getUTCHours();
const monthOf = ds => ds.slice(0, 7);
const mdLabel = ds => `${Number(ds.slice(5, 7))}/${Number(ds.slice(8, 10))}`;
// 매치일 '직전 일요일' (autoDeadlineStr와 동일 규칙)
function deadlineOf(sess) {
  if (sess.deadline) return sess.deadline;
  if (!sess.date) return null;
  const d = new Date(sess.date + 'T12:00:00Z');
  const back = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
// ---- 활동 정원제 (2026-09분부터) ----
// 자리 확인(confirm)은 cap_confirm 테이블(PK: month+member_id)에서 읽는다. 확정 결과(result)만 current.capacity에 쓴다.
// (예전엔 confirm도 current.capacity 안에 있었는데 동시 신청이 서로를 덮어써서 테이블로 분리함 — 레거시 값은 읽기 폴백)
let CAP_STATE = {};   // current.capacity — { 'YYYY-MM': { result:{active:[],finalized} } }
const CAP_LIMIT = { '남': 24, '여': 12 };
const CAP_START = '2026-09';
const GENDER_FIX = { '심지수': '여' };   // 명단 성별 누락 보정
const capGender = p => p.gender || GENDER_FIX[p.name] || '남';
const capResultFor = m => { const r = (CAP_STATE[m] || {}).result; return (r && Array.isArray(r.active)) ? r : null; };
// 그 달 자리 확인 맵 { id: {s,at} } — 테이블 값이 레거시 blob보다 우선
async function capConfirmFor(m) {
  const map = Object.assign({}, (CAP_STATE[m] || {}).confirm || {});
  const rows = await j(await rest(`cap_confirm?select=member_id,state,at&month=eq.${m}`)) || [];
  rows.forEach(r => { map[String(r.member_id)] = { s: r.state, at: Date.parse(r.at) || 0 }; });
  return map;
}

// 사이트 isDormantFor와 동일 규칙 — 정원제 확정 결과 최우선, activeMonths, 영구휴면, 해당 월·이번 달 월휴면
function isDormantLike(p, m, curM) {
  const _r = (typeof m === 'string' && m >= CAP_START) ? capResultFor(m) : null;
  if (_r) return !_r.active.includes(p.id);
  if ((p.activeMonths || []).includes(m)) return false;
  if ((p.status || 'active') === 'dormant') return true;
  const dm = p.dormantMonths || [];
  return dm.includes(m) || dm.includes(curM);
}
// 그 달 활동 멤버 (former·friends 제외)
function activeFor(players, m, curM) {
  return players.filter(p => {
    const st = p.status || 'active';
    if (st === 'former' || st === 'friends') return false;
    return !isDormantLike(p, m, curM || m);
  });
}
// 그 달 휴면 멤버 (former·friends 제외)
function dormantFor(players, m, curM) {
  return players.filter(p => {
    const st = p.status || 'active';
    if (st === 'former' || st === 'friends') return false;
    return isDormantLike(p, m, curM || m);
  });
}

// 그 달 활동 멤버 id 목록 (allowAll=true면 휴면 포함 전체)
function idsFor(players, m, allowAll, curM) {
  if (allowAll) return null;   // null = 전체 발송
  return activeFor(players, m, curM).map(p => p.id);
}

// 문구 템플릿 — 기본값 (운영진 탭 '푸시'에서 수정 시 club_settings.pushTemplates가 우선)
const TPL = {
  notice:      { title:'새 공지', body:'{제목}' },
  ride:        { title:'새 카풀', body:'{운전자}님 · {날짜} {시간} {출발지} → {도착지}' },
  session_new: { title:'새 세션 일정', body:'{날짜} {시간} {장소} — 참석 체크해 주세요' },
  tomorrow:    { title:'내일 세션', body:'{날짜} {시간} {장소} — 내일이에요!' },
  deadline:    { title:'참석 마감 임박', body:'{날짜} 세션 참석 응답이 내일 마감돼요. 참석/불참을 정해 주세요!' },
  vote:        { title:'이달의 선수 투표 시작', body:'이번 달 MVP와 성장상을 뽑아 주세요!' },
  dues_open:   { title:'다음 달 활동 확인', body:'{월}월에도 뛰려면 25일까지 활동 확인과 회비 납부를 모두 해주세요. 휴면 회원은 같은 기간에 복귀 신청할 수 있어요.' },
  dues_urge:   { title:'자리 확정 마감 임박', body:'{월}월 자리 확정이 내일(25일) 마감돼요. 활동 확인이나 회비 납부가 아직이에요!' },
  dorm_ask:    { title:'{월}월엔 복귀하시나요?', body:"복귀하려면 홈에서 '활동'을, 계속 쉬려면 '휴면'을 눌러 주세요. 그대로 두면 휴면이 유지돼요." },
  winner:      { title:'축하합니다!', body:'{월}월 {부문}에 선정됐어요!' },
  vote_close:  { title:'{월}월 투표 마감 임박', body:'투표가 오늘 밤 마감돼요. 아직 참여 전이에요!' },
  results_open: { title:'{월}월 투표 결과 공개', body:'{월}월 이달의 선수·성장상 결과가 공개됐어요. 확인해 보세요!' },
};
let TPL_OV = {};
const fill = (t, v) => { let r = t; for (const k in (v || {})) r = r.split('{' + k + '}').join(v[k]); return r; };
const T = (key, vars) => {
  const d = TPL[key], o = TPL_OV[key] || {};
  return { title: fill(o.title || d.title, vars), body: fill(o.body || d.body, vars) };
};

async function main() {
  const subs = await j(await rest('push_subs?select=endpoint,data,member_id,prefs'));
  if (!Array.isArray(subs) || !subs.length) { console.log('구독자 없음 — 종료'); return; }
  // 알림 설정은 계정(멤버) 기준 — 같은 멤버의 구독들에서 prefs를 병합해 모든 기기에 동일 적용
  const memberPrefs = {};
  for (const s of subs) if (s.member_id && s.prefs) memberPrefs[s.member_id] = Object.assign(memberPrefs[s.member_id] || {}, s.prefs);
  const prefFor = s => (s.member_id && memberPrefs[s.member_id]) || s.prefs || null;

  const stRow = await j(await rest('club_settings?select=data&id=eq.push_state'));
  const firstRun = !(stRow && stRow[0] && stRow[0].data);   // 최초 실행: 기존 콘텐츠는 기록만 하고 알리지 않음
  const st = Object.assign({ noticeIds: [], rideIds: [], sessionIds: [], sent: [] }, (stRow && stRow[0] && stRow[0].data) || {});
  const once = k => st.sent.includes(k) ? false : (st.sent.push(k), true);

  const curRow = await j(await rest('club_settings?select=data&id=eq.current'));
  const cur = (curRow && curRow[0] && curRow[0].data) || {};
  const sessions = cur.sessions || [];
  TPL_OV = cur.pushTemplates || {};
  CAP_STATE = cur.capacity || {};
  const tbRow = await j(await rest('club_settings?select=data&id=eq.teambuilder'));
  const players = ((tbRow && tbRow[0] && tbRow[0].data) || {}).players || [];

  const today = kstDate(0), hour = kstHour();
  const evening = hour >= 18 && hour < 21;      // 날짜 기반 알림은 저녁 6~9시 1회
  const dom = Number(today.slice(8, 10));
  const thisMonth = monthOf(today);
  const msgs = [];   // { title, body, url, targets?: [memberId] }  targets 없으면 전체

  // ── 활동 정원제: 26일 0시(KST) 경과 → 다음 달 잠정 확정(확인+자가신고 필요) · 5일 이후 입금확인 기준 최종 확정 ──
  async function capSave(m, patch){
    const row = await j(await rest('club_settings?select=data&id=eq.current'));
    const c2 = (row && row[0] && row[0].data) || {};
    const cap = Object.assign({}, c2.capacity || {});
    cap[m] = Object.assign({}, cap[m] || {}, patch);
    c2.capacity = cap;
    const res = await rest('club_settings', { method:'POST', headers:{ Prefer:'resolution=merge-duplicates' },
      body: JSON.stringify({ id:'current', data:c2, updated_at:new Date().toISOString() }) });
    if (!res.ok) { console.error('정원제 저장 실패:', res.status, await res.text()); process.exit(1); }
    CAP_STATE = cap;
  }
  function capRank(conf, okFn){   // 자리 배정: 유지 우선 → 신청 시각 순, 성별 정원 컷
    const pool = { '남':[], '여':[] };
    players.forEach(p => {
      const st = p.status || 'active';
      if (st === 'former' || st === 'friends') return;
      const c = conf[String(p.id)];
      if (!c || c.s !== 'active' || !okFn(p)) return;
      pool[capGender(p)].push({ id:p.id, at:c.at||0, keep: !isDormantLike(p, thisMonth, thisMonth) });
    });
    const active = [];
    ['남','여'].forEach(g => {
      pool[g].sort((a,b) => (b.keep?1:0)-(a.keep?1:0) || a.at-b.at);
      pool[g].slice(0, CAP_LIMIT[g]).forEach(x => active.push(x.id));
    });
    return active;
  }
  if (dom >= 26) {
    let ny = Number(today.slice(0,4)), nmo = Number(today.slice(5,7)) + 1; if (nmo > 12) { nmo = 1; ny++; }
    const capM = `${ny}-${String(nmo).padStart(2,'0')}`;
    if (capM >= CAP_START && !capResultFor(capM)) {
      const dd = await j(await rest(`dues?select=member_id,paid&month=eq.${capM}`)) || [];
      const cpaid = new Set(dd.filter(d => d.paid).map(d => d.member_id));
      const active = capRank(await capConfirmFor(capM), p => cpaid.has(p.id));
      await capSave(capM, { result: { active, at: new Date().toISOString() } });
      console.log('정원제 롤오버', capM, '— 잠정 활동', active.length, '명');
    }
  }
  if (dom >= 5 && dom < 15) {
    const r5 = capResultFor(thisMonth);
    const dc5 = new Set(((cur.duesConfirmed || {})[thisMonth]) || []);
    if (thisMonth >= CAP_START && r5 && !r5.finalized && dc5.size) {
      const dd = await j(await rest(`dues?select=member_id,paid&month=eq.${thisMonth}`)) || [];
      const cpaid = new Set(dd.filter(d => d.paid).map(d => d.member_id));
      const active = capRank(await capConfirmFor(thisMonth), p => cpaid.has(p.id) && dc5.has(p.id));
      await capSave(thisMonth, { result: { active, finalized: true, at: new Date().toISOString() } });
      console.log('정원제 최종 확정', thisMonth, '— 활동', active.length, '명');
    }
  }

  // ⓠ 개인 알림 큐 (입금 확인·관리자 변경 등) — 매 실행마다 비움
  const queue = await j(await rest('push_queue?select=id,target_member_id,title,body,url&order=created_at.asc&limit=50')) || [];
  const qIds = [];
  for (const q of queue) {
    qIds.push(q.id);
    // 대상 코드: 0=전체, -1=활동 회원, -2=휴면 회원, 그 외=개인 id
    let tg;
    if (q.target_member_id === 0) tg = null;
    else if (q.target_member_id === -1) tg = 'ACTIVE';
    else if (q.target_member_id === -2) tg = 'DORMANT';
    else tg = [q.target_member_id];
    msgs.push({ title: q.title, body: q.body, url: q.url || './member.html', targets: tg });
  }

  if (MANUAL_TITLE || MANUAL_BODY) {
    msgs.push({ title: MANUAL_TITLE || '싸커피', body: MANUAL_BODY, url: './member.html' });
  } else {
    // ⑦ 새 공지 (등록 후 최대 1시간 내)
    const notices = await j(await rest('notices?select=id,title,publish_at,created_at&order=created_at.desc&limit=20')) || [];
    for (const n of notices) {
      if (st.noticeIds.includes(String(n.id))) continue;
      if (new Date(n.created_at) < new Date(Date.now() - 48 * 3600e3)) continue;
      if (n.publish_at && new Date(n.publish_at) > new Date()) continue;
      st.noticeIds.push(String(n.id));
      if (firstRun) continue;
      msgs.push({ ...T('notice', {'제목': n.title}), url: './member.html#home' });
    }
    // ③ 새 카풀 — 전체 푸시 제거(2026-07-24 결정). 드라이버 개인 알림(push_queue)만 유지, 알림함에는 계속 표시
    const rides = await j(await rest('rides?select=id,created_at&order=created_at.desc&limit=10')) || [];
    for (const r of rides) { if (!st.rideIds.includes(String(r.id))) st.rideIds.push(String(r.id)); }
    // ④ 새 세션 일정 (지난 세션 제외)
    for (const s of sessions) {
      const sid = String(s.id || s.date);
      if (st.sessionIds.includes(sid)) continue;
      st.sessionIds.push(sid);
      if (firstRun) continue;
      if (!s.date || s.date < today) continue;
      msgs.push({ cat:'session_new', legacy:'session', ...T('session_new', {'날짜': mdLabel(s.date), '시간': s.time || '', '장소': s.place || ''}), url: './member.html#att', targets: idsFor(players, monthOf(s.date), s.allowDormant, thisMonth) });
    }
    if (evening) {
      // ⑧ 내일 세션 리마인드 — '참석'으로 응답한 멤버에게만
      for (const s of sessions) {
        if (s.date !== kstDate(1)) continue;
        if (!once('rem-' + (s.id || s.date))) continue;
        const att = await j(await rest(`attendance?select=member_id,status&session_id=eq.${encodeURIComponent(s.id)}`)) || [];
        const going = att.filter(a => a.status === 'yes').map(a => a.member_id);
        if (going.length) msgs.push({ ...T('tomorrow', {'날짜': mdLabel(s.date), '시간': s.time || '', '장소': s.place || ''}), url: './member.html#att', targets: going });
      }
      // ① 마감 하루 전 — 미응답·미정만 타겟
      for (const s of sessions) {
        const dl = deadlineOf(s);
        if (!dl || !s.date || s.date < today) continue;
        if (kstDate(1) !== dl) continue;                       // 내일이 마감일
        if (!st.sent.includes('dl-' + (s.id || s.date))) {
          const att = await j(await rest(`attendance?select=member_id,status&session_id=eq.${encodeURIComponent(s.id)}`)) || [];
          const done = new Set(att.filter(a => a.status === 'yes' || a.status === 'no').map(a => a.member_id));
          const need = activeFor(players, monthOf(s.date), thisMonth).filter(p => !done.has(p.id)).map(p => p.id);
          if (need.length) msgs.push({ ...T('deadline', {'날짜': mdLabel(s.date)}), url: './member.html#att', targets: need });
          st.sent.push('dl-' + (s.id || s.date));
        }
      }
      // ② 투표 시작 (25일)
      if (dom === 25 && once('vote-' + thisMonth)) {
        msgs.push({ cat:'vote', ...T('vote', {}), url: './member.html#potm', targets: idsFor(players, thisMonth, false, thisMonth) });
      }
      // ⑤ 회비 시작 (15일 — 다음 달 회비)
      if (dom === 15 && once('dues-open-' + thisMonth)) {
        const nm = Number(thisMonth.slice(5, 7)) % 12 + 1;
        const dmStart = `${nm === 1 ? Number(thisMonth.slice(0,4))+1 : thisMonth.slice(0,4)}-${String(nm).padStart(2,'0')}`;
        msgs.push({ cat:'dues_open', legacy:'dues', ...T('dues_open', {'월': nm}), url: './member.html#dues', targets: idsFor(players, dmStart, false, thisMonth) });
      }
      // ⑪ 투표 마감 임박 (말일) — 미투표자 타겟
      if (monthOf(kstDate(1)) !== thisMonth && once('vote-close-' + thisMonth)) {   // 내일이 다음 달 = 오늘이 말일
        const vts = await j(await rest(`potm_votes?select=voter_id&month=eq.${thisMonth}`)) || [];
        const votedIds = new Set(vts.map(v => v.voter_id));
        const notVoted = activeFor(players, thisMonth, thisMonth).filter(p => !votedIds.has(p.id)).map(p => p.id);
        if (notVoted.length) msgs.push({ cat:'vote_close', legacy:'vote', ...T('vote_close', {'월': Number(thisMonth.slice(5, 7))}), url: './member.html#potm', targets: notVoted });
      }
      // ⑨ 휴면 멤버 복귀 확인 (15일 — 다음 달 상태 선택이 열리는 날)
      if (dom === 15 && once('dorm-ask-' + thisMonth)) {
        const nm2 = Number(thisMonth.slice(5, 7)) % 12 + 1;
        const dmAsk = `${nm2 === 1 ? Number(thisMonth.slice(0,4))+1 : thisMonth.slice(0,4)}-${String(nm2).padStart(2,'0')}`;
        const dorm = dormantFor(players, dmAsk, thisMonth).map(p => p.id);
        if (dorm.length) msgs.push({ ...T('dorm_ask', {'월': nm2}), url: './member.html#home', targets: dorm });
      }
      // ⑩ 투표 선정 축하 (매월 1일 — 전월 결과 확정)
      if (dom === 1 && once('winner-' + thisMonth)) {
        const pd = new Date(Date.now() + 9 * 3600e3); pd.setUTCDate(0);   // 전월 말일
        const pm = pd.toISOString().slice(0, 7);
        const votes = await j(await rest(`potm_votes?select=category,candidate_id,voter_id&month=eq.${pm}`)) || [];
        const CATS = [['mvp', '이달의 선수'], ['growth', '가장 성장한 선수']];
        for (const [cat, catLbl] of CATS) {
          const tally = {};
          votes.filter(v => v.category === cat).forEach(v => { tally[v.candidate_id] = (tally[v.candidate_id] || 0) + 1; });
          const max = Math.max(0, ...Object.values(tally));
          if (max < 1) continue;
          const winners = Object.keys(tally).filter(k => tally[k] === max).map(Number);   // 동률 공동 수상
          msgs.push({ ...T('winner', {'월': Number(pm.slice(5, 7)), '부문': catLbl}), url: './member.html#potm', targets: winners });
        }
        // 투표 종료 → 투표한 사람 전원에게 결과 공개 알림
        const voters = [...new Set(votes.map(v => v.voter_id).filter(x => x != null))];
        if (voters.length) msgs.push({ ...T('results_open', {'월': Number(pm.slice(5, 7))}), url: './member.html#potm', targets: voters });
      }
      // ⑥ 회비 마감(25일) 하루 전 — 미납만 타겟
      if (dom === 24 && once('dues-urge-' + thisMonth)) {
        let uy = Number(thisMonth.slice(0,4)), umo = Number(thisMonth.slice(5,7)) + 1; if (umo > 12) { umo = 1; uy++; }
        const dm = `${uy}-${String(umo).padStart(2,'0')}`;
        const dues = await j(await rest(`dues?select=member_id,paid&month=eq.${dm}`)) || [];
        const paid = new Set(dues.filter(d => d.paid).map(d => d.member_id));
        const capOnDm = dm >= CAP_START;
        const conf = capOnDm ? await capConfirmFor(dm) : {};
        // 활동 회원: (정원제) 미확인 또는 미납 / (이전) 미납만. 복귀 신청자: 미납이면 포함
        const need = activeFor(players, dm, thisMonth).filter(p => {
          const c = conf[String(p.id)];
          return capOnDm ? (!(c && c.s === 'active') || !paid.has(p.id)) : !paid.has(p.id);
        }).map(p => p.id);
        const extra = capOnDm ? players.filter(p => {
          const st = p.status || 'active';
          if (st === 'former' || st === 'friends') return false;
          const c = conf[String(p.id)];
          return c && c.s === 'active' && !paid.has(p.id) && isDormantLike(p, thisMonth, thisMonth);
        }).map(p => p.id) : [];
        const urgeTo = [...new Set([...need, ...extra])];
        if (urgeTo.length) msgs.push({ cat:'dues_urge', legacy:'dues', ...T('dues_urge', {'월': Number(dm.slice(5, 7))}), url: './member.html#dues', targets: urgeTo });
      }
    }
    st.noticeIds = st.noticeIds.slice(-100); st.rideIds = st.rideIds.slice(-50);
    st.sessionIds = st.sessionIds.slice(-100); st.sent = st.sent.slice(-200);
  }

  if (msgs.length) {
    console.log('메시지', msgs.length, '건');
    const dead = [];
    for (const m of msgs) {
      let tset = m.targets;
      if (tset === 'ACTIVE') tset = activeFor(players, thisMonth, thisMonth).map(p => p.id);
      else if (tset === 'DORMANT') tset = dormantFor(players, thisMonth, thisMonth).map(p => p.id);
      let to = tset ? subs.filter(s => tset.includes(s.member_id)) : subs;
      if (m.cat) to = to.filter(s => { const p = prefFor(s); return !p || (p[m.cat] !== false && (!m.legacy || p[m.legacy] !== false)); });   // 멤버가 끈 항목 제외(옛 카테고리 설정도 존중)
      console.log('-', m.title, '→', m.targets ? `타겟 ${to.length}명` : `전체 ${to.length}명`);
      for (const s of to) {
        try { await webpush.sendNotification(s.data, JSON.stringify({ title: m.title, body: m.body, url: m.url })); }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.endpoint); else console.log('  실패', e.statusCode || e.message); }
      }
    }
    for (const ep of [...new Set(dead)]) await rest(`push_subs?endpoint=eq.${encodeURIComponent(ep)}`, { method: 'DELETE' });
    for (const qid of qIds) await rest(`push_queue?id=eq.${qid}`, { method: 'DELETE' });
    if (dead.length) console.log('만료 구독', new Set(dead).size, '건 정리');
  } else { console.log('보낼 메시지 없음'); for (const qid of qIds) await rest(`push_queue?id=eq.${qid}`, { method: 'DELETE' }); }

  const saveRes = await rest('club_settings', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: 'push_state', data: st, updated_at: new Date().toISOString() }) });
  if (!saveRes.ok) { console.error('push_state 저장 실패 — 다음 실행에서 중복 발송됩니다:', saveRes.status, await saveRes.text()); process.exit(1); }
  console.log('완료');
}
main().catch(e => { console.error(e); process.exit(1); });

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
const rest = (p, o = {}) => fetch(`${SB_URL}/rest/v1/${p}`, { headers: { ...H, ...(o.headers || {}) }, ...o });
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
// 그 달 활동 멤버 (근사: former·friends 제외, 해당 월 휴면 제외, activeMonths 우선)
function activeFor(players, m) {
  return players.filter(p => {
    const st = p.status || 'active';
    if (st === 'former' || st === 'friends') return false;
    if ((p.activeMonths || []).includes(m)) return true;
    if (st === 'dormant') return false;
    return !(p.dormantMonths || []).includes(m);
  });
}

// 그 달 활동 멤버 id 목록 (allowAll=true면 휴면 포함 전체)
function idsFor(players, m, allowAll) {
  if (allowAll) return null;   // null = 전체 발송
  return activeFor(players, m).map(p => p.id);
}

async function main() {
  const subs = await j(await rest('push_subs?select=endpoint,data,member_id'));
  if (!Array.isArray(subs) || !subs.length) { console.log('구독자 없음 — 종료'); return; }

  const stRow = await j(await rest('club_settings?select=data&id=eq.push_state'));
  const firstRun = !(stRow && stRow[0] && stRow[0].data);   // 최초 실행: 기존 콘텐츠는 기록만 하고 알리지 않음
  const st = Object.assign({ noticeIds: [], rideIds: [], sessionIds: [], sent: [] }, (stRow && stRow[0] && stRow[0].data) || {});
  const once = k => st.sent.includes(k) ? false : (st.sent.push(k), true);

  const curRow = await j(await rest('club_settings?select=data&id=eq.current'));
  const cur = (curRow && curRow[0] && curRow[0].data) || {};
  const sessions = cur.sessions || [];
  const tbRow = await j(await rest('club_settings?select=data&id=eq.teambuilder'));
  const players = ((tbRow && tbRow[0] && tbRow[0].data) || {}).players || [];

  const today = kstDate(0), hour = kstHour();
  const evening = hour >= 18 && hour < 21;      // 날짜 기반 알림은 저녁 6~9시 1회
  const dom = Number(today.slice(8, 10));
  const thisMonth = monthOf(today);
  const msgs = [];   // { title, body, url, targets?: [memberId] }  targets 없으면 전체

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
      msgs.push({ title: '📣 새 공지', body: n.title, url: './member.html#home' });
    }
    // ③ 새 카풀 (다가오는 것만)
    const rides = await j(await rest('rides?select=id,driver,place,dest,ride_date,ride_time,created_at&order=created_at.desc&limit=10')) || [];
    for (const r of rides) {
      if (st.rideIds.includes(String(r.id))) continue;
      if (new Date(r.created_at) < new Date(Date.now() - 48 * 3600e3)) { st.rideIds.push(String(r.id)); continue; }
      st.rideIds.push(String(r.id));
      if (firstRun) continue;
      if (r.ride_date && r.ride_date < today) continue;
      msgs.push({ title: '🚗 새 카풀', body: `${r.driver}님 · ${mdLabel(r.ride_date)} ${r.ride_time || ''} ${r.place} → ${r.dest || ''}`, url: './member.html#list', targets: idsFor(players, monthOf(r.ride_date || today), false) });
    }
    // ④ 새 세션 일정 (지난 세션 제외)
    for (const s of sessions) {
      const sid = String(s.id || s.date);
      if (st.sessionIds.includes(sid)) continue;
      st.sessionIds.push(sid);
      if (firstRun) continue;
      if (!s.date || s.date < today) continue;
      msgs.push({ title: '📅 새 세션 일정', body: `${mdLabel(s.date)} ${s.time || ''} ${s.place || ''} — 참석 체크해 주세요`, url: './member.html#att', targets: idsFor(players, monthOf(s.date), s.allowDormant) });
    }
    if (evening) {
      // ⑧ 내일 세션 리마인드 (전체)
      for (const s of sessions) {
        if (s.date !== kstDate(1)) continue;
        if (!once('rem-' + (s.id || s.date))) continue;
        msgs.push({ title: '⚽ 내일 세션', body: `${mdLabel(s.date)} ${s.time || ''} ${s.place || ''} — 내일이에요!`, url: './member.html#att', targets: idsFor(players, monthOf(s.date), s.allowDormant) });
      }
      // ① 마감 하루 전 — 미응답·미정만 타겟
      for (const s of sessions) {
        const dl = deadlineOf(s);
        if (!dl || !s.date || s.date < today) continue;
        if (kstDate(1) !== dl) continue;                       // 내일이 마감일
        if (!st.sent.includes('dl-' + (s.id || s.date))) {
          const att = await j(await rest(`attendance?select=member_id,status&session_id=eq.${encodeURIComponent(s.id)}`)) || [];
          const done = new Set(att.filter(a => a.status === 'yes' || a.status === 'no').map(a => a.member_id));
          const need = activeFor(players, monthOf(s.date)).filter(p => !done.has(p.id)).map(p => p.id);
          if (need.length) msgs.push({ title: '⏰ 참석 마감 임박', body: `${mdLabel(s.date)} 세션 참석 응답이 내일 마감돼요. 참석/불참을 정해 주세요!`, url: './member.html#att', targets: need });
          st.sent.push('dl-' + (s.id || s.date));
        }
      }
      // ② 투표 시작 (25일)
      if (dom === 25 && once('vote-' + thisMonth)) {
        msgs.push({ title: '🗳️ 이달의 선수 투표 시작', body: '이번 달 MVP와 성장상을 뽑아 주세요!', url: './member.html#potm', targets: idsFor(players, thisMonth, false) });
      }
      // ⑤ 회비 시작 (15일 — 다음 달 회비)
      if (dom === 15 && once('dues-open-' + thisMonth)) {
        const nm = Number(thisMonth.slice(5, 7)) % 12 + 1;
        const dmStart = `${nm === 1 ? Number(thisMonth.slice(0,4))+1 : thisMonth.slice(0,4)}-${String(nm).padStart(2,'0')}`;
        msgs.push({ title: '💰 회비 안내', body: `${nm}월 회비 납부가 시작됐어요. 25일까지 입금 부탁드려요!`, url: './member.html#dues', targets: idsFor(players, dmStart, false) });
      }
      // ⑥ 회비 마감(25일) 하루 전 — 미납만 타겟
      if (dom === 24 && once('dues-urge-' + thisMonth)) {
        const dm = dom >= 15 ? `${thisMonth.slice(0, 4)}-${String(Number(thisMonth.slice(5, 7)) % 12 + 1).padStart(2, '0')}` : thisMonth;
        const dues = await j(await rest(`dues?select=member_id,paid&month=eq.${dm}`)) || [];
        const paid = new Set(dues.filter(d => d.paid).map(d => d.member_id));
        const unpaid = activeFor(players, dm).filter(p => !paid.has(p.id)).map(p => p.id);
        if (unpaid.length) msgs.push({ title: '💸 회비 마감 임박', body: `${Number(dm.slice(5, 7))}월 회비가 내일(25일) 마감돼요. 아직 미납 상태예요!`, url: './member.html#dues', targets: unpaid });
      }
    }
    st.noticeIds = st.noticeIds.slice(-100); st.rideIds = st.rideIds.slice(-50);
    st.sessionIds = st.sessionIds.slice(-100); st.sent = st.sent.slice(-200);
  }

  if (msgs.length) {
    console.log('메시지', msgs.length, '건');
    const dead = [];
    for (const m of msgs) {
      const to = m.targets ? subs.filter(s => m.targets.includes(s.member_id)) : subs;
      console.log('-', m.title, '→', m.targets ? `타겟 ${to.length}명` : `전체 ${to.length}명`);
      for (const s of to) {
        try { await webpush.sendNotification(s.data, JSON.stringify({ title: m.title, body: m.body, url: m.url })); }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.endpoint); else console.log('  실패', e.statusCode || e.message); }
      }
    }
    for (const ep of [...new Set(dead)]) await rest(`push_subs?endpoint=eq.${encodeURIComponent(ep)}`, { method: 'DELETE' });
    if (dead.length) console.log('만료 구독', new Set(dead).size, '건 정리');
  } else console.log('보낼 메시지 없음');

  await rest('club_settings', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: 'push_state', data: st, updated_at: new Date().toISOString() }) });
  console.log('완료');
}
main().catch(e => { console.error(e); process.exit(1); });

# 🗄️ 싸커피 Supabase 전체 설정 (한 번에)

사이트(카풀·투표·공지·참석·회비·명단)와 팀빌더 클라우드 동기화에 필요한
**모든 테이블을 한 번에** 만듭니다. **재실행해도 안전**하게 작성돼 있어요.

## 방법
Supabase 대시보드 → 좌측 **SQL Editor** → **New query** → 아래 전체 붙여넣기 → **Run**.

> ⚠️ 아래는 `attendance`·`potm_votes`를 **다시 만듭니다(drop)**. 아직 투표·참석을 시작 전이라 안전합니다.
> `rides`(카풀)·`club_settings`(명단/팀빌더)·`notices`·`dues`는 **데이터를 보존**합니다(drop 안 함).

```sql
-- ===== 싸커피 Supabase 전체 설정 (재실행 안전) =====

-- 1) 카풀
create table if not exists public.rides (
  id bigint primary key generated always as identity,
  driver text not null, place text not null,
  ride_date date, ride_time text, seats int not null,
  dest text, riders jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);
alter table public.rides enable row level security;
drop policy if exists "rides all" on public.rides;
create policy "rides all" on public.rides for all using (true) with check (true);

-- 2) 투표 (이달의 선수 / 가장 성장한 선수) — 부문별 1인 1표
drop table if exists public.potm_votes;
create table public.potm_votes (
  id bigint primary key generated always as identity,
  month text not null,
  category text not null default 'mvp',        -- 'mvp' | 'growth'
  voter_id bigint not null, candidate_id bigint not null,   -- bigint: 신규 회원 id(Date.now) 수용
  created_at timestamptz not null default now(),
  unique (month, category, voter_id)
);
alter table public.potm_votes enable row level security;
create policy "potm read"   on public.potm_votes for select using (true);
create policy "potm insert" on public.potm_votes for insert with check (true);
create policy "potm delete" on public.potm_votes for delete using (true);

-- 3) 공지
create table if not exists public.notices (
  id bigint primary key generated always as identity,
  title text not null, body text,
  pinned boolean not null default false,
  publish_at timestamptz,                       -- 노출 시작(비우면 즉시)
  hide_at timestamptz,                          -- 노출 종료(비우면 무기한)
  link text,                                    -- 클릭 시 이동(외부 URL 또는 'tab:potm' 등 내부 탭)
  created_at timestamptz not null default now()
);
-- 기존에 notices 테이블이 이미 있으면 컬럼만 추가(재실행 안전):
alter table public.notices add column if not exists publish_at timestamptz;
alter table public.notices add column if not exists hide_at timestamptz;
alter table public.notices add column if not exists link text;
alter table public.notices enable row level security;
drop policy if exists "notices read"   on public.notices;
drop policy if exists "notices insert" on public.notices;
drop policy if exists "notices update" on public.notices;
drop policy if exists "notices delete" on public.notices;
create policy "notices read"   on public.notices for select using (true);
create policy "notices insert" on public.notices for insert with check (true);
create policy "notices update" on public.notices for update using (true);
create policy "notices delete" on public.notices for delete using (true);

-- 4) 참석 (세션별)
drop table if exists public.attendance;
create table public.attendance (
  id bigint primary key generated always as identity,
  session_id text not null, member_id bigint not null,   -- bigint: 신규 회원 id(Date.now) 수용
  status text not null,                         -- 'yes' | 'no' | 'maybe'
  updated_at timestamptz not null default now(),
  unique (session_id, member_id)
);
alter table public.attendance enable row level security;
create policy "att read"   on public.attendance for select using (true);
create policy "att insert" on public.attendance for insert with check (true);
create policy "att update" on public.attendance for update using (true);
create policy "att delete" on public.attendance for delete using (true);

-- 5) 회비 (월별 납부 현황)
create table if not exists public.dues (
  id bigint primary key generated always as identity,
  month text not null, member_id bigint not null,   -- bigint: 신규 회원 id(Date.now) 수용
  paid boolean not null default false, amount int,
  updated_at timestamptz not null default now(),
  unique (month, member_id)
);
alter table public.dues enable row level security;
drop policy if exists "dues read"   on public.dues;
drop policy if exists "dues insert" on public.dues;
drop policy if exists "dues update" on public.dues;
create policy "dues read"   on public.dues for select using (true);
create policy "dues insert" on public.dues for insert with check (true);
create policy "dues update" on public.dues for update using (true);

-- 5-1) 기존 테이블이 int로 만들어졌다면 bigint로 변환(신규 회원 id=Date.now 수용). 재실행 안전.
alter table public.dues       alter column member_id    type bigint;
alter table public.attendance alter column member_id    type bigint;
alter table public.potm_votes alter column voter_id     type bigint;
alter table public.potm_votes alter column candidate_id type bigint;

-- 6) 클럽 설정 + 명단 + 팀빌더 상태 (jsonb 보관함)
--    id='current'  → 사이트 설정/명단(roster)/세션/팀구분
--    id='teambuilder' → 팀빌더 전체 데이터(클라우드 동기화)
create table if not exists public.club_settings (
  id text primary key,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.club_settings enable row level security;
drop policy if exists "settings read"   on public.club_settings;
drop policy if exists "settings insert" on public.club_settings;
drop policy if exists "settings update" on public.club_settings;
create policy "settings read"   on public.club_settings for select using (true);
create policy "settings insert" on public.club_settings for insert with check (true);
create policy "settings update" on public.club_settings for update using (true);
```

"Success. No rows returned" 이 나오면 정상이에요.

## (선택) 실시간 자동 반영
다른 사람의 변경이 새로고침 없이 반영되게 하려면:
Database → **Replication** → `rides`, `potm_votes`, `notices`, `attendance`, `dues`, `club_settings` 를 publication에 추가.

## bell_reads — 알림함 읽음 상태(멤버 기준, 2026-07 추가)
멤버앱 상단 종 알림함의 읽음 표시를 기기(localStorage)만이 아니라 멤버 계정 기준으로 유지합니다.

```sql
create table if not exists bell_reads (
  member_id bigint primary key,
  ids jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);
alter table bell_reads enable row level security;
create policy "bell_reads_open" on bell_reads for all using (true) with check (true);
```

## cap_confirm — 활동 정원제 자리 확인 (2026-07-29 추가) ⚠️ 9월 정원제 시작 전 필수

정원제(2026-09분부터)의 **"다음 달 활동/휴면" 확인**을 멤버별 행으로 저장합니다.
원래 `club_settings.current.capacity.confirm` 안에 넣었는데, 그 저장 경로가 최상위 키를 통째로
바꾸는 방식이라 **15일 알림 직후 여러 명이 동시에 누르면 남의 신청이 조용히 사라졌습니다**
(그리고 26일 롤오버에서 미확인=자동 휴면 처리). 멤버별 행이면 서로 덮을 수 없습니다.

`at`(선착순 기준 시각)은 **서버 시각**이고, 같은 상태를 다시 눌러도 트리거가 유지합니다
— 상태가 실제로 바뀔 때만 새로 찍힙니다(기기 시계가 틀려도 순번이 공정).

```sql
create table if not exists public.cap_confirm (
  month      text        not null,               -- 'YYYY-MM' (신청 대상 달)
  member_id  bigint      not null,
  state      text        not null check (state in ('active','dormant')),
  at         timestamptz not null default now(), -- 선착순 기준(상태 변경 시에만 갱신)
  updated_at timestamptz not null default now(),
  primary key (month, member_id)
);

-- 상태가 바뀔 때만 at 갱신(같은 상태 재클릭·클라이언트가 at을 보내도 순번 보존)
create or replace function public.cap_confirm_touch() returns trigger language plpgsql as $$
begin
  if new.state is distinct from old.state then new.at = now(); else new.at = old.at; end if;
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists trg_cap_confirm_touch on public.cap_confirm;
create trigger trg_cap_confirm_touch before update on public.cap_confirm
  for each row execute function public.cap_confirm_touch();

alter table public.cap_confirm enable row level security;
drop policy if exists "cap_confirm all" on public.cap_confirm;
create policy "cap_confirm all" on public.cap_confirm for all using (true) with check (true);
```

확정 결과(`result`: 26일 잠정 · 5일 최종)는 발송기만 쓰므로 `club_settings.current.capacity`에 그대로 둡니다.

## 보안 참고
모든 정책이 "익명 키로 누구나 읽기/쓰기"(링크 기반 신뢰 그룹용)입니다.
회비·명단 등 민감 데이터를 더 엄격히 막으려면 정책을 손봐야 합니다(필요 시 도와드림).
키는 공개용 anon(publishable) 키만 사용 — `service_role` 키는 절대 페이지에 넣지 마세요.

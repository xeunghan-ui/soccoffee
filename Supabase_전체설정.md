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
  voter_id int not null, candidate_id int not null,
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
  publish_at timestamptz,                       -- 공개 예약(비우면 즉시 공개)
  created_at timestamptz not null default now()
);
-- 기존에 notices 테이블이 이미 있으면 컬럼만 추가(재실행 안전):
alter table public.notices add column if not exists publish_at timestamptz;
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
  session_id text not null, member_id int not null,
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
  month text not null, member_id int not null,
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

## 보안 참고
모든 정책이 "익명 키로 누구나 읽기/쓰기"(링크 기반 신뢰 그룹용)입니다.
회비·명단 등 민감 데이터를 더 엄격히 막으려면 정책을 손봐야 합니다(필요 시 도와드림).
키는 공개용 anon(publishable) 키만 사용 — `service_role` 키는 절대 페이지에 넣지 마세요.

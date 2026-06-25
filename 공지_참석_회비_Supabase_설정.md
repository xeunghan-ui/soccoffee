# 📢 공지 · ✅ 참석 · 💰 회비 — Supabase 설정 안내

새로 추가된 **공지 / 참석 / 회비 / 세션설정** 기능이 여러 사람에게 공유되려면
Supabase에 테이블 4개를 한 번만 만들어 주면 됩니다.
(테이블을 안 만들면 데모 모드처럼 각자 브라우저에만 저장돼요. 페이지는 깨지지 않아요.)

> 기존 카풀(`rides`)·MVP(`potm_votes`)와 **같은 프로젝트**에 만들면 됩니다.
> 키는 이미 `index.html`에 들어가 있어서, 아래 SQL만 실행하면 끝이에요.

## 한 번에 만들기

Supabase 대시보드 → 좌측 **SQL Editor** → **New query** → 아래 전체를 붙여넣고 **Run**.

> 아래 SQL은 **몇 번을 다시 실행해도 안전**해요(`drop policy if exists`로 중복 방지).
> 한 번 만들다 만 상태여도 그냥 다시 돌리면 됩니다.

```sql
-- ① 공지사항
create table if not exists public.notices (
  id         bigint generated always as identity primary key,
  title      text        not null,
  body       text,
  pinned     boolean     not null default false,
  created_at timestamptz not null default now()
);
alter table public.notices enable row level security;
drop policy if exists "notices read"   on public.notices;
drop policy if exists "notices insert" on public.notices;
drop policy if exists "notices update" on public.notices;
drop policy if exists "notices delete" on public.notices;
create policy "notices read"   on public.notices for select using (true);
create policy "notices insert" on public.notices for insert with check (true);
create policy "notices update" on public.notices for update using (true);
create policy "notices delete" on public.notices for delete using (true);

-- ② 참석 (세션별 참석/불참/미정, 1인 1행)
-- ※ 세션을 여러 개 등록할 수 있어, '날짜'가 아니라 '세션 ID(text)' 기준입니다.
--   (세션 목록 자체는 아래 ④ club_settings 안에 저장돼요 — 별도 테이블 불필요)
--   예전에 session_date로 만든 적이 있으면 아래 drop 한 줄이 지우고 새로 만듭니다.
--   (참석은 7/1부터라 아직 데이터 없음 — 안전합니다)
drop table if exists public.attendance;
create table if not exists public.attendance (
  id          bigint generated always as identity primary key,
  session_id  text        not null,   -- 세션 식별자
  member_id   int         not null,
  status      text        not null,   -- 'yes' | 'no' | 'maybe'
  updated_at  timestamptz not null default now(),
  unique (session_id, member_id)
);
alter table public.attendance enable row level security;
drop policy if exists "att read"   on public.attendance;
drop policy if exists "att insert" on public.attendance;
drop policy if exists "att update" on public.attendance;
drop policy if exists "att delete" on public.attendance;
create policy "att read"   on public.attendance for select using (true);
create policy "att insert" on public.attendance for insert with check (true);
create policy "att update" on public.attendance for update using (true);
create policy "att delete" on public.attendance for delete using (true);

-- ③ 회비 (월별 납부 현황, 1인 1행)
create table if not exists public.dues (
  id         bigint generated always as identity primary key,
  month      text        not null,     -- '2026-06'
  member_id  int         not null,
  paid       boolean     not null default false,
  amount     int,
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

-- ④ 클럽 설정 (이번 세션 날짜/시간/장소 등 — jsonb 1행)
create table if not exists public.club_settings (
  id         text        primary key,
  data       jsonb       not null default '{}',
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

## 실시간 갱신 켜기 (선택)

다른 사람의 공지·참석·회비 변경이 자동 반영되게 하려면:
Database → **Replication** → `notices`, `attendance`, `dues`, `club_settings` 를 publication에 추가.
(`rides`가 이미 켜져 있으면 같은 방법이에요.)

---

## 동작 방식 요약

### 📢 공지 (홈 탭)
- 상단 **다음 세션 카드**(날짜·장소·참석 인원) + **공지 목록**(고정 공지 우선) + **팀빌더/점수표 바로가기**
- 공지 작성·고정·삭제는 **운영진만** (🛠 운영진 탭)

### ✅ 참석
- 본인 이름 선택 → **참석 / 불참 / 미정** 한 번 누르면 저장(언제든 변경 가능)
- 참석/미정/불참 집계 + 전체 명단 현황을 실시간으로 봄 → 카톡 "참석자 손취합" 대체
- 대상 = 이번 달 활동 회원, 세션 날짜는 운영진이 설정(기본: 다가오는 수요일)

### 💰 회비 (이번 달 현황판)
- 이번 달 **납부/미납 현황**을 한눈에 (걷힌 금액 / 예상 금액 / 납부율)
- 인별 회비액은 장부 기준(대부분 3만 원, 일부 1만 원) 자동 반영
- **납부 처리는 운영진만** (이름 옆 배지 클릭). 팀원은 조회만
- ⚠️ 이 현황판은 "이번 달 누가 냈나"를 빠르게 보는 용도이고,
  정식 회계 원장은 기존 엑셀/결산 PDF가 source of truth예요

### 🛠 운영진 (관리자 모드에서만 노출)
- 공지 작성/고정/삭제, 다음 세션 설정, 회비 현황판 열기, MVP 투표 결과/초기화를 한곳에
- 진입: 하단 **🔧 운영진 모드** → 비밀번호 `soccoffee1234`
- 팀원에게는 운영진 탭이 보이지 않음

---

## 🔐 보안에 대한 솔직한 참고 (회비 관련 — 꼭 읽어보세요)

현재 정책은 카풀과 동일하게 **"링크를 아는 사람은 누구나 읽고/쓸 수 있음"** 입니다.
운영진 모드(비밀번호)는 **화면(UI)에서만** 막는 것이라, 개발자 도구를 다룰 줄 아는 사람은
이론상 anon 키로 직접 회비/참석 데이터를 고칠 수 있어요.

- 신뢰할 수 있는 동호회 내부용으로는 충분합니다.
- 하지만 **돈(회비)** 데이터라 더 엄격히 하려면, 나중에 다음 중 하나를 검토하세요:
  1. `dues` 테이블의 insert/update 정책을 제거하고 **수정은 Supabase 대시보드/운영진 계정에서만**
  2. Supabase Auth(로그인) 도입 후 운영진 역할에게만 쓰기 권한 부여
- 지금은 "빠르게 쓰기 시작" 우선으로 열려 있는 상태이며, 필요하면 정책 강화를 도와드릴게요.

> 명단/팀이 바뀌면 기존과 동일하게 `index.html`의 `ROSTER` / `TEAM_SHEET`만 고치면 됩니다.
> 인별 회비액이 다르면 `index.html`의 `DUES_DEFAULT`(기본 3만 원, 예외만 기재)에서 조정하세요.

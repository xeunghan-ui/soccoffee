# 오틀리 모집 폼 — Supabase 설정

`/oatly/2026_2nd/signup/` (제2회) 참가 신청 폼이 저장하는 테이블. **아래 SQL을 Supabase 대시보드 → SQL Editor에서 한 번 실행**하면 됩니다. (재실행 안전)

```sql
-- 오틀리 풋살 챔피언십 참가 신청 저장 테이블
create table if not exists public.oatly_signups (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('individual','team')),
  name       text not null,      -- 개인=본인 / 팀=대표(주장)
  gender     text,               -- 개인만
  phone      text not null,
  cafe       text,               -- 소속 카페 / 팀 카페
  team_name  text,               -- 팀 신청 시 팀명(카페와 동일 저장)
  headcount  int,                -- 팀 예상 인원
  members    text,               -- 팀원 명단(자유 텍스트)
  position   text,               -- 개인 포지션(선택)
  note       text,
  created_at timestamptz not null default now()
);

-- RLS: 익명 키로 '신청(INSERT)'만 허용.
-- 조회(SELECT)는 열지 않음 → 신청자 전화번호는 대시보드/서비스롤로만 확인(개인정보 보호).
alter table public.oatly_signups enable row level security;

drop policy if exists "oatly_signups anon insert" on public.oatly_signups;
create policy "oatly_signups anon insert"
  on public.oatly_signups for insert to anon with check (true);
```

## 확인 방법
- 신청 내역은 Supabase 대시보드 **Table editor → `oatly_signups`** 에서 확인.
- `kind`: `individual`(개인) / `team`(카페 팀).

## 참고
- 이 폼은 `join_requests`(가입 신청)와 동일한 패턴 — 익명 키로 INSERT만 가능하고, 다른 사람의 신청 내역을 읽을 수는 없습니다.
- 멤버 앱/운영진 화면에서 신청 목록을 직접 읽고 싶으면 별도의 SELECT 정책이 필요합니다(요청 시 추가). 전화번호가 포함되니 신중히.

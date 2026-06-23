# 🏆 이달의 선수 투표 — Supabase 설정 안내

투표가 **여러 사람 간에 공유**되려면 Supabase에 투표 저장 테이블을 한 번만 만들어 주면 됩니다.
(테이블을 안 만들면 데모 모드처럼 각자 브라우저에만 저장돼요.)

## 1) 테이블 + 정책 만들기

Supabase 대시보드 → 좌측 **SQL Editor** → 아래를 붙여넣고 **Run**.

```sql
-- 이달의 선수 투표 테이블
create table if not exists public.potm_votes (
  id           bigint generated always as identity primary key,
  month        text        not null,   -- 예: '2026-06'
  voter_id     int         not null,   -- 투표한 사람(명단 id)
  candidate_id int         not null,   -- 뽑힌 사람(명단 id)
  created_at   timestamptz not null default now(),
  unique (month, voter_id)             -- ★ 1인 1표(엄격) 보장
);

-- RLS 활성화
alter table public.potm_votes enable row level security;

-- 익명(anon) 키로 읽기/투표/관리자 초기화 허용 (카풀 rides 테이블과 동일한 패턴)
create policy "potm read"   on public.potm_votes for select using (true);
create policy "potm insert" on public.potm_votes for insert with check (true);
create policy "potm delete" on public.potm_votes for delete using (true);
```

## 2) 실시간 갱신 켜기 (선택)

다른 사람 투표가 자동 반영되게 하려면:
Database → **Replication** → `potm_votes` 테이블을 **publication에 추가**.
(카풀 `rides`가 이미 켜져 있으면 같은 방법이에요.)

## 끝. 동작 방식 요약

- **후보 = 이번 달 활동 회원 36명** (휴면·친구등급 제외, WHITE/BLACK 팀 시트 기준)
- **본인 이름 선택 → 1인 1표** (`unique(month, voter_id)`가 중복 차단)
- **본인은 후보에서 제외** (자기 투표 금지)
- **결과는 본인이 투표한 뒤에만** 열람 (관리자는 항상 열람 + 초기화 가능)
- 달이 바뀌면 `month` 값이 자동으로 바뀌어 **새 투표**가 시작돼요

## 명단/팀이 바뀌면

`index.html` 안의 두 곳만 고치면 됩니다.

- `const ROSTER = [...]` : 가입일·휴면월 등 회원 기본 정보
- `const TEAM_SHEET = {...}` : 이번 달 WHITE/BLACK 등번호·영문명·주장(C)

> 참고: 이 명단은 soccoffee-team-builder의 선수 데이터를 그대로 옮긴 **스냅샷**입니다.
> team-builder에서 명단이 바뀌면 위 두 곳을 같이 갱신해 주세요.

---

# 📊 오틀리 × 싸커피 리그 점수표 — Supabase 설정

점수표도 여러 사람이 같은 결과를 보려면 테이블 1개를 만들면 됩니다.
(안 만들면 데모처럼 각자 브라우저에만 저장돼요.)

## 테이블 + 정책 만들기

SQL Editor에 붙여넣고 **Run**.

```sql
-- 이벤트 리그 상태(팀/경기/토너먼트)를 jsonb 1행으로 저장
create table if not exists public.event_league (
  id         text        primary key,
  data       jsonb       not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.event_league enable row level security;

create policy "league read"   on public.event_league for select using (true);
create policy "league insert" on public.event_league for insert with check (true);
create policy "league update" on public.event_league for update using (true);
```

실시간 반영을 원하면 Database → Replication에서 `event_league`를 publication에 추가하세요.

## 동작 방식 요약

- **점수표 탭** = 리그 순위표(승 3·무 1·패 0, 순위: 승점→골득실→다득점) + 토너먼트/이벤트 매치
- **점수 입력은 관리자만** (🔧 관리자 모드 → `soccoffee1234`). 팀 이름·경기 점수·토너먼트 매치를 입력 후 **저장하기**
- 일반 사용자는 결과만 열람
- 리그 4팀·경기 구성은 `index.html`의 `defaultLeague()`에서 수정 가능
  - 기본 팀: 알레그리아 / 펠트 / 보난자 / 위커피 & 샌드스톤 연합
  - 토너먼트: 결승전 · 3·4위전 · 이벤트 매치(카페 연합 vs 싸커피) — 점수 공란으로 시작

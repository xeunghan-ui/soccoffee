# CLAUDE.md — 싸커피(SOCCOFFEE FC) 작업 지침

풋살 동호회 "싸커피"의 정적 웹사이트 + 운영 도구. 이 파일은 이 저장소에서 작업할 때의 규칙이다. 더 자세한 배경은 `인수인계.md` 참고.

## 작업 규칙 (중요)
- **수정하면 묻지 말고 바로 커밋한다.** "커밋할까요?" 확인하지 말 것. 변경 → 검증 → `git commit`까지 한 흐름.
- HTML 인라인 `<script>`는 깨지기 쉬우니, 커밋 전 **`node --check`로 문법 검증**한다(스크립트만 추출해 검사).
- **⚠️ `git add -A` 금지 — 변경한 파일만 명시적으로 add 한다.** (과거 `git add -A`가 팀빌더로 덮인 루트 `index.html`을 같이 커밋해 소개 페이지가 날아간 사고 있음.)
- **루트 `index.html` 커밋 전 반드시 확인**: 첫 부분에 `싸커피 — 소개`가 있어야 함. `Team Builder`/`팀빌더`가 보이면 **커밋 금지**(팀빌더로 덮인 것). 복원: `git show <마지막 소개 커밋>:index.html > index.html`.
- **푸시는 직접 못 한다**(자격증명 없음). 커밋 후 응답 끝에 항상 안내:
  `cd ~/Documents/Claude/Projects/socoffee && git push origin main`
- GitHub Pages는 HTML을 CDN 캐시해서 최신본이 늦게 보인다. 라이브 확인 시 `?v=숫자`로 캐시 우회.

## 구조
- **⚠️ `index.html`이 두 개다(헷갈림 주의):** 루트 `index.html`=소개, `team/index.html`=팀빌더. 정적 호스팅이라 각 폴더가 `index.html`이어야 하므로 이름은 못 바꾼다. **루트는 절대 팀빌더로 덮지 말 것.** 식별: 각 파일 맨 위 주석 + 팀빌더엔 `Soccoffee Team Builder` 메타가 있음.
- `index.html` (루트) = **소개(랜딩)·공개**. 히어로의 "멤버 로그인 →" → `member.html`.
- `member.html` = **멤버 앱**(로그인 후 공지·참석·회비·카풀·투표·랭킹·운영진).
- `team/index.html` = **팀빌더**(운영진 전용, 비번 `soccoffee1234`). 원본은 `~/Documents/Claude/Artifacts/soccoffee-team-builder/index.html` → 수정 후 `team/`으로 복사. **루트 index.html로 복사 금지.**
- `img/` = 소개 갤러리. `.nojekyll`(루트) = Pages 빌드 필수(지우지 말 것).

## 데이터 (Supabase)
- anon(publishable) 키만 클라이언트에 사용. **`service_role` 키 절대 금지.**
- open RLS(누구나 read/write) — casual 보안, 수용 상태. 테이블 SQL: `Supabase_전체설정.md`.
- `club_settings` jsonb: `id='current'`(설정·세션·PIN), `id='teambuilder'`(명단·휴면). 그 외 notices, attendance, dues, potm_votes, rides.

## 핵심 규칙
- **로그인** = 이름 + PIN 4자리(SHA-256 해시 저장, `club_settings.current.pins`). 운영진 = `ADMIN_NAMES=['홍순인','박승한','원재식','최승호','정희범']`.
- **이미지 추가 전 반드시 압축**: PIL로 1920px·quality 82, `exif_transpose`로 회전 보정. (원본 10~20MB 그대로 넣으면 안 됨.)
- **휴면**(월 단위, '2026-07' 형식)은 팀빌더에서 관리 → 사이트의 회비·참석·명단에서 해당 월 자동 제외. 팀빌더는 휴면을 `status:'dormant'`(영구 플래그)로도 저장함.
- **활동 예외(`activeMonths`)**: 영구 휴면(`status:'dormant'`) 회원이 홈 토글로 특정 달을 '활동'으로 되돌릴 수 있게, player에 `activeMonths[]`를 둠. `isDormantFor`/홈 `dormStatus`가 이 달을 최우선으로 '활동' 처리(=status를 안 건드림, 비파괴). 멤버앱(setMyDormancy)이 씀 → **팀빌더(별도 코웤)도 `activeMonths`를 존중해야 함**(참석 확정·표시).
- **세션 참석 규칙**: 세션 객체에 `duesOnly`(그 달 회비 납부자만 참석) · `allowDormant`(휴면도 참석). 미납자는 참석 시 '회비 납부 후 가능' 안내+버튼. 세션 추가/수정 폼에 체크박스.
- **회비**: 매월 15일부터 다음 달 표시(활동/휴면 확인·투표와 동일 기준. `duesMonth()`=`statusMonth()`). 멤버에겐 **걷힌 금액 비공개**(납부/미납 인원 + 미납 명단만).
- **참석 마감** = 매치일 직전 일요일. 마감 후 일반 멤버 차단, 운영진은 예외(변경 가능 + 다른 멤버 상태도 변경 가능).

## 안 하는 것
- 데이터 백업 기능은 일부러 뺀 상태(복구 안전망 없음 — 위험 낮다고 판단).
- RLS 강화/서버측 인증은 큰 작업이라 요청 시에만.

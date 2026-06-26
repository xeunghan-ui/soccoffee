# CLAUDE.md — 싸커피(SOCCOFFEE FC) 작업 지침

풋살 동호회 "싸커피"의 정적 웹사이트 + 운영 도구. 이 파일은 이 저장소에서 작업할 때의 규칙이다. 더 자세한 배경은 `인수인계.md` 참고.

## 작업 규칙 (중요)
- **수정하면 묻지 말고 바로 커밋한다.** "커밋할까요?" 확인하지 말 것. 변경 → 검증 → `git commit`까지 한 흐름.
- HTML 인라인 `<script>`는 깨지기 쉬우니, 커밋 전 **`node --check`로 문법 검증**한다(스크립트만 추출해 검사).
- **푸시는 직접 못 한다**(자격증명 없음). 커밋 후 응답 끝에 항상 안내:
  `cd ~/Documents/Claude/Projects/socoffee && git push origin main`
- GitHub Pages는 HTML을 CDN 캐시해서 최신본이 늦게 보인다. 라이브 확인 시 `?v=숫자`로 캐시 우회.

## 구조
- `index.html` = **소개(랜딩)·공개**. 히어로의 "멤버 로그인 →" → `member.html`.
- `member.html` = **멤버 앱**(로그인 후 공지·참석·회비·카풀·투표·랭킹·운영진).
- `team/index.html` = **팀빌더**(운영진 전용, 비번 `soccoffee1234`). 원본은 `~/Documents/Claude/Artifacts/soccoffee-team-builder/index.html` → 수정 후 `team/`으로 복사.
- `img/` = 소개 갤러리. `.nojekyll`(루트) = Pages 빌드 필수(지우지 말 것).

## 데이터 (Supabase)
- anon(publishable) 키만 클라이언트에 사용. **`service_role` 키 절대 금지.**
- open RLS(누구나 read/write) — casual 보안, 수용 상태. 테이블 SQL: `Supabase_전체설정.md`.
- `club_settings` jsonb: `id='current'`(설정·세션·PIN), `id='teambuilder'`(명단·휴면). 그 외 notices, attendance, dues, potm_votes, rides.

## 핵심 규칙
- **로그인** = 이름 + PIN 4자리(SHA-256 해시 저장, `club_settings.current.pins`). 운영진 = `ADMIN_NAMES=['홍순인','박승한','원재식','최승호','정희범']`.
- **이미지 추가 전 반드시 압축**: PIL로 1920px·quality 82, `exif_transpose`로 회전 보정. (원본 10~20MB 그대로 넣으면 안 됨.)
- **휴면**(월 단위, '2026-07' 형식)은 팀빌더에서 관리 → 사이트의 회비·참석·명단에서 해당 월 자동 제외.
- **회비**: 매월 25일부터 다음 달 표시. 멤버에겐 **걷힌 금액 비공개**(납부/미납 인원 + 미납 명단만).
- **참석 마감** = 매치일 직전 일요일. 마감 후 일반 멤버 차단, 운영진은 예외(변경 가능 + 다른 멤버 상태도 변경 가능).

## 안 하는 것
- 데이터 백업 기능은 일부러 뺀 상태(복구 안전망 없음 — 위험 낮다고 판단).
- RLS 강화/서버측 인증은 큰 작업이라 요청 시에만.

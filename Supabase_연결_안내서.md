# 싸커피 카풀 — Supabase 연결 안내서

코드는 다 작성돼 있어요. 아래 5단계만 따라 하면 실제로 여러 명이 공유하는 카풀 페이지가 됩니다.
**비용 0원 / 신용카드 불필요.** 10분이면 끝나요.

> 키를 넣기 전까지는 페이지가 "데모 모드"(데이터가 내 브라우저에만 저장)로 작동해요. 깨지지 않으니 안심하세요.

---

## 1. Supabase 가입 & 프로젝트 만들기

1. https://supabase.com 접속 → **Start your project** → GitHub나 이메일로 가입
2. **New project** 클릭
3. 입력:
   - **Name**: `socoffee-carpool` (아무거나)
   - **Database Password**: 적당히 만들고 메모해 두기 (나중에 거의 안 씀)
   - **Region**: `Northeast Asia (Seoul)` 또는 `Tokyo` 선택 (한국에서 빠름)
4. **Create new project** → 1~2분 기다리면 생성 완료

---

## 2. 데이터 테이블 만들기

1. 왼쪽 메뉴에서 **SQL Editor** (아이콘: `>_`) 클릭
2. **New query** → 아래 내용을 그대로 붙여넣기 → **Run** (▶) 클릭

```sql
create table rides (
  id bigint primary key generated always as identity,
  driver text not null,
  place text not null,
  ride_date date,
  ride_time text,
  seats int not null,
  dest text,
  riders jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

alter table rides enable row level security;

create policy "allow all (closed link)" on rides
  for all using (true) with check (true);
```

> "Success. No rows returned" 이 나오면 정상이에요.

---

## 3. 키 2개 복사하기

1. 왼쪽 메뉴 맨 아래 **Settings(⚙️)** → **API** 클릭
2. 두 가지를 복사해 둡니다:
   - **Project URL** — 예: `https://abcdxyz.supabase.co`
   - **API Keys → anon / public** — `eyJhbGci...`로 시작하는 긴 문자열

> ⚠️ `service_role` 키는 절대 쓰지 마세요. 반드시 **anon / public** 키만 사용합니다.

---

## 4. 페이지에 키 넣기

`carpool.html` 파일을 텍스트 편집기로 열고, 위쪽 **설정** 부분을 찾아 채워 넣으세요:

```js
const SUPABASE_URL = "https://abcdxyz.supabase.co";   // 복사한 Project URL
const SUPABASE_ANON_KEY = "eyJhbGci....";             // 복사한 anon public 키
```

저장하면 끝. 이제 누가 등록한 카풀이든 모두에게 보이고, 실시간으로 갱신돼요.

---

## 5. 인터넷에 올리기 (링크 공유용)

지금은 내 컴퓨터에서만 열려요. 링크로 공유하려면 무료 호스팅에 올립니다.

**가장 쉬운 방법 — Netlify Drop**
1. https://app.netlify.com/drop 접속
2. `carpool.html`을 창에 끌어다 놓기 (drag & drop)
3. 몇 초 뒤 `https://랜덤이름.netlify.app` 주소가 생성됨 → 이 링크를 공유

> 파일 이름을 `index.html`로 바꿔서 올리면 주소가 더 깔끔해져요.

---

## 솔직한 참고 사항

- **입장 비밀번호**는 `soccoffee`로 설정돼 있어요. 바꾸려면 `carpool.html` 위쪽 설정의 `PAGE_PASSWORD` 한 줄만 수정하면 됩니다. 단, 이 비밀번호는 페이지 소스에 들어있어 "개발자 도구"를 볼 줄 아는 사람은 우회할 수 있어요. 캐주얼한 차단용이지 강한 보안은 아닙니다.
- **anon 키는 페이지에 노출돼요.** 정상입니다(원래 공개용 키). 다만 위 정책은 "아무나 읽고/쓰고/지울 수 있음"이라, 악의적인 사람이 링크를 알면 데이터를 지울 수도 있어요. 사내 신뢰 그룹용으론 충분하지만, 더 엄격히 하려면 정책을 손봐야 합니다.
- **무료 한도**: 카풀 수백 건 + 적은 동시 접속이면 한참 남아요. 한도를 넘기면 멈추거나 유료 전환을 요구하니, 트래픽이 커지면 그때 확인하세요.

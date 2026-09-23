-- 오틀리 신청 수정·삭제 RPC (2026-09-23)
-- 익명 키(anon)는 oatly_signups 를 update/delete 할 수 없다(RLS). 운영진 조회 페이지가 비밀번호를 함께 보내면
-- 아래 함수가 서버에서 다시 해시해 검사한 뒤 security definer 권한으로 실행한다.
-- 비밀번호 해시 = 운영진 페이지 PW_HASH 와 동일(soccoffee1234의 SHA-256). 비밀번호를 바꾸면 두 곳을 같이 바꿀 것.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.oatly_admin_check(p_pass text) returns boolean
language sql immutable as $$
  select encode(extensions.digest(coalesce(p_pass,''), 'sha256'), 'hex')
       = 'b1a7965b1819d360fd33f10022657358f801eec4e08950cf70ea6fbf2968441e';
$$;

create or replace function public.oatly_admin_delete(p_id bigint, p_pass text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.oatly_admin_check(p_pass) then raise exception 'bad password' using errcode = '28000'; end if;
  delete from public.oatly_signups where id = p_id;
end $$;

-- p_patch 에 들어온 키만 갱신한다. 허용 컬럼 밖의 키는 무시.
create or replace function public.oatly_admin_update(p_id bigint, p_pass text, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.oatly_admin_check(p_pass) then raise exception 'bad password' using errcode = '28000'; end if;
  update public.oatly_signups set
    name         = coalesce(p_patch->>'name', name),
    gender       = case when p_patch ? 'gender'       then nullif(p_patch->>'gender','')       else gender end,
    level        = case when p_patch ? 'level'        then nullif(p_patch->>'level','')        else level end,
    position     = case when p_patch ? 'position'     then nullif(p_patch->>'position','')     else position end,
    cafe         = case when p_patch ? 'cafe'         then nullif(p_patch->>'cafe','')         else cafe end,
    phone        = case when p_patch ? 'phone'        then nullif(p_patch->>'phone','')        else phone end,
    team_name    = case when p_patch ? 'team_name'    then nullif(p_patch->>'team_name','')    else team_name end,
    members      = case when p_patch ? 'members'      then nullif(p_patch->>'members','')      else members end,
    note         = case when p_patch ? 'note'         then nullif(p_patch->>'note','')         else note end,
    headcount    = case when p_patch ? 'headcount'    then (p_patch->>'headcount')::int        else headcount end,
    male_count   = case when p_patch ? 'male_count'   then (p_patch->>'male_count')::int       else male_count end,
    female_count = case when p_patch ? 'female_count' then (p_patch->>'female_count')::int     else female_count end
  where id = p_id;
end $$;

revoke all on function public.oatly_admin_delete(bigint, text) from public;
revoke all on function public.oatly_admin_update(bigint, text, jsonb) from public;
grant execute on function public.oatly_admin_delete(bigint, text) to anon, authenticated;
grant execute on function public.oatly_admin_update(bigint, text, jsonb) to anon, authenticated;

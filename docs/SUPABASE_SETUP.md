# Supabase 셋업 가이드

A단계 — 트레이너 1명 기준의 클라우드 동기화 + 이메일 매직링크 로그인.

## 1. Supabase 프로젝트 생성

1. <https://supabase.com> 가입 후 **New project** 생성.
2. 데이터베이스 비밀번호는 사용하지 않으므로 임의로 입력 후 잘 보관하면 됩니다.
3. 리전은 **Tokyo (ap-northeast-1)** 또는 **Seoul** 권장.

## 2. 스키마 + RLS + Realtime 설정

좌측 메뉴 **SQL Editor → New query**에 아래 SQL을 그대로 붙여넣고 실행하세요.

```sql
-- =========== Tables ===========
create table public.members (
  id          uuid primary key default gen_random_uuid(),
  trainer_id  uuid not null default auth.uid()
              references auth.users(id) on delete cascade,
  name        text not null,
  color       text not null default '#3b82f6',
  memo        text not null default '',
  created_at  timestamptz not null default now(),
  unique (trainer_id, name)
);

create table public.sessions (
  id            uuid primary key default gen_random_uuid(),
  trainer_id    uuid not null default auth.uid()
                references auth.users(id) on delete cascade,
  member_id     uuid not null
                references public.members(id) on delete cascade,
  date          date not null,
  start_time    time not null,
  duration_min  int  not null default 50,
  created_at    timestamptz not null default now()
);

create index sessions_trainer_date_idx on public.sessions (trainer_id, date);

-- ====== member_id 가 같은 트레이너 소유인지 트리거로 검증 ======
create or replace function public.session_owner_check()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from public.members
     where id = new.member_id and trainer_id = new.trainer_id
  ) then
    raise exception 'member_id does not belong to trainer';
  end if;
  return new;
end;
$$;

drop trigger if exists session_owner_check_trigger on public.sessions;
create trigger session_owner_check_trigger
before insert or update on public.sessions
for each row execute function public.session_owner_check();

-- =========== Row Level Security ===========
alter table public.members  enable row level security;
alter table public.sessions enable row level security;

create policy "members own select"  on public.members
  for select using (trainer_id = auth.uid());
create policy "members own insert"  on public.members
  for insert with check (trainer_id = auth.uid());
create policy "members own update"  on public.members
  for update using (trainer_id = auth.uid())
            with check (trainer_id = auth.uid());
create policy "members own delete"  on public.members
  for delete using (trainer_id = auth.uid());

create policy "sessions own select" on public.sessions
  for select using (trainer_id = auth.uid());
create policy "sessions own insert" on public.sessions
  for insert with check (trainer_id = auth.uid());
create policy "sessions own update" on public.sessions
  for update using (trainer_id = auth.uid())
            with check (trainer_id = auth.uid());
create policy "sessions own delete" on public.sessions
  for delete using (trainer_id = auth.uid());

-- =========== Realtime ===========
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.sessions;
```

## 3. Auth 설정

좌측 메뉴 **Authentication → URL Configuration**에서:

- **Site URL**: GitHub Pages URL 입력
  - 예: `https://beebeambap.github.io/workout_schedule/`
- **Redirect URLs**: 위와 동일한 URL을 추가
- 로컬 개발용으로 `http://localhost:8000/` 도 추가하면 편함

**Authentication → Providers → Email**:
- "Enable email provider" ON
- "Confirm email" 은 OFF로 두는 것이 매직링크 흐름이 매끄러움 (혹은 ON으로 두고 첫 메일 1회만 확인)

## 4. 키 복사

좌측 **Settings → API** 메뉴에서:

- **Project URL** 복사
- **anon public** 키 복사 (anon 키는 클라이언트 노출이 의도된 키이며, RLS 정책으로 보호됩니다)

## 5. config.js 채우기

저장소 루트의 `config.js` 파일 두 줄을 복사한 값으로 교체:

```js
window.SUPABASE_URL = 'https://YOURPROJECT.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

커밋 → 푸시하면 GitHub Pages가 새 값으로 배포됩니다.

## 6. 로그인

1. 페이지 접속 → 이메일 입력 → "로그인 링크 보내기".
2. 받은 메일의 링크 클릭 → 자동으로 페이지로 돌아오며 로그인 완료.
3. 처음 로그인 시 브라우저에 남아있던 로컬 데이터가 있으면 클라우드로 이전할지 물어봅니다.

## 7. 동작 검증

- 캘린더에서 수업 추가 → 다른 기기에서 같은 계정으로 로그인하면 자동 반영.
- 회원 메모 수정도 마찬가지.
- 한 트레이너가 다른 트레이너의 데이터를 절대 볼 수 없음 (RLS).

## 보안 메모

- **anon key는 공개되어도 안전**합니다. RLS 정책이 데이터 격리를 강제합니다.
- **service_role key는 절대 클라이언트나 git에 노출하지 마세요**.
- 회원 메모에 민감 정보(주민번호 등)는 저장하지 않는 것을 권장합니다.
- 정기 백업: Supabase는 무료 플랜에서도 일일 자동 백업 7일치 제공.

## 비용

- 무료 플랜: 500MB DB, 50MB 파일, 1GB egress, 50,000 MAU.
- 트레이너 1명 + 회원 수백 명, 월 수업 수천 건 규모는 무료 플랜으로 충분.
- 사용자 수가 늘어나면 Pro 플랜($25/월)로 업그레이드.

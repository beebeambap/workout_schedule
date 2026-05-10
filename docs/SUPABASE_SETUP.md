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

## 6.5 추가 마이그레이션 (트레이너 자기 일정 + 회원 상태)

이미 초기 설정을 마쳤다면, **추가 기능**(내 일정 추가 / PT 연장·종료 통계) 활성화를 위해 다음 SQL을 한 번 더 실행하세요. 기존 데이터에 영향 없이 컬럼만 추가합니다.

```sql
-- sessions: 트레이너 자기 일정용으로 member_id 를 nullable + title 컬럼
alter table public.sessions alter column member_id drop not null;
alter table public.sessions add column if not exists title text;

-- 트리거: member_id 가 null 이면 검증 건너뛰도록 갱신
create or replace function public.session_owner_check()
returns trigger language plpgsql as $$
begin
  if new.member_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.members
     where id = new.member_id and trainer_id = new.trainer_id
  ) then
    raise exception 'member_id does not belong to trainer';
  end if;
  return new;
end;
$$;

-- members: 상태 추적
alter table public.members
  add column if not exists status text not null default 'active',
  add column if not exists status_at date not null default current_date;

-- sessions: 수업 상태
-- 허용 값: scheduled | completed | canceled | noshow_charged | noshow_free
alter table public.sessions
  add column if not exists status text not null default 'scheduled';
```

이 SQL을 실행하지 않아도 기본 캘린더/회원 관리 기능은 그대로 동작합니다. "내 일정 추가", 통계의 PT 연장/종료, 수업 상태(완료/취소/노쇼) 항목은 마이그레이션 후 활성화됩니다.

> **노쇼 상태**: `noshow_charged`(회차 차감) / `noshow_free`(차감 면제) 두 가지로 분리됩니다. 정산·잔여 횟수 계산에서 다르게 처리하기 위함입니다. DB 컬럼은 `text`이므로 추가 마이그레이션 없이 바로 사용 가능합니다.

## 6.7 매직 링크 이메일 커스터마이즈 (레슨핏 브랜딩)

기본 발송 메일은 "Confirm your signup" 같은 영문 + Supabase 발신자입니다. 한국 사용자 신뢰도와 브랜드 통일성을 위해 한국어로 바꿉니다.

**Supabase Dashboard → Authentication → Email Templates → Magic Link**

**Subject (제목)**:
```
[레슨핏] 로그인 링크
```

**Message (Body)** — HTML 형식:
```html
<div style="font-family:'Noto Sans KR',system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827;">
  <h2 style="margin:0 0 16px;font-size:20px;">레슨핏 로그인</h2>
  <p style="line-height:1.6;color:#374151;">
    안녕하세요, 레슨핏 로그인 요청이 들어왔습니다.<br>
    아래 버튼을 누르시면 자동으로 로그인됩니다.
  </p>
  <p style="margin:28px 0;text-align:center;">
    <a href="{{ .ConfirmationURL }}"
       style="display:inline-block;padding:12px 24px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
      레슨핏 로그인하기
    </a>
  </p>
  <p style="font-size:13px;color:#6b7280;line-height:1.6;">
    버튼이 동작하지 않으면 이 링크를 복사해 주소창에 붙여넣으세요:<br>
    <span style="word-break:break-all;color:#2563eb;">{{ .ConfirmationURL }}</span>
  </p>
  <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="font-size:12px;color:#9ca3af;line-height:1.6;">
    본인이 요청하지 않았다면 이 메일은 무시해 주세요. 링크는 24시간 후 만료됩니다.<br>
    — 레슨핏 (Lesson Fit)
  </p>
</div>
```

저장 후 다음 매직 링크 발송부터 즉시 적용됩니다.

### 발신자 이름 / 발신 이메일 변경 (선택)

기본 발신자는 `noreply@mail.app.supabase.io`. 이걸 `noreply@lessonfit.com` 같은 자체 도메인으로 바꾸려면:

1. **Project Settings → Auth → SMTP Settings**에서 "Enable Custom SMTP" ON
2. 외부 SMTP 제공자 연결 (권장: Resend / SendGrid / Mailgun — 무료 티어 충분)
3. 발신자 이메일·이름 입력 (예: `레슨핏 <noreply@lessonfit.com>`)

자체 도메인은 SPF/DKIM 인증 필요. 처음엔 그냥 기본 SMTP 쓰고, 사용자가 늘면 전환 권장.

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

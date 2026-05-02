# PT 스케줄러 (workout_schedule)

회원 이름·날짜·시간을 입력하면 자동으로 캘린더에 등록되고, 회원별 주간/월간 캘린더를 JPG로 다운로드할 수 있는 웹앱. Supabase 인증으로 다기기 동기화 지원.

## 기능

- 입력: 타이핑 단건 / CSV 일괄 + 미리보기·확정 흐름
- 주간(시간 비율 기반 절대 좌표) · 월간 캘린더, 회원 필터, 빨간 현재시간 라인
- 회원별 JPG 다운로드 (헤더 + 캘린더 표 + 8칸 단일행 요약표), 회원별 일괄 저장
- 캘린더 이벤트 클릭 → 수업 모달, 회원 행 클릭 → 회원 편집 모달(이름·색상·메모)
- 모바일 반응형
- Supabase 매직 링크 로그인 + RLS + Realtime 동기화

## 셋업

처음 한 번만 Supabase 프로젝트를 연결합니다. 자세한 단계는 [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md).

요약:
1. supabase.com에서 프로젝트 생성
2. SQL Editor에서 가이드의 스키마 SQL 실행 (members/sessions + RLS + realtime)
3. Authentication → URL Configuration에 GitHub Pages URL 등록
4. Settings → API에서 Project URL과 anon key 복사
5. 저장소의 `config.js`에 두 값을 입력 → 커밋·푸시
6. GitHub Pages 페이지 접속 → 이메일 입력 → 메일의 링크 클릭

## 로컬 실행

ES 모듈 로드를 위해 정적 서버 필요:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

`http://localhost:8000/`도 Supabase Auth Redirect URLs에 추가해두면 로컬에서도 로그인 가능합니다.

## 디렉터리 구조

```
index.html
config.js          # SUPABASE_URL/ANON_KEY (사용자가 채움)
styles.css
js/
  supabase.js      # 클라이언트 wrapper
  auth.js          # 매직링크/세션
  store.js         # Supabase CRUD + 캐시 + Realtime
  parser.js        # CSV/XLSX 파싱
  calendar.js      # 주간/월간 렌더 + 시간 비례 절대 배치
  exporter.js      # html2canvas → JPG (헤더+요약표 포함)
  app.js           # 뷰/이벤트 wiring + 인증 게이팅 + 마이그레이션
docs/
  DESIGN.md        # 전체 시스템 설계서
  SUPABASE_SETUP.md
```

## 보안

- anon key는 공개 가능. RLS 정책이 데이터 격리를 강제 (트레이너 본인 row만 조회·수정·삭제).
- service_role key는 절대 클라이언트나 git에 노출 금지.
- 세션 토큰은 Supabase SDK가 자동 관리.
- 회원 메모에 민감 정보 저장 비권장.
- 사용자 수 증가 시 Supabase Pro 플랜 업그레이드 검토 (cost 0 → $25/월).

# 자동 PT 스케줄링 시스템 개발 설계서

> 문서 버전: v0.1
> 작성일: 2026-05-02
> 대상 도메인: 1:1/1:N 퍼스널 트레이닝(PT) 수업 스케줄 관리

---

## 1. 프로젝트 개요

### 1.1 배경
트레이너는 다수의 회원을 개별 시간대에 관리해야 하지만, 보통 종이 수첩 · 메신저 · 엑셀에 흩어져 있어 다음 문제를 겪는다.

- 오늘 누가 몇 시에 오는지 한눈에 파악하기 어렵다.
- 회원마다 자기 일정만 따로 받고 싶어 한다 (개인화된 이미지/캡처).
- 일정 변경 시 일일이 메시지를 다시 만들어 보내야 한다.

### 1.2 목표
1. **다양한 입력**(이미지 사진 · CSV · Excel)에서 회원·날짜·수업시간을 자동 추출하여 일관된 스케줄 데이터로 저장한다.
2. **회원별 스케줄 이미지**를 자동 생성하여 한 명씩 공유 가능한 PNG 파일로 출력한다.
3. **실시간 달력 대시보드**를 통해 트레이너가 오늘/이번 주의 수업을 모니터링한다.
4. 회원별 개인 스케줄 화면(필터 뷰 + 공유 가능 링크)을 제공한다.

### 1.3 비범위 (Out of Scope, v1)
- 결제 · 매출 정산
- 운동 동작 분석, 영상 코칭
- 멀티테넌트(여러 헬스장) 운영. v1은 단일 트레이너 또는 단일 스튜디오 가정.

---

## 2. 사용자 및 사용 시나리오

### 2.1 페르소나
| 페르소나 | 설명 | 주요 니즈 |
|---|---|---|
| 트레이너 (관리자) | 본 시스템의 주 사용자 | 입력의 자동화, 오늘 일정 한눈 파악, 회원별 이미지 일괄 발송 |
| 회원 (조회자) | 본인 일정만 본다 | 내 스케줄 이미지/링크 받기 |

### 2.2 핵심 시나리오
1. **CSV 업로드** → 트레이너가 다음 주 일정이 담긴 CSV를 업로드 → 시스템이 검증 후 DB 반영 → 회원별 PNG 자동 생성 → 다운로드 ZIP 또는 개별 링크 제공.
2. **사진 업로드 (OCR)** → 손글씨/캡처 이미지를 업로드 → OCR + 파싱 → 사용자가 미리보기에서 보정 → 확정 시 위와 동일한 후속 흐름.
3. **달력 모니터링** → 트레이너가 대시보드 접속 → 오늘 수업이 시간순으로 표시, 5분 이내 수업은 강조 → 클릭 시 회원 상세.
4. **회원 개별 뷰** → 회원에게 발송한 링크(`/m/<token>`)로 본인 일정 캘린더 + 이미지를 본다.

---

## 3. 요구사항

### 3.1 기능 요구사항
- **F1. 입력 파싱**
  - F1.1 CSV/XLSX 업로드 (열: `member_name`, `date`, `start_time`, `duration_min` 또는 `end_time`).
  - F1.2 이미지 업로드 시 OCR로 텍스트 추출 후 동일 스키마로 정규화.
  - F1.3 검증: 동일 시간대 중복, 영업시간 외, 알 수 없는 회원 등 경고.
  - F1.4 미리보기 → 사용자 확정 후 커밋.
- **F2. 스케줄 데이터 관리**
  - F2.1 회원 CRUD (이름·연락처·메모).
  - F2.2 수업(Session) CRUD, 단건/반복(주 단위) 등록.
  - F2.3 변경 이력 로그.
- **F3. 이미지 생성**
  - F3.1 회원별 1주/1개월 스케줄 PNG 생성(템플릿 기반 렌더링).
  - F3.2 일괄 ZIP 다운로드.
  - F3.3 공유 링크(만료/회수 가능) 발급.
- **F4. 달력 대시보드**
  - F4.1 일/주/월 뷰.
  - F4.2 실시간 갱신(WebSocket 또는 SSE).
  - F4.3 "지금 다음 수업까지 N분" 표시.
- **F5. 회원별 개인 뷰**
  - F5.1 토큰 기반 비공개 URL.
  - F5.2 모바일 우선 반응형.

### 3.2 비기능 요구사항
- **성능**: 회원 200명 / 월 수업 4,000건 기준 대시보드 첫 페인트 < 2초.
- **가용성**: v1은 99% (개인 사이드 프로젝트 수준).
- **보안**: 회원 PII는 최소 수집(이름·연락처). 공유 토큰은 서명된 랜덤 32바이트.
- **접근성**: WCAG AA, 색맹 친화 색상 팔레트.
- **국제화**: v1은 한국어 + 한국 표준시(KST) 고정. 다국어는 v2.

---

## 4. 시스템 아키텍처

### 4.1 컴포넌트 구성도 (논리)

```
 ┌──────────────┐    HTTPS    ┌──────────────────┐
 │  Web Client  │ ──────────► │   API Gateway    │
 │  (Next.js)   │ ◄────────── │  (FastAPI)       │
 └──────────────┘    SSE      └────────┬─────────┘
        ▲                              │
        │ Static                        │
 ┌──────┴───────┐                      ▼
 │  CDN/Object  │             ┌──────────────────┐
 │  Storage     │ ◄───────────│  Worker (Celery) │
 │  (S3/R2)     │   PNG/ZIP   └────────┬─────────┘
 └──────────────┘                      │
                                        ▼
                              ┌──────────────────┐
                              │   PostgreSQL     │
                              │   + Redis        │
                              └──────────────────┘
                                        ▲
                                        │
                              ┌──────────────────┐
                              │  OCR Service     │
                              │  (Cloud Vision   │
                              │   or Tesseract)  │
                              └──────────────────┘
```

### 4.2 기술 스택 (제안)
- **Frontend**: Next.js 14 (App Router) + TypeScript, TailwindCSS, FullCalendar.
- **Backend API**: Python 3.12 + FastAPI + SQLAlchemy + Alembic.
- **Worker**: Celery + Redis (PNG 생성, OCR 호출, 알림).
- **DB**: PostgreSQL 16.
- **Storage**: S3 호환(R2/Minio) — 생성 이미지·ZIP 보관.
- **Image Rendering**: Pillow + headless Chromium(html-to-image, 복잡 레이아웃 대응).
- **OCR**: 1차 Google Cloud Vision(한글 정확도 우수), 2차 fallback Tesseract.
- **Auth**: 트레이너는 이메일 매직링크. 회원 뷰는 서명 토큰 URL.
- **Realtime**: SSE(우선) → 부하 시 WebSocket 전환.
- **Infra**: Docker Compose(개발), Fly.io 또는 Railway(프로덕션 v1).

선택 근거 요약: 단일 개발자가 빠르게 만들 수 있는 친숙한 스택, OCR/이미지 렌더링 라이브러리가 풍부한 Python, FE는 Next.js로 SSR + 정적 생성 모두 활용.

---

## 5. 데이터 모델

### 5.1 ER 다이어그램 (요약)

```
Trainer 1 ──< Member 1 ──< Session >── 1 Trainer
                          │
                          └──< SessionAttachment (생성된 이미지)
```

### 5.2 주요 테이블

```sql
CREATE TABLE trainer (
  id            UUID PRIMARY KEY,
  email         CITEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'Asia/Seoul',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE member (
  id            UUID PRIMARY KEY,
  trainer_id    UUID NOT NULL REFERENCES trainer(id),
  name          TEXT NOT NULL,
  phone         TEXT,
  share_token   TEXT UNIQUE NOT NULL, -- 회원 개인 뷰용
  memo          TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (trainer_id, name)
);

CREATE TABLE session (
  id            UUID PRIMARY KEY,
  trainer_id    UUID NOT NULL REFERENCES trainer(id),
  member_id     UUID NOT NULL REFERENCES member(id),
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled', -- scheduled|done|canceled
  source        TEXT NOT NULL,         -- csv|xlsx|image|manual
  source_ref    TEXT,                  -- 업로드 파일 ID
  created_at    TIMESTAMPTZ DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX idx_session_trainer_day ON session (trainer_id, starts_at);
CREATE INDEX idx_session_member_day  ON session (member_id, starts_at);

CREATE TABLE upload_job (
  id            UUID PRIMARY KEY,
  trainer_id    UUID NOT NULL REFERENCES trainer(id),
  kind          TEXT NOT NULL,         -- csv|xlsx|image
  state         TEXT NOT NULL,         -- received|parsed|confirmed|failed
  raw_path      TEXT NOT NULL,
  parsed_json   JSONB,                 -- 검증 전 파싱 결과
  warnings      JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE session_image (
  id            UUID PRIMARY KEY,
  member_id     UUID NOT NULL REFERENCES member(id),
  range_start   DATE NOT NULL,
  range_end     DATE NOT NULL,
  png_path      TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

> 시간은 모두 `TIMESTAMPTZ`로 저장하고, UI 표시는 트레이너 타임존(KST 기본)으로 변환.

### 5.3 충돌 검증 규칙
- 동일 트레이너의 두 세션이 시간 구간에서 겹치면 `409 Conflict` 또는 경고로 표시.
- 회원이 같은 시간 다른 세션에 있으면 동일 처리.
- 영업시간(트레이너 설정) 밖이면 경고만 표시(차단 아님).

---

## 6. 주요 기능 상세 설계

### 6.1 입력 파싱 파이프라인

```
업로드 → 저장(원본) → 파싱(kind별) → 정규화 → 검증 → 미리보기 응답
                                                      │
                                                      ▼
                                              사용자 확정 → 세션 INSERT (트랜잭션)
                                                      │
                                                      ▼
                                              이미지 생성 작업 큐 enqueue
```

#### 6.1.1 CSV/XLSX
- 필수 컬럼: `member_name`, `date`(YYYY-MM-DD), `start_time`(HH:MM), 그리고 `duration_min` 또는 `end_time` 중 하나.
- 한국어 헤더 별칭 지원: `회원명`, `날짜`, `시작시간`, `소요시간`, `종료시간`.
- `pandas`로 로드, `pydantic` 모델로 행 단위 검증.

#### 6.1.2 이미지 (OCR)
- 1) 이미지 전처리: 그레이스케일 + adaptive threshold(`opencv`).
- 2) OCR: Google Vision `documentTextDetection`. 응답의 단어 박스에서 줄을 재구성.
- 3) 라인 단위 정규식·휴리스틱:
  - `(이름) (\d{1,2}[:시]\d{0,2})` 등.
  - 날짜는 표 헤더에서 일괄 추론(같은 열 = 같은 날짜).
- 4) 신뢰도 < 0.8 행은 미리보기에서 빨갛게 강조해 사용자가 보정.

### 6.2 이미지 생성

#### 옵션 A. Pillow 직접 렌더 (단순/빠름)
- 1주 7행 × 시간 슬롯 그리드 PNG.
- 한글 폰트(Pretendard) 임베드, 색은 회원별 해시 컬러.

#### 옵션 B. HTML → PNG (권장)
- React 컴포넌트로 템플릿 작성 → Playwright headless로 PNG 캡처.
- 장점: CSS 그리드/카드 레이아웃 자유롭고 디자인 변경 쉬움.
- 단점: 컨테이너에 Chromium 필요. v1에서 수용.

산출물 규격:
- 해상도 1080×1350 (인스타 4:5) 또는 1080×1920 (스토리), 두 종 모두 생성.
- 파일명 규칙: `<member_name>_<YYYYMMDD>_<YYYYMMDD>.png`.

### 6.3 실시간 달력 대시보드
- FullCalendar의 timeGrid 뷰를 기본.
- 데이터: `GET /api/sessions?from=&to=` (페이지네이션 X, 범위 제한).
- 실시간 업데이트: 서버 SSE 채널 `/api/stream/sessions` 구독. 변경 이벤트 `session.created|updated|canceled` push → 클라이언트가 부분 갱신.
- "다음 수업까지 N분" 위젯은 클라이언트에서 1분마다 재계산.

### 6.4 회원별 개인 뷰
- URL: `/m/<share_token>` (검색엔진 인덱싱 차단).
- 콘텐츠: 본인의 다가오는 수업 리스트 + 같은 PNG 다운로드 버튼.
- 토큰 회수: 트레이너 화면에서 "토큰 재발급" 버튼 → 기존 URL 무효화.

---

## 7. API 설계 (요약)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/uploads` | 파일 업로드(다중 형식). 응답: `upload_job_id` |
| GET | `/api/uploads/{id}` | 파싱 결과/경고 조회 |
| POST | `/api/uploads/{id}/confirm` | 미리보기 확정 → 세션 일괄 생성 |
| GET | `/api/members` | 회원 목록 |
| POST | `/api/members` | 회원 생성 |
| POST | `/api/members/{id}/share-token/rotate` | 공유 토큰 재발급 |
| GET | `/api/sessions?from&to&member_id?` | 기간 내 세션 |
| POST | `/api/sessions` | 단건 추가 |
| PATCH | `/api/sessions/{id}` | 변경/취소 |
| POST | `/api/members/{id}/images` | 이미지 재생성 트리거 |
| GET | `/api/stream/sessions` | SSE 실시간 |
| GET | `/m/{share_token}` | 회원 공개 뷰 (HTML) |

표준 에러: RFC 7807(`application/problem+json`).

---

## 8. UI 와이어프레임 (텍스트)

### 8.1 트레이너 대시보드
```
┌─ 헤더 ────────────────────────────────────────┐
│ [오늘 2026-05-02 (토)]  다음 수업까지 24분    │
├─ 좌측 주간 캘린더 ──────┬─ 우측 패널 ───────┤
│  09  ─ 김XX  PT 1h     │  업로드 [+]         │
│  10  ─                  │  최근 업로드 3건     │
│  11  ─ 박XX  PT 30m    │  -----              │
│  12  ─                  │  회원 검색 [____]    │
│  ...                    │  회원 리스트        │
└─────────────────────────┴─────────────────────┘
```

### 8.2 업로드 미리보기
- 표 형태로 파싱 결과 표시, 경고는 우측 마지막 칼럼 아이콘.
- 하단 [확정] / [취소].

### 8.3 회원 공개 뷰 (모바일)
- 상단: 회원 이름, 트레이너 이름.
- 다가오는 수업 카드 리스트.
- "이미지로 저장" 버튼 → 기 생성 PNG 다운로드.

---

## 9. 보안 · 프라이버시

- 모든 트래픽 HTTPS 강제, HSTS.
- 공유 토큰: 32바이트 URL-safe 랜덤, 서버에 평문 미저장(해시 비교) 또는 평문이지만 회수 가능한 형태.
- 업로드 파일은 업로드자 본인만 다운로드 가능, 24h 후 원본 자동 삭제(파싱 결과는 유지).
- 회원 PII 최소화: 이름·전화번호 외 수집 금지.
- 감사 로그: 세션 생성/수정/삭제, 공유 토큰 회수.
- OCR 외부 API 호출 시 회원 이름/번호 마스킹 후 전송 옵션 제공.

---

## 10. 운영 · 배포

- 환경: `dev`, `staging`, `prod` 3단계.
- CI: GitHub Actions — lint(ruff/eslint) → test(pytest/vitest) → build → deploy.
- 백업: Postgres 일 1회 스냅샷, Object Storage 버전 관리 활성화.
- 모니터링: Sentry(에러), Grafana Cloud(메트릭), Logtail(로그).
- 알림: 업로드 작업 실패 → 트레이너 이메일.

---

## 11. 일정 / 마일스톤 (제안)

| 마일스톤 | 기간 | 주요 산출물 |
|---|---|---|
| M0 셋업 | 1주 | 모노레포, CI, 환경, 인증 골격 |
| M1 데이터 모델 + 수동 등록 | 1주 | 회원/세션 CRUD, 캘린더 뷰 정적 |
| M2 CSV/XLSX 업로드 | 1주 | 파싱·미리보기·확정 |
| M3 이미지 생성 | 1주 | HTML→PNG, ZIP 다운로드 |
| M4 OCR 입력 | 1.5주 | Vision 연동, 보정 UI |
| M5 실시간 SSE + 회원 공유 뷰 | 1주 | SSE, `/m/<token>` |
| M6 베타 안정화 | 0.5주 | 버그픽스, 성능, 배포 |

총 약 **7주** (단일 개발자 풀타임 기준).

---

## 12. 리스크 · 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| OCR 정확도 한계(손글씨) | 입력 신뢰도↓ | 미리보기 보정 UI 강제, 신뢰도 임계값으로 강조 |
| 헤드리스 Chromium 비용 | 이미지 생성 비용↑ | 야간 배치 + 캐싱, 변경 시에만 재생성 |
| 시간대/일광절약 | 시각 오류 | TIMESTAMPTZ 강제, 표시는 트레이너 TZ |
| 공유 토큰 유출 | PII 노출 | 토큰 회수 + 만료, robots 차단 |
| 단일 트레이너 가정 | 성장 제약 | 스키마에 `trainer_id` 항상 보존, v2에 멀티테넌트 확장 용이 |

---

## 13. 향후 확장 (v2+)

- 카카오톡/문자 자동 발송 연동.
- 회원 리마인더(수업 1시간 전 알림).
- 결제·정산.
- 그룹 수업, 대기열, 노쇼 관리.
- 다국어/다중 트레이너 SaaS화.

---

## 부록 A. CSV 샘플

```csv
member_name,date,start_time,duration_min
김민수,2026-05-04,09:00,60
박지영,2026-05-04,10:30,30
이도윤,2026-05-04,18:00,60
김민수,2026-05-06,09:00,60
```

## 부록 B. 회원별 PNG 출력 예시 (메타)

```json
{
  "member": "김민수",
  "range": "2026-05-04 ~ 2026-05-10",
  "sessions": [
    {"date": "2026-05-04", "weekday": "월", "time": "09:00-10:00"},
    {"date": "2026-05-06", "weekday": "수", "time": "09:00-10:00"}
  ],
  "size": "1080x1350"
}
```

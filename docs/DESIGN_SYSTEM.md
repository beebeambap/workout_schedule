# 레슨핏 디자인 시스템

> 빌드 단계 없는 정적 SPA 기준. 모든 토큰은 `styles.css` `:root` 블록에 정의되며,
> 컴포넌트는 해당 토큰을 직접 참조합니다.

---

## 1. 컬러 토큰

### 1-1. 주요 색상 (Primary)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--primary` | `#2563eb` | CTA 버튼, 링크, 포커스 링 |
| `--primary-hover` | `#1d4ed8` | Primary 버튼 호버 상태 |
| `--primary-soft` | `#eff6ff` | Primary 배경 강조(부드러운 표시) |

> **원칙**: Primary(파랑)는 "주요 행동 유도" 전용입니다. 회원 컬러칩에 파랑 계열을 쓸 때는
> `#0284c7`(하늘) 또는 `#4f46e5`(청보라)를 사용하고, `--primary` 값과 동일한 파랑은 피합니다.

### 1-2. 중립 색상 (Neutral / Slate)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--slate` | `#111827` | 어두운 버튼(활성 탭, 스케줄 상태 "예정") |
| `--slate-hover` | `#1f2937` | slate 버튼 호버 |
| `--bg` | `#f6f7f9` | 페이지 배경 |
| `--surface` | `#ffffff` | 카드, 모달, 인풋 배경 |
| `--surface-alt` | `#fafafa` | 헤더 셀, 사이드 패널 배경 |
| `--surface-soft` | `#f9fafb` | 섹션 내부 보조 배경 |

### 1-3. 테두리

| 토큰 | 값 | 용도 |
|---|---|---|
| `--border` | `#e5e7eb` | 일반 구분선, 인풋 테두리(기본) |
| `--border-strong` | `#d1d5db` | 강조 구분선, 툴바 버튼 |

### 1-4. 텍스트

| 토큰 | 값 | 용도 |
|---|---|---|
| `--text` | `#111827` | 본문 텍스트 |
| `--text-muted` | `#6b7280` | 보조 레이블, 힌트 |
| `--text-faint` | `#9ca3af` | 비어 있음 표시, 비활성화 |

### 1-5. 의미 색상 (Semantic)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--danger` | `#dc2626` | 삭제 버튼, 오류, 취소된 세션 |
| `--danger-bg` | `#fee2e2` | 위험 버튼/알림 배경 |
| `--danger-border` | `#fecaca` | 위험 버튼/알림 테두리 |
| `--info-bg` | `#dbeafe` | 정보 배지 배경 (연장 회원) |
| `--info-text` | `#1d4ed8` | 정보 배지 텍스트 |
| `--success` | `#16a34a` | 완료 상태, 성공 토스트 |
| `--success-bg` | `#dcfce7` | 완료 배지 배경 |
| `--success-text` | `#166534` | 완료 배지 텍스트 |
| `--warn` | `#f59e0b` | 노쇼 외곽선, 경고 |
| `--warn-bg` | `#fef3c7` | 오늘 헤더 셀, 노쇼/경고 배지 배경 |
| `--warn-text` | `#92400e` | 노쇼/경고 배지 텍스트 |

### 1-6. 포커스 (Keyboard a11y)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--focus-outline` | `2px solid var(--primary)` | 포커스 외곽선 (`:focus-visible` 한정) |
| `--focus-ring` | `0 0 0 4px rgba(37,99,235,0.18)` | 외곽선 바깥 부드러운 글로우 |

> 마우스 클릭에서는 포커스 링이 보이지 않도록 `:focus-visible`로만 적용. 키보드 탭 이동 시에만 표시됩니다.

> **의미 색상 충돌 방지**: 빨강(`--danger`)·파랑(`--primary`)은 의미를 가집니다.
> 회원 컬러칩 팔레트에 이 두 색을 그대로 쓰지 않고, 유사하지만 다른 색조를 배정합니다.

---

## 2. 회원 컬러 팔레트

회원마다 하나의 식별 색상을 부여합니다. 팔레트는 10색으로 고정되며,
**흰 텍스트 WCAG AA 기준(대비 4.5:1 이상)**을 모두 충족합니다.

| # | 이름 | Hex | 비고 |
|---|---|---|---|
| 1 | 산호 | `#e11d48` | 따뜻한 빨강. danger(`#dc2626`)와 구별 |
| 2 | 귤 | `#ea580c` | 주황 |
| 3 | 머스터드 | `#a16207` | 어두운 황금 |
| 4 | 숲 | `#15803d` | 짙은 녹색 |
| 5 | 민트 | `#0d9488` | 청록 |
| 6 | 하늘 | `#0284c7` | 파랑(기본값) |
| 7 | 청보라 | `#4f46e5` | 인디고 |
| 8 | 라벤더 | `#7c3aed` | 보라 |
| 9 | 자두 | `#c026d3` | 마젠타 |
| 10 | 그라파이트 | `#475569` | 중립 회색 |

**기본 색상**: 하늘 `#0284c7` (신규 회원 최초 배정)

**자동 배정 로직** (`colorFor`): 이름 문자열의 해시값 → 팔레트 인덱스(mod 10).
**이전 색 마이그레이션**: `lf_color_migration_v1` localStorage 플래그로 1회 실행.
구 hex → RGB 유클리드 거리 최단 팔레트색으로 교체.

> **개인 일정(트레이너 자신)**: 회원 없는 세션은 `#6b7280`(회색) 고정.
> 팔레트 밖의 색이므로 항상 구별됩니다.

### 2-1. 향후 확장 계획 (LATER)

11명 이상의 회원 운영 시 색 충돌이 시작됩니다. `docs/color-chip-ideas.html`에서 검토한 방향대로 확장합니다.

- **휴(Hue) → 명도(Shade) 2단 선택**: 기존 10휴는 그대로 유지, 각 휴를 **10단계 명도**로 확장 → **10휴 × 10명도 = 100색 슬롯**.
- **자동 배정**: 해시 단순 모듈로 → "가장 적게 쓰인 휴 → 그 안에서 가장 적게 쓰인 명도" 라운드로빈으로 변경 (결정적·마이그레이션 안전).
- **이중 부호화 (Concept C 병행)**: 색만으로는 식별이 어려우므로 회원 이니셜 모노그램을 색 칩 안에 같이 표시. 색약·흑백 인쇄·좁은 캘린더 블록에서도 식별 유지.

이 확장은 NOW 우선순위 작업 완료 후 별도 스프린트에서 진행합니다.

---

## 3. 타이포그래피

| 요소 | 폰트/크기 | 비고 |
|---|---|---|
| 기본 폰트 | `'Noto Sans KR', system-ui, sans-serif` | 한글 최적화 |
| 본문 | 15px / line-height 1.6 | `--text` (한글 가독성 고려) |
| 힌트·보조 | 13px | `--text-muted` |
| 배지·레이블 | 10~12px | `letter-spacing: 0.2–0.5px` |
| 모달 제목 | 18px, `font-weight: 700` | |
| 토바 앱명 | 17px, `font-weight: 800`, `letter-spacing: -0.3px` | |
| 이벤트 이름 | 12px, `font-weight: 700` | 주간 캘린더 |
| 이벤트 시간 | 10px, `opacity: 0.9` | 주간 캘린더 |

---

## 4. 스페이싱 & 레이아웃

- **최대 너비**: `main { max-width: 1200px; margin: 0 auto; }`
- **페이지 패딩**: 데스크톱 20px, 모바일(≤640px) 12px
- **컴포넌트 내부 갭**: 6–12px (작은 행 단위), 14–20px (섹션 단위)
- **모달 너비**: 기본 440px, 와이드(회원 상세) 1100px, 모바일에서 `92vw`

---

## 5. 반경 & 그림자

| 토큰 | 값 | 용도 |
|---|---|---|
| `--radius-sm` | `6px` | 인풋, 소형 버튼, 상태 섹션 |
| `--radius` | `8px` | 일반 버튼, 카드 |
| `--radius-lg` | `12px` | 모달, 멤버 리스트, 캘린더 |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | 이벤트 블록, 미묘한 입체감 |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.08)` | 카드, 패널 |
| `--shadow-lg` | `0 20px 60px rgba(0,0,0,0.25)` | 모달 |

---

## 6. 컴포넌트 패턴

### 6-1. 버튼 계층 (variant)

| 변형 | 클래스/셀렉터 | 배경 | 텍스트 | 테두리 | 용도 |
|---|---|---|---|---|---|
| **Primary** | `.primary` | `--primary` | 흰색 | `--primary` | 저장, 확인, 주요 행동 |
| **Secondary** | 기본(outline) | `--surface` | `--text` | `--border-strong` | 취소, 이전/다음 |
| **Danger** | `.danger` | `--danger-bg` | `#991b1b` | `--danger-border` | 삭제 |
| **Slate(Dark)** | `.active` (nav) | `--slate` | 흰색 | — | 활성 탭 |
| **Ghost** | `.link-button` | 투명 | `--primary` | — | 부가 링크 |

### 6-1b. 버튼 사이즈 (scale, opt-in)

| 클래스 | 패딩 | 폰트 | 최소 높이 | 용도 |
|---|---|---|---|---|
| `.btn-sm` | 4×10px | 12px | 28px | 행 내 액션, 인라인 |
| `.btn-md` | 8×14px | 14px | 36px | 일반 (현재 기본 톤과 동일) |
| `.btn-lg` | 11×18px | 15px / 600 | 44px | 모바일 주요 CTA |
| `.btn-mobile-cta` | — | — | ≤640px에서 자동 44px | 데스크톱 md → 모바일 lg 전환 |

> 모달 액션 버튼: `.modal-actions button` 기본은 Secondary.
> `.primary` 클래스를 추가하면 Primary. 사이즈 클래스는 variant와 조합해 사용 (`.primary.btn-lg`).

### 6-2. 인풋

모든 텍스트 인풋/셀렉트/텍스트에어리어 공통:
```
padding: 8–10px; border: 1px solid #d1d5db; border-radius: 6–8px;
font: inherit; background: #fff;
```
포커스 링: `outline: 1px solid var(--primary)` (테이블 셀 인풋 기준)

### 6-3. 하이브리드 컬러 피커

```
.form-color-row          → 수평 flex (row), 레이블 + 피커 묶음
  .form-color-label      → "색상" 레이블
  .color-picker-wrap     → flex row
    .color-palette       → grid (10열 × 28px)
      .color-swatch      → 28×28px 원형 칩
        .selected        → 외곽 border + 내부 inset ring
    .color-custom-btn    → 28×28px 점선 원형 label (커스텀)
      input[type=color]  → 투명 오버레이 (100% fill)
```

- 팔레트 칩 선택 시: `inputEl.value`에 hex 동기화
- 커스텀 색 선택 시: `custom-active` 클래스 + 배경에 선택 색 반영
- 모바일(≤480px): 팔레트 `grid-template-columns: repeat(10, 1fr)` (유동폭)

### 6-4. 회원 리스트

```
.member-filters          → 검색 인풋 + 상태 필터 select
.member-list             → ul, flex column, border + radius-lg
  .member-row            → li, 수평 flex
    border-left: 3px solid var(--accent)  ← 회원색 인라인 CSS 변수
    .mr-color            → 12×12px 색 원
    .mr-name             → 굵은 이름
    .mr-status           → 배지(연장: info-bg/text, 종료: danger-bg/text)
    .mr-count            → 세션 수
    .mr-memo             → 메모 (모바일에서 hidden)
    .mr-edit             → 편집 아이콘 버튼
```

필터 상태: `memberFilters.search` (문자열) + `memberFilters.status` (`all` | `active` | `extended` | `ended`)

### 6-5. 캘린더 이벤트

**주간(Week) 뷰**
- 절대 위치 블록, `top` / `height` = 시간 비례(56px/시간, `HOUR_HEIGHT`)
- 겹침 처리: `layoutEventsInColumn` → `laneIdx` / `totalLanes` → `width`/`left` 계산
- 색상: `background: memberColor` (인라인)
- 개인 일정: `.wg-event-personal` (대각선 반투명 줄무늬 오버레이)

**월간(Month) 뷰**
- `.ev` span, 색상 동일
- 최대 너비 overflow: `text-overflow: ellipsis`

### 6-6. 현재 시각선 (Now Line)

```
.wg-now-line    → height 2px, background #ef4444, box-shadow glow
.wg-now-dot     → 10×10px 빨간 원, left:-5px (시간축 위 돌출)
```
위치: `(현재분 - hStart*60) / 60 * HOUR_HEIGHT`px

---

## 7. 세션 상태 시각화

| 상태 | DB 값 | 클래스 | 시각 처리 | 회차 차감 | 매출 인식 |
|---|---|---|---|---|---|
| 예정 | `scheduled` | (기본) | — | — | — |
| 완료 | `completed` | `.is-completed` | opacity 1, `::after` ✓ 배지 (우상단) | 차감 | 인식 |
| 취소 | `canceled` | `.is-canceled` | opacity 0.5, 취소선, 대각 해칭 패턴 | 비차감 | — |
| 노쇼(차감) | `noshow_charged` | `.is-noshow-charged` | warn 외곽선 + ! 배지 | **차감** | 인식 |
| 노쇼(면제) | `noshow_free` | `.is-noshow-free` | warn 외곽선 + ! 배지 + 점선 밑줄 | **비차감** | — |
| 지난 날짜 | — | `.is-past` | opacity 0.55 (위 상태 미적용 시) | — | — |

상태 버튼(모달 내):
```
.ms-status-section
  .ms-status-row              → 메인 4개 버튼
    [예정] [완료] [취소] [노쇼]
        active[scheduled]  → --slate
        active[completed]  → --success
        active[canceled]   → --danger
        active[noshow]     → --warn
  .ms-status-sub (노쇼 활성화 시 노출)
    [차감] [면제]             → DB 값: noshow_charged | noshow_free
```

> **노쇼를 둘로 나눈 이유**: 정산·잔여 횟수 처리가 다르기 때문입니다. 약관에 따라 회차를 차감하는 경우(`noshow_charged`)와 트레이너 재량으로 면제한 경우(`noshow_free`)를 분리해 통계·환불 로직에서 별도로 처리할 수 있습니다.

---

## 8. 요일·공휴일 색상

| 케이스 | 색 |
|---|---|
| 토요일 번호 | `#2563eb` |
| 일요일 번호 / 공휴일 | `#dc2626` |
| 오늘 날짜 배지 (월간) | `background: #111827; color: #fff` |
| 오늘 헤더 셀 (주간) | `background: #fef3c7` |

---

## 9. PIN 잠금 화면

별도 레이어 (`position: fixed; z-index: 999`).
배경: `linear-gradient(180deg, #0f172a, #1e293b)` (짙은 슬레이트)
카드: 흰색, `border-radius: 16px`, 강한 그림자 (`0 30px 80px rgba(0,0,0,0.4)`)
입력: `-webkit-text-security: disc` (마스킹)

---

## 10. 반응형 브레이크포인트

| 브레이크포인트 | 주요 변화 |
|---|---|
| `≤ 640px` | main padding 12px, 주간 시간축 36px로 축소, 회원 메모 hidden |
| `≤ 480px` | 컬러 팔레트 유동폭 전환 |
| `≤ 800px` | 회원 상세 모달: 2열 → 1열 (사이드 패널이 위로) |

---

## 11. PWA / 서비스워커 전략

| 요청 유형 | 전략 |
|---|---|
| HTML / 문서 탐색 | Network-first (캐시 fallback) |
| 같은 오리진 CSS/JS/이미지 | Stale-while-revalidate |
| 외부(Supabase, CDN) | 바이패스 (SW 개입 없음) |

캐시명 패턴: `pt-cache-vN` (N은 정수). 자산 변경 시 N을 올려 구 캐시 강제 삭제.

---

## 12. 설계 원칙 요약

1. **토큰 우선**: 색·반경·그림자는 반드시 CSS 변수로. 컴포넌트에 하드코딩 금지.
2. **의미 충돌 방지**: 빨강 = 위험/일요일, 파랑 = 주요 행동. 회원 팔레트는 이 두 색을 직접 사용하지 않음.
3. **접근성**: 회원 팔레트 10색 전부 흰 텍스트 WCAG AA 통과.
4. **컴포넌트 클래스 수직 조합**: `.modal-actions button` + `.primary` / `.danger` 조합으로 변형.
5. **상태 클래스 누적**: `.is-past` + `.is-canceled` 등 복수 적용 가능. CSS 우선순위로 시각 결정.
6. **빌드 없음**: 모든 CSS는 단일 `styles.css`, 모든 JS는 ES 모듈. 전처리기·번들러 없음.

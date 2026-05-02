# PT 스케줄러 (workout_schedule)

회원 이름·날짜·시간을 다양한 방식으로 입력하면 자동으로 캘린더에 등록되고, 회원별 주간/월간 캘린더를 JPG로 다운로드할 수 있는 정적 웹앱입니다.

## 빠른 시작

빌드 도구 없이 정적 서버만 있으면 동작합니다. (ES 모듈 로드를 위해 `file://` 직접 열기 대신 HTTP로 서빙해야 합니다.)

```bash
cd workout_schedule
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

## 기능

- **입력 방식 4종**
  - 타이핑: 단건 등록 폼.
  - CSV / Excel: `member_name, date, start_time, duration_min` (한국어 헤더 `회원명/날짜/시작시간/소요시간`도 지원).
  - 이미지(OCR): Tesseract.js 한국어. 최초 실행 시 언어 데이터(~10MB) 다운로드로 시간이 걸립니다.
- **미리보기 → 확정**: CSV/Excel/OCR 결과는 표에서 직접 수정·삭제 후 확정.
- **캘린더**: 주간(시간대 그리드) / 월간(날짜 셀) 토글, 이전/다음/오늘.
- **회원 필터**: 드롭다운에서 한 명만 골라 보기.
- **JPG 다운로드**:
  - 현재 보기 그대로 JPG 저장.
  - "회원별 일괄"로 모든 회원 각각의 캘린더를 차례로 저장(브라우저가 다중 다운로드를 차단할 수 있음).
- **로컬 저장**: 데이터는 브라우저 localStorage에 보관. 서버/계정 없이 동작.

## CSV 샘플

```csv
member_name,date,start_time,duration_min
김민수,2026-05-04,09:00,60
박지영,2026-05-04,10:30,30
이도윤,2026-05-04,18:00,60
김민수,2026-05-06,09:00,60
```

## 디렉터리 구조

```
index.html
styles.css
js/
  app.js        # 뷰/이벤트 wiring
  store.js      # localStorage CRUD
  parser.js     # CSV/XLSX/자유 텍스트 파싱
  ocr.js        # Tesseract.js 래퍼
  calendar.js   # 주간/월간 렌더
  exporter.js   # html2canvas → JPG
docs/
  DESIGN.md     # 전체 시스템 설계서
```

## 한계 (이번 MVP)

- 백엔드/실시간 동기화 없음. 다른 기기와는 데이터가 공유되지 않습니다.
- 한국어 OCR 정확도는 사진 품질에 크게 의존 — 미리보기에서 보정 전제.
- 시간대는 브라우저 로컬 타임존을 그대로 사용.
- 충돌(같은 시간 중복) 검증 미구현.

다음 단계로 백엔드(FastAPI) + 공유 링크/실시간 모니터링은 [docs/DESIGN.md](docs/DESIGN.md) 참고.

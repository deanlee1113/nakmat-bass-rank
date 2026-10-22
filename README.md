# 내 배스, 상위 몇 %? (낚맛)

배스 길이를 넣으면 낚맛 앱에 기록된 같은 달 배스 중 상위 몇 %인지 보여주는 페이지입니다. 전국·시도별 순위(연도 범위 표시), 지역 런커 안내(컬러는 앱에서 공개), 사진 자랑 카드를 지원합니다.

- 주소: https://deanlee1113.github.io/nakmat-bass-rank/ (GitHub Pages, `docs/`)
- 같은 페이지 + 통계 API: https://nakmat-bass-rank.deanlee1113.workers.dev (Cloudflare Workers + D1 `nakmat-bass-rank-db`)
- 관리 화면: `/admin` (관리자 키 필요, 키는 Worker secret `ADMIN_KEY`, 로컬 `.admin_key`에만 있음)
- 데이터: 낚맛 앱 배스 승인 기록 10~70cm(2021.6~2026.10.2)의 길이별 기록 수 집계. 개인 정보 없음.
- 수집: 순위 확인한 달·지역·길이·등급, 버튼 사용(익명 무작위 ID). 사진은 브라우저 안에서만 쓰고 보내지 않음.

## 고치고 배포하기
1. `src/page.tpl.html`, `src/admin.tpl.html` 수정 (데이터는 `src/assets/`)
2. `python3 src/build.py https://nakmat-bass-rank.deanlee1113.workers.dev`
3. `npx wrangler@4 deploy` (Cloudflare) 후 커밋·푸시 (GitHub Pages)

# Lucky Grab (럭키그랩)

행사 부스용 3D 캡슐 뽑기. 대형 화면(세로 모니터)에 물리 엔진으로 쌓인 캡슐 뽑기통을 띄우고, 참가자는 QR을 찍어 휴대폰으로 뽑습니다.

- `index.html` — 행사 만들기 (마스터 코드 필요)
- `screen.html?e=<slug>&k=<admin_key>` — 대형 화면 (QR 50초마다 갱신, 스페이스바 = 현장 뽑기)
- `play.html?e=<slug>&t=<token>` — 참가자 휴대폰 (QR로만 진입)
- `admin.html?e=<slug>&k=<admin_key>` — 경품·확률 설정, 당첨 기록, 지급 체크, CSV

빌드 없는 정적 사이트(GitHub Pages). 백엔드는 Supabase(RPC + Realtime), 스키마는 `supabase/migrations/`.

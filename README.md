# 🕹️ Rapier3D UFO Catcher (Rust → WebAssembly)

**Rapier3D (`@dimforge/rapier3d-compat`, Rust → WASM)** + **Three.js** + **React / Vite**로 구현한 **13종 3D 아케이드 UFO 크레인 물리 시뮬레이터**입니다.  
피규어 박스 8종의 **하시와타시(4-Bar 브릿지)** 방식과 3D 입체 인형 5종의 **클래식 산더미 인형뽑기(WIN 구멍 운반)** 방식을 하나의 120Hz 강체 물리 엔진에서 모두 구현했으며, [Jolt Physics 버전](https://github.com/SilverRuler/Jolt-Physics)과 1:1 물리 감각을 비교할 수 있습니다.

---

## ✨ 핵심 물리 & 게임플레이 아키텍처

- **100% 실제 관절 모터 체인 (가짜 Constraint 없음)**:
  - `Kinematic Gantry` ↔ **`PrismaticImpulseJoint`** (Y축 윈치 + 하강 누르기 힘 제한) ↔ `Carrier`
  - `Carrier` ↔ **2축 `RevoluteImpulseJoint` 짐벌** (X/Z 케이블 스웨이, Yaw 회전 원천 고정) ↔ `Dynamic UFO Head`
  - `UFO Head` ↔ **2× `RevoluteImpulseJoint`** (ForceBased 토크 제한 모터 + 유연 하강 힌지) ↔ `2× Dynamic 3-세그먼트 연장 <> 곡면 집게 암`
  - 상단 정지 안정화(`0.22s`) 후 집게 완전 개방으로 깔끔한 수직 낙하 뒤 크레인 복귀
- **듀얼 아케이드 모드 (총 13개 독립 뽑기판)**:
  - **📦 피규어 박스 8종 (하시와타시 4-Bar)**: 크롬 Bar(`0.28μ`)와 빨간 실리콘 링(`1.19μ`) 분리 콜라이더 + 편심 무게추 + 기계별 맞춤 4-Bar 간격·높이
  - **🧸 3D 입체 인형 5종 (클래식 산더미 인형뽑기)**: `#2 마린`, `#5 타야마`, `#8 미쿠`, `#11 산드로네`, `#13 마키마` — 같은 3D 인형 **16개**를 바닥 가득 3단 산더미로 쌓아두고, 크레인이 인형을 물고 들어 올린 뒤 **`carrying` 단계**에서 좌측 하단(초기 위치) 아크릴 가드 너머 **WIN 구멍** 위로 운반·낙하시키면 당첨
- **13종 뽑기판별 고유 물리 프로필 (`MACHINE_PROFILES`)**:
  - `#1 페른`을 기준 기본값으로 두고, 나머지 12개 뽑기판의 **4-Bar 간격, 크레인 헤드 크기, 집게 길이/두께, 닫힘·유지 토크, 실리콘 팁 마찰**을 난이도에 맞춰 개별 튜닝
- **편의성 · 관전 · 샌드박스**:
  - **실시간 관전(LIVE)**, **뽑기판별 독립 최근 상황 로그**, **`[선택]` / `[랜덤]`** 빠른 기계 이동, **`[뽑기정보]`** 13종 제원 카드
  - 데스크톱 뽑기 시작 시 브라우저 스크롤 간섭을 막는 **확대 집중 모드** + 모든 팝업 **`Enter`/`Esc`** 단축키
  - `VITE_APP_MODE=sandbox` 빌드 시 실시간 토크/마찰/무게/슬로우모션(`0.5x`)/`world.debugRender()` 와이어프레임 튜닝 가능

---

## 🚀 로컬 실행 및 빌드

```bash
npm install
npm run dev                        # 프로덕션 UI 개발 서버 (http://localhost:4100)
npm run build                      # TypeScript 체크 + 프로덕션 dist/ 빌드
VITE_APP_MODE=sandbox npm run build # 물리 테스트 샌드박스 dist/ 빌드
```

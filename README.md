# 🕹️ Rapier3D UFO Catcher (Rust → WebAssembly)

**Rapier3D (`@dimforge/rapier3d-compat`, Rust → WASM)** + **Three.js** + **React / Vite**로 구현한 3D UFO 브릿지 크레인(2-Bar 하시와타시) 물리 시뮬레이터입니다. [Jolt Physics 버전](https://github.com/SilverRuler/Jolt-Physics)과 동일한 6종 상품·치수·튜닝 파라미터로 1:1 물리 감각을 비교할 수 있도록 설계했습니다.

## ✨ 핵심 물리 아키텍처
- **100% 실제 관절 모터 체인 (가짜 Constraint 없음)**:
  - `Kinematic Gantry` ↔ **`PrismaticImpulseJoint`** (Y축 윈치 + 하강 누르기 힘 제한) ↔ `Carrier`
  - `Carrier` ↔ **2축 `RevoluteImpulseJoint` 짐벌** (X/Z 케이블 흔들림, Yaw 회전 원천 고정) ↔ `Dynamic UFO Head`
  - `UFO Head` ↔ **2× `RevoluteImpulseJoint`** (ForceBased 토크 제한 모터 + 유연 하강 힌지) ↔ `2× Dynamic 3-세그먼트 곡면 집게 암`
- **실제 오락실 마찰·무게중심 분리**:
  - 크롬 금속 Bar(`0.28μ`)와 돌출된 빨간 실리콘 링(`0.76μ`)을 별도 물리 콜라이더로 분리
  - 상품별 내부 편심 무게추 + 120Hz 고정 타임스텝 + CCD(`setCcdEnabled(true)`)
- **네이티브 디버그 렌더러**: `world.debugRender()`로 Rapier 내부 콜라이더·조인트를 실시간 와이어프레임으로 관찰 가능

## 🚀 로컬 실행 및 빌드

```bash
npm install
npm run dev      # http://localhost:4100
npm run build    # TypeScript 체크 + dist/ 정적 빌드
```

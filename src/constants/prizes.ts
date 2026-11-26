export interface PlushColliderPart {
  pos: [number, number, number];
  half: [number, number, number];
  w: number;
}

export interface PrizeSpec {
  index: number;
  shortName: string;
  label: string;
  title: string;
  difficultyText: string;
  rewardSol: number;
  imgSrc: string;
  frontAccent: string;
  frontBg: string;
  sideAccent: string;
  sideBg: string;
  isSquare: boolean;
  isPlush: boolean;
  plushGeoSrc?: string;
  plushParts?: PlushColliderPart[];
  strategyTip: string;
  w: number;
  h: number;
  d: number;
  mass: number;
  friction: number;
  /** 실제 피규어 박스/인형 내부 편심 무게중심 (로컬 X, Y, Z) */
  comOffset: [number, number, number];
}

export interface PhysicsTuning {
  /** 집게 닫힘 모터 최대 힘/토크 */
  closeTorque: number;
  /** 집게 들어올림 유지 토크 */
  liftTorque: number;
  /** 하강 시 집게 힌지 유연성 토크 */
  descendFlexTorque: number;
  /** 크레인 최대 하강 누르기 힘 (N) */
  downPressForce: number;
  /** 중앙 빨간 실리콘 링 마찰 계수 */
  barRingFriction: number;
  /** 집게 실리콘 끝단 마찰 계수 */
  clawTipFriction: number;
  /** 상품 무게 배율 */
  massScale: number;
  /** 무게중심 편심 적용 여부 */
  useComOffset: boolean;
  /** 시뮬레이션 속도 (1.0 = 실시간, 0.5 = 슬로우모션) */
  timeScale: number;
  /** Rapier3D 콜라이더 와이어프레임 디버그 표시 */
  showColliders: boolean;
}

export const DEFAULT_PHYSICS_TUNING: PhysicsTuning = {
  closeTorque: 2.0,
  liftTorque: 2.0,
  descendFlexTorque: 4.2,
  downPressForce: 15,
  barRingFriction: 1.19,
  clawTipFriction: 0.96,
  massScale: 1.5,
  useComOffset: true,
  timeScale: 1.0,
  showColliders: false,
};

export const SANDBOX_DEFAULT_PHYSICS_TUNING: PhysicsTuning = {
  ...DEFAULT_PHYSICS_TUNING,
};

export const STAGE_PHYSICS = {
  BAR_Y: 0.72,
  BAR_RADIUS: 0.09,
  BAR_HALF_Z: 0.455,
  OUTER_BAR_Y: 1.06,
  OUTER_BAR_HALF_Z: 1.02,
  BAR_LENGTH: 3.6,

  DROP_Y_THRESHOLD: -0.28,
  CABINET_HALF_X: 1.78,
  CABINET_HALF_Z: 1.52,

  CLAW_HOME_X: -1.36,
  CLAW_HOME_Z: 1.42,
  CLAW_HOME_Y: 3.24,
  CLAW_MIN_X: -1.36,
  CLAW_MAX_X: 1.36,
  CLAW_MIN_Z: -1.18,
  CLAW_MAX_Z: 1.42,
  CLAW_DROP_Y: 1.24,
  CLAW_LIFT_Y: 3.04,
  MOVE_SPEED_X: 0.825,
  MOVE_SPEED_Z: 0.625,
  CLAW_DESCEND_SPEED: 0.475,
  CLAW_LIFT_SPEED: 0.58,
};

export const PRIZE_SPECS: PrizeSpec[] = [
  {
    index: 0,
    shortName: '1.프리렌',
    label: '프리렌 박스 #1',
    title: 'FRIEREN',
    difficultyText: '난이도 5 (보통)',
    rewardSol: 0.003,
    imgSrc: '/assets/frieren.png',
    frontAccent: '#bae6fd',
    frontBg: '#0369a1',
    sideAccent: '#7dd3fc',
    sideBg: '#0c4a6e',
    isSquare: false,
    isPlush: false,
    strategyTip: '가장 가볍고 컴팩트한 입문용 박스. 모서리를 가볍게 걸어 90° 회전시키면 수월하게 통과합니다.',
    w: 0.54,
    h: 0.52,
    d: 1.32,
    mass: 1.25,
    friction: 0.48,
    comOffset: [0, -0.03, 0.04],
  },
  {
    index: 1,
    shortName: '2.네즈코',
    label: '네즈코 박스 #2',
    title: 'NEZUKO',
    difficultyText: '난이도 6 (중상)',
    rewardSol: 0.008,
    imgSrc: '/assets/nezuko.png',
    frontAccent: '#fbcfe8',
    frontBg: '#be123c',
    sideAccent: '#f9a8d4',
    sideBg: '#881337',
    isSquare: false,
    isPlush: false,
    strategyTip: '표준 아케이드 규격 박스. 뒤쪽(-Z)에 무게중심이 살짝 실려 있어 앞모서리를 들어 돌리면 효과적입니다.',
    w: 0.60,
    h: 0.56,
    d: 1.44,
    mass: 1.48,
    friction: 0.50,
    comOffset: [0, -0.03, -0.05],
  },
  {
    index: 2,
    shortName: '3.페른',
    label: '페른 박스 #3',
    title: 'FERN',
    difficultyText: '난이도 5.5 (보통)',
    rewardSol: 0.006,
    imgSrc: '/assets/fern.png',
    frontAccent: '#e9d5ff',
    frontBg: '#6b21a8',
    sideAccent: '#c084fc',
    sideBg: '#3b0764',
    isSquare: false,
    isPlush: false,
    strategyTip: '균형 잡힌 중경량 박스. 프리렌보다 살짝 묵직하지만 회전 반경이 안정적이라 정석 브릿지 공략에 적합합니다.',
    w: 0.58,
    h: 0.54,
    d: 1.38,
    mass: 1.40,
    friction: 0.49,
    comOffset: [0.01, -0.03, 0.03],
  },
  {
    index: 3,
    shortName: '4.레제',
    label: '레제 박스 #4',
    title: 'REZE',
    difficultyText: '난이도 8 (고난도)',
    rewardSol: 0.015,
    imgSrc: '/assets/reze.png',
    frontAccent: '#f5d0fe',
    frontBg: '#7e22ce',
    sideAccent: '#e879f9',
    sideBg: '#581c87',
    isSquare: false,
    isPlush: false,
    strategyTip: '최고 리워드·최고 중량 마스터 박스. 정중앙보단 가벼운 쪽 끝단을 공략해 단계적으로 회전·밀어넣기하세요.',
    w: 0.66,
    h: 0.64,
    d: 1.58,
    mass: 1.76,
    friction: 0.54,
    comOffset: [-0.02, -0.04, 0.07],
  },
  {
    index: 4,
    shortName: '5.바니카',
    label: '바니카 박스 #5',
    title: 'VANICA',
    difficultyText: '난이도 6.5 (정사각)',
    rewardSol: 0.009,
    imgSrc: '/assets/vanica.png',
    frontAccent: '#fda4af',
    frontBg: '#9f1239',
    sideAccent: '#fb7185',
    sideBg: '#4c0519',
    isSquare: true,
    isPlush: false,
    strategyTip: '와이드 정사각 박스. 평면 회전으로는 통과하지 않으므로 옆으로 세우거나 한쪽 모서리를 눌러 떨어뜨려야 합니다.',
    w: 0.90,
    h: 0.58,
    d: 1.08,
    mass: 1.58,
    friction: 0.50,
    comOffset: [0, -0.04, 0.04],
  },
  {
    index: 5,
    shortName: '6.산드로네(3D)',
    label: '산드로네 3D 인형 #6',
    title: 'SANDRONE',
    difficultyText: '난이도 6.5 (3D 인형)',
    rewardSol: 0.005,
    imgSrc: '/assets/sandrone_plush.png',
    frontAccent: '#fde68a',
    frontBg: '#7f1d1d',
    sideAccent: '#f59e0b',
    sideBg: '#450a0a',
    isSquare: false,
    isPlush: true,
    plushGeoSrc: '/assets/sandrone_plush_geo.json',
    plushParts: [
      { pos: [0.05, 0, 0.02], half: [0.28, 0.21, 0.50], w: 0.45 },
      { pos: [0.04, 0, -0.44], half: [0.19, 0.18, 0.20], w: 0.20 },
      { pos: [-0.30, 0, 0.24], half: [0.15, 0.16, 0.30], w: 0.18 },
      { pos: [0.30, 0, 0.22], half: [0.14, 0.17, 0.28], w: 0.17 },
    ],
    strategyTip: '3D 입체 다이컷 쿠션 인형. 마찰력이 높아 미끄러지지 않으므로 좌/우 날개 끝단을 걸어 옆으로 세워 통과시키세요.',
    w: 0.96,
    h: 0.44,
    d: 1.36,
    mass: 1.32,
    friction: 0.62,
    comOffset: [0, -0.02, 0.03],
  },
  {
    index: 6,
    shortName: '7.루시',
    label: '루시 박스 #7',
    title: 'LUCY',
    difficultyText: '난이도 7 (어려움)',
    rewardSol: 0.011,
    imgSrc: '/assets/lucy.png',
    frontAccent: '#a7f3d0',
    frontBg: '#065f46',
    sideAccent: '#34d399',
    sideBg: '#022c22',
    isSquare: false,
    isPlush: false,
    strategyTip: '사이버펑크 감성의 중상급 박스. 길이가 길고 앞쪽으로 무게가 쏠려 있어 뒤쪽 끝단을 들어 올리며 회전시키세요.',
    w: 0.62,
    h: 0.58,
    d: 1.48,
    mass: 1.56,
    friction: 0.52,
    comOffset: [0.02, -0.03, 0.05],
  },
  {
    index: 7,
    shortName: '8.렘',
    label: '렘 박스 #8',
    title: 'REM',
    difficultyText: '난이도 7.5 (어려움)',
    rewardSol: 0.012,
    imgSrc: '/assets/rem.png',
    frontAccent: '#bfdbfe',
    frontBg: '#1d4ed8',
    sideAccent: '#60a5fa',
    sideBg: '#172554',
    isSquare: false,
    isPlush: false,
    strategyTip: '묵직한 하단 편심 무게중심 박스. 대각선 모서리를 정확히 집어 조금씩 각도를 트는 정밀 공략이 핵심입니다.',
    w: 0.64,
    h: 0.58,
    d: 1.52,
    mass: 1.64,
    friction: 0.53,
    comOffset: [-0.02, -0.04, 0.06],
  },
  {
    index: 8,
    shortName: '9.시노부',
    label: '시노부 박스 #9',
    title: 'SHINOBU',
    difficultyText: '난이도 5.5 (보통)',
    rewardSol: 0.005,
    imgSrc: '/assets/sinobu.png',
    frontAccent: '#ddd6fe',
    frontBg: '#5b21b6',
    sideAccent: '#a78bfa',
    sideBg: '#2e1065',
    isSquare: false,
    isPlush: false,
    strategyTip: '가볍고 민첩하게 움직이는 중경량 박스. 집게 한쪽 걸치기로도 각도 조절이 잘 되어 입문·연습에 좋습니다.',
    w: 0.56,
    h: 0.54,
    d: 1.36,
    mass: 1.34,
    friction: 0.48,
    comOffset: [0.01, -0.02, -0.03],
  },
  {
    index: 9,
    shortName: '10.마린(3D)',
    label: '키타가와 마린 3D 인형 #10',
    title: 'MARIN',
    difficultyText: '난이도 7 (3D 인형)',
    rewardSol: 0.010,
    imgSrc: '/assets/kitagawa_marine_plush.png',
    frontAccent: '#fbcfe8',
    frontBg: '#be185d',
    sideAccent: '#f472b6',
    sideBg: '#500724',
    isSquare: false,
    isPlush: true,
    plushGeoSrc: '/assets/kitagawa_marine_plush_geo.json',
    plushParts: [
      { pos: [0.0, 0, -0.387], half: [0.139, 0.202, 0.14], w: 0.20 },
      { pos: [0.008, 0, -0.008], half: [0.467, 0.202, 0.21], w: 0.45 },
      { pos: [0.0, 0, 0.38], half: [0.488, 0.202, 0.147], w: 0.35 },
    ],
    strategyTip: '넓은 퍼 러그 베이스가 특징인 3D 인형. 하단 러그 폭이 넓어 상단 머리쪽을 살짝 당긴 뒤 옆으로 세워 떨어뜨리세요.',
    w: 1.06,
    h: 0.46,
    d: 1.08,
    mass: 1.46,
    friction: 0.60,
    comOffset: [0, -0.03, 0.05],
  },
  {
    index: 10,
    shortName: '11.미쿠(3D)',
    label: '하쿠네 미쿠 3D 인형 #11',
    title: 'MIKU',
    difficultyText: '난이도 7.5 (3D 인형)',
    rewardSol: 0.012,
    imgSrc: '/assets/miku_plush.png',
    frontAccent: '#99f6e4',
    frontBg: '#0f766e',
    sideAccent: '#2dd4bf',
    sideBg: '#042f2e',
    isSquare: false,
    isPlush: true,
    plushGeoSrc: '/assets/miku_plush_geo.json',
    plushParts: [
      { pos: [0.041, 0, -0.517], half: [0.245, 0.194, 0.187], w: 0.24 },
      { pos: [0.0, 0, -0.01], half: [0.433, 0.194, 0.28], w: 0.44 },
      { pos: [-0.01, 0, 0.507], half: [0.423, 0.194, 0.196], w: 0.32 },
    ],
    strategyTip: '양갈래 트윈테일이 넓게 펼쳐진 3D 인형. 트윈테일 한쪽 끝을 집게로 걸어 뒤집듯 세우면 0.50m 틈새로 떨어집니다.',
    w: 0.94,
    h: 0.44,
    d: 1.44,
    mass: 1.52,
    friction: 0.61,
    comOffset: [0, -0.03, 0.04],
  },
  {
    index: 11,
    shortName: '12.타야마(3D)',
    label: '타야마 3D 인형 #12',
    title: 'TAYAMA',
    difficultyText: '난이도 8 (3D 인형)',
    rewardSol: 0.014,
    imgSrc: '/assets/tayama_plush.png',
    frontAccent: '#fecdd3',
    frontBg: '#881337',
    sideAccent: '#fb7185',
    sideBg: '#3b0712',
    isSquare: false,
    isPlush: true,
    plushGeoSrc: '/assets/tayama_plush_geo.json',
    plushParts: [
      { pos: [-0.022, 0, -0.56], half: [0.215, 0.194, 0.202], w: 0.30 },
      { pos: [0.033, 0, -0.011], half: [0.205, 0.194, 0.303], w: 0.44 },
      { pos: [-0.011, 0, 0.549], half: [0.143, 0.194, 0.212], w: 0.26 },
    ],
    strategyTip: '긴 롱 실루엣 + 고중량 3D 인형. 폭(0.52m)이 내경(0.50m)보다 미세하게 넓어 옆으로 눕혀 세우거나 비스듬히 꽂아야 통과합니다.',
    w: 0.52,
    h: 0.44,
    d: 1.56,
    mass: 1.60,
    friction: 0.62,
    comOffset: [0.01, -0.03, -0.04],
  },
];

export function getRestingPosition(spec: PrizeSpec): [number, number, number] {
  const y = STAGE_PHYSICS.BAR_Y + STAGE_PHYSICS.BAR_RADIUS + spec.h / 2 + 0.015;
  return [0, y, 0];
}

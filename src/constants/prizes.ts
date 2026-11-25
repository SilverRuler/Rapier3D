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
  w: number;
  h: number;
  d: number;
  mass: number;
  friction: number;
  /** 실제 피규어 박스 내부 편심 무게중심 (로컬 X, Y, Z) */
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
  closeTorque: 14.5,
  liftTorque: 11.2,
  descendFlexTorque: 4.2,
  downPressForce: 34,
  barRingFriction: 0.76,
  clawTipFriction: 0.96,
  massScale: 1.0,
  useComOffset: true,
  timeScale: 1.0,
  showColliders: false,
};

export const STAGE_PHYSICS = {
  BAR_Y: 0.72,
  BAR_RADIUS: 0.09,
  BAR_HALF_Z: 0.455, // 중앙 빨간 Bar (±0.455, 내경 틈새 0.73)
  OUTER_BAR_Y: 1.06,
  OUTER_BAR_HALF_Z: 1.02, // 외곽 파란 Bar (±1.02)
  BAR_LENGTH: 3.6,

  DROP_Y_THRESHOLD: -0.28,
  CABINET_HALF_X: 1.78,
  CABINET_HALF_Z: 1.52,

  CLAW_HOME_X: -1.28,
  CLAW_HOME_Z: 0.82,
  CLAW_HOME_Y: 2.68,
  CLAW_MIN_X: -1.28,
  CLAW_MAX_X: 1.28,
  CLAW_MIN_Z: -0.82,
  CLAW_MAX_Z: 0.82,
  CLAW_DROP_Y: 1.26,
  CLAW_LIFT_Y: 2.58,
  MOVE_SPEED_X: 0.86,
  MOVE_SPEED_Z: 0.66,
  CLAW_DESCEND_SPEED: 0.64,
  CLAW_LIFT_SPEED: 1.22,
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
    w: 0.60,
    h: 0.56,
    d: 1.44,
    mass: 1.48,
    friction: 0.50,
    comOffset: [0, -0.03, -0.05],
  },
  {
    index: 2,
    shortName: '3.노엘',
    label: '노엘 실바 박스 #3',
    title: 'NOEL SILVA',
    difficultyText: '난이도 7 (어려움)',
    rewardSol: 0.01,
    imgSrc: '/assets/noel_silva.png',
    frontAccent: '#bfdbfe',
    frontBg: '#1d4ed8',
    sideAccent: '#93c5fd',
    sideBg: '#1e3a8a',
    isSquare: false,
    isPlush: false,
    w: 0.63,
    h: 0.60,
    d: 1.50,
    mass: 1.62,
    friction: 0.52,
    comOffset: [0.02, -0.04, 0.06],
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
    w: 0.90,
    h: 0.58,
    d: 1.08,
    mass: 1.58,
    friction: 0.50,
    comOffset: [0, -0.04, 0.04],
  },
  {
    index: 5,
    shortName: '6.산드로네',
    label: '산드로네 쿠션 인형 #6',
    title: 'SANDRONE',
    difficultyText: '난이도 6.5 (입체 인형)',
    rewardSol: 0.01,
    imgSrc: '/assets/sandrone_plush.png',
    frontAccent: '#fde68a',
    frontBg: '#7f1d1d',
    sideAccent: '#f59e0b',
    sideBg: '#450a0a',
    isSquare: false,
    isPlush: true,
    w: 0.96,
    h: 0.44,
    d: 1.36,
    mass: 1.32,
    friction: 0.62,
    comOffset: [0, -0.02, 0.03],
  },
];

export function getRestingPosition(spec: PrizeSpec): [number, number, number] {
  const y = STAGE_PHYSICS.BAR_Y + STAGE_PHYSICS.BAR_RADIUS + spec.h / 2 + 0.015;
  return [0, y, 0];
}

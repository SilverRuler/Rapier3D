import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Volume2,
  VolumeX,
  Sparkles,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Camera,
  PackagePlus,
  RotateCcw,
  Loader2,
  Activity,
  Maximize2,
  Minimize2,
  LayoutGrid,
  Shuffle,
  Radio,
  X,
} from 'lucide-react';
import { GachaBoxItem } from '@/types/gacha';
import {
  GACHA_PHYSICS,
  getBoxDimensions,
  getBoxRewardAmount,
  isBoxAtInitialPose,
  isPlushSlot,
  PLUSH_CHUTE_HOME_X,
  PLUSH_CHUTE_HOME_Z,
  PLUSH_CHUTE_WALL_HEIGHT,
  PLUSH_FLOOR_Y,
  PLUSH_MOUND_SCALE,
} from '@/constants/gacha';
import {
  DEFAULT_PHYSICS_TUNING,
  getMachineProfile,
  PhysicsTuning,
  PRIZE_SPECS,
  PrizeSpec,
} from '@/constants/prizes';
import { isPrizeSpanningRedAndBlueBar } from '@/lib/gachaEffects';

type CameraView = 'front' | 'top' | 'right';

export type CranePhase =
  | 'idle'
  | 'free_move'
  | 'ready_right'
  | 'moving_right'
  | 'ready_up'
  | 'moving_up'
  | 'descending'
  | 'closing'
  | 'lifting'
  | 'carrying'
  | 'releasing'
  | 'settling';

export interface TurnFinishPayload {
  wonItemIds: string[];
  updatedItems: {
    id: string;
    position: [number, number, number];
    quaternion: [number, number, number, number];
    isInitialState?: boolean;
  }[];
  actionSummary: string;
}

interface RapierUfoMachine3DProps {
  items: GachaBoxItem[];
  isMyTurn: boolean;
  lockedByOther: string | null;
  turnKey: string | null;
  onTurnFinish: (payload: TurnFinishPayload) => void;
  onStartTurnRequest?: () => void;
  canStartTurn: boolean;
  selectedMember: string;
  selectedMemberTickets: number;
  isStarting: boolean;
  isFinishing?: boolean;
  sessionProgress?: { current: number; total: number; bonusPlays: number } | null;
  otherSessionProgress?: { current: number; total: number } | null;
  machineIndex: number;
  machineCount: number;
  machineLabel: string;
  machineDifficulty: string;
  machineRewardSol: number;
  onPrevMachine: () => void;
  onNextMachine: () => void;
  onSelectMachine?: (idx: number) => void;
  machineSummaries?: Array<{
    index: number;
    shortName: string;
    hasStock: boolean;
    lockedBy: string | null;
    suspended?: boolean;
  }>;
  isMachineSuspended?: boolean;
  isAdmin?: boolean;
  onAdminRefill?: () => void;
  onAdminReset?: () => void;
  isRefilling?: boolean;
  isResetting?: boolean;
  tuning?: PhysicsTuning;
  sandboxMode?: boolean;
}

interface PlushGeoJson {
  w: number;
  h: number;
  d: number;
  positions: number[];
  uvs: number[];
  indices: number[];
}

interface GachaLiveFrame {
  machineIndex: number;
  turnKey: string;
  member: string;
  phase: string;
  gantryX: number;
  gantryZ: number;
  headPos: [number, number, number];
  headQuat: [number, number, number, number];
  leftArmPos: [number, number, number];
  leftArmQuat: [number, number, number, number];
  rightArmPos: [number, number, number];
  rightArmQuat: [number, number, number, number];
  backArmPos?: [number, number, number];
  backArmQuat?: [number, number, number, number];
  frontArmPos?: [number, number, number];
  frontArmQuat?: [number, number, number, number];
  items: Array<{
    id: string;
    position: [number, number, number];
    quaternion: [number, number, number, number];
  }>;
  effect?: 'start' | 'balance_catch' | 'extreme_drr' | 'near_near' | 'finish_win' | 'strong_grip' | null;
  effectSeq?: number;
  ts: number;
}

const LIVE_PHASE_LABELS: Record<string, string> = {
  free_move: '4방향 위치 조준 중',
  ready_right: '우(→) 이동 대기',
  moving_right: '우(→) 이동 중',
  ready_up: '위(↑) 이동 대기',
  moving_up: '위(↑) 이동 중',
  descending: '집게 하강 중',
  closing: '상품 잡는 중',
  lifting: '들어올리는 중',
  carrying: '배출구로 운반 중',
  releasing: '드랍 중',
  settling: '안정화 중',
};

let rapierInitPromise: Promise<typeof RAPIER> | null = null;
function getRapier(): Promise<typeof RAPIER> {
  if (!rapierInitPromise) {
    rapierInitPromise = RAPIER.init().then(() => RAPIER);
  }
  return rapierInitPromise;
}

const cachedPlushGeoMap = new Map<string, PlushGeoJson>();
const plushGeoPromiseMap = new Map<string, Promise<PlushGeoJson | null>>();

function loadPlushGeoData(geoSrc: string): Promise<PlushGeoJson | null> {
  const hit = cachedPlushGeoMap.get(geoSrc);
  if (hit) return Promise.resolve(hit);
  let prom = plushGeoPromiseMap.get(geoSrc);
  if (!prom) {
    prom = fetch(geoSrc)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PlushGeoJson | null) => {
        if (data && Array.isArray(data.positions) && Array.isArray(data.indices)) {
          cachedPlushGeoMap.set(geoSrc, data);
          return data;
        }
        return null;
      })
      .catch(() => null);
    plushGeoPromiseMap.set(geoSrc, prom);
  }
  return prom;
}

function buildBufferGeometryFromPlushData(data: PlushGeoJson): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  geo.setIndex(data.indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function getSpecForSlot(slotIndex: number): PrizeSpec {
  const safeIdx = ((slotIndex % PRIZE_SPECS.length) + PRIZE_SPECS.length) % PRIZE_SPECS.length;
  return PRIZE_SPECS[safeIdx];
}

function createSidePanelTexture(title: string, accent: string, bg: string, rewardSol: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 256, 128);
    grad.addColorStop(0, bg);
    grad.addColorStop(1, '#090d16');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 128);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 244, 116);

    ctx.fillStyle = accent;
    ctx.font = '900 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 128, 52);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(`AIAL PRIZE · ${rewardSol} SOL`, 128, 88);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createFigureFrontTexture(slotIndex: number, label: string): THREE.CanvasTexture {
  const spec = getSpecForSlot(slotIndex);
  const cw = spec.isSquare ? 384 : 256;
  const ch = spec.isSquare ? 440 : 512;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const drawArtwork = (loadedImg?: HTMLImageElement) => {
    if (!ctx) return;
    ctx.fillStyle = spec.frontBg;
    ctx.fillRect(0, 0, cw, ch);

    if (loadedImg && loadedImg.width > 0 && loadedImg.height > 0) {
      const drawW = cw - 16;
      const drawH = spec.isSquare ? ch - 84 : ch - 16;
      const targetAspect = drawW / drawH;
      const srcAspect = loadedImg.width / loadedImg.height;
      let sx = 0;
      let sy = 0;
      let sw = loadedImg.width;
      let sh = loadedImg.height;
      if (srcAspect > targetAspect) {
        sw = loadedImg.height * targetAspect;
        sx = (loadedImg.width - sw) / 2;
      } else {
        sh = loadedImg.width / targetAspect;
        sy = (loadedImg.height - sh) * 0.2;
      }
      ctx.drawImage(loadedImg, sx, sy, sw, sh, 8, 8, drawW, drawH);
    }

    const bannerH = 70;
    const bannerY = ch - bannerH - 8;
    ctx.fillStyle = 'rgba(7, 11, 24, 0.84)';
    ctx.fillRect(8, bannerY, cw - 16, bannerH);

    ctx.fillStyle = spec.frontAccent;
    ctx.font = `900 ${spec.isSquare ? 28 : 24}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.title, cw / 2, bannerY + 24);

    ctx.fillStyle = '#fde047';
    ctx.font = `bold ${spec.isSquare ? 17 : 15}px monospace`;
    ctx.fillText(`${label} · ${getBoxRewardAmount(slotIndex)} SOL`, cw / 2, bannerY + 52);

    ctx.strokeStyle = spec.frontAccent;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, cw - 10, ch - 10);

    tex.needsUpdate = true;
  };

  drawArtwork();

  const img = new window.Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => drawArtwork(img);
  img.src = spec.imgSrc;

  return tex;
}

function createFigureBoxMaterials(slotIndex: number, label: string): THREE.MeshStandardMaterial[] {
  const spec = getSpecForSlot(slotIndex);
  const rewardSol = getBoxRewardAmount(slotIndex);
  const frontTex = createFigureFrontTexture(slotIndex, label);
  const sideTex = createSidePanelTexture(spec.title, spec.sideAccent, spec.sideBg, rewardSol);
  const frontMat = new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.24, metalness: 0.14 });
  const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.30, metalness: 0.22 });
  return [sideMat, sideMat, frontMat, frontMat, sideMat, sideMat];
}

function createPlushMaterial(imgSrc: string): THREE.MeshStandardMaterial {
  const loader = new THREE.TextureLoader();
  const tex = loader.load(imgSrc);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.72,
    metalness: 0.04,
    alphaTest: 0.08,
  });
}

// 롱 <> 다이아몬드 갈고리 형상 (+36% 연장 · 높이 0.44~0.64m 전 상품 하단까지 깊게 감싸며 닫힘 시 끝단이 중앙 x≈0에서 맞닿음)
const ARM_SEGMENTS = [
  { pos: [0.12, -0.23, 0] as const, rotZ: 0.48, half: [0.028, 0.26, 0.045] as const, mass: 0.12, isTip: false },
  { pos: [0.11, -0.68, 0] as const, rotZ: -0.53, half: [0.026, 0.256, 0.052] as const, mass: 0.12, isTip: false },
  { pos: [-0.105, -0.91, 0] as const, rotZ: 0.03, half: [0.082, 0.025, 0.072] as const, mass: 0.09, isTip: true },
];

const CLAW_OPEN_ANGLE = 0.72;
const CLAW_RELEASE_ANGLE = 0.94;
const CLAW_CLOSE_TARGET = -0.05;

const G_ENV = 1 << 0;
const G_BAR = 1 << 1;
const G_PRIZE = 1 << 2;
const G_HEAD = 1 << 3;
const G_ARM = 1 << 4;
const makeGroup = (membership: number, filter: number) =>
  ((membership & 0xffff) << 16) | (filter & 0xffff);

export const RapierUfoMachine3D: React.FC<RapierUfoMachine3DProps> = ({
  items,
  isMyTurn,
  lockedByOther,
  turnKey,
  onTurnFinish,
  onStartTurnRequest,
  canStartTurn,
  selectedMember,
  selectedMemberTickets,
  isStarting,
  isFinishing = false,
  sessionProgress = null,
  otherSessionProgress = null,
  machineIndex,
  machineCount,
  machineLabel,
  machineDifficulty,
  machineRewardSol,
  onPrevMachine,
  onNextMachine,
  onSelectMachine,
  machineSummaries = [],
  isMachineSuspended = false,
  isAdmin = false,
  onAdminRefill,
  onAdminReset,
  isRefilling = false,
  isResetting = false,
  tuning = DEFAULT_PHYSICS_TUNING,
  sandboxMode = false,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [phase, setPhase] = useState<CranePhase>('idle');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [droppedThisTurn, setDroppedThisTurn] = useState(0);
  const [cameraView, setCameraView] = useState<CameraView>('front');
  const [frontTiptoeDeg, setFrontTiptoeDeg] = useState(0);
  const [showExtremeDrr, setShowExtremeDrr] = useState(false);
  const [showBalanceCatch, setShowBalanceCatch] = useState(false);
  const [showStartPopup, setShowStartPopup] = useState(false);
  const [showNearNear, setShowNearNear] = useState(false);
  const [showFinishWin, setShowFinishWin] = useState(false);
  const [showStrongGrip, setShowStrongGrip] = useState(false);
  const [spectateLiveActive, setSpectateLiveActive] = useState(false);
  const [spectatePhase, setSpectatePhase] = useState<string>('');
  const [isMachinePickerOpen, setIsMachinePickerOpen] = useState(false);
  const [isSpectatePickerOpen, setIsSpectatePickerOpen] = useState(false);
  const [spectateToast, setSpectateToast] = useState<string>('');
  const machineTabsRef = useRef<HTMLDivElement>(null);
  const spectateToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSpectateToast = useCallback((msg: string) => {
    setSpectateToast(msg);
    if (spectateToastTimerRef.current) clearTimeout(spectateToastTimerRef.current);
    spectateToastTimerRef.current = setTimeout(() => setSpectateToast(''), 2600);
  }, []);

  useEffect(() => {
    if (!isMachinePickerOpen && !isSpectatePickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsMachinePickerOpen(false);
        setIsSpectatePickerOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMachinePickerOpen, isSpectatePickerOpen]);

  useEffect(() => {
    const el = machineTabsRef.current;
    if (!el) return;
    const activeBtn = el.querySelector<HTMLButtonElement>(`button[data-machine-idx="${machineIndex}"]`);
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }
  }, [machineIndex]);

  const phaseRef = useRef<CranePhase>('idle');
  const soundEnabledRef = useRef(true);
  const cameraViewRef = useRef<CameraView>('front');
  const frontTiptoeDegRef = useRef(0);
  const tuningRef = useRef<PhysicsTuning>(tuning);
  const targetRedBarHalfZ = getMachineProfile(machineIndex).redBarHalfZ;
  const redBarHalfZRef = useRef<number>(targetRedBarHalfZ);
  const itemsRef = useRef<GachaBoxItem[]>(items);
  const onTurnFinishRef = useRef(onTurnFinish);
  const isMyTurnRef = useRef(isMyTurn);
  const lockedByOtherRef = useRef<string | null>(lockedByOther);
  const machineIndexRef = useRef(machineIndex);
  const selectedMemberRef = useRef(selectedMember);
  const turnKeyRef = useRef<string | null>(turnKey);
  const sandboxModeRef = useRef(sandboxMode);
  const spectateFrameRef = useRef<GachaLiveFrame | null>(null);
  const lastLivePostTimeRef = useRef(0);
  const livePostInFlightRef = useRef(false);
  const liveEffectRef = useRef<{ effect: GachaLiveFrame['effect']; seq: number }>({ effect: null, seq: 0 });
  const lastSpectateEffectSeqRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const drrAudioRef = useRef<HTMLAudioElement | null>(null);
  const bcAudioRef = useRef<HTMLAudioElement | null>(null);
  const startAudioRef = useRef<HTMLAudioElement | null>(null);
  const nearAudio1Ref = useRef<HTMLAudioElement | null>(null);
  const nearAudio2Ref = useRef<HTMLAudioElement | null>(null);
  const finishAudioRef = useRef<HTMLAudioElement | null>(null);
  const powerupAudioRef = useRef<HTMLAudioElement | null>(null);
  const drrTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bcTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strongGripTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  itemsRef.current = items;
  tuningRef.current = tuning;
  redBarHalfZRef.current = targetRedBarHalfZ;
  isMyTurnRef.current = isMyTurn;
  lockedByOtherRef.current = lockedByOther;
  machineIndexRef.current = machineIndex;
  selectedMemberRef.current = selectedMember;
  turnKeyRef.current = turnKey;
  sandboxModeRef.current = sandboxMode;

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);
  useEffect(() => {
    cameraViewRef.current = cameraView;
  }, [cameraView]);
  useEffect(() => {
    frontTiptoeDegRef.current = frontTiptoeDeg;
  }, [frontTiptoeDeg]);
  useEffect(() => {
    onTurnFinishRef.current = onTurnFinish;
  }, [onTurnFinish]);

  useEffect(() => {
    const mkAudio = (src: string, vol = 0.88) => {
      const a = new Audio(src);
      a.preload = 'auto';
      a.volume = vol;
      return a;
    };
    drrAudioRef.current = mkAudio('/assets/drr.mp3', 0.85);
    bcAudioRef.current = mkAudio('/assets/bc.mp3', 0.9);
    startAudioRef.current = mkAudio('/assets/start.mp3', 0.88);
    nearAudio1Ref.current = mkAudio('/assets/nearnear.mp3', 0.9);
    nearAudio2Ref.current = mkAudio('/assets/nearnear2.mp3', 0.9);
    finishAudioRef.current = mkAudio('/assets/finish.mp3', 0.92);
    powerupAudioRef.current = mkAudio('/assets/powerup.wav', 0.92);

    return () => {
      if (drrTimeoutRef.current) clearTimeout(drrTimeoutRef.current);
      if (bcTimeoutRef.current) clearTimeout(bcTimeoutRef.current);
      if (startTimeoutRef.current) clearTimeout(startTimeoutRef.current);
      if (nearTimeoutRef.current) clearTimeout(nearTimeoutRef.current);
      if (finishTimeoutRef.current) clearTimeout(finishTimeoutRef.current);
      if (strongGripTimeoutRef.current) clearTimeout(strongGripTimeoutRef.current);
    };
  }, []);

  const setCranePhase = useCallback((next: CranePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const playTone = useCallback((freq: number, duration = 0.08, type: OscillatorType = 'triangle', gainVal = 0.08) => {
    if (!soundEnabledRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AudioCtx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {}
  }, []);

  const triggerExtremeDrr = useCallback(() => {
    setShowExtremeDrr(true);
    if (isMyTurnRef.current) {
      liveEffectRef.current = { effect: 'extreme_drr', seq: liveEffectRef.current.seq + 1 };
    }
    if (drrTimeoutRef.current) clearTimeout(drrTimeoutRef.current);
    drrTimeoutRef.current = setTimeout(() => setShowExtremeDrr(false), 1000);
    if (soundEnabledRef.current && drrAudioRef.current) {
      try {
        drrAudioRef.current.currentTime = 0;
        drrAudioRef.current.play().catch(() => {});
      } catch {}
    }
  }, []);

  const triggerBalanceCatch = useCallback(() => {
    setShowBalanceCatch(true);
    if (isMyTurnRef.current) {
      liveEffectRef.current = { effect: 'balance_catch', seq: liveEffectRef.current.seq + 1 };
    }
    if (bcTimeoutRef.current) clearTimeout(bcTimeoutRef.current);
    bcTimeoutRef.current = setTimeout(() => setShowBalanceCatch(false), 1500);
    if (soundEnabledRef.current && bcAudioRef.current) {
      try {
        bcAudioRef.current.currentTime = 0;
        bcAudioRef.current.play().catch(() => {});
      } catch {}
    }
  }, []);

  const triggerStartPopup = useCallback((playStartAudio: boolean) => {
    setShowStartPopup(true);
    if (isMyTurnRef.current) {
      liveEffectRef.current = { effect: 'start', seq: liveEffectRef.current.seq + 1 };
    }
    if (startTimeoutRef.current) clearTimeout(startTimeoutRef.current);
    startTimeoutRef.current = setTimeout(() => setShowStartPopup(false), 1200);
    if (playStartAudio && soundEnabledRef.current && startAudioRef.current) {
      try {
        startAudioRef.current.currentTime = 0;
        startAudioRef.current.play().catch(() => {});
      } catch {}
    }
  }, []);

  const triggerNearNear = useCallback(() => {
    setShowNearNear(true);
    if (isMyTurnRef.current) {
      liveEffectRef.current = { effect: 'near_near', seq: liveEffectRef.current.seq + 1 };
    }
    if (nearTimeoutRef.current) clearTimeout(nearTimeoutRef.current);
    nearTimeoutRef.current = setTimeout(() => setShowNearNear(false), 1600);
    if (soundEnabledRef.current) {
      const pick = Math.random() < 0.5 ? nearAudio1Ref.current : nearAudio2Ref.current;
      if (pick) {
        try {
          pick.currentTime = 0;
          pick.play().catch(() => {});
        } catch {}
      }
    }
  }, []);

  const triggerFinishWin = useCallback(() => {
    setShowFinishWin(true);
    if (isMyTurnRef.current) {
      liveEffectRef.current = { effect: 'finish_win', seq: liveEffectRef.current.seq + 1 };
    }
    if (finishTimeoutRef.current) clearTimeout(finishTimeoutRef.current);
    finishTimeoutRef.current = setTimeout(() => setShowFinishWin(false), 2000);
    if (soundEnabledRef.current && finishAudioRef.current) {
      try {
        finishAudioRef.current.currentTime = 0;
        finishAudioRef.current.play().catch(() => {});
      } catch {}
    }
  }, []);

  const triggerStrongGrip = useCallback(() => {
    setShowStrongGrip(true);
    if (isMyTurnRef.current) {
      liveEffectRef.current = { effect: 'strong_grip', seq: liveEffectRef.current.seq + 1 };
    }
    if (strongGripTimeoutRef.current) clearTimeout(strongGripTimeoutRef.current);
    strongGripTimeoutRef.current = setTimeout(() => setShowStrongGrip(false), 1600);
    if (soundEnabledRef.current && powerupAudioRef.current) {
      try {
        powerupAudioRef.current.currentTime = 0;
        powerupAudioRef.current.play().catch(() => {});
      } catch {}
    }
  }, []);

  // 실시간 관전 SSE 구독 (다른 플레이어가 진행 중일 때만 연결)
  useEffect(() => {
    if (sandboxMode || !lockedByOther || isMyTurn) {
      spectateFrameRef.current = null;
      lastSpectateEffectSeqRef.current = 0;
      setSpectateLiveActive(false);
      setSpectatePhase('');
      return;
    }

    const es = new EventSource(`/api/gacha/live?machineIndex=${machineIndex}`);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg?.type === 'clear') {
          spectateFrameRef.current = null;
          setSpectateLiveActive(false);
          setSpectatePhase('');
          return;
        }
        if (msg?.type === 'frame' && msg.frame) {
          const frame = msg.frame as GachaLiveFrame;
          spectateFrameRef.current = frame;
          setSpectateLiveActive(true);
          setSpectatePhase(frame.phase || '');
          if (frame.effect && typeof frame.effectSeq === 'number' && frame.effectSeq !== lastSpectateEffectSeqRef.current) {
            lastSpectateEffectSeqRef.current = frame.effectSeq;
            const plushSpec = isPlushSlot(machineIndex);
            if (frame.effect === 'start') triggerStartPopup(false);
            else if (!plushSpec && frame.effect === 'balance_catch') triggerBalanceCatch();
            else if (!plushSpec && frame.effect === 'extreme_drr') triggerExtremeDrr();
            else if (!plushSpec && frame.effect === 'near_near') triggerNearNear();
            else if (frame.effect === 'strong_grip') triggerStrongGrip();
            else if (frame.effect === 'finish_win') triggerFinishWin();
          }
        }
      } catch {}
    };
    es.onerror = () => {
      // EventSource automatically reconnects
    };

    return () => {
      es.close();
      spectateFrameRef.current = null;
      setSpectateLiveActive(false);
      setSpectatePhase('');
    };
  }, [
    sandboxMode,
    lockedByOther,
    isMyTurn,
    machineIndex,
    triggerStartPopup,
    triggerBalanceCatch,
    triggerExtremeDrr,
    triggerNearNear,
    triggerFinishWin,
    triggerStrongGrip,
  ]);

  const freeMoveKeysRef = useRef<{ up: boolean; down: boolean; left: boolean; right: boolean }>({
    up: false,
    down: false,
    left: false,
    right: false,
  });
  const [freeDirState, setFreeDirState] = useState<{
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
  }>({ up: false, down: false, left: false, right: false });

  const clearFreeMove = useCallback(() => {
    freeMoveKeysRef.current = { up: false, down: false, left: false, right: false };
    setFreeDirState((prev) =>
      prev.up || prev.down || prev.left || prev.right
        ? { up: false, down: false, left: false, right: false }
        : prev
    );
  }, []);

  const setFreeDir = useCallback((dir: 'up' | 'down' | 'left' | 'right', active: boolean) => {
    if (active && phaseRef.current !== 'free_move') return;
    if (active && cameraViewRef.current !== 'front') {
      setCameraView('front');
      cameraViewRef.current = 'front';
    }
    if (freeMoveKeysRef.current[dir] === active) return;
    freeMoveKeysRef.current[dir] = active;
    setFreeDirState((prev) => (prev[dir] === active ? prev : { ...prev, [dir]: active }));
  }, []);

  const simControlRef = useRef<{
    syncFromItems: (nextItems: GachaBoxItem[]) => void;
    resetClawToHome: () => void;
    prepareTurnStart: (nextItems: GachaBoxItem[]) => void;
    startDescending: () => void;
    applyLiveTuning: (t: PhysicsTuning) => void;
    rebuildPrizesForTuning: () => void;
    updateRedBarSpacing: (halfZ: number) => void;
  } | null>(null);

  const handlePlushGrab = useCallback(() => {
    if (phaseRef.current !== 'free_move') return;
    clearFreeMove();
    simControlRef.current?.startDescending();
  }, [clearFreeMove]);

  useEffect(() => {
    if (isMyTurn && turnKey && engineReady) {
      setCameraView('front');
      cameraViewRef.current = 'front';
      setDroppedThisTurn(0);
      clearFreeMove();
      const curItems = itemsRef.current;
      const isInitialPoseOnly =
        curItems.length > 0 && curItems.every((it) => isBoxAtInitialPose(it));
      simControlRef.current?.prepareTurnStart(curItems);
      setCranePhase(isPlushSlot(machineIndex) ? 'free_move' : 'ready_right');
      triggerStartPopup(isInitialPoseOnly || isPlushSlot(machineIndex));
    } else if (!isMyTurn && phaseRef.current !== 'idle') {
      clearFreeMove();
      setCranePhase('idle');
    }
  }, [isMyTurn, turnKey, engineReady, machineIndex, clearFreeMove, setCranePhase, triggerStartPopup]);

  useEffect(() => {
    if (engineReady && !isMyTurn && !isFinishing && phaseRef.current === 'idle') {
      simControlRef.current?.syncFromItems(items);
    }
  }, [items, engineReady, isMyTurn, isFinishing]);

  useEffect(() => {
    if (engineReady) {
      simControlRef.current?.updateRedBarSpacing(targetRedBarHalfZ);
    }
    if (engineReady && !isMyTurn && !isFinishing && phaseRef.current === 'idle') {
      setDroppedThisTurn(0);
      simControlRef.current?.resetClawToHome();
      simControlRef.current?.syncFromItems(itemsRef.current);
    }
  }, [machineIndex, targetRedBarHalfZ, engineReady, isMyTurn, isFinishing]);

  useEffect(() => {
    if (engineReady) {
      simControlRef.current?.applyLiveTuning(tuning);
    }
  }, [
    engineReady,
    tuning.downPressForce,
    tuning.clawTipFriction,
    tuning.barRingFriction,
    tuning.showColliders,
    tuning,
  ]);

  useEffect(() => {
    if (engineReady && phaseRef.current === 'idle') {
      simControlRef.current?.rebuildPrizesForTuning();
    }
  }, [engineReady, tuning.massScale, tuning.useComOffset]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let disposed = false;
    let animId = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let worldRef: RAPIER.World | null = null;
    let handleResize: (() => void) | null = null;

    getRapier()
      .then((Rapier) => {
        if (disposed || !container) return;

        const width = container.clientWidth || 720;
        const height = container.clientHeight || 460;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#040c14');
        scene.fog = new THREE.FogExp2('#040c14', 0.042);

        const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
        let viewportW = width;
        let viewportH = height;

        const getCameraPose = (view: CameraView, w: number, h: number, tiptoeDeg = 0) => {
          const aspect = Math.max(0.55, w / Math.max(1, h));
          const scale = aspect < 1.48 ? Math.min(1.95, 1.52 / aspect) : 1.0;
          const fov = aspect < 1.15 ? 48 : 42;
          if (view === 'top') {
            return {
              fov,
              pos: new THREE.Vector3(0, 7.45 * Math.max(1, scale * 0.88), 0.62),
              look: new THREE.Vector3(0, 0.78, 0.08),
            };
          }
          if (view === 'right') {
            return {
              fov,
              pos: new THREE.Vector3(5.35 * Math.max(1, scale * 0.85), 2.48 * (1 + (scale - 1) * 0.3), 0),
              look: new THREE.Vector3(0, 1.05, 0),
            };
          }
          const lookY = 0.98;
          const baseY = 3.55 * (1 + (scale - 1) * 0.62);
          const baseZ = 5.25 * scale;
          const clampedTiptoe = Math.max(0, Math.min(45, tiptoeDeg));
          if (clampedTiptoe <= 0) {
            return {
              fov,
              pos: new THREE.Vector3(0, baseY, baseZ),
              look: new THREE.Vector3(0, lookY, 0),
            };
          }
          const dy = baseY - lookY;
          const radius = Math.hypot(dy, baseZ);
          const baseElevRad = Math.atan2(dy, baseZ);
          const maxElevRad = (56.2 * Math.PI) / 180;
          const elevRad = baseElevRad + (clampedTiptoe / 45) * (maxElevRad - baseElevRad);
          return {
            fov,
            pos: new THREE.Vector3(0, lookY + radius * Math.sin(elevRad), radius * Math.cos(elevRad)),
            look: new THREE.Vector3(0, lookY, 0),
          };
        };

        const currentLookAt = new THREE.Vector3(0, 0.78, 0);
        const applyResponsiveCamera = (w: number, h: number, snap = false) => {
          viewportW = w;
          viewportH = h;
          const pose = getCameraPose(cameraViewRef.current, w, h, frontTiptoeDegRef.current);
          camera.aspect = Math.max(0.55, w / Math.max(1, h));
          camera.fov = pose.fov;
          if (snap) {
            camera.position.copy(pose.pos);
            currentLookAt.copy(pose.look);
            camera.lookAt(currentLookAt);
          }
          camera.updateProjectionMatrix();
        };
        applyResponsiveCamera(width, height, true);

        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight('#cbd5e1', 0.9));
        const mainSpot = new THREE.SpotLight('#fffbeb', 45, 22, Math.PI / 3.1, 0.45, 1.2);
        mainSpot.position.set(0, 6.5, 2.2);
        mainSpot.castShadow = true;
        mainSpot.shadow.mapSize.set(1024, 1024);
        scene.add(mainSpot);

        const emeraldLight = new THREE.PointLight('#10b981', 12, 12);
        emeraldLight.position.set(-2.1, 2.5, 1.2);
        scene.add(emeraldLight);

        const amberLight = new THREE.PointLight('#f59e0b', 11, 12);
        amberLight.position.set(2.1, 2.5, 1.2);
        scene.add(amberLight);

        const chuteLight = new THREE.PointLight('#14b8a6', 9, 9);
        chuteLight.position.set(0, -0.7, 0);
        scene.add(chuteLight);

        const cabinetGroup = new THREE.Group();
        scene.add(cabinetGroup);

        const chuteFloor = new THREE.Mesh(
          new THREE.BoxGeometry(4.0, 0.15, 4.16),
          new THREE.MeshStandardMaterial({
            color: '#064e3b',
            emissive: '#059669',
            emissiveIntensity: 0.35,
            roughness: 0.3,
            metalness: 0.4,
          })
        );
        chuteFloor.position.set(0, -1.55, 0);
        chuteFloor.receiveShadow = true;
        cabinetGroup.add(chuteFloor);

        const gridHelper = new THREE.GridHelper(4.0, 10, '#10b981', '#065f46');
        gridHelper.position.set(0, -1.46, 0);
        cabinetGroup.add(gridHelper);

        const pillarGeo = new THREE.CylinderGeometry(0.07, 0.07, 5.5, 16);
        const pillarMat = new THREE.MeshStandardMaterial({
          color: '#1e293b',
          emissive: '#10b981',
          emissiveIntensity: 0.35,
          metalness: 0.7,
          roughness: 0.2,
        });
        const pillarX = GACHA_PHYSICS.CABINET_HALF_X + 0.1;
        [
          [-pillarX, 1.2, -1.98],
          [pillarX, 1.2, -1.98],
          [-pillarX, 1.2, 1.98],
          [pillarX, 1.2, 1.98],
        ].forEach(([px, py, pz]) => {
          const p = new THREE.Mesh(pillarGeo, pillarMat);
          p.position.set(px, py, pz);
          cabinetGroup.add(p);
        });

        const frameBarMat = new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.8, roughness: 0.25 });
        const railSideGeo = new THREE.BoxGeometry(0.12, 0.12, 4.12);
        [-pillarX, pillarX].forEach((rx) => {
          const r = new THREE.Mesh(railSideGeo, frameBarMat);
          r.position.set(rx, 3.82, 0);
          cabinetGroup.add(r);
        });

        const gantryBeam = new THREE.Mesh(
          new THREE.BoxGeometry(GACHA_PHYSICS.BAR_LENGTH + 0.2, 0.1, 0.14),
          new THREE.MeshStandardMaterial({ color: '#64748b', metalness: 0.85, roughness: 0.2 })
        );
        gantryBeam.position.set(0, 3.82, GACHA_PHYSICS.CLAW_HOME_Z);
        scene.add(gantryBeam);

        const trolleyMesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.16, 0.24),
          new THREE.MeshStandardMaterial({ color: '#10b981', metalness: 0.75, roughness: 0.2 })
        );
        trolleyMesh.position.set(GACHA_PHYSICS.CLAW_HOME_X, 3.82, GACHA_PHYSICS.CLAW_HOME_Z);
        scene.add(trolleyMesh);

        const acrylicMat = new THREE.MeshPhysicalMaterial({
          color: '#94a3b8',
          transparent: true,
          opacity: 0.11,
          roughness: 0.1,
          metalness: 0.1,
          side: THREE.DoubleSide,
        });
        const backGlass = new THREE.Mesh(new THREE.PlaneGeometry(GACHA_PHYSICS.BAR_LENGTH + 0.16, 4.0), acrylicMat);
        backGlass.position.set(0, 1.1, -1.96);
        cabinetGroup.add(backGlass);

        [-(GACHA_PHYSICS.CABINET_HALF_X + 0.06), GACHA_PHYSICS.CABINET_HALF_X + 0.06].forEach((sx) => {
          const sideGlass = new THREE.Mesh(new THREE.PlaneGeometry(3.96, 4.0), acrylicMat);
          sideGlass.rotation.y = Math.PI / 2;
          sideGlass.position.set(sx, 1.1, 0);
          cabinetGroup.add(sideGlass);
        });

        const activeProfile = getMachineProfile(machineIndex);
        const isPlushMachine = isPlushSlot(machineIndex);
        const headScale = activeProfile.headScale;
        const armPivotX = (isPlushMachine ? 0.20 : 0.22) * headScale;
        // 3D 뽑기 전용: 다리 길이 추가 -30%(10→7 비율), <> 꺾임 각도 완화(0.31/-0.35 rad), 얇은 스틸 암 + 소형 팁
        const PLUSH_ARM_BASE = [
          { pos: [0.036, -0.112, 0] as const, rotZ: 0.31, half: [0.011, 0.118, 0.019] as const, mass: 0.08, isTip: false },
          { pos: [0.032, -0.333, 0] as const, rotZ: -0.35, half: [0.010, 0.116, 0.021] as const, mass: 0.08, isTip: false },
          { pos: [-0.040, -0.445, 0] as const, rotZ: 0.03, half: [0.048, 0.017, 0.042] as const, mass: 0.06, isTip: true },
        ];
        const scaledArmSegments = isPlushMachine
          ? PLUSH_ARM_BASE.map((seg) => ({
              ...seg,
              pos: [
                seg.pos[0] * activeProfile.armSizeScale,
                seg.pos[1] * activeProfile.armLengthScale,
                seg.pos[2],
              ] as const,
              half: [
                seg.half[0] * activeProfile.armSizeScale,
                seg.half[1] * activeProfile.armLengthScale,
                seg.half[2] * activeProfile.armSizeScale,
              ] as const,
            }))
          : ARM_SEGMENTS.map((seg) => ({
              ...seg,
              pos: [seg.pos[0] * activeProfile.armSizeScale, seg.pos[1] * activeProfile.armLengthScale, seg.pos[2]] as const,
              half: [
                seg.half[0] * activeProfile.armSizeScale,
                seg.half[1] * activeProfile.armLengthScale,
                seg.half[2] * activeProfile.armSizeScale,
              ] as const,
            }));
        const armBottomReach = (isPlushMachine ? 0.462 : 0.935) * activeProfile.armLengthScale;
        const effectiveDropY = isPlushMachine
          ? Number((PLUSH_FLOOR_Y + armBottomReach + 0.045).toFixed(3))
          : Number((GACHA_PHYSICS.CLAW_DROP_Y + (activeProfile.armLengthScale - 1.0) * 0.86).toFixed(3));
        const effectiveLiftY = isPlushMachine ? 3.36 : GACHA_PHYSICS.CLAW_LIFT_Y;

        if (!isPlushMachine) {
          const rampVisualGeo = new THREE.BoxGeometry(GACHA_PHYSICS.BAR_LENGTH, 0.05, 0.84);
          const rampVisualMat = new THREE.MeshPhysicalMaterial({
            color: '#10b981',
            transparent: true,
            opacity: 0.16,
            roughness: 0.2,
          });
          const frontRampMesh = new THREE.Mesh(rampVisualGeo, rampVisualMat);
          frontRampMesh.position.set(0, 1.24, 1.86);
          frontRampMesh.rotation.x = -0.72;
          cabinetGroup.add(frontRampMesh);

          const backRampMesh = new THREE.Mesh(rampVisualGeo, rampVisualMat);
          backRampMesh.position.set(0, 1.24, -1.86);
          backRampMesh.rotation.x = 0.72;
          cabinetGroup.add(backRampMesh);
        }

        const barGeo = new THREE.CylinderGeometry(
          GACHA_PHYSICS.BAR_RADIUS,
          GACHA_PHYSICS.BAR_RADIUS,
          GACHA_PHYSICS.BAR_LENGTH,
          24
        );
        barGeo.rotateZ(Math.PI / 2);
        const barMatVisual = new THREE.MeshStandardMaterial({
          color: '#e2e8f0',
          metalness: 0.92,
          roughness: 0.14,
        });
        const ringGeo = new THREE.TorusGeometry(GACHA_PHYSICS.BAR_RADIUS + 0.009, 0.016, 10, 24);
        ringGeo.rotateY(Math.PI / 2);
        const redRingMat = new THREE.MeshStandardMaterial({
          color: '#f43f5e',
          emissive: '#e11d48',
          emissiveIntensity: 0.4,
          roughness: 0.55,
        });
        const blueRingMat = new THREE.MeshStandardMaterial({
          color: '#38bdf8',
          emissive: '#0284c7',
          emissiveIntensity: 0.35,
          roughness: 0.55,
        });

        const initRedHalfZ = activeProfile.redBarHalfZ;
        const initOuterHalfZ = activeProfile.outerBarHalfZ;
        const initOuterBarY = activeProfile.outerBarY;
        const allBarSpecs = isPlushMachine
          ? []
          : [
              { y: GACHA_PHYSICS.BAR_Y, z: -initRedHalfZ, isOuter: false, sign: -1 as const },
              { y: GACHA_PHYSICS.BAR_Y, z: initRedHalfZ, isOuter: false, sign: 1 as const },
              { y: initOuterBarY, z: -initOuterHalfZ, isOuter: true, sign: -1 as const },
              { y: initOuterBarY, z: initOuterHalfZ, isOuter: true, sign: 1 as const },
            ];
        const ringXPositions = [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5];
        const redBarMeshes: Array<{ mesh: THREE.Mesh; sign: -1 | 1 }> = [];
        const redRingMeshes: Array<{ mesh: THREE.Mesh; sign: -1 | 1 }> = [];

        allBarSpecs.forEach(({ y: by, z: bz, isOuter, sign }) => {
          const barMesh = new THREE.Mesh(barGeo, barMatVisual);
          barMesh.position.set(0, by, bz);
          barMesh.castShadow = true;
          barMesh.receiveShadow = true;
          cabinetGroup.add(barMesh);
          if (!isOuter) redBarMeshes.push({ mesh: barMesh, sign });

          for (const rx of ringXPositions) {
            const ring = new THREE.Mesh(ringGeo, isOuter ? blueRingMat : redRingMat);
            ring.position.set(rx, by, bz);
            cabinetGroup.add(ring);
            if (!isOuter) redRingMeshes.push({ mesh: ring, sign });
          }
        });

        // 3D 인형뽑기 전용: 클래식 산더미 바닥판 + 좌전방 배출구 구멍(WIN) + 아크릴 칸막이
        const plushFloorSlabs = isPlushMachine
          ? [
              { cx: 0.61, cy: PLUSH_FLOOR_Y - 0.06, cz: 0, w: 2.34, h: 0.12, d: 3.76 },
              { cx: -1.17, cy: PLUSH_FLOOR_Y - 0.06, cz: -0.74, w: 1.22, h: 0.12, d: 2.28 },
            ]
          : [];
        const plushChuteGuards = isPlushMachine
          ? [
              { cx: -0.56, cy: PLUSH_FLOOR_Y + PLUSH_CHUTE_WALL_HEIGHT / 2, cz: 1.14, w: 0.06, h: PLUSH_CHUTE_WALL_HEIGHT, d: 1.48 },
              { cx: -1.17, cy: PLUSH_FLOOR_Y + PLUSH_CHUTE_WALL_HEIGHT / 2, cz: 0.40, w: 1.22, h: PLUSH_CHUTE_WALL_HEIGHT, d: 0.06 },
            ]
          : [];
        if (isPlushMachine) {
          const plushDeckMat = new THREE.MeshStandardMaterial({
            color: '#1e293b',
            roughness: 0.55,
            metalness: 0.25,
          });
          for (const s of plushFloorSlabs) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), plushDeckMat);
            m.position.set(s.cx, s.cy, s.cz);
            m.receiveShadow = true;
            cabinetGroup.add(m);
          }
          const guardGlassMat = new THREE.MeshPhysicalMaterial({
            color: '#67e8f9',
            transparent: true,
            opacity: 0.32,
            roughness: 0.12,
            metalness: 0.1,
          });
          const guardRimMat = new THREE.MeshStandardMaterial({
            color: '#34d399',
            emissive: '#10b981',
            emissiveIntensity: 0.8,
          });
          for (const g of plushChuteGuards) {
            const gm = new THREE.Mesh(new THREE.BoxGeometry(g.w, g.h, g.d), guardGlassMat);
            gm.position.set(g.cx, g.cy, g.cz);
            cabinetGroup.add(gm);
            const rim = new THREE.Mesh(new THREE.BoxGeometry(g.w + 0.015, 0.03, g.d + 0.015), guardRimMat);
            rim.position.set(g.cx, PLUSH_FLOOR_Y + PLUSH_CHUTE_WALL_HEIGHT + 0.005, g.cz);
            cabinetGroup.add(rim);
          }
          // 배출구 WIN 표지판
          const chuteSignCanvas = document.createElement('canvas');
          chuteSignCanvas.width = 256;
          chuteSignCanvas.height = 128;
          const sctx = chuteSignCanvas.getContext('2d');
          if (sctx) {
            sctx.fillStyle = '#064e3b';
            sctx.fillRect(0, 0, 256, 128);
            sctx.strokeStyle = '#34d399';
            sctx.lineWidth = 8;
            sctx.strokeRect(6, 6, 244, 116);
            sctx.fillStyle = '#fef08a';
            sctx.font = 'bold 36px sans-serif';
            sctx.textAlign = 'center';
            sctx.fillText('🎁 WIN', 128, 58);
            sctx.fillStyle = '#a7f3d0';
            sctx.font = 'bold 26px sans-serif';
            sctx.fillText('배출구 (DROP)', 128, 98);
          }
          const chuteSignTex = new THREE.CanvasTexture(chuteSignCanvas);
          chuteSignTex.colorSpace = THREE.SRGBColorSpace;
          const chuteSign = new THREE.Mesh(
            new THREE.PlaneGeometry(1.06, 0.54),
            new THREE.MeshBasicMaterial({ map: chuteSignTex })
          );
          chuteSign.rotation.x = -Math.PI / 2;
          chuteSign.position.set(PLUSH_CHUTE_HOME_X, -1.42, PLUSH_CHUTE_HOME_Z);
          cabinetGroup.add(chuteSign);
        }

        const ufoHeadGroup = new THREE.Group();
        ufoHeadGroup.scale.setScalar(headScale);
        scene.add(ufoHeadGroup);

        if (isPlushMachine) {
          // 3D 인형뽑기 전용: 얇은 스틸 4집게와 어울리는 브러시드 메탈 타원형 구 헤드
          const ovalHead = new THREE.Mesh(
            new THREE.SphereGeometry(0.37, 32, 24),
            new THREE.MeshStandardMaterial({
              color: '#cbd5e1',
              emissive: '#0f172a',
              emissiveIntensity: 0.2,
              metalness: 0.92,
              roughness: 0.16,
            })
          );
          ovalHead.scale.set(1.06, 0.66, 1.06);
          ovalHead.position.set(0, 0.11, 0);
          ovalHead.castShadow = true;
          ufoHeadGroup.add(ovalHead);

          const topCollar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.11, 0.15, 0.12, 20),
            new THREE.MeshStandardMaterial({
              color: '#94a3b8',
              metalness: 0.94,
              roughness: 0.18,
            })
          );
          topCollar.position.set(0, 0.34, 0);
          ufoHeadGroup.add(topCollar);

          const equatorRing = new THREE.Mesh(
            new THREE.TorusGeometry(0.39, 0.018, 12, 32),
            new THREE.MeshStandardMaterial({
              color: '#34d399',
              emissive: '#10b981',
              emissiveIntensity: 0.85,
              metalness: 0.6,
              roughness: 0.2,
            })
          );
          equatorRing.rotation.x = Math.PI / 2;
          equatorRing.position.set(0, 0.10, 0);
          ufoHeadGroup.add(equatorRing);

          const bottomHub = new THREE.Mesh(
            new THREE.CylinderGeometry(0.24, 0.19, 0.07, 20),
            new THREE.MeshStandardMaterial({
              color: '#475569',
              metalness: 0.9,
              roughness: 0.22,
            })
          );
          bottomHub.position.set(0, -0.05, 0);
          ufoHeadGroup.add(bottomHub);
        } else {
          const ufoTop = new THREE.Mesh(
            new THREE.CylinderGeometry(0.30, 0.469, 0.25, 24),
            new THREE.MeshStandardMaterial({
              color: '#10b981',
              emissive: '#059669',
              emissiveIntensity: 0.5,
              metalness: 0.65,
              roughness: 0.22,
            })
          );
          ufoTop.position.set(0, 0.10, 0);
          ufoTop.castShadow = true;
          ufoHeadGroup.add(ufoTop);

          const ufoRing = new THREE.Mesh(
            new THREE.TorusGeometry(0.438, 0.048, 12, 24),
            new THREE.MeshStandardMaterial({
              color: '#fbbf24',
              emissive: '#f59e0b',
              emissiveIntensity: 0.65,
            })
          );
          ufoRing.rotation.x = Math.PI / 2;
          ufoRing.position.set(0, -0.015, 0);
          ufoHeadGroup.add(ufoRing);
        }

        const debugLinesGeo = new THREE.BufferGeometry();
        const debugLinesMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 });
        const debugLinesMesh = new THREE.LineSegments(debugLinesGeo, debugLinesMat);
        debugLinesMesh.visible = tuningRef.current.showColliders;
        scene.add(debugLinesMesh);

        const armMetalMat = isPlushMachine
          ? new THREE.MeshStandardMaterial({ color: '#f1f5f9', metalness: 0.96, roughness: 0.12 })
          : new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 0.88, roughness: 0.18 });
        const armTipMat = new THREE.MeshStandardMaterial({ color: '#f97316', emissive: '#ea580c', emissiveIntensity: 0.3, roughness: 0.65 });
        const hingePinMat = new THREE.MeshStandardMaterial({ color: '#fbbf24', metalness: 0.9, roughness: 0.2 });

        const buildArmVisual = (side: -1 | 1, axis: 'x' | 'z' = 'x') => {
          const group = new THREE.Group();
          const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.12, 12), hingePinMat);
          if (axis === 'x') {
            pin.rotation.x = Math.PI / 2;
          } else {
            pin.rotation.z = Math.PI / 2;
          }
          group.add(pin);

          for (const seg of scaledArmSegments) {
            const geo =
              axis === 'x'
                ? new THREE.BoxGeometry(seg.half[0] * 2, seg.half[1] * 2, seg.half[2] * 2)
                : new THREE.BoxGeometry(seg.half[2] * 2, seg.half[1] * 2, seg.half[0] * 2);
            const mesh = new THREE.Mesh(geo, seg.isTip ? armTipMat : armMetalMat);
            if (axis === 'x') {
              mesh.position.set(side * seg.pos[0], seg.pos[1], seg.pos[2]);
              mesh.rotation.z = side * seg.rotZ;
            } else {
              mesh.position.set(seg.pos[2], seg.pos[1], side * seg.pos[0]);
              mesh.rotation.x = -side * seg.rotZ;
            }
            mesh.castShadow = true;
            group.add(mesh);
          }
          scene.add(group);
          return group;
        };

        const leftArmVisual = buildArmVisual(-1, 'x');
        const rightArmVisual = buildArmVisual(1, 'x');
        const backArmVisual = isPlushMachine ? buildArmVisual(-1, 'z') : null;
        const frontArmVisual = isPlushMachine ? buildArmVisual(1, 'z') : null;

        const cableMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.02, 0.02, 1, 8),
          new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.85 })
        );
        scene.add(cableMesh);

        const aimRingMat = new THREE.MeshBasicMaterial({
          color: '#34d399',
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        });
        const aimRing = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.21, 24), aimRingMat);
        aimRing.rotation.x = -Math.PI / 2;
        aimRing.renderOrder = 5;
        scene.add(aimRing);

        const aimBeamMat = new THREE.MeshBasicMaterial({
          color: '#34d399',
          transparent: true,
          opacity: 0.32,
        });
        const aimBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.7, 8), aimBeamMat);
        scene.add(aimBeam);

        const aimRaycaster = new THREE.Raycaster();
        const aimRayOrigin = new THREE.Vector3();
        const aimRayDown = new THREE.Vector3(0, -1, 0);
        const plushRaycastMeshes: THREE.Object3D[] = [];
        const updateAimLaser = (ax: number, headY: number, az: number) => {
          let aimBaseY = GACHA_PHYSICS.BAR_Y + 0.12;
          let hitPlush = false;
          if (isPlushMachine) {
            plushRaycastMeshes.length = 0;
            for (const ent of prizeEntities.values()) {
              ent.mesh.updateMatrixWorld();
              plushRaycastMeshes.push(ent.mesh);
            }
            aimRayOrigin.set(ax, headY, az);
            aimRaycaster.set(aimRayOrigin, aimRayDown);
            const hits = aimRaycaster.intersectObjects(plushRaycastMeshes, false);
            if (hits.length > 0) {
              aimBaseY = hits[0].point.y + 0.015;
              hitPlush = true;
            } else if (ax < -0.56 && az > 0.40) {
              aimBaseY = -1.38;
            } else {
              aimBaseY = PLUSH_FLOOR_Y + 0.025;
            }
          }
          const laserHex = hitPlush ? '#facc15' : '#34d399';
          aimRingMat.color.set(laserHex);
          aimBeamMat.color.set(laserHex);
          aimRing.position.set(ax, aimBaseY, az);
          const beamH = Math.max(0.05, headY - aimBaseY);
          aimBeam.scale.y = beamH / 1.7;
          aimBeam.position.set(ax, aimBaseY + beamH / 2, az);
        };

        // Rapier3D World (120Hz)
        const world = new Rapier.World({ x: 0, y: -9.81, z: 0 });
        world.timestep = 1 / 120;
        world.numSolverIterations = 12;
        worldRef = world;

        const envBody = world.createRigidBody(Rapier.RigidBodyDesc.fixed());
        const barBody = world.createRigidBody(Rapier.RigidBodyDesc.fixed());
        const redBarColliderEntries: Array<{ col: RAPIER.Collider; sign: -1 | 1 }> = [];
        const redRingColliders: RAPIER.Collider[] = [];
        const redRingColliderEntries: Array<{ col: RAPIER.Collider; x: number; sign: -1 | 1 }> = [];

        const qBar = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
        allBarSpecs.forEach(({ y: by, z: bz, isOuter, sign }) => {
          const barCol = world.createCollider(
            Rapier.ColliderDesc.cylinder(GACHA_PHYSICS.BAR_LENGTH / 2, GACHA_PHYSICS.BAR_RADIUS)
              .setTranslation(0, by, bz)
              .setRotation(qBar)
              .setFriction(isOuter ? 0.34 : 0.28)
              .setRestitution(0)
              .setCollisionGroups(makeGroup(G_BAR, G_PRIZE)),
            barBody
          );
          if (!isOuter) redBarColliderEntries.push({ col: barCol, sign });

          for (const rx of ringXPositions) {
            const col = world.createCollider(
              Rapier.ColliderDesc.cylinder(0.022, GACHA_PHYSICS.BAR_RADIUS + 0.006)
                .setTranslation(rx, by, bz)
                .setRotation(qBar)
                .setFriction(isOuter ? 0.55 : tuningRef.current.barRingFriction)
                .setRestitution(0)
                .setCollisionGroups(makeGroup(G_BAR, G_PRIZE)),
              barBody
            );
            if (!isOuter) {
              redRingColliders.push(col);
              redRingColliderEntries.push({ col, x: rx, sign });
            }
          }
        });

        if (isPlushMachine) {
          // 3D 인형뽑기 바닥판과 ㄱ자 외벽은 상품뿐 아니라 크레인 집게/헤드와도 충돌시켜 바닥 관통 원천 차단
          const plushStageGroup = makeGroup(G_BAR, G_PRIZE | G_ARM | G_HEAD);
          for (const s of plushFloorSlabs) {
            world.createCollider(
              Rapier.ColliderDesc.cuboid(s.w / 2, s.h / 2, s.d / 2)
                .setTranslation(s.cx, s.cy, s.cz)
                .setFriction(0.55)
                .setRestitution(0)
                .setCollisionGroups(plushStageGroup),
              barBody
            );
          }
          for (const g of plushChuteGuards) {
            world.createCollider(
              Rapier.ColliderDesc.cuboid(g.w / 2, g.h / 2, g.d / 2)
                .setTranslation(g.cx, g.cy, g.cz)
                .setFriction(0.22)
                .setRestitution(0)
                .setCollisionGroups(plushStageGroup),
              barBody
            );
          }
        }

        [-GACHA_PHYSICS.CABINET_HALF_X - 0.1, GACHA_PHYSICS.CABINET_HALF_X + 0.1].forEach((wx) => {
          world.createCollider(
            Rapier.ColliderDesc.cuboid(0.1, 2.5, 2.3)
              .setTranslation(wx, 1.2, 0)
              .setFriction(0.25)
              .setRestitution(0)
              .setCollisionGroups(makeGroup(G_ENV, G_PRIZE)),
            envBody
          );
        });

        if (isPlushMachine) {
          [-1.92, 1.92].forEach((wz) => {
            world.createCollider(
              Rapier.ColliderDesc.cuboid(GACHA_PHYSICS.CABINET_HALF_X + 0.12, 1.55, 0.08)
                .setTranslation(0, 1.35, wz)
                .setFriction(0.22)
                .setRestitution(0)
                .setCollisionGroups(makeGroup(G_ENV, G_PRIZE)),
              envBody
            );
          });
        } else {
          const qFront = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.72, 0, 0));
          world.createCollider(
            Rapier.ColliderDesc.cuboid(GACHA_PHYSICS.BAR_LENGTH / 2, 0.03, 0.42)
              .setTranslation(0, 1.24, 1.86)
              .setRotation({ x: qFront.x, y: qFront.y, z: qFront.z, w: qFront.w })
              .setFriction(0.22)
              .setRestitution(0)
              .setCollisionGroups(makeGroup(G_ENV, G_PRIZE)),
            envBody
          );

          const qBack = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.72, 0, 0));
          world.createCollider(
            Rapier.ColliderDesc.cuboid(GACHA_PHYSICS.BAR_LENGTH / 2, 0.03, 0.42)
              .setTranslation(0, 1.24, -1.86)
              .setRotation({ x: qBack.x, y: qBack.y, z: qBack.z, w: qBack.w })
              .setFriction(0.22)
              .setRestitution(0)
              .setCollisionGroups(makeGroup(G_ENV, G_PRIZE)),
            envBody
          );
        }

        world.createCollider(
          Rapier.ColliderDesc.cuboid(2.2, 0.1, 2.3)
            .setTranslation(0, -1.55, 0)
            .setFriction(0.55)
            .setRestitution(0.05)
            .setCollisionGroups(makeGroup(G_ENV, G_PRIZE)),
          envBody
        );

        // Articulated Crane Chain (Prismatic Y -> Gimbal X/Z -> 2× or 4× Revolute Claw Arms)
        const homeX = isPlushMachine ? PLUSH_CHUTE_HOME_X : GACHA_PHYSICS.CLAW_HOME_X;
        const homeY = isPlushMachine ? effectiveLiftY : GACHA_PHYSICS.CLAW_HOME_Y;
        const homeZ = isPlushMachine ? PLUSH_CHUTE_HOME_Z : GACHA_PHYSICS.CLAW_HOME_Z;

        const gantryBody = world.createRigidBody(
          Rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(homeX, homeY, homeZ)
        );
        const carrierBody = world.createRigidBody(
          Rapier.RigidBodyDesc.dynamic()
            .setTranslation(homeX, homeY + 0.18, homeZ)
            .setLinearDamping(0.8)
            .setAngularDamping(2.5)
            .setCanSleep(false)
        );
        world.createCollider(
          Rapier.ColliderDesc.cuboid(0.05, 0.04, 0.05).setMass(0.35).setCollisionGroups(makeGroup(G_HEAD, 0)),
          carrierBody
        );

        const gimbalBody = world.createRigidBody(
          Rapier.RigidBodyDesc.dynamic()
            .setTranslation(homeX, homeY + 0.18, homeZ)
            .setLinearDamping(0.5)
            .setAngularDamping(1.2)
            .setCanSleep(false)
        );
        world.createCollider(
          Rapier.ColliderDesc.cuboid(0.04, 0.04, 0.04).setMass(0.25).setCollisionGroups(makeGroup(G_HEAD, 0)),
          gimbalBody
        );

        const headBody = world.createRigidBody(
          Rapier.RigidBodyDesc.dynamic()
            .setTranslation(homeX, homeY, homeZ)
            .setLinearDamping(0.5)
            .setAngularDamping(1.2)
            .setCcdEnabled(true)
            .setCanSleep(false)
        );
        world.createCollider(
          Rapier.ColliderDesc.cylinder(0.125 * headScale, 0.36 * headScale)
            .setMass(1.25)
            .setFriction(0.55)
            .setRestitution(0)
            .setCollisionGroups(makeGroup(G_HEAD, isPlushMachine ? G_PRIZE | G_BAR : G_PRIZE)),
          headBody
        );

        const winchData = Rapier.JointData.prismatic({ x: 0, y: 0.18, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
        winchData.limitsEnabled = true;
        winchData.limits = isPlushMachine ? [-3.05, 0.22] : [-2.55, 0.18];
        const winchJoint = world.createImpulseJoint(winchData, gantryBody, carrierBody, true) as RAPIER.PrismaticImpulseJoint;
        winchJoint.configureMotorModel(Rapier.MotorModel.ForceBased);
        winchJoint.setMotorMaxForce(210);
        winchJoint.configureMotorPosition(0, 320, 48);

        const swayXData = Rapier.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
        swayXData.limitsEnabled = true;
        swayXData.limits = [-0.26, 0.26];
        const swayXJoint = world.createImpulseJoint(swayXData, carrierBody, gimbalBody, true) as RAPIER.RevoluteImpulseJoint;
        swayXJoint.configureMotorModel(Rapier.MotorModel.ForceBased);
        swayXJoint.setMotorMaxForce(18);
        swayXJoint.configureMotorPosition(0, 26, 7);

        const swayZData = Rapier.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0.18, z: 0 }, { x: 0, y: 0, z: 1 });
        swayZData.limitsEnabled = true;
        swayZData.limits = [-0.34, 0.34];
        const swayZJoint = world.createImpulseJoint(swayZData, gimbalBody, headBody, true) as RAPIER.RevoluteImpulseJoint;
        swayZJoint.configureMotorModel(Rapier.MotorModel.ForceBased);
        swayZJoint.setMotorMaxForce(18);
        swayZJoint.configureMotorPosition(0, 24, 6.5);

        const armColliders: RAPIER.Collider[] = [];
        const createClawArm = (side: -1 | 1, axis: 'x' | 'z' = 'x') => {
          const px = axis === 'x' ? homeX + side * armPivotX : homeX;
          const pz = axis === 'z' ? homeZ + side * armPivotX : homeZ;
          const armBody = world.createRigidBody(
            Rapier.RigidBodyDesc.dynamic()
              .setTranslation(px, homeY - 0.02, pz)
              .setLinearDamping(0.25)
              .setAngularDamping(0.45)
              .setCcdEnabled(true)
              .setCanSleep(false)
          );
          for (const seg of scaledArmSegments) {
            const desc =
              axis === 'x'
                ? Rapier.ColliderDesc.cuboid(seg.half[0], seg.half[1], seg.half[2])
                    .setTranslation(side * seg.pos[0], seg.pos[1], seg.pos[2])
                    .setRotation({ x: 0, y: 0, z: Math.sin((side * seg.rotZ) / 2), w: Math.cos((side * seg.rotZ) / 2) })
                : Rapier.ColliderDesc.cuboid(seg.half[2], seg.half[1], seg.half[0])
                    .setTranslation(seg.pos[2], seg.pos[1], side * seg.pos[0])
                    .setRotation({ x: Math.sin((-side * seg.rotZ) / 2), y: 0, z: 0, w: Math.cos((-side * seg.rotZ) / 2) });
            const col = world.createCollider(
              desc
                .setMass(seg.mass)
                .setFriction(tuningRef.current.clawTipFriction)
                .setRestitution(0)
                .setCollisionGroups(makeGroup(G_ARM, isPlushMachine ? G_PRIZE | G_BAR : G_PRIZE)),
              armBody
            );
            armColliders.push(col);
          }

          const anchor1 =
            axis === 'x'
              ? { x: side * armPivotX, y: -0.02, z: 0 }
              : { x: 0, y: -0.02, z: side * armPivotX };
          const hingeAxis = axis === 'x' ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
          // Open angle sign: X-axis arms use side (+1 right, -1 left); Z-axis arms use -side (+1 back -Z, -1 front +Z)
          const openSign = axis === 'x' ? side : -side;
          const jData = Rapier.JointData.revolute(anchor1, { x: 0, y: 0, z: 0 }, hingeAxis);
          jData.limitsEnabled = true;
          jData.limits = openSign > 0 ? [-0.10, 1.18] : [-1.18, 0.10];
          const joint = world.createImpulseJoint(jData, headBody, armBody, true) as RAPIER.RevoluteImpulseJoint;
          joint.configureMotorModel(Rapier.MotorModel.ForceBased);
          joint.setMotorMaxForce(tuningRef.current.closeTorque);
          joint.configureMotorPosition(openSign * CLAW_OPEN_ANGLE, 150, 22);
          return { body: armBody, joint, openSign };
        };

        const leftArm = createClawArm(-1, 'x');
        const rightArm = createClawArm(1, 'x');
        const backArm = isPlushMachine ? createClawArm(-1, 'z') : null;
        const frontArm = isPlushMachine ? createClawArm(1, 'z') : null;
        const allArms = [leftArm, rightArm, ...(backArm ? [backArm] : []), ...(frontArm ? [frontArm] : [])];

        // Dynamic Prize Entities Map (synced to MongoDB GachaBoxItem[])
        interface PrizeEntity {
          data: GachaBoxItem;
          mesh: THREE.Mesh;
          body: RAPIER.RigidBody;
          sharedVisual?: boolean;
        }
        const prizeEntities = new Map<string, PrizeEntity>();
        const sharedPlushMatBySrc = new Map<string, THREE.MeshStandardMaterial>();
        const sharedPlushGeoBySrc = new Map<string, THREE.BufferGeometry>();
        const sharedPlushLoadingSrc = new Set<string>();

        const syncFromItems = (nextItems: GachaBoxItem[], forceRecreate = false) => {
          const nextIds = new Set(nextItems.map((it) => it.id));

          for (const [id, ent] of prizeEntities.entries()) {
            if (forceRecreate || !nextIds.has(id)) {
              world.removeRigidBody(ent.body);
              scene.remove(ent.mesh);
              if (!ent.sharedVisual) {
                ent.mesh.geometry.dispose();
                if (Array.isArray(ent.mesh.material)) {
                  ent.mesh.material.forEach((m) => m.dispose());
                } else {
                  ent.mesh.material.dispose();
                }
              }
              prizeEntities.delete(id);
            }
          }

          const liveTuning = tuningRef.current;

          for (const it of nextItems) {
            let ent = prizeEntities.get(it.id);
            if (!ent) {
              const dims = getBoxDimensions(it.slotIndex);
              const spec = getSpecForSlot(it.slotIndex);
              const plushItem = isPlushSlot(it.slotIndex);
              const totalMass = Math.max(0.4, spec.mass * liveTuning.massScale);

              const body = world.createRigidBody(
                Rapier.RigidBodyDesc.dynamic()
                  .setTranslation(it.position[0], it.position[1], it.position[2])
                  .setRotation({
                    x: it.quaternion[0],
                    y: it.quaternion[1],
                    z: it.quaternion[2],
                    w: it.quaternion[3],
                  })
                  .setLinearDamping(plushItem ? 0.28 : 0.20)
                  .setAngularDamping(plushItem ? 0.40 : 0.30)
                  .setCcdEnabled(!plushItem)
              );

              const prizeGroup = makeGroup(G_PRIZE, G_ENV | G_BAR | G_PRIZE | G_HEAD | G_ARM);
              let mesh: THREE.Mesh;

              if (plushItem) {
                let plushMat = sharedPlushMatBySrc.get(spec.imgSrc);
                if (!plushMat) {
                  plushMat = createPlushMaterial(spec.imgSrc);
                  sharedPlushMatBySrc.set(spec.imgSrc, plushMat);
                }
                const geoSrc = spec.plushGeoSrc || '/assets/sandrone_plush_geo.json';
                let sharedGeo = sharedPlushGeoBySrc.get(geoSrc);
                if (!sharedGeo) {
                  const cachedGeo = cachedPlushGeoMap.get(geoSrc);
                  sharedGeo = cachedGeo
                    ? buildBufferGeometryFromPlushData(cachedGeo)
                    : new THREE.BoxGeometry(dims.w * 0.7, dims.h, dims.d * 0.85);
                  sharedPlushGeoBySrc.set(geoSrc, sharedGeo);
                }
                mesh = new THREE.Mesh(sharedGeo, plushMat);
                mesh.scale.setScalar(PLUSH_MOUND_SCALE);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                scene.add(mesh);

                if (!cachedPlushGeoMap.get(geoSrc) && !sharedPlushLoadingSrc.has(geoSrc)) {
                  sharedPlushLoadingSrc.add(geoSrc);
                  loadPlushGeoData(geoSrc).then((geoData) => {
                    if (!geoData || disposed) return;
                    const nextGeo = buildBufferGeometryFromPlushData(geoData);
                    const oldGeo = sharedPlushGeoBySrc.get(geoSrc);
                    sharedPlushGeoBySrc.set(geoSrc, nextGeo);
                    for (const liveEnt of prizeEntities.values()) {
                      if (isPlushSlot(liveEnt.data.slotIndex)) {
                        const s = getSpecForSlot(liveEnt.data.slotIndex);
                        if ((s.plushGeoSrc || '/assets/sandrone_plush_geo.json') === geoSrc) {
                          liveEnt.mesh.geometry = nextGeo;
                          liveEnt.mesh.scale.setScalar(PLUSH_MOUND_SCALE);
                        }
                      }
                    }
                    if (oldGeo && oldGeo !== nextGeo) oldGeo.dispose();
                  });
                }

                const plushMass = Math.max(0.28, totalMass * 0.32);
                const parts =
                  spec.plushParts && spec.plushParts.length > 0
                    ? spec.plushParts
                    : [
                        { half: [0.28, 0.21, 0.50] as [number, number, number], pos: [0.05, 0, 0.02] as [number, number, number], w: 0.45 },
                        { half: [0.19, 0.18, 0.20] as [number, number, number], pos: [0.04, 0, -0.44] as [number, number, number], w: 0.20 },
                        { half: [0.15, 0.16, 0.30] as [number, number, number], pos: [-0.30, 0, 0.24] as [number, number, number], w: 0.18 },
                        { half: [0.14, 0.17, 0.28] as [number, number, number], pos: [0.30, 0, 0.22] as [number, number, number], w: 0.17 },
                      ];
                for (const p of parts) {
                  world.createCollider(
                    Rapier.ColliderDesc.cuboid(
                      p.half[0] * PLUSH_MOUND_SCALE,
                      p.half[1] * PLUSH_MOUND_SCALE,
                      p.half[2] * PLUSH_MOUND_SCALE
                    )
                      .setTranslation(
                        p.pos[0] * PLUSH_MOUND_SCALE,
                        p.pos[1] * PLUSH_MOUND_SCALE,
                        p.pos[2] * PLUSH_MOUND_SCALE
                      )
                      .setMass(plushMass * (liveTuning.useComOffset ? 0.85 : 1.0) * p.w)
                      .setFriction(spec.friction)
                      .setRestitution(0)
                      .setCollisionGroups(prizeGroup),
                    body
                  );
                }
              } else {
                const mats = createFigureBoxMaterials(it.slotIndex, it.label);
                mesh = new THREE.Mesh(new THREE.BoxGeometry(dims.w, dims.h, dims.d), mats);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                scene.add(mesh);

                world.createCollider(
                  Rapier.ColliderDesc.cuboid(dims.w / 2, dims.h / 2, dims.d / 2)
                    .setMass(totalMass * (liveTuning.useComOffset ? 0.82 : 1.0))
                    .setFriction(spec.friction)
                    .setRestitution(0)
                    .setCollisionGroups(prizeGroup),
                  body
                );
              }

              if (liveTuning.useComOffset) {
                const comScale = plushItem ? PLUSH_MOUND_SCALE : 1;
                const ballastMass = plushItem ? Math.max(0.28, totalMass * 0.32) * 0.15 : totalMass * 0.18;
                world.createCollider(
                  Rapier.ColliderDesc.ball(0.05 * comScale)
                    .setTranslation(
                      spec.comOffset[0] * 3.0 * comScale,
                      spec.comOffset[1] * 3.0 * comScale,
                      spec.comOffset[2] * 3.0 * comScale
                    )
                    .setMass(ballastMass)
                    .setCollisionGroups(0),
                  body
                );
              }

              ent = { data: { ...it }, mesh, body, sharedVisual: plushItem };
              prizeEntities.set(it.id, ent);
            }

            ent.data = { ...it };
            ent.body.setTranslation({ x: it.position[0], y: it.position[1], z: it.position[2] }, false);
            ent.body.setRotation(
              { x: it.quaternion[0], y: it.quaternion[1], z: it.quaternion[2], w: it.quaternion[3] },
              false
            );
            ent.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
            ent.body.setAngvel({ x: 0, y: 0, z: 0 }, false);

            ent.mesh.position.set(it.position[0], it.position[1], it.position[2]);
            ent.mesh.quaternion.set(it.quaternion[0], it.quaternion[1], it.quaternion[2], it.quaternion[3]);
          }
        };

        const tmpThreePosA = new THREE.Vector3();
        const tmpThreePosB = new THREE.Vector3();
        const tmpThreeDir = new THREE.Vector3();
        const tmpThreeUp = new THREE.Vector3(0, 1, 0);
        const tmpThreeQuat = new THREE.Quaternion();

        const sim = {
          gantryX: homeX,
          gantryZ: homeZ,
          targetHeadY: homeY,
          phaseTimer: 0,
          settleQuietTime: 0,
          wonSet: new Set<string>(),
          turnStartPositions: new Map<string, [number, number, number]>(),
          turnStartQuats: new Map<string, [number, number, number, number]>(),
          liftStartY: new Map<string, number>(),
          effectTriggeredThisTurn: false,
          nearNearTriggeredThisTurn: false,
          lastHeadYForStall: homeY,
          descendStallTimer: 0,
          liftTopHoldTimer: 0,
          carryStopHoldTimer: 0,
          releaseClearTimer: 0,
          plushStrongGripTurn: false,
          liftTopBumpApplied: false,
          carryTraveled: 0,
          carryAxisStage: 'x' as 'x' | 'pause' | 'z' | 'done',
          carryAxisPauseTimer: 0,
          stepAccum: 0,
        };

        const setArmTorques = (maxTorque: number) => {
          for (const a of allArms) a.joint.setMotorMaxForce(maxTorque);
        };

        const setArmTargets = (openRad: number) => {
          for (const a of allArms) a.joint.configureMotorPosition(a.openSign * openRad, 150, 22);
        };

        const resetClawToHome = () => {
          sim.gantryX = homeX;
          sim.gantryZ = homeZ;
          sim.targetHeadY = homeY;
          sim.phaseTimer = 0;
          sim.settleQuietTime = 0;
          sim.wonSet.clear();
          sim.effectTriggeredThisTurn = false;
          sim.nearNearTriggeredThisTurn = false;
          sim.descendStallTimer = 0;
          sim.liftTopHoldTimer = 0;
          sim.carryStopHoldTimer = 0;
          sim.releaseClearTimer = 0;
          sim.plushStrongGripTurn = false;
          sim.liftTopBumpApplied = false;
          sim.carryTraveled = 0;
          sim.carryAxisStage = 'x';
          sim.carryAxisPauseTimer = 0;

          const idQ = { x: 0, y: 0, z: 0, w: 1 };
          const zero = { x: 0, y: 0, z: 0 };
          gantryBody.setTranslation({ x: homeX, y: homeY, z: homeZ }, true);
          gantryBody.setNextKinematicTranslation({ x: homeX, y: homeY, z: homeZ });

          carrierBody.setTranslation({ x: homeX, y: homeY + 0.18, z: homeZ }, true);
          carrierBody.setRotation(idQ, true);
          carrierBody.setLinvel(zero, true);
          carrierBody.setAngvel(zero, true);

          gimbalBody.setTranslation({ x: homeX, y: homeY + 0.18, z: homeZ }, true);
          gimbalBody.setRotation(idQ, true);
          gimbalBody.setLinvel(zero, true);
          gimbalBody.setAngvel(zero, true);

          headBody.setTranslation({ x: homeX, y: homeY, z: homeZ }, true);
          headBody.setRotation(idQ, true);
          headBody.setLinvel(zero, true);
          headBody.setAngvel(zero, true);

          leftArm.body.setTranslation({ x: homeX - armPivotX, y: homeY - 0.02, z: homeZ }, true);
          leftArm.body.setRotation(idQ, true);
          leftArm.body.setLinvel(zero, true);
          leftArm.body.setAngvel(zero, true);

          rightArm.body.setTranslation({ x: homeX + armPivotX, y: homeY - 0.02, z: homeZ }, true);
          rightArm.body.setRotation(idQ, true);
          rightArm.body.setLinvel(zero, true);
          rightArm.body.setAngvel(zero, true);

          if (backArm) {
            backArm.body.setTranslation({ x: homeX, y: homeY - 0.02, z: homeZ - armPivotX }, true);
            backArm.body.setRotation(idQ, true);
            backArm.body.setLinvel(zero, true);
            backArm.body.setAngvel(zero, true);
          }
          if (frontArm) {
            frontArm.body.setTranslation({ x: homeX, y: homeY - 0.02, z: homeZ + armPivotX }, true);
            frontArm.body.setRotation(idQ, true);
            frontArm.body.setLinvel(zero, true);
            frontArm.body.setAngvel(zero, true);
          }

          winchJoint.setMotorMaxForce(210);
          winchJoint.configureMotorPosition(0, 320, 48);
          setArmTorques(tuningRef.current.closeTorque);
          setArmTargets(CLAW_OPEN_ANGLE);
        };

        const prepareTurnStart = (nextItems: GachaBoxItem[]) => {
          resetClawToHome();
          syncFromItems(nextItems, false);
          sim.turnStartPositions.clear();
          sim.turnStartQuats.clear();
          for (const ent of prizeEntities.values()) {
            sim.turnStartPositions.set(ent.data.id, [...ent.data.position] as [number, number, number]);
            sim.turnStartQuats.set(ent.data.id, [...ent.data.quaternion] as [number, number, number, number]);
          }
        };

        const startDescending = () => {
          clearFreeMove();
          sim.phaseTimer = 0;
          sim.descendStallTimer = 0;
          sim.lastHeadYForStall = headBody.translation().y;
          sim.plushStrongGripTurn = isPlushMachine && Math.random() < 0.22;
          sim.liftTopBumpApplied = false;
          sim.carryTraveled = 0;
          sim.carryAxisStage = 'x';
          sim.carryAxisPauseTimer = 0;
          if (sim.plushStrongGripTurn) {
            triggerStrongGrip();
          }
          for (const ent of prizeEntities.values()) {
            if (isPlushMachine) {
              const p = ent.body.translation();
              if (Math.hypot(p.x - sim.gantryX, p.z - sim.gantryZ) <= 1.35) {
                ent.body.wakeUp();
              }
            } else {
              ent.body.wakeUp();
            }
          }
          setArmTorques(tuningRef.current.descendFlexTorque);
          setArmTargets(CLAW_OPEN_ANGLE);
          winchJoint.setMotorMaxForce(tuningRef.current.downPressForce + 18);
          setCranePhase('descending');
          playTone(640, 0.12);
        };

        const applyLiveTuning = (t: PhysicsTuning) => {
          for (const col of armColliders) col.setFriction(t.clawTipFriction);
          for (const col of redRingColliders) col.setFriction(t.barRingFriction);
          debugLinesMesh.visible = t.showColliders;
        };

        const rebuildPrizesForTuning = () => {
          if (prizeEntities.size === 0) return;
          const liveItems: GachaBoxItem[] = Array.from(prizeEntities.values()).map((ent) => {
            const p = ent.body.translation();
            const q = ent.body.rotation();
            return {
              ...ent.data,
              position: [p.x, p.y, p.z],
              quaternion: [q.x, q.y, q.z, q.w],
            };
          });
          syncFromItems(liveItems, true);
        };

        const finishTurn = () => {
          const wonItemIds = Array.from(sim.wonSet);
          const updatedItems = Array.from(prizeEntities.values()).map((ent) => {
            const bp = ent.body.translation();
            const bq = ent.body.rotation();
            const startPos = sim.turnStartPositions.get(ent.data.id) || ent.data.position;
            const startQuat = sim.turnStartQuats.get(ent.data.id) || ent.data.quaternion;
            const wasInitial = isBoxAtInitialPose(ent.data);
            const movedSlightly =
              Math.hypot(bp.x - startPos[0], bp.z - startPos[2]) > 0.008 ||
              Math.abs(bp.y - startPos[1]) > 0.015;
            const quatDot = Math.abs(
              bq.x * startQuat[0] + bq.y * startQuat[1] + bq.z * startQuat[2] + bq.w * startQuat[3]
            );
            const nextIsInitial = wasInitial && !movedSlightly && quatDot >= 0.9998;
            ent.data.isInitialState = nextIsInitial;

            return {
              id: ent.data.id,
              position: [bp.x, bp.y, bp.z] as [number, number, number],
              quaternion: [bq.x, bq.y, bq.z, bq.w] as [number, number, number, number],
              isInitialState: nextIsInitial,
            };
          });

          setCranePhase('idle');
          if (!sandboxModeRef.current) {
            fetch('/api/gacha/live', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clear: true, machineIndex: machineIndexRef.current }),
            }).catch(() => {});
          }
          onTurnFinishRef.current({
            wonItemIds,
            updatedItems,
            actionSummary: wonItemIds.length > 0 ? `${wonItemIds.length}개 획득` : '위치 이동',
          });
        };

        const updateRedBarSpacing = (halfZ: number) => {
          redBarHalfZRef.current = halfZ;
          for (const item of redBarMeshes) {
            item.mesh.position.z = item.sign * halfZ;
          }
          for (const item of redRingMeshes) {
            item.mesh.position.z = item.sign * halfZ;
          }
          for (const entry of redBarColliderEntries) {
            entry.col.setTranslationWrtParent({ x: 0, y: GACHA_PHYSICS.BAR_Y, z: entry.sign * halfZ });
          }
          for (const entry of redRingColliderEntries) {
            entry.col.setTranslationWrtParent({ x: entry.x, y: GACHA_PHYSICS.BAR_Y, z: entry.sign * halfZ });
          }
        };

        simControlRef.current = {
          syncFromItems: (nextItems) => {
            if (disposed) return;
            syncFromItems(nextItems, false);
          },
          resetClawToHome: () => {
            if (disposed) return;
            resetClawToHome();
          },
          prepareTurnStart: (nextItems) => {
            if (disposed) return;
            prepareTurnStart(nextItems);
          },
          startDescending: () => {
            if (disposed) return;
            startDescending();
          },
          applyLiveTuning: (t) => {
            if (disposed) return;
            applyLiveTuning(t);
          },
          rebuildPrizesForTuning: () => {
            if (disposed) return;
            rebuildPrizesForTuning();
          },
          updateRedBarSpacing: (halfZ) => {
            if (disposed) return;
            updateRedBarSpacing(halfZ);
          },
        };

        syncFromItems(itemsRef.current, false);
        resetClawToHome();
        setEngineReady(true);

        let lastTime = performance.now();
        const tmpSpecPos = new THREE.Vector3();
        const tmpSpecQuat = new THREE.Quaternion();

        const animate = (now: number) => {
          if (disposed) return;
          animId = requestAnimationFrame(animate);
          const rawDt = Math.min((now - lastTime) / 1000, 0.04);
          lastTime = now;
          const dt = rawDt * Math.max(0.25, Math.min(1.5, tuningRef.current.timeScale));

          // 실시간 관전 모드: 다른 플레이어로부터 수신한 라이브 좌표를 부드럽게 보간 렌더링
          if (!sandboxModeRef.current && Boolean(lockedByOtherRef.current) && !isMyTurnRef.current && spectateFrameRef.current) {
            const sf = spectateFrameRef.current;
            const sAlpha = Math.min(1, rawDt * 18);

            tmpSpecPos.set(sf.headPos[0], sf.headPos[1], sf.headPos[2]);
            tmpSpecQuat.set(sf.headQuat[0], sf.headQuat[1], sf.headQuat[2], sf.headQuat[3]);
            ufoHeadGroup.position.lerp(tmpSpecPos, sAlpha);
            ufoHeadGroup.quaternion.slerp(tmpSpecQuat, sAlpha);

            tmpSpecPos.set(sf.leftArmPos[0], sf.leftArmPos[1], sf.leftArmPos[2]);
            tmpSpecQuat.set(sf.leftArmQuat[0], sf.leftArmQuat[1], sf.leftArmQuat[2], sf.leftArmQuat[3]);
            leftArmVisual.position.lerp(tmpSpecPos, sAlpha);
            leftArmVisual.quaternion.slerp(tmpSpecQuat, sAlpha);

            tmpSpecPos.set(sf.rightArmPos[0], sf.rightArmPos[1], sf.rightArmPos[2]);
            tmpSpecQuat.set(sf.rightArmQuat[0], sf.rightArmQuat[1], sf.rightArmQuat[2], sf.rightArmQuat[3]);
            rightArmVisual.position.lerp(tmpSpecPos, sAlpha);
            rightArmVisual.quaternion.slerp(tmpSpecQuat, sAlpha);

            if (backArmVisual && sf.backArmPos && sf.backArmQuat) {
              tmpSpecPos.set(sf.backArmPos[0], sf.backArmPos[1], sf.backArmPos[2]);
              tmpSpecQuat.set(sf.backArmQuat[0], sf.backArmQuat[1], sf.backArmQuat[2], sf.backArmQuat[3]);
              backArmVisual.position.lerp(tmpSpecPos, sAlpha);
              backArmVisual.quaternion.slerp(tmpSpecQuat, sAlpha);
            }
            if (frontArmVisual && sf.frontArmPos && sf.frontArmQuat) {
              tmpSpecPos.set(sf.frontArmPos[0], sf.frontArmPos[1], sf.frontArmPos[2]);
              tmpSpecQuat.set(sf.frontArmQuat[0], sf.frontArmQuat[1], sf.frontArmQuat[2], sf.frontArmQuat[3]);
              frontArmVisual.position.lerp(tmpSpecPos, sAlpha);
              frontArmVisual.quaternion.slerp(tmpSpecQuat, sAlpha);
            }

            gantryBeam.position.z = THREE.MathUtils.lerp(gantryBeam.position.z, sf.gantryZ, sAlpha);
            trolleyMesh.position.set(
              THREE.MathUtils.lerp(trolleyMesh.position.x, sf.gantryX, sAlpha),
              3.82,
              gantryBeam.position.z
            );

            tmpThreePosA.set(trolleyMesh.position.x, 3.79, trolleyMesh.position.z);
            tmpThreePosB.set(ufoHeadGroup.position.x, ufoHeadGroup.position.y + 0.22, ufoHeadGroup.position.z);
            tmpThreeDir.subVectors(tmpThreePosB, tmpThreePosA);
            const cableLenSpec = Math.max(0.08, tmpThreeDir.length());
            cableMesh.scale.set(1, cableLenSpec, 1);
            cableMesh.position.lerpVectors(tmpThreePosA, tmpThreePosB, 0.5);
            tmpThreeDir.normalize();
            tmpThreeQuat.setFromUnitVectors(tmpThreeUp, tmpThreeDir);
            cableMesh.quaternion.copy(tmpThreeQuat);

            const specShowAim =
              sf.phase === 'free_move' ||
              sf.phase === 'ready_right' ||
              sf.phase === 'moving_right' ||
              sf.phase === 'ready_up' ||
              sf.phase === 'moving_up';
            aimRing.visible = specShowAim;
            aimBeam.visible = specShowAim;
            if (specShowAim) {
              updateAimLaser(ufoHeadGroup.position.x, ufoHeadGroup.position.y, ufoHeadGroup.position.z);
            }

            for (const it of sf.items) {
              const ent = prizeEntities.get(it.id);
              if (ent) {
                tmpSpecPos.set(it.position[0], it.position[1], it.position[2]);
                tmpSpecQuat.set(it.quaternion[0], it.quaternion[1], it.quaternion[2], it.quaternion[3]);
                ent.mesh.position.lerp(tmpSpecPos, sAlpha);
                ent.mesh.quaternion.slerp(tmpSpecQuat, sAlpha);
              }
            }

            const desiredPose = getCameraPose(
              cameraViewRef.current,
              viewportW,
              viewportH,
              frontTiptoeDegRef.current
            );
            const lerpAlpha = Math.min(1, rawDt * 8.5);
            camera.position.lerp(desiredPose.pos, lerpAlpha);
            currentLookAt.lerp(desiredPose.look, lerpAlpha);
            camera.lookAt(currentLookAt);
            renderer!.render(scene, camera);
            return;
          }

          const curPhase = phaseRef.current;

          if (curPhase === 'free_move') {
            const { up, down, left, right } = freeMoveKeysRef.current;
            const dx = (right ? 1 : 0) - (left ? 1 : 0);
            const dz = (down ? 1 : 0) - (up ? 1 : 0);
            if (dx !== 0) {
              sim.gantryX = Math.max(
                GACHA_PHYSICS.CLAW_MIN_X,
                Math.min(GACHA_PHYSICS.CLAW_MAX_X, sim.gantryX + dx * GACHA_PHYSICS.MOVE_SPEED_X * dt)
              );
            }
            if (dz !== 0) {
              sim.gantryZ = Math.max(
                GACHA_PHYSICS.CLAW_MIN_Z,
                Math.min(GACHA_PHYSICS.CLAW_MAX_Z, sim.gantryZ + dz * GACHA_PHYSICS.MOVE_SPEED_Z * dt)
              );
            }
          } else if (curPhase === 'moving_right') {
            sim.gantryX = Math.min(GACHA_PHYSICS.CLAW_MAX_X, sim.gantryX + GACHA_PHYSICS.MOVE_SPEED_X * dt);
            if (sim.gantryX >= GACHA_PHYSICS.CLAW_MAX_X) {
              setCranePhase('ready_up');
              playTone(620, 0.08);
            }
          } else if (curPhase === 'moving_up') {
            sim.gantryZ = Math.max(GACHA_PHYSICS.CLAW_MIN_Z, sim.gantryZ - GACHA_PHYSICS.MOVE_SPEED_Z * dt);
            if (sim.gantryZ <= GACHA_PHYSICS.CLAW_MIN_Z) {
              startDescending();
            }
          } else if (curPhase === 'descending') {
            sim.phaseTimer += dt;
            sim.targetHeadY = Math.max(effectiveDropY, sim.targetHeadY - 0.64 * dt);
            winchJoint.setMotorMaxForce(tuningRef.current.downPressForce + 18);

            const actualHeadY = headBody.translation().y;
            if (actualHeadY - sim.targetHeadY > 0.14 && Math.abs(actualHeadY - sim.lastHeadYForStall) < 0.015) {
              sim.descendStallTimer += dt;
            } else {
              sim.descendStallTimer = 0;
              sim.lastHeadYForStall = actualHeadY;
            }

            if (sim.targetHeadY <= effectiveDropY || sim.descendStallTimer >= 0.45) {
              sim.phaseTimer = 0;
              setArmTorques(tuningRef.current.closeTorque);
              setCranePhase('closing');
              playTone(330, 0.1, 'square', 0.05);
            }
          } else if (curPhase === 'closing') {
            sim.phaseTimer += dt;
            const prog = Math.min(1, sim.phaseTimer / 0.52);
            const activeCloseTarget = isPlushMachine ? -0.02 : CLAW_CLOSE_TARGET;
            const targetAng = CLAW_OPEN_ANGLE * (1 - prog) + activeCloseTarget * prog;
            setArmTargets(targetAng);

            if (sim.phaseTimer >= 0.62) {
              sim.phaseTimer = 0;
              sim.liftTopHoldTimer = 0;
              sim.releaseClearTimer = 0;
              sim.effectTriggeredThisTurn = false;
              sim.liftStartY.clear();
              for (const ent of prizeEntities.values()) {
                sim.liftStartY.set(ent.data.id, ent.body.translation().y);
              }
              winchJoint.setMotorMaxForce(220);
              setArmTorques(tuningRef.current.liftTorque);
              setArmTargets(activeCloseTarget);
              setCranePhase('lifting');
              playTone(587.33, 0.12);
            }
          } else if (curPhase === 'lifting') {
            sim.phaseTimer += dt;
            const prevTargetY = sim.targetHeadY;
            sim.targetHeadY = Math.min(effectiveLiftY, sim.targetHeadY + 0.58 * dt);
            winchJoint.setMotorMaxForce(220);

            if (!isPlushMachine && !sim.effectTriggeredThisTurn && sim.phaseTimer >= 0.12) {
              const hp = headBody.translation();
              for (const ent of prizeEntities.values()) {
                if (sim.wonSet.has(ent.data.id)) continue;
                const startY = sim.liftStartY.get(ent.data.id) ?? ent.data.position[1];
                const curY = ent.body.translation().y;
                const velY = ent.body.linvel().y;
                if (curY - startY >= 0.065 && velY > 0.05) {
                  const isInit = isBoxAtInitialPose(ent.data);
                  const dims = getBoxDimensions(ent.data.slotIndex);
                  if (isInit) {
                    const startPos = sim.turnStartPositions.get(ent.data.id) || ent.data.position;
                    const centerDx = Math.abs(hp.x - startPos[0]);
                    const centerDz = Math.abs(hp.z - startPos[2]);
                    const maxCenterDx = Math.max(0.20, dims.w * 0.30);
                    const maxCenterDz = Math.min(0.24, Math.max(0.20, dims.d * 0.16));
                    if (centerDx <= maxCenterDx && centerDz <= maxCenterDz) {
                      sim.effectTriggeredThisTurn = true;
                      triggerBalanceCatch();
                      break;
                    }
                  } else {
                    const activeRedHalfZ = redBarHalfZRef.current;
                    const nearCentralRedBar =
                      Math.abs(hp.z - activeRedHalfZ) <= 0.28 ||
                      Math.abs(hp.z + activeRedHalfZ) <= 0.28;
                    if (nearCentralRedBar) {
                      sim.effectTriggeredThisTurn = true;
                      triggerExtremeDrr();
                      break;
                    }
                  }
                }
              }
            }

            const reachedTop = prevTargetY >= effectiveLiftY - 0.005;
            if (reachedTop) {
              if (isPlushMachine && !sim.liftTopBumpApplied) {
                sim.liftTopBumpApplied = true;
                const bumpScale = sim.plushStrongGripTurn ? 0.5 : 1.0;
                const jx = (Math.random() - 0.5) * 3.2 * bumpScale;
                const jz = (Math.random() - 0.5) * 3.2 * bumpScale;
                headBody.applyImpulse({ x: jx, y: -3.2 * bumpScale, z: jz }, true);
                playTone(260, 0.05, 'triangle', 0.05);
              }
              sim.liftTopHoldTimer += dt;
            } else {
              sim.liftTopHoldTimer = 0;
            }

            // 최고점 도달 후 상승 관성이 잠잠해질 때까지(0.22s) 잠깐 정지한 뒤:
            // - 3D 인형 모드: 집게를 문 상태 그대로 배출구(초기 위치)까지 운반(carrying)
            // - 하시와타시 박스 모드: 제자리에서 집게 벌림(releasing)
            if ((reachedTop && sim.liftTopHoldTimer >= 0.22) || sim.phaseTimer >= 4.4) {
              sim.phaseTimer = 0;
              if (isPlushMachine) {
                sim.carryStopHoldTimer = 0;
                sim.carryTraveled = 0;
                sim.carryAxisStage = Math.abs(homeX - sim.gantryX) > 0.03 ? 'x' : 'z';
                sim.carryAxisPauseTimer = 0;
                setArmTorques(tuningRef.current.liftTorque);
                setArmTargets(-0.02);
                setCranePhase('carrying');
                playTone(493.88, 0.1);
              } else {
                sim.releaseClearTimer = 0;
                setArmTorques(Math.max(12, tuningRef.current.liftTorque * 2.2));
                setCranePhase('releasing');
                playTone(392, 0.1);
              }
            }
          } else if (curPhase === 'carrying') {
            // 3D 인형뽑기 전용: (1) 이동거리 비례 토크 감쇠 + (2) X→Z 직각 2단 운반/진동 + (3) 집게 미세 이완 + (4) 22% 강력 그립 편차
            sim.phaseTimer += dt;
            const dRatio = Math.min(1, sim.carryTraveled / 1.55);
            const baseLift = tuningRef.current.liftTorque;
            const carryTorque = sim.plushStrongGripTurn
              ? baseLift * (0.94 - 0.36 * dRatio)
              : baseLift * (0.62 - 0.56 * dRatio);
            const relaxedTargetAng = sim.plushStrongGripTurn
              ? -0.02 + dRatio * 0.04
              : -0.02 + dRatio * 0.34;

            const isMovingStage = sim.carryAxisStage === 'x' || sim.carryAxisStage === 'z';
            const railRipple = isMovingStage
              ? Math.sin(sim.phaseTimer * 26) * (sim.plushStrongGripTurn ? 0.008 : 0.032)
              : 0;
            sim.targetHeadY = effectiveLiftY + railRipple;
            winchJoint.setMotorMaxForce(220);
            setArmTorques(Math.max(0.22, carryTorque));
            setArmTargets(relaxedTargetAng);

            const carrySpeed = 1.24;
            if (sim.carryAxisStage === 'x') {
              const dx = homeX - sim.gantryX;
              if (Math.abs(dx) > 0.025) {
                const step = Math.min(Math.abs(dx), carrySpeed * dt);
                sim.gantryX += Math.sign(dx) * step;
                sim.carryTraveled += step;
              } else {
                sim.gantryX = homeX;
                sim.carryAxisPauseTimer = 0;
                if (Math.abs(homeZ - sim.gantryZ) > 0.03) {
                  const jScale = sim.plushStrongGripTurn ? 0.45 : 1.0;
                  headBody.applyImpulse(
                    { x: -Math.sign(dx || 1) * 1.45 * jScale, y: -1.35 * jScale, z: 0 },
                    true
                  );
                  sim.carryAxisStage = 'pause';
                } else {
                  sim.carryAxisStage = 'done';
                }
              }
              sim.carryStopHoldTimer = 0;
            } else if (sim.carryAxisStage === 'pause') {
              sim.carryAxisPauseTimer += dt;
              if (sim.carryAxisPauseTimer >= 0.15) {
                sim.carryAxisStage = 'z';
              }
              sim.carryStopHoldTimer = 0;
            } else if (sim.carryAxisStage === 'z') {
              const dz = homeZ - sim.gantryZ;
              if (Math.abs(dz) > 0.025) {
                const step = Math.min(Math.abs(dz), carrySpeed * dt);
                sim.gantryZ += Math.sign(dz) * step;
                sim.carryTraveled += step;
              } else {
                sim.gantryZ = homeZ;
                sim.carryAxisStage = 'done';
              }
              sim.carryStopHoldTimer = 0;
            } else {
              sim.gantryX = homeX;
              sim.gantryZ = homeZ;
              sim.carryStopHoldTimer += dt;
            }

            if (sim.carryStopHoldTimer >= 0.22 || sim.phaseTimer >= 6.0) {
              sim.phaseTimer = 0;
              sim.releaseClearTimer = 0;
              setArmTorques(Math.max(12, tuningRef.current.liftTorque * 2.2));
              setCranePhase('releasing');
              playTone(392, 0.1);
            }
          } else if (curPhase === 'releasing') {
            // 크레인 X/Z 제자리 완전 고정 상태에서 집게를 끝까지 넓게 벌려 상품이 완전히 낙하·이탈한 뒤에만 원위치 복귀
            sim.phaseTimer += dt;
            const openProg = Math.min(1, sim.phaseTimer / 0.62);
            const eased = openProg * openProg * (3 - 2 * openProg);
            const openAngle = CLAW_CLOSE_TARGET * (1 - eased) + CLAW_RELEASE_ANGLE * eased;
            setArmTargets(openAngle);

            // 집게가 충분히 벌어진 뒤에는 제자리에서 헤드만 수직으로 살짝 더 올려 여유 공간 확보
            if (sim.phaseTimer >= 0.68) {
              sim.targetHeadY = Math.min(homeY, sim.targetHeadY + 0.65 * dt);
            }

            const hpNow = headBody.translation();
            let allPrizesClearedClaw = true;
            for (const ent of prizeEntities.values()) {
              if (sim.wonSet.has(ent.data.id)) continue;
              const pp = ent.body.translation();
              const pv = ent.body.linvel();
              const horizDist = Math.hypot(pp.x - hpNow.x, pp.z - hpNow.z);
              const stillNearClaw = pp.y > hpNow.y - 1.25;
              const stillFallingMidAir = pp.y > (isPlushMachine ? 0.68 : 1.32) && Math.abs(pv.y) > 0.2;
              if (horizDist < 1.25 && (stillNearClaw || stillFallingMidAir)) {
                allPrizesClearedClaw = false;
                break;
              }
            }

            if (sim.phaseTimer >= 0.72 && allPrizesClearedClaw) {
              sim.releaseClearTimer += dt;
            } else {
              sim.releaseClearTimer = 0;
            }

            if ((sim.phaseTimer >= 1.25 && sim.releaseClearTimer >= 0.35) || sim.phaseTimer >= 3.0) {
              sim.phaseTimer = 0;
              sim.settleQuietTime = 0;
              setArmTorques(Math.max(10, tuningRef.current.closeTorque));
              setArmTargets(CLAW_OPEN_ANGLE);
              setCranePhase('settling');
            }
          } else if (curPhase === 'settling') {
            sim.phaseTimer += dt;
            sim.gantryX += (homeX - sim.gantryX) * Math.min(1, 2.2 * dt);
            sim.gantryZ += (homeZ - sim.gantryZ) * Math.min(1, 2.2 * dt);
            sim.targetHeadY += (homeY - sim.targetHeadY) * Math.min(1, 4.0 * dt);

            let allQuiet = true;
            for (const ent of prizeEntities.values()) {
              if (sim.wonSet.has(ent.data.id)) continue;
              const v = ent.body.linvel();
              const av = ent.body.angvel();
              if (Math.hypot(v.x, v.y, v.z) > 0.05 || Math.hypot(av.x, av.y, av.z) > 0.08) {
                allQuiet = false;
                break;
              }
            }
            if (allQuiet) sim.settleQuietTime += dt;
            else sim.settleQuietTime = 0;

            if (sim.settleQuietTime >= 0.55 || sim.phaseTimer >= 4.2) {
              finishTurn();
            }
          }

          if (curPhase !== 'idle') {
            gantryBody.setNextKinematicTranslation({ x: sim.gantryX, y: homeY, z: sim.gantryZ });
            winchJoint.configureMotorPosition(sim.targetHeadY - homeY, 320, 48);

            const isAimingPhase =
              curPhase === 'free_move' ||
              curPhase === 'ready_right' ||
              curPhase === 'moving_right' ||
              curPhase === 'ready_up' ||
              curPhase === 'moving_up';
            if (isAimingPhase) {
              for (const ent of prizeEntities.values()) {
                const sp = sim.turnStartPositions.get(ent.data.id) || ent.data.position;
                const sq = sim.turnStartQuats.get(ent.data.id) || ent.data.quaternion;
                ent.body.setTranslation({ x: sp[0], y: sp[1], z: sp[2] }, false);
                ent.body.setRotation({ x: sq[0], y: sq[1], z: sq[2], w: sq[3] }, false);
                ent.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
                ent.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
              }
            }

            sim.stepAccum += dt;
            const fixedStep = 1 / 120;
            let steps = 0;
            while (sim.stepAccum >= fixedStep && steps < 6) {
              world.step();
              sim.stepAccum -= fixedStep;
              steps++;
            }

            if (!isAimingPhase) {
              for (const ent of prizeEntities.values()) {
                const pp = ent.body.translation();
                const pq = ent.body.rotation();
                ent.mesh.position.set(pp.x, pp.y, pp.z);
                ent.mesh.quaternion.set(pq.x, pq.y, pq.z, pq.w);

                if (!sim.wonSet.has(ent.data.id) && pp.y < GACHA_PHYSICS.DROP_Y_THRESHOLD) {
                  sim.wonSet.add(ent.data.id);
                  setDroppedThisTurn(sim.wonSet.size);
                  triggerFinishWin();
                } else if (
                  !isPlushMachine &&
                  !sim.wonSet.has(ent.data.id) &&
                  !sim.nearNearTriggeredThisTurn &&
                  (curPhase === 'releasing' || curPhase === 'settling') &&
                  sim.phaseTimer >= 0.22
                ) {
                  const dims = getBoxDimensions(ent.data.slotIndex);
                  if (isPrizeSpanningRedAndBlueBar(pp, pq, dims, GACHA_PHYSICS.DROP_Y_THRESHOLD, redBarHalfZRef.current)) {
                    sim.nearNearTriggeredThisTurn = true;
                    triggerNearNear();
                  }
                }
              }
            }
          }

          if (tuningRef.current.showColliders) {
            const { vertices, colors } = world.debugRender();
            debugLinesGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            debugLinesGeo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
            debugLinesMesh.visible = true;
          } else {
            debugLinesMesh.visible = false;
          }

          const hp = headBody.translation();
          const hq = headBody.rotation();
          ufoHeadGroup.position.set(hp.x, hp.y, hp.z);
          ufoHeadGroup.quaternion.set(hq.x, hq.y, hq.z, hq.w);

          const lp = leftArm.body.translation();
          const lq = leftArm.body.rotation();
          leftArmVisual.position.set(lp.x, lp.y, lp.z);
          leftArmVisual.quaternion.set(lq.x, lq.y, lq.z, lq.w);

          const rp = rightArm.body.translation();
          const rq = rightArm.body.rotation();
          rightArmVisual.position.set(rp.x, rp.y, rp.z);
          rightArmVisual.quaternion.set(rq.x, rq.y, rq.z, rq.w);

          let bpArm: { x: number; y: number; z: number } | null = null;
          let bqArm: { x: number; y: number; z: number; w: number } | null = null;
          if (backArm && backArmVisual) {
            bpArm = backArm.body.translation();
            bqArm = backArm.body.rotation();
            backArmVisual.position.set(bpArm.x, bpArm.y, bpArm.z);
            backArmVisual.quaternion.set(bqArm.x, bqArm.y, bqArm.z, bqArm.w);
          }
          let fpArm: { x: number; y: number; z: number } | null = null;
          let fqArm: { x: number; y: number; z: number; w: number } | null = null;
          if (frontArm && frontArmVisual) {
            fpArm = frontArm.body.translation();
            fqArm = frontArm.body.rotation();
            frontArmVisual.position.set(fpArm.x, fpArm.y, fpArm.z);
            frontArmVisual.quaternion.set(fqArm.x, fqArm.y, fqArm.z, fqArm.w);
          }

          gantryBeam.position.z = sim.gantryZ;
          trolleyMesh.position.set(sim.gantryX, 3.82, sim.gantryZ);

          tmpThreePosA.set(sim.gantryX, 3.79, sim.gantryZ);
          tmpThreePosB.set(hp.x, hp.y + 0.22, hp.z);
          tmpThreeDir.subVectors(tmpThreePosB, tmpThreePosA);
          const cableLen = Math.max(0.08, tmpThreeDir.length());
          cableMesh.scale.set(1, cableLen, 1);
          cableMesh.position.lerpVectors(tmpThreePosA, tmpThreePosB, 0.5);
          tmpThreeDir.normalize();
          tmpThreeQuat.setFromUnitVectors(tmpThreeUp, tmpThreeDir);
          cableMesh.quaternion.copy(tmpThreeQuat);

          const showAim =
            curPhase === 'free_move' ||
            curPhase === 'ready_right' ||
            curPhase === 'moving_right' ||
            curPhase === 'ready_up' ||
            curPhase === 'moving_up';
          aimRing.visible = showAim;
          aimBeam.visible = showAim;
          if (showAim) {
            updateAimLaser(hp.x, hp.y, hp.z);
          }

          const desiredPose = getCameraPose(
            cameraViewRef.current,
            viewportW,
            viewportH,
            frontTiptoeDegRef.current
          );
          const lerpAlpha = Math.min(1, rawDt * 8.5);
          camera.position.lerp(desiredPose.pos, lerpAlpha);
          currentLookAt.lerp(desiredPose.look, lerpAlpha);
          camera.lookAt(currentLookAt);

          // 실시간 관전 브로드캐스트 (~13fps, 비동기 non-blocking)
          if (
            !sandboxModeRef.current &&
            isMyTurnRef.current &&
            curPhase !== 'idle' &&
            !livePostInFlightRef.current &&
            now - lastLivePostTimeRef.current >= 75
          ) {
            lastLivePostTimeRef.current = now;
            livePostInFlightRef.current = true;
            const liveItems = Array.from(prizeEntities.values()).map((ent) => {
              const ep = ent.body.translation();
              const eq = ent.body.rotation();
              return {
                id: ent.data.id,
                position: [
                  Number(ep.x.toFixed(3)),
                  Number(ep.y.toFixed(3)),
                  Number(ep.z.toFixed(3)),
                ],
                quaternion: [
                  Number(eq.x.toFixed(4)),
                  Number(eq.y.toFixed(4)),
                  Number(eq.z.toFixed(4)),
                  Number(eq.w.toFixed(4)),
                ],
              };
            });
            fetch('/api/gacha/live', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                machineIndex: machineIndexRef.current,
                turnKey: turnKeyRef.current || '',
                member: selectedMemberRef.current,
                phase: curPhase,
                gantryX: Number(sim.gantryX.toFixed(3)),
                gantryZ: Number(sim.gantryZ.toFixed(3)),
                headPos: [Number(hp.x.toFixed(3)), Number(hp.y.toFixed(3)), Number(hp.z.toFixed(3))],
                headQuat: [Number(hq.x.toFixed(4)), Number(hq.y.toFixed(4)), Number(hq.z.toFixed(4)), Number(hq.w.toFixed(4))],
                leftArmPos: [Number(lp.x.toFixed(3)), Number(lp.y.toFixed(3)), Number(lp.z.toFixed(3))],
                leftArmQuat: [Number(lq.x.toFixed(4)), Number(lq.y.toFixed(4)), Number(lq.z.toFixed(4)), Number(lq.w.toFixed(4))],
                rightArmPos: [Number(rp.x.toFixed(3)), Number(rp.y.toFixed(3)), Number(rp.z.toFixed(3))],
                rightArmQuat: [Number(rq.x.toFixed(4)), Number(rq.y.toFixed(4)), Number(rq.z.toFixed(4)), Number(rq.w.toFixed(4))],
                ...(bpArm && bqArm
                  ? {
                      backArmPos: [Number(bpArm.x.toFixed(3)), Number(bpArm.y.toFixed(3)), Number(bpArm.z.toFixed(3))],
                      backArmQuat: [Number(bqArm.x.toFixed(4)), Number(bqArm.y.toFixed(4)), Number(bqArm.z.toFixed(4)), Number(bqArm.w.toFixed(4))],
                    }
                  : {}),
                ...(fpArm && fqArm
                  ? {
                      frontArmPos: [Number(fpArm.x.toFixed(3)), Number(fpArm.y.toFixed(3)), Number(fpArm.z.toFixed(3))],
                      frontArmQuat: [Number(fqArm.x.toFixed(4)), Number(fqArm.y.toFixed(4)), Number(fqArm.z.toFixed(4)), Number(fqArm.w.toFixed(4))],
                    }
                  : {}),
                items: liveItems,
                effect: liveEffectRef.current.effect,
                effectSeq: liveEffectRef.current.seq,
              }),
            })
              .catch(() => {})
              .finally(() => {
                livePostInFlightRef.current = false;
              });
          }

          renderer!.render(scene, camera);
        };

        animId = requestAnimationFrame(animate);

        handleResize = () => {
          if (!container || !renderer) return;
          const w = container.clientWidth || 720;
          const h = container.clientHeight || 460;
          applyResponsiveCamera(w, h, false);
          renderer.setSize(w, h);
        };
        window.addEventListener('resize', handleResize);
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => handleResize?.()) : null;
        if (ro && container) ro.observe(container);
        const origHandleResize = handleResize;
        handleResize = () => {
          origHandleResize?.();
        };
        (container as any).__rapierRo = ro;
      })
      .catch((err) => {
        console.error('Rapier3D init failed:', err);
        if (!disposed) setEngineError(String(err?.message || err));
      });

    return () => {
      disposed = true;
      simControlRef.current = null;
      cancelAnimationFrame(animId);
      if (handleResize) window.removeEventListener('resize', handleResize);
      try {
        (container as any).__rapierRo?.disconnect();
      } catch {}
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
      }
      if (worldRef) {
        try {
          worldRef.free();
        } catch {}
      }
      setEngineReady(false);
    };
  }, [machineIndex, playTone, setCranePhase, triggerExtremeDrr, triggerBalanceCatch, triggerNearNear, triggerFinishWin, triggerStrongGrip]);

  const isCraneLockedToFront = isMyTurn || isFinishing || phase !== 'idle';

  const handleRightPressStart = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (cameraViewRef.current !== 'front') {
      setCameraView('front');
      cameraViewRef.current = 'front';
      return;
    }
    if (phaseRef.current === 'ready_right') {
      setCranePhase('moving_right');
      playTone(350, 0.06);
    }
  };

  const handleRightPressEnd = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (phaseRef.current === 'moving_right') {
      setCranePhase('ready_up');
      playTone(520, 0.08);
    }
  };

  const handleUpPressStart = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (cameraViewRef.current !== 'front') {
      setCameraView('front');
      cameraViewRef.current = 'front';
      return;
    }
    if (phaseRef.current === 'ready_up') {
      setCranePhase('moving_up');
      playTone(420, 0.06);
    }
  };

  const handleUpPressEnd = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (phaseRef.current === 'moving_up') {
      simControlRef.current?.startDescending();
    }
  };

  const [isFocusedMode, setIsFocusedMode] = useState(false);
  const isFocusedModeRef = useRef(false);
  const isMyTurnKeyLockRef = useRef(false);
  useEffect(() => {
    isFocusedModeRef.current = isFocusedMode;
  }, [isFocusedMode]);
  useEffect(() => {
    isMyTurnKeyLockRef.current = isMyTurn || isFinishing;
    if (typeof window !== 'undefined' && window.innerWidth >= 768) {
      if (isMyTurn) {
        setIsFocusedMode(true);
      } else if (!isFinishing) {
        setIsFocusedMode(false);
      }
    }
  }, [isMyTurn, isFinishing]);

  useEffect(() => {
    if (!isFocusedMode || typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isFocusedMode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = Boolean(
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      );

      // 데스크톱 플레이 중 또는 집중 확대 모드에서는 방향키/스페이스로 브라우저가 스크롤되지 않도록 완전 차단 (key repeat 포함!)
      if (
        !isTyping &&
        (isMyTurnKeyLockRef.current || isFocusedModeRef.current) &&
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          e.key === ' ' ||
          (e.key === 'Enter' && phaseRef.current === 'free_move'))
      ) {
        e.preventDefault();
      }

      if (e.key === 'Escape' && isFocusedModeRef.current && !isMyTurnKeyLockRef.current) {
        e.preventDefault();
        setIsFocusedMode(false);
        return;
      }

      if (e.repeat || isTyping) return;
      if (phaseRef.current === 'free_move') {
        if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
          e.preventDefault();
          setFreeDir('up', true);
          playTone(420, 0.04);
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
          e.preventDefault();
          setFreeDir('down', true);
          playTone(380, 0.04);
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          setFreeDir('left', true);
          playTone(340, 0.04);
          return;
        }
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          setFreeDir('right', true);
          playTone(360, 0.04);
          return;
        }
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          handlePlushGrab();
          return;
        }
      }
      if ((e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') && phaseRef.current === 'ready_right') {
        e.preventDefault();
        if (cameraViewRef.current !== 'front') {
          setCameraView('front');
          cameraViewRef.current = 'front';
          return;
        }
        setCranePhase('moving_right');
        playTone(350, 0.06);
      } else if ((e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') && phaseRef.current === 'ready_up') {
        e.preventDefault();
        if (cameraViewRef.current !== 'front') {
          setCameraView('front');
          cameraViewRef.current = 'front';
          return;
        }
        setCranePhase('moving_up');
        playTone(420, 0.06);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        setFreeDir('up', false);
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        setFreeDir('down', false);
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        setFreeDir('left', false);
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        setFreeDir('right', false);
      }
      if ((e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') && phaseRef.current === 'moving_right') {
        e.preventDefault();
        setCranePhase('ready_up');
        playTone(520, 0.08);
      } else if ((e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') && phaseRef.current === 'moving_up') {
        e.preventDefault();
        simControlRef.current?.startDescending();
      }
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearFreeMove);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearFreeMove);
    };
  }, [playTone, setCranePhase, setFreeDir, clearFreeMove, handlePlushGrab]);

  const phaseBannerText = (() => {
    if (engineError) return `❌ Rapier3D 초기화 오류: ${engineError}`;
    if (!engineReady) return '⚙️ Rapier3D Rust WASM 물리 엔진 로딩 중...';
    if (lockedByOther) return `🔒 현재 ${lockedByOther}님이 크레인을 조작 중입니다...`;
    switch (phase) {
      case 'idle':
        return '하단 [뽑기 시작]을 눌러 Rapier3D UFO 브릿지 크레인을 조작하세요!';
      case 'free_move':
        return '🕹️ 상하좌우(↑↓←→)로 원하는 인형 위를 조준한 뒤 [뽑기] 버튼(또는 Space)을 누르세요!';
      case 'ready_right':
        return '1단계: [➡ 우측 이동] 버튼을 꾹 눌렀다가 원하는 X 위치에서 떼세요!';
      case 'moving_right':
        return '➡ 오른쪽으로 이동 중... 손을 떼면 X 좌표가 고정됩니다!';
      case 'ready_up':
        return '2단계: [⬆ 안쪽(위) 이동] 버튼을 꾹 눌렀다가 원하는 Z 위치에서 떼세요!';
      case 'moving_up':
        return '⬆ 안쪽으로 이동 중... 손을 떼면 즉시 하강하여 집게가 작동합니다!';
      case 'descending':
        return '⬇ Prismatic 윈치 크레인이 하강하고 있습니다...';
      case 'closing':
        return isPlushSlot(machineIndex)
          ? '🤏 4방향 스틸 집게로 인형을 집는 중...'
          : '🤏 실제 Revolute 모터 집게로 상자를 잡는 중...';
      case 'lifting':
        return isPlushSlot(machineIndex)
          ? '⬆ 인형을 집어 들어올리는 중...'
          : '⬆ 물리 마찰과 토크로 상자를 들어올리고 있습니다!';
      case 'carrying':
        return '🎁 인형을 문 채 배출구(구멍) 위로 운반하는 중...';
      case 'releasing':
      case 'settling':
        return droppedThisTurn > 0
          ? isPlushSlot(machineIndex)
            ? '🎉 배출구로 인형이 떨어졌습니다!! 결과 저장 중...'
            : '🎉 Bar 사이로 상자가 떨어졌습니다!! 결과 저장 중...'
          : isPlushSlot(machineIndex)
          ? '⚖️ 인형이 자리를 잡는 중...'
          : '⚖️ 상자가 Bar 위에서 흔들리며 자리를 잡는 중...';
    }
  })();

  return (
    <div
      className={
        isFocusedMode
          ? 'fixed inset-0 z-[60] bg-slate-950/95 backdrop-blur-md p-3 sm:p-5 flex items-center justify-center'
          : 'w-full'
      }
    >
    <div
      className={
        isFocusedMode
          ? 'w-full max-w-5xl h-full max-h-[94vh] rounded-3xl overflow-hidden border-2 border-emerald-400/60 bg-slate-950 shadow-2xl shadow-emerald-950/50 flex flex-col'
          : 'w-full rounded-3xl overflow-hidden border border-emerald-500/35 bg-slate-950 shadow-2xl shadow-emerald-950/30'
      }
    >
      <div className="px-4 py-2.5 bg-slate-900/95 border-b border-slate-800 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-black shrink-0">
              <Sparkles className="w-3 h-3" />
              {machineIndex + 1}/{machineCount}번 판
            </span>
            <span className="text-xs font-black text-amber-300 shrink-0 hidden sm:inline">
              {machineLabel}
            </span>
            <span className="text-xs font-bold text-slate-200 truncate">{phaseBannerText}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsFocusedMode((v) => !v)}
              className={`hidden sm:inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[11px] font-black transition-colors cursor-pointer ${
                isFocusedMode
                  ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200 hover:bg-emerald-500/30'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700'
              }`}
              title={isFocusedMode ? '집중 확대 모드 종료' : '데스크톱 집중 확대 모드 (스크롤 잠금)'}
            >
              {isFocusedMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              <span>{isFocusedMode ? '축소' : '확대'}</span>
            </button>
            <button
              type="button"
              onClick={() => setSoundEnabled((v) => !v)}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer shrink-0"
              title={soundEnabled ? '효과음 끄기' : '효과음 켜기'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
            </button>
          </div>
        </div>

        {machineSummaries.length > 0 && (() => {
          const liveMachines = machineSummaries.filter((m) => Boolean(m.lockedBy) && !m.suspended);
          const availableRandomPool = machineSummaries.filter((m) => m.hasStock && !m.suspended);
          const scrollTabsBy = (delta: number) => {
            machineTabsRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
          };
          return (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 w-full min-w-0">
            <div className="flex items-center gap-1.5 min-w-0 w-full flex-1">
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={isCraneLockedToFront}
                  onClick={() => setIsMachinePickerOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-gradient-to-r from-emerald-500/25 to-cyan-500/25 hover:from-emerald-500/35 hover:to-cyan-500/35 border border-emerald-400/60 text-emerald-200 text-[11px] font-black shrink-0 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  title="전체 뽑기판 한눈에 보고 선택하기"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>선택</span>
                </button>
                <button
                  type="button"
                  disabled={isCraneLockedToFront || availableRandomPool.length === 0}
                  onClick={() => {
                    if (availableRandomPool.length === 0) return;
                    const pool =
                      availableRandomPool.length > 1
                        ? availableRandomPool.filter((m) => m.index !== machineIndex)
                        : availableRandomPool;
                    const picked = pool[Math.floor(Math.random() * pool.length)];
                    if (picked) onSelectMachine?.(picked.index);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-gradient-to-r from-fuchsia-500/25 to-amber-500/25 hover:from-fuchsia-500/35 hover:to-amber-500/35 border border-fuchsia-400/60 text-fuchsia-200 text-[11px] font-black shrink-0 shadow-sm cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed transition-all"
                  title="재고가 남은 뽑기판 중 랜덤 선택"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  <span>랜덤</span>
                </button>
                <button
                  type="button"
                  disabled={isCraneLockedToFront}
                  onClick={() => {
                    if (liveMachines.length === 0) {
                      showSpectateToast('현재 진행 중인 뽑기가 없습니다.');
                      return;
                    }
                    if (liveMachines.length === 1) {
                      onSelectMachine?.(liveMachines[0].index);
                      return;
                    }
                    setIsSpectatePickerOpen(true);
                  }}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border text-[11px] font-black shrink-0 shadow-sm cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed transition-all ${
                    liveMachines.length > 0
                      ? 'bg-gradient-to-r from-rose-500/30 to-amber-500/30 hover:from-rose-500/40 hover:to-amber-500/40 border-rose-400/70 text-rose-100'
                      : 'bg-slate-900/90 hover:bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                  title="현재 진행 중인 뽑기 실시간 자동 관전"
                >
                  <Radio className={`w-3.5 h-3.5 ${liveMachines.length > 0 ? 'text-rose-300 animate-pulse' : 'text-slate-400'}`} />
                  <span>관전{liveMachines.length > 0 ? ` (${liveMachines.length})` : ''}</span>
                </button>
              </div>

              <div className="flex items-center gap-1 min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => scrollTabsBy(-240)}
                  className="p-1 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white shrink-0 cursor-pointer transition-colors"
                  aria-label="뽑기판 목록 왼쪽으로 스크롤"
                  title="왼쪽으로 스크롤"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <div
                  ref={machineTabsRef}
                  onWheel={(e) => {
                    const el = machineTabsRef.current;
                    if (!el) return;
                    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                      e.preventDefault();
                      el.scrollLeft += e.deltaY;
                    }
                  }}
                  className="flex items-center gap-1.5 overflow-x-auto touch-pan-x pb-0.5 min-w-0 flex-1"
                  style={{ scrollbarWidth: 'thin' }}
                >
                  {machineSummaries.map((ms) => {
                    const isActive = ms.index === machineIndex;
                    return (
                      <button
                        key={ms.index}
                        data-machine-idx={ms.index}
                        type="button"
                        disabled={isCraneLockedToFront}
                        onClick={() => onSelectMachine?.(ms.index)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold shrink-0 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                          isActive
                            ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 shadow-sm'
                            : ms.suspended
                            ? 'bg-amber-950/35 hover:bg-amber-950/55 border-amber-500/40 text-amber-300/80'
                            : 'bg-slate-950/80 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            ms.suspended
                              ? 'bg-amber-400'
                              : ms.lockedBy
                              ? 'bg-rose-400 animate-pulse'
                              : ms.hasStock
                              ? 'bg-emerald-400'
                              : 'bg-slate-600'
                          }`}
                        />
                        <span>{ms.shortName}</span>
                        {ms.suspended ? (
                          <span className="text-[9px] text-amber-300 font-black">점검</span>
                        ) : !ms.hasStock ? (
                          <span className="text-[9px] text-rose-400 font-black">품절</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => scrollTabsBy(240)}
                  className="p-1 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white shrink-0 cursor-pointer transition-colors"
                  aria-label="뽑기판 목록 오른쪽으로 스크롤"
                  title="오른쪽으로 스크롤"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {isAdmin && (
              <div className="flex items-center gap-1.5 shrink-0 sm:ml-auto">
                <button
                  type="button"
                  onClick={onAdminRefill}
                  disabled={isRefilling || isResetting || isCraneLockedToFront}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 text-[11px] font-black cursor-pointer disabled:opacity-45 transition-colors"
                >
                  {isRefilling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackagePlus className="w-3.5 h-3.5" />}
                  <span>뽑기판 리필</span>
                </button>

                <button
                  type="button"
                  onClick={onAdminReset}
                  disabled={isResetting || isRefilling || isCraneLockedToFront}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 text-[11px] font-black cursor-pointer disabled:opacity-45 transition-colors"
                >
                  {isResetting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  <span>뽑기판 재정렬</span>
                </button>
              </div>
            )}
          </div>
          );
        })()}
        {spectateToast && (
          <div className="px-3 py-1.5 rounded-xl bg-slate-800/95 border border-slate-600/80 text-amber-200 text-[11px] font-bold flex items-center justify-between gap-2">
            <span>📡 {spectateToast}</span>
            <button type="button" onClick={() => setSpectateToast('')} className="text-slate-400 hover:text-white cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className={`relative w-full bg-[#040c14] select-none ${isFocusedMode ? 'flex-1 min-h-[360px]' : 'h-[300px] sm:h-[450px]'}`}>
        <div ref={mountRef} className="w-full h-full" />

        {isMachineSuspended && !isAdmin && (
          <div className="absolute inset-0 z-40 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-5 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-2xl">
              🛠️
            </div>
            <div className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-300 text-[11px] font-black">
              {machineIndex + 1}번 기기 운영 중단 · 점검중
            </div>
            <h3 className="text-base sm:text-lg font-black text-white">
              [{machineIndex + 1}번] {machineLabel} 점검중입니다
            </h3>
            <p className="text-xs text-slate-300 max-w-sm leading-relaxed">
              관리자에 의해 이 뽑기판만 일시 운영 중단 상태입니다. 상단 탭이나 <strong>[선택]</strong> 버튼으로 다른 정상 뽑기판을 이용해주세요!
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setCameraView('front');
            setFrontTiptoeDeg(0);
          }}
          className={`absolute top-2.5 left-2.5 z-20 inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] sm:text-[11px] font-bold backdrop-blur-sm transition-all cursor-pointer ${
            cameraView === 'front' && frontTiptoeDeg === 0
              ? 'bg-slate-900/75 border-slate-700/80 text-slate-300'
              : 'bg-emerald-950/85 border-emerald-400/60 text-emerald-200 hover:bg-emerald-900/85'
          }`}
        >
          <Camera className="w-3 h-3 text-emerald-400" />
          <span>
            {cameraView === 'front'
              ? frontTiptoeDeg > 0
                ? `까치발 +${frontTiptoeDeg}°`
                : isCraneLockedToFront
                ? '정면뷰 (조작 고정)'
                : '정면뷰'
              : cameraView === 'top'
              ? '항공뷰 · 정면복귀'
              : '우측뷰 · 정면복귀'}
          </span>
        </button>

        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
          {!isCraneLockedToFront && (
            <button
              type="button"
              onClick={() => setCameraView((prev) => (prev === 'top' ? 'front' : 'top'))}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] sm:text-xs font-black backdrop-blur-sm shadow-md transition-all active:scale-95 cursor-pointer ${
                cameraView === 'top'
                  ? 'bg-emerald-500/90 border-emerald-300 text-slate-950'
                  : 'bg-slate-900/80 hover:bg-slate-800/90 border-slate-600/80 text-slate-200 hover:text-emerald-300'
              }`}
            >
              {cameraView === 'top' ? (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>정면뷰</span>
                </>
              ) : (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  <span>항공뷰</span>
                </>
              )}
            </button>
          )}

          {cameraView === 'front' && (
            <div className="inline-flex items-center rounded-full border border-emerald-500/50 bg-slate-900/85 backdrop-blur-sm shadow-md overflow-hidden">
              <button
                type="button"
                disabled={frontTiptoeDeg >= 45}
                onClick={() => setFrontTiptoeDeg((d) => Math.min(45, d + 15))}
                className="inline-flex items-center gap-0.5 px-2 py-1 text-[10px] sm:text-xs font-black text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-35 cursor-pointer"
              >
                <ChevronUp className="w-3.5 h-3.5" />
                <span>업</span>
              </button>
              <span className="px-1.5 text-[10px] sm:text-[11px] font-mono font-black text-white border-x border-slate-700/80">
                {frontTiptoeDeg}°
              </span>
              <button
                type="button"
                disabled={frontTiptoeDeg <= 0}
                onClick={() => setFrontTiptoeDeg((d) => Math.max(0, d - 15))}
                className="inline-flex items-center gap-0.5 px-2 py-1 text-[10px] sm:text-xs font-black text-amber-300 hover:bg-amber-500/20 disabled:opacity-35 cursor-pointer"
              >
                <span>다운</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {!(isMyTurn && sessionProgress && sessionProgress.total > 1) && (
          <div className="absolute top-2.5 right-2.5 z-20 hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-950/80 border border-emerald-500/35 text-[10px] font-mono font-bold text-emerald-300 backdrop-blur-sm pointer-events-none">
            <Activity className="w-3 h-3" />
            <span>Rapier3D Rust · 120Hz</span>
          </div>
        )}

        {!isCraneLockedToFront && (
          <button
            type="button"
            onClick={() => setCameraView((prev) => (prev === 'right' ? 'front' : 'right'))}
            className={`absolute right-2 top-1/2 -translate-y-1/2 z-20 inline-flex flex-col items-center justify-center px-1.5 py-2 rounded-2xl border text-[10px] font-black backdrop-blur-sm shadow-md transition-all active:scale-95 cursor-pointer gap-0.5 ${
              cameraView === 'right'
                ? 'bg-amber-500/90 border-amber-300 text-slate-950'
                : 'bg-slate-900/80 hover:bg-slate-800/90 border-slate-600/80 text-slate-200 hover:text-amber-300'
            }`}
          >
            {cameraView === 'right' ? (
              <>
                <ChevronLeft className="w-4 h-4" />
                <span className="leading-none">정면</span>
              </>
            ) : (
              <>
                <ChevronRight className="w-4 h-4" />
                <span className="leading-none">우측</span>
              </>
            )}
          </button>
        )}

        <div className="absolute bottom-2.5 left-2.5 pointer-events-none px-2.5 py-1 rounded-lg bg-emerald-950/85 border border-emerald-500/40 text-[10px] sm:text-xs font-bold text-emerald-300 backdrop-blur-sm">
          🎯 <strong className="text-white">{machineLabel}</strong> ({machineDifficulty}) · 통과 시{' '}
          <span className="text-amber-300 font-mono">{machineRewardSol} SOL</span> 당첨!
        </div>

        {droppedThisTurn > 0 && (
          <div className="absolute top-11 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-4 py-1.5 rounded-full bg-amber-500 text-slate-950 font-black text-xs sm:text-sm shadow-lg animate-bounce">
            🎊 통과 성공!! 상자 획득!
          </div>
        )}

        {showStartPopup && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <div className="px-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 border-2 border-emerald-100 text-white font-black text-xl sm:text-3xl tracking-tight shadow-[0_0_40px_rgba(16,185,129,0.85)] animate-bounce">
              🕹️ 뽑기 시작!
            </div>
          </div>
        )}

        {showExtremeDrr && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <div className="px-6 py-3 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-rose-600 border-2 border-yellow-200 text-white font-black text-xl sm:text-3xl tracking-tight shadow-[0_0_40px_rgba(249,115,22,0.85)] animate-bounce">
              ⚡ 극한 드르륵! ⚡
            </div>
          </div>
        )}

        {showStrongGrip && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <div className="px-6 py-3 rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-amber-400 border-2 border-yellow-200 text-white font-black text-xl sm:text-3xl tracking-tight shadow-[0_0_45px_rgba(217,70,239,0.9)] animate-bounce">
              💪 강력 그립! ⚡
            </div>
          </div>
        )}

        {showBalanceCatch && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <div className="px-6 py-3 rounded-2xl bg-gradient-to-r from-cyan-500 via-emerald-500 to-teal-500 border-2 border-cyan-100 text-white font-black text-xl sm:text-3xl tracking-tight shadow-[0_0_40px_rgba(16,185,129,0.85)] animate-bounce">
              ⚖️ Balance Catch!
            </div>
          </div>
        )}

        {showNearNear && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <div className="px-6 py-3 rounded-2xl bg-gradient-to-r from-fuchsia-600 via-pink-500 to-rose-500 border-2 border-pink-100 text-white font-black text-xl sm:text-3xl tracking-tight shadow-[0_0_40px_rgba(236,72,153,0.85)] animate-bounce">
              😱 아슬 아슬!
            </div>
          </div>
        )}

        {showFinishWin && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <div className="px-7 py-3.5 rounded-2xl bg-gradient-to-r from-yellow-400 via-amber-500 to-orange-500 border-2 border-yellow-100 text-slate-950 font-black text-2xl sm:text-4xl tracking-tight shadow-[0_0_50px_rgba(251,191,36,0.95)] animate-bounce">
              🎉 당첨!
            </div>
          </div>
        )}

        {isMyTurn && sessionProgress && sessionProgress.total > 1 && (
          <div className="absolute top-2.5 right-2.5 z-20 pointer-events-none px-3 py-1 rounded-xl bg-indigo-950/90 border border-emerald-400/50 text-xs font-black text-emerald-200 shadow-lg backdrop-blur-sm flex items-center gap-1.5">
            <span>
              🔥 연속 뽑기 {sessionProgress.current} / {sessionProgress.total}회
            </span>
            {sessionProgress.bonusPlays > 0 &&
              sessionProgress.current > sessionProgress.total - sessionProgress.bonusPlays && (
                <span className="px-1.5 py-0.5 rounded-md bg-amber-500 text-slate-950 text-[10px] font-black">
                  🎁 무료 보너스!
                </span>
              )}
          </div>
        )}

        {lockedByOther && !isMyTurn && (
          <div className="absolute inset-0 z-10 bg-slate-950/25 backdrop-blur-[0.6px] pointer-events-none flex items-start justify-center pt-11 sm:pt-12 px-3">
            <div className="px-4 py-2 rounded-2xl bg-slate-900/85 border border-rose-500/60 shadow-2xl text-center backdrop-blur-sm max-w-sm">
              <div className="inline-flex items-center gap-1.5 text-rose-300 text-[11px] font-black flex-wrap justify-center">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                <span className="px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-400/40 text-rose-200 text-[10px]">
                  {spectateLiveActive ? 'LIVE 실시간 관전' : '관전 대기 중'}
                </span>
                <span className="text-white">
                  🔒 <span className="text-amber-300">{lockedByOther}</span>님 진행 중
                  {otherSessionProgress && otherSessionProgress.total > 1
                    ? ` (${otherSessionProgress.current}/${otherSessionProgress.total}회)`
                    : ''}
                </span>
              </div>
              <p className="text-[10px] text-slate-300 mt-0.5">
                {spectateLiveActive && spectatePhase && LIVE_PHASE_LABELS[spectatePhase]
                  ? `현재 동작: ${LIVE_PHASE_LABELS[spectatePhase]} · 카메라 시점 전환 가능`
                  : '실시간 조작 화면을 관전할 수 있으며, 종료 후 바로 참여 가능합니다.'}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-gradient-to-b from-slate-900 to-slate-950 border-t border-slate-800">
        {phase === 'idle' ? (
          <div className="flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-300 text-center md:text-left space-y-0.5">
              <div>
                {sandboxMode ? (
                  <>
                    모드: <strong className="text-emerald-300">Rapier3D 무료 무한 연습실 (Port 4300)</strong>
                  </>
                ) : (
                  <>
                    선택된 플레이어: <strong className="text-amber-400">{selectedMember}</strong>{' '}
                    <span className="text-slate-400">(보유 뽑기권 {selectedMemberTickets}장)</span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-emerald-300 font-bold">
                현재 뽑기판 [{machineIndex + 1}/{machineCount}]:{' '}
                <span className="text-white">{machineLabel}</span> · {machineDifficulty} ·{' '}
                <span className="text-amber-300 font-mono">{machineRewardSol} SOL</span>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto justify-center">
              <button
                type="button"
                disabled={isCraneLockedToFront || isStarting}
                onClick={onPrevMachine}
                className="inline-flex items-center justify-center gap-1 px-3.5 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-600/80 hover:border-emerald-400/60 text-slate-200 hover:text-emerald-200 font-black text-xs sm:text-sm transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>이전 뽑기</span>
              </button>

              <button
                type="button"
                disabled={!engineReady || !canStartTurn || isStarting || isFinishing || !!lockedByOther || items.length === 0}
                onClick={() => {
                  if (cameraViewRef.current !== 'front') {
                    setCameraView('front');
                    cameraViewRef.current = 'front';
                  }
                  onStartTurnRequest?.();
                }}
                className="flex-1 md:flex-none px-5 sm:px-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-emerald-500/25 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              >
                {!engineReady
                  ? '⚙️ 물리 엔진 준비 중...'
                  : isFinishing
                  ? '💾 위치 저장 중...'
                  : isStarting
                  ? '크레인 준비 중...'
                  : lockedByOther
                  ? `🔒 ${lockedByOther}님 진행 중...`
                  : items.length === 0
                  ? '📦 품절 (리필 대기)'
                  : selectedMemberTickets < 1
                  ? '뽑기권 부족'
                  : '🕹️ 뽑기 시작!'}
              </button>

              <button
                type="button"
                disabled={isCraneLockedToFront || isStarting}
                onClick={onNextMachine}
                className="inline-flex items-center justify-center gap-1 px-3.5 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-600/80 hover:border-emerald-400/60 text-slate-200 hover:text-emerald-200 font-black text-xs sm:text-sm transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
              >
                <span>다음 뽑기</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : isPlushSlot(machineIndex) ? (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-xl mx-auto">
            <div className="grid grid-cols-3 gap-1.5 w-[198px] shrink-0 select-none">
              <div />
              <button
                type="button"
                aria-label="위(안쪽) 이동"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setFreeDir('up', true);
                  playTone(420, 0.04);
                }}
                onPointerUp={() => setFreeDir('up', false)}
                onPointerLeave={() => setFreeDir('up', false)}
                onPointerCancel={() => setFreeDir('up', false)}
                onContextMenu={(e) => e.preventDefault()}
                disabled={phase !== 'free_move'}
                style={{ touchAction: 'none' }}
                className={`h-14 rounded-2xl border-2 font-black flex flex-col items-center justify-center gap-0.5 transition-all select-none ${
                  freeDirState.up
                    ? 'bg-emerald-400 text-slate-950 border-white scale-95 shadow-lg shadow-emerald-500/40'
                    : phase === 'free_move'
                    ? 'bg-slate-800 hover:bg-slate-700 text-emerald-200 border-emerald-400/60 shadow cursor-pointer'
                    : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
                }`}
              >
                <ArrowUp className="w-5 h-5 stroke-[3]" />
                <span className="text-[10px] leading-none">상</span>
              </button>
              <div />

              <button
                type="button"
                aria-label="좌측 이동"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setFreeDir('left', true);
                  playTone(340, 0.04);
                }}
                onPointerUp={() => setFreeDir('left', false)}
                onPointerLeave={() => setFreeDir('left', false)}
                onPointerCancel={() => setFreeDir('left', false)}
                onContextMenu={(e) => e.preventDefault()}
                disabled={phase !== 'free_move'}
                style={{ touchAction: 'none' }}
                className={`h-14 rounded-2xl border-2 font-black flex flex-col items-center justify-center gap-0.5 transition-all select-none ${
                  freeDirState.left
                    ? 'bg-emerald-400 text-slate-950 border-white scale-95 shadow-lg shadow-emerald-500/40'
                    : phase === 'free_move'
                    ? 'bg-slate-800 hover:bg-slate-700 text-emerald-200 border-emerald-400/60 shadow cursor-pointer'
                    : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
                }`}
              >
                <ArrowLeft className="w-5 h-5 stroke-[3]" />
                <span className="text-[10px] leading-none">좌</span>
              </button>
              <div className="h-14 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-center text-[10px] font-black text-slate-400">
                4방향
              </div>
              <button
                type="button"
                aria-label="우측 이동"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setFreeDir('right', true);
                  playTone(360, 0.04);
                }}
                onPointerUp={() => setFreeDir('right', false)}
                onPointerLeave={() => setFreeDir('right', false)}
                onPointerCancel={() => setFreeDir('right', false)}
                onContextMenu={(e) => e.preventDefault()}
                disabled={phase !== 'free_move'}
                style={{ touchAction: 'none' }}
                className={`h-14 rounded-2xl border-2 font-black flex flex-col items-center justify-center gap-0.5 transition-all select-none ${
                  freeDirState.right
                    ? 'bg-emerald-400 text-slate-950 border-white scale-95 shadow-lg shadow-emerald-500/40'
                    : phase === 'free_move'
                    ? 'bg-slate-800 hover:bg-slate-700 text-emerald-200 border-emerald-400/60 shadow cursor-pointer'
                    : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
                }`}
              >
                <ArrowRight className="w-5 h-5 stroke-[3]" />
                <span className="text-[10px] leading-none">우</span>
              </button>

              <div />
              <button
                type="button"
                aria-label="아래(앞쪽) 이동"
                onPointerDown={(e) => {
                  e.preventDefault();
                  setFreeDir('down', true);
                  playTone(380, 0.04);
                }}
                onPointerUp={() => setFreeDir('down', false)}
                onPointerLeave={() => setFreeDir('down', false)}
                onPointerCancel={() => setFreeDir('down', false)}
                onContextMenu={(e) => e.preventDefault()}
                disabled={phase !== 'free_move'}
                style={{ touchAction: 'none' }}
                className={`h-14 rounded-2xl border-2 font-black flex flex-col items-center justify-center gap-0.5 transition-all select-none ${
                  freeDirState.down
                    ? 'bg-emerald-400 text-slate-950 border-white scale-95 shadow-lg shadow-emerald-500/40'
                    : phase === 'free_move'
                    ? 'bg-slate-800 hover:bg-slate-700 text-emerald-200 border-emerald-400/60 shadow cursor-pointer'
                    : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
                }`}
              >
                <ArrowDown className="w-5 h-5 stroke-[3]" />
                <span className="text-[10px] leading-none">하</span>
              </button>
              <div />
            </div>

            <button
              type="button"
              data-testid="plush-grab-btn"
              onClick={handlePlushGrab}
              disabled={phase !== 'free_move'}
              className={`w-full sm:w-52 py-6 px-5 rounded-3xl font-black text-base sm:text-lg flex flex-col items-center justify-center gap-1.5 border-2 select-none transition-all ${
                phase === 'free_move'
                  ? 'bg-gradient-to-b from-amber-400 via-orange-500 to-rose-500 text-slate-950 border-yellow-200 shadow-xl shadow-orange-500/35 hover:brightness-110 active:scale-95 cursor-pointer animate-pulse'
                  : 'bg-slate-900 text-slate-500 border-slate-800 cursor-not-allowed'
              }`}
            >
              <span className="text-2xl leading-none">🕹️</span>
              <span>뽑기</span>
              <span className="text-[11px] font-bold opacity-85">
                {phase === 'free_move' ? '하강·집기 실행 (Space)' : '크레인 작동 중...'}
              </span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto">
            <button
              type="button"
              onMouseDown={handleRightPressStart}
              onMouseUp={handleRightPressEnd}
              onMouseLeave={handleRightPressEnd}
              onTouchStart={handleRightPressStart}
              onTouchEnd={handleRightPressEnd}
              onTouchCancel={handleRightPressEnd}
              onContextMenu={(e) => e.preventDefault()}
              disabled={phase !== 'ready_right' && phase !== 'moving_right'}
              style={{ touchAction: 'none' }}
              className={`py-4 px-4 rounded-2xl font-black text-sm sm:text-base flex flex-col items-center justify-center gap-1 border-2 select-none transition-all ${
                phase === 'moving_right'
                  ? 'bg-emerald-400 text-slate-950 border-white scale-95 shadow-lg shadow-emerald-500/40 cursor-pointer'
                  : phase === 'ready_right'
                  ? 'bg-gradient-to-b from-emerald-500 to-teal-600 text-white border-emerald-300 shadow-lg shadow-emerald-500/25 hover:brightness-110 cursor-pointer animate-pulse'
                  : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
              }`}
            >
              <ArrowRight className="w-6 h-6 stroke-[3]" />
              <span>1. 우(→) 이동</span>
              <span className="text-[10px] font-medium opacity-85">
                {phase === 'moving_right' ? '손 떼면 정지!' : phase === 'ready_right' ? '꾹 누르고 있기 (→)' : '완료'}
              </span>
            </button>

            <button
              type="button"
              onMouseDown={handleUpPressStart}
              onMouseUp={handleUpPressEnd}
              onMouseLeave={handleUpPressEnd}
              onTouchStart={handleUpPressStart}
              onTouchEnd={handleUpPressEnd}
              onTouchCancel={handleUpPressEnd}
              onContextMenu={(e) => e.preventDefault()}
              disabled={phase !== 'ready_up' && phase !== 'moving_up'}
              style={{ touchAction: 'none' }}
              className={`py-4 px-4 rounded-2xl font-black text-sm sm:text-base flex flex-col items-center justify-center gap-1 border-2 select-none transition-all ${
                phase === 'moving_up'
                  ? 'bg-amber-400 text-slate-950 border-white scale-95 shadow-lg shadow-amber-500/40 cursor-pointer'
                  : phase === 'ready_up'
                  ? 'bg-gradient-to-b from-amber-500 to-orange-600 text-slate-950 border-amber-300 shadow-lg shadow-amber-500/25 hover:brightness-110 cursor-pointer animate-pulse'
                  : 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed'
              }`}
            >
              <ArrowUp className="w-6 h-6 stroke-[3]" />
              <span>2. 안쪽(↑) 이동</span>
              <span className="text-[10px] font-medium opacity-85">
                {phase === 'moving_up'
                  ? '손 떼면 하강!'
                  : phase === 'ready_up'
                  ? '꾹 누르고 있기 (↑)'
                  : phase === 'ready_right' || phase === 'moving_right'
                  ? '1단계 먼저'
                  : '작동 중'}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>

      {isMachinePickerOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setIsMachinePickerOpen(false)}
        >
          <div
            className="bg-slate-900 border border-emerald-500/40 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3.5 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm sm:text-base font-black text-white">뽑기판 상품 선택 ({machineSummaries.length}종)</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsMachinePickerOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                aria-label="닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3 sm:p-4 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {machineSummaries.map((ms) => {
                const spec = PRIZE_SPECS[ms.index];
                const isActive = ms.index === machineIndex;
                const rewardSol = getBoxRewardAmount(ms.index);
                return (
                  <button
                    key={ms.index}
                    type="button"
                    onClick={() => {
                      onSelectMachine?.(ms.index);
                      setIsMachinePickerOpen(false);
                    }}
                    className={`p-2.5 rounded-2xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                      isActive
                        ? 'bg-emerald-500/20 border-emerald-400 ring-1 ring-emerald-400/50 shadow-md'
                        : ms.hasStock
                        ? 'bg-slate-950/85 hover:bg-slate-800/90 border-slate-800 hover:border-slate-600'
                        : 'bg-slate-950/50 hover:bg-slate-900/70 border-slate-800/70 opacity-65'
                    }`}
                  >
                    {spec?.imgSrc && (
                      <img
                        src={spec.imgSrc}
                        alt={ms.shortName}
                        className="w-11 h-11 rounded-xl object-cover bg-slate-900 border border-slate-700/80 shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1">
                        <span className={`text-xs font-black truncate ${isActive ? 'text-emerald-200' : 'text-white'}`}>
                          {ms.shortName}
                        </span>
                      </div>
                      <div className="text-[10px] text-amber-300 font-mono font-bold">
                        🪙 {rewardSol} SOL
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {ms.suspended ? (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[9px] font-bold">
                            🛠️ 점검중
                          </span>
                        ) : ms.lockedBy ? (
                          <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[9px] font-bold">
                            🔥 {ms.lockedBy}
                          </span>
                        ) : ms.hasStock ? (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[9px] font-bold">
                            ● 플레이 가능
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-rose-400 text-[9px] font-bold">
                            품절
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {isSpectatePickerOpen && (() => {
        const liveList = machineSummaries.filter((m) => Boolean(m.lockedBy) && !m.suspended);
        return (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setIsSpectatePickerOpen(false)}
          >
            <div
              className="bg-slate-900 border border-rose-500/45 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3.5 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-rose-400 animate-pulse" />
                  <h3 className="text-sm sm:text-base font-black text-white">
                    실시간 관전 선택 ({liveList.length}개 진행 중)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSpectatePickerOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                  aria-label="닫기"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-3 sm:p-4 overflow-y-auto space-y-2">
                {liveList.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-400">
                    현재 진행 중인 뽑기가 없습니다.
                  </p>
                ) : (
                  liveList.map((ms) => {
                    const spec = PRIZE_SPECS[ms.index];
                    return (
                      <button
                        key={ms.index}
                        type="button"
                        onClick={() => {
                          onSelectMachine?.(ms.index);
                          setIsSpectatePickerOpen(false);
                        }}
                        className="w-full p-3 rounded-2xl bg-slate-950/90 hover:bg-slate-800/90 border border-rose-500/35 hover:border-rose-400 text-left flex items-center gap-3 cursor-pointer transition-all"
                      >
                        {spec?.imgSrc && (
                          <img
                            src={spec.imgSrc}
                            alt={ms.shortName}
                            className="w-11 h-11 rounded-xl object-cover bg-slate-900 border border-slate-700 shrink-0"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs sm:text-sm font-black text-white truncate">
                            {ms.shortName}
                          </div>
                          <div className="text-[11px] text-rose-300 font-bold flex items-center gap-1 mt-0.5">
                            <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
                            <span>{ms.lockedBy}님 뽑기 진행 중 · 클릭하여 관전</span>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

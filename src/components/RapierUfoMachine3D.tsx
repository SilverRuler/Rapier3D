import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  ArrowRight,
  ArrowUp,
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
} from 'lucide-react';
import { GachaBoxItem } from '@/types/gacha';
import { GACHA_PHYSICS, getBoxDimensions, getBoxRewardAmount, getSandboxRedBarHalfZ, isBoxAtInitialPose, isPlushSlot } from '@/constants/gacha';
import { DEFAULT_PHYSICS_TUNING, PhysicsTuning, PRIZE_SPECS, PrizeSpec } from '@/constants/prizes';
import { isPrizeSpanningRedAndBlueBar } from '@/lib/gachaEffects';

type CameraView = 'front' | 'top' | 'right';

export type CranePhase =
  | 'idle'
  | 'ready_right'
  | 'moving_right'
  | 'ready_up'
  | 'moving_up'
  | 'descending'
  | 'closing'
  | 'lifting'
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
  }>;
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

let rapierInitPromise: Promise<typeof RAPIER> | null = null;
function getRapier(): Promise<typeof RAPIER> {
  if (!rapierInitPromise) {
    rapierInitPromise = RAPIER.init().then(() => RAPIER);
  }
  return rapierInitPromise;
}

let cachedSandroneGeoData: PlushGeoJson | null = null;
let sandroneGeoPromise: Promise<PlushGeoJson | null> | null = null;

function loadSandronePlushGeoData(): Promise<PlushGeoJson | null> {
  if (cachedSandroneGeoData) return Promise.resolve(cachedSandroneGeoData);
  if (!sandroneGeoPromise) {
    sandroneGeoPromise = fetch('/assets/sandrone_plush_geo.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PlushGeoJson | null) => {
        if (data && Array.isArray(data.positions) && Array.isArray(data.indices)) {
          cachedSandroneGeoData = data;
          return data;
        }
        return null;
      })
      .catch(() => null);
  }
  return sandroneGeoPromise;
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

// 완전한 <> 다이아몬드 갈고리 형상 (원래 크기 · 닫힘 시 하단 끝단이 중앙 x≈0에서 맞닿아 틈 없음)
const ARM_SEGMENTS = [
  { pos: [0.09, -0.17, 0] as const, rotZ: 0.49, half: [0.028, 0.195, 0.045] as const, mass: 0.11, isTip: false },
  { pos: [0.08, -0.50, 0] as const, rotZ: -0.56, half: [0.026, 0.19, 0.052] as const, mass: 0.11, isTip: false },
  { pos: [-0.10, -0.67, 0] as const, rotZ: 0.14, half: [0.085, 0.024, 0.072] as const, mass: 0.08, isTip: true },
];

const CLAW_OPEN_ANGLE = 0.72;
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

  const phaseRef = useRef<CranePhase>('idle');
  const soundEnabledRef = useRef(true);
  const cameraViewRef = useRef<CameraView>('front');
  const frontTiptoeDegRef = useRef(0);
  const tuningRef = useRef<PhysicsTuning>(tuning);
  const targetRedBarHalfZ = sandboxMode ? getSandboxRedBarHalfZ(machineIndex) : GACHA_PHYSICS.BAR_HALF_Z;
  const redBarHalfZRef = useRef<number>(targetRedBarHalfZ);
  const itemsRef = useRef<GachaBoxItem[]>(items);
  const onTurnFinishRef = useRef(onTurnFinish);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const drrAudioRef = useRef<HTMLAudioElement | null>(null);
  const bcAudioRef = useRef<HTMLAudioElement | null>(null);
  const startAudioRef = useRef<HTMLAudioElement | null>(null);
  const nearAudio1Ref = useRef<HTMLAudioElement | null>(null);
  const nearAudio2Ref = useRef<HTMLAudioElement | null>(null);
  const finishAudioRef = useRef<HTMLAudioElement | null>(null);
  const drrTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bcTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  itemsRef.current = items;
  tuningRef.current = tuning;
  redBarHalfZRef.current = targetRedBarHalfZ;

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

    return () => {
      if (drrTimeoutRef.current) clearTimeout(drrTimeoutRef.current);
      if (bcTimeoutRef.current) clearTimeout(bcTimeoutRef.current);
      if (startTimeoutRef.current) clearTimeout(startTimeoutRef.current);
      if (nearTimeoutRef.current) clearTimeout(nearTimeoutRef.current);
      if (finishTimeoutRef.current) clearTimeout(finishTimeoutRef.current);
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
    if (finishTimeoutRef.current) clearTimeout(finishTimeoutRef.current);
    finishTimeoutRef.current = setTimeout(() => setShowFinishWin(false), 2000);
    if (soundEnabledRef.current && finishAudioRef.current) {
      try {
        finishAudioRef.current.currentTime = 0;
        finishAudioRef.current.play().catch(() => {});
      } catch {}
    }
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

  useEffect(() => {
    if (isMyTurn && turnKey && engineReady) {
      setCameraView('front');
      cameraViewRef.current = 'front';
      setDroppedThisTurn(0);
      const curItems = itemsRef.current;
      const isInitialPoseOnly =
        curItems.length > 0 && curItems.every((it) => isBoxAtInitialPose(it));
      simControlRef.current?.prepareTurnStart(curItems);
      setCranePhase('ready_right');
      triggerStartPopup(isInitialPoseOnly);
    } else if (!isMyTurn && phaseRef.current !== 'idle') {
      setCranePhase('idle');
    }
  }, [isMyTurn, turnKey, engineReady, setCranePhase, triggerStartPopup]);

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

        const initRedHalfZ = redBarHalfZRef.current;
        const allBarSpecs = [
          { y: GACHA_PHYSICS.BAR_Y, z: -initRedHalfZ, isOuter: false, sign: -1 as const },
          { y: GACHA_PHYSICS.BAR_Y, z: initRedHalfZ, isOuter: false, sign: 1 as const },
          { y: GACHA_PHYSICS.OUTER_BAR_Y, z: -GACHA_PHYSICS.OUTER_BAR_HALF_Z, isOuter: true, sign: -1 as const },
          { y: GACHA_PHYSICS.OUTER_BAR_Y, z: GACHA_PHYSICS.OUTER_BAR_HALF_Z, isOuter: true, sign: 1 as const },
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

        const ufoHeadGroup = new THREE.Group();
        scene.add(ufoHeadGroup);

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

        const debugLinesGeo = new THREE.BufferGeometry();
        const debugLinesMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 });
        const debugLinesMesh = new THREE.LineSegments(debugLinesGeo, debugLinesMat);
        debugLinesMesh.visible = tuningRef.current.showColliders;
        scene.add(debugLinesMesh);

        const armMetalMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 0.88, roughness: 0.18 });
        const armTipMat = new THREE.MeshStandardMaterial({ color: '#f97316', emissive: '#ea580c', emissiveIntensity: 0.3, roughness: 0.65 });
        const hingePinMat = new THREE.MeshStandardMaterial({ color: '#fbbf24', metalness: 0.9, roughness: 0.2 });

        const buildArmVisual = (side: -1 | 1) => {
          const group = new THREE.Group();
          const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.12, 12), hingePinMat);
          pin.rotation.x = Math.PI / 2;
          group.add(pin);

          for (const seg of ARM_SEGMENTS) {
            const geo = new THREE.BoxGeometry(seg.half[0] * 2, seg.half[1] * 2, seg.half[2] * 2);
            const mesh = new THREE.Mesh(geo, seg.isTip ? armTipMat : armMetalMat);
            mesh.position.set(side * seg.pos[0], seg.pos[1], seg.pos[2]);
            mesh.rotation.z = side * seg.rotZ;
            mesh.castShadow = true;
            group.add(mesh);
          }
          scene.add(group);
          return group;
        };

        const leftArmVisual = buildArmVisual(-1);
        const rightArmVisual = buildArmVisual(1);

        const cableMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.02, 0.02, 1, 8),
          new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.85 })
        );
        scene.add(cableMesh);

        const aimRing = new THREE.Mesh(
          new THREE.RingGeometry(0.14, 0.21, 24),
          new THREE.MeshBasicMaterial({ color: '#34d399', transparent: true, opacity: 0.8, side: THREE.DoubleSide })
        );
        aimRing.rotation.x = -Math.PI / 2;
        scene.add(aimRing);

        const aimBeam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.01, 0.01, 1.7, 8),
          new THREE.MeshBasicMaterial({ color: '#34d399', transparent: true, opacity: 0.28 })
        );
        scene.add(aimBeam);

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

        world.createCollider(
          Rapier.ColliderDesc.cuboid(2.2, 0.1, 2.3)
            .setTranslation(0, -1.55, 0)
            .setFriction(0.55)
            .setRestitution(0.05)
            .setCollisionGroups(makeGroup(G_ENV, G_PRIZE)),
          envBody
        );

        // Articulated Crane Chain (Prismatic Y -> Gimbal X/Z -> 2× Revolute Z Claw Arms)
        const homeX = GACHA_PHYSICS.CLAW_HOME_X;
        const homeY = GACHA_PHYSICS.CLAW_HOME_Y;
        const homeZ = GACHA_PHYSICS.CLAW_HOME_Z;

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
          Rapier.ColliderDesc.cylinder(0.125, 0.36)
            .setMass(1.25)
            .setFriction(0.55)
            .setRestitution(0)
            .setCollisionGroups(makeGroup(G_HEAD, G_PRIZE)),
          headBody
        );

        const winchData = Rapier.JointData.prismatic({ x: 0, y: 0.18, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
        winchData.limitsEnabled = true;
        winchData.limits = [-2.55, 0.18];
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
        const createClawArm = (side: -1 | 1) => {
          const armBody = world.createRigidBody(
            Rapier.RigidBodyDesc.dynamic()
              .setTranslation(homeX + side * 0.22, homeY - 0.02, homeZ)
              .setLinearDamping(0.25)
              .setAngularDamping(0.45)
              .setCcdEnabled(true)
              .setCanSleep(false)
          );
          for (const seg of ARM_SEGMENTS) {
            const a = side * seg.rotZ;
            const col = world.createCollider(
              Rapier.ColliderDesc.cuboid(seg.half[0], seg.half[1], seg.half[2])
                .setTranslation(side * seg.pos[0], seg.pos[1], seg.pos[2])
                .setRotation({ x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) })
                .setMass(seg.mass)
                .setFriction(tuningRef.current.clawTipFriction)
                .setRestitution(0)
                .setCollisionGroups(makeGroup(G_ARM, G_PRIZE)),
              armBody
            );
            armColliders.push(col);
          }

          const jData = Rapier.JointData.revolute({ x: side * 0.22, y: -0.02, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
          jData.limitsEnabled = true;
          jData.limits = side > 0 ? [-0.10, 1.18] : [-1.18, 0.10];
          const joint = world.createImpulseJoint(jData, headBody, armBody, true) as RAPIER.RevoluteImpulseJoint;
          joint.configureMotorModel(Rapier.MotorModel.ForceBased);
          joint.setMotorMaxForce(tuningRef.current.closeTorque);
          joint.configureMotorPosition(side * CLAW_OPEN_ANGLE, 150, 22);
          return { body: armBody, joint };
        };

        const leftArm = createClawArm(-1);
        const rightArm = createClawArm(1);

        // Dynamic Prize Entities Map (synced to MongoDB GachaBoxItem[])
        interface PrizeEntity {
          data: GachaBoxItem;
          mesh: THREE.Mesh;
          body: RAPIER.RigidBody;
        }
        const prizeEntities = new Map<string, PrizeEntity>();

        const syncFromItems = (nextItems: GachaBoxItem[], forceRecreate = false) => {
          const nextIds = new Set(nextItems.map((it) => it.id));

          for (const [id, ent] of prizeEntities.entries()) {
            if (forceRecreate || !nextIds.has(id)) {
              world.removeRigidBody(ent.body);
              scene.remove(ent.mesh);
              ent.mesh.geometry.dispose();
              if (Array.isArray(ent.mesh.material)) {
                ent.mesh.material.forEach((m) => m.dispose());
              } else {
                ent.mesh.material.dispose();
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
                  .setLinearDamping(0.20)
                  .setAngularDamping(0.30)
                  .setCcdEnabled(true)
              );

              const prizeGroup = makeGroup(G_PRIZE, G_ENV | G_BAR | G_PRIZE | G_HEAD | G_ARM);
              let mesh: THREE.Mesh;

              if (plushItem) {
                const plushMat = createPlushMaterial(spec.imgSrc);
                const initGeo = cachedSandroneGeoData
                  ? buildBufferGeometryFromPlushData(cachedSandroneGeoData)
                  : new THREE.BoxGeometry(dims.w * 0.7, dims.h, dims.d * 0.85);
                mesh = new THREE.Mesh(initGeo, plushMat);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                scene.add(mesh);

                if (!cachedSandroneGeoData) {
                  const targetId = it.id;
                  loadSandronePlushGeoData().then((geoData) => {
                    if (!geoData || disposed) return;
                    const liveEnt = prizeEntities.get(targetId);
                    if (!liveEnt) return;
                    const nextGeo = buildBufferGeometryFromPlushData(geoData);
                    liveEnt.mesh.geometry.dispose();
                    liveEnt.mesh.geometry = nextGeo;
                  });
                }

                const parts = [
                  { half: [0.28, 0.21, 0.50], pos: [0.05, 0, 0.02], w: 0.45 },
                  { half: [0.19, 0.18, 0.20], pos: [0.04, 0, -0.44], w: 0.20 },
                  { half: [0.15, 0.16, 0.30], pos: [-0.30, 0, 0.24], w: 0.18 },
                  { half: [0.14, 0.17, 0.28], pos: [0.30, 0, 0.22], w: 0.17 },
                ];
                for (const p of parts) {
                  world.createCollider(
                    Rapier.ColliderDesc.cuboid(p.half[0], p.half[1], p.half[2])
                      .setTranslation(p.pos[0], p.pos[1], p.pos[2])
                      .setMass(totalMass * (liveTuning.useComOffset ? 0.85 : 1.0) * p.w)
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
                world.createCollider(
                  Rapier.ColliderDesc.ball(0.05)
                    .setTranslation(spec.comOffset[0] * 3.0, spec.comOffset[1] * 3.0, spec.comOffset[2] * 3.0)
                    .setMass(totalMass * 0.18)
                    .setCollisionGroups(0),
                  body
                );
              }

              ent = { data: { ...it }, mesh, body };
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
          stepAccum: 0,
        };

        const setArmTorques = (maxTorque: number) => {
          leftArm.joint.setMotorMaxForce(maxTorque);
          rightArm.joint.setMotorMaxForce(maxTorque);
        };

        const setArmTargets = (openRad: number) => {
          leftArm.joint.configureMotorPosition(-openRad, 150, 22);
          rightArm.joint.configureMotorPosition(openRad, 150, 22);
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

          leftArm.body.setTranslation({ x: homeX - 0.22, y: homeY - 0.02, z: homeZ }, true);
          leftArm.body.setRotation(idQ, true);
          leftArm.body.setLinvel(zero, true);
          leftArm.body.setAngvel(zero, true);

          rightArm.body.setTranslation({ x: homeX + 0.22, y: homeY - 0.02, z: homeZ }, true);
          rightArm.body.setRotation(idQ, true);
          rightArm.body.setLinvel(zero, true);
          rightArm.body.setAngvel(zero, true);

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
          sim.phaseTimer = 0;
          sim.descendStallTimer = 0;
          sim.lastHeadYForStall = headBody.translation().y;
          for (const ent of prizeEntities.values()) {
            ent.body.wakeUp();
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
          syncFromItems: (nextItems) => syncFromItems(nextItems, false),
          resetClawToHome,
          prepareTurnStart,
          startDescending,
          applyLiveTuning,
          rebuildPrizesForTuning,
          updateRedBarSpacing,
        };

        syncFromItems(itemsRef.current, false);
        resetClawToHome();
        setEngineReady(true);

        let lastTime = performance.now();

        const animate = (now: number) => {
          if (disposed) return;
          animId = requestAnimationFrame(animate);
          const rawDt = Math.min((now - lastTime) / 1000, 0.04);
          lastTime = now;
          const dt = rawDt * Math.max(0.25, Math.min(1.5, tuningRef.current.timeScale));

          const curPhase = phaseRef.current;

          if (curPhase === 'moving_right') {
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
            sim.targetHeadY = Math.max(GACHA_PHYSICS.CLAW_DROP_Y, sim.targetHeadY - 0.64 * dt);
            winchJoint.setMotorMaxForce(tuningRef.current.downPressForce + 18);

            const actualHeadY = headBody.translation().y;
            if (actualHeadY - sim.targetHeadY > 0.14 && Math.abs(actualHeadY - sim.lastHeadYForStall) < 0.015) {
              sim.descendStallTimer += dt;
            } else {
              sim.descendStallTimer = 0;
              sim.lastHeadYForStall = actualHeadY;
            }

            if (sim.targetHeadY <= GACHA_PHYSICS.CLAW_DROP_Y || sim.descendStallTimer >= 0.45) {
              sim.phaseTimer = 0;
              setArmTorques(tuningRef.current.closeTorque);
              setCranePhase('closing');
              playTone(330, 0.1, 'square', 0.05);
            }
          } else if (curPhase === 'closing') {
            sim.phaseTimer += dt;
            const prog = Math.min(1, sim.phaseTimer / 0.52);
            const targetAng = CLAW_OPEN_ANGLE * (1 - prog) + CLAW_CLOSE_TARGET * prog;
            setArmTargets(targetAng);

            if (sim.phaseTimer >= 0.62) {
              sim.phaseTimer = 0;
              sim.effectTriggeredThisTurn = false;
              sim.liftStartY.clear();
              for (const ent of prizeEntities.values()) {
                sim.liftStartY.set(ent.data.id, ent.body.translation().y);
              }
              winchJoint.setMotorMaxForce(220);
              setArmTorques(tuningRef.current.liftTorque);
              setArmTargets(CLAW_CLOSE_TARGET);
              setCranePhase('lifting');
              playTone(587.33, 0.12);
            }
          } else if (curPhase === 'lifting') {
            sim.phaseTimer += dt;
            const prevTargetY = sim.targetHeadY;
            sim.targetHeadY = Math.min(GACHA_PHYSICS.CLAW_LIFT_Y, sim.targetHeadY + 0.58 * dt);
            winchJoint.setMotorMaxForce(220);

            if (!sim.effectTriggeredThisTurn && sim.phaseTimer >= 0.12) {
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

            const reachedTop = prevTargetY >= GACHA_PHYSICS.CLAW_LIFT_Y - 0.005;
            if ((reachedTop && sim.phaseTimer >= 0.35) || sim.phaseTimer >= 3.6) {
              sim.phaseTimer = 0;
              setArmTorques(Math.max(4, tuningRef.current.liftTorque * 0.75));
              setCranePhase('releasing');
              playTone(392, 0.1);
            }
          } else if (curPhase === 'releasing') {
            // 크레인 제자리 유지 상태에서 집게를 천천히 벌려 상품이 튕기지 않고 수직 드랍되도록 함
            sim.phaseTimer += dt;
            const openProg = Math.min(1, sim.phaseTimer / 0.78);
            const eased = openProg * openProg * (3 - 2 * openProg);
            const openAngle = CLAW_CLOSE_TARGET * (1 - eased) + CLAW_OPEN_ANGLE * eased;
            setArmTargets(openAngle);

            if (sim.phaseTimer >= 1.25) {
              sim.phaseTimer = 0;
              sim.settleQuietTime = 0;
              setArmTorques(tuningRef.current.closeTorque);
              setArmTargets(CLAW_OPEN_ANGLE);
              setCranePhase('settling');
            }
          } else if (curPhase === 'settling') {
            sim.phaseTimer += dt;
            sim.gantryX += (homeX - sim.gantryX) * Math.min(1, 2.2 * dt);
            sim.gantryZ += (homeZ - sim.gantryZ) * Math.min(1, 2.2 * dt);
            sim.targetHeadY += (homeY - sim.targetHeadY) * Math.min(1, 2.2 * dt);

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
            curPhase === 'ready_right' ||
            curPhase === 'moving_right' ||
            curPhase === 'ready_up' ||
            curPhase === 'moving_up';
          aimRing.visible = showAim;
          aimBeam.visible = showAim;
          if (showAim) {
            aimRing.position.set(hp.x, GACHA_PHYSICS.BAR_Y + 0.12, hp.z);
            const beamH = Math.max(0.2, hp.y - (GACHA_PHYSICS.BAR_Y + 0.12));
            aimBeam.scale.y = beamH / 1.7;
            aimBeam.position.set(hp.x, GACHA_PHYSICS.BAR_Y + 0.12 + beamH / 2, hp.z);
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
      })
      .catch((err) => {
        console.error('Rapier3D init failed:', err);
        if (!disposed) setEngineError(String(err?.message || err));
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(animId);
      if (handleResize) window.removeEventListener('resize', handleResize);
      if (renderer) renderer.dispose();
      if (worldRef) {
        try {
          worldRef.free();
        } catch {}
      }
    };
  }, [playTone, setCranePhase, triggerExtremeDrr, triggerBalanceCatch, triggerNearNear, triggerFinishWin]);

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
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
      if ((e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') && phaseRef.current === 'moving_right') {
        e.preventDefault();
        setCranePhase('ready_up');
        playTone(520, 0.08);
      } else if ((e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') && phaseRef.current === 'moving_up') {
        e.preventDefault();
        simControlRef.current?.startDescending();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [playTone, setCranePhase]);

  const phaseBannerText = (() => {
    if (engineError) return `❌ Rapier3D 초기화 오류: ${engineError}`;
    if (!engineReady) return '⚙️ Rapier3D Rust WASM 물리 엔진 로딩 중...';
    if (lockedByOther) return `🔒 현재 ${lockedByOther}님이 크레인을 조작 중입니다...`;
    switch (phase) {
      case 'idle':
        return '하단 [뽑기 시작]을 눌러 Rapier3D UFO 브릿지 크레인을 조작하세요!';
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
        return '🤏 실제 Revolute 모터 집게로 상자를 잡는 중...';
      case 'lifting':
        return '⬆ 물리 마찰과 토크로 상자를 들어올리고 있습니다!';
      case 'releasing':
      case 'settling':
        return droppedThisTurn > 0
          ? '🎉 Bar 사이로 상자가 떨어졌습니다!! 결과 저장 중...'
          : '⚖️ 상자가 Bar 위에서 흔들리며 자리를 잡는 중...';
    }
  })();

  return (
    <div className="w-full rounded-3xl overflow-hidden border border-emerald-500/35 bg-slate-950 shadow-2xl shadow-emerald-950/30">
      <div className="px-4 py-2.5 bg-slate-900/95 border-b border-slate-800 space-y-2">
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

          <button
            type="button"
            onClick={() => setSoundEnabled((v) => !v)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer shrink-0"
            title={soundEnabled ? '효과음 끄기' : '효과음 켜기'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
          </button>
        </div>

        {machineSummaries.length > 0 && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
              {machineSummaries.map((ms) => {
                const isActive = ms.index === machineIndex;
                return (
                  <button
                    key={ms.index}
                    type="button"
                    disabled={isCraneLockedToFront}
                    onClick={() => onSelectMachine?.(ms.index)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold shrink-0 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      isActive
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 shadow-sm'
                        : 'bg-slate-950/80 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        ms.lockedBy ? 'bg-rose-400 animate-pulse' : ms.hasStock ? 'bg-emerald-400' : 'bg-slate-600'
                      }`}
                    />
                    <span>{ms.shortName}</span>
                    {!ms.hasStock && <span className="text-[9px] text-rose-400 font-black">품절</span>}
                  </button>
                );
              })}
            </div>

            {isAdmin && (
              <div className="flex items-center gap-1.5 shrink-0 ml-auto">
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
        )}
      </div>

      <div className="relative w-full h-[300px] sm:h-[450px] bg-[#040c14] select-none">
        <div ref={mountRef} className="w-full h-full" />

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
          <div className="absolute inset-0 z-10 bg-slate-950/45 backdrop-blur-[1.5px] flex items-center justify-center p-4 pointer-events-auto">
            <div className="px-5 py-3.5 rounded-2xl bg-slate-900/95 border border-rose-500/60 shadow-2xl text-center space-y-1 max-w-xs">
              <div className="inline-flex items-center gap-1.5 text-rose-300 text-xs font-black">
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-ping" />
                <span>
                  {otherSessionProgress && otherSessionProgress.total > 1
                    ? `연속 뽑기 진행 중 (${otherSessionProgress.current}/${otherSessionProgress.total}회)`
                    : '현재 뽑기 진행 중'}
                </span>
              </div>
              <p className="text-sm font-black text-white">
                🔒 <span className="text-amber-300">{lockedByOther}</span>님이 뽑기를 진행 중입니다
              </p>
              <p className="text-[11px] text-slate-400">
                완료 후 상자 위치가 반영되면 바로 참여할 수 있습니다.
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
  );
};

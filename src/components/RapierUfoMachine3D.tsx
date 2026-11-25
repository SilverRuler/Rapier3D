import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import confetti from 'canvas-confetti';
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
  Activity,
  Trophy,
} from 'lucide-react';
import {
  PRIZE_SPECS,
  STAGE_PHYSICS,
  PhysicsTuning,
  PrizeSpec,
  getRestingPosition,
} from '../constants/prizes';

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

export interface MachineSnapshot {
  hasStock: boolean;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  isInitialState: boolean;
  plays: number;
  wins: number;
}

export interface TelemetryData {
  headY: number;
  leftDeg: number;
  rightDeg: number;
  prizeY: number;
  prizeTiltDeg: number;
  prizeSpeed: number;
  isInitialState: boolean;
  rapierVersion: string;
}

interface RapierUfoMachine3DProps {
  machineIndex: number;
  snapshots: MachineSnapshot[];
  tuning: PhysicsTuning;
  onSelectMachine: (idx: number) => void;
  onUpdateSnapshot: (idx: number, next: MachineSnapshot) => void;
  onPrizeWon: (spec: PrizeSpec) => void;
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
    ctx.fillText(`RAPIER 3D · ${rewardSol} SOL`, 128, 88);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createFigureFrontTexture(spec: PrizeSpec): THREE.CanvasTexture {
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
    ctx.fillText(`${spec.label} · ${spec.rewardSol} SOL`, cw / 2, bannerY + 52);

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

function createFigureBoxMaterials(spec: PrizeSpec): THREE.MeshStandardMaterial[] {
  const frontTex = createFigureFrontTexture(spec);
  const sideTex = createSidePanelTexture(spec.title, spec.sideAccent, spec.sideBg, spec.rewardSol);
  const frontMat = new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.24, metalness: 0.12 });
  const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.30, metalness: 0.20 });
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

// Jolt와 동일한 3-세그먼트 곡면 집게 치수 (1:1 공정 비교)
const ARM_SEGMENTS = [
  { pos: [0.08, -0.19, 0] as const, rotZ: 0.35, half: [0.03, 0.20, 0.045] as const, mass: 0.11, isTip: false },
  { pos: [0.095, -0.52, 0] as const, rotZ: -0.32, half: [0.028, 0.17, 0.055] as const, mass: 0.11, isTip: false },
  { pos: [-0.015, -0.685, 0] as const, rotZ: 0.22, half: [0.068, 0.026, 0.075] as const, mass: 0.08, isTip: true },
];

const CLAW_OPEN_ANGLE = 0.64;
const CLAW_CLOSE_TARGET = -0.06;

const G_ENV = 1 << 0;
const G_BAR = 1 << 1;
const G_PRIZE = 1 << 2;
const G_HEAD = 1 << 3;
const G_ARM = 1 << 4;
const makeGroup = (membership: number, filter: number) =>
  ((membership & 0xffff) << 16) | (filter & 0xffff);

export const RapierUfoMachine3D: React.FC<RapierUfoMachine3DProps> = ({
  machineIndex,
  snapshots,
  tuning,
  onSelectMachine,
  onUpdateSnapshot,
  onPrizeWon,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [phase, setPhase] = useState<CranePhase>('idle');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [cameraView, setCameraView] = useState<CameraView>('front');
  const [frontTiptoeDeg, setFrontTiptoeDeg] = useState(0);
  const [showExtremeDrr, setShowExtremeDrr] = useState(false);
  const [showBalanceCatch, setShowBalanceCatch] = useState(false);
  const [droppedThisTurn, setDroppedThisTurn] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    headY: STAGE_PHYSICS.CLAW_HOME_Y,
    leftDeg: Math.round((CLAW_OPEN_ANGLE * 180) / Math.PI),
    rightDeg: Math.round((CLAW_OPEN_ANGLE * 180) / Math.PI),
    prizeY: 1.08,
    prizeTiltDeg: 0,
    prizeSpeed: 0,
    isInitialState: true,
    rapierVersion: '0.21',
  });

  const phaseRef = useRef<CranePhase>('idle');
  const soundEnabledRef = useRef(true);
  const cameraViewRef = useRef<CameraView>('front');
  const frontTiptoeDegRef = useRef(0);
  const tuningRef = useRef<PhysicsTuning>(tuning);
  const machineIndexRef = useRef(machineIndex);
  const snapshotsRef = useRef(snapshots);
  const onUpdateSnapshotRef = useRef(onUpdateSnapshot);
  const onPrizeWonRef = useRef(onPrizeWon);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const drrAudioRef = useRef<HTMLAudioElement | null>(null);
  const bcAudioRef = useRef<HTMLAudioElement | null>(null);
  const drrTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bcTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    tuningRef.current = tuning;
  }, [tuning]);
  useEffect(() => {
    machineIndexRef.current = machineIndex;
  }, [machineIndex]);
  useEffect(() => {
    snapshotsRef.current = snapshots;
  }, [snapshots]);
  useEffect(() => {
    onUpdateSnapshotRef.current = onUpdateSnapshot;
  }, [onUpdateSnapshot]);
  useEffect(() => {
    onPrizeWonRef.current = onPrizeWon;
  }, [onPrizeWon]);

  useEffect(() => {
    const drr = new Audio('/assets/drr.mp3');
    drr.preload = 'auto';
    drr.volume = 0.85;
    drrAudioRef.current = drr;

    const bc = new Audio('/assets/bc.mp3');
    bc.preload = 'auto';
    bc.volume = 0.9;
    bcAudioRef.current = bc;

    return () => {
      if (drrTimeoutRef.current) clearTimeout(drrTimeoutRef.current);
      if (bcTimeoutRef.current) clearTimeout(bcTimeoutRef.current);
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

  const fireWinConfetti = useCallback(() => {
    confetti({
      particleCount: 90,
      spread: 80,
      origin: { y: 0.6 },
      colors: ['#10b981', '#34d399', '#fbbf24', '#22d3ee', '#a855f7', '#fb7185'],
    });
  }, []);

  const simBridgeRef = useRef<{
    loadMachine: (idx: number, snap: MachineSnapshot) => void;
    resetClawHome: () => void;
    applyLiveTuning: (t: PhysicsTuning) => void;
    rebuildCurrentPrizeForTuning: () => void;
    startTurn: () => void;
    startDescending: () => void;
  } | null>(null);

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
        const rapierVer = Rapier.version();

        // ============================================================
        // 1. THREE.JS 씬 · 카메라 · 조명 · 아케이드 캐비닛
        // ============================================================
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
              pos: new THREE.Vector3(0, 5.45 * Math.max(1, scale * 0.88), 0.52),
              look: new THREE.Vector3(0, 0.72, 0),
            };
          }
          if (view === 'right') {
            return {
              fov,
              pos: new THREE.Vector3(4.55 * Math.max(1, scale * 0.85), 2.15 * (1 + (scale - 1) * 0.3), 0),
              look: new THREE.Vector3(0, 0.82, 0),
            };
          }
          const lookY = 0.76;
          const baseY = 3.25 * (1 + (scale - 1) * 0.62);
          const baseZ = 4.65 * scale;
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

        // Cabinet Visuals
        const cabinetGroup = new THREE.Group();
        scene.add(cabinetGroup);

        const chuteFloor = new THREE.Mesh(
          new THREE.BoxGeometry(4.0, 0.15, 3.2),
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

        const gridHelper = new THREE.GridHelper(3.8, 10, '#10b981', '#065f46');
        gridHelper.position.set(0, -1.46, 0);
        cabinetGroup.add(gridHelper);

        const pillarGeo = new THREE.CylinderGeometry(0.07, 0.07, 4.9, 16);
        const pillarMat = new THREE.MeshStandardMaterial({
          color: '#1e293b',
          emissive: '#10b981',
          emissiveIntensity: 0.35,
          metalness: 0.7,
          roughness: 0.2,
        });
        const pillarX = STAGE_PHYSICS.CABINET_HALF_X + 0.1;
        [
          [-pillarX, 0.9, -1.48],
          [pillarX, 0.9, -1.48],
          [-pillarX, 0.9, 1.48],
          [pillarX, 0.9, 1.48],
        ].forEach(([px, py, pz]) => {
          const p = new THREE.Mesh(pillarGeo, pillarMat);
          p.position.set(px, py, pz);
          cabinetGroup.add(p);
        });

        const frameBarMat = new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.8, roughness: 0.25 });
        const railSideGeo = new THREE.BoxGeometry(0.12, 0.12, 3.1);
        [-pillarX, pillarX].forEach((rx) => {
          const r = new THREE.Mesh(railSideGeo, frameBarMat);
          r.position.set(rx, 3.25, 0);
          cabinetGroup.add(r);
        });

        const gantryBeam = new THREE.Mesh(
          new THREE.BoxGeometry(STAGE_PHYSICS.BAR_LENGTH + 0.2, 0.1, 0.14),
          new THREE.MeshStandardMaterial({ color: '#64748b', metalness: 0.85, roughness: 0.2 })
        );
        gantryBeam.position.set(0, 3.25, STAGE_PHYSICS.CLAW_HOME_Z);
        scene.add(gantryBeam);

        const trolleyMesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.16, 0.24),
          new THREE.MeshStandardMaterial({ color: '#10b981', metalness: 0.75, roughness: 0.2 })
        );
        trolleyMesh.position.set(STAGE_PHYSICS.CLAW_HOME_X, 3.25, STAGE_PHYSICS.CLAW_HOME_Z);
        scene.add(trolleyMesh);

        const acrylicMat = new THREE.MeshPhysicalMaterial({
          color: '#94a3b8',
          transparent: true,
          opacity: 0.11,
          roughness: 0.1,
          metalness: 0.1,
          side: THREE.DoubleSide,
        });
        const backGlass = new THREE.Mesh(new THREE.PlaneGeometry(STAGE_PHYSICS.BAR_LENGTH + 0.16, 3.4), acrylicMat);
        backGlass.position.set(0, 0.8, -1.46);
        cabinetGroup.add(backGlass);

        [-(STAGE_PHYSICS.CABINET_HALF_X + 0.06), STAGE_PHYSICS.CABINET_HALF_X + 0.06].forEach((sx) => {
          const sideGlass = new THREE.Mesh(new THREE.PlaneGeometry(2.94, 3.4), acrylicMat);
          sideGlass.rotation.y = Math.PI / 2;
          sideGlass.position.set(sx, 0.8, 0);
          cabinetGroup.add(sideGlass);
        });

        const rampVisualGeo = new THREE.BoxGeometry(STAGE_PHYSICS.BAR_LENGTH, 0.05, 0.84);
        const rampVisualMat = new THREE.MeshPhysicalMaterial({
          color: '#10b981',
          transparent: true,
          opacity: 0.16,
          roughness: 0.2,
        });
        const frontRampMesh = new THREE.Mesh(rampVisualGeo, rampVisualMat);
        frontRampMesh.position.set(0, 1.24, 1.38);
        frontRampMesh.rotation.x = -0.72;
        cabinetGroup.add(frontRampMesh);

        const backRampMesh = new THREE.Mesh(rampVisualGeo, rampVisualMat);
        backRampMesh.position.set(0, 1.24, -1.38);
        backRampMesh.rotation.x = 0.72;
        cabinetGroup.add(backRampMesh);

        // 4 Parallel Bars + Physical Silicone Rings
        const barGeo = new THREE.CylinderGeometry(
          STAGE_PHYSICS.BAR_RADIUS,
          STAGE_PHYSICS.BAR_RADIUS,
          STAGE_PHYSICS.BAR_LENGTH,
          24
        );
        barGeo.rotateZ(Math.PI / 2);
        const barMatVisual = new THREE.MeshStandardMaterial({
          color: '#e2e8f0',
          metalness: 0.92,
          roughness: 0.14,
        });
        const ringGeo = new THREE.TorusGeometry(STAGE_PHYSICS.BAR_RADIUS + 0.009, 0.016, 10, 24);
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

        const allBarSpecs = [
          { y: STAGE_PHYSICS.BAR_Y, z: -STAGE_PHYSICS.BAR_HALF_Z, isOuter: false },
          { y: STAGE_PHYSICS.BAR_Y, z: STAGE_PHYSICS.BAR_HALF_Z, isOuter: false },
          { y: STAGE_PHYSICS.OUTER_BAR_Y, z: -STAGE_PHYSICS.OUTER_BAR_HALF_Z, isOuter: true },
          { y: STAGE_PHYSICS.OUTER_BAR_Y, z: STAGE_PHYSICS.OUTER_BAR_HALF_Z, isOuter: true },
        ];
        const ringXPositions = [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5];

        allBarSpecs.forEach(({ y: by, z: bz, isOuter }) => {
          const barMesh = new THREE.Mesh(barGeo, barMatVisual);
          barMesh.position.set(0, by, bz);
          barMesh.castShadow = true;
          barMesh.receiveShadow = true;
          cabinetGroup.add(barMesh);

          for (const rx of ringXPositions) {
            const ring = new THREE.Mesh(ringGeo, isOuter ? blueRingMat : redRingMat);
            ring.position.set(rx, by, bz);
            cabinetGroup.add(ring);
          }
        });

        // UFO Head Visual
        const ufoHeadGroup = new THREE.Group();
        scene.add(ufoHeadGroup);

        const ufoTop = new THREE.Mesh(
          new THREE.CylinderGeometry(0.19, 0.30, 0.16, 24),
          new THREE.MeshStandardMaterial({
            color: '#10b981',
            emissive: '#059669',
            emissiveIntensity: 0.5,
            metalness: 0.65,
            roughness: 0.22,
          })
        );
        ufoTop.position.set(0, 0.06, 0);
        ufoTop.castShadow = true;
        ufoHeadGroup.add(ufoTop);

        const ufoRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.28, 0.03, 12, 24),
          new THREE.MeshStandardMaterial({
            color: '#fbbf24',
            emissive: '#f59e0b',
            emissiveIntensity: 0.65,
          })
        );
        ufoRing.rotation.x = Math.PI / 2;
        ufoRing.position.set(0, -0.01, 0);
        ufoHeadGroup.add(ufoRing);

        // Rapier3D 네이티브 디버그 라인 렌더러 (world.debugRender() 기반!)
        const debugLinesGeo = new THREE.BufferGeometry();
        const debugLinesMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 });
        const debugLinesMesh = new THREE.LineSegments(debugLinesGeo, debugLinesMat);
        debugLinesMesh.visible = tuningRef.current.showColliders;
        scene.add(debugLinesMesh);

        const armMetalMat = new THREE.MeshStandardMaterial({
          color: '#e2e8f0',
          metalness: 0.88,
          roughness: 0.18,
        });
        const armTipMat = new THREE.MeshStandardMaterial({
          color: '#f97316',
          emissive: '#ea580c',
          emissiveIntensity: 0.3,
          roughness: 0.65,
        });
        const hingePinMat = new THREE.MeshStandardMaterial({
          color: '#fbbf24',
          metalness: 0.9,
          roughness: 0.2,
        });

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

        // ============================================================
        // 2. RAPIER3D RUST/WASM WORLD SETUP (120Hz 고정 타임스텝)
        // ============================================================
        const world = new Rapier.World({ x: 0, y: -9.81, z: 0 });
        world.timestep = 1 / 120;
        world.numSolverIterations = 12;
        worldRef = world;

        const envBody = world.createRigidBody(Rapier.RigidBodyDesc.fixed());
        const barBody = world.createRigidBody(Rapier.RigidBodyDesc.fixed());
        const redRingColliders: RAPIER.Collider[] = [];

        const qBar = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
        allBarSpecs.forEach(({ y: by, z: bz, isOuter }) => {
          world.createCollider(
            Rapier.ColliderDesc.cylinder(STAGE_PHYSICS.BAR_LENGTH / 2, STAGE_PHYSICS.BAR_RADIUS)
              .setTranslation(0, by, bz)
              .setRotation(qBar)
              .setFriction(isOuter ? 0.34 : 0.28)
              .setRestitution(0)
              .setCollisionGroups(makeGroup(G_BAR, G_PRIZE)),
            barBody
          );

          for (const rx of ringXPositions) {
            const col = world.createCollider(
              Rapier.ColliderDesc.cylinder(0.022, STAGE_PHYSICS.BAR_RADIUS + 0.006)
                .setTranslation(rx, by, bz)
                .setRotation(qBar)
                .setFriction(isOuter ? 0.55 : tuningRef.current.barRingFriction)
                .setRestitution(0)
                .setCollisionGroups(makeGroup(G_BAR, G_PRIZE)),
              barBody
            );
            if (!isOuter) redRingColliders.push(col);
          }
        });

        // 좌우 아크릴 벽
        [-STAGE_PHYSICS.CABINET_HALF_X - 0.1, STAGE_PHYSICS.CABINET_HALF_X + 0.1].forEach((wx) => {
          world.createCollider(
            Rapier.ColliderDesc.cuboid(0.1, 2.2, 2.0)
              .setTranslation(wx, 1.0, 0)
              .setFriction(0.25)
              .setRestitution(0)
              .setCollisionGroups(makeGroup(G_ENV, G_PRIZE)),
            envBody
          );
        });

        // 앞/뒤 경사 가이드
        const qFront = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.72, 0, 0));
        world.createCollider(
          Rapier.ColliderDesc.cuboid(STAGE_PHYSICS.BAR_LENGTH / 2, 0.03, 0.42)
            .setTranslation(0, 1.24, 1.38)
            .setRotation({ x: qFront.x, y: qFront.y, z: qFront.z, w: qFront.w })
            .setFriction(0.22)
            .setRestitution(0)
            .setCollisionGroups(makeGroup(G_ENV, G_PRIZE)),
          envBody
        );

        const qBack = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.72, 0, 0));
        world.createCollider(
          Rapier.ColliderDesc.cuboid(STAGE_PHYSICS.BAR_LENGTH / 2, 0.03, 0.42)
            .setTranslation(0, 1.24, -1.38)
            .setRotation({ x: qBack.x, y: qBack.y, z: qBack.z, w: qBack.w })
            .setFriction(0.22)
            .setRestitution(0)
            .setCollisionGroups(makeGroup(G_ENV, G_PRIZE)),
          envBody
        );

        // 하단 WIN 슈트 바닥
        world.createCollider(
          Rapier.ColliderDesc.cuboid(2.2, 0.1, 2.0)
            .setTranslation(0, -1.55, 0)
            .setFriction(0.55)
            .setRestitution(0.05)
            .setCollisionGroups(makeGroup(G_ENV, G_PRIZE)),
          envBody
        );

        // ============================================================
        // 3. RAPIER3D 진짜 관절 크레인 체인:
        //    Gantry(Kin) --PrismaticY--> Carrier --RevoluteX--> Gimbal --RevoluteZ--> Head --2×RevoluteZ--> L/R Arms
        // ============================================================
        const homeX = STAGE_PHYSICS.CLAW_HOME_X;
        const homeY = STAGE_PHYSICS.CLAW_HOME_Y;
        const homeZ = STAGE_PHYSICS.CLAW_HOME_Z;

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
          Rapier.ColliderDesc.cuboid(0.05, 0.04, 0.05)
            .setMass(0.35)
            .setCollisionGroups(makeGroup(G_HEAD, 0)),
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
          Rapier.ColliderDesc.cuboid(0.04, 0.04, 0.04)
            .setMass(0.25)
            .setCollisionGroups(makeGroup(G_HEAD, 0)),
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
          Rapier.ColliderDesc.cylinder(0.08, 0.23)
            .setMass(1.25)
            .setFriction(0.55)
            .setRestitution(0)
            .setCollisionGroups(makeGroup(G_HEAD, G_PRIZE)),
          headBody
        );

        // 1) Prismatic Y Winch (Gantry -> Carrier)
        const winchData = Rapier.JointData.prismatic(
          { x: 0, y: 0.18, z: 0 },
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 }
        );
        winchData.limitsEnabled = true;
        winchData.limits = [-1.95, 0.18];
        const winchJoint = world.createImpulseJoint(
          winchData,
          gantryBody,
          carrierBody,
          true
        ) as RAPIER.PrismaticImpulseJoint;
        winchJoint.configureMotorModel(Rapier.MotorModel.ForceBased);
        winchJoint.setMotorMaxForce(210);
        winchJoint.configureMotorPosition(0, 320, 48);

        // 2) Gimbal X & Z Sway Joints (Carrier -> Gimbal -> UFO Head, Zero Yaw Spin!)
        const swayXData = Rapier.JointData.revolute(
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 }
        );
        swayXData.limitsEnabled = true;
        swayXData.limits = [-0.26, 0.26];
        const swayXJoint = world.createImpulseJoint(
          swayXData,
          carrierBody,
          gimbalBody,
          true
        ) as RAPIER.RevoluteImpulseJoint;
        swayXJoint.configureMotorModel(Rapier.MotorModel.ForceBased);
        swayXJoint.setMotorMaxForce(18);
        swayXJoint.configureMotorPosition(0, 26, 7);

        const swayZData = Rapier.JointData.revolute(
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0.18, z: 0 },
          { x: 0, y: 0, z: 1 }
        );
        swayZData.limitsEnabled = true;
        swayZData.limits = [-0.34, 0.34];
        const swayZJoint = world.createImpulseJoint(
          swayZData,
          gimbalBody,
          headBody,
          true
        ) as RAPIER.RevoluteImpulseJoint;
        swayZJoint.configureMotorModel(Rapier.MotorModel.ForceBased);
        swayZJoint.setMotorMaxForce(18);
        swayZJoint.configureMotorPosition(0, 24, 6.5);

        // 3) Left & Right Dynamic 3-Segment Claw Arms + Revolute Motor Joints
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

          const jData = Rapier.JointData.revolute(
            { x: side * 0.22, y: -0.02, z: 0 },
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 }
          );
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

        // ============================================================
        // 4. 동적 상품(박스 5종 + 산드로네 3D 쿠션 인형) 생성/교체 관리
        // ============================================================
        let activePrizeBody: RAPIER.RigidBody | null = null;
        let activePrizeMesh: THREE.Mesh | null = null;
        let activePrizeSpec: PrizeSpec = PRIZE_SPECS[machineIndexRef.current];
        let activePrizeIsInitial = true;

        const destroyCurrentPrize = () => {
          if (activePrizeBody) {
            world.removeRigidBody(activePrizeBody);
            activePrizeBody = null;
          }
          if (activePrizeMesh) {
            scene.remove(activePrizeMesh);
            activePrizeMesh.geometry.dispose();
            if (Array.isArray(activePrizeMesh.material)) {
              activePrizeMesh.material.forEach((m) => m.dispose());
            } else {
              activePrizeMesh.material.dispose();
            }
            activePrizeMesh = null;
          }
        };

        const spawnPrizeFromSnapshot = (idx: number, snap: MachineSnapshot) => {
          destroyCurrentPrize();
          const spec = PRIZE_SPECS[idx] || PRIZE_SPECS[0];
          activePrizeSpec = spec;
          activePrizeIsInitial = snap.isInitialState;
          if (!snap.hasStock) return;

          const t = tuningRef.current;
          const totalMass = Math.max(0.4, spec.mass * t.massScale);
          const body = world.createRigidBody(
            Rapier.RigidBodyDesc.dynamic()
              .setTranslation(snap.position[0], snap.position[1], snap.position[2])
              .setRotation({
                x: snap.quaternion[0],
                y: snap.quaternion[1],
                z: snap.quaternion[2],
                w: snap.quaternion[3],
              })
              .setLinearDamping(0.20)
              .setAngularDamping(0.30)
              .setCcdEnabled(true)
          );

          const prizeGroup = makeGroup(G_PRIZE, G_ENV | G_BAR | G_PRIZE | G_HEAD | G_ARM);

          if (spec.isPlush) {
            const plushMat = createPlushMaterial(spec.imgSrc);
            const initGeo = cachedSandroneGeoData
              ? buildBufferGeometryFromPlushData(cachedSandroneGeoData)
              : new THREE.BoxGeometry(spec.w * 0.7, spec.h, spec.d * 0.85);
            const mesh = new THREE.Mesh(initGeo, plushMat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            scene.add(mesh);
            activePrizeMesh = mesh;

            if (!cachedSandroneGeoData) {
              loadSandronePlushGeoData().then((geoData) => {
                if (!geoData || disposed || activePrizeMesh !== mesh) return;
                const nextGeo = buildBufferGeometryFromPlushData(geoData);
                mesh.geometry.dispose();
                mesh.geometry = nextGeo;
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
                  .setMass(totalMass * (t.useComOffset ? 0.85 : 1.0) * p.w)
                  .setFriction(spec.friction)
                  .setRestitution(0)
                  .setCollisionGroups(prizeGroup),
                body
              );
            }
          } else {
            const mats = createFigureBoxMaterials(spec);
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), mats);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            scene.add(mesh);
            activePrizeMesh = mesh;

            world.createCollider(
              Rapier.ColliderDesc.cuboid(spec.w / 2, spec.h / 2, spec.d / 2)
                .setMass(totalMass * (t.useComOffset ? 0.82 : 1.0))
                .setFriction(spec.friction)
                .setRestitution(0)
                .setCollisionGroups(prizeGroup),
              body
            );
          }

          // 편심 무게중심 내부 추(충돌 없음, 순수 질량/관성 오프셋)
          if (t.useComOffset) {
            world.createCollider(
              Rapier.ColliderDesc.ball(0.05)
                .setTranslation(spec.comOffset[0] * 3.0, spec.comOffset[1] * 3.0, spec.comOffset[2] * 3.0)
                .setMass(totalMass * 0.18)
                .setCollisionGroups(0),
              body
            );
          }

          activePrizeBody = body;

          if (activePrizeMesh) {
            activePrizeMesh.position.set(snap.position[0], snap.position[1], snap.position[2]);
            activePrizeMesh.quaternion.set(
              snap.quaternion[0],
              snap.quaternion[1],
              snap.quaternion[2],
              snap.quaternion[3]
            );
          }
        };

        const tmpThreePosA = new THREE.Vector3();
        const tmpThreePosB = new THREE.Vector3();
        const tmpThreeDir = new THREE.Vector3();
        const tmpThreeUp = new THREE.Vector3(0, 1, 0);
        const tmpThreeQuat = new THREE.Quaternion();
        const tmpHeadQuat = new THREE.Quaternion();
        const tmpArmQuat = new THREE.Quaternion();
        const tmpRelQuat = new THREE.Quaternion();

        const sim = {
          gantryX: homeX,
          gantryZ: homeZ,
          targetHeadY: homeY,
          phaseTimer: 0,
          settleQuietTime: 0,
          wonThisTurn: false,
          turnStartedInitial: true,
          turnStartPrizePos: [0, 1.1, 0] as [number, number, number],
          turnStartPrizeQuat: [0, 0, 0, 1] as [number, number, number, number],
          liftStartPrizeY: 1.1,
          effectTriggeredThisTurn: false,
          lastHeadYForStall: homeY,
          descendStallTimer: 0,
          telemetryAccum: 0,
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

        const resetClawHome = () => {
          sim.gantryX = homeX;
          sim.gantryZ = homeZ;
          sim.targetHeadY = homeY;
          sim.phaseTimer = 0;
          sim.settleQuietTime = 0;
          sim.wonThisTurn = false;
          sim.effectTriggeredThisTurn = false;
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

        const applyLiveTuning = (t: PhysicsTuning) => {
          for (const col of armColliders) {
            col.setFriction(t.clawTipFriction);
          }
          for (const col of redRingColliders) {
            col.setFriction(t.barRingFriction);
          }
          debugLinesMesh.visible = t.showColliders;
        };

        const finishTurn = () => {
          const idx = machineIndexRef.current;
          const prevSnap = snapshotsRef.current[idx];
          let nextSnap: MachineSnapshot;

          if (sim.wonThisTurn || !activePrizeBody) {
            destroyCurrentPrize();
            nextSnap = {
              hasStock: false,
              position: getRestingPosition(activePrizeSpec),
              quaternion: [0, 0, 0, 1],
              isInitialState: false,
              plays: (prevSnap?.plays || 0) + 1,
              wins: (prevSnap?.wins || 0) + (sim.wonThisTurn ? 1 : 0),
            };
          } else {
            const bp = activePrizeBody.translation();
            const bq = activePrizeBody.rotation();
            const movedHoriz =
              Math.hypot(bp.x - sim.turnStartPrizePos[0], bp.z - sim.turnStartPrizePos[2]) > 0.025 ||
              Math.abs(bp.y - sim.turnStartPrizePos[1]) > 0.035;
            const quatDot = Math.abs(
              bq.x * sim.turnStartPrizeQuat[0] +
                bq.y * sim.turnStartPrizeQuat[1] +
                bq.z * sim.turnStartPrizeQuat[2] +
                bq.w * sim.turnStartPrizeQuat[3]
            );
            const stillInitial = sim.turnStartedInitial && !movedHoriz && quatDot >= 0.999;
            activePrizeIsInitial = stillInitial;

            nextSnap = {
              hasStock: true,
              position: [bp.x, bp.y, bp.z],
              quaternion: [bq.x, bq.y, bq.z, bq.w],
              isInitialState: stillInitial,
              plays: (prevSnap?.plays || 0) + 1,
              wins: prevSnap?.wins || 0,
            };
          }

          setCranePhase('idle');
          onUpdateSnapshotRef.current(idx, nextSnap);
        };

        const startTurn = () => {
          if (phaseRef.current !== 'idle' || !activePrizeBody) return;
          setCameraView('front');
          cameraViewRef.current = 'front';
          setDroppedThisTurn(false);
          resetClawHome();

          const bp = activePrizeBody.translation();
          const bq = activePrizeBody.rotation();
          sim.turnStartedInitial = activePrizeIsInitial;
          sim.turnStartPrizePos = [bp.x, bp.y, bp.z];
          sim.turnStartPrizeQuat = [bq.x, bq.y, bq.z, bq.w];

          setCranePhase('ready_right');
          playTone(523.25, 0.12, 'sine', 0.1);
        };

        const startDescending = () => {
          sim.phaseTimer = 0;
          sim.descendStallTimer = 0;
          sim.lastHeadYForStall = headBody.translation().y;
          // 하강 중에는 집게 힌지 토크를 유연하게 낮춰, 한쪽이 상자에 걸려도 부드럽게 휘어지며 크레인이 끝까지 하강!
          setArmTorques(tuningRef.current.descendFlexTorque);
          setArmTargets(CLAW_OPEN_ANGLE);
          // Prismatic 하강 중에는 중력 + 누르기 힘 제한(약 18N 중력 + downPressForce)
          winchJoint.setMotorMaxForce(tuningRef.current.downPressForce + 18);
          setCranePhase('descending');
          playTone(640, 0.12);
        };

        simBridgeRef.current = {
          loadMachine: (idx, snap) => {
            resetClawHome();
            spawnPrizeFromSnapshot(idx, snap);
            setDroppedThisTurn(false);
            setCranePhase('idle');
          },
          resetClawHome,
          applyLiveTuning,
          rebuildCurrentPrizeForTuning: () => {
            if (!activePrizeBody || phaseRef.current !== 'idle') return;
            const bp = activePrizeBody.translation();
            const bq = activePrizeBody.rotation();
            spawnPrizeFromSnapshot(machineIndexRef.current, {
              hasStock: true,
              position: [bp.x, bp.y, bp.z],
              quaternion: [bq.x, bq.y, bq.z, bq.w],
              isInitialState: activePrizeIsInitial,
              plays: snapshotsRef.current[machineIndexRef.current]?.plays || 0,
              wins: snapshotsRef.current[machineIndexRef.current]?.wins || 0,
            });
          },
          startTurn,
          startDescending,
        };

        spawnPrizeFromSnapshot(
          machineIndexRef.current,
          snapshotsRef.current[machineIndexRef.current]
        );
        setEngineReady(true);

        // ============================================================
        // 5. MAIN 60FPS RENDER + 120Hz RAPIER3D FIXED-TIMESTEP LOOP
        // ============================================================
        let lastTime = performance.now();

        const animate = (now: number) => {
          if (disposed) return;
          animId = requestAnimationFrame(animate);
          const rawDt = Math.min((now - lastTime) / 1000, 0.04);
          lastTime = now;
          const dt = rawDt * Math.max(0.25, Math.min(1.5, tuningRef.current.timeScale));

          const curPhase = phaseRef.current;

          if (curPhase === 'moving_right') {
            sim.gantryX = Math.min(STAGE_PHYSICS.CLAW_MAX_X, sim.gantryX + STAGE_PHYSICS.MOVE_SPEED_X * dt);
            if (sim.gantryX >= STAGE_PHYSICS.CLAW_MAX_X) {
              setCranePhase('ready_up');
              playTone(620, 0.08);
            }
          } else if (curPhase === 'moving_up') {
            sim.gantryZ = Math.max(STAGE_PHYSICS.CLAW_MIN_Z, sim.gantryZ - STAGE_PHYSICS.MOVE_SPEED_Z * dt);
            if (sim.gantryZ <= STAGE_PHYSICS.CLAW_MIN_Z) {
              startDescending();
            }
          } else if (curPhase === 'descending') {
            sim.phaseTimer += dt;
            sim.targetHeadY = Math.max(
              STAGE_PHYSICS.CLAW_DROP_Y,
              sim.targetHeadY - STAGE_PHYSICS.CLAW_DESCEND_SPEED * dt
            );
            winchJoint.setMotorMaxForce(tuningRef.current.downPressForce + 18);

            const actualHeadY = headBody.translation().y;
            if (actualHeadY - sim.targetHeadY > 0.14 && Math.abs(actualHeadY - sim.lastHeadYForStall) < 0.015) {
              sim.descendStallTimer += dt;
            } else {
              sim.descendStallTimer = 0;
              sim.lastHeadYForStall = actualHeadY;
            }

            if (sim.targetHeadY <= STAGE_PHYSICS.CLAW_DROP_Y || sim.descendStallTimer >= 0.45) {
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
              sim.liftStartPrizeY = activePrizeBody ? activePrizeBody.translation().y : 1.0;
              winchJoint.setMotorMaxForce(220);
              setArmTorques(tuningRef.current.liftTorque);
              setArmTargets(CLAW_CLOSE_TARGET);
              setCranePhase('lifting');
              playTone(587.33, 0.12);
            }
          } else if (curPhase === 'lifting') {
            sim.phaseTimer += dt;
            sim.targetHeadY = Math.min(
              STAGE_PHYSICS.CLAW_LIFT_Y,
              sim.targetHeadY + STAGE_PHYSICS.CLAW_LIFT_SPEED * dt
            );
            winchJoint.setMotorMaxForce(220);

            if (activePrizeBody && !sim.effectTriggeredThisTurn && !sim.wonThisTurn && sim.phaseTimer >= 0.12) {
              const curPrizeY = activePrizeBody.translation().y;
              const curPrizeVelY = activePrizeBody.linvel().y;
              const liftedDelta = curPrizeY - sim.liftStartPrizeY;
              const isPhysicallyLifting = liftedDelta >= 0.065 && curPrizeVelY > 0.05;

              if (isPhysicallyLifting) {
                const hp = headBody.translation();
                if (sim.turnStartedInitial) {
                  const centerDx = Math.abs(hp.x - sim.turnStartPrizePos[0]);
                  const centerDz = Math.abs(hp.z - sim.turnStartPrizePos[2]);
                  const maxCenterDx = Math.max(0.20, activePrizeSpec.w * 0.30);
                  const maxCenterDz = Math.min(0.24, Math.max(0.20, activePrizeSpec.d * 0.16));
                  if (centerDx <= maxCenterDx && centerDz <= maxCenterDz) {
                    sim.effectTriggeredThisTurn = true;
                    triggerBalanceCatch();
                  }
                } else {
                  const nearCentralRedBar =
                    Math.abs(hp.z - STAGE_PHYSICS.BAR_HALF_Z) <= 0.28 ||
                    Math.abs(hp.z + STAGE_PHYSICS.BAR_HALF_Z) <= 0.28;
                  if (nearCentralRedBar) {
                    sim.effectTriggeredThisTurn = true;
                    triggerExtremeDrr();
                  }
                }
              }
            }

            if (sim.targetHeadY >= STAGE_PHYSICS.CLAW_LIFT_Y || sim.phaseTimer >= 1.35) {
              sim.phaseTimer = 0;
              setArmTorques(tuningRef.current.closeTorque);
              setArmTargets(CLAW_OPEN_ANGLE);
              setCranePhase('releasing');
              playTone(392, 0.1);
            }
          } else if (curPhase === 'releasing') {
            sim.phaseTimer += dt;
            setArmTargets(CLAW_OPEN_ANGLE);
            sim.gantryX += (homeX - sim.gantryX) * Math.min(1, 3.6 * dt);
            sim.gantryZ += (homeZ - sim.gantryZ) * Math.min(1, 3.6 * dt);
            sim.targetHeadY += (homeY - sim.targetHeadY) * Math.min(1, 4.0 * dt);

            if (sim.phaseTimer >= 0.55) {
              sim.phaseTimer = 0;
              sim.settleQuietTime = 0;
              setCranePhase('settling');
            }
          } else if (curPhase === 'settling') {
            sim.phaseTimer += dt;
            sim.gantryX += (homeX - sim.gantryX) * Math.min(1, 4.5 * dt);
            sim.gantryZ += (homeZ - sim.gantryZ) * Math.min(1, 4.5 * dt);
            sim.targetHeadY += (homeY - sim.targetHeadY) * Math.min(1, 4.5 * dt);

            let quiet = true;
            if (activePrizeBody && !sim.wonThisTurn) {
              const v = activePrizeBody.linvel();
              const av = activePrizeBody.angvel();
              if (Math.hypot(v.x, v.y, v.z) > 0.05 || Math.hypot(av.x, av.y, av.z) > 0.08) {
                quiet = false;
              }
            }
            if (quiet) sim.settleQuietTime += dt;
            else sim.settleQuietTime = 0;

            if (sim.settleQuietTime >= 0.55 || sim.phaseTimer >= 4.2) {
              finishTurn();
            }
          }

          // Kinematic Gantry + Prismatic Winch 타겟 갱신 + 120Hz 고정 스텝 실행
          gantryBody.setNextKinematicTranslation({ x: sim.gantryX, y: homeY, z: sim.gantryZ });
          winchJoint.configureMotorPosition(sim.targetHeadY - homeY, 320, 48);

          sim.stepAccum += dt;
          const fixedStep = 1 / 120;
          let steps = 0;
          while (sim.stepAccum >= fixedStep && steps < 6) {
            world.step();
            sim.stepAccum -= fixedStep;
            steps++;
          }

          // Three.js 비주얼 1:1 동기화
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
          trolleyMesh.position.set(sim.gantryX, 3.25, sim.gantryZ);

          tmpThreePosA.set(sim.gantryX, 3.22, sim.gantryZ);
          tmpThreePosB.set(hp.x, hp.y + 0.14, hp.z);
          tmpThreeDir.subVectors(tmpThreePosB, tmpThreePosA);
          const cableLen = Math.max(0.08, tmpThreeDir.length());
          cableMesh.scale.set(1, cableLen, 1);
          cableMesh.position.lerpVectors(tmpThreePosA, tmpThreePosB, 0.5);
          tmpThreeDir.normalize();
          tmpThreeQuat.setFromUnitVectors(tmpThreeUp, tmpThreeDir);
          cableMesh.quaternion.copy(tmpThreeQuat);

          if (activePrizeBody && activePrizeMesh) {
            const pp = activePrizeBody.translation();
            const pq = activePrizeBody.rotation();
            activePrizeMesh.position.set(pp.x, pp.y, pp.z);
            activePrizeMesh.quaternion.set(pq.x, pq.y, pq.z, pq.w);

            if (!sim.wonThisTurn && pp.y < STAGE_PHYSICS.DROP_Y_THRESHOLD) {
              sim.wonThisTurn = true;
              setDroppedThisTurn(true);
              playTone(783.99, 0.14, 'sine', 0.12);
              setTimeout(() => playTone(1046.5, 0.25, 'sine', 0.12), 110);
              fireWinConfetti();
              onPrizeWonRef.current(activePrizeSpec);
            }
          }

          // Rapier3D 네이티브 콜라이더 와이어프레임 디버그 렌더
          if (tuningRef.current.showColliders) {
            const { vertices, colors } = world.debugRender();
            debugLinesGeo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            debugLinesGeo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
            debugLinesMesh.visible = true;
          } else {
            debugLinesMesh.visible = false;
          }

          const showAim =
            curPhase === 'ready_right' ||
            curPhase === 'moving_right' ||
            curPhase === 'ready_up' ||
            curPhase === 'moving_up';
          aimRing.visible = showAim;
          aimBeam.visible = showAim;
          if (showAim) {
            aimRing.position.set(hp.x, STAGE_PHYSICS.BAR_Y + 0.12, hp.z);
            const beamH = Math.max(0.2, hp.y - (STAGE_PHYSICS.BAR_Y + 0.12));
            aimBeam.scale.y = beamH / 1.7;
            aimBeam.position.set(hp.x, STAGE_PHYSICS.BAR_Y + 0.12 + beamH / 2, hp.z);
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

          // 텔레메트리 HUD (10Hz)
          sim.telemetryAccum += rawDt;
          if (sim.telemetryAccum >= 0.1) {
            sim.telemetryAccum = 0;
            tmpHeadQuat.set(hq.x, hq.y, hq.z, hq.w).invert();

            tmpArmQuat.set(lq.x, lq.y, lq.z, lq.w);
            tmpRelQuat.copy(tmpHeadQuat).multiply(tmpArmQuat);
            const leftRad = Math.abs(2 * Math.atan2(tmpRelQuat.z, tmpRelQuat.w));

            tmpArmQuat.set(rq.x, rq.y, rq.z, rq.w);
            tmpRelQuat.copy(tmpHeadQuat).multiply(tmpArmQuat);
            const rightRad = Math.abs(2 * Math.atan2(tmpRelQuat.z, tmpRelQuat.w));

            let prizeY = 0;
            let prizeTiltDeg = 0;
            let prizeSpeed = 0;
            if (activePrizeBody) {
              const pp = activePrizeBody.translation();
              const pq = activePrizeBody.rotation();
              const pv = activePrizeBody.linvel();
              prizeY = pp.y;
              prizeSpeed = Math.hypot(pv.x, pv.y, pv.z);
              tmpThreeQuat.set(pq.x, pq.y, pq.z, pq.w);
              tmpThreeDir.set(0, 1, 0).applyQuaternion(tmpThreeQuat);
              prizeTiltDeg = Math.round((Math.acos(Math.max(-1, Math.min(1, tmpThreeDir.y))) * 180) / Math.PI);
            }
            setTelemetry({
              headY: Number(hp.y.toFixed(2)),
              leftDeg: Math.round((leftRad * 180) / Math.PI),
              rightDeg: Math.round((rightRad * 180) / Math.PI),
              prizeY: Number(prizeY.toFixed(2)),
              prizeTiltDeg,
              prizeSpeed: Number(prizeSpeed.toFixed(2)),
              isInitialState: activePrizeIsInitial,
              rapierVersion: rapierVer,
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
  }, [playTone, setCranePhase, triggerExtremeDrr, triggerBalanceCatch, fireWinConfetti]);

  useEffect(() => {
    if (!engineReady || !simBridgeRef.current) return;
    simBridgeRef.current.loadMachine(machineIndex, snapshotsRef.current[machineIndex]);
  }, [machineIndex, engineReady]);

  useEffect(() => {
    if (!engineReady || !simBridgeRef.current) return;
    simBridgeRef.current.applyLiveTuning(tuning);
  }, [
    engineReady,
    tuning.downPressForce,
    tuning.clawTipFriction,
    tuning.barRingFriction,
    tuning.showColliders,
    tuning,
  ]);

  useEffect(() => {
    if (!engineReady || !simBridgeRef.current) return;
    simBridgeRef.current.rebuildCurrentPrizeForTuning();
  }, [engineReady, tuning.massScale, tuning.useComOffset]);

  const currentSpec = PRIZE_SPECS[machineIndex];
  const currentSnap = snapshots[machineIndex];
  const isPlaying = phase !== 'idle';

  const handleStartTurn = useCallback(() => {
    if (!engineReady || phaseRef.current !== 'idle' || !currentSnap.hasStock) return;
    simBridgeRef.current?.startTurn();
  }, [engineReady, currentSnap.hasStock]);

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
      simBridgeRef.current?.startDescending();
    }
  };

  const handleRealign = () => {
    if (isPlaying) return;
    const freshSnap: MachineSnapshot = {
      ...currentSnap,
      hasStock: true,
      position: getRestingPosition(currentSpec),
      quaternion: [0, 0, 0, 1],
      isInitialState: true,
    };
    onUpdateSnapshot(machineIndex, freshSnap);
    simBridgeRef.current?.loadMachine(machineIndex, freshSnap);
    playTone(587.33, 0.09, 'sine', 0.08);
  };

  const handleRefill = () => {
    if (isPlaying || currentSnap.hasStock) return;
    handleRealign();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space' && phaseRef.current === 'idle' && snapshotsRef.current[machineIndexRef.current]?.hasStock) {
        e.preventDefault();
        simBridgeRef.current?.startTurn();
        return;
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
      if ((e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') && phaseRef.current === 'moving_right') {
        e.preventDefault();
        setCranePhase('ready_up');
        playTone(520, 0.08);
      } else if ((e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') && phaseRef.current === 'moving_up') {
        e.preventDefault();
        simBridgeRef.current?.startDescending();
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
    if (engineError) return `❌ Rapier3D 초기화 실패: ${engineError}`;
    if (!engineReady) return '⚙️ Rapier3D Rust WASM 엔진 로딩 중...';
    switch (phase) {
      case 'idle':
        return currentSnap.hasStock
          ? '하단 [뽑기 시작] 또는 Space를 눌러 실제 Rapier3D 물리 크레인을 조작하세요!'
          : '📦 품절 상태입니다. 우측 상단 [뽑기판 리필]을 눌러 상품을 채우세요!';
      case 'ready_right':
        return '1단계: [➡ 우측 이동] 버튼을 꾹 눌렀다가 원하는 X 위치에서 떼세요!';
      case 'moving_right':
        return '➡ 오른쪽으로 이동 중... 손을 떼면 X 좌표가 고정됩니다!';
      case 'ready_up':
        return '2단계: [⬆ 안쪽(위) 이동] 버튼을 꾹 눌렀다가 원하는 Z 위치에서 떼세요!';
      case 'moving_up':
        return '⬆ 안쪽으로 이동 중... 손을 떼면 즉시 하강합니다!';
      case 'descending':
        return '⬇ Prismatic 윈치 + 2축 짐벌 크레인 하강 중 (한쪽이 걸려도 유연하게 끝까지 하강!)';
      case 'closing':
        return '🤏 실제 Revolute 토크 모터 관절로 집게를 오므리는 중...';
      case 'lifting':
        return '⬆ 순수 Rapier3D 물리 마찰·토크로 상품을 들어올리고 있습니다!';
      case 'releasing':
      case 'settling':
        return droppedThisTurn
          ? '🎉 중앙 Bar 사이로 통과 성공!! 상품을 획득했습니다!'
          : '⚖️ 상품이 실리콘 링 Bar 위에서 물리적으로 자리를 잡는 중...';
    }
  })();

  return (
    <div className="w-full rounded-3xl overflow-hidden border border-emerald-500/35 bg-slate-950 shadow-2xl shadow-emerald-950/30">
      {/* 상단 상태 바 */}
      <div className="px-4 py-2.5 bg-slate-900/95 border-b border-slate-800 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/45 text-emerald-300 text-[11px] font-black shrink-0">
              <Sparkles className="w-3 h-3" />
              {machineIndex + 1}/6번 판
            </span>
            <span className="text-xs font-black text-amber-300 shrink-0 hidden sm:inline">
              {currentSpec.label}
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

        {/* 1~6번 개별 뽑기판 탭 + 우측 리필 / 재정렬 버튼 */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {PRIZE_SPECS.map((spec) => {
              const isActive = spec.index === machineIndex;
              const snap = snapshots[spec.index];
              return (
                <button
                  key={spec.index}
                  type="button"
                  disabled={isPlaying}
                  onClick={() => onSelectMachine(spec.index)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-bold shrink-0 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    isActive
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 shadow-sm'
                      : 'bg-slate-950/80 hover:bg-slate-800 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      snap.hasStock ? 'bg-emerald-400' : 'bg-slate-600'
                    }`}
                  />
                  <span>{spec.shortName}</span>
                  {!snap.hasStock && <span className="text-[9px] text-rose-400 font-black">품절</span>}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            <button
              type="button"
              onClick={handleRefill}
              disabled={isPlaying || currentSnap.hasStock}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 text-[11px] font-black cursor-pointer disabled:opacity-40 transition-colors"
              title="품절된 현재 뽑기판 리필"
            >
              <PackagePlus className="w-3.5 h-3.5" />
              <span>뽑기판 리필</span>
            </button>

            <button
              type="button"
              onClick={handleRealign}
              disabled={isPlaying}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 text-[11px] font-black cursor-pointer disabled:opacity-40 transition-colors"
              title="현재 뽑기판 상품을 중앙 원위치로 재정렬"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>뽑기판 재정렬</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3D WebGL 캔버스 뷰포트 */}
      <div className="relative w-full h-[320px] sm:h-[470px] bg-[#040c14] select-none">
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
                : isPlaying
                ? '정면뷰 (조작 고정)'
                : '정면뷰'
              : cameraView === 'top'
              ? '항공뷰 · 정면복귀'
              : '우측뷰 · 정면복귀'}
          </span>
        </button>

        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
          {!isPlaying && (
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

        {/* 우측 상단 실시간 Rapier3D 텔레메트리 HUD */}
        <div className="absolute top-2.5 right-2.5 z-20 hidden sm:flex flex-col items-end gap-0.5 px-2.5 py-1.5 rounded-xl bg-slate-950/80 border border-emerald-700/60 backdrop-blur-sm font-mono text-[10px] text-slate-300 pointer-events-none">
          <div className="flex items-center gap-1 text-emerald-300 font-black">
            <Activity className="w-3 h-3" />
            <span>Rapier3D {telemetry.rapierVersion} · 120Hz</span>
          </div>
          <div>
            집게 L <span className="text-amber-300">{telemetry.leftDeg}°</span> · R{' '}
            <span className="text-amber-300">{telemetry.rightDeg}°</span>
          </div>
          <div>
            상자 Y <span className="text-emerald-300">{telemetry.prizeY.toFixed(2)}</span> · 기울기{' '}
            <span className="text-rose-300">{telemetry.prizeTiltDeg}°</span>
          </div>
          <div className="text-[9px] text-slate-400">
            상태: {telemetry.isInitialState ? '초기 원위치 (Balance Catch 가능)' : '이동됨 (극한 드르륵 가능)'}
          </div>
        </div>

        {!isPlaying && (
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
          🎯 <strong className="text-white">{currentSpec.label}</strong> ({currentSpec.difficultyText}) ·{' '}
          <span className="text-amber-300 font-mono">{currentSpec.rewardSol} SOL</span>
        </div>

        {droppedThisTurn && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 pointer-events-none px-4 py-1.5 rounded-full bg-amber-500 text-slate-950 font-black text-xs sm:text-sm shadow-lg animate-bounce flex items-center gap-1.5">
            <Trophy className="w-4 h-4" />
            <span>🎊 통과 성공!! {currentSpec.label} 획득!</span>
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
      </div>

      {/* 하단 아케이드 조작 패널 */}
      <div className="p-4 bg-gradient-to-b from-slate-900 to-slate-950 border-t border-slate-800">
        {phase === 'idle' ? (
          <div className="flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-300 text-center md:text-left space-y-0.5">
              <div>
                엔진: <strong className="text-emerald-300">Rapier3D {telemetry.rapierVersion} (Rust → WASM)</strong> ·{' '}
                <span className="text-cyan-300 font-bold">무제한 비교 테스트 모드</span>
              </div>
              <div className="text-[11px] text-slate-400">
                현재 판 [{machineIndex + 1}/6]: <strong className="text-white">{currentSpec.label}</strong> · 시도{' '}
                {currentSnap.plays}회 / 획득 {currentSnap.wins}회
              </div>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto justify-center">
              <button
                type="button"
                onClick={() => onSelectMachine((machineIndex - 1 + PRIZE_SPECS.length) % PRIZE_SPECS.length)}
                className="inline-flex items-center justify-center gap-1 px-3.5 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-600/80 hover:border-emerald-400/60 text-slate-200 hover:text-emerald-200 font-black text-xs sm:text-sm transition-all active:scale-95 cursor-pointer shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>이전 뽑기</span>
              </button>

              <button
                type="button"
                disabled={!engineReady || !currentSnap.hasStock}
                onClick={handleStartTurn}
                className="flex-1 md:flex-none px-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-emerald-500/25 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              >
                {!engineReady
                  ? '⚙️ Rapier3D 로딩 중...'
                  : !currentSnap.hasStock
                  ? '📦 품절 (리필 클릭)'
                  : '🕹️ 뽑기 시작! (Space)'}
              </button>

              <button
                type="button"
                onClick={() => onSelectMachine((machineIndex + 1) % PRIZE_SPECS.length)}
                className="inline-flex items-center justify-center gap-1 px-3.5 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-600/80 hover:border-emerald-400/60 text-slate-200 hover:text-emerald-200 font-black text-xs sm:text-sm transition-all active:scale-95 cursor-pointer shrink-0"
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

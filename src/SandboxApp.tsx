import React, { useState, useCallback, useMemo } from 'react';
import { Sliders, RotateCcw, Trophy, Cpu, Layers, Sparkles, Eye } from 'lucide-react';
import {
  DEFAULT_PHYSICS_TUNING,
  PhysicsTuning,
  PRIZE_SPECS,
} from '@/constants/prizes';
import {
  createSingleMachineItems,
  GACHA_MACHINE_COUNT,
  GACHA_SLOT_DIFFICULTY_TEXT,
  GACHA_SLOT_LABELS,
  getBoxRewardAmount,
  getMachineLabel,
} from '@/constants/gacha';
import { GachaBoxItem } from '@/types/gacha';
import { RapierUfoMachine3D, TurnFinishPayload } from '@/components/RapierUfoMachine3D';
import { fireSafeConfetti } from '@/lib/confetti';

interface WinLogEntry {
  id: string;
  label: string;
  time: string;
}

export default function SandboxApp() {
  const [machineIndex, setMachineIndex] = useState(0);
  const [machineItems, setMachineItems] = useState<GachaBoxItem[][]>(() =>
    Array.from({ length: GACHA_MACHINE_COUNT }, (_, idx) => createSingleMachineItems(idx, Date.now() + idx))
  );
  const [turnSeq, setTurnSeq] = useState(0);
  const [activeTurnKey, setActiveTurnKey] = useState<string | null>(null);
  const [tuning, setTuning] = useState<PhysicsTuning>(DEFAULT_PHYSICS_TUNING);
  const [showTuning, setShowTuning] = useState(true);
  const [totalPlays, setTotalPlays] = useState(0);
  const [totalWins, setTotalWins] = useState(0);
  const [winLogs, setWinLogs] = useState<WinLogEntry[]>([]);

  const currentItems = machineItems[machineIndex] || [];

  const handleStartTurn = useCallback(() => {
    if (activeTurnKey || currentItems.length === 0) return;
    const nextSeq = turnSeq + 1;
    setTurnSeq(nextSeq);
    setActiveTurnKey(`sandbox_rapier_${machineIndex}_${nextSeq}`);
  }, [activeTurnKey, currentItems.length, machineIndex, turnSeq]);

  const handleTurnFinish = useCallback(
    (payload: TurnFinishPayload) => {
      const wonSet = new Set(payload.wonItemIds);
      const updMap = new Map(payload.updatedItems.map((u) => [u.id, u]));
      setTotalPlays((p) => p + 1);
      if (wonSet.size > 0) {
        setTotalWins((w) => w + wonSet.size);
        const label = getMachineLabel(machineIndex);
        setWinLogs((prev) => [
          { id: `${Date.now()}`, label, time: new Date().toTimeString().slice(0, 8) },
          ...prev.slice(0, 19),
        ]);
        fireSafeConfetti({
          particleCount: 90,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#10b981', '#34d399', '#fbbf24', '#22d3ee', '#a855f7', '#fb7185'],
        });
      }
      setMachineItems((prev) => {
        const copy = [...prev];
        copy[machineIndex] = (copy[machineIndex] || [])
          .filter((it) => !wonSet.has(it.id))
          .map((it) => {
            const u = updMap.get(it.id);
            return u
              ? { ...it, position: u.position, quaternion: u.quaternion, isInitialState: u.isInitialState }
              : it;
          });
        return copy;
      });
      setActiveTurnKey(null);
    },
    [machineIndex]
  );

  const handleRealign = useCallback(() => {
    if (activeTurnKey) return;
    setMachineItems((prev) => {
      const copy = [...prev];
      copy[machineIndex] = createSingleMachineItems(machineIndex, Date.now());
      return copy;
    });
  }, [activeTurnKey, machineIndex]);

  const handleRefill = useCallback(() => {
    if (activeTurnKey || currentItems.length > 0) return;
    handleRealign();
  }, [activeTurnKey, currentItems.length, handleRealign]);

  const machineSummaries = useMemo(
    () =>
      PRIZE_SPECS.map((spec) => ({
        index: spec.index,
        shortName: spec.shortName,
        hasStock: (machineItems[spec.index]?.length ?? 0) > 0,
        lockedBy: null,
      })),
    [machineItems]
  );

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-slate-950/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/25">
              <Cpu className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-black tracking-tight text-white flex items-center gap-2 flex-wrap">
                <span>Rapier3D 무료 무한 연습실</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-[10px] font-mono">
                  Sandbox · Port 4300
                </span>
              </h1>
              <p className="text-[11px] text-slate-400">
                무제한 무료 테스트 · 집게 힘/마찰력/무게중심/슬로우모션 · Rust WASM 콜라이더 디버그
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono flex items-center gap-2">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>
                당첨 <strong className="text-amber-300">{totalWins}</strong> / 시도 {totalPlays}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowTuning((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-black transition-colors cursor-pointer ${
                showTuning
                  ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>물리 튜닝</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 space-y-4">
        <RapierUfoMachine3D
          items={currentItems}
          isMyTurn={Boolean(activeTurnKey)}
          lockedByOther={null}
          turnKey={activeTurnKey}
          onTurnFinish={handleTurnFinish}
          onStartTurnRequest={handleStartTurn}
          canStartTurn={!activeTurnKey && currentItems.length > 0}
          selectedMember="테스터"
          selectedMemberTickets={999}
          isStarting={false}
          isFinishing={false}
          machineIndex={machineIndex}
          machineCount={GACHA_MACHINE_COUNT}
          machineLabel={GACHA_SLOT_LABELS[machineIndex] || getMachineLabel(machineIndex)}
          machineDifficulty={GACHA_SLOT_DIFFICULTY_TEXT[machineIndex] || '난이도 6.5'}
          machineRewardSol={getBoxRewardAmount(machineIndex)}
          onPrevMachine={() => !activeTurnKey && setMachineIndex((i) => (i - 1 + GACHA_MACHINE_COUNT) % GACHA_MACHINE_COUNT)}
          onNextMachine={() => !activeTurnKey && setMachineIndex((i) => (i + 1) % GACHA_MACHINE_COUNT)}
          onSelectMachine={(idx) => !activeTurnKey && setMachineIndex(idx)}
          machineSummaries={machineSummaries}
          isAdmin={true}
          onAdminRefill={handleRefill}
          onAdminReset={handleRealign}
          tuning={tuning}
          sandboxMode={true}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {showTuning && (
            <section className="lg:col-span-2 p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-xs sm:text-sm font-black text-white flex items-center gap-1.5">
                  <Sliders className="w-4 h-4 text-emerald-400" />
                  <span>Rapier3D 실시간 물리 파라미터 튜닝</span>
                </h2>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setTuning((t) => ({ ...t, showColliders: !t.showColliders }))}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer transition-colors ${
                      tuning.showColliders
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                        : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>콜라이더 보기</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTuning(DEFAULT_PHYSICS_TUNING)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] font-bold cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>기본값 복원</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                  <div className="flex justify-between font-bold">
                    <span className="text-slate-300">집게 닫힘 토크 (잡는 힘)</span>
                    <span className="font-mono text-emerald-300">{tuning.closeTorque.toFixed(1)} N·m</span>
                  </div>
                  <input type="range" min={6} max={24} step={0.5} value={tuning.closeTorque} onChange={(e) => setTuning((t) => ({ ...t, closeTorque: Number(e.target.value) }))} className="w-full accent-emerald-400" />
                </label>

                <label className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                  <div className="flex justify-between font-bold">
                    <span className="text-slate-300">집게 리프트 유지 토크</span>
                    <span className="font-mono text-amber-300">{tuning.liftTorque.toFixed(1)} N·m</span>
                  </div>
                  <input type="range" min={5} max={22} step={0.5} value={tuning.liftTorque} onChange={(e) => setTuning((t) => ({ ...t, liftTorque: Number(e.target.value) }))} className="w-full accent-amber-400" />
                </label>

                <label className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                  <div className="flex justify-between font-bold">
                    <span className="text-slate-300">하강 누르기 최대 힘</span>
                    <span className="font-mono text-cyan-300">{tuning.downPressForce.toFixed(0)} N</span>
                  </div>
                  <input type="range" min={15} max={70} step={1} value={tuning.downPressForce} onChange={(e) => setTuning((t) => ({ ...t, downPressForce: Number(e.target.value) }))} className="w-full accent-cyan-400" />
                </label>

                <label className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                  <div className="flex justify-between font-bold">
                    <span className="text-slate-300">중앙 빨간 실리콘 링 마찰력</span>
                    <span className="font-mono text-rose-300">{tuning.barRingFriction.toFixed(2)} μ</span>
                  </div>
                  <input type="range" min={0.25} max={1.2} step={0.02} value={tuning.barRingFriction} onChange={(e) => setTuning((t) => ({ ...t, barRingFriction: Number(e.target.value) }))} className="w-full accent-rose-400" />
                </label>

                <label className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1">
                  <div className="flex justify-between font-bold">
                    <span className="text-slate-300">상품 무게 배율</span>
                    <span className="font-mono text-purple-300">{tuning.massScale.toFixed(2)}×</span>
                  </div>
                  <input type="range" min={0.6} max={1.5} step={0.05} value={tuning.massScale} onChange={(e) => setTuning((t) => ({ ...t, massScale: Number(e.target.value) }))} className="w-full accent-purple-400" />
                </label>

                <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-bold text-slate-300">시뮬레이션 속도 / 무게중심</div>
                    <div className="text-[10px] text-slate-500">슬로우모션으로 물리 접촉 정밀 관찰</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => setTuning((t) => ({ ...t, timeScale: t.timeScale === 1 ? 0.5 : 1 }))} className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono font-black cursor-pointer ${tuning.timeScale < 1 ? 'bg-amber-500/20 border-amber-400 text-amber-300' : 'bg-slate-900 border-slate-700 text-slate-300'}`}>
                      {tuning.timeScale}x
                    </button>
                    <button type="button" onClick={() => setTuning((t) => ({ ...t, useComOffset: !t.useComOffset }))} className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer ${tuning.useComOffset ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300' : 'bg-slate-900 border-slate-700 text-slate-400'}`}>
                      편심 {tuning.useComOffset ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className={`${showTuning ? 'lg:col-span-1' : 'lg:col-span-3'} p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3`}>
            <h2 className="text-xs sm:text-sm font-black text-white flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Rapier3D 무료 연습실 안내 (4300)</span>
            </h2>
            <ul className="space-y-1.5 text-[11px] text-slate-300 leading-relaxed">
              <li className="flex items-start gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span>뽑기권 차감 없이 무제한 연습 가능하며 실서버 리워드/DB에 영향을 주지 않습니다.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>시작/Balance Catch/극한 드르륵/아슬 아슬/당첨 효과음과 팝업을 모두 테스트할 수 있습니다.</span>
              </li>
            </ul>
            {winLogs.length > 0 && (
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <div className="text-[11px] font-black text-amber-300">🏆 연습 획득 기록 ({winLogs.length})</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {winLogs.map((w) => (
                    <div key={w.id} className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-[11px]">
                      <span className="font-bold text-white truncate">{w.label}</span>
                      <span className="font-mono text-amber-300 shrink-0">{w.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

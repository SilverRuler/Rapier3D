import React, { useState } from 'react';
import { X, Info, Box, Sparkles, Coins, Scale, Ruler, ArrowRight, Layers } from 'lucide-react';
import { DEFAULT_PHYSICS_TUNING, getMachineProfile, PRIZE_SPECS } from '@/constants/prizes';
import { GACHA_PHYSICS, PLUSH_MOUND_COUNT, PUSHER_DECK_COUNT, PUSHER_PIT_COUNT } from '@/constants/gacha';

interface GachaPrizeInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMachineIndex?: number;
  onSelectMachine?: (idx: number) => void;
}

export const GachaPrizeInfoModal: React.FC<GachaPrizeInfoModalProps> = ({
  isOpen,
  onClose,
  currentMachineIndex,
  onSelectMachine,
}) => {
  const [filter, setFilter] = useState<'all' | 'figure' | 'plush' | 'pusher'>('all');

  if (!isOpen) return null;

  const figureCount = PRIZE_SPECS.filter((s) => !s.isPlush && !s.isPusher).length;
  const plushCount = PRIZE_SPECS.filter((s) => s.isPlush).length;
  const pusherCount = PRIZE_SPECS.filter((s) => s.isPusher).length;
  const filtered = PRIZE_SPECS.filter((s) => {
    if (filter === 'figure') return !s.isPlush && !s.isPusher;
    if (filter === 'plush') return s.isPlush;
    if (filter === 'pusher') return Boolean(s.isPusher);
    return true;
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-violet-500/45 w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-5 py-4 bg-gradient-to-r from-violet-950/70 via-slate-900 to-slate-900 border-b border-violet-500/30 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-violet-500/20 border border-violet-400/40 flex items-center justify-center text-violet-300">
              <Info className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-white flex items-center gap-2 flex-wrap">
                <span>뽑기 상품 전체 스펙 정보</span>
                <span className="px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-400/40 text-violet-200 text-[10px] font-mono">
                  총 {PRIZE_SPECS.length}종 (피규어 {figureCount} · 인형 {plushCount} · 밀판 {pusherCount})
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                피규어 {figureCount}종(하시와타시 4-Bar) · 인형 {plushCount}종(산개 5개·WIN 구멍 운반) · 밀판 {pusherCount}종(캡슐 밀어내기)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 크레인 공통 세팅 요약 + 필터 */}
        <div className="px-5 py-3 bg-slate-950/70 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-xl text-xs font-black border cursor-pointer transition-colors ${
                filter === 'all'
                  ? 'bg-violet-500 text-slate-950 border-violet-300'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
              }`}
            >
              전체 ({PRIZE_SPECS.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('figure')}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-black border cursor-pointer transition-colors ${
                filter === 'figure'
                  ? 'bg-emerald-500 text-slate-950 border-emerald-300'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              <span>피규어 ({figureCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('plush')}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-black border cursor-pointer transition-colors ${
                filter === 'plush'
                  ? 'bg-pink-500 text-slate-950 border-pink-300'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>인형 ({plushCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('pusher')}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-black border cursor-pointer transition-colors ${
                filter === 'pusher'
                  ? 'bg-amber-400 text-slate-950 border-amber-200'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-500'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>밀판 ({pusherCount})</span>
            </button>
          </div>

          <div className="text-[10px] font-mono text-slate-400 flex items-center gap-2 flex-wrap">
            <span>기준(#1 페른) 잡는힘 <strong className="text-emerald-300">{DEFAULT_PHYSICS_TUNING.closeTorque.toFixed(1)}</strong></span>
            <span>·</span>
            <span>유지 <strong className="text-amber-300">{DEFAULT_PHYSICS_TUNING.liftTorque.toFixed(1)}</strong></span>
            <span>·</span>
            <span>누르기 <strong className="text-cyan-300">{DEFAULT_PHYSICS_TUNING.downPressForce}N</strong></span>
            <span>·</span>
            <span className="text-violet-300">판별 개별 세팅</span>
          </div>
        </div>

        {/* 상품 스펙 카드 목록 */}
        <div className="p-4 sm:p-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((spec) => {
            const prof = getMachineProfile(spec.index);
            const redInnerGap = Math.max(0.1, (prof.redBarHalfZ - GACHA_PHYSICS.BAR_RADIUS) * 2);
            const effectiveMass = (
              spec.isPusher
                ? spec.mass
                : spec.mass * (spec.isPlush ? 0.32 : 1) * DEFAULT_PHYSICS_TUNING.massScale
            ).toFixed(2);
            const isCurrent = currentMachineIndex === spec.index;
            return (
              <div
                key={spec.index}
                className={`p-3.5 rounded-2xl border flex flex-col justify-between gap-2.5 transition-all ${
                  isCurrent
                    ? 'bg-violet-950/30 border-violet-400/70 ring-1 ring-violet-400/30'
                    : 'bg-slate-950/85 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-16 h-20 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center p-1">
                    <img
                      src={spec.imgSrc}
                      alt={spec.label}
                      className="w-full h-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-200 text-[10px] font-mono font-black">
                        #{spec.index + 1}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded-md text-[10px] font-black border ${
                          spec.isPusher
                            ? 'bg-amber-500/15 border-amber-400/50 text-amber-300'
                            : spec.isPlush
                            ? 'bg-pink-500/15 border-pink-400/40 text-pink-300'
                            : spec.isSquare
                            ? 'bg-rose-500/15 border-rose-400/40 text-rose-300'
                            : 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                        }`}
                      >
                        {spec.isPusher ? '⚡ 밀판 (캡슐)' : spec.isPlush ? '🧸 인형' : spec.isSquare ? '📦 피규어(정사각)' : '📦 피규어'}
                      </span>
                      {isCurrent && (
                        <span className="px-1.5 py-0.5 rounded-md bg-violet-500/25 text-violet-200 text-[10px] font-black">
                          현재 선택
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-black text-white truncate">{spec.label}</h3>
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <span className="font-bold text-slate-300">{spec.difficultyText}</span>
                      <span className="inline-flex items-center gap-0.5 font-mono font-black text-amber-300">
                        <Coins className="w-3 h-3" />
                        {spec.rewardSol} SOL
                      </span>
                    </div>
                  </div>
                </div>

                {/* 물리 제원 그리드 */}
                <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                  <div className="px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-1">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Ruler className="w-3 h-3 text-emerald-400" />
                      크기
                    </span>
                    <span className="text-slate-200 font-bold">
                      {spec.w.toFixed(2)}×{spec.h.toFixed(2)}×{spec.d.toFixed(2)}
                    </span>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-1">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Scale className="w-3 h-3 text-purple-400" />
                      실전무게
                    </span>
                    <span className="text-purple-200 font-bold">
                      {effectiveMass}kg
                    </span>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-1">
                    <span className="text-slate-400">{spec.isPusher || spec.isPlush ? '뽑기 방식' : '빨간Bar 내경'}</span>
                    <span className={spec.isPusher ? 'text-amber-300 font-bold' : spec.isPlush ? 'text-pink-300 font-bold' : 'text-rose-300 font-bold'}>
                      {spec.isPusher
                        ? `밀판 ${PUSHER_DECK_COUNT}+우측 ${PUSHER_PIT_COUNT}`
                        : spec.isPlush
                        ? `산개 ${PLUSH_MOUND_COUNT}개·WIN구멍`
                        : `${redInnerGap.toFixed(2)}m (외곽 ${(prof.outerBarHalfZ * 2).toFixed(2)})`}
                    </span>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-1">
                    <span className="text-slate-400">잡기/유지</span>
                    <span className="text-amber-300 font-bold">
                      {prof.closeTorque.toFixed(1)} / {prof.liftTorque.toFixed(1)}
                    </span>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-1">
                    <span className="text-slate-400">헤드/집게</span>
                    <span className="text-cyan-300 font-bold">
                      {prof.headScale.toFixed(2)}× / {prof.armLengthScale.toFixed(2)}×
                    </span>
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-1">
                    <span className="text-slate-400">팁 마찰</span>
                    <span className="text-emerald-300 font-bold">{prof.clawTipFriction.toFixed(2)} μ</span>
                  </div>
                </div>

                <p className="text-[11px] text-slate-300 leading-relaxed bg-slate-900/60 rounded-xl px-2.5 py-2 border border-slate-800/80">
                  💡 {spec.strategyTip}
                </p>

                {onSelectMachine && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectMachine(spec.index);
                      onClose();
                    }}
                    className="w-full py-1.5 rounded-xl bg-slate-800 hover:bg-violet-600/80 border border-slate-700 hover:border-violet-400 text-slate-200 hover:text-white text-xs font-black flex items-center justify-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>#{spec.index + 1}번 뽑기판으로 이동</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 bg-slate-950/70 border-t border-slate-800 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs sm:text-sm font-bold cursor-pointer transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

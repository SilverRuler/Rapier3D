import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  Sparkles,
  Ticket,
  ShieldCheck,
  Coins,
  Gift,
  Plus,
  Minus,
  Loader2,
  Trophy,
  RefreshCw,
  ArrowRightLeft,
  Megaphone,
  X,
  Clock,
  Info,
  Camera,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Lock,
  LogOut,
  Radio,
} from 'lucide-react';
import { MEMBERS } from '@/constants/members';
import {
  GACHA_MACHINE_COUNT,
  GACHA_SLOT_BOX_DIMS,
  GACHA_SLOT_DIFFICULTY_TEXT,
  GACHA_SLOT_LABELS,
  GACHA_SLOT_REWARD_AMOUNTS,
  GACHA_SLOT_SHORT_LABELS,
  getBoxRewardAmount,
  getMachineFullItemCount,
  getMachineLabel,
} from '@/constants/gacha';
import { getDefaultTuningForMachine } from '@/constants/prizes';
import { GachaMachineState, GachaTicketBalance, GachaWinRecord } from '@/types/gacha';
import { MemberWinStats } from '@/types/meal';
import { RapierUfoMachine3D, TurnFinishPayload } from '@/components/RapierUfoMachine3D';
import { GachaWinModal } from '@/components/GachaWinModal';
import { LeaderboardModal } from '@/components/LeaderboardModal';
import { RewardModal } from '@/components/RewardModal';
import { AdminLoginModal } from '@/components/AdminLoginModal';
import { GachaLiveChat } from '@/components/GachaLiveChat';
import { GachaPrizeInfoModal } from '@/components/GachaPrizeInfoModal';
import { PresenceModal } from '@/components/PresenceModal';

const WINNER_SITE_URL = 'https://win.silverruler.xyz';
const NICK_CONFIRMED_UA_KEY = 'aial_gacha_nick_confirmed_ua_v1';

function getNextScheduledResetKst(nowMs: number): { ts: number; label: string } {
  const KST_OFFSET_MS = 9 * 3600 * 1000;
  const kstDate = new Date(nowMs + KST_OFFSET_MS);
  const y = kstDate.getUTCFullYear();
  const m = kstDate.getUTCMonth();
  const d = kstDate.getUTCDate();
  const makeKstMs = (year: number, month: number, day: number, hour: number, minute: number) =>
    Date.UTC(year, month, day, hour, minute, 0, 0) - KST_OFFSET_MS;
  const upcoming = [
    { label: '10:30', ts: makeKstMs(y, m, d, 10, 30) },
    { label: '14:00', ts: makeKstMs(y, m, d, 14, 0) },
    { label: '23:00', ts: makeKstMs(y, m, d, 23, 0) },
    { label: '10:30', ts: makeKstMs(y, m, d + 1, 10, 30) },
  ];
  return upcoming.find((c) => c.ts > nowMs) || upcoming[upcoming.length - 1];
}

function formatKstShortDateTime(ts?: number | null): string {
  if (!ts) return '';
  const kst = new Date(ts + 9 * 3600 * 1000);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

function formatKstDateTime(ts?: number): string {
  if (!ts) return '';
  const kst = new Date(ts + 9 * 3600 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mi = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

interface RecentLogEntry {
  id: string;
  type: string;
  member: string;
  message: string;
  createdAt: number;
  machineIndex?: number;
}

export default function App() {
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isAdminLoginOpen, setIsAdminLoginOpen] = useState<boolean>(false);
  const [authChecked, setAuthChecked] = useState<boolean>(false);

  const [machines, setMachines] = useState<GachaMachineState[]>([]);
  const [selectedMachineIndex, setSelectedMachineIndex] = useState<number>(0);
  const machine = useMemo(
    () => machines[selectedMachineIndex] || null,
    [machines, selectedMachineIndex]
  );
  const updateMachineAt = useCallback((idx: number, nextMachine: GachaMachineState) => {
    setMachines((prev) => {
      if (!prev.length) return [nextMachine];
      const copy = [...prev];
      copy[idx] = nextMachine;
      return copy;
    });
  }, []);

  const [ticketsByMember, setTicketsByMember] = useState<Record<string, GachaTicketBalance>>({});
  const [recentWins, setRecentWins] = useState<GachaWinRecord[]>([]);
  const [showAllRecentWins, setShowAllRecentWins] = useState<boolean>(false);
  const [recentWinsPage, setRecentWinsPage] = useState<number>(1);
  const [recentLogs, setRecentLogs] = useState<RecentLogEntry[]>([]);
  const [totalLogCount, setTotalLogCount] = useState<number>(0);
  const [isRecentLogsExpanded, setIsRecentLogsExpanded] = useState<boolean>(false);
  const [recentLogsPage, setRecentLogsPage] = useState<number>(1);
  const [pagedRecentLogs, setPagedRecentLogs] = useState<RecentLogEntry[]>([]);
  const [isLoadingRecentLogs, setIsLoadingRecentLogs] = useState<boolean>(false);
  const [allRecentLogs, setAllRecentLogs] = useState<RecentLogEntry[]>([]);
  const [allTotalLogCount, setAllTotalLogCount] = useState<number>(0);
  const [isAllLogsExpanded, setIsAllLogsExpanded] = useState<boolean>(false);
  const [allLogsPage, setAllLogsPage] = useState<number>(1);
  const [pagedAllLogs, setPagedAllLogs] = useState<RecentLogEntry[]>([]);
  const [isLoadingAllLogs, setIsLoadingAllLogs] = useState<boolean>(false);
  const [gachaWinStats, setGachaWinStats] = useState<MemberWinStats[]>([]);
  const [usedWinsByMember, setUsedWinsByMember] = useState<Record<string, number>>({});
  const [availableGachaSolByMember, setAvailableGachaSolByMember] = useState<Record<string, number>>({});
  const [mealWinSummaryByMember, setMealWinSummaryByMember] = useState<
    Record<string, { actualWins: number; rewardUsedWins: number; exchangedWins: number; availableMealWins: number }>
  >({});
  const [isExchangingWin, setIsExchangingWin] = useState<boolean>(false);
  const [isExchangingSol, setIsExchangingSol] = useState<boolean>(false);
  const [isSolExchangeModalOpen, setIsSolExchangeModalOpen] = useState<boolean>(false);
  const [solExchangeInput, setSolExchangeInput] = useState<string>('1');
  const [solExchangeError, setSolExchangeError] = useState<string>('');
  const [selectedMember, setSelectedMember] = useState<string>(MEMBERS[0].name);

  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState<boolean>(false);
  const [isUfoNoticeOpen, setIsUfoNoticeOpen] = useState<boolean>(false);
  const [isPrizeInfoOpen, setIsPrizeInfoOpen] = useState<boolean>(false);
  const [openNotice261127, setOpenNotice261127] = useState<boolean>(true);
  const [openNotice261126, setOpenNotice261126] = useState<boolean>(false);
  const [openNotice261125, setOpenNotice261125] = useState<boolean>(false);
  const [openNotice261124, setOpenNotice261124] = useState<boolean>(false);
  const [selectedNoticeBoxSlot, setSelectedNoticeBoxSlot] = useState<number | null>(null);
  const [isRewardModalOpen, setIsRewardModalOpen] = useState<boolean>(false);
  const [rewardInitialMember, setRewardInitialMember] = useState<string | null>(null);
  const [rewardStartApply, setRewardStartApply] = useState<boolean>(false);

  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [activeTurnKey, setActiveTurnKey] = useState<string | null>(null);
  const [pendingNextTurnKey, setPendingNextTurnKey] = useState<string | null>(null);
  const [sessionProgress, setSessionProgress] = useState<{
    current: number;
    total: number;
    bonusPlays: number;
  } | null>(null);
  const [isStartModalOpen, setIsStartModalOpen] = useState<boolean>(false);
  const [isNickConfirmOpen, setIsNickConfirmOpen] = useState<boolean>(false);
  const [stateLoaded, setStateLoaded] = useState<boolean>(false);
  const [isMachineSuspended, setIsMachineSuspended] = useState<boolean>(false);
  const [suspendedMachines, setSuspendedMachines] = useState<number[]>([]);
  const [isPresenceOpen, setIsPresenceOpen] = useState<boolean>(false);
  const [activeUsersCount, setActiveUsersCount] = useState<number>(0);
  const [resetCountdownSec, setResetCountdownSec] = useState<number | null>(null);
  const [resetTargetLabel, setResetTargetLabel] = useState<string>('');
  const [isResetLockdown, setIsResetLockdown] = useState<boolean>(false);
  const [pendingMultiPlayCount, setPendingMultiPlayCount] = useState<number | null>(null);
  const [startPlayInput, setStartPlayInput] = useState<string>('1');
  const [startModalError, setStartModalError] = useState<string>('');
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [isFinishing, setIsFinishing] = useState<boolean>(false);
  const [serverClockOffset, setServerClockOffset] = useState<number>(0);
  const serverClockOffsetRef = useRef<number>(0);
  serverClockOffsetRef.current = serverClockOffset;
  const fetchSeqRef = useRef<number>(0);
  const logsFetchSeqRef = useRef<number>(0);
  const allLogsFetchSeqRef = useRef<number>(0);
  const [isRefilling, setIsRefilling] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [isGranting, setIsGranting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [statusMessageAt, setStatusMessageAt] = useState<number | null>(null);
  useEffect(() => {
    if (statusMessage) {
      setStatusMessageAt(Date.now() + serverClockOffsetRef.current);
    } else {
      setStatusMessageAt(null);
    }
  }, [statusMessage]);
  const [activeWinModal, setActiveWinModal] = useState<GachaWinRecord | null>(null);
  const [activeWinRefundedTickets, setActiveWinRefundedTickets] = useState<number>(0);

  // 초기 로드: URL 쿼리(?member=..., ?machine=...) 및 localStorage 세션 복원
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paramMember = params.get('member');
    const paramMachine = params.get('machine');

    if (paramMember && MEMBERS.some((m) => m.name === paramMember)) {
      setSelectedMember(paramMember);
      localStorage.setItem('aial_gacha_member', paramMember);
    } else {
      const savedMem = localStorage.getItem('aial_gacha_member');
      if (savedMem && MEMBERS.some((m) => m.name === savedMem)) {
        setSelectedMember(savedMem);
      }
    }

    const parsedParamIdx = paramMachine !== null ? Number(paramMachine) : NaN;
    if (Number.isInteger(parsedParamIdx) && parsedParamIdx >= 0 && parsedParamIdx < GACHA_MACHINE_COUNT) {
      setSelectedMachineIndex(parsedParamIdx);
      localStorage.setItem('aial_gacha_machine_idx', String(parsedParamIdx));
    } else {
      const savedMachineIdx = Number(localStorage.getItem('aial_gacha_machine_idx'));
      if (Number.isInteger(savedMachineIdx) && savedMachineIdx >= 0 && savedMachineIdx < GACHA_MACHINE_COUNT) {
        setSelectedMachineIndex(savedMachineIdx);
      }
    }

    if (paramMember || paramMachine) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    const savedAdmin =
      sessionStorage.getItem('aial_is_admin') === 'true' ||
      localStorage.getItem('aial_is_admin') === 'true';
    const hasCreds = Boolean(
      (sessionStorage.getItem('aial_admin_id') || localStorage.getItem('aial_admin_id')) &&
        (sessionStorage.getItem('aial_admin_pw') || localStorage.getItem('aial_admin_pw'))
    );
    setIsAdmin(Boolean(savedAdmin && hasCreds));
    setAuthChecked(true);
  }, []);

  const getAdminCreds = () => ({
    adminId: sessionStorage.getItem('aial_admin_id') || localStorage.getItem('aial_admin_id') || '',
    adminPw: sessionStorage.getItem('aial_admin_pw') || localStorage.getItem('aial_admin_pw') || '',
  });

  const handleAdminLogout = () => {
    sessionStorage.removeItem('aial_is_admin');
    sessionStorage.removeItem('aial_admin_id');
    sessionStorage.removeItem('aial_admin_pw');
    localStorage.removeItem('aial_is_admin');
    localStorage.removeItem('aial_admin_id');
    localStorage.removeItem('aial_admin_pw');
    setIsAdmin(false);
  };

  const presenceMetaRef = useRef({
    member: selectedMember,
    machineIndex: selectedMachineIndex,
    playing: false,
  });
  useEffect(() => {
    presenceMetaRef.current = {
      member: selectedMember,
      machineIndex: selectedMachineIndex,
      playing: Boolean(activeTurnId),
    };
  }, [selectedMember, selectedMachineIndex, activeTurnId]);

  const fetchState = useCallback(async () => {
    const reqSeq = ++fetchSeqRef.current;
    try {
      const meta = presenceMetaRef.current;
      const qs = new URLSearchParams({
        _t: String(Date.now()),
        engine: 'Rapier3D',
        machine: String(meta.machineIndex),
        member: meta.member || '',
        playing: meta.playing ? '1' : '0',
      });
      const resp = await fetch(`/api/gacha/state?${qs.toString()}`, { cache: 'no-store' });
      const data = await resp.json();
      if (reqSeq !== fetchSeqRef.current) return;
      if (data.success) {
        if (typeof data.serverNow === 'number') {
          setServerClockOffset(data.serverNow - Date.now());
        }
        if (typeof data.activeUsersCount === 'number') {
          setActiveUsersCount(data.activeUsersCount);
        }
        if (data.machineOps && typeof data.machineOps.suspended === 'boolean') {
          setIsMachineSuspended(data.machineOps.suspended);
          setSuspendedMachines(
            Array.isArray(data.machineOps.suspendedMachines)
              ? data.machineOps.suspendedMachines
              : []
          );
        }
        if (Array.isArray(data.machines) && data.machines.length > 0) {
          setMachines(data.machines);
        } else if (data.machine) {
          setMachines([data.machine]);
        }
        setTicketsByMember(data.ticketsByMember || {});
        setRecentWins(data.recentWins || []);
        if (Array.isArray(data.recentLogs)) {
          if (
            typeof data.recentLogsMachineIndex !== 'number' ||
            data.recentLogsMachineIndex === presenceMetaRef.current.machineIndex
          ) {
            setRecentLogs(data.recentLogs);
            if (typeof data.totalLogCount === 'number') {
              setTotalLogCount(data.totalLogCount);
            }
          }
        }
        if (Array.isArray(data.allRecentLogs)) {
          setAllRecentLogs(data.allRecentLogs);
          if (typeof data.allTotalLogCount === 'number') {
            setAllTotalLogCount(data.allTotalLogCount);
          }
        }
        if (Array.isArray(data.gachaWinStats)) {
          setGachaWinStats(data.gachaWinStats);
        }
        if (data.usedWinsByMember) {
          setUsedWinsByMember(data.usedWinsByMember);
        }
        if (data.availableGachaSolByMember) {
          setAvailableGachaSolByMember(data.availableGachaSolByMember);
        }
        if (data.mealWinSummaryByMember) {
          setMealWinSummaryByMember(data.mealWinSummaryByMember);
        }
        setStateLoaded(true);
      }
    } catch (e) {
      console.warn('Failed to fetch gacha state:', e);
    }
  }, []);

  const fetchRecentLogsPage = useCallback(async (page: number, targetMachineIdx: number) => {
    const reqSeq = ++logsFetchSeqRef.current;
    setIsLoadingRecentLogs(true);
    try {
      const resp = await fetch(
        `/api/gacha/logs?machine=${targetMachineIdx}&page=${page}&limit=10&_t=${Date.now()}`,
        {
          cache: 'no-store',
        }
      );
      const data = await resp.json();
      if (reqSeq !== logsFetchSeqRef.current) return;
      if (data.success && Array.isArray(data.logs)) {
        setPagedRecentLogs(data.logs);
        if (typeof data.totalCount === 'number') {
          setTotalLogCount(data.totalCount);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch gacha logs page:', e);
    } finally {
      if (reqSeq === logsFetchSeqRef.current) {
        setIsLoadingRecentLogs(false);
      }
    }
  }, []);

  const fetchAllLogsPage = useCallback(async (page: number) => {
    const reqSeq = ++allLogsFetchSeqRef.current;
    setIsLoadingAllLogs(true);
    try {
      const resp = await fetch(`/api/gacha/logs?page=${page}&limit=10&_t=${Date.now()}`, {
        cache: 'no-store',
      });
      const data = await resp.json();
      if (reqSeq !== allLogsFetchSeqRef.current) return;
      if (data.success && Array.isArray(data.logs)) {
        setPagedAllLogs(data.logs);
        if (typeof data.totalCount === 'number') {
          setAllTotalLogCount(data.totalCount);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch all gacha logs page:', e);
    } finally {
      if (reqSeq === allLogsFetchSeqRef.current) {
        setIsLoadingAllLogs(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isAllLogsExpanded) return;
    if (allLogsPage === 1) {
      setPagedAllLogs(allRecentLogs);
    } else {
      fetchAllLogsPage(allLogsPage);
    }
  }, [isAllLogsExpanded, allLogsPage, allRecentLogs, fetchAllLogsPage]);

  useEffect(() => {
    if (!isRecentLogsExpanded) return;
    if (recentLogsPage === 1) {
      setPagedRecentLogs(recentLogs);
    } else {
      fetchRecentLogsPage(recentLogsPage, selectedMachineIndex);
    }
  }, [isRecentLogsExpanded, recentLogsPage, recentLogs, selectedMachineIndex, fetchRecentLogsPage]);

  const handleSelectMember = (name: string) => {
    setSelectedMember(name);
    localStorage.setItem('aial_gacha_member', name);
  };

  const selectedBalance = useMemo(() => {
    return (
      ticketsByMember[selectedMember] || {
        member: selectedMember,
        tickets: 0,
        totalEarned: 0,
        totalPlayed: 0,
        totalWins: 0,
        updatedAt: 0,
      }
    );
  }, [ticketsByMember, selectedMember]);

  const myAvailableGachaCount = useMemo(() => {
    const stat = gachaWinStats.find((s) => s.member === selectedMember);
    if (!stat) return 0;
    const used = usedWinsByMember[selectedMember] || 0;
    return Math.max(0, stat.totalWins - used);
  }, [gachaWinStats, usedWinsByMember, selectedMember]);

  const myAvailableGachaSol = useMemo(() => {
    if (typeof availableGachaSolByMember[selectedMember] === 'number') {
      return availableGachaSolByMember[selectedMember];
    }
    return Number((myAvailableGachaCount * 0.01).toFixed(4));
  }, [availableGachaSolByMember, selectedMember, myAvailableGachaCount]);

  const handleOpenGachaReward = (member: string, startApply = false) => {
    setIsLeaderboardOpen(false);
    setRewardInitialMember(member);
    setRewardStartApply(startApply);
    setIsRewardModalOpen(true);
  };

  const lockedByOther = useMemo(() => {
    if (!machine?.lock?.active) return null;
    if (activeTurnId && machine.lock.turnId === activeTurnId) return null;
    const approxServerNow = Date.now() + serverClockOffset;
    if (machine.lock.expiresAt && machine.lock.expiresAt < approxServerNow) return null;
    return machine.lock.member || '다른 멤버';
  }, [machine, activeTurnId, serverClockOffset]);

  const otherSessionProgress = useMemo(() => {
    if (!lockedByOther || !machine?.lock) return null;
    const total = Number(machine.lock.totalPlays) || 1;
    const current = Math.min(total, Math.max(1, Number(machine.lock.shotIndex) || 1));
    if (total <= 1) return null;
    return { current, total };
  }, [lockedByOther, machine]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    if (activeTurnId || isStarting || isFinishing) return;
    const intervalMs = lockedByOther ? 1000 : 2000;
    const timer = setInterval(() => {
      fetchState();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [activeTurnId, isStarting, isFinishing, lockedByOther, fetchState]);

  const handleSelectMachine = useCallback(
    (nextIdx: number) => {
      if (activeTurnId || isStarting || isFinishing) return;
      const wrapped = ((nextIdx % GACHA_MACHINE_COUNT) + GACHA_MACHINE_COUNT) % GACHA_MACHINE_COUNT;
      presenceMetaRef.current = { ...presenceMetaRef.current, machineIndex: wrapped };
      setSelectedMachineIndex(wrapped);
      setStatusMessage('');
      setRecentLogs([]);
      setPagedRecentLogs([]);
      setTotalLogCount(0);
      setRecentLogsPage(1);
      localStorage.setItem('aial_gacha_machine_idx', String(wrapped));
      fetchState();
    },
    [activeTurnId, isStarting, isFinishing, fetchState]
  );

  const handlePrevMachine = useCallback(() => {
    handleSelectMachine(selectedMachineIndex - 1);
  }, [handleSelectMachine, selectedMachineIndex]);

  const handleNextMachine = useCallback(() => {
    handleSelectMachine(selectedMachineIndex + 1);
  }, [handleSelectMachine, selectedMachineIndex]);

  const isSelectedMachineSuspended = useMemo(
    () => suspendedMachines.includes(selectedMachineIndex),
    [suspendedMachines, selectedMachineIndex]
  );

  const machineSummaries = useMemo(() => {
    const approxNow = Date.now() + serverClockOffset;
    const suspSet = new Set(suspendedMachines);
    return Array.from({ length: GACHA_MACHINE_COUNT }, (_, idx) => {
      const m = machines[idx];
      const suspended = suspSet.has(idx);
      const hasStock = suspended ? false : m ? (m.items?.length ?? 0) > 0 : true;
      const lockedBy =
        !suspended &&
        m?.lock?.active &&
        !(activeTurnId && m.lock.turnId === activeTurnId) &&
        (!m.lock.expiresAt || m.lock.expiresAt >= approxNow)
          ? m.lock.member || '다른 멤버'
          : null;
      return {
        index: idx,
        shortName: GACHA_SLOT_SHORT_LABELS[idx] || `${idx + 1}번`,
        hasStock,
        lockedBy,
        suspended,
      };
    });
  }, [machines, serverClockOffset, activeTurnId, suspendedMachines]);

  // 전 기기 또는 현재 기기 운영 중단 전환 시 진행 중인 로컬 턴 및 조작 모달 즉시 강제 종료
  useEffect(() => {
    if (!isMachineSuspended && !isSelectedMachineSuspended) return;
    setActiveTurnId(null);
    setActiveTurnKey(null);
    setPendingNextTurnKey(null);
    setSessionProgress(null);
    setIsStartModalOpen(false);
    setIsNickConfirmOpen(false);
    setIsSolExchangeModalOpen(false);
    setPendingMultiPlayCount(null);
  }, [isMachineSuspended, isSelectedMachineSuspended]);

  // 8초마다 하트비트 전송 (운영 중단 503 응답 시 즉시 턴 종료)
  useEffect(() => {
    if (!activeTurnId) return;
    const hb = setInterval(async () => {
      try {
        const resp = await fetch('/api/gacha/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            turnId: activeTurnId,
            member: selectedMember,
            machineIndex: selectedMachineIndex,
            engine: 'Rapier3D',
          }),
        });
        if (resp.status === 503) {
          setIsMachineSuspended(true);
          setActiveTurnId(null);
          setActiveTurnKey(null);
          setPendingNextTurnKey(null);
          setSessionProgress(null);
          fetchState();
        }
      } catch {}
    }, 8000);
    return () => clearInterval(hb);
  }, [activeTurnId, selectedMember, selectedMachineIndex, fetchState]);

  // 정기 자동 리셋(10:30, 14:00, 23:00 KST) 10초 전 카운트다운 브로드캐스트 & 5초 전 락다운
  useEffect(() => {
    let lastTriggeredResetTs = 0;
    const tick = () => {
      const approxNow = Date.now() + serverClockOffset;
      const next = getNextScheduledResetKst(approxNow);
      const diffMs = next.ts - approxNow;

      // 리셋 직후 2초간 락다운 유지하며 최신 상태 자동 동기화
      if (lastTriggeredResetTs > 0 && approxNow - lastTriggeredResetTs < 2200) {
        setResetCountdownSec(0);
        setIsResetLockdown(true);
        return;
      }

      if (diffMs > 0 && diffMs <= 10000) {
        const sec = Math.max(1, Math.min(10, Math.ceil(diffMs / 1000)));
        setResetCountdownSec(sec);
        setResetTargetLabel(next.label);
        setIsResetLockdown(diffMs <= 5000);
        if (diffMs <= 5000) {
          setIsStartModalOpen(false);
          setIsNickConfirmOpen(false);
          setPendingMultiPlayCount(null);
        }
        if (diffMs <= 350 && lastTriggeredResetTs !== next.ts) {
          lastTriggeredResetTs = next.ts;
          setTimeout(() => fetchState(), 600);
          setTimeout(() => fetchState(), 2300);
        }
      } else {
        setResetCountdownSec(null);
        setIsResetLockdown(false);
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [serverClockOffset, fetchState]);

  const hasConfirmedNickOnDevice = () => {
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      return Boolean(ua && localStorage.getItem(NICK_CONFIRMED_UA_KEY) === ua);
    } catch {
      return false;
    }
  };

  const openStartModalDirectly = () => {
    setStartPlayInput('1');
    setStartModalError('');
    setIsStartModalOpen(true);
  };

  const handleConfirmDeviceNick = () => {
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      if (ua) localStorage.setItem(NICK_CONFIRMED_UA_KEY, ua);
    } catch {}
    setIsNickConfirmOpen(false);
    openStartModalDirectly();
  };

  const handleOpenStartModal = () => {
    if (isStarting || isFinishing || activeTurnId || lockedByOther || isMachineSuspended || isResetLockdown) return;
    if (selectedBalance.tickets < 1) {
      setStatusMessage(`${selectedMember}님의 보유 뽑기권이 부족합니다.`);
      return;
    }
    if (!hasConfirmedNickOnDevice()) {
      setIsNickConfirmOpen(true);
      return;
    }
    openStartModalDirectly();
  };

  const handleStartTurn = async (requestedPlayCount: number, confirmedMultiWarning = false) => {
    if (isStarting || isFinishing || activeTurnId || lockedByOther || isMachineSuspended || isResetLockdown) return;
    const maxTickets = selectedBalance.tickets;
    if (!Number.isInteger(requestedPlayCount) || requestedPlayCount < 1) {
      setStartModalError('1 이상의 숫자를 입력해주세요.');
      return;
    }
    if (requestedPlayCount > maxTickets) {
      setStartModalError(`보유 뽑기권(${maxTickets}장)을 초과하여 입력할 수 없습니다.`);
      return;
    }

    if (requestedPlayCount >= 2 && !confirmedMultiWarning) {
      setPendingMultiPlayCount(requestedPlayCount);
      return;
    }

    setPendingMultiPlayCount(null);
    setStartModalError('');
    setStatusMessage('');
    try {
      setIsStarting(true);
      const resp = await fetch('/api/gacha/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member: selectedMember,
          playCount: requestedPlayCount,
          machineIndex: selectedMachineIndex,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        setStartModalError(data.message || '뽑기를 시작할 수 없습니다.');
        setStatusMessage(data.message || '뽑기를 시작할 수 없습니다.');
        await fetchState();
        return;
      }

      if (typeof data.serverNow === 'number') {
        setServerClockOffset(data.serverNow - Date.now());
      }
      setIsStartModalOpen(false);
      if (data.machine) updateMachineAt(selectedMachineIndex, data.machine);
      if (data.ticketsByMember) setTicketsByMember(data.ticketsByMember);
      const total = Number(data.totalPlays) || requestedPlayCount;
      const bonus = Number(data.bonusPlays) || 0;
      setSessionProgress({ current: 1, total, bonusPlays: bonus });
      setPendingNextTurnKey(null);
      setActiveTurnId(data.turnId);
      setActiveTurnKey(`${data.turnId}_s1`);
      if (bonus > 0) {
        setStatusMessage(
          `🔥 ${selectedMember}님 연속 ${requestedPlayCount}가챠 시작! (+${bonus}회 무료 보너스 → 총 ${total}회 연속 플레이)`
        );
      } else if (total > 1) {
        setStatusMessage(`🕹️ ${selectedMember}님 ${total}회 연속 뽑기를 시작합니다!`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '뽑기 시작 오류';
      setStartModalError(msg);
      setStatusMessage(msg);
    } finally {
      setIsStarting(false);
    }
  };

  const handleTurnFinish = useCallback(
    async (payload: TurnFinishPayload) => {
      const turnId = activeTurnId;
      if (!turnId) return;

      setIsFinishing(true);
      let keepSession = false;
      try {
        const resp = await fetch('/api/gacha/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            turnId,
            member: selectedMember,
            machineIndex: selectedMachineIndex,
            updatedItems: payload.updatedItems,
            wonItemIds: payload.wonItemIds,
            actionSummary: payload.actionSummary,
          }),
        });
        const data = await resp.json();
        if (data.success) {
          if (typeof data.serverNow === 'number') {
            setServerClockOffset(data.serverNow - Date.now());
          }
          if (data.machine) updateMachineAt(selectedMachineIndex, data.machine);
          if (data.ticketsByMember) setTicketsByMember(data.ticketsByMember);

          const hasWon = Array.isArray(data.wonRecords) && data.wonRecords.length > 0;
          if (hasWon) {
            setActiveWinModal(data.wonRecords[0]);
            setActiveWinRefundedTickets(Number(data.refundedTickets) || 0);
            const refundText =
              data.refundedTickets > 0
                ? ` (조기 당첨으로 미사용 뽑기권 ${data.refundedTickets}장 자동 반환)`
                : '';
            setStatusMessage(
              `🎉 축하합니다! ${selectedMember}님이 ${data.wonRecords.map((w: GachaWinRecord) => w.boxLabel).join(', ')}을 뽑았습니다!${refundText}`
            );
          }

          if (data.sessionContinue && data.nextShotIndex > 0) {
            keepSession = true;
            const nextKey = `${turnId}_s${data.nextShotIndex}`;
            const total = Number(data.totalPlays) || 1;
            const bonus = Number(data.bonusPlays) || 0;
            setSessionProgress({
              current: data.nextShotIndex,
              total,
              bonusPlays: bonus,
            });
            if (!hasWon) {
              setStatusMessage(
                `🔥 연속 뽑기 ${data.nextShotIndex}/${total}회차 진행 중!${
                  bonus > 0 && data.nextShotIndex > total - bonus ? ' (🎁 보너스 무료 회차!)' : ''
                }`
              );
              setActiveTurnKey(nextKey);
            } else {
              setPendingNextTurnKey(nextKey);
            }
          } else {
            if (!hasWon) {
              setStatusMessage('상자가 이동되어 모든 플레이어에게 반영되었습니다!');
            }
            await fetchState();
          }
        } else {
          setStatusMessage(data.message || '결과 반영 실패');
          await fetchState();
        }
      } catch {
        setStatusMessage('결과 저장 중 오류가 발생했습니다.');
        await fetchState();
      } finally {
        if (!keepSession) {
          setActiveTurnId(null);
          setActiveTurnKey(null);
          setPendingNextTurnKey(null);
          setSessionProgress(null);
        }
        setIsFinishing(false);
      }
    },
    [activeTurnId, selectedMember, selectedMachineIndex, fetchState, updateMachineAt]
  );

  const handleAdminRefill = async () => {
    const curCount = machine?.items?.length ?? 0;
    const fullCount = getMachineFullItemCount(selectedMachineIndex);
    const label = getMachineLabel(selectedMachineIndex);
    if (curCount >= fullCount) {
      setStatusMessage(`[${selectedMachineIndex + 1}번 뽑기판] ${label}은(는) 이미 상품이 채워져 있습니다.`);
      return;
    }
    if (!confirm(`[${selectedMachineIndex + 1}번 뽑기판] ${label}을(를) 새로 리필하시겠습니까?`)) return;
    try {
      setIsRefilling(true);
      const { adminId, adminPw } = getAdminCreds();
      const resp = await fetch('/api/gacha/refill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-id': adminId,
          'x-admin-pw': adminPw,
        },
        body: JSON.stringify({
          adminId,
          adminPw,
          machineIndex: selectedMachineIndex,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        if (Array.isArray(data.machines)) setMachines(data.machines);
        else if (data.machine) updateMachineAt(selectedMachineIndex, data.machine);
        setStatusMessage(data.message || '📦 현재 뽑기판이 새로 리필되었습니다!');
      } else {
        setStatusMessage(data.message || '리필 실패');
      }
    } finally {
      setIsRefilling(false);
    }
  };

  const handleAdminReset = async () => {
    const currentCount = machine?.items?.length || 0;
    if (currentCount === 0) {
      setStatusMessage('현재 뽑기판에 남은 상품이 없습니다. [뽑기판 리필] 버튼을 눌러주세요.');
      return;
    }
    if (
      !confirm(
        `[${selectedMachineIndex + 1}번 뽑기판] ${getMachineLabel(selectedMachineIndex)}을(를) 중앙 정위치로 재정렬하시겠습니까?`
      )
    )
      return;
    try {
      setIsResetting(true);
      const { adminId, adminPw } = getAdminCreds();
      const resp = await fetch('/api/gacha/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-id': adminId,
          'x-admin-pw': adminPw,
        },
        body: JSON.stringify({
          adminId,
          adminPw,
          machineIndex: selectedMachineIndex,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        if (Array.isArray(data.machines)) setMachines(data.machines);
        else if (data.machine) updateMachineAt(selectedMachineIndex, data.machine);
        setActiveTurnId(null);
        setStatusMessage(data.message || '🔄 현재 뽑기판 상품을 중앙 정위치로 재정렬했습니다.');
      } else {
        setStatusMessage(data.message || '재정렬 실패');
      }
    } finally {
      setIsResetting(false);
    }
  };

  const handleExchangeWinForTickets = async () => {
    if (isExchangingWin || activeTurnId || isMachineSuspended) return;
    const summary = mealWinSummaryByMember[selectedMember];
    const actualWins = summary?.actualWins ?? 0;
    const exchangedWins = summary?.exchangedWins ?? 0;
    const availableMealWins = summary?.availableMealWins ?? 0;
    const availAfter = availableMealWins - 1;

    if (availableMealWins < 1) {
      setStatusMessage(
        `${selectedMember}님의 신청 가능 리워드 WIN은 ${availableMealWins}WIN으로 뽑기권 교환이 불가능합니다. (1WIN 이상 필요)`
      );
      return;
    }

    const ok = confirm(
      `[${selectedMember}] 식사배틀 신청 가능 리워드 승점 1WIN을 소모하여 뽑기권 5장으로 교환하시겠습니까?\n\n` +
        `• 식사배틀 총 승수(${actualWins}WIN) 표시는 그대로 유지됩니다.\n` +
        `• 신청 가능 리워드 WIN이 ${availableMealWins}WIN → ${availAfter}WIN으로 1 차감됩니다. (뽑기권과 승수 교환 ${exchangedWins + 1}회 차감)`
    );
    if (!ok) return;

    try {
      setIsExchangingWin(true);
      const resp = await fetch('/api/gacha/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member: selectedMember }),
      });
      const data = await resp.json();
      if (data.success) {
        if (data.ticketsByMember) setTicketsByMember(data.ticketsByMember);
        setStatusMessage(data.message);
        await fetchState();
      } else {
        setStatusMessage(data.message || '승점 교환 실패');
      }
    } catch {
      setStatusMessage('승점 교환 중 오류가 발생했습니다.');
    } finally {
      setIsExchangingWin(false);
    }
  };

  const maxSolExchangeTickets = useMemo(() => {
    return Math.max(0, Math.floor(Math.round(myAvailableGachaSol * 10000) / 10));
  }, [myAvailableGachaSol]);

  const handleOpenSolExchangeModal = () => {
    if (isExchangingSol || activeTurnId || isMachineSuspended) return;
    if (maxSolExchangeTickets < 1) {
      setStatusMessage(
        `${selectedMember}님의 신청 가능 뽑기 리워드(${myAvailableGachaSol} SOL)가 부족합니다. (0.001 SOL당 뽑기권 1장)`
      );
      return;
    }
    setSolExchangeInput(String(Math.min(maxSolExchangeTickets, 1)));
    setSolExchangeError('');
    setIsSolExchangeModalOpen(true);
  };

  const handleConfirmSolExchange = async (ticketCount: number) => {
    if (isExchangingSol || activeTurnId || isMachineSuspended) return;
    if (!Number.isInteger(ticketCount) || ticketCount < 1) {
      setSolExchangeError('1 이상의 숫자를 입력해주세요.');
      return;
    }
    if (ticketCount > maxSolExchangeTickets) {
      setSolExchangeError(`최대 ${maxSolExchangeTickets}장까지만 교환 가능합니다.`);
      return;
    }

    try {
      setIsExchangingSol(true);
      setSolExchangeError('');
      const resp = await fetch('/api/gacha/exchange-sol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member: selectedMember, ticketCount }),
      });
      const data = await resp.json();
      if (data.success) {
        if (data.ticketsByMember) setTicketsByMember(data.ticketsByMember);
        setIsSolExchangeModalOpen(false);
        setStatusMessage(data.message);
        await fetchState();
      } else {
        setSolExchangeError(data.message || '뽑기 리워드 교환 실패');
      }
    } catch {
      setSolExchangeError('뽑기 리워드 교환 중 오류가 발생했습니다.');
    } finally {
      setIsExchangingSol(false);
    }
  };

  const handleAdminGrantTicket = async (amount: number) => {
    try {
      setIsGranting(true);
      const { adminId, adminPw } = getAdminCreds();
      const resp = await fetch('/api/gacha/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-id': adminId,
          'x-admin-pw': adminPw,
        },
        body: JSON.stringify({ member: selectedMember, amount, adminId, adminPw }),
      });
      const data = await resp.json();
      if (data.success) {
        if (data.ticketsByMember) setTicketsByMember(data.ticketsByMember);
        setStatusMessage(data.message);
      } else {
        setStatusMessage(data.message || '티켓 지급 실패');
      }
    } finally {
      setIsGranting(false);
    }
  };

  // 전역 모달/확인창 단축키: Enter = 확인, Escape = 취소/닫기
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      const inTextarea = Boolean(target && target.tagName === 'TEXTAREA');

      // 1) 연속 다중 뽑기 경고 확인창 (최상단)
      if (pendingMultiPlayCount !== null) {
        e.preventDefault();
        if (e.key === 'Escape') {
          if (!isStarting) setPendingMultiPlayCount(null);
        } else if (e.key === 'Enter' && !isStarting) {
          handleStartTurn(pendingMultiPlayCount, true);
        }
        return;
      }

      // 2) 기기 최초 1회 유저(닉) 확인 팝업
      if (isNickConfirmOpen && !isMachineSuspended) {
        e.preventDefault();
        if (e.key === 'Escape') setIsNickConfirmOpen(false);
        else if (e.key === 'Enter') handleConfirmDeviceNick();
        return;
      }

      // 3) 뽑기 시작 횟수 선택 모달
      if (isStartModalOpen && !isMachineSuspended) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (!isStarting) setIsStartModalOpen(false);
        } else if (e.key === 'Enter' && !inTextarea && !isStarting) {
          const parsed = parseInt(startPlayInput, 10);
          const maxTickets = selectedBalance.tickets;
          if (!isNaN(parsed) && parsed >= 1 && parsed <= maxTickets) {
            e.preventDefault();
            handleStartTurn(parsed);
          }
        }
        return;
      }

      // 4) SOL -> 뽑기권 교환 모달
      if (isSolExchangeModalOpen && !isMachineSuspended) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (!isExchangingSol) setIsSolExchangeModalOpen(false);
        } else if (e.key === 'Enter' && !inTextarea && !isExchangingSol) {
          const parsed = parseInt(solExchangeInput, 10);
          if (!isNaN(parsed) && parsed >= 1 && parsed <= maxSolExchangeTickets) {
            e.preventDefault();
            handleConfirmSolExchange(parsed);
          }
        }
        return;
      }

      // 5) 당첨 축하 모달
      if (activeWinModal) {
        if (e.key === 'Escape' || (e.key === 'Enter' && !inTextarea)) {
          e.preventDefault();
          setActiveWinModal(null);
          setActiveWinRefundedTickets(0);
          if (pendingNextTurnKey) {
            setActiveTurnKey(pendingNextTurnKey);
            setPendingNextTurnKey(null);
          }
        }
        return;
      }

      // 6) 기타 정보/관리자 모달 (Esc 닫기 · 공지는 Enter로도 확인 닫기)
      if (e.key === 'Escape') {
        if (isAdminLoginOpen) { e.preventDefault(); setIsAdminLoginOpen(false); return; }
        if (isPresenceOpen) { e.preventDefault(); setIsPresenceOpen(false); return; }
        if (isUfoNoticeOpen) { e.preventDefault(); setIsUfoNoticeOpen(false); return; }
        if (isPrizeInfoOpen) { e.preventDefault(); setIsPrizeInfoOpen(false); return; }
        if (isRewardModalOpen) { e.preventDefault(); setIsRewardModalOpen(false); setRewardStartApply(false); return; }
        if (isLeaderboardOpen) { e.preventDefault(); setIsLeaderboardOpen(false); return; }
      } else if (e.key === 'Enter' && !inTextarea) {
        if (isUfoNoticeOpen) { e.preventDefault(); setIsUfoNoticeOpen(false); return; }
        if (isPrizeInfoOpen) { e.preventDefault(); setIsPrizeInfoOpen(false); return; }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        <Loader2 className="w-7 h-7 animate-spin text-amber-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* 상단 내비게이션 헤더 */}
      <header className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <a
              href={WINNER_SITE_URL}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white text-xs font-bold transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>식사 배틀로 복귀</span>
            </a>
            <div>
              <h1 className="text-sm sm:text-lg font-black text-white flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>UFO 브릿지 뽑기 (Rapier3D · SOL 리워드)</span>
              </h1>
              <p className="text-[10px] sm:text-xs text-slate-400">
                12인 공유 릴레이 크레인 · Rapier3D Rust WASM 120Hz 실제 물리 · 통과 시{' '}
                <strong className="text-amber-300">0.003 ~ 0.01 SOL</strong> 당첨!
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setIsLeaderboardOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 border border-amber-400/50 text-amber-300 hover:text-amber-200 text-xs font-black transition-all shadow-sm cursor-pointer"
              title="UFO 뽑기 명예의 전당 및 리워드(SOL) 신청"
            >
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>명예의 전당</span>
            </button>

            <button
              type="button"
              onClick={() => setIsUfoNoticeOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/50 text-cyan-300 hover:text-cyan-200 text-xs font-black transition-all shadow-sm cursor-pointer"
              title="UFO 뽑기 공지사항 보기"
            >
              <Megaphone className="w-3.5 h-3.5 text-cyan-400" />
              <span>UFO 공지</span>
            </button>

            <button
              type="button"
              onClick={() => setIsPrizeInfoOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/50 text-violet-300 hover:text-violet-200 text-xs font-black transition-all shadow-sm cursor-pointer"
              title="현재 뽑기판 상자 및 3D 인형 전체 스펙 보기"
            >
              <Info className="w-3.5 h-3.5 text-violet-400" />
              <span>뽑기정보</span>
            </button>

            {isAdmin ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsPresenceOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/50 text-emerald-200 text-xs font-black cursor-pointer transition-colors"
                  title="실시간 IP별 동접 현황 보기"
                >
                  <Radio className="w-3.5 h-3.5 text-emerald-300 animate-pulse" />
                  <span>동접 {activeUsersCount}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleAdminGrantTicket(1)}
                  disabled={isGranting}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{selectedMember} 티켓 +1</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleAdminGrantTicket(-1)}
                  disabled={isGranting || selectedBalance.tickets <= 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-xs font-bold cursor-pointer disabled:opacity-40"
                >
                  <Minus className="w-3.5 h-3.5" />
                  <span>티켓 -1</span>
                </button>

                <button
                  type="button"
                  onClick={handleAdminLogout}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-rose-500/20 border border-emerald-500/40 hover:border-rose-400/50 text-emerald-300 hover:text-rose-300 text-[11px] font-bold cursor-pointer transition-colors"
                  title="관리자 로그아웃"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">관리자</span>
                  <LogOut className="w-3 h-3" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsAdminLoginOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 hover:text-amber-300 text-xs font-bold cursor-pointer transition-colors"
                title="관리자 로그인"
              >
                <Lock className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">관리자</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 메인 게임 영역 */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5">
        {!stateLoaded ? (
          <section className="p-10 rounded-3xl bg-slate-900/90 border border-slate-800 text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-amber-400 mx-auto" />
            <p className="text-sm font-bold text-slate-300">뽑기판 운영 상태를 확인하고 있습니다...</p>
          </section>
        ) : isMachineSuspended ? (
          /* 전 기기 운영 중단 시 3D 머신·교환·시작 UI 자체를 DOM에서 완전히 언마운트하여 F12 우회 원천 차단 */
          <section className="p-6 sm:p-10 rounded-3xl bg-gradient-to-b from-slate-900 via-slate-900/95 to-slate-950 border border-amber-500/60 shadow-2xl text-center space-y-5">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-3xl">
              🛠️
            </div>
            <div className="space-y-2 max-w-md mx-auto">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-300 text-xs font-black">
                전 기기 운영 중단 · 점검중
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white">
                현재 전체 뽑기판 점검중입니다
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed break-keep">
                관리자에 의해 모든 뽑기 기기 운영이 일시 중단되었습니다.
                <br />
                점검 중에는 게임 실행·뽑기권 교환이 서버와 화면 모두에서 완전히 차단되며,
                운영이 재개되면 별도 새로고침 없이 자동으로 복구됩니다.
              </p>
            </div>
            <div className="pt-1 flex items-center justify-center gap-2.5 flex-wrap">
              <a
                href={WINNER_SITE_URL}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition-colors"
              >
                식사 배틀로 복귀
              </a>
              <button
                type="button"
                onClick={fetchState}
                className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black cursor-pointer transition-colors"
              >
                상태 새로고침
              </button>
            </div>
          </section>
        ) : (
          <>
        {/* 미수령 당첨 리워드 신청 가능 알림 */}
        {myAvailableGachaSol > 0 && (
          <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-rose-500/20 border border-amber-400/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-2.5">
              <Gift className="w-5 h-5 text-amber-300 shrink-0 animate-bounce" />
              <div className="text-xs sm:text-sm">
                <strong className="text-white">{selectedMember}</strong>님이 리워드 신청 가능한 잔고가{' '}
                <strong className="text-amber-300 font-mono">{myAvailableGachaSol} SOL</strong> 있습니다!{' '}
                <span className="text-[11px] text-slate-300">
                  (업비트 입금 시 0.02 SOL 이상 모아서 신청 권장)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {maxSolExchangeTickets >= 1 && (
                <button
                  type="button"
                  disabled={isExchangingSol || !!activeTurnId}
                  onClick={handleOpenSolExchangeModal}
                  className="px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/60 text-emerald-200 font-black text-xs shrink-0 cursor-pointer disabled:opacity-40"
                >
                  🎟️ 뽑기권 교환 (최대 {maxSolExchangeTickets}장)
                </button>
              )}
              <button
                type="button"
                onClick={() => handleOpenGachaReward(selectedMember, false)}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shrink-0 cursor-pointer"
              >
                🎁 리워드 신청하기
              </button>
            </div>
          </div>
        )}

        {/* 1. 플레이어 선택 및 보유 티켓 바 (12인 공유) */}
        <section className="p-3.5 sm:p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Ticket className="w-4 h-4 text-amber-400" />
              <span className="text-xs sm:text-sm font-black text-white">플레이어 선택 & 보유 뽑기권</span>
              <span className="text-[11px] text-slate-400 hidden sm:inline">
                (식사 사진 등록 시 승패 무관하게 뽑기권 5회 자동 적립)
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleOpenSolExchangeModal}
                disabled={isExchangingSol || !!activeTurnId || maxSolExchangeTickets < 1}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/50 text-emerald-200 text-[11px] font-black transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isExchangingSol ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Coins className="w-3 h-3 text-emerald-300" />
                )}
                <span>리워드 0.001 SOL → 1뽑기권 교환 (보유 {myAvailableGachaSol} SOL)</span>
              </button>
              <button
                type="button"
                onClick={handleExchangeWinForTickets}
                disabled={
                  isExchangingWin ||
                  !!activeTurnId ||
                  (mealWinSummaryByMember[selectedMember]?.availableMealWins ?? 0) < 1
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/50 text-purple-200 text-[11px] font-black transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isExchangingWin ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <ArrowRightLeft className="w-3 h-3 text-purple-300" />
                )}
                <span>
                  승점 1WIN → 뽑기권 5회 교환
                  {mealWinSummaryByMember[selectedMember]
                    ? ` (신청가능 ${mealWinSummaryByMember[selectedMember].availableMealWins}WIN)`
                    : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={fetchState}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-300 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>동기화</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {MEMBERS.map((m) => {
              const bal = ticketsByMember[m.name]?.tickets ?? 0;
              const isSelected = selectedMember === m.name;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={!!activeTurnId}
                  onClick={() => handleSelectMember(m.name)}
                  className={`p-2 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-60 ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-md scale-[1.02]'
                      : `${m.avatarBg} ${m.borderColor} hover:border-slate-500`
                  }`}
                >
                  <div className="text-xs font-black truncate">{m.name}</div>
                  <div
                    className={`text-[10px] font-mono mt-0.5 ${
                      isSelected ? 'text-slate-900 font-bold' : 'text-slate-300'
                    }`}
                  >
                    🎟️ {bal}장
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 전체 뽑기판 통합 최근 상황 로그 (평소 접기 1건 · 펼치기 시 10건/페이지 페이지네이션) */}
        {(() => {
          const LOGS_PAGE_SIZE = 10;
          const latestAllLog = allRecentLogs[0] || null;
          const collapsedMessage = latestAllLog?.message || '';
          const collapsedTs = latestAllLog?.createdAt || null;

          if (!collapsedMessage && allRecentLogs.length === 0) return null;

          const effectiveTotal = Math.max(allTotalLogCount, allRecentLogs.length);
          const totalPages = Math.max(1, Math.ceil(effectiveTotal / LOGS_PAGE_SIZE));
          const safePage = Math.min(Math.max(1, allLogsPage), totalPages);
          const displayed = safePage === 1 ? allRecentLogs.slice(0, LOGS_PAGE_SIZE) : pagedAllLogs;
          const startIdx = (safePage - 1) * LOGS_PAGE_SIZE;

          const getPages = (): Array<number | 'ellipsis'> => {
            if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
            const pages: Array<number | 'ellipsis'> = [1];
            const ws = Math.max(2, safePage - 1);
            const we = Math.min(totalPages - 1, safePage + 1);
            if (ws > 2) pages.push('ellipsis');
            for (let p = ws; p <= we; p++) pages.push(p);
            if (we < totalPages - 1) pages.push('ellipsis');
            pages.push(totalPages);
            return pages;
          };

          const collapsedTimeText = formatKstShortDateTime(collapsedTs);

          return (
            <div className="rounded-xl bg-slate-900/90 border border-amber-500/30 text-xs text-slate-300 overflow-hidden">
              {!isAllLogsExpanded ? (
                <div className="px-3 sm:px-4 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-3">
                  <div className="min-w-0 w-full sm:flex-1 leading-relaxed break-words">
                    🌐 <strong className="text-amber-300 whitespace-nowrap">전체 최근 상황:</strong>{' '}
                    <span>{collapsedMessage}</span>
                  </div>
                  <div className="flex items-center justify-end gap-2 shrink-0">
                    {collapsedTimeText ? (
                      <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap">
                        {collapsedTimeText}
                      </span>
                    ) : null}
                    {effectiveTotal > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsAllLogsExpanded(true);
                          setAllLogsPage(1);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-amber-500/40 text-amber-300 hover:text-amber-200 text-[10px] font-bold cursor-pointer transition-colors whitespace-nowrap"
                      >
                        <span>펼치기 ({effectiveTotal})</span>
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3 sm:p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-amber-300">🌐 전체 뽑기판 최근 상황 로그</span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[10px] font-mono font-bold">
                        총 {effectiveTotal}건
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAllLogsExpanded(false);
                        setAllLogsPage(1);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-bold cursor-pointer transition-colors"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>접기</span>
                    </button>
                  </div>

                  {isLoadingAllLogs ? (
                    <div className="py-6 flex items-center justify-center gap-2 text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                      <span>전체 로그를 불러오는 중...</span>
                    </div>
                  ) : displayed.length === 0 ? (
                    <p className="py-3 text-center text-slate-500">기록된 로그가 없습니다.</p>
                  ) : (
                    <div className="divide-y divide-slate-800/80 rounded-lg bg-slate-950/70 border border-slate-800/80">
                      {displayed.map((log, idx) => {
                        const rowTime = formatKstShortDateTime(log.createdAt);
                        return (
                          <div
                            key={log.id || `all-${safePage}-${idx}`}
                            className="px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3"
                          >
                            <span className="min-w-0 w-full sm:flex-1 text-slate-200 leading-snug break-words">
                              {log.message}
                            </span>
                            {rowTime ? (
                              <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap shrink-0 self-end sm:self-center">
                                {rowTime}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="pt-1 flex flex-col sm:flex-row items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-400 font-mono">
                      {effectiveTotal > 0
                        ? `${startIdx + 1}–${Math.min(startIdx + LOGS_PAGE_SIZE, effectiveTotal)} / 총 ${effectiveTotal}건 (${safePage}/${totalPages} 페이지)`
                        : '0건'}
                    </span>
                    {totalPages > 1 && (
                      <div className="flex items-center gap-1 flex-wrap justify-center">
                        <button
                          type="button"
                          disabled={safePage <= 1 || isLoadingAllLogs}
                          onClick={() => setAllLogsPage(Math.max(1, safePage - 1))}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-35 cursor-pointer"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        {getPages().map((item, idx) =>
                          item === 'ellipsis' ? (
                            <span key={`all-log-ellipsis-${idx}`} className="px-1 text-xs text-slate-500">
                              …
                            </span>
                          ) : (
                            <button
                              key={`all-log-page-${item}`}
                              type="button"
                              disabled={isLoadingAllLogs}
                              onClick={() => setAllLogsPage(item)}
                              className={`min-w-[28px] h-7 px-1.5 rounded-lg border text-[11px] font-mono font-black transition-all cursor-pointer ${
                                item === safePage
                                  ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-sm'
                                  : 'bg-slate-950/80 hover:bg-slate-800 border-slate-800 text-slate-300 hover:text-white'
                              }`}
                            >
                              {item}
                            </button>
                          )
                        )}
                        <button
                          type="button"
                          disabled={safePage >= totalPages || isLoadingAllLogs}
                          onClick={() => setAllLogsPage(Math.min(totalPages, safePage + 1))}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-35 cursor-pointer"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* 실시간 상태 알림 (평소 접기 1건 · 펼치기 시 10건/페이지 페이지네이션) */}
        {(() => {
          const LOGS_PAGE_SIZE = 10;
          const latestServerLog = recentLogs[0] || null;
          const useLocalStatus =
            Boolean(statusMessage) &&
            (!latestServerLog || (statusMessageAt || 0) >= (latestServerLog.createdAt || 0));
          const collapsedMessage = useLocalStatus
            ? statusMessage
            : latestServerLog?.message || '';
          const collapsedTs = useLocalStatus
            ? statusMessageAt
            : latestServerLog?.createdAt || null;

          if (!collapsedMessage && recentLogs.length === 0) return null;

          const effectiveTotalLogs = Math.max(totalLogCount, recentLogs.length);
          const totalLogPages = Math.max(1, Math.ceil(effectiveTotalLogs / LOGS_PAGE_SIZE));
          const safeLogPage = Math.min(Math.max(1, recentLogsPage), totalLogPages);
          const displayedLogs =
            safeLogPage === 1 ? recentLogs.slice(0, LOGS_PAGE_SIZE) : pagedRecentLogs;
          const logStartIdx = (safeLogPage - 1) * LOGS_PAGE_SIZE;

          const getLogPageNumbers = (): Array<number | 'ellipsis'> => {
            if (totalLogPages <= 5) {
              return Array.from({ length: totalLogPages }, (_, i) => i + 1);
            }
            const pages: Array<number | 'ellipsis'> = [1];
            const windowStart = Math.max(2, safeLogPage - 1);
            const windowEnd = Math.min(totalLogPages - 1, safeLogPage + 1);
            if (windowStart > 2) pages.push('ellipsis');
            for (let p = windowStart; p <= windowEnd; p++) pages.push(p);
            if (windowEnd < totalLogPages - 1) pages.push('ellipsis');
            pages.push(totalLogPages);
            return pages;
          };

          const collapsedTimeText = formatKstShortDateTime(collapsedTs);

          return (
            <div className="rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 overflow-hidden">
              {!isRecentLogsExpanded ? (
                <div className="px-3 sm:px-4 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-3">
                  <div className="min-w-0 w-full sm:flex-1 leading-relaxed break-words">
                    📢 <strong className="text-cyan-300 whitespace-nowrap">최근 상황 ({GACHA_SLOT_SHORT_LABELS[selectedMachineIndex]}):</strong>{' '}
                    <span>{collapsedMessage}</span>
                  </div>
                  <div className="flex items-center justify-end gap-2 shrink-0">
                    {collapsedTimeText ? (
                      <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap">
                        {collapsedTimeText}
                      </span>
                    ) : null}
                    {effectiveTotalLogs > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsRecentLogsExpanded(true);
                          setRecentLogsPage(1);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 hover:text-cyan-200 text-[10px] font-bold cursor-pointer transition-colors whitespace-nowrap"
                      >
                        <span>펼치기 ({effectiveTotalLogs})</span>
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3 sm:p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-cyan-300">📢 최근 상황 로그 ({GACHA_SLOT_SHORT_LABELS[selectedMachineIndex]})</span>
                      <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-200 text-[10px] font-mono font-bold">
                        총 {effectiveTotalLogs}건
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsRecentLogsExpanded(false);
                        setRecentLogsPage(1);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-bold cursor-pointer transition-colors"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>접기</span>
                    </button>
                  </div>

                  {isLoadingRecentLogs ? (
                    <div className="py-6 flex items-center justify-center gap-2 text-slate-400">
                      <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                      <span>로그를 불러오는 중...</span>
                    </div>
                  ) : displayedLogs.length === 0 ? (
                    <p className="py-3 text-center text-slate-500">기록된 로그가 없습니다.</p>
                  ) : (
                    <div className="divide-y divide-slate-800/80 rounded-lg bg-slate-950/70 border border-slate-800/80">
                      {displayedLogs.map((log, idx) => {
                        const rowTime = formatKstShortDateTime(log.createdAt);
                        return (
                          <div
                            key={log.id || `${safeLogPage}-${idx}`}
                            className="px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3"
                          >
                            <span className="min-w-0 w-full sm:flex-1 text-slate-200 leading-snug break-words">
                              {log.message}
                            </span>
                            {rowTime ? (
                              <span className="text-[10px] text-slate-400 font-mono whitespace-nowrap shrink-0 self-end sm:self-center">
                                {rowTime}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="pt-1 flex flex-col sm:flex-row items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-400 font-mono">
                      {effectiveTotalLogs > 0
                        ? `${logStartIdx + 1}–${Math.min(logStartIdx + LOGS_PAGE_SIZE, effectiveTotalLogs)} / 총 ${effectiveTotalLogs}건 (${safeLogPage}/${totalLogPages} 페이지)`
                        : '0건'}
                    </span>
                    {totalLogPages > 1 && (
                      <div className="flex items-center gap-1 flex-wrap justify-center">
                        <button
                          type="button"
                          disabled={safeLogPage <= 1 || isLoadingRecentLogs}
                          onClick={() => setRecentLogsPage(Math.max(1, safeLogPage - 1))}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-35 cursor-pointer"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>

                        {getLogPageNumbers().map((item, idx) =>
                          item === 'ellipsis' ? (
                            <span key={`log-ellipsis-${idx}`} className="px-1 text-xs text-slate-500">
                              …
                            </span>
                          ) : (
                            <button
                              key={`log-page-${item}`}
                              type="button"
                              disabled={isLoadingRecentLogs}
                              onClick={() => setRecentLogsPage(item)}
                              className={`min-w-[28px] h-7 px-1.5 rounded-lg border text-[11px] font-mono font-black transition-all cursor-pointer ${
                                item === safeLogPage
                                  ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-sm'
                                  : 'bg-slate-950/80 hover:bg-slate-800 border-slate-800 text-slate-300 hover:text-white'
                              }`}
                            >
                              {item}
                            </button>
                          )
                        )}

                        <button
                          type="button"
                          disabled={safeLogPage >= totalLogPages || isLoadingRecentLogs}
                          onClick={() => setRecentLogsPage(Math.min(totalLogPages, safeLogPage + 1))}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-35 cursor-pointer"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* 2. Rapier3D 3D UFO 크레인 머신 */}
        <RapierUfoMachine3D
          items={machine?.items || []}
          tuning={getDefaultTuningForMachine(selectedMachineIndex)}
          isMyTurn={Boolean(activeTurnId) && !isFinishing && !pendingNextTurnKey}
          lockedByOther={lockedByOther}
          turnKey={activeTurnKey}
          onTurnFinish={handleTurnFinish}
          onStartTurnRequest={handleOpenStartModal}
          canStartTurn={selectedBalance.tickets >= 1 && !activeTurnId && !isFinishing && !lockedByOther && !isMachineSuspended && !isSelectedMachineSuspended && !isResetLockdown}
          isMachineSuspended={isSelectedMachineSuspended}
          selectedMember={selectedMember}
          selectedMemberTickets={selectedBalance.tickets}
          isStarting={isStarting}
          isFinishing={isFinishing}
          sessionProgress={sessionProgress}
          otherSessionProgress={otherSessionProgress}
          machineIndex={selectedMachineIndex}
          machineCount={GACHA_MACHINE_COUNT}
          machineLabel={GACHA_SLOT_LABELS[selectedMachineIndex] || getMachineLabel(selectedMachineIndex)}
          machineDifficulty={GACHA_SLOT_DIFFICULTY_TEXT[selectedMachineIndex] || '난이도 6.5'}
          machineRewardSol={getBoxRewardAmount(selectedMachineIndex)}
          onPrevMachine={handlePrevMachine}
          onNextMachine={handleNextMachine}
          onSelectMachine={handleSelectMachine}
          machineSummaries={machineSummaries}
          isAdmin={isAdmin}
          onAdminRefill={handleAdminRefill}
          onAdminReset={handleAdminReset}
          isRefilling={isRefilling}
          isResetting={isResetting}
        />
          </>
        )}

        {/* 3. 최근 UFO 뽑기 당첨 현황 (기본 4건 -> 더 보기 시 10건/페이지) */}
        {(() => {
          const RECENT_PREVIEW_COUNT = 4;
          const RECENT_PAGE_SIZE = 10;
          const totalRecentCount = recentWins.length;
          const totalPages = Math.max(1, Math.ceil(totalRecentCount / RECENT_PAGE_SIZE));
          const safePage = Math.min(Math.max(1, recentWinsPage), totalPages);
          const startIdx = (safePage - 1) * RECENT_PAGE_SIZE;
          const displayedRecentWins = showAllRecentWins
            ? recentWins.slice(startIdx, startIdx + RECENT_PAGE_SIZE)
            : recentWins.slice(0, RECENT_PREVIEW_COUNT);

          const getPageNumbers = (): Array<number | 'ellipsis'> => {
            if (totalPages <= 7) {
              return Array.from({ length: totalPages }, (_, i) => i + 1);
            }
            const pages: Array<number | 'ellipsis'> = [1];
            const windowStart = Math.max(2, safePage - 1);
            const windowEnd = Math.min(totalPages - 1, safePage + 1);
            if (windowStart > 2) pages.push('ellipsis');
            for (let p = windowStart; p <= windowEnd; p++) pages.push(p);
            if (windowEnd < totalPages - 1) pages.push('ellipsis');
            pages.push(totalPages);
            return pages;
          };

          return (
            <section className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-xs sm:text-sm font-black text-white flex items-center gap-1.5">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  <span>최근 UFO 뽑기 당첨 현황</span>
                  {totalRecentCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/35 text-amber-300 text-[10px] font-mono font-bold">
                      총 {totalRecentCount}건
                    </span>
                  )}
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-400">
                    상자별 당첨 리워드: 0.003 ~ 0.01 SOL
                  </span>
                  {showAllRecentWins && totalRecentCount > RECENT_PREVIEW_COUNT && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowAllRecentWins(false);
                        setRecentWinsPage(1);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-bold cursor-pointer transition-colors"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>접기</span>
                    </button>
                  )}
                </div>
              </div>

              {totalRecentCount === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  아직 뽑기에 성공한 멤버가 없습니다. 첫 번째 당첨의 주인공이 되어보세요!
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {displayedRecentWins.map((w) => (
                      <div
                        key={w.id}
                        className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-black text-white">{w.member}</span>
                            <span className="text-slate-300">· {w.boxLabel}</span>
                            {w.createdAt ? (
                              <span className="text-[10px] text-slate-400 font-mono">
                                ({formatKstDateTime(w.createdAt)})
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-amber-300 font-mono font-bold flex items-center gap-1">
                            <Coins className="w-3 h-3" />
                            <span>{w.rewardAmount} SOL</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenGachaReward(w.member, false)}
                          className="px-2.5 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/35 text-purple-300 font-bold text-[10px] shrink-0 cursor-pointer transition-colors"
                        >
                          리워드 현황
                        </button>
                      </div>
                    ))}
                  </div>

                  {!showAllRecentWins && totalRecentCount > RECENT_PREVIEW_COUNT && (
                    <div className="pt-1 flex justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          setShowAllRecentWins(true);
                          setRecentWinsPage(1);
                        }}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700 hover:border-cyan-500/50 text-slate-200 hover:text-cyan-200 text-xs font-black transition-all cursor-pointer"
                      >
                        <span>더 보기 (전체 {totalRecentCount}건 · 페이지당 {RECENT_PAGE_SIZE}건)</span>
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {showAllRecentWins && totalRecentCount > RECENT_PREVIEW_COUNT && (
                    <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-2.5">
                      <span className="text-[11px] text-slate-400 font-mono">
                        {startIdx + 1}–{Math.min(startIdx + RECENT_PAGE_SIZE, totalRecentCount)} / 총{' '}
                        {totalRecentCount}건 ({safePage}/{totalPages} 페이지)
                      </span>

                      {totalPages > 1 && (
                        <div className="flex items-center gap-1 flex-wrap justify-center">
                          <button
                            type="button"
                            disabled={safePage <= 1}
                            onClick={() => setRecentWinsPage(Math.max(1, safePage - 1))}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-35 cursor-pointer"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>

                          {getPageNumbers().map((item, idx) =>
                            item === 'ellipsis' ? (
                              <span key={`ellipsis-${idx}`} className="px-1.5 text-xs text-slate-500">
                                …
                              </span>
                            ) : (
                              <button
                                key={item}
                                type="button"
                                onClick={() => setRecentWinsPage(item)}
                                className={`min-w-[32px] h-8 px-2 rounded-lg border text-xs font-mono font-black transition-all cursor-pointer ${
                                  item === safePage
                                    ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-sm'
                                    : 'bg-slate-950/80 hover:bg-slate-800 border-slate-800 text-slate-300 hover:text-white'
                                }`}
                              >
                                {item}
                              </button>
                            )
                          )}

                          <button
                            type="button"
                            disabled={safePage >= totalPages}
                            onClick={() => setRecentWinsPage(Math.min(totalPages, safePage + 1))}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-35 cursor-pointer"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setShowAllRecentWins(false);
                          setRecentWinsPage(1);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-bold cursor-pointer"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                        <span>최근 4건만 보기</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          );
        })()}

        {/* 4. 실시간 뽑기방 채팅 · 건의함 (익명닉 + 12인 스티커) */}
        <GachaLiveChat />
      </main>

      {/* 정기 리셋 10초 전 카운트다운 브로드캐스트 팝업 */}
      {resetCountdownSec !== null && resetCountdownSec >= 1 && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[80] w-[calc(100%-24px)] max-w-md pointer-events-none">
          <div
            className={`px-5 py-3.5 rounded-2xl border shadow-2xl backdrop-blur-md text-center transition-all ${
              resetCountdownSec <= 5
                ? 'bg-rose-950/95 border-rose-400/80 text-rose-100 animate-pulse'
                : 'bg-amber-950/95 border-amber-400/80 text-amber-100'
            }`}
          >
            <div className="text-[11px] font-bold opacity-85 mb-0.5">
              ⏰ 정기 재정렬 · 리필 안내 ({resetTargetLabel} KST)
            </div>
            <div className="text-base sm:text-lg font-black tracking-tight">
              {resetCountdownSec}초 뒤에 뽑기가 리셋됩니다.
            </div>
          </div>
        </div>
      )}

      {/* 정기 리셋 5초 전 락다운 오버레이 */}
      {isResetLockdown && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-rose-500/60 w-full max-w-sm rounded-3xl p-6 shadow-2xl text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-500/20 border border-rose-400/50 flex items-center justify-center text-3xl font-black text-rose-300 font-mono">
              {resetCountdownSec && resetCountdownSec > 0 ? resetCountdownSec : '⏳'}
            </div>
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-400/40 text-rose-300 text-[11px] font-black">
                🔒 페이지 일시 잠금 (LOCKDOWN)
              </div>
              <h3 className="text-lg font-black text-white">
                {resetCountdownSec && resetCountdownSec > 0
                  ? `${resetCountdownSec}초 뒤에 뽑기가 리셋됩니다.`
                  : '뽑기판 리셋 진행 중...'}
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed break-keep">
                정기 재정렬 및 리필({resetTargetLabel}) 적용을 위해 뽑기 페이지가 잠시 잠겼습니다. 리셋이 완료되면 자동으로 해제됩니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 기기 최초 1회 유저(닉) 확인 팝업 (기기별 1회만 확인, 닉네임 고정 없음) */}
      {isNickConfirmOpen && !isMachineSuspended && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          onClick={() => setIsNickConfirmOpen(false)}
        >
          <div
            className="bg-slate-900 border border-amber-400/60 w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-2xl">
              🙋
            </div>
            <div className="space-y-2">
              <h3 className="text-base sm:text-lg font-black text-white break-keep">
                반드시 올바른 유저(닉)를 선택했습니까?
              </h3>
              <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500/15 border border-amber-400/45 text-amber-300 text-sm font-black">
                <span>현재 선택된 닉네임:</span>
                <span className="text-white">{selectedMember}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed break-keep">
                타인의 닉네임으로 실수하지 않도록 이 기기에서 최초 1회만 확인합니다. 확인 후에는 다시 묻지 않으며, 닉네임은 언제든 자유롭게 바꿀 수 있습니다.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setIsNickConfirmOpen(false)}
                className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs sm:text-sm cursor-pointer"
              >
                다시 선택
              </button>
              <button
                type="button"
                onClick={handleConfirmDeviceNick}
                className="py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-amber-500/20 cursor-pointer"
              >
                네, 맞습니다
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 뽑기 시작 횟수 선택 & 연속 5가챠(+1 무료) 모달 */}
      {isStartModalOpen && !isMachineSuspended && (() => {
        const maxTickets = selectedBalance.tickets;
        const parsedInput = parseInt(startPlayInput, 10);
        const validCount =
          !isNaN(parsedInput) && parsedInput >= 1 && parsedInput <= maxTickets
            ? parsedInput
            : null;
        const inputBonus = validCount ? Math.floor(validCount / 5) : 0;
        const inputTotal = validCount ? validCount + inputBonus : 0;

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => !isStarting && setIsStartModalOpen(false)}
          >
            <div
              className="bg-slate-900 border border-cyan-500/50 w-full max-w-sm rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center space-y-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-400/40 text-amber-300 text-xs font-black">
                  <Ticket className="w-3.5 h-3.5" />
                  <span>{selectedMember} · 보유 뽑기권 {maxTickets}장</span>
                </div>
                <h3 className="text-base sm:text-lg font-black text-white pt-1">
                  {maxTickets >= 5 ? '연속 5가챠를 진행하겠습니까?' : '몇 회 하시겠습니까?'}
                </h3>
                {maxTickets >= 5 && (
                  <p className="text-xs text-cyan-300 font-bold">
                    (연속 5가챠시 1회 무료지급 → 총 6번 연속 플레이!)
                  </p>
                )}
              </div>

              {maxTickets >= 5 && (
                <button
                  type="button"
                  disabled={isStarting}
                  onClick={() => handleStartTurn(5)}
                  className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 text-slate-950 font-black text-sm shadow-lg shadow-orange-500/25 transition-all active:scale-95 disabled:opacity-50 cursor-pointer flex flex-col items-center leading-tight gap-0.5"
                >
                  <span>🔥 예! 연속 5가챠 진행 (총 6회)</span>
                  <span className="text-[11px] font-bold text-slate-900/90">
                    뽑기권 5장 사용 + 1회 무료 보너스 지급
                  </span>
                </button>
              )}

              <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300">
                    {maxTickets >= 5 ? '또는 직접 횟수 입력' : '진행할 뽑기 횟수 입력'}
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">최대 {maxTickets}회</span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={maxTickets}
                    value={startPlayInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        setStartPlayInput('');
                        setStartModalError('');
                        return;
                      }
                      const num = parseInt(raw, 10);
                      if (isNaN(num)) return;
                      if (num > maxTickets) {
                        setStartPlayInput(String(maxTickets));
                        setStartModalError(`보유 뽑기권(${maxTickets}장)을 넘을 수 없습니다.`);
                      } else if (num < 1) {
                        setStartPlayInput('1');
                        setStartModalError('');
                      } else {
                        setStartPlayInput(String(num));
                        setStartModalError('');
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-700 focus:border-cyan-400 rounded-xl px-3.5 py-2.5 text-center text-base font-black text-white font-mono outline-none"
                  />
                  <span className="text-xs font-bold text-slate-400 shrink-0">회</span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {[1, 2, 3, 4].filter((n) => n <= maxTickets).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setStartPlayInput(String(n));
                        setStartModalError('');
                      }}
                      className={`flex-1 min-w-[48px] py-1.5 rounded-lg border text-xs font-bold cursor-pointer transition-colors ${
                        startPlayInput === String(n)
                          ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {n}회
                    </button>
                  ))}
                </div>

                {validCount !== null && inputBonus > 0 && (
                  <p className="text-[11px] text-amber-300 font-bold text-center">
                    🎁 {validCount}장 사용 → 보너스 +{inputBonus}회 무료 (총 {inputTotal}회 연속!)
                  </p>
                )}

                {maxTickets < 5 && (
                  <p className="text-[10px] text-slate-500 text-center">
                    💡 뽑기권 5장 이상 보유 시 연속 5가챠(+1회 무료)를 이용할 수 있습니다.
                  </p>
                )}
              </div>

              {startModalError && (
                <p className="text-xs text-rose-400 font-bold text-center">{startModalError}</p>
              )}

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={isStarting}
                  onClick={() => setIsStartModalOpen(false)}
                  className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs sm:text-sm cursor-pointer disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={isStarting || validCount === null}
                  onClick={() => validCount !== null && handleStartTurn(validCount)}
                  className="py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-black text-xs sm:text-sm shadow-lg shadow-cyan-500/20 cursor-pointer disabled:opacity-40"
                >
                  {isStarting
                    ? '준비 중...'
                    : validCount
                    ? inputBonus > 0
                      ? `${validCount}장 시작 (총 ${inputTotal}회)`
                      : `${validCount}회 뽑기 시작`
                    : '횟수 입력'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 뽑기 리워드(0.001 SOL = 1뽑기권) 교환 모달 */}
      {isSolExchangeModalOpen && !isMachineSuspended && (() => {
        const parsedCount = parseInt(solExchangeInput, 10);
        const validCount =
          !isNaN(parsedCount) && parsedCount >= 1 && parsedCount <= maxSolExchangeTickets
            ? parsedCount
            : null;
        const solCost = validCount ? Math.round(validCount * 0.001 * 10000) / 10000 : 0;
        const solAfter = validCount
          ? Math.max(0, Math.round((myAvailableGachaSol - solCost) * 10000) / 10000)
          : myAvailableGachaSol;

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => !isExchangingSol && setIsSolExchangeModalOpen(false)}
          >
            <div
              className="bg-slate-900 border border-emerald-500/50 w-full max-w-sm rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center space-y-1">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 text-xs font-black font-mono">
                  <Coins className="w-3.5 h-3.5" />
                  <span>{selectedMember} · 보유 {myAvailableGachaSol} SOL</span>
                </div>
                <h3 className="text-base sm:text-lg font-black text-white pt-1">
                  뽑기권을 몇 장 교환하시겠습니까?
                </h3>
                <p className="text-xs text-emerald-300 font-bold">
                  0.001 SOL당 뽑기권 1장 (최대 {maxSolExchangeTickets}장 교환 가능)
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-300">교환할 뽑기권 수량</span>
                  <span className="text-[11px] text-slate-400 font-mono">최대 {maxSolExchangeTickets}장</span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={maxSolExchangeTickets}
                    value={solExchangeInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        setSolExchangeInput('');
                        setSolExchangeError('');
                        return;
                      }
                      const num = parseInt(raw, 10);
                      if (isNaN(num)) return;
                      if (num > maxSolExchangeTickets) {
                        setSolExchangeInput(String(maxSolExchangeTickets));
                        setSolExchangeError(`최대 교환 가능 수량(${maxSolExchangeTickets}장)을 초과할 수 없습니다.`);
                      } else if (num < 1) {
                        setSolExchangeInput('1');
                        setSolExchangeError('');
                      } else {
                        setSolExchangeInput(String(num));
                        setSolExchangeError('');
                      }
                    }}
                    className="w-full bg-slate-900 border border-slate-700 focus:border-emerald-400 rounded-xl px-3.5 py-2.5 text-center text-base font-black text-white font-mono outline-none"
                  />
                  <span className="text-xs font-bold text-slate-400 shrink-0">장</span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {[1, 5, 10, 15].filter((n) => n < maxSolExchangeTickets).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setSolExchangeInput(String(n));
                        setSolExchangeError('');
                      }}
                      className={`flex-1 min-w-[44px] py-1.5 rounded-lg border text-xs font-bold cursor-pointer ${
                        solExchangeInput === String(n)
                          ? 'bg-emerald-500/25 border-emerald-400 text-emerald-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {n}장
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setSolExchangeInput(String(maxSolExchangeTickets));
                      setSolExchangeError('');
                    }}
                    className={`flex-1 min-w-[60px] py-1.5 rounded-lg border text-xs font-black cursor-pointer ${
                      solExchangeInput === String(maxSolExchangeTickets)
                        ? 'bg-emerald-500/30 border-emerald-400 text-emerald-200'
                        : 'bg-slate-900 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15'
                    }`}
                  >
                    최대 ({maxSolExchangeTickets}장)
                  </button>
                </div>

                {validCount !== null && (
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] space-y-1">
                    <div className="flex items-center justify-between text-slate-300">
                      <span>차감 리워드</span>
                      <strong className="text-amber-300 font-mono">-{solCost} SOL</strong>
                    </div>
                    <div className="flex items-center justify-between text-slate-300">
                      <span>교환 후 남은 리워드</span>
                      <strong className="text-cyan-300 font-mono">{solAfter} SOL</strong>
                    </div>
                    <div className="flex items-center justify-between text-emerald-300 font-bold pt-0.5 border-t border-slate-800">
                      <span>획득 뽑기권</span>
                      <strong className="font-mono">+{validCount}장</strong>
                    </div>
                  </div>
                )}
              </div>

              {solExchangeError && (
                <p className="text-xs text-rose-400 font-bold text-center">{solExchangeError}</p>
              )}

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={isExchangingSol}
                  onClick={() => setIsSolExchangeModalOpen(false)}
                  className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs sm:text-sm cursor-pointer disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={isExchangingSol || validCount === null}
                  onClick={() => validCount !== null && handleConfirmSolExchange(validCount)}
                  className="py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-40"
                >
                  {isExchangingSol ? '교환 중...' : validCount ? `${validCount}장 교환하기` : '수량 입력'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 연속 2회 이상 뽑기 주의 안내 팝업 */}
      {pendingMultiPlayCount !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
          onClick={() => !isStarting && setPendingMultiPlayCount(null)}
        >
          <div
            className="bg-slate-900 border border-amber-500/60 w-full max-w-sm rounded-3xl p-6 shadow-2xl space-y-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center text-2xl">
              ⚠️
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-black text-amber-300">연속 뽑기 주의 안내</h3>
              <p className="text-xs sm:text-sm text-white font-bold leading-relaxed break-keep">
                연속 뽑기를 시도합니다. 도중에 브라우져를 나가면 뽑기는 무효가 되고 뽑기권(티켓)은 반환받지 못 합니다.
              </p>
              <p className="text-[11px] text-emerald-300 font-bold">
                ※ 연속 뽑기 도중 조기 당첨 시 남은 미사용 뽑기권은 자동으로 정상 반환됩니다.
              </p>
              <p className="text-[11px] text-slate-400">
                (선택한 뽑기권 {pendingMultiPlayCount}장
                {Math.floor(pendingMultiPlayCount / 5) > 0
                  ? ` + 무료 보너스 ${Math.floor(pendingMultiPlayCount / 5)}회 = 총 ${
                      pendingMultiPlayCount + Math.floor(pendingMultiPlayCount / 5)
                    }회 연속`
                  : ` = 총 ${pendingMultiPlayCount}회 연속`}
                )
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                disabled={isStarting}
                onClick={() => setPendingMultiPlayCount(null)}
                className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs sm:text-sm cursor-pointer disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                disabled={isStarting}
                onClick={() => handleStartTurn(pendingMultiPlayCount, true)}
                className="py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-orange-500/25 cursor-pointer disabled:opacity-50"
              >
                {isStarting ? '시작 중...' : '확인 · 시작하기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 당첨 축하 폭죽 팝업 */}
      <GachaWinModal
        isOpen={!!activeWinModal}
        onClose={() => {
          setActiveWinModal(null);
          setActiveWinRefundedTickets(0);
          if (pendingNextTurnKey) {
            const nextKey = pendingNextTurnKey;
            setPendingNextTurnKey(null);
            setActiveTurnKey(nextKey);
          }
        }}
        winRecord={activeWinModal}
        refundedTickets={activeWinRefundedTickets}
      />

      {/* UFO 공지사항 모달 */}
      {isUfoNoticeOpen && (() => {
        const boxSpecs = [
          { slot: 0, shortName: '1번 프리렌', fullName: '프리렌 박스 #1', difficulty: '5 / 10 (보통)', shortDiff: '난이도 5', note: '가볍고 컴팩트하여 회전·기울기 공략이 수월한 입문용 상자' },
          { slot: 1, shortName: '2번 네즈코', fullName: '네즈코 박스 #2', difficulty: '6 / 10 (중상)', shortDiff: '난이도 6', note: '표준 규격과 무게의 정석 아케이드 브릿지 밸런스 상자' },
          { slot: 2, shortName: '3번 페른', fullName: '페른 박스 #3', difficulty: '5.5 / 10 (보통)', shortDiff: '난이도 5.5', note: '균형 잡힌 중경량 박스 (전체 12종 상세 스펙은 상단 [뽑기정보] 참조)' },
          { slot: 3, shortName: '4번 레제', fullName: '레제 박스 #4', difficulty: '8 / 10 (고난도)', shortDiff: '난이도 8', note: '중앙 Bar 틈새(0.73) 여유가 좁고 가장 길고 무거운 고난도 마스터 상자' },
          { slot: 4, shortName: '5번 바니카', fullName: '바니카 박스 #5', difficulty: '6.5 / 10 (중상·정사각)', shortDiff: '난이도 6.5', note: '정사각형에 가까운 와이드 스페셜 상자! 평면으로는 안 빠지며 옆으로 세우거나 지그시 눌러 넣는 공략이 유효합니다.' },
          { slot: 5, shortName: '6번 산드로네(인형)', fullName: '산드로네 쿠션 인형 #6', difficulty: '6.5 / 10 (중상·입체 쿠션)', shortDiff: '난이도 6.5', note: '최초의 3D 입체 다이컷 쿠션 인형! 푹신하고 얇은 두께(0.44)와 실루엣 복합 물리를 활용해 옆으로 기울이거나 눌러 넣으면 틈새로 쏙 빠집니다.' },
        ] as const;

        const activeSpec = selectedNoticeBoxSlot !== null ? boxSpecs[selectedNoticeBoxSlot] : null;
        const activeDims = selectedNoticeBoxSlot !== null ? GACHA_SLOT_BOX_DIMS[selectedNoticeBoxSlot] : null;
        const activeReward = selectedNoticeBoxSlot !== null ? GACHA_SLOT_REWARD_AMOUNTS[selectedNoticeBoxSlot] : null;

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setIsUfoNoticeOpen(false)}
          >
            <div
              className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 bg-gradient-to-r from-emerald-950/60 via-slate-900 to-slate-900 border-b border-emerald-500/25 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/35 flex items-center justify-center text-emerald-300">
                    <Megaphone className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-white">UFO 공지사항</h2>
                    <p className="text-[11px] text-slate-400">Rapier3D 3D UFO 브릿지 뽑기 업데이트 및 안내</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsUfoNoticeOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-3 overflow-y-auto text-xs sm:text-sm text-slate-200">
                {/* 261127 공지 (최신 · 기본 펼침) */}
                <div className="bg-slate-950/90 rounded-2xl border border-amber-500/50 overflow-hidden transition-all">
                  <button
                    type="button"
                    onClick={() => setOpenNotice261127(!openNotice261127)}
                    className="w-full px-4 py-3.5 flex items-center justify-between gap-2 text-left hover:bg-slate-900/60 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                        📌 261127 공지
                      </span>
                      <span className="text-xs sm:text-sm font-bold text-white truncate">
                        3D 인형뽑기 전면 개편 · 13종 개별 물리 세팅 · 편의/UI 대개선
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">2026-11-27</span>
                      {openNotice261127 ? (
                        <ChevronUp className="w-4 h-4 text-amber-400 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                    </div>
                  </button>

                  {openNotice261127 && (
                    <div className="px-4 pb-4 pt-3 space-y-2.5 border-t border-slate-800/80 text-slate-200 leading-relaxed font-medium">
                      <p className="flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-pink-400 shrink-0 mt-0.5" />
                        <span>
                          <strong className="text-pink-300">3D 인형 5종 클래식 인형뽑기 전면 전환!</strong> (<strong className="text-white">#2 마린 · #5 타야마 · #8 미쿠 · #11 산드로네 · #13 마키마</strong>) — 기존 하시와타시 Bar 대신 <strong className="text-amber-300">볼륨감 있게 키운 경량 3D 인형 5개를 바닥 전역에 넓게 흩뿌려 두고</strong>, <strong className="text-sky-300">상·하·좌·우 4방향 자유 이동 + [뽑기] 버튼</strong>과 <strong className="text-cyan-300">타원형 메탈 헤드 + 컴팩트 스틸 4방향 집게(장거리 운반 토크 감쇠·X→Z 직각 운반·확률 강력 그립)</strong>로 집어 올려 <strong className="text-emerald-300">좌측 하단(초기 위치) WIN 구멍 위로 운반·낙하</strong>시키면 당첨됩니다! (재고 5개 소진 시 품절)
                        </span>
                      </p>
                      <p className="flex items-start gap-2">
                        <Info className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                        <span>
                          <strong className="text-violet-300">13종 뽑기판별 고유 물리·크레인·Bar 세팅 적용:</strong> #1 페른을 기본값으로 두고 나머지 12개 뽑기판의 <strong className="text-white">4개 Bar 간격, 크레인 헤드 크기, 집게 길이/두께, 닫힘·유지 토크, 팁 마찰</strong>을 난이도에 맞춰 모두 다르게 튜닝했습니다. (상단 <strong>[뽑기정보]</strong>에서 확인 가능)
                        </span>
                      </p>
                      <p className="flex items-start gap-2">
                        <RefreshCw className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <span>
                          <strong className="text-emerald-300">집게·낙하 물리 개선:</strong> 다양한 박스 높이에 대응하도록 <code className="text-amber-200">&lt;&gt;</code> 집게 암을 연장하고, 상단 정지 후 집게를 완전히 벌려 수직 낙하한 뒤 크레인이 복귀하도록 개선했습니다. 잡는힘·유지 토크도 현실화해 애매한 각도에서는 미끄러질 수 있습니다.
                        </span>
                      </p>
                      <p className="flex items-start gap-2">
                        <Gift className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <span>
                          <strong className="text-amber-300">리워드 밸런스 재조정:</strong> 3D 인형 뽑기는 일괄 <strong className="text-white">0.001 SOL</strong>, 일반 피규어 박스 뽑기는 <strong className="text-white">0.001 ~ 0.003 SOL</strong> 범위에서 난이도별 적용됩니다.
                        </span>
                      </p>
                      <p className="flex items-start gap-2">
                        <Radio className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                        <span>
                          <strong className="text-cyan-300">편의 기능 & UI 대개선:</strong> 상단 좌측 <strong className="text-white">[선택] / [랜덤] / [관전]</strong>(진행 중 뽑기 자동 이동·다중 선택) 버튼 및 1~13번 탭 가로 스크롤·화살표 추가, <strong className="text-white">전체 통합 + 뽑기판별 이중 최근 상황 로그</strong> 적용(모바일 가로 한 줄 정리), PC 뽑기 시작 시 <strong className="text-white">스크롤 간섭 없는 확대 집중 모드</strong> 자동 전환 및 모든 팝업 <strong className="text-white">Enter/Esc</strong> 단축키 지원!
                        </span>
                      </p>
                    </div>
                  )}
                </div>

                {/* 261126 공지 (기본 접힘) */}
                <div className="bg-slate-950/80 rounded-2xl border border-slate-700/80 overflow-hidden transition-all">
                  <button
                    type="button"
                    onClick={() => setOpenNotice261126(!openNotice261126)}
                    className="w-full px-4 py-3.5 flex items-center justify-between gap-2 text-left hover:bg-slate-900/60 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/35 shrink-0">
                        📌 261126 공지
                      </span>
                      <span className="text-xs sm:text-sm font-bold text-white truncate">
                        13종 뽑기판 확장 · 실시간 관전(LIVE) · Rapier3D 업그레이드
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">2026-11-26</span>
                      {openNotice261126 ? (
                        <ChevronUp className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                    </div>
                  </button>

                  {openNotice261126 && (
                    <div className="px-4 pb-4 pt-3 space-y-2.5 border-t border-slate-800/80 text-slate-200 leading-relaxed font-medium">
                      <p className="flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <span>
                          UFO 뽑기 물리 엔진이 <strong className="text-emerald-300">Rapier3D (Rust WASM · 120Hz)</strong>로 전면 업그레이드되었습니다. <strong className="text-white">2축 짐벌 케이블, 실제 토크 관절 집게, 상품 통과폭 맞춤형 중앙 빨간 Bar 간격, 편심 무게중심</strong>으로 실제 오락실 손맛을 구현했습니다.
                        </span>
                      </p>
                      <p className="flex items-start gap-2">
                        <Gift className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <span>
                          뽑기판이 <strong className="text-amber-300">총 13종(피규어 박스 8종 + 3D 입체 인형 5종)</strong>으로 대폭 확장·랜덤 재배치되었습니다! (노엘 제거 · 페른/루시/렘/시노부 박스 및 <strong className="text-pink-300">키타가와 마린·하쿠네 미쿠·타야마·마키마 3D 인형</strong> 추가)
                        </span>
                      </p>
                      <p className="flex items-start gap-2">
                        <Info className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                        <span>
                          상단 UFO 공지 오른쪽에 <strong className="text-violet-300">[뽑기정보]</strong> 버튼이 추가되어 13종 상자·3D 인형의 크기·무게·빨간 Bar 내경·리워드·공략 팁을 한눈에 확인할 수 있습니다.
                        </span>
                      </p>
                      <p className="flex items-start gap-2">
                        <Radio className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                        <span>
                          <strong className="text-cyan-300">실시간 관전(LIVE)</strong> 기능이 적용되었습니다! 다른 멤버가 뽑기를 진행 중일 때 흐린 배경 너머로 크레인과 상품의 움직임을 실시간으로 구경할 수 있습니다.
                        </span>
                      </p>
                      <p className="flex items-start gap-2">
                        <RefreshCw className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        <span>
                          신규 효과음·연출(<strong className="text-white">뽑기 시작!</strong> · <strong className="text-amber-300">아슬 아슬!</strong> · <strong className="text-emerald-300">당첨!</strong>) 및 <strong className="text-white">최근 상황 로그 접기/펼치기(10건 페이지네이션)</strong>가 추가되었고, 폭죽 잔상 버그와 점검 중 보안 검증을 강화했습니다.
                        </span>
                      </p>
                    </div>
                  )}
                </div>

                {/* 261125 공지 (어제 날짜 복구 · 기본 접힘 · 색상 피로도 최소화) */}
                <div className="bg-slate-950/80 rounded-2xl border border-slate-700/80 overflow-hidden transition-all">
                  <button
                    type="button"
                    onClick={() => setOpenNotice261125(!openNotice261125)}
                    className="w-full px-4 py-3.5 flex items-center justify-between gap-2 text-left hover:bg-slate-900/60 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800 text-cyan-300 border border-slate-700 shrink-0">
                        📌 261125 공지
                      </span>
                      <span className="text-xs sm:text-sm font-bold text-slate-200 truncate">
                        개별 6개 뽑기판 개편 · 물리 & 리워드 정책
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">2026-11-25</span>
                      {openNotice261125 ? (
                        <ChevronUp className="w-4 h-4 text-cyan-400 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                    </div>
                  </button>

                  {openNotice261125 && (
                    <div className="px-4 pb-4 pt-3 space-y-2.5 border-t border-slate-800/80 text-slate-300 leading-relaxed font-medium">
                      <div className="space-y-2">
                        <p className="flex items-start gap-2">
                          <Sparkles className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                          <span>
                            각 상품끼리 충돌 없이 집중 공략할 수 있도록 <strong className="text-cyan-300">개별 6개 뽑기판 (1판 1상품 · 박스 5종 + 입체 쿠션 인형 1종)</strong>으로 개편되었습니다! 상단 <strong className="text-white">1~6번 탭</strong> 또는 하단 <strong className="text-white">[이전 뽑기] / [다음 뽑기]</strong> 버튼으로 원하는 뽑기판을 선택해 도전하세요. (평균 난이도 <strong className="text-white">6.5 중상</strong>)
                          </span>
                        </p>
                        <p className="ml-6 text-[11px] sm:text-xs text-slate-400 font-semibold">
                          👇 밑에 상자 번호를 누르면 각각의 상자 스펙을 확인할 수 있습니다.
                        </p>
                        <div className="ml-6 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] sm:text-xs">
                          {boxSpecs.map((spec) => {
                            const isSelected = selectedNoticeBoxSlot === spec.slot;
                            const rewardSol = GACHA_SLOT_REWARD_AMOUNTS[spec.slot];
                            return (
                              <button
                                key={spec.slot}
                                type="button"
                                onClick={() =>
                                  setSelectedNoticeBoxSlot((prev) => (prev === spec.slot ? null : spec.slot))
                                }
                                className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-1 text-left transition-all cursor-pointer ${
                                  isSelected
                                    ? 'border-cyan-400/70 bg-cyan-500/10 ring-1 ring-cyan-400/30'
                                    : 'bg-slate-900 border-slate-800 hover:border-slate-600'
                                }`}
                              >
                                <span className="text-slate-100 font-bold truncate">{spec.shortName}</span>
                                <span className="font-mono text-[11px] text-slate-400 shrink-0">
                                  {spec.shortDiff} · <strong className="text-amber-300/90">{rewardSol} SOL</strong>
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {activeSpec && activeDims && activeReward !== null && (
                          <div className="ml-6 p-3 rounded-xl bg-slate-900/95 border border-slate-700 space-y-2">
                            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
                              <span className="text-xs font-black text-white">
                                📦 {activeSpec.fullName} 스펙
                              </span>
                              <span className="text-[11px] font-mono font-black text-amber-300">{activeReward} SOL</span>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                              <div className="px-2 py-1.5 rounded-lg bg-slate-950/90 border border-slate-800">
                                <span className="text-slate-400 block text-[10px]">목표 난이도</span>
                                <span className="font-bold font-mono text-slate-100">{activeSpec.difficulty}</span>
                              </div>
                              <div className="px-2 py-1.5 rounded-lg bg-slate-950/90 border border-slate-800">
                                <span className="text-slate-400 block text-[10px]">무게 (Mass)</span>
                                <span className="font-bold font-mono text-slate-100">{activeDims.mass}</span>
                              </div>
                              <div className="px-2 py-1.5 rounded-lg bg-slate-950/90 border border-slate-800 col-span-2">
                                <span className="text-slate-400 block text-[10px]">규격 — 가로(W) × 높이(H) × 세로 길이(D)</span>
                                <span className="font-bold font-mono text-slate-100">
                                  {activeDims.w} × {activeDims.h} × {activeDims.d}
                                </span>
                                <span className="text-[10px] text-slate-400 ml-1.5">(중앙 Bar 틈새 0.73)</span>
                              </div>
                            </div>
                            <p className="text-[11px] text-slate-300 leading-snug">💡 {activeSpec.note}</p>
                          </div>
                        )}
                      </div>

                      <p className="flex items-start gap-2">
                        <RefreshCw className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        <span>
                          각 뽑기판 상품은 초기 세팅·재정렬·리필 시 <strong className="text-white">중앙 정위치</strong>에 배치되며, 한쪽 집게가 상자에 걸려도 끝까지 하강해 반대쪽 집게로 파고들어 밀어내거나 비스듬히 들어올리는 등 <strong className="text-white">실제 오락실에 가까운 크레인 물리</strong>로 대폭 개선했습니다.
                        </span>
                      </p>
                      <p className="flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        <span>
                          재정렬 원위치 상태에서 상품 정중앙 근처를 들어올리면 <strong className="text-emerald-300">Balance Catch!</strong>, 이후 중앙 빨간 Bar 근처에서 집게를 들어올리면 <strong className="text-amber-300">극한 드르륵!</strong> 특수 팝업 및 효과음이 재생됩니다.
                        </span>
                      </p>
                      <p className="flex items-start gap-2">
                        <Camera className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        <span>
                          항공뷰·측면뷰(우측뷰)에서는 크레인 조작이 불가능하며, 뽑기를 시작하면 <strong className="text-white">자동으로 정면뷰로 전환</strong>되어 진행됩니다. (정면에서 <strong className="text-white">까치발 업/다운 최대 45°</strong>까지는 조작 가능)
                        </span>
                      </p>
                      <p className="flex items-start gap-2">
                        <Coins className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        <span>
                          뽑기 리워드는 식사배틀 리워드와 별도로 운영되며, 보유 중인 뽑기 리워드 잔고 내에서 <strong className="text-white">원하는 SOL 수량을 직접 입력</strong>해 신청(업비트 입금 시 <strong className="text-amber-300">0.02 SOL 이상</strong> 권장)하거나 <strong className="text-white">0.001 SOL당 뽑기권 1회</strong>로 즉시 교환할 수 있습니다.
                        </span>
                      </p>
                      <p className="flex items-start gap-2">
                        <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        <span>
                          연속 뽑기 도중 상품을 조기 당첨하면 <strong className="text-emerald-300">남은 미사용 뽑기권은 자동 반환</strong>되며, 승점 교환은 신청 가능 리워드 WIN(1WIN 이상)만 가능합니다.
                        </span>
                      </p>
                    </div>
                  )}
                </div>

                {/* 261124 공지 (정기 운영 안내 · 기본 접힘) */}
                <div className="bg-slate-950/75 rounded-2xl border border-slate-800 overflow-hidden transition-all">
                  <button
                    type="button"
                    onClick={() => setOpenNotice261124(!openNotice261124)}
                    className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-slate-900/60 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800/90 text-slate-300 border border-slate-700 shrink-0">
                        📌 261124 공지
                      </span>
                      <span className="text-xs sm:text-sm font-bold text-slate-300 truncate">
                        정기 재정렬·리필 및 시스템 오류 안내
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">2026-11-24</span>
                      {openNotice261124 ? (
                        <ChevronUp className="w-4 h-4 text-slate-300 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                    </div>
                  </button>

                  {openNotice261124 && (
                    <div className="px-4 pb-3.5 pt-2.5 space-y-2 border-t border-slate-800/80 text-xs text-slate-300 leading-relaxed font-medium">
                      <p className="flex items-start gap-2">
                        <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                        <span>
                          뽑기 상품의 재정렬과 refill은 <strong className="text-amber-300">10:30, 14:00, 23:00</strong>에 자동으로 진행됩니다.
                        </span>
                      </p>
                      <p className="flex items-start gap-2 text-slate-400">
                        <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                        <span>
                          불가피한 에러나 억울한 시스템 오류는 관리자에게 요청하면 재정렬 해드립니다.
                        </span>
                      </p>
                    </div>
                  )}
                </div>

                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setIsUfoNoticeOpen(false)}
                    className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs sm:text-sm font-bold cursor-pointer transition-colors"
                  >
                    확인
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* UFO 뽑기 명예의 전당 모달 */}
      <LeaderboardModal
        isOpen={isLeaderboardOpen}
        onClose={() => setIsLeaderboardOpen(false)}
        stats={gachaWinStats}
        mode="gacha"
        usedWinsByMember={usedWinsByMember}
        availableSolByMember={availableGachaSolByMember}
        onSelectMemberReward={(member) => handleOpenGachaReward(member, false)}
      />

      {/* UFO 뽑기 리워드 신청 & 지급 현황 모달 */}
      <RewardModal
        isOpen={isRewardModalOpen}
        onClose={() => {
          setIsRewardModalOpen(false);
          setRewardStartApply(false);
        }}
        initialMember={rewardInitialMember}
        isAdmin={isAdmin}
        memberWinStats={gachaWinStats}
        mode="gacha"
        initialStartApply={rewardStartApply}
        onApplySuccess={fetchState}
      />

      {/* 관리자 로그인 모달 (서버 /api/admin/verify 연동) */}
      <GachaPrizeInfoModal
        isOpen={isPrizeInfoOpen}
        onClose={() => setIsPrizeInfoOpen(false)}
        currentMachineIndex={selectedMachineIndex}
        onSelectMachine={handleSelectMachine}
      />

      <PresenceModal
        isOpen={isPresenceOpen}
        onClose={() => setIsPresenceOpen(false)}
      />

      <AdminLoginModal
        isOpen={isAdminLoginOpen}
        onClose={() => setIsAdminLoginOpen(false)}
        onSuccess={() => setIsAdmin(true)}
      />
    </div>
  );
}

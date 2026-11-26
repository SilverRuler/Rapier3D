import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, RefreshCw } from 'lucide-react';
import { MEMBERS } from '@/constants/members';
import { Member } from '@/types/meal';

interface ChatMessage {
  id: string;
  nickname: string;
  isMember?: boolean;
  maskedIp?: string;
  content: string;
  createdAt: number;
}

function formatKstDateAndTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts + 9 * 3600 * 1000);
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yy}.${mm}.${dd} ${hh}:${mi}`;
}

const MEMBER_MAP = new Map<string, Member>(MEMBERS.map((m) => [m.name, m]));

export const GachaLiveChat: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedSticker, setSelectedSticker] = useState<Member | null>(null);
  const [anonNick, setAnonNick] = useState<string>('ㅇㅇ');
  const [content, setContent] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loaded, setLoaded] = useState<boolean>(false);

  const listRef = useRef<HTMLDivElement>(null);
  const lastMsgIdRef = useRef<string>('');
  const forceScrollRef = useRef<boolean>(true);

  useEffect(() => {
    try {
      const savedSticker = localStorage.getItem('aial_gacha_chat_sticker');
      if (savedSticker && MEMBER_MAP.has(savedSticker)) {
        setSelectedSticker(MEMBER_MAP.get(savedSticker) || null);
      } else {
        const savedNick = localStorage.getItem('maintenance_chat_nick');
        if (savedNick) setAnonNick(savedNick);
      }
    } catch {}
  }, []);

  const fetchMessages = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const resp = await fetch(`/api/maintenance-chat?_t=${Date.now()}`, { cache: 'no-store' });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data?.success && Array.isArray(data.messages)) {
        const next: ChatMessage[] = data.messages;
        const lastId = next.length ? next[next.length - 1].id : '';
        const listEl = listRef.current;
        const wasNearBottom =
          forceScrollRef.current ||
          !listEl ||
          listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 65;

        setMessages(next);
        setLoaded(true);

        if (lastId !== lastMsgIdRef.current || forceScrollRef.current) {
          lastMsgIdRef.current = lastId;
          if (wasNearBottom) {
            requestAnimationFrame(() => {
              if (listRef.current) {
                listRef.current.scrollTop = listRef.current.scrollHeight;
              }
            });
          }
          forceScrollRef.current = false;
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchMessages();
    const timer = setInterval(fetchMessages, 2500);
    const onVis = () => {
      if (!document.hidden) fetchMessages();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchMessages]);

  const handleSelectSticker = (m: Member) => {
    if (selectedSticker?.id === m.id) {
      setSelectedSticker(null);
      try {
        localStorage.removeItem('aial_gacha_chat_sticker');
      } catch {}
    } else {
      setSelectedSticker(m);
      try {
        localStorage.setItem('aial_gacha_chat_sticker', m.name);
      } catch {}
    }
  };

  const handleClearSticker = () => {
    setSelectedSticker(null);
    try {
      localStorage.removeItem('aial_gacha_chat_sticker');
    } catch {}
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSending) return;
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      setErrorMsg('채팅 내용을 입력해주세요.');
      return;
    }

    const activeNickname = selectedSticker ? selectedSticker.name : anonNick.trim() || 'ㅇㅇ';
    if (!selectedSticker) {
      try {
        localStorage.setItem('maintenance_chat_nick', activeNickname);
      } catch {}
    }

    setErrorMsg('');
    setIsSending(true);
    try {
      const resp = await fetch('/api/maintenance-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: activeNickname, content: trimmedContent }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        setErrorMsg(data?.message || '채팅 전송에 실패했습니다.');
      } else {
        setContent('');
        forceScrollRef.current = true;
        await fetchMessages();
      }
    } catch {
      setErrorMsg('네트워크 오류가 발생했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xs sm:text-sm font-black text-white flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4 text-emerald-400" />
          <span>실시간 뽑기방 채팅 · 건의함</span>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/35 text-emerald-300 text-[10px] font-mono font-bold">
            {messages.length}건 · LIVE
          </span>
        </h2>
        <button
          type="button"
          onClick={fetchMessages}
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-emerald-300 cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" />
          <span>새로고침</span>
        </button>
      </div>

      {/* 실시간 채팅 로그 */}
      <div
        ref={listRef}
        className="h-64 sm:h-72 overflow-y-auto rounded-xl bg-slate-950/85 border border-slate-800 px-3 py-2.5 space-y-2"
      >
        {!loaded ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            채팅을 불러오는 중...
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 text-center">
            아직 채팅이 없습니다. 닉네임 스티커를 고르거나 익명으로 첫 메시지를 남겨보세요!
          </div>
        ) : (
          messages.map((m) => {
            const memberInfo = MEMBER_MAP.get(m.nickname);
            const showOfficialSticker = Boolean(memberInfo && (m.isMember || !m.maskedIp));
            return (
              <div
                key={m.id}
                className="flex items-baseline justify-between gap-2 text-xs sm:text-[13px] leading-relaxed break-words"
              >
                <div className="min-w-0 flex-1 flex items-baseline gap-1.5 flex-wrap">
                  {showOfficialSticker && memberInfo ? (
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-black border shrink-0 ${memberInfo.avatarBg} ${memberInfo.borderColor}`}
                    >
                      {memberInfo.name}
                    </span>
                  ) : (
                    <span className="inline-flex items-baseline gap-0.5 shrink-0">
                      <span className="font-black text-slate-100">{m.nickname || 'ㅇㅇ'}</span>
                      {m.maskedIp && (
                        <span className="text-[11px] font-mono text-slate-400">({m.maskedIp})</span>
                      )}
                    </span>
                  )}
                  <span className="text-slate-200">{m.content}</span>
                </div>
                <span className="text-[10px] font-mono text-slate-500 shrink-0 whitespace-nowrap">
                  {formatKstDateAndTime(m.createdAt)}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* 닉네임 선택 (12명 스티커 + 익명 자유 입력) & 메시지 입력 폼 */}
      <form onSubmit={handleSend} className="space-y-2.5">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-slate-300">채팅 닉네임 (익명 자유 입력 또는 12명 스티커 선택)</span>
            {selectedSticker && (
              <button
                type="button"
                onClick={handleClearSticker}
                className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
              >
                익명 직접 입력으로 변경 ✕
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={handleClearSticker}
              className={`px-2 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                !selectedSticker
                  ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-600'
              }`}
            >
              익명(직접입력)
            </button>
            {MEMBERS.map((m) => {
              const active = selectedSticker?.id === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => handleSelectSticker(m)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-black border transition-all cursor-pointer ${
                    active
                      ? `${m.avatarBg} ${m.borderColor} ring-1 ring-white/50 scale-[1.03]`
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                  }`}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedSticker ? (
            <div
              className={`px-2.5 py-2 rounded-xl border text-xs font-black shrink-0 ${selectedSticker.avatarBg} ${selectedSticker.borderColor}`}
            >
              {selectedSticker.name}
            </div>
          ) : (
            <input
              type="text"
              value={anonNick}
              onChange={(e) => setAnonNick(e.target.value)}
              maxLength={16}
              placeholder="ㅇㅇ"
              className="w-24 sm:w-28 shrink-0 bg-slate-950 border border-slate-700 focus:border-amber-400 rounded-xl px-2.5 py-2 text-xs font-bold text-white placeholder-slate-500 outline-none"
              aria-label="익명 닉네임"
            />
          )}

          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={300}
            placeholder="건의사항이나 수다를 자유롭게 남겨보세요..."
            className="flex-1 min-w-0 bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-3 py-2 text-xs sm:text-sm text-white placeholder-slate-500 outline-none"
            aria-label="채팅 내용"
          />

          <button
            type="submit"
            disabled={isSending || !content.trim()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs sm:text-sm shrink-0 cursor-pointer disabled:opacity-40 transition-all"
          >
            <Send className="w-3.5 h-3.5" />
            <span>전송</span>
          </button>
        </div>

        {errorMsg && <p className="text-[11px] text-rose-400 font-bold">{errorMsg}</p>}
      </form>
    </section>
  );
};

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Bot,
  CheckCircle2,
  GitCompareArrows,
  HelpCircle,
  SearchCheck,
  Send,
  Trash2,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import api, { getApiErrorMessage } from '../../utils/api';
import { parseForumContent } from '../../utils/forumContent';
import styles from '../../styles/noir.module.css';

const STORAGE_KEY = 'game_guide_chat_v3';
const STARTER_SUGGESTIONS = [
  'Hello',
  'How do rackets work?',
  'What wealth rank is $1,000,000,000?',
  'How do I get out of jail?',
];
const WELCOME_MESSAGE = {
  id: 'guide-welcome',
  role: 'guide',
  chat: true,
  intent: 'small_talk',
  sections: [{
    source: 'system',
    title: 'Game Guide',
    body: "Hey, boss. I'm your Game Guide. I know the published FAQs and How To — ask me about rackets, jail, wealth ranks, families, cars, or anything else in the game.",
  }],
  suggestions: STARTER_SUGGESTIONS.slice(1),
};

const GUIDE_STYLES = `
  @keyframes guideDotPulse {
    0%, 80%, 100% { transform: translateY(0); opacity: .35; }
    40% { transform: translateY(-3px); opacity: 1; }
  }
  .guide-typing-dot { animation: guideDotPulse 1.15s infinite ease-in-out; }
  .guide-typing-dot:nth-child(2) { animation-delay: .13s; }
  .guide-typing-dot:nth-child(3) { animation-delay: .26s; }
  .guide-faq-body {
    max-width: 100%; overflow-wrap: anywhere; word-break: break-word;
    font-size: 12px; line-height: 1.48;
  }
  .guide-faq-body strong { color: var(--noir-primary); }
  .guide-faq-body ul, .guide-faq-body ol { margin: .35em 0 .55em; padding-left: 1.25em; }
  .guide-faq-body li { margin: .15em 0; }
  .guide-faq-body blockquote, .guide-faq-body .forum-content-quote {
    margin: .4em 0; padding: .5em .75em;
    border-left: 2px solid rgba(var(--noir-primary-rgb), .5);
    background: rgba(var(--noir-primary-rgb), .06); border-radius: 4px;
  }
  .guide-faq-body hr {
    border: 0; border-top: 1px solid rgba(var(--noir-primary-rgb), .2); margin: .6em 0;
  }
  .guide-faq-body img, .guide-faq-body iframe, .guide-faq-body video {
    display: block; max-width: 100%; height: auto; margin: .5rem auto;
  }
`;

function loadThread() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : [WELCOME_MESSAGE];
  } catch {
    return [WELCOME_MESSAGE];
  }
}

function saveThread(messages) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
  } catch {
    /* session storage is optional */
  }
}

function lastGuideContext(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const context = messages[i]?.context;
    if (
      context
      && ['faq', 'how_to'].includes(context.source)
      && ['category', 'subsection'].includes(context.kind)
      && context.category
      && context.title
    ) {
      const safe = {
        source: context.source,
        kind: context.kind,
        category: String(context.category).slice(0, 120),
        title: String(context.title).slice(0, 120),
      };
      ['intent_id', 'domain', 'answer_type'].forEach((field) => {
        if (context[field]) safe[field] = String(context[field]).slice(0, 120);
      });
      if (Array.isArray(context.choice_intent_ids)) {
        safe.choice_intent_ids = context.choice_intent_ids
          .slice(0, 5)
          .map((value) => String(value).slice(0, 120));
      }
      return safe;
    }
  }
  return null;
}

function sourceName(source) {
  return source === 'how_to' ? 'How To' : 'FAQs';
}

function answerPresentation(message) {
  const type = message.answerType || (message.intent === 'clarification' ? 'clarification' : 'direct');
  if (type === 'comparison') {
    return {
      label: 'Comparison',
      icon: GitCompareArrows,
      tone: 'border-violet-400/30 bg-violet-500/5',
    };
  }
  if (type === 'troubleshooting') {
    return { label: 'Troubleshooting', icon: Wrench, tone: 'border-amber-400/30 bg-amber-500/5' };
  }
  if (type === 'yes_no') {
    return { label: 'Guide answer', icon: CheckCircle2, tone: 'border-emerald-400/30 bg-emerald-500/5' };
  }
  if (type === 'clarification') {
    return { label: 'Choose a topic', icon: HelpCircle, tone: 'border-sky-400/30 bg-sky-500/5' };
  }
  return { label: 'Guide match', icon: SearchCheck, tone: 'border-primary/15 bg-secondary/40' };
}

function GuideIdentity() {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
        <Bot size={11} />
      </span>
      <span className="text-[9px] uppercase tracking-[0.12em] font-heading font-bold text-primary">Game Guide</span>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex justify-start" aria-label="Game Guide is typing">
      <div className="max-w-[90%] rounded-lg rounded-tl-sm border border-primary/15 bg-secondary/50 px-3 py-2">
        <GuideIdentity />
        <div className="flex items-center gap-1 h-4">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="guide-typing-dot block h-1.5 w-1.5 rounded-full bg-primary" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function GameGuideChat() {
  const [allowed, setAllowed] = useState(null);
  const [categories, setCategories] = useState([]);
  const [messages, setMessages] = useState(loadThread);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const loadAccess = useCallback(async () => {
    try {
      const res = await api.get('/help/chat/quota');
      setAllowed(!!res.data?.allowed);
      setCategories(Array.isArray(res.data?.categories) ? res.data.categories : []);
    } catch (error) {
      setAllowed(false);
      toast.error(getApiErrorMessage(error, 'Could not load Game Guide.'));
    }
  }, []);

  useEffect(() => {
    loadAccess();
  }, [loadAccess]);

  useEffect(() => {
    saveThread(messages);
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, sending]);

  const latestGuide = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'guide'),
    [messages],
  );
  const activeSuggestions = useMemo(() => {
    const contextual = [
      ...(latestGuide?.choices || []).map((choice) => choice.message || choice.label),
      ...(latestGuide?.relatedQuestions || []),
      ...(latestGuide?.suggestions || []),
    ].filter(Boolean);
    const pool = contextual.length
      ? contextual
      : [...STARTER_SUGGESTIONS, ...categories.slice(0, 8)];
    return [...new Set(pool)].slice(0, 8);
  }, [categories, latestGuide]);

  const send = async (rawText) => {
    const message = String(rawText || '').trim();
    if (!message || sending || allowed === false) return;

    const context = lastGuideContext(messages);
    const timestamp = Date.now();
    setSending(true);
    setDraft('');
    setMessages((previous) => [
      ...previous,
      { id: `u-${timestamp}`, role: 'user', text: message },
    ]);

    try {
      const [res] = await Promise.all([
        api.post('/help/chat', { message, ...(context ? { context } : {}) }),
        new Promise((resolve) => setTimeout(resolve, 480)),
      ]);
      const data = res.data || {};
      setMessages((previous) => [
        ...previous,
        {
          id: `g-${timestamp}`,
          role: 'guide',
          wealth: data.wealth || null,
          sections: Array.isArray(data.reply_sections) ? data.reply_sections : [],
          refused: !!data.refused,
          chat: !!data.chat,
          fallbackContents: !!data.fallback_contents,
          intent: data.intent || 'topic_search',
          preamble: data.preamble || null,
          context: data.context || null,
          suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
          relatedQuestions: Array.isArray(data.related_questions) ? data.related_questions : [],
          choices: Array.isArray(data.choices) ? data.choices : [],
          confidence: data.confidence || 'low',
          matchMethod: data.match_method || 'unknown',
          intentId: data.intent_id || null,
          answerType: data.answer_type || 'direct',
          typoCorrections: Array.isArray(data.typo_corrections) ? data.typo_corrections : [],
          provenance: Array.isArray(data.provenance) ? data.provenance : [],
        },
      ]);
    } catch (error) {
      const status = error?.response?.status;
      if (status === 403) {
        setAllowed(false);
        toast.error('Game Guide is not available yet.');
      } else {
        const text = getApiErrorMessage(error, 'I lost the page for a second. Try that again, boss.');
        setMessages((previous) => [
          ...previous,
          {
            id: `g-error-${timestamp}`,
            role: 'guide',
            chat: true,
            sections: [{ source: 'system', title: 'Try again', body: text }],
            suggestions: activeSuggestions,
          },
        ]);
      }
    } finally {
      setSending(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const clearChat = () => {
    setMessages([WELCOME_MESSAGE]);
    setDraft('');
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* session storage is optional */
    }
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onSubmit = (event) => {
    event.preventDefault();
    send(draft);
  };

  const onComposerKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(draft);
    }
  };

  if (allowed === false) {
    return (
      <div className={`space-y-4 max-w-3xl mx-auto ${styles.pageContent} mobile-page-root`}>
        <div className={`${styles.panel} rounded-md border border-primary/20 p-4`}>
          <h1 className="text-[11px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1.5">
            <BookOpen size={14} /> Game Guide
          </h1>
          <p className="mt-2 text-sm text-mutedForeground font-heading">Not available yet.</p>
          <Link to="/game/help-desk" className="mt-3 inline-flex text-[11px] font-heading text-primary hover:underline">
            Open Help Desk
          </Link>
        </div>
      </div>
    );
  }

  if (allowed === null) {
    return (
      <div className={`max-w-3xl mx-auto p-4 text-sm text-mutedForeground font-heading ${styles.pageContent}`}>
        Loading Game Guide…
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col max-w-3xl mx-auto ${styles.pageContent} mobile-page-root pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0`}
      style={{ minHeight: 'calc(100dvh - 7rem)' }}
    >
      <style>{GUIDE_STYLES}</style>
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 flex flex-col flex-1 min-h-0`}>
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
          <h1 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1.5">
            <BookOpen size={14} /> Game Guide
          </h1>
          <button
            type="button"
            onClick={clearChat}
            className="inline-flex min-h-8 items-center gap-1 px-2 text-[9px] uppercase tracking-wider font-heading text-mutedForeground hover:text-primary touch-manipulation"
          >
            <Trash2 size={11} /> Clear chat
          </button>
        </div>

        <div className="px-3 py-2 border-b border-primary/10 text-[10px] font-heading text-mutedForeground">
          <p>Friendly game help from FAQs &amp; How To only. No player or account lookups.</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            <Link to="/social/forum" className="text-primary hover:underline">Open full guides</Link>
            <Link to="/game/help-desk" className="text-primary hover:underline inline-flex items-center gap-1">
              <HelpCircle size={11} /> Account issue? Help Desk
            </Link>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3">
          {messages.map((message) => (
            message.role === 'user' ? (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-lg rounded-tr-sm px-3 py-2 text-[12px] font-heading bg-primary/20 border border-primary/30 text-foreground">
                  {message.text}
                </div>
              </div>
            ) : (() => {
              const presentation = answerPresentation(message);
              const AnswerIcon = presentation.icon;
              const confidenceLabel = message.confidence === 'high'
                ? 'Best match'
                : message.confidence === 'medium'
                  ? 'Close match'
                  : 'Needs confirmation';
              return (
              <div key={message.id} className="flex justify-start">
                <div className={`max-w-[96%] rounded-lg rounded-tl-sm px-3 py-2 border ${
                  message.refused
                    ? 'border-red-500/30 bg-red-500/5'
                    : message.chat
                      ? 'border-primary/20 bg-primary/5'
                      : presentation.tone
                }`}>
                  <GuideIdentity />
                  {!message.refused && !message.chat && (
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full border border-current/20 px-2 py-0.5 text-[8px] uppercase tracking-wider font-heading font-bold text-primary">
                        <AnswerIcon size={10} /> {presentation.label}
                      </span>
                      {message.confidence && (
                        <span className={`text-[8px] font-heading ${
                          message.confidence === 'low' ? 'text-amber-400' : 'text-mutedForeground'
                        }`}>
                          {confidenceLabel}
                        </span>
                      )}
                    </div>
                  )}
                  {message.typoCorrections?.length > 0 && (
                    <p className="mb-2 text-[9px] font-heading text-mutedForeground">
                      Matched {message.typoCorrections.map((item) => `${item.from} → ${item.to}`).join(', ')}
                    </p>
                  )}
                  {message.preamble && (
                    <p className="mb-2 text-[11px] font-heading text-foreground">{message.preamble}</p>
                  )}
                  {message.wealth && (
                    <div className="mb-2 text-[12px] font-heading text-foreground">
                      <strong style={{ color: message.wealth.color || 'var(--noir-primary)' }}>
                        {message.wealth.name}
                      </strong>
                      {' '}(tier {message.wealth.id}) for ${Number(message.wealth.amount || 0).toLocaleString()} cash on hand.
                      {' '}{message.wealth.note}
                    </div>
                  )}
                  <div className={message.answerType === 'comparison' ? 'grid gap-2 md:grid-cols-2' : ''}>
                    {(message.sections || []).map((section, index) => (
                      <div
                        key={`${message.id}-${index}`}
                        className={`mb-2 last:mb-0 ${
                          message.answerType === 'comparison'
                            ? 'rounded-md border border-violet-400/15 bg-background/20 p-2'
                            : ''
                        }`}
                      >
                      {section.source !== 'system' && (
                        <Link
                          to="/social/forum"
                          className="mb-1.5 inline-flex rounded-full border border-primary/25 bg-primary/8 px-2 py-0.5 text-[8px] uppercase tracking-wider font-heading font-bold text-primary hover:bg-primary/15"
                        >
                          {sourceName(section.source)} · {section.category || section.title}
                          {section.title && section.title !== section.category ? ` · ${section.title}` : ''}
                        </Link>
                      )}
                      <div
                        className="guide-faq-body text-foreground"
                        dangerouslySetInnerHTML={{ __html: parseForumContent(section.body || '') }}
                      />
                    </div>
                    ))}
                  </div>
                  {(message.choices?.length > 0 || message.suggestions?.length > 0) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {[...(message.choices || []).map((choice) => choice.message || choice.label), ...(message.suggestions || [])]
                        .filter((choice, index, all) => choice && all.indexOf(choice) === index)
                        .slice(0, 6)
                        .map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            disabled={sending}
                            onClick={() => send(choice)}
                            className="min-h-7 rounded-full border border-primary/30 px-2 py-1 text-[9px] font-heading text-primary hover:bg-primary/15 disabled:opacity-40 touch-manipulation"
                          >
                            {choice}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
              );
            })()
          ))}
          {sending && <TypingBubble />}
          <div ref={bottomRef} />
        </div>

        <div className="sticky bottom-0 border-t border-primary/15 bg-[var(--noir-content)] px-2 py-2 space-y-2">
          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
              {[...new Set([...STARTER_SUGGESTIONS, ...categories.slice(0, 8)])].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={sending}
                  onClick={() => send(suggestion)}
                  className="min-h-7 rounded-full border border-primary/30 px-2 py-1 text-[9px] font-heading text-primary hover:bg-primary/15 disabled:opacity-40 touch-manipulation"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={onSubmit} className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
              maxLength={400}
              rows={1}
              disabled={sending}
              placeholder="Say hello or ask a game question…"
              className="min-h-10 max-h-24 flex-1 resize-y rounded-md border border-primary/20 bg-secondary px-2 py-2 text-[12px] font-heading text-foreground"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="inline-flex min-h-10 items-center gap-1 rounded-md border border-primary/50 bg-primary/20 px-3 py-2 text-[10px] uppercase font-heading font-bold text-primary hover:bg-primary/30 disabled:opacity-40 touch-manipulation"
            >
              <Send size={13} /> Ask
            </button>
          </form>
          <p className="text-[8px] font-heading text-mutedForeground">Enter to send · Shift+Enter for a new line</p>
        </div>
      </div>
    </div>
  );
}

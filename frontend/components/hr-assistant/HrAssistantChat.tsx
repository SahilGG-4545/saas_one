'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { FolderCog, Loader2, SendHorizontal, ShieldAlert, User, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react';

import { BotFace } from './BotFace';

const MAX_QUESTION_LENGTH = 1000;

const SUGGESTIONS = [
    'How many paid annual leave days do I get?',
    'What is the notice period during probation?',
    'Can I work from home every day?',
];

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    blocked?: boolean;
    error?: boolean;
}

interface AskResponse {
    answer?: string;
    blocked?: 'input' | 'output' | null;
    error?: string;
}

// The conversation lives outside React so it survives the bot remounting when the
// dashboard layout switches branches between pages. A full page reload clears it.
interface ChatState {
    messages: Message[];
    pending: boolean;
}

let chatState: ChatState = { messages: [], pending: false };
let chatOwnerId: string | null = null;
const listeners = new Set<() => void>();

function setChatState(update: (prev: ChatState) => ChatState) {
    chatState = update(chatState);
    listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

const getSnapshot = () => chatState;
const getPending = () => chatState.pending;

/** True while a question is waiting on an answer; lets the launcher show it is thinking. */
export function useHrChatPending() {
    return useSyncExternalStore(subscribe, getPending, getPending);
}

/** Start a fresh conversation when a different user signs in on the same tab. */
export function claimHrChat(userId: string) {
    if (chatOwnerId === userId) return;
    chatOwnerId = userId;
    setChatState(() => ({ messages: [], pending: false }));
}

async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || chatState.pending) return;

    setChatState(prev => ({
        pending: true,
        messages: [...prev.messages, { id: crypto.randomUUID(), role: 'user', content: trimmed }],
    }));

    let reply: Message;
    try {
        const res = await fetch('/api/hr-assistant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: trimmed }),
        });
        const data = (await res.json()) as AskResponse;
        reply = res.ok
            ? { id: crypto.randomUUID(), role: 'assistant', content: data.answer ?? '', blocked: Boolean(data.blocked) }
            : { id: crypto.randomUUID(), role: 'assistant', content: data.error ?? 'Something went wrong.', error: true };
    } catch {
        reply = { id: crypto.randomUUID(), role: 'assistant', content: 'Network error. Please try again.', error: true };
    }
    setChatState(prev => ({ pending: false, messages: [...prev.messages, reply] }));
}

interface HrAssistantChatProps {
    /** Where the "Manage documents" link goes; hidden when not set (non-admins). */
    documentsHref?: string | null;
    onClose: () => void;
}

export function HrAssistantChat({ documentsHref, onClose }: HrAssistantChatProps) {
    const { messages, pending } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const [input, setInput] = useState('');
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages, pending]);

    function submit(question: string) {
        if (!question.trim() || pending) return;
        setInput('');
        void send(question);
    }

    function onSubmit(event: FormEvent) {
        event.preventDefault();
        submit(input);
    }

    function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit(input);
        }
    }

    return (
        <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
            <header className="flex items-center gap-3 bg-primary px-4 py-3 text-white">
                <BotFace className="size-10 shrink-0" mood={pending ? 'thinking' : 'idle'} />
                <div className="min-w-0 flex-1">
                    <h2 className="font-display text-sm font-bold leading-tight">HR Policy Assistant</h2>
                    <p className="text-xs text-white/80">Ask anything about the company HR policy.</p>
                </div>
                {documentsHref && (
                    <Link
                        href={documentsHref}
                        onClick={onClose}
                        title="Manage documents"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1.5 text-xs font-semibold transition hover:bg-white/25"
                    >
                        <FolderCog className="size-4" aria-hidden />
                        <span className="hidden sm:inline">Documents</span>
                    </Link>
                )}
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close HR assistant"
                    className="rounded-lg p-1.5 transition hover:bg-white/15"
                >
                    <X className="size-4" aria-hidden />
                </button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-background px-4 py-5" aria-live="polite">
                {messages.length === 0 && !pending && (
                    <div className="flex flex-col items-center gap-3 pt-4 text-center">
                        <BotFace className="size-16" />
                        <p className="font-display text-sm font-semibold text-text-primary">Hi! How can I help?</p>
                        <p className="text-xs text-text-secondary">Try one of these:</p>
                        <div className="flex flex-col items-stretch gap-2">
                            {SUGGESTIONS.map(suggestion => (
                                <button
                                    key={suggestion}
                                    type="button"
                                    onClick={() => submit(suggestion)}
                                    className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-primary transition hover:border-primary hover:bg-primary/10"
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <AnimatePresence initial={false}>
                    {messages.map(message => (
                        <motion.div
                            key={message.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2 }}
                            className={`flex gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                        >
                            {message.role === 'user' ? (
                                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-text-secondary">
                                    <User className="size-3.5" aria-hidden />
                                </div>
                            ) : (
                                <BotFace className="size-7 shrink-0" />
                            )}
                            <div
                                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                                    message.role === 'user'
                                        ? 'rounded-tr-sm bg-primary text-white'
                                        : message.blocked || message.error
                                          ? 'flex items-start gap-2 rounded-tl-sm bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                                          : 'rounded-tl-sm border border-border bg-surface text-text-primary'
                                }`}
                            >
                                {(message.blocked || message.error) && (
                                    <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                                )}
                                <span>{message.content}</span>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {pending && (
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                        <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                        Checking the policy...
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-border bg-surface p-3">
                <label htmlFor="hr-assistant-input" className="sr-only">
                    Ask a question about HR policy
                </label>
                <textarea
                    id="hr-assistant-input"
                    ref={inputRef}
                    value={input}
                    onChange={event => setInput(event.target.value)}
                    onKeyDown={onKeyDown}
                    maxLength={MAX_QUESTION_LENGTH}
                    rows={1}
                    placeholder="Ask about leave, WFH, notice period..."
                    className="max-h-32 min-h-10 flex-1 resize-none rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-smooth placeholder:text-text-tertiary hover:border-primary/50 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary"
                />
                <button
                    type="submit"
                    disabled={pending || !input.trim()}
                    aria-label="Send"
                    className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-primary text-white transition hover:bg-primary-dark disabled:opacity-40"
                >
                    <SendHorizontal className="size-4" aria-hidden />
                </button>
            </form>
        </section>
    );
}

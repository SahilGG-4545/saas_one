'use client';
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
const subscribe = () => () => {};
export default function WorkflowModal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
    const mounted = useSyncExternalStore(subscribe, () => true, () => false);
    const panel = useRef<HTMLElement>(null);
    useEffect(() => {
        if (!mounted) return;
        const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        panel.current?.focus();
        return () => { before?.focus(); };
    }, [mounted]);
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !busy) onClose();
            if (event.key === 'Tab') {
                const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') || []);
                const first = items[0]; const last = items[items.length - 1];
                if (!first) { event.preventDefault(); return; }
                if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
            }
        };
        window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
    }, [onClose, busy]);
    if (!mounted) return null;
    return createPortal(<div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-3 sm:p-6" role="presentation">
        <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-4xl max-h-[90dvh] overflow-y-auto rounded-2xl bg-surface text-text-primary shadow-2xl p-4 sm:p-6 space-y-4">
            <div className="flex justify-between items-center gap-4"><h2 className="text-xl font-bold">{title}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Close dialog" className="p-2 rounded-lg border border-border">Close</button></div>
            {children}
        </section>
    </div>, document.body);
}

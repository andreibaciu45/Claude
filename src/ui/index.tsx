// STUB del contratto UI — l'agente DESIGN lo sostituisce mantenendo ESATTAMENTE questi export e props.
import React, { createContext, useContext, useState } from 'react';

export const Button = ({ variant = 'primary', size = 'md', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg' }) => <button data-variant={variant} data-size={size} {...p} />;
export const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>;
export const Field = ({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) => (<label><span>{label}</span>{children}{hint && <small>{hint}</small>}{error && <small role="alert">{error}</small>}</label>);
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} />;
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} />;
export const Sheet = ({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) => open ? (<div role="dialog" aria-label={title}><button onClick={onClose}>×</button><h3>{title}</h3>{children}</div>) : null;
export const Badge = ({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; children: React.ReactNode }) => <span data-tone={tone}>{children}</span>;
export const EmptyState = ({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) => (<div><h3>{title}</h3>{text && <p>{text}</p>}{action}</div>);
export const PageHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) => (<header><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}{actions}</header>);
export const Money = ({ value }: { value: number }) => <>{new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)}</>;

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [msg, setMsg] = useState('');
  return (<ToastCtx.Provider value={(m) => { setMsg(m); setTimeout(() => setMsg(''), 2500); }}>{children}{msg && <div role="status">{msg}</div>}</ToastCtx.Provider>);
};

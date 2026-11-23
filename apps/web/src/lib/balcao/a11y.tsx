'use client';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/** Preferências de acessibilidade do operador (persistem no navegador): tamanho da fonte, alto contraste, redução de movimento, Libras (VLibras). */
export interface A11yPrefs { font: 'sm' | 'md' | 'lg' | 'xl'; contrast: 'normal' | 'high'; motion: 'auto' | 'reduce'; libras: boolean }
const DEFAULTS: A11yPrefs = { font: 'md', contrast: 'normal', motion: 'auto', libras: false };
const KEY = 'bv_a11y';

const Ctx = createContext<{ prefs: A11yPrefs; set: (p: Partial<A11yPrefs>) => void }>({ prefs: DEFAULTS, set: () => undefined });
export const useA11y = () => useContext(Ctx);

function loadVLibras() {
  if (typeof document === 'undefined' || document.getElementById('bv-vlibras')) return;
  const host = document.createElement('div');
  host.id = 'bv-vlibras';
  host.setAttribute('vw', '');
  host.className = 'enabled';
  host.innerHTML = '<div vw-access-button class="active"></div><div vw-plugin-wrapper><div class="vw-plugin-top-wrapper"></div></div>';
  document.body.appendChild(host);
  const s = document.createElement('script');
  s.src = 'https://vlibras.gov.br/app/vlibras-plugin.js';
  s.async = true;
  s.onload = () => { try { (window as any).VLibras && new (window as any).VLibras.Widget('https://vlibras.gov.br/app'); } catch { /* indisponível offline */ } };
  document.body.appendChild(s);
}

export function A11yProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<A11yPrefs>(DEFAULTS);
  useEffect(() => { try { const raw = localStorage.getItem(KEY); if (raw) setPrefs({ ...DEFAULTS, ...JSON.parse(raw) }); } catch { /* storage indisponível */ } }, []);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.bvFont = prefs.font; el.dataset.bvContrast = prefs.contrast; el.dataset.bvMotion = prefs.motion;
    if (prefs.libras) loadVLibras(); else document.getElementById('bv-vlibras')?.remove();
  }, [prefs]);
  const set = useCallback((p: Partial<A11yPrefs>) => setPrefs((cur) => { const n = { ...cur, ...p }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* noop */ } return n; }), []);
  return <Ctx.Provider value={{ prefs, set }}>{children}</Ctx.Provider>;
}

/** Barra de acessibilidade do cabeçalho (A−/A+, contraste, Libras). */
export function A11yToolbar() {
  const { prefs, set } = useA11y();
  const order: A11yPrefs['font'][] = ['sm', 'md', 'lg', 'xl'];
  const idx = order.indexOf(prefs.font);
  const btn = 'min-h-[36px] min-w-[36px] rounded-md border border-bv-border bg-bv-surface px-2 text-sm hover:bg-bv-subtle';
  return (
    <div role="group" aria-label="Acessibilidade" className="flex items-center gap-1">
      <button type="button" className={btn} aria-label="Diminuir fonte" disabled={idx === 0} onClick={() => set({ font: order[idx - 1] })}>A−</button>
      <button type="button" className={btn} aria-label="Aumentar fonte" disabled={idx === order.length - 1} onClick={() => set({ font: order[idx + 1] })}>A+</button>
      <button type="button" className={btn} aria-pressed={prefs.contrast === 'high'} onClick={() => set({ contrast: prefs.contrast === 'high' ? 'normal' : 'high' })}>Alto contraste</button>
      <button type="button" className={btn} aria-pressed={prefs.libras} onClick={() => set({ libras: !prefs.libras })}>Libras</button>
    </div>
  );
}

/**
 * Riconoscimento del ritorno da Stripe Checkout / Portale.
 * Il server deve impostare STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL su `<app>/#/account?checkout=success` e
 * `<app>/#/account?checkout=cancel` (la app usa HashRouter; si accetta anche `?checkout=` prima dell'hash).
 */
export type CheckoutReturn = 'success' | 'cancel' | null;

export function parseCheckoutReturn(search: string, hash: string): CheckoutReturn {
  const read = (q: string): string | null => {
    try { return new URLSearchParams(q.startsWith('?') ? q : `?${q}`).get('checkout'); } catch { return null; }
  };
  const qi = hash.indexOf('?');
  const v = read(search) ?? (qi >= 0 ? read(hash.slice(qi + 1)) : null);
  return v === 'success' || v === 'cancel' ? v : null;
}

/** Rimuove il parametro `checkout` dall'URL corrente (senza ricaricare) così un refresh non ripete il messaggio. */
export function stripCheckoutParam(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.delete('checkout');
    const qi = u.hash.indexOf('?');
    if (qi >= 0) {
      const p = new URLSearchParams(u.hash.slice(qi + 1));
      p.delete('checkout');
      const rest = p.toString();
      u.hash = u.hash.slice(0, qi) + (rest ? `?${rest}` : '');
    }
    return u.toString();
  } catch { return href; }
}

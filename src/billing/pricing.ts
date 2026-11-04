/**
 * Prezzi e limiti dei piani: UNICA fonte per l'app e per la pagina Informazioni (LandingPage).
 * Sono ipotesi di lavoro (docs/PRICING.md); il prezzo realmente addebitato è quello del prezzo Stripe
 * configurato sul server (STRIPE_PRICE_MONTH / STRIPE_PRICE_YEAR): tenere i due valori allineati.
 */
export const FREE_DOCS_PER_MONTH = 3;
export const PRO_PRICE_MONTH = 15;
export const PRO_PRICE_YEAR = 120;

export const formatEur = (n: number): string =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

/** Risparmio annuale rispetto a 12 mensilità. */
export const PRO_YEARLY_SAVING = PRO_PRICE_MONTH * 12 - PRO_PRICE_YEAR;

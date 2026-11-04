import { LEGAL_LINKS } from '../../sync/legal';
import { a } from './styles';

/** Accettazione obbligatoria (mai preselezionata) di Termini, Informativa privacy e DPA, con link ai documenti. */
export function TermsCheckbox({ checked, onChange, error }: { checked: boolean; onChange: (v: boolean) => void; error?: string }) {
  return (
    <div style={a.stack}>
      <label style={a.checkRow}>
        <input
          type="checkbox" style={a.checkBox} checked={checked} onChange={(e) => onChange(e.target.checked)}
          aria-invalid={!!error} aria-describedby={error ? 'terms-err' : undefined} required
        />
        <span>
          Ho letto{' '}
          <a href={LEGAL_LINKS.termini()} target="_blank" rel="noopener noreferrer">i Termini di servizio</a>,{' '}
          <a href={LEGAL_LINKS.privacy()} target="_blank" rel="noopener noreferrer">l’Informativa sulla privacy</a> e{' '}
          <a href={LEGAL_LINKS.dpa()} target="_blank" rel="noopener noreferrer">l’accordo sul trattamento dei dati (DPA)</a>{' '}
          e li accetto.
        </span>
      </label>
      {error && <p id="terms-err" style={a.error} role="alert">{error}</p>}
    </div>
  );
}

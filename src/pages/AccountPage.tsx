import { useEffect } from 'react';
import { PageHeader } from '../ui';
import { api } from '../sync/api';
import { syncEngine } from '../sync/engine';
import { useSyncStatus } from '../sync/useSyncStatus';
import { AccountView } from './account/AccountView';
import { LoginForm } from './account/LoginForm';
import { MigrationCard } from './account/MigrationCard';
import { a } from './account/styles';

/** Pagina /account (React.lazy-friendly: export default). L'account è opzionale. */
export default function AccountPage() {
  const st = useSyncStatus();
  useEffect(() => { if (st.signedIn) void syncEngine.refreshMe(); }, [st.signedIn]);

  return (
    <div style={a.page}>
      <PageHeader title="Account" subtitle="Facoltativo: serve per sincronizzare più dispositivi." />
      {!st.signedIn ? <LoginForm engine={syncEngine} /> : (
        <>
          {st.migration && <MigrationCard preview={st.migration} engine={syncEngine} foreignData={st.foreignData} />}
          <AccountView engine={syncEngine} api={api} />
        </>
      )}
    </div>
  );
}

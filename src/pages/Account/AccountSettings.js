import { useState } from 'react';
import { Globe, Spade } from 'lucide-react';
import styles from '../../styles/noir.module.css';
import IPRules from './IPRules';
import BlackjackCardsSettings from './BlackjackCardsSettings';

const TAB_KEY = 'mafia_account_settings_tab_v1';

export default function AccountSettings() {
  const [tab, setTab] = useState(() => {
    try {
      return sessionStorage.getItem(TAB_KEY) === 'blackjack' ? 'blackjack' : 'connection';
    } catch {
      return 'connection';
    }
  });

  const selectTab = (id) => {
    setTab(id);
    try {
      sessionStorage.setItem(TAB_KEY, id);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className={`${styles.pageContent} mobile-page-root space-y-2`} data-page="account-settings">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => selectTab('connection')}
          className={`${styles.surface} px-3 py-1.5 text-[10px] font-heading uppercase tracking-wider inline-flex items-center gap-1.5 ${
            tab === 'connection' ? 'border-primary/50 text-primary' : 'text-mutedForeground'
          }`}
        >
          <Globe size={12} />
          Sessions / IP
        </button>
        <button
          type="button"
          onClick={() => selectTab('blackjack')}
          className={`${styles.surface} px-3 py-1.5 text-[10px] font-heading uppercase tracking-wider inline-flex items-center gap-1.5 ${
            tab === 'blackjack' ? 'border-primary/50 text-primary' : 'text-mutedForeground'
          }`}
        >
          <Spade size={12} />
          Blackjack Cards
        </button>
      </div>
      {tab === 'blackjack' ? <BlackjackCardsSettings /> : <IPRules />}
    </div>
  );
}

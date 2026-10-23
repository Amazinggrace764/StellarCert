export default function Footer(): JSX.Element {
  return (
    <footer className="no-print border-t border-gray-200 dark:border-white/10 bg-white dark:bg-slate-950/80 transition-colors duration-250">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-gray-600 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8 transition-colors duration-250">
        <p>Built for trusted credential issuance and instant verification.</p>
        <p>StellarCert © 2026</p>
      </div>
    </footer>
  );
}

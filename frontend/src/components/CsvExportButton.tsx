import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

interface Props {
  onExport: () => Promise<void>;
  label?: string;
}

export function CsvExportButton({ onExport, label = "Export CSV" }: Props) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  async function handleClick() {
    setLoading(true);
    setProgress(10);
    try {
      const interval = setInterval(() => {
        setProgress((p) => (p < 85 ? p + 15 : p));
      }, 300);
      await onExport();
      clearInterval(interval);
      setProgress(100);
      setTimeout(() => { setLoading(false); setProgress(0); }, 600);
    } catch {
      setLoading(false);
      setProgress(0);
    }
  }

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <button
        onClick={handleClick}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {loading ? "Exporting…" : label}
      </button>
      {loading && (
        <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default CsvExportButton;

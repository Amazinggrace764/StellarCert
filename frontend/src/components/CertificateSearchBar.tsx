import { Search, X } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function CertificateSearchBar({ value, onChange, placeholder = "Search certificates…" }: Props) {
  return (
    <div className="relative flex items-center">
      <Search className="absolute left-3 w-4 h-4 text-gray-400 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-9 py-2 border rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-3 text-gray-400 hover:text-gray-600"
          aria-label="Clear search"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export default CertificateSearchBar;

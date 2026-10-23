import { useNavigate, useLocation } from "react-router-dom";
import { ShieldOff, MoveLeft, Home } from "lucide-react";

export default function NotFound() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4 select-none">
      {/* Glowing icon */}
      <div className="relative mb-8">
        <div className="absolute inset-0 rounded-full bg-red-500/20 blur-2xl scale-150" />
        <div className="relative bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-full p-6">
          <ShieldOff className="w-14 h-14 text-red-500 dark:text-red-400" />
        </div>
      </div>

      {/* Status code */}
      <p className="text-sm font-semibold tracking-widest uppercase text-red-500 dark:text-red-400 mb-2">
        Error 404
      </p>

      {/* Heading */}
      <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-3">
        Page Not Found
      </h1>

      {/* Path pill */}
      <p className="text-gray-500 dark:text-slate-400 mb-2">
        The path{" "}
        <code className="mx-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 text-sm font-mono border border-gray-200 dark:border-slate-700">
          {location.pathname}
        </code>{" "}
        does not exist.
      </p>

      <p className="text-sm text-gray-400 dark:text-slate-500 mb-10 max-w-sm">
        It may have been moved, removed, or you may have followed a broken
        link.
      </p>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-sm font-medium"
        >
          <MoveLeft className="w-4 h-4" />
          Go Back
        </button>
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors text-sm font-medium"
        >
          <Home className="w-4 h-4" />
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}
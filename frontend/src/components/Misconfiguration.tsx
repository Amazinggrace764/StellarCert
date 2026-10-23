import React from 'react';

const Misconfiguration: React.FC<{ error: Error }> = ({ error }) => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-red-50 dark:bg-red-900/20 p-6">
      <div className="max-w-xl space-y-6">
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0">
            <svg className="h-12 w-12 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-bold text-red-600 dark:text-red-400">Misconfiguration Detected</h2>
            <p className="text-red-600 dark:text-red-400">
              The application cannot start due to a missing or invalid configuration.
            </p>
            <p className="mt-2 text-sm text-red-500 dark:text-red-300 break-all">
              {error.message}
            </p>
            <div className="mt-4 pt-2 border-t border-red-200 dark:border-red-700">
              <p className="text-xs text-red-500 dark:text-red-300">
                Please check your environment variables and restart the application.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Misconfiguration;
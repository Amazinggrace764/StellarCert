import { useState } from 'react';
import CertificateTable from '../components/CertificateTable';
import { AlertCircle, CheckCircle } from 'lucide-react';

const CertificateManagementPage = () => {
    const [notification, setNotification] = useState<{
        type: 'success' | 'error';
        message: string;
    } | null>(null);

    const handleSuccess = (message: string) => {
        setNotification({ type: 'success', message });
        setTimeout(() => setNotification(null), 3000);
    };

    const handleError = (message: string) => {
        setNotification({ type: 'error', message });
        setTimeout(() => setNotification(null), 3000);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                        Certificate Management
                    </h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                        Manage, search, and filter your certificates. Freeze certificates during disputes.
                    </p>
                </div>
            </div>

            {/* Notification */}
            {notification && (
                <div
                    className={`flex items-center gap-2 p-4 rounded-lg ${
                        notification.type === 'success'
                            ? 'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                            : 'bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200'
                    }`}
                >
                    {notification.type === 'success' ? (
                        <CheckCircle className="w-5 h-5" />
                    ) : (
                        <AlertCircle className="w-5 h-5" />
                    )}
                    {notification.message}
                </div>
            )}

            {/* Certificate Table */}
            <CertificateTable
                onError={handleError}
                onSuccess={handleSuccess}
            />
        </div>
    );
};

export default CertificateManagementPage;

import React, { useState } from "react";



interface IssueCertificateFormData {
  recipientName: string;
  recipientEmail: string;
  recipientWallet: string;
  certificateTitle: string;
  description: string;
  issuerName: string;
  expiryDate: string;
}

const IssueCertificate: React.FC = () => {
  const [formData, setFormData] = useState<IssueCertificateFormData>({
    recipientName: "",
    recipientEmail: "",
    recipientWallet: "",
    certificateTitle: "",
    description: "",
    issuerName: "",
    expiryDate: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<IssueCertificateFormData>>({});

  const validate = (): boolean => {
    const newErrors: Partial<IssueCertificateFormData> = {};

    if (!formData.recipientName.trim())
      newErrors.recipientName = "Recipient name is required";
    if (!formData.recipientEmail.trim())
      newErrors.recipientEmail = "Recipient email is required";
    else if (!/\S+@\S+\.\S+/.test(formData.recipientEmail))
      newErrors.recipientEmail = "Invalid email address";
    if (!formData.recipientWallet.trim())
      newErrors.recipientWallet = "Stellar wallet address is required";
    if (!formData.certificateTitle.trim())
      newErrors.certificateTitle = "Certificate title is required";
    if (!formData.issuerName.trim())
      newErrors.issuerName = "Issuer name is required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof IssueCertificateFormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setIsSubmitting(true);
    // Simulate async submission
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setIsSubmitting(false);
    alert("Certificate issued successfully on the Stellar network!");
  };

  const inputBase =
    "w-full px-4 py-2.5 rounded-lg border text-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 " +
    "bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-blue-500 focus:ring-offset-white " +
    "dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-blue-400 dark:focus:ring-blue-400 dark:focus:ring-offset-gray-900";

  const inputError =
    "border-red-400 focus:border-red-500 focus:ring-red-500 dark:border-red-500 dark:focus:border-red-400 dark:focus:ring-red-400";

  const labelBase =
    "block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300";

  const errorText = "mt-1 text-xs text-red-500 dark:text-red-400";


  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-start justify-center px-4 py-10 transition-colors duration-300">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-lg bg-blue-600 dark:bg-blue-500 flex items-center justify-center shrink-0">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
              Issue Certificate
            </h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 ml-12">
            Issue a verifiable certificate on the Stellar blockchain network.
          </p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm dark:shadow-none p-8 transition-colors duration-300">
          <form onSubmit={handleSubmit} noValidate>
            {/* Section: Recipient */}
            <fieldset className="mb-7">
              <legend className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-4">
                Recipient Details
              </legend>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Recipient Name */}
                <div>
                  <label htmlFor="recipientName" className={labelBase}>
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="recipientName"
                    name="recipientName"
                    type="text"
                    placeholder="Jane Doe"
                    value={formData.recipientName}
                    onChange={handleChange}
                    className={`${inputBase} ${errors.recipientName ? inputError : ""}`}
                  />
                  {errors.recipientName && (
                    <p className={errorText}>{errors.recipientName}</p>
                  )}
                </div>

                {/* Recipient Email */}
                <div>
                  <label htmlFor="recipientEmail" className={labelBase}>
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="recipientEmail"
                    name="recipientEmail"
                    type="email"
                    placeholder="jane@example.com"
                    value={formData.recipientEmail}
                    onChange={handleChange}
                    className={`${inputBase} ${errors.recipientEmail ? inputError : ""}`}
                  />
                  {errors.recipientEmail && (
                    <p className={errorText}>{errors.recipientEmail}</p>
                  )}
                </div>
              </div>

              {/* Stellar Wallet */}
              <div className="mt-5">
                <label htmlFor="recipientWallet" className={labelBase}>
                  Stellar Wallet Address <span className="text-red-500">*</span>
                </label>
                <input
                  id="recipientWallet"
                  name="recipientWallet"
                  type="text"
                  placeholder="G..."
                  value={formData.recipientWallet}
                  onChange={handleChange}
                  className={`${inputBase} font-mono text-xs ${errors.recipientWallet ? inputError : ""}`}
                />
                {errors.recipientWallet && (
                  <p className={errorText}>{errors.recipientWallet}</p>
                )}
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  The recipient&apos;s public Stellar account address (starts with G)
                </p>
              </div>
            </fieldset>

            <hr className="border-gray-100 dark:border-gray-800 mb-7" />

            {/* Section: Certificate */}
            <fieldset className="mb-7">
              <legend className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-4">
                Certificate Details
              </legend>

              {/* Certificate Title */}
              <div className="mb-5">
                <label htmlFor="certificateTitle" className={labelBase}>
                  Certificate Title <span className="text-red-500">*</span>
                </label>
                <input
                  id="certificateTitle"
                  name="certificateTitle"
                  type="text"
                  placeholder="e.g. Certified Blockchain Developer"
                  value={formData.certificateTitle}
                  onChange={handleChange}
                  className={`${inputBase} ${errors.certificateTitle ? inputError : ""}`}
                />
                {errors.certificateTitle && (
                  <p className={errorText}>{errors.certificateTitle}</p>
                )}
              </div>

              {/* Description */}
              <div className="mb-5">
                <label htmlFor="description" className={labelBase}>
                  Description{" "}
                  <span className="text-gray-400 dark:text-gray-500 font-normal">
                    (optional)
                  </span>
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={3}
                  placeholder="Describe the achievement or qualification being certified..."
                  value={formData.description}
                  onChange={handleChange}
                  className={`${inputBase} resize-none`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Issuer Name */}
                <div>
                  <label htmlFor="issuerName" className={labelBase}>
                    Issuer / Organization{" "}
                    <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="issuerName"
                    name="issuerName"
                    type="text"
                    placeholder="Acme Academy"
                    value={formData.issuerName}
                    onChange={handleChange}
                    className={`${inputBase} ${errors.issuerName ? inputError : ""}`}
                  />
                  {errors.issuerName && (
                    <p className={errorText}>{errors.issuerName}</p>
                  )}
                </div>

                {/* Expiry Date */}
                <div>
                  <label htmlFor="expiryDate" className={labelBase}>
                    Expiry Date{" "}
                    <span className="text-gray-400 dark:text-gray-500 font-normal">
                      (optional)
                    </span>
                  </label>
                  <input
                    id="expiryDate"
                    name="expiryDate"
                    type="date"
                    value={formData.expiryDate}
                    onChange={handleChange}
                    className={`${inputBase} dark:[color-scheme:dark]`}
                  />
                </div>
              </div>
            </fieldset>

            {/* Network Badge */}
            <div className="mb-7 flex items-center gap-2.5 px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 dark:bg-blue-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500 dark:bg-blue-400" />
              </span>
              <p className="text-xs text-blue-700 dark:text-blue-300">
                This certificate will be issued on the{" "}
                <strong>Stellar Testnet</strong>. Ensure your wallet has
                sufficient XLM for the transaction fee.
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                className="px-5 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 transition-colors duration-150 dark:border-gray-600 dark:text-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 dark:focus:ring-gray-500 dark:focus:ring-offset-gray-900"
                onClick={() =>
                  setFormData({
                    recipientName: "",
                    recipientEmail: "",
                    recipientWallet: "",
                    certificateTitle: "",
                    description: "",
                    issuerName: "",
                    expiryDate: "",
                  })
                }
              >
                Clear
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2.5 text-sm font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-150 dark:bg-blue-500 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-900 flex items-center gap-2"
              >
                {isSubmitting && (
                  <svg
                    className="animate-spin h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                )}
                {isSubmitting ? "Issuing…" : "Issue Certificate"}
              </button>
            </div>
          </form>
        </div>

        {/* Footer note */}
        <p className="mt-5 text-center text-xs text-gray-400 dark:text-gray-600">
          StellarCert · Powered by the Stellar blockchain
        </p>
      </div>
    </div>
  );
};

export default IssueCertificate;
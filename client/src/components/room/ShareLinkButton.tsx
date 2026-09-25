import { useState } from 'react';

export function ShareLinkButton() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for older browsers or permission issues
      const input = document.createElement('input');
      input.value = window.location.href;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      title="Copy room invite link"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: 500,
        fontFamily: 'system-ui, sans-serif',
        color: copied ? '#4ade80' : '#e5e7eb',
        background: copied ? 'rgba(74, 222, 128, 0.12)' : 'var(--control-bg)',
        border: `1px solid ${copied ? '#4ade8055' : '#3a3a3a'}`,
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        outline: 'none',
      }}
      onMouseEnter={(e) => {
        if (!copied) {
          e.currentTarget.style.background = '#333333';
          e.currentTarget.style.borderColor = '#525252';
        }
      }}
      onMouseLeave={(e) => {
        if (!copied) {
          e.currentTarget.style.background = 'var(--control-bg)';
          e.currentTarget.style.borderColor = '#3a3a3a';
        }
      }}
    >
      {copied ? (
        <>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Copied!</span>
        </>
      ) : (
        <>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span>Share</span>
        </>
      )}
    </button>
  );
}

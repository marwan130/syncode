export function FileProblemCount({
  count,
  severity = 'error',
}: {
  count: number | undefined;
  severity?: 'error' | 'warning';
}) {
  if (!count) return null;

  const label = `${count} ${count === 1 ? 'problem' : 'problems'}`;
  return (
    <span
      className={`file-problem-count is-${severity}`}
      role="img"
      title={label}
      aria-label={label}
    >
      {count}
    </span>
  );
}

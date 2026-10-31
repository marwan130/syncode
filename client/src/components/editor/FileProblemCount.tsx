export function FileProblemCount({ count }: { count: number | undefined }) {
  if (!count) return null;

  const label = `${count} ${count === 1 ? 'problem' : 'problems'}`;
  return (
    <span
      className="file-problem-count"
      role="img"
      title={label}
      aria-label={label}
    >
      {count}
    </span>
  );
}

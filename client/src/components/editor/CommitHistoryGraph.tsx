import {
  getScmHistoryGraphPaths,
  scmHistoryRowHeight,
  type ScmHistoryGraphRow,
} from './scmHistoryGraph';

export function CommitHistoryGraph({
  row,
  width,
}: {
  row: ScmHistoryGraphRow;
  width: number;
}) {
  const centerX = 11 * (row.circleIndex + 1);
  const isMerge = row.commit.parents.length > 1;

  return (
    <svg
      className="source-control-commit-graph"
      width={width}
      height={scmHistoryRowHeight}
      viewBox={`0 0 ${width} ${scmHistoryRowHeight}`}
      aria-hidden="true"
      focusable="false"
    >
      {getScmHistoryGraphPaths(row).map((path) => (
        <path key={path.key} d={path.d} stroke={path.color} />
      ))}
      {isMerge ? (
        <>
          <circle
            className="is-merge"
            cx={centerX}
            cy={scmHistoryRowHeight / 2}
            r="5"
            stroke={row.circleColor}
          />
          <circle
            className="is-merge-core"
            cx={centerX}
            cy={scmHistoryRowHeight / 2}
            r="2"
            fill={row.circleColor}
          />
        </>
      ) : (
        <circle
          className={row.isHead ? 'is-head' : 'is-commit'}
          cx={centerX}
          cy={scmHistoryRowHeight / 2}
          r={row.isHead ? '4' : '3.5'}
          fill={row.isHead ? 'var(--surface-bg)' : row.circleColor}
          stroke={row.circleColor}
        />
      )}
    </svg>
  );
}

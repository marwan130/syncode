import type {
  GithubBranchOption,
  GithubCommitHistoryItem,
} from '../../github/repositoryBrowser';

const SWIMLANE_WIDTH = 11;
const SWIMLANE_HEIGHT = 22;
const CURVE_RADIUS = 5;

export interface ScmHistoryLane {
  id: string;
  color: string;
}

export interface ScmHistoryGraphRow {
  commit: GithubCommitHistoryItem;
  inputLanes: ScmHistoryLane[];
  outputLanes: ScmHistoryLane[];
  circleIndex: number;
  circleColor: string;
  isHead: boolean;
}

export interface ScmHistoryGraphPath {
  key: string;
  color: string;
  d: string;
}

export const scmHistoryRowHeight = SWIMLANE_HEIGHT;

export function buildScmHistoryGraphRows(
  history: GithubCommitHistoryItem[],
  branches: GithubBranchOption[],
  currentBranch: string,
  colors: string[]
): ScmHistoryGraphRow[] {
  const colorsByBranch = createBranchColorMap(branches, currentBranch, colors);
  const branchesByCommit = groupBranchesByCommit(branches);
  const nextLaneColor = createNextLaneColor(colors);
  const currentHeadSha = branches.find(
    (branch) => branch.name === currentBranch
  )?.sha;
  const rows: ScmHistoryGraphRow[] = [];

  for (const commit of history) {
    const inputLanes = rows.at(-1)?.outputLanes ?? [];
    const commitRefs = branchesByCommit.get(commit.sha) ?? [];
    const commitColor = getCommitColor(
      commitRefs,
      currentBranch,
      colorsByBranch
    );
    const outputLanes = buildOutputLanes(
      commit,
      inputLanes,
      commitColor,
      branchesByCommit,
      colorsByBranch,
      nextLaneColor
    );

    const inputIndex = inputLanes.findIndex((lane) => lane.id === commit.sha);
    const circleIndex = inputIndex >= 0 ? inputIndex : inputLanes.length;

    rows.push({
      commit,
      inputLanes: inputLanes.map((lane) => ({ ...lane })),
      outputLanes,
      circleIndex,
      circleColor: getCircleColor(
        outputLanes,
        inputLanes,
        circleIndex,
        commitColor,
        colors
      ),
      isHead: commit.sha === currentHeadSha,
    });
  }

  return rows;
}

function createBranchColorMap(
  branches: GithubBranchOption[],
  currentBranch: string,
  colors: string[]
): Map<string, string> {
  const colorsByBranch = new Map<string, string>();
  let nextBranchColor = 0;
  for (const branch of branches) {
    if (colorsByBranch.has(branch.name)) continue;
    const color =
      branch.name === currentBranch
        ? colors[0]
        : colors[(nextBranchColor % Math.max(1, colors.length - 1)) + 1];
    colorsByBranch.set(branch.name, color ?? colors[0] ?? 'rgb(0, 122, 204)');
    if (branch.name !== currentBranch) nextBranchColor++;
  }
  return colorsByBranch;
}

function groupBranchesByCommit(
  branches: GithubBranchOption[]
): Map<string, GithubBranchOption[]> {
  const branchesByCommit = new Map<string, GithubBranchOption[]>();
  for (const branch of branches) {
    const refs = branchesByCommit.get(branch.sha) ?? [];
    refs.push(branch);
    branchesByCommit.set(branch.sha, refs);
  }
  return branchesByCommit;
}

function createNextLaneColor(colors: string[]): () => string {
  let index = 0;
  return () => {
    const color = colors[index % colors.length] ?? 'rgb(0, 122, 204)';
    index++;
    return color;
  };
}

function getCommitColor(
  commitRefs: GithubBranchOption[],
  currentBranch: string,
  colorsByBranch: Map<string, string>
): string | undefined {
  if (
    colorsByBranch.get(currentBranch) &&
    commitRefs.some((branch) => branch.name === currentBranch)
  ) {
    return colorsByBranch.get(currentBranch);
  }
  return commitRefs.length > 0
    ? colorsByBranch.get(commitRefs[0].name)
    : undefined;
}

function buildOutputLanes(
  commit: GithubCommitHistoryItem,
  inputLanes: ScmHistoryLane[],
  commitColor: string | undefined,
  branchesByCommit: Map<string, GithubBranchOption[]>,
  colorsByBranch: Map<string, string>,
  nextLaneColor: () => string
): ScmHistoryLane[] {
  const outputLanes: ScmHistoryLane[] = [];
  let firstParentAdded = false;

  if (commit.parents.length === 0) return outputLanes;

  for (const lane of inputLanes) {
    if (lane.id === commit.sha) {
      if (!firstParentAdded) {
        outputLanes.push({
          id: commit.parents[0],
          color: commitColor ?? lane.color,
        });
        firstParentAdded = true;
      }
    } else {
      outputLanes.push({ ...lane });
    }
  }

  const firstUnprocessedParent = firstParentAdded ? 1 : 0;
  for (
    let parentIndex = firstUnprocessedParent;
    parentIndex < commit.parents.length;
    parentIndex++
  ) {
    const parentId = commit.parents[parentIndex];
    const parentRef = branchesByCommit.get(parentId)?.[0];
    const parentColor =
      parentIndex === 0
        ? commitColor
        : parentRef && colorsByBranch.get(parentRef.name);
    outputLanes.push({
      id: parentId,
      color: parentColor || nextLaneColor(),
    });
  }

  return outputLanes;
}

function getCircleColor(
  outputLanes: ScmHistoryLane[],
  inputLanes: ScmHistoryLane[],
  circleIndex: number,
  commitColor: string | undefined,
  colors: string[]
): string {
  return (
    outputLanes[circleIndex]?.color ??
    inputLanes[circleIndex]?.color ??
    commitColor ??
    colors[0] ??
    'rgb(0, 122, 204)'
  );
}

export function getScmHistoryGraphWidth(rows: ScmHistoryGraphRow[]): number {
  const maxLaneCount = rows.reduce(
    (count, row) =>
      Math.max(count, row.inputLanes.length, row.outputLanes.length),
    1
  );
  return SWIMLANE_WIDTH * (maxLaneCount + 1);
}

export function getScmHistoryGraphPaths(
  row: ScmHistoryGraphRow
): ScmHistoryGraphPath[] {
  return [
    ...getLanePaths(row),
    ...getMergePaths(row),
    ...getNodePaths(row),
  ];
}

function getLanePaths(row: ScmHistoryGraphRow): ScmHistoryGraphPath[] {
  const paths: ScmHistoryGraphPath[] = [];
  const { commit, inputLanes, outputLanes, circleIndex } = row;
  let outputIndex = 0;

  for (let index = 0; index < inputLanes.length; index++) {
    const lane = inputLanes[index];
    if (!lane) continue;

    if (lane.id === commit.sha) {
      if (index !== circleIndex) {
        const x = SWIMLANE_WIDTH * (index + 1);
        const circleX = SWIMLANE_WIDTH * (circleIndex + 1);
        paths.push({
          key: `current-${index}`,
          color: lane.color,
          d: `M ${x} 0 A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${SWIMLANE_WIDTH * index} ${SWIMLANE_WIDTH} H ${circleX}`,
        });
      } else {
        outputIndex++;
      }
      continue;
    }

    if (
      outputIndex >= outputLanes.length ||
      lane.id !== outputLanes[outputIndex]?.id
    ) {
      continue;
    }

    if (index === outputIndex) {
      paths.push({
        key: `lane-${index}`,
        color: lane.color,
        d: `M ${SWIMLANE_WIDTH * (index + 1)} 0 V ${SWIMLANE_HEIGHT}`,
      });
    } else {
      const startX = SWIMLANE_WIDTH * (index + 1);
      const endX = SWIMLANE_WIDTH * (outputIndex + 1);
      paths.push({
        key: `lane-${index}-${outputIndex}`,
        color: lane.color,
        d: `M ${startX} 0 V 6 A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 1 ${startX - CURVE_RADIUS} ${SWIMLANE_HEIGHT / 2} H ${endX + CURVE_RADIUS} A ${CURVE_RADIUS} ${CURVE_RADIUS} 0 0 0 ${endX} ${SWIMLANE_HEIGHT / 2 + CURVE_RADIUS} V ${SWIMLANE_HEIGHT}`,
      });
    }
    outputIndex++;
  }
  return paths;
}

function getMergePaths(row: ScmHistoryGraphRow): ScmHistoryGraphPath[] {
  const { commit, outputLanes, circleIndex } = row;
  const paths: ScmHistoryGraphPath[] = [];
  for (
    let parentIndex = 1;
    parentIndex < commit.parents.length;
    parentIndex++
  ) {
    const laneIndex = findLastLaneIndex(
      outputLanes,
      commit.parents[parentIndex]
    );
    if (laneIndex < 0) continue;
    const startX = SWIMLANE_WIDTH * laneIndex;
    const circleX = SWIMLANE_WIDTH * (circleIndex + 1);
    paths.push({
      key: `merge-${parentIndex}`,
      color: outputLanes[laneIndex]?.color ?? row.circleColor,
      d: `M ${startX} ${SWIMLANE_HEIGHT / 2} A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${startX + SWIMLANE_WIDTH} ${SWIMLANE_HEIGHT} M ${startX} ${SWIMLANE_HEIGHT / 2} H ${circleX}`,
    });
  }
  return paths;
}

function getNodePaths(row: ScmHistoryGraphRow): ScmHistoryGraphPath[] {
  const { commit, inputLanes, circleIndex, circleColor } = row;
  const paths: ScmHistoryGraphPath[] = [];
  const inputIndex = inputLanes.findIndex((lane) => lane.id === commit.sha);
  if (inputIndex >= 0) {
    const x = SWIMLANE_WIDTH * (circleIndex + 1);
    paths.push({
      key: 'node-in',
      color: inputLanes[inputIndex]?.color ?? circleColor,
      d: `M ${x} 0 V ${SWIMLANE_HEIGHT / 2}`,
    });
  }

  if (commit.parents.length > 0) {
    const x = SWIMLANE_WIDTH * (circleIndex + 1);
    paths.push({
      key: 'node-out',
      color: circleColor,
      d: `M ${x} ${SWIMLANE_HEIGHT / 2} V ${SWIMLANE_HEIGHT}`,
    });
  }

  return paths;
}

function findLastLaneIndex(lanes: ScmHistoryLane[], id: string): number {
  for (let index = lanes.length - 1; index >= 0; index--) {
    if (lanes[index]?.id === id) return index;
  }
  return -1;
}

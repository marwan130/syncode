import type { RoomEntry } from '../providers/SignalRCrdtProvider';
import type { CrdtId } from './CrdtId';
import { compareCrdtIds, crdtIdToString } from './CrdtId';

export interface CreateProjectEntryOp {
  type: 'create';
  opId: CrdtId;
  entry: RoomEntry;
}

export interface RenameProjectEntryOp {
  type: 'rename';
  opId: CrdtId;
  entryId: string;
  name: string;
}

export interface MoveProjectEntryOp {
  type: 'move';
  opId: CrdtId;
  entryId: string;
  parentId: string | null;
}

export interface DeleteProjectEntryOp {
  type: 'delete';
  opId: CrdtId;
  entryId: string;
}

export type ProjectTreeOperation =
  | CreateProjectEntryOp
  | RenameProjectEntryOp
  | MoveProjectEntryOp
  | DeleteProjectEntryOp;

interface ProjectTreeSnapshot {
  version: 1;
  operations: ProjectTreeOperation[];
}

interface EntryRegister<T> {
  opId: CrdtId;
  value: T;
}

interface ProjectTreeRegisters {
  creates: Map<string, EntryRegister<RoomEntry>>;
  names: Map<string, EntryRegister<string>>;
  parents: Map<string, EntryRegister<string | null>>;
  deleted: Map<string, EntryRegister<true>>;
}

interface VisibleProjectEntries {
  entries: Map<string, RoomEntry>;
  parents: Map<string, string | null>;
  parentVersions: Map<string, CrdtId>;
}

interface MaterializedProjectEntry {
  entry: RoomEntry;
  parentId: string | null;
  parentVersion: CrdtId;
}

function cloneId(id: CrdtId): CrdtId {
  return { siteId: id.siteId, counter: id.counter };
}

function validateId(id: CrdtId): void {
  if (
    !id ||
    typeof id.siteId !== 'string' ||
    id.siteId.length === 0 ||
    id.siteId.length > 128 ||
    !Number.isSafeInteger(id.counter) ||
    id.counter < 1
  ) {
    throw new Error('Invalid project tree operation ID.');
  }
}

function validateName(name: string): void {
  if (typeof name !== 'string') {
    throw new Error('Invalid project entry name.');
  }
  const trimmedName = name.trim();
  if (
    trimmedName.length < 1 ||
    trimmedName.length > 128 ||
    trimmedName === '.' ||
    trimmedName === '..' ||
    /[\\/:*?"<>|]/.test(name) ||
    [...name].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new Error('Invalid project entry name.');
  }
}

function cloneCreateOperation(
  operation: CreateProjectEntryOp
): CreateProjectEntryOp {
  const { entry } = operation;
  if (
    !entry ||
    typeof entry.id !== 'string' ||
    entry.id.length === 0 ||
    entry.id.length > 128 ||
    typeof entry.isFolder !== 'boolean' ||
    (entry.parentId !== null && typeof entry.parentId !== 'string')
  ) {
    throw new Error('Invalid project tree create operation.');
  }
  validateName(entry.name);
  return {
    type: 'create',
    opId: cloneId(operation.opId),
    entry: { ...entry, name: entry.name.trim() },
  };
}

function cloneRenameOperation(
  operation: RenameProjectEntryOp
): RenameProjectEntryOp {
  if (typeof operation.entryId !== 'string' || operation.entryId.length === 0) {
    throw new Error('Invalid project tree rename operation.');
  }
  validateName(operation.name);
  return {
    type: 'rename',
    opId: cloneId(operation.opId),
    entryId: operation.entryId,
    name: operation.name.trim(),
  };
}

function cloneMoveOperation(operation: MoveProjectEntryOp): MoveProjectEntryOp {
  if (
    typeof operation.entryId !== 'string' ||
    operation.entryId.length === 0 ||
    (operation.parentId !== null && typeof operation.parentId !== 'string')
  ) {
    throw new Error('Invalid project tree move operation.');
  }
  return {
    type: 'move',
    opId: cloneId(operation.opId),
    entryId: operation.entryId,
    parentId: operation.parentId,
  };
}

function cloneDeleteOperation(
  operation: DeleteProjectEntryOp
): DeleteProjectEntryOp {
  if (typeof operation.entryId !== 'string' || operation.entryId.length === 0) {
    throw new Error('Invalid project tree delete operation.');
  }
  return {
    type: 'delete',
    opId: cloneId(operation.opId),
    entryId: operation.entryId,
  };
}

function cloneOperation(operation: ProjectTreeOperation): ProjectTreeOperation {
  if (!operation || typeof operation !== 'object') {
    throw new Error('Invalid project tree operation.');
  }
  validateId(operation.opId);
  switch (operation.type) {
    case 'create':
      return cloneCreateOperation(operation);
    case 'rename':
      return cloneRenameOperation(operation);
    case 'move':
      return cloneMoveOperation(operation);
    case 'delete':
      return cloneDeleteOperation(operation);
    default:
      throw new Error('Unknown project tree operation.');
  }
}

export function parseProjectTreeOperation(json: string): ProjectTreeOperation {
  const operation: unknown = JSON.parse(json);
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new Error('Invalid project tree operation.');
  }
  return cloneOperation(operation as ProjectTreeOperation);
}

function operationValue(operation: ProjectTreeOperation): string {
  switch (operation.type) {
    case 'create':
      return JSON.stringify([
        operation.type,
        operation.entry.id,
        operation.entry.name,
        operation.entry.parentId,
        operation.entry.isFolder,
      ]);
    case 'rename':
      return JSON.stringify([
        operation.type,
        operation.entryId,
        operation.name,
      ]);
    case 'move':
      return JSON.stringify([
        operation.type,
        operation.entryId,
        operation.parentId,
      ]);
    case 'delete':
      return JSON.stringify([operation.type, operation.entryId]);
  }
}

function selectRegister<T>(
  current: EntryRegister<T> | undefined,
  candidate: EntryRegister<T>
): EntryRegister<T> {
  return !current || compareCrdtIds(candidate.opId, current.opId) > 0
    ? candidate
    : current;
}

function buildRegisters(
  operations: Iterable<ProjectTreeOperation>
): ProjectTreeRegisters {
  const registers: ProjectTreeRegisters = {
    creates: new Map(),
    names: new Map(),
    parents: new Map(),
    deleted: new Map(),
  };
  for (const operation of operations) {
    if (operation.type === 'create') {
      const entry = { ...operation.entry };
      registers.creates.set(
        entry.id,
        selectRegister(registers.creates.get(entry.id), {
          opId: operation.opId,
          value: entry,
        })
      );
      registers.names.set(
        entry.id,
        selectRegister(registers.names.get(entry.id), {
          opId: operation.opId,
          value: entry.name,
        })
      );
      registers.parents.set(
        entry.id,
        selectRegister(registers.parents.get(entry.id), {
          opId: operation.opId,
          value: entry.parentId,
        })
      );
    } else if (operation.type === 'rename') {
      registers.names.set(
        operation.entryId,
        selectRegister(registers.names.get(operation.entryId), {
          opId: operation.opId,
          value: operation.name,
        })
      );
    } else if (operation.type === 'move') {
      registers.parents.set(
        operation.entryId,
        selectRegister(registers.parents.get(operation.entryId), {
          opId: operation.opId,
          value: operation.parentId,
        })
      );
    } else {
      registers.deleted.set(
        operation.entryId,
        selectRegister(registers.deleted.get(operation.entryId), {
          opId: operation.opId,
          value: true,
        })
      );
    }
  }
  return registers;
}

function compactEntryOperations(
  registers: ProjectTreeRegisters
): ProjectTreeOperation[] {
  const compacted: ProjectTreeOperation[] = [];
  for (const [entryId, create] of registers.creates) {
    compacted.push({
      type: 'create',
      opId: cloneId(create.opId),
      entry: { ...create.value },
    });
    const name = registers.names.get(entryId);
    if (name && compareCrdtIds(name.opId, create.opId) !== 0) {
      compacted.push({
        type: 'rename',
        opId: cloneId(name.opId),
        entryId,
        name: name.value,
      });
    }
    const parent = registers.parents.get(entryId);
    if (parent && compareCrdtIds(parent.opId, create.opId) !== 0) {
      compacted.push({
        type: 'move',
        opId: cloneId(parent.opId),
        entryId,
        parentId: parent.value,
      });
    }
    const deletion = registers.deleted.get(entryId);
    if (deletion)
      compacted.push({ type: 'delete', opId: cloneId(deletion.opId), entryId });
  }
  return compacted;
}

function compactOrphanOperations(
  registers: ProjectTreeRegisters,
  compacted: ProjectTreeOperation[]
): void {
  for (const [entryId, name] of registers.names) {
    if (!registers.creates.has(entryId)) {
      compacted.push({
        type: 'rename',
        opId: cloneId(name.opId),
        entryId,
        name: name.value,
      });
    }
  }
  for (const [entryId, parent] of registers.parents) {
    if (!registers.creates.has(entryId)) {
      compacted.push({
        type: 'move',
        opId: cloneId(parent.opId),
        entryId,
        parentId: parent.value,
      });
    }
  }
  for (const [entryId, deletion] of registers.deleted) {
    if (!registers.creates.has(entryId)) {
      compacted.push({ type: 'delete', opId: cloneId(deletion.opId), entryId });
    }
  }
}

function createVisibleEntry(
  id: string,
  create: EntryRegister<RoomEntry>,
  registers: ProjectTreeRegisters
): MaterializedProjectEntry | null {
  if (registers.deleted.has(id)) return null;
  const name = registers.names.get(id);
  const parent = registers.parents.get(id);
  const parentId = parent?.value ?? null;
  return {
    entry: {
      ...create.value,
      name: name?.value ?? create.value.name,
      parentId,
    },
    parentId,
    parentVersion: parent?.opId ?? create.opId,
  };
}

function createVisibleEntries(
  registers: ProjectTreeRegisters
): VisibleProjectEntries {
  const visible: VisibleProjectEntries = {
    entries: new Map(),
    parents: new Map(),
    parentVersions: new Map(),
  };
  for (const [id, create] of registers.creates) {
    const item = createVisibleEntry(id, create, registers);
    if (!item) continue;
    visible.entries.set(id, item.entry);
    visible.parents.set(id, item.parentId);
    visible.parentVersions.set(id, item.parentVersion);
  }
  return visible;
}

function readSnapshotOperations(snapshotJson: string): ProjectTreeOperation[] {
  let snapshot: ProjectTreeSnapshot;
  try {
    snapshot = JSON.parse(snapshotJson) as ProjectTreeSnapshot;
  } catch {
    throw new Error('Invalid project tree snapshot.');
  }
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.operations)
  ) {
    throw new Error('Invalid project tree snapshot.');
  }
  return snapshot.operations.map(cloneOperation);
}

function validateOperationBatch(
  incoming: ProjectTreeOperation[],
  existingOperations: ReadonlyMap<string, ProjectTreeOperation>
): void {
  const seen = new Map<string, ProjectTreeOperation>();
  for (const operation of incoming) {
    const key = crdtIdToString(operation.opId);
    const existing = seen.get(key) ?? existingOperations.get(key);
    if (existing && operationValue(existing) !== operationValue(operation)) {
      throw new Error('Conflicting project tree operation ID.');
    }
    seen.set(key, operation);
  }
}

function detachInvalidParents(visible: VisibleProjectEntries): void {
  for (const [id, parentId] of visible.parents) {
    if (parentId === null) continue;
    const parent = visible.entries.get(parentId);
    if (!parent || !parent.isFolder) visible.parents.set(id, null);
  }
}

function removeDeletedDescendants(
  visible: VisibleProjectEntries,
  deleted: ReadonlyMap<string, EntryRegister<true>>
): void {
  const hidden = new Set<string>();
  for (const id of visible.parents.keys()) {
    const visited = new Set([id]);
    let parentId = visible.parents.get(id) ?? null;
    while (parentId !== null) {
      if (deleted.has(parentId)) {
        hidden.add(id);
        break;
      }
      if (visited.has(parentId)) break;
      visited.add(parentId);
      parentId = visible.parents.get(parentId) ?? null;
    }
  }
  for (const id of hidden) {
    visible.entries.delete(id);
    visible.parents.delete(id);
    visible.parentVersions.delete(id);
  }
}

function breakParentCycles(visible: VisibleProjectEntries): void {
  const complete = new Set<string>();
  for (const startId of [...visible.parents.keys()].sort()) {
    if (complete.has(startId)) continue;
    const path: string[] = [];
    const position = new Map<string, number>();
    let currentId: string | null = startId;

    while (
      currentId !== null &&
      visible.parents.has(currentId) &&
      !complete.has(currentId)
    ) {
      const cycleStart = position.get(currentId);
      if (cycleStart !== undefined) {
        const cycle = path.slice(cycleStart);
        const detachedId = cycle.reduce((lowest, candidate) =>
          compareCrdtIds(
            visible.parentVersions.get(candidate)!,
            visible.parentVersions.get(lowest)!
          ) < 0
            ? candidate
            : lowest
        );
        visible.parents.set(detachedId, null);
        break;
      }
      position.set(currentId, path.length);
      path.push(currentId);
      currentId = visible.parents.get(currentId) ?? null;
    }
    for (const id of path) complete.add(id);
  }
}

export class ProjectTree {
  public readonly siteId: string;
  private clock = 0;
  private readonly operations = new Map<string, ProjectTreeOperation>();

  constructor(siteId: string) {
    if (!siteId || siteId.length > 128) {
      throw new Error('A valid project tree site ID is required.');
    }
    this.siteId = siteId;
  }

  public static fromEntries(siteId: string, entries: RoomEntry[]): ProjectTree {
    const tree = new ProjectTree(siteId);
    const orderedEntries = [...entries].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );
    for (const [index, entry] of orderedEntries.entries()) {
      tree.applyOperation({
        type: 'create',
        opId: { siteId: 'syncode-seed', counter: index + 1 },
        entry,
      });
    }
    return tree;
  }

  public createEntry(entry: RoomEntry): CreateProjectEntryOp {
    if (
      this.getEntries().some(
        (current) =>
          current.parentId === entry.parentId &&
          current.name.toLowerCase() === entry.name.toLowerCase()
      )
    ) {
      throw new Error('A file or folder with that name already exists here.');
    }
    const operation = this.makeOperation({ type: 'create', entry });
    this.applyOperation(operation);
    return operation;
  }

  public renameEntry(entryId: string, name: string): RenameProjectEntryOp {
    const operation = this.makeOperation({ type: 'rename', entryId, name });
    this.applyOperation(operation);
    return operation;
  }

  public moveEntry(
    entryId: string,
    parentId: string | null
  ): MoveProjectEntryOp {
    const operation = this.makeOperation({ type: 'move', entryId, parentId });
    this.applyOperation(operation);
    return operation;
  }

  public deleteEntry(entryId: string): DeleteProjectEntryOp {
    const operation = this.makeOperation({ type: 'delete', entryId });
    this.applyOperation(operation);
    return operation;
  }

  public applyOperation(input: ProjectTreeOperation): void {
    const operation = cloneOperation(input);
    const key = crdtIdToString(operation.opId);
    const current = this.operations.get(key);
    if (current) {
      if (operationValue(current) !== operationValue(operation)) {
        throw new Error('Conflicting project tree operation ID.');
      }
      return;
    }
    this.operations.set(key, operation);
    this.clock = Math.max(this.clock, operation.opId.counter);
  }

  public removeOperation(opId: CrdtId): void {
    this.operations.delete(crdtIdToString(opId));
  }

  public getEntries(): RoomEntry[] {
    const registers = buildRegisters(this.operations.values());
    const visible = createVisibleEntries(registers);
    removeDeletedDescendants(visible, registers.deleted);
    detachInvalidParents(visible);
    breakParentCycles(visible);
    return [...visible.entries.values()]
      .map((entry) => ({
        ...entry,
        parentId: visible.parents.get(entry.id) ?? null,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  public toSnapshot(): string {
    const registers = buildRegisters(this.operations.values());
    const compacted = compactEntryOperations(registers);
    compactOrphanOperations(registers, compacted);
    const snapshot: ProjectTreeSnapshot = {
      version: 1,
      operations: compacted
        .map(cloneOperation)
        .sort((a, b) => compareCrdtIds(a.opId, b.opId)),
    };
    return JSON.stringify(snapshot);
  }

  public fromSnapshot(snapshotJson: string): void {
    const incoming = readSnapshotOperations(snapshotJson);
    validateOperationBatch(incoming, this.operations);
    for (const operation of incoming) this.applyOperation(operation);
  }

  private makeOperation<T extends Omit<ProjectTreeOperation, 'opId'>>(
    operation: T
  ): Extract<ProjectTreeOperation, T & { opId: CrdtId }> {
    this.clock += 1;
    return {
      ...operation,
      opId: { siteId: this.siteId, counter: this.clock },
    } as Extract<ProjectTreeOperation, T & { opId: CrdtId }>;
  }
}

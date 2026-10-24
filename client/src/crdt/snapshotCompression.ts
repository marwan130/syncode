const COMPRESSED_SNAPSHOT_PREFIX = 'gzip:v1:';
const MAX_EXPANDED_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_COMPRESSED_SNAPSHOT_BASE64_BYTES = 5 * 1024 * 1024;

export async function compressCrdtSnapshot(snapshot: string): Promise<{
  value: string;
  snapshotBytes: number;
  compressedBytes: number;
}> {
  if (typeof CompressionStream === 'undefined')
    throw new Error('This browser does not support compressed project snapshots.');
  const snapshotBytes = new TextEncoder().encode(snapshot).byteLength;
  if (snapshotBytes > MAX_EXPANDED_SNAPSHOT_BYTES)
    throw new Error(
      `A file snapshot is ${(snapshotBytes / (1024 * 1024)).toFixed(1)} MB. The per-file snapshot limit is 16 MB.`
    );

  const compressed = new Uint8Array(
    await new Response(
      new Blob([snapshot]).stream().pipeThrough(new CompressionStream('gzip'))
    ).arrayBuffer()
  );
  let binary = '';
  for (let offset = 0; offset < compressed.length; offset += 0x8000)
    binary += String.fromCharCode(...compressed.subarray(offset, offset + 0x8000));
  const encoded = btoa(binary);
  if (encoded.length > MAX_COMPRESSED_SNAPSHOT_BASE64_BYTES)
    throw new Error('The compressed file snapshot exceeds the 5 MB per-file limit.');
  const value = COMPRESSED_SNAPSHOT_PREFIX + encoded;
  return { value, snapshotBytes, compressedBytes: new TextEncoder().encode(value).byteLength };
}

export async function decompressCrdtSnapshot(snapshot: string): Promise<string> {
  if (!snapshot.startsWith(COMPRESSED_SNAPSHOT_PREFIX)) return snapshot;
  if (snapshot.length - COMPRESSED_SNAPSHOT_PREFIX.length > MAX_COMPRESSED_SNAPSHOT_BASE64_BYTES)
    throw new Error('The compressed file snapshot exceeds its size limit.');
  if (typeof DecompressionStream === 'undefined')
    throw new Error('This browser cannot open the imported project snapshot.');

  const binary = atob(snapshot.slice(COMPRESSED_SNAPSHOT_PREFIX.length));
  const compressed = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0)
  );
  const reader = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_EXPANDED_SNAPSHOT_BYTES) {
      await reader.cancel();
      throw new Error('The imported project snapshot exceeds its size limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

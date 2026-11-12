// Receive into private memory. Only a complete, receipt-bound file may be saved.
export async function verifiedGISBlob(response, receipt, onProgress = () => {}) {
  const fail = (code) => { throw Error(code); };
  const expected = receipt?.content_sha256;
  const length = receipt?.content_length_bytes;
  if (!/^[a-f0-9]{64}$/.test(expected || "") || !Number.isSafeInteger(length) || length < 1 ||
      !receipt.snapshot_version || response.headers.get("x-content-sha256") !== expected ||
      response.headers.get("x-gis-snapshot-version") !== receipt.snapshot_version ||
      response.headers.get("x-gis-content-length") !== String(length))
    fail("GIS_DOWNLOAD_RECEIPT_MISMATCH");
  if (!response.body) fail("GIS_DOWNLOAD_INTERRUPTED");
  const reader = response.body.getReader(), chunks = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > length) fail("GIS_DOWNLOAD_LENGTH_MISMATCH");
      chunks.push(value);
      onProgress({ stage: "transfer", received, total: length });
    }
    if (received !== length) fail("GIS_DOWNLOAD_LENGTH_MISMATCH");
    onProgress({ stage: "verify", received, total: length });
    const blob = new Blob(chunks, { type: response.headers.get("content-type") || "text/csv;charset=utf-8" });
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    if (actual !== expected) fail("GIS_DOWNLOAD_CHECKSUM_MISMATCH");
    return blob;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export function saveVerifiedGISBlob(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

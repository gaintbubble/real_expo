/**
 * Utility functions for single definitive status normalization and batch detection.
 */

export function isBatchSample(barcode?: string | null, testName?: string | null, serviceCd?: string | null): boolean {
  const b = (barcode || '').toLowerCase();
  const t = (testName || '').toLowerCase();
  const s = (serviceCd || '').toLowerCase();
  return (
    b.startsWith('b-') ||
    b.startsWith('bch') ||
    b.includes('batch') ||
    t.includes('batch') ||
    s.includes('batch')
  );
}

export function normalizeStatus(
  status?: string | null, 
  barcode?: string | null, 
  testName?: string | null, 
  serviceCd?: string | null
): string {
  if (!status) return 'Pending Check';
  const s = status.trim();
  const sLower = s.toLowerCase();

  // Explicit Handling for Trigger Lifecycle States
  if (sLower.includes('checking')) {
    return 'Checking...';
  }

  if (sLower.includes('check failed') || sLower.includes('offline') || sLower === 'failed' || sLower.includes('not found')) {
    return 'Check Failed';
  }

  // Combined slash text: "Sample Collected / Batch Generated" or "Sample Collected/Batch Generated"
  if (sLower.includes('collected') && sLower.includes('batch')) {
    return isBatchSample(barcode, testName, serviceCd) ? 'Batch Generated' : 'Sample Collected';
  }

  if (sLower === 'batch generated' || sLower.includes('batch')) {
    return 'Batch Generated';
  }

  if (sLower === 'sample collected' || (sLower.includes('collected') && !sLower.includes('uncollected'))) {
    return 'Sample Collected';
  }

  if (sLower.includes('pending check') || sLower.includes('scanned') || sLower.includes('waiting')) {
    return 'Pending Check';
  }

  if (sLower.includes('received')) {
    return 'Sample Received';
  }

  if (sLower.includes('result done') || sLower === 'done') {
    return 'Result Done';
  }

  if (sLower.includes('verified')) {
    return 'Verified';
  }

  if (sLower.includes('approved') || sLower.includes('authorized')) {
    return 'Approved';
  }

  if (sLower.includes('dispatch')) {
    return 'Dispatched';
  }

  return s;
}

#!/usr/bin/env node
/* Lightweight built-in HTTP load probe; no extra package required.
 * Usage: node scripts/load-test.mjs [baseUrl] [durationSeconds] [concurrency]
 */
const baseUrl = process.argv[2] || 'http://127.0.0.1:4173';
const durationMs = Math.max(1, Number(process.argv[3]) || 8) * 1000;
const concurrency = Math.max(1, Math.min(200, Number(process.argv[4]) || 20));

async function run(path, title) {
  const url = new URL(path, baseUrl);
  const samples = [];
  let requests = 0, errors = 0;
  const deadline = Date.now() + durationMs;
  console.log(`\n--- ${title}: ${url} (${concurrency} workers, ${durationMs / 1000}s) ---`);
  async function worker() {
    while (Date.now() < deadline) {
      const started = performance.now();
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        await response.arrayBuffer();
        if (!response.ok) errors++;
      } catch { errors++; }
      samples.push(performance.now() - started);
      requests++;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  samples.sort((a, b) => a - b);
  const percentile = p => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))] || 0;
  const rate = requests / (durationMs / 1000);
  console.log(`requests: ${requests}  req/s: ${rate.toFixed(1)}  errors: ${errors}`);
  console.log(`latency p50: ${percentile(.50).toFixed(1)}ms  p99: ${percentile(.99).toFixed(1)}ms  max: ${(samples.at(-1) || 0).toFixed(1)}ms`);
  return { requests, errors };
}

const results = await Promise.all([
  run('/api/health', 'health'),
  run('/api/marketplace/courses', 'marketplace browse'),
  run('/api/search?q=math', 'search'),
]);
const failures = results.reduce((sum, r) => sum + r.errors, 0);
console.log(failures ? `\nLOAD PROBE: ${failures} failed requests` : '\nLOAD PROBE: OK');
process.exit(failures ? 1 : 0);

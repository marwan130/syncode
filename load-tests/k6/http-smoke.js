import http from 'k6/http';
import { check, fail } from 'k6';

const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const vus = Number(__ENV.VUS || 1);
const duration = __ENV.DURATION || '30s';
const target = new URL(baseUrl);
const allowedLocalHosts = new Set(['localhost', '127.0.0.1', '::1']);
const durationMatch = /^(\d+)(s|m)$/.exec(duration);

if (!allowedLocalHosts.has(target.hostname) && __ENV.ALLOW_REMOTE !== 'true') {
  throw new Error('Remote targets require ALLOW_REMOTE=true. Test only environments you control.');
}
if (!allowedLocalHosts.has(target.hostname) && target.protocol !== 'https:') {
  throw new Error('Remote load targets must use HTTPS.');
}
if (target.username || target.password || target.search || target.hash) {
  throw new Error('Target URLs cannot contain credentials, queries, or fragments.');
}
if (!Number.isInteger(vus) || vus < 1 || vus > 100 || !durationMatch) {
  throw new Error('VUS must be between 1 and 100 and DURATION must use seconds or minutes.');
}
const durationSeconds = Number(durationMatch[1]) * (durationMatch[2] === 'm' ? 60 : 1);
if (durationSeconds < 1 || durationSeconds > 1800 || vus * durationSeconds > 18000) {
  throw new Error('The HTTP smoke workload is limited to 30 minutes and 18,000 VU-seconds.');
}

export const options = {
  scenarios: {
    health: {
      executor: 'constant-vus',
      vus,
      duration,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

export function setup() {
  const response = http.get(`${baseUrl}/health`);
  if (!check(response, { 'room server health returns 200': (r) => r.status === 200 })) {
    fail('The local Syncode room server is not healthy at BASE_URL.');
  }

  const room = http.post(`${baseUrl}/api/rooms`);
  if (!check(room, { 'room creation returns 200': (r) => r.status === 200 })) {
    fail('Room creation failed. Check the local stack and room creation rate limit.');
  }

  return { startedAt: new Date().toISOString() };
}

export default function () {
  const response = http.get(`${baseUrl}/health`);
  check(response, { 'room server health remains 200': (r) => r.status === 200 });
}

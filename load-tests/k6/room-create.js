import http from 'k6/http';
import { check, fail } from 'k6';

const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const vus = Number(__ENV.VUS || 2);
const target = new URL(baseUrl);
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

if (!localHosts.has(target.hostname) && __ENV.ALLOW_REMOTE !== 'true') {
  throw new Error('Remote targets require ALLOW_REMOTE=true. Test only environments you control.');
}
if (!localHosts.has(target.hostname) && target.protocol !== 'https:') {
  throw new Error('Remote load targets must use HTTPS.');
}
if (target.username || target.password || target.search || target.hash) {
  throw new Error('Target URLs cannot contain credentials, queries, or fragments.');
}
if (!Number.isInteger(vus) || vus < 1 || vus > 5) {
  throw new Error('VUS must be between 1 and 5 to stay within the room-creation burst limit.');
}

export const options = {
  scenarios: {
    roomCreation: {
      executor: 'per-vu-iterations',
      vus,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

export function setup() {
  const response = http.get(`${baseUrl}/health`);
  if (!check(response, { 'room server health returns 200': (r) => r.status === 200 })) {
    fail('The Syncode room server is not healthy at BASE_URL.');
  }
}

export default function () {
  const response = http.post(`${baseUrl}/api/rooms`);
  check(response, { 'room creation returns 200': (r) => r.status === 200 });
}

// =============================================================================
// k6 Load Test — 3D Development Visualization Platform
//
// Run:
//   k6 run tests/load/k6-load-test.js
//   k6 run --env BASE_URL=http://staging.example.com tests/load/k6-load-test.js
// =============================================================================

import http from "k6/http";
import { check, group, sleep } from "k6";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BASE_URL = __ENV.BASE_URL || "http://localhost:80";

// A placeholder project ID — replace with a real ID from your staging seed data
// or set via environment: k6 run --env PROJECT_ID=<uuid> ...
const PROJECT_ID =
  __ENV.PROJECT_ID || "00000000-0000-0000-0000-000000000001";

export const options = {
  // -------------------------------------------------------------------------
  // Stages: ramp up -> hold -> ramp down
  // -------------------------------------------------------------------------
  stages: [
    { duration: "1m", target: 50 },   // ramp up to 50 VUs over 1 minute
    { duration: "3m", target: 100 },   // hold at 100 VUs for 3 minutes
    { duration: "1m", target: 0 },     // ramp down to 0 over 1 minute
  ],

  // -------------------------------------------------------------------------
  // Thresholds — the test fails if these are breached
  // -------------------------------------------------------------------------
  thresholds: {
    http_req_duration: ["p(95)<500"],   // 95th percentile < 500 ms
    http_req_failed: ["rate<0.01"],     // error rate < 1 %
  },
};

// ---------------------------------------------------------------------------
// Default function — executed once per VU iteration
// ---------------------------------------------------------------------------
export default function () {
  // -----------------------------------------------------------------------
  // Scenario A: Health check
  // -----------------------------------------------------------------------
  group("Health Check", function () {
    const res = http.get(`${BASE_URL}/api/v1/health`);

    check(res, {
      "health: status is 200": (r) => r.status === 200,
      "health: response time < 200ms": (r) => r.timings.duration < 200,
    });
  });

  sleep(randomBetween(1, 3));

  // -----------------------------------------------------------------------
  // Scenario B: List projects
  // -----------------------------------------------------------------------
  group("List Projects", function () {
    const res = http.get(`${BASE_URL}/api/v1/projects`);

    check(res, {
      "list projects: status is 200": (r) => r.status === 200,
      "list projects: response is JSON": (r) =>
        r.headers["Content-Type"] &&
        r.headers["Content-Type"].includes("application/json"),
      "list projects: response time < 500ms": (r) =>
        r.timings.duration < 500,
    });
  });

  sleep(randomBetween(1, 3));

  // -----------------------------------------------------------------------
  // Scenario C: Get single project
  // -----------------------------------------------------------------------
  group("Get Single Project", function () {
    const res = http.get(`${BASE_URL}/api/v1/projects/${PROJECT_ID}`);

    check(res, {
      "get project: status is 200 or 404": (r) =>
        r.status === 200 || r.status === 404,
      "get project: response is JSON": (r) =>
        r.headers["Content-Type"] &&
        r.headers["Content-Type"].includes("application/json"),
      "get project: response time < 500ms": (r) =>
        r.timings.duration < 500,
    });
  });

  sleep(randomBetween(1, 3));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

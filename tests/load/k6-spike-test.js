// =============================================================================
// k6 Spike Test — 3D Development Visualization Platform
//
// Simulates a sudden surge of traffic to verify the platform can handle
// unexpected load spikes without catastrophic failure.
//
// Run:
//   k6 run tests/load/k6-spike-test.js
//   k6 run --env BASE_URL=http://staging.example.com tests/load/k6-spike-test.js
// =============================================================================

import http from "k6/http";
import { check, group, sleep } from "k6";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BASE_URL = __ENV.BASE_URL || "http://localhost:80";

const PROJECT_ID =
  __ENV.PROJECT_ID || "00000000-0000-0000-0000-000000000001";

export const options = {
  // -------------------------------------------------------------------------
  // Stages: sudden spike pattern
  // -------------------------------------------------------------------------
  stages: [
    { duration: "10s", target: 10 },    // warm-up
    { duration: "30s", target: 200 },   // spike to 200 VUs in 30 seconds
    { duration: "1m", target: 200 },    // hold at peak for 1 minute
    { duration: "30s", target: 0 },     // ramp down
  ],

  // -------------------------------------------------------------------------
  // Thresholds — relaxed compared to load test, but still bounded
  // -------------------------------------------------------------------------
  thresholds: {
    http_req_duration: ["p(95)<2000"],  // 95th percentile < 2 000 ms
    http_req_failed: ["rate<0.05"],     // error rate < 5 %
  },
};

// ---------------------------------------------------------------------------
// Default function — executed once per VU iteration
// ---------------------------------------------------------------------------
export default function () {
  // -----------------------------------------------------------------------
  // Scenario A: Health check
  // -----------------------------------------------------------------------
  group("Spike — Health Check", function () {
    const res = http.get(`${BASE_URL}/api/v1/health`);

    check(res, {
      "health: status is 200": (r) => r.status === 200,
      "health: responds within 2s": (r) => r.timings.duration < 2000,
    });
  });

  sleep(randomBetween(0.5, 1.5));

  // -----------------------------------------------------------------------
  // Scenario B: List projects
  // -----------------------------------------------------------------------
  group("Spike — List Projects", function () {
    const res = http.get(`${BASE_URL}/api/v1/projects`);

    check(res, {
      "list projects: status is 200": (r) => r.status === 200,
      "list projects: response is JSON": (r) =>
        r.headers["Content-Type"] &&
        r.headers["Content-Type"].includes("application/json"),
      "list projects: responds within 2s": (r) =>
        r.timings.duration < 2000,
    });
  });

  sleep(randomBetween(0.5, 1.5));

  // -----------------------------------------------------------------------
  // Scenario C: Get single project
  // -----------------------------------------------------------------------
  group("Spike — Get Single Project", function () {
    const res = http.get(`${BASE_URL}/api/v1/projects/${PROJECT_ID}`);

    check(res, {
      "get project: status is 200 or 404": (r) =>
        r.status === 200 || r.status === 404,
      "get project: response is JSON": (r) =>
        r.headers["Content-Type"] &&
        r.headers["Content-Type"].includes("application/json"),
      "get project: responds within 2s": (r) =>
        r.timings.duration < 2000,
    });
  });

  sleep(randomBetween(0.5, 1.5));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

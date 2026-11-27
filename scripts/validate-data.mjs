import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const categories = new Set([
  "online_video",
  "video_app",
  "cloud_search",
  "magnet_search",
  "subtitles",
  "player",
  "subscription",
  "tvbox_config",
  "open_source",
  "other"
]);
const statuses = new Set([
  "pending",
  "verified",
  "recommended",
  "caution",
  "temporarily_unavailable",
  "removed"
]);
const risks = new Set(["low", "medium", "high", "unknown"]);
const methods = new Set(["manual", "automated", "mixed"]);
const availabilityStatuses = new Set(["reachable", "restricted", "unreachable", "unknown"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const errors = [];

async function readJson(path) {
  try {
    return JSON.parse(await readFile(new URL(path, root), "utf8"));
  } catch (error) {
    errors.push(`${path}: cannot parse JSON (${error.message})`);
    return null;
  }
}

function check(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function checkDate(value, path) {
  check(typeof value === "string" && datePattern.test(value), `${path}: expected YYYY-MM-DD`);
}

function checkScore(value, path) {
  check(
    typeof value === "number" && value >= 1 && value <= 5 && Number.isInteger(value * 10),
    `${path}: expected a score from 1.0 to 5.0 with at most one decimal`
  );
}

const resourcesData = await readJson("resources/resources.json");
const verificationsData = await readJson("reports/verifications.json");
const availabilityData = await readJson("reports/availability.json");
await readJson("reports/notices.json");

if (resourcesData) {
  checkDate(resourcesData.updated_at, "resources.updated_at");
  check(Array.isArray(resourcesData.resources), "resources.resources: expected an array");
}

const resourceIds = new Set();
const featuredResourceIds = new Set();
for (const [index, resource] of (resourcesData?.resources ?? []).entries()) {
  const path = `resources.resources[${index}]`;
  check(idPattern.test(resource.id ?? ""), `${path}.id: invalid or missing id`);
  check(!resourceIds.has(resource.id), `${path}.id: duplicate id "${resource.id}"`);
  resourceIds.add(resource.id);
  if (resource.featured === true) {
    featuredResourceIds.add(resource.id);
    check(
      typeof resource.summary_short === "string" && resource.summary_short.length > 0,
      `${path}.summary_short: required for featured resources`
    );
  }
  if (resource.featured_order !== undefined) {
    check(
      Number.isInteger(resource.featured_order) && resource.featured_order >= 1,
      `${path}.featured_order: expected an integer greater than or equal to 1`
    );
  }
  check(typeof resource.name === "string" && resource.name.length > 0, `${path}.name: required`);
  if (resource.link_url !== undefined) {
    check(
      typeof resource.link_url === "string" && /^https?:\/\//.test(resource.link_url),
      `${path}.link_url: expected HTTP or HTTPS URL`
    );
  }
  if (["tvbox_config", "subscription"].includes(resource.category)) {
    check(
      typeof resource.url === "string" && /^https?:\/\//.test(resource.url),
      `${path}.url: expected HTTP or HTTPS URL for tvbox_config or subscription`
    );
  } else {
    check(
      typeof resource.url === "string" && resource.url.startsWith("https://"),
      `${path}.url: expected HTTPS URL`
    );
  }
  check(categories.has(resource.category), `${path}.category: unknown category "${resource.category}"`);
  if (resource.category === "open_source") {
    check(typeof resource.github?.full_name === "string" && resource.github.full_name.includes("/"), `${path}.github.full_name: required for open source resources`);
    check(Number.isInteger(resource.github?.stars) && resource.github.stars >= 0, `${path}.github.stars: expected a non-negative integer`);
    check(
      typeof resource.github?.pushed_at === "string" && !Number.isNaN(Date.parse(resource.github.pushed_at)),
      `${path}.github.pushed_at: expected ISO timestamp`
    );
  }

  for (const score of ["more", "speed", "clean", "stable", "ease"]) {
    checkScore(resource.scores?.[score], `${path}.scores.${score}`);
  }
  for (const risk of ["copyright", "safety", "privacy", "payment"]) {
    check(risks.has(resource.risks?.[risk]), `${path}.risks.${risk}: unknown risk level`);
  }

  check(statuses.has(resource.verification?.status), `${path}.verification.status: unknown status`);
  check(methods.has(resource.verification?.method), `${path}.verification.method: unknown method`);
  checkDate(resource.verification?.last_checked, `${path}.verification.last_checked`);
  checkDate(resource.source?.added_at, `${path}.source.added_at`);
}

if (verificationsData) {
  checkDate(verificationsData.updated_at, "verifications.updated_at");
  check(Array.isArray(verificationsData.records), "verifications.records: expected an array");
}

const verificationIds = new Set();
for (const [index, record] of (verificationsData?.records ?? []).entries()) {
  const path = `verifications.records[${index}]`;
  check(typeof record.id === "string" && record.id.length > 0, `${path}.id: required`);
  check(!verificationIds.has(record.id), `${path}.id: duplicate id "${record.id}"`);
  verificationIds.add(record.id);
  checkDate(record.checked_at, `${path}.checked_at`);
  check(methods.has(record.method), `${path}.method: unknown method`);

  for (const resourceId of record.resource_ids ?? []) {
    check(resourceIds.has(resourceId), `${path}.resource_ids: unknown resource "${resourceId}"`);
  }
}

if (availabilityData) {
  check(
    availabilityData.generated_at === null ||
      (typeof availabilityData.generated_at === "string" &&
        !Number.isNaN(Date.parse(availabilityData.generated_at))),
    "availability.generated_at: expected ISO timestamp or null"
  );
  check(Array.isArray(availabilityData.results), "availability.results: expected an array");
}

const availabilityResourceIds = new Set();
for (const [index, result] of (availabilityData?.results ?? []).entries()) {
  const path = `availability.results[${index}]`;
  check(resourceIds.has(result.resource_id), `${path}.resource_id: unknown resource "${result.resource_id}"`);
  check(
    !availabilityResourceIds.has(result.resource_id),
    `${path}.resource_id: duplicate resource "${result.resource_id}"`
  );
  availabilityResourceIds.add(result.resource_id);
  check(availabilityStatuses.has(result.status), `${path}.status: unknown availability status`);
  check(
    typeof result.checked_at === "string" && !Number.isNaN(Date.parse(result.checked_at)),
    `${path}.checked_at: expected ISO timestamp`
  );
}

if (availabilityData?.generated_at !== null) {
  for (const resourceId of featuredResourceIds) {
    const resource = resourcesData.resources.find((item) => item.id === resourceId);
    if (resource?.category === "open_source") {
      continue;
    }
    // added_at has day precision; a resource added on the report's day may be newer than the report.
    if (resource?.source?.added_at >= availabilityData.generated_at.slice(0, 10)) {
      continue;
    }
    check(
      availabilityResourceIds.has(resourceId),
      `availability.results: featured resource "${resourceId}" is missing`
    );
  }
}

if (errors.length > 0) {
  console.error(`Data validation failed with ${errors.length} error(s):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Data validation passed: ${resourceIds.size} resources, ${verificationIds.size} verification records, ${availabilityResourceIds.size} availability results.`
  );
}

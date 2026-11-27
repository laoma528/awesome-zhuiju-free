import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);
const timeZone = "Asia/Shanghai";
const resourcesFile = "resources/resources.json";
const availabilityFile = "reports/availability.json";

const categories = new Map([
  ["online_video", "在线影视"],
  ["video_app", "影视APP"],
  ["cloud_search", "网盘搜索"],
  ["magnet_search", "磁力 BT"],
  ["subtitles", "字幕资源"],
  ["player", "TVBox/影视仓空壳"],
  ["tvbox_config", "TVBox/影视仓配置地址"],
  ["subscription", "订阅源"],
  ["open_source", "开源项目"],
  ["other", "其他"]
]);

const availabilityLabels = new Map([
  ["reachable", "可访问"],
  ["restricted", "访问受限"],
  ["unreachable", "无法访问"],
  ["unknown", "未检测"]
]);

function rootPath(path) {
  return new URL(path, root);
}

async function readJson(path) {
  return JSON.parse(await readFile(rootPath(path), "utf8"));
}

async function git(args, options = {}) {
  const result = await execFileAsync("git", args, {
    cwd: root,
    maxBuffer: 1024 * 1024 * 10,
    ...options
  });
  return result.stdout.trim();
}

async function gitOrNull(args) {
  try {
    return await git(args);
  } catch {
    return null;
  }
}

async function readJsonAtRef(ref, path) {
  const content = await gitOrNull(["show", `${ref}:${path}`]);
  return content ? JSON.parse(content) : null;
}

function partsInTimeZone(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(date)
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function isoWeekFor(date) {
  const parts = partsInTimeZone(date);
  const localDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  const day = localDate.getUTCDay() || 7;
  const thursday = new Date(localDate);
  thursday.setUTCDate(localDate.getUTCDate() + 4 - day);

  const weekYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const firstDay = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstDay);

  const week = 1 + Math.round((thursday - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  const start = new Date(localDate);
  start.setUTCDate(localDate.getUTCDate() - day + 1);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return {
    weekYear,
    week,
    weekLabel: `${weekYear}-W${String(week).padStart(2, "0")}`,
    startDate: ymd(start),
    endDate: ymd(end)
  };
}

function byId(items) {
  return new Map(items.map((item) => [item.id ?? item.resource_id, item]));
}

function resourceTitle(resource) {
  return `[${resource.name}](${resource.link_url ?? resource.url})`;
}

function shortSummary(resource) {
  return String(resource.summary_short ?? resource.summary ?? "")
    .replace(/\s+/g, " ")
    .replace(/[。.!！]$/, "");
}

function categoryName(resource) {
  return categories.get(resource.category) ?? resource.category;
}

function availabilityName(status) {
  return availabilityLabels.get(status ?? "unknown") ?? "未检测";
}

function statusCounts(results) {
  const counts = new Map([
    ["reachable", 0],
    ["restricted", 0],
    ["unreachable", 0],
    ["unknown", 0]
  ]);
  for (const result of results) {
    counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
  }
  return counts;
}

function formatStatusCounts(counts) {
  return [
    `可访问 ${counts.get("reachable") ?? 0}`,
    `访问受限 ${counts.get("restricted") ?? 0}`,
    `无法访问 ${counts.get("unreachable") ?? 0}`,
    `未检测 ${counts.get("unknown") ?? 0}`
  ].join(" / ");
}

function resourceChanged(current, previous) {
  const fields = [
    "name",
    "url",
    "link_url",
    "category",
    "summary_short",
    "featured",
    "featured_order"
  ];

  return fields.some((field) => JSON.stringify(current[field] ?? null) !== JSON.stringify(previous[field] ?? null));
}

function bulletList(items, emptyText, formatter) {
  if (items.length === 0) {
    return `- ${emptyText}`;
  }

  return items.map(formatter).join("\n");
}

function dateWithinWeek(value, week) {
  return typeof value === "string" && value >= week.startDate && value <= week.endDate;
}

async function previousWeeklyTag(currentTag) {
  const output = await gitOrNull([
    "for-each-ref",
    "--sort=-creatordate",
    "--format=%(refname:short)",
    "refs/tags/weekly-*"
  ]);
  const tags = output ? output.split(/\r?\n/).filter(Boolean) : [];
  const current = parseWeeklyTag(currentTag);

  if (!current) {
    return tags.find((tag) => tag !== currentTag) ?? null;
  }

  return tags
    .map((tag) => ({ tag, parsed: parseWeeklyTag(tag) }))
    .filter((item) => item.parsed && compareWeek(item.parsed, current) < 0)
    .sort((left, right) => compareWeek(right.parsed, left.parsed))[0]?.tag ?? null;
}

function parseWeeklyTag(tag) {
  const match = tag.match(/^weekly-(\d{4})-W(\d{2})$/);
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    week: Number(match[2])
  };
}

function compareWeek(left, right) {
  return left.year - right.year || left.week - right.week;
}

async function commitSubjects(previousTag, week) {
  const args = previousTag
    ? ["log", "--format=%s", `${previousTag}..HEAD`]
    : ["log", "--format=%s", `--since=${week.startDate}T00:00:00+08:00`];
  const output = await gitOrNull(args);
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== "chore: update daily availability")
    .slice(0, 12);
}

function compareResources(currentResources, previousResources, week) {
  if (!previousResources) {
    return {
      added: currentResources.filter((resource) => dateWithinWeek(resource.source?.added_at, week)),
      removed: [],
      updated: []
    };
  }

  const currentById = byId(currentResources);
  const previousById = byId(previousResources);
  const added = currentResources.filter((resource) => !previousById.has(resource.id));
  const removed = previousResources.filter((resource) => !currentById.has(resource.id));
  const updated = currentResources.filter((resource) => {
    const previous = previousById.get(resource.id);
    return previous && resourceChanged(resource, previous);
  });

  return { added, removed, updated };
}

function compareAvailability(currentResults, previousResults, currentResourcesById) {
  if (!previousResults) {
    return [];
  }

  const previousById = byId(previousResults);
  return currentResults
    .filter((result) => previousById.has(result.resource_id))
    .filter((result) => previousById.get(result.resource_id).status !== result.status)
    .map((result) => ({
      resource: currentResourcesById.get(result.resource_id),
      before: previousById.get(result.resource_id).status,
      after: result.status
    }))
    .filter((item) => item.resource);
}

function releaseBody({
  currentResources,
  currentAvailability,
  previousTag,
  week,
  added,
  removed,
  updated,
  availabilityChanges,
  commits
}) {
  const featuredCount = currentResources.filter((resource) => resource.featured).length;
  const counts = statusCounts(currentAvailability.results ?? []);
  const comparisonText = previousTag ? `对比上一期 \`${previousTag}\`` : "首次自动周报，按本周新增日期统计";

  return `# ${week.weekLabel} 每周资源更新

周期：${week.startDate} 至 ${week.endDate}（北京时间）  
${comparisonText}

当前收录 ${currentResources.length} 个资源，其中首页精选 ${featuredCount} 个。  
自动检测概览：${formatStatusCounts(counts)}。

> 可用性检测仅代表 GitHub Actions 节点在检测时的网络情况，不替代完整体验评价。

## 本周新增

${bulletList(
  added,
  "本周没有新增正式收录资源。",
  (resource) => `- ${resourceTitle(resource)} - ${categoryName(resource)}；${shortSummary(resource)}`
)}

## 本周移除或暂停

${bulletList(
  removed,
  "本周没有移除资源。",
  (resource) => `- ${resource.name} - ${categoryName(resource)}`
)}

## 本周调整

${bulletList(
  updated,
  "本周没有资源信息调整。",
  (resource) => `- ${resourceTitle(resource)} - ${categoryName(resource)}；更新了资源信息或展示状态`
)}

## 可用性变化

${bulletList(
  availabilityChanges,
  "本周没有检测状态变化。",
  (item) => `- ${resourceTitle(item.resource)}：${availabilityName(item.before)} -> ${availabilityName(item.after)}`
)}

## 维护记录

${bulletList(commits, "本周没有额外维护提交。", (subject) => `- ${subject}`)}

## 相关链接

- [浏览完整资源列表](https://github.com/laoma528/awesome-zhuiju-free#精选资源)
- [查看资源数据库](https://github.com/laoma528/awesome-zhuiju-free/blob/main/resources/resources.json)
- [查看可用性检测结果](https://github.com/laoma528/awesome-zhuiju-free/blob/main/reports/availability.json)
- [推荐新资源](https://github.com/laoma528/awesome-zhuiju-free/issues/new?template=resource.yml)
`;
}

async function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  const delimiter = `EOF_${name}_${Date.now()}`;
  await appendFile(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

const reportDate = process.env.REPORT_DATE
  ? new Date(`${process.env.REPORT_DATE}T12:00:00+08:00`)
  : new Date();
if (Number.isNaN(reportDate.getTime())) {
  throw new Error("REPORT_DATE must use YYYY-MM-DD.");
}

const week = isoWeekFor(reportDate);
const tag = process.env.RELEASE_TAG || `weekly-${week.weekLabel}`;
const title = `${week.weekLabel} 每周资源更新`;
const previousTag = await previousWeeklyTag(tag);
const currentResourcesData = await readJson(resourcesFile);
const currentAvailability = await readJson(availabilityFile);
const previousResourcesData = previousTag ? await readJsonAtRef(previousTag, resourcesFile) : null;
const previousAvailability = previousTag ? await readJsonAtRef(previousTag, availabilityFile) : null;

const currentResources = currentResourcesData.resources ?? [];
const { added, removed, updated } = compareResources(
  currentResources,
  previousResourcesData?.resources,
  week
);
const availabilityChanges = compareAvailability(
  currentAvailability.results ?? [],
  previousAvailability?.results,
  byId(currentResources)
);
const commits = await commitSubjects(previousTag, week);
const body = releaseBody({
  currentResources,
  currentAvailability,
  previousTag,
  week,
  added,
  removed,
  updated,
  availabilityChanges,
  commits
});

const notesPath = process.env.RELEASE_NOTES_PATH;
if (notesPath) {
  await mkdir(dirname(notesPath), { recursive: true });
  await writeFile(notesPath, body, "utf8");
} else {
  console.log(body);
}

await setOutput("tag", tag);
await setOutput("title", title);
await setOutput("notes_path", notesPath ?? "");
await setOutput("previous_tag", previousTag ?? "");

console.error(`Generated ${title}${previousTag ? ` from ${previousTag}` : ""}.`);

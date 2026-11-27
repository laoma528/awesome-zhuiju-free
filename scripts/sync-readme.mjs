import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const resourcesPath = new URL("resources/resources.json", root);
const verificationsPath = new URL("reports/verifications.json", root);
const availabilityPath = new URL("reports/availability.json", root);
const readmePath = new URL("README.md", root);
const startMarker = "<!-- featured-resources:start -->";
const endMarker = "<!-- featured-resources:end -->";
const contributorsStartMarker = "<!-- community-contributors:start -->";
const contributorsEndMarker = "<!-- community-contributors:end -->";
const countStartMarker = "<!-- resource-count:start -->";
const countEndMarker = "<!-- resource-count:end -->";
const timeZone = "Asia/Shanghai";
const ownerUsernames = new Set(["laoma528", "laoma2053"]);
const execFileAsync = promisify(execFile);

const categories = [
  { id: "online_video", name: "在线影视", badge: "在线影视", color: "0A66C2" },
  { id: "video_app", name: "影视APP", badge: "影视APP", color: "00A98F" },
  { id: "cloud_search", name: "网盘资源搜索", badge: "网盘搜索", color: "4285F4" },
  { id: "magnet_search", name: "磁力& BT", badge: "磁力%26_BT", color: "F7B801" },
  { id: "subtitles", name: "字幕资源", badge: "字幕资源", color: "6F42C1" },
  { id: "player", name: "TVBox/影视仓空壳", badge: "TVBox%2F影视仓空壳", color: "00B4D8" },
  { id: "tvbox_config", name: "TVBox/影视仓配置地址", badge: "TVBox%2F影视仓接口", color: "38BDF8" },
  { id: "subscription", name: "直播源", badge: "直播源", color: "E91E63" },
  { id: "open_source", name: "开源项目", badge: "开源项目", color: "181717" }
];

function markdownCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
}

function markdownLink(label, url) {
  const safeLabel = String(label).replaceAll("[", "\\[").replaceAll("]", "\\]");
  const safeUrl = String(url).replaceAll(">", "%3E");
  return `[${markdownCell(safeLabel)}](<${safeUrl}>)`;
}

function markdownCode(value) {
  const text = markdownCell(value);
  return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
}

function chunk(items, size) {
  const rows = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function anchorFor(name) {
  return name
    .toLowerCase()
    .replaceAll(/[&/]/g, "")
    .trim()
    .replaceAll(/\s+/g, "-");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMarkedBlock(content, start, end, replacement, trailingNewlines) {
  const pattern = new RegExp(
    `${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}(?:\\r?\\n)*`
  );

  if (!pattern.test(content)) {
    throw new Error(`README must contain ${start} and ${end}.`);
  }

  return content.replace(pattern, `${replacement}${"\n".repeat(trailingNewlines)}`);
}

function statusDisplay(status) {
  return {
    reachable: "🟢&#8288;可&#8288;访问",
    restricted: "🟡&#8288;访问&#8288;受限",
    unreachable: "🔴&#8288;无法&#8288;访问",
    unknown: "⚪&#8288;未&#8288;检测"
  }[status] ?? "⚪&#8288;未&#8288;检测";
}

function dateInTimeZone(timestamp) {
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    return "未检测";
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(new Date(timestamp))
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});

  return `${parts.year}&#8209;${parts.month}&#8209;${parts.day}`;
}

function plainDateInTimeZone(timestamp) {
  return dateInTimeZone(timestamp).replaceAll("&#8209;", "-");
}

function latestAvailabilityTimestamp(availabilityData) {
  if (availabilityData.generated_at && !Number.isNaN(Date.parse(availabilityData.generated_at))) {
    return availabilityData.generated_at;
  }

  const timestamps = availabilityData.results
    .map((result) => Date.parse(result.checked_at ?? ""))
    .filter((timestamp) => !Number.isNaN(timestamp));

  if (timestamps.length === 0) {
    return null;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

function badgePathDate(date) {
  return date.replaceAll("-", "--");
}

function todayInTimeZone() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(new Date())
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function replaceTopLevelUpdatedAt(text, date) {
  return text.replace(
    /("updated_at":\s*)"\d{4}-\d{2}-\d{2}"/,
    `$1"${date}"`
  );
}

function withoutTopLevelUpdatedAt(text) {
  return replaceTopLevelUpdatedAt(text, "0000-00-00");
}

async function readHeadFile(path) {
  try {
    const { stdout } = await execFileAsync("git", ["show", `HEAD:${path}`], {
      cwd: rootPath
    });
    return stdout;
  } catch {
    return null;
  }
}

async function syncUpdatedAtWhenChanged({ gitPath, text }) {
  const headText = await readHeadFile(gitPath);
  if (headText === null) {
    return text;
  }

  if (withoutTopLevelUpdatedAt(text) === withoutTopLevelUpdatedAt(headText)) {
    return text;
  }

  return replaceTopLevelUpdatedAt(text, todayInTimeZone());
}

function shortSummary(resource) {
  return String(resource.summary_short ?? resource.summary).replace(/[。.!！]$/, "");
}

function linkedShortSummary(resource) {
  const summary = markdownCell(shortSummary(resource));
  const contributor = String(resource.source?.submitted_by ?? "").match(/^@([A-Za-z0-9-]+)$/)?.[1];
  return contributor
    ? summary.replaceAll(`@${contributor}`, markdownLink(`@${contributor}`, `https://github.com/${contributor}`))
    : summary;
}

function recommendationStars(resource) {
  const rating = recommendationRating(resource);
  return Array.from({ length: rating }, () => "🌟").join("&#8288;");
}

function recommendationRating(resource) {
  const average =
    (resource.scores.more +
      resource.scores.speed +
      resource.scores.clean +
      resource.scores.stable) /
    4;
  return Math.min(5, Math.max(1, Math.round(average)));
}

function addedAtTime(resource) {
  const timestamp = Date.parse(resource.source?.added_at ?? "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function manualFeaturedOrder(resource) {
  return Number.isFinite(resource.featured_order)
    ? resource.featured_order
    : Number.POSITIVE_INFINITY;
}

function hasResourceNameLink(resource) {
  return typeof resource.link_url === "string" && resource.link_url.length > 0;
}

function isMultiWarehouseResource(resource) {
  return resource.name.includes("多仓");
}

function tvboxConfigSortGroup(resource) {
  if (resource.id === "xiao-he-zi") return 4;
  if (hasResourceNameLink(resource)) return 1;
  if (isMultiWarehouseResource(resource)) return 3;
  return 2;
}

function sortTvboxConfigResources(resources) {
  return [...resources].sort((left, right) => {
    return (
      tvboxConfigSortGroup(left) - tvboxConfigSortGroup(right) ||
      recommendationRating(right) - recommendationRating(left) ||
      manualFeaturedOrder(left) - manualFeaturedOrder(right) ||
      addedAtTime(right) - addedAtTime(left)
    );
  });
}

function sortOpenSourceResources(resources) {
  return [...resources].sort((left, right) => {
    return (
      (right.github?.stars ?? 0) - (left.github?.stars ?? 0) ||
      Date.parse(right.github?.pushed_at ?? "") - Date.parse(left.github?.pushed_at ?? "") ||
      left.name.localeCompare(right.name)
    );
  });
}

function sortFeaturedResources(resources, categoryId) {
  if (categoryId === "tvbox_config") {
    return sortTvboxConfigResources(resources);
  }

  if (categoryId === "open_source") {
    return sortOpenSourceResources(resources);
  }

  return [...resources].sort((left, right) => {
    return (
      manualFeaturedOrder(left) - manualFeaturedOrder(right) ||
      recommendationRating(right) - recommendationRating(left) ||
      addedAtTime(right) - addedAtTime(left)
    );
  });
}

function tableFor(resources, availabilityById, options = {}) {
  const summaryHeading = options.summaryHeading ?? "简介";
  const thirdHeading = options.thirdHeading ?? "推荐指数";
  const rows = resources
    .map((resource) => {
      const availability = availabilityById.get(resource.id);
      const status = statusDisplay(availability?.status ?? "unknown");
      const checkedAt = dateInTimeZone(availability?.checked_at);
      const plainName =
        typeof options.plainName === "function" ? options.plainName(resource) : options.plainName;
      const showUrlInSummary =
        typeof options.showUrlInSummary === "function"
          ? options.showUrlInSummary(resource)
          : options.showUrlInSummary;
      const nameCell = plainName
        ? markdownCell(resource.name)
        : markdownLink(resource.name, resource.link_url ?? resource.url);
      const summaryCell = showUrlInSummary
        ? markdownCode(resource.url)
        : linkedShortSummary(resource);
      const thirdCell =
        typeof options.thirdCell === "function"
          ? options.thirdCell(resource)
          : recommendationStars(resource);

      return `| ${nameCell} | ${summaryCell} | ${markdownCell(thirdCell)} | <!-- availability:${resource.id} -->${status}<!-- /availability:${resource.id} --> | <!-- availability-date:${resource.id} -->${checkedAt}<!-- /availability-date:${resource.id} --> |`;
    })
    .join("\n");

  return `| 资源 | ${summaryHeading} | ${thirdHeading} | 状态 | 检测时间 |
| --- | --- | :---: | :---: | :---: |
${rows}`;
}

function videoAppTableFor(resources, availabilityById) {
  const rows = resources
    .map((resource) => {
      const availability = availabilityById.get(resource.id);
      const status = statusDisplay(availability?.status ?? "unknown");
      const checkedAt = dateInTimeZone(availability?.checked_at);
      const platforms = (resource.platforms ?? []).join(" / ") || "未注明";

      return `    <tr>
      <td nowrap><a href="${escapeHtml(resource.link_url ?? resource.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(resource.name)}</a></td>
      <td>${escapeHtml(shortSummary(resource))}</td>
      <td align="center">${escapeHtml(platforms)}</td>
      <td align="center" nowrap><!-- availability:${resource.id} -->${status}<!-- /availability:${resource.id} --></td>
      <td align="center" nowrap><!-- availability-date:${resource.id} -->${checkedAt}<!-- /availability-date:${resource.id} --></td>
    </tr>`;
    })
    .join("\n");

  return `<table width="100%">
  <thead>
    <tr>
      <th width="15%" nowrap>资源</th>
      <th width="25%" nowrap>简介</th>
      <th width="32%" nowrap>支持平台</th>
      <th width="12%" nowrap>状态</th>
      <th width="16%" nowrap>检测时间</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

function openSourceTableFor(resources) {
  const starFormatter = new Intl.NumberFormat("en-US");
  const rows = resources
    .map((resource) => {
      return `| ${markdownLink(resource.name, resource.url)} | ${markdownCell(shortSummary(resource))} | ${markdownCell(starFormatter.format(resource.github.stars))} | ${markdownCell(plainDateInTimeZone(resource.github.pushed_at))} |`;
    })
    .join("\n");

  return `| 资源 | 简介 | star数 | 仓库更新时间 |
| --- | --- | :---: | :---: |
${rows}`;
}

function categoryIntro(categoryId) {
  if (categoryId === "tvbox_config") {
    return "> 不知道怎么配置？点击查看：[接口配置教程（图文版）](https://b.zhuiju.me/p/5)";
  }

  if (categoryId === "subscription") {
    return "> 不知道直播源怎么导入？点击查看：[直播源地址与使用说明](https://b.zhuiju.me/p/26)";
  }

  return "";
}

function categorySection(category, resources, availabilityById) {
  const categoryResources = sortFeaturedResources(
    resources.filter((resource) => resource.category === category.id),
    category.id
  );
  const intro = categoryIntro(category.id);
  const introBlock = intro ? `${intro}\n\n` : "";
  let content;

  if (categoryResources.length > 0) {
    content =
      category.id === "open_source"
        ? openSourceTableFor(categoryResources)
        : category.id === "video_app"
          ? videoAppTableFor(categoryResources, availabilityById)
        : tableFor(categoryResources, availabilityById, {
            summaryHeading: ["tvbox_config", "subscription"].includes(category.id) ? "地址" : "简介",
            thirdHeading: "推荐指数",
            plainName: (resource) =>
              ["tvbox_config", "subscription"].includes(category.id) && !resource.link_url,
            showUrlInSummary: (resource) =>
              (category.id === "tvbox_config" && resource.summary_short === "影视仓配置地址") ||
              category.id === "subscription"
          });
  } else {
    content =
      "_等待首条通过验证的精选资源。你可以 [推荐一个资源](https://github.com/laoma528/awesome-zhuiju-free/issues/new?template=resource.yml)。_";
  }

  return `### ${category.name}

${introBlock}${content}

<p align="right"><a href="#精选资源">返回分类导航</a></p>`;
}

function communityContributorName(value) {
  const match = String(value ?? "").trim().match(/^@([A-Za-z0-9-]+)$/);
  if (!match) {
    return null;
  }

  const username = match[1];
  const lowerUsername = username.toLowerCase();
  if (ownerUsernames.has(lowerUsername) || lowerUsername.endsWith("[bot]")) {
    return null;
  }
  return username;
}

function communityContributorsFor(resources) {
  const contributors = new Map();

  for (const resource of resources) {
    const username = communityContributorName(resource.source?.submitted_by);
    if (!username) {
      continue;
    }

    const addedAt = Date.parse(resource.source?.added_at ?? "") || 0;
    const current = contributors.get(username) ?? {
      username,
      count: 0,
      firstAddedAt: addedAt || Number.POSITIVE_INFINITY
    };
    current.count += 1;
    current.firstAddedAt = Math.min(current.firstAddedAt, addedAt || Number.POSITIVE_INFINITY);
    contributors.set(username, current);
  }

  return [...contributors.values()].sort((left, right) => {
    return right.count - left.count || left.firstAddedAt - right.firstAddedAt || left.username.localeCompare(right.username);
  });
}

function avatarUrl(username) {
  return `https://images.weserv.nl/?url=github.com/${encodeURIComponent(username)}.png&h=96&w=96&fit=cover&mask=circle`;
}

function communityContributorsSection(resources) {
  const contributors = communityContributorsFor(resources);
  if (contributors.length === 0) {
    return `${contributorsStartMarker}
_等待首位通过资源推荐参与共建的社区贡献者。_
${contributorsEndMarker}`;
  }

  const rows = chunk(contributors, 6)
    .map((row) => {
      const cells = row
        .map((contributor) => {
          const profileUrl = `https://github.com/${contributor.username}`;
          const resourceText = `${contributor.count} 个资源`;
          return `<td align="center" width="96">
  <a href="${profileUrl}"><img src="${avatarUrl(contributor.username)}" width="56" height="56" alt="@${contributor.username}"></a><br>
  <sub><strong>@${contributor.username}</strong></sub><br>
  <sub>${resourceText}</sub>
</td>`;
        })
        .join("\n");
      return `<tr>
${cells}
</tr>`;
    })
    .join("\n");

  return `${contributorsStartMarker}
<p align="center">感谢这些朋友通过 Issue 推荐资源，并在维护者确认后参与共建。</p>

<table align="center">
  <tbody>
${rows}
  </tbody>
</table>

<p align="center"><sub>仅展示通过审核并进入资源库的社区推荐者。</sub></p>
${contributorsEndMarker}`;
}

let resourcesText = await readFile(resourcesPath, "utf8");
const updatedResourcesText = await syncUpdatedAtWhenChanged({
  gitPath: "resources/resources.json",
  text: resourcesText
});
if (updatedResourcesText !== resourcesText) {
  await writeFile(resourcesPath, updatedResourcesText, "utf8");
  resourcesText = updatedResourcesText;
}

let verificationsText = await readFile(verificationsPath, "utf8");
const updatedVerificationsText = await syncUpdatedAtWhenChanged({
  gitPath: "reports/verifications.json",
  text: verificationsText
});
if (updatedVerificationsText !== verificationsText) {
  await writeFile(verificationsPath, updatedVerificationsText, "utf8");
  verificationsText = updatedVerificationsText;
}

const resourcesData = JSON.parse(resourcesText);
const availabilityData = JSON.parse(await readFile(availabilityPath, "utf8"));
const featuredResources = resourcesData.resources.filter((resource) => resource.featured);
const currentUrlsById = new Map(resourcesData.resources.map((resource) => [resource.id, resource.url]));
const availabilityById = new Map(
  availabilityData.results
    .filter((result) => currentUrlsById.get(result.resource_id) === result.url)
    .map((result) => [result.resource_id, result])
);

const badges = categories
  .map((category) => {
    const count = featuredResources.filter((resource) => resource.category === category.id).length;
    return `  <a href="#${anchorFor(category.name)}"><img src="https://img.shields.io/badge/${category.badge}-${count}-${category.color}?style=flat-square" alt="${category.name}"></a>`;
  })
  .join("\n");

const generated = `${startMarker}
<p align="center">
${badges}
</p>

<details>
<summary><strong>查看自动检测状态说明</strong></summary>

精选内容来自 [\`resources/resources.json\`](resources/resources.json)。状态由 GitHub Actions 每日自动检测：\`🟢 可访问\`、\`🟡 访问受限\`、\`🔴 无法访问\`、\`⚪ 未检测\`。检测结果仅代表 GitHub Actions 节点当时的网络情况。

状态只判断主页是否响应，不替代完整体验评价。完整检测结果见 [\`reports/availability.json\`](reports/availability.json)。

检测任务每天北京时间 09:00 左右运行；新增或修改资源后也会自动运行。你也可以在 [Check availability](https://github.com/laoma528/awesome-zhuiju-free/actions/workflows/check-availability.yml) 页面手动触发。

</details>

${categories
  .map((category) => categorySection(category, featuredResources, availabilityById))
  .join("\n\n")}
${endMarker}`;

const readme = await readFile(readmePath, "utf8");
const availabilityDate = plainDateInTimeZone(latestAvailabilityTimestamp(availabilityData));
const countBadge = `${countStartMarker}
<a href="resources/resources.json"><img src="https://img.shields.io/badge/已收录-${resourcesData.resources.length}_个资源-00A98F?style=flat-square" alt="已收录 ${resourcesData.resources.length} 个资源" height="24"></a>
${countEndMarker}`;
let updatedReadme = replaceMarkedBlock(readme, startMarker, endMarker, generated, 2);
updatedReadme = replaceMarkedBlock(
  updatedReadme,
  contributorsStartMarker,
  contributorsEndMarker,
  communityContributorsSection(resourcesData.resources),
  2
);
updatedReadme = replaceMarkedBlock(
  updatedReadme,
  countStartMarker,
  countEndMarker,
  countBadge,
  1
);

const headerBadgesPattern =
  /<p align="center">\r?\n  <a href="https:\/\/zhuiju\.me">[\s\S]*?<\/p>/;
const headerBadges = `<p align="center">
  <a href="https://zhuiju.me"><img src="https://img.shields.io/badge/网站-zhuiju.me-0A66C2?style=flat-square" alt="网站 zhuiju.me" height="24"></a>
  ${countBadge}
  <a href="https://github.com/laoma528/awesome-zhuiju-free/actions/workflows/check-availability.yml"><img src="https://img.shields.io/badge/检测时间-${badgePathDate(availabilityDate)}-00B4D8?style=flat-square" alt="检测时间 ${availabilityDate}" height="24"></a>
  <a href="https://github.com/laoma528/awesome-zhuiju-free/stargazers"><img src="https://img.shields.io/github/stars/laoma528/awesome-zhuiju-free?style=flat-square&label=Stars&color=F7B801" alt="GitHub Stars" height="24"></a>
  <a href="https://github.com/laoma528/awesome-zhuiju-free/forks"><img src="https://img.shields.io/github/forks/laoma528/awesome-zhuiju-free?style=flat-square&label=Forks&color=38BDF8" alt="GitHub Forks" height="24"></a>
  <a href="https://creativecommons.org/licenses/by/4.0/"><img src="https://img.shields.io/badge/许可证-CC_BY_4.0-6F42C1?style=flat-square" alt="许可证 CC BY 4.0" height="24"></a>
  <a href="https://deepwiki.com/laoma528/awesome-zhuiju-free"><img src="https://img.shields.io/badge/Ask-DeepWiki-1F6FEB?style=flat-square" alt="Ask DeepWiki" height="24"></a>
</p>`;

if (!headerBadgesPattern.test(updatedReadme)) {
  throw new Error("README header badges block is missing or has an unexpected format.");
}
updatedReadme = updatedReadme.replace(headerBadgesPattern, headerBadges);

if (updatedReadme !== readme) {
  await writeFile(readmePath, updatedReadme, "utf8");
  console.log(`README featured section synced from ${featuredResources.length} resources.`);
} else {
  console.log("README featured section is already up to date.");
}

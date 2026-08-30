/**
 * Maintains the generated SDK Release -> API Release compatibility table in
 * an SDK Target's CHANGELOG.md - see CONTEXT.md on Source API Version: with
 * no shared version line between an SDK Release and an API Release, this
 * table and the sourceApiVersion field written by src/package-metadata.mjs
 * are the only link between them.
 *
 * The table lives between two HTML comment markers so it can be regenerated
 * without disturbing hand-written changelog content around it. This module
 * is a pure string transformation: no I/O happens here - see
 * src/write-package-metadata.mjs, which calls it as part of the same
 * pipeline step.
 */

const TABLE_START = "<!-- compatibility-table:start -->";
const TABLE_END = "<!-- compatibility-table:end -->";
const TABLE_HEADER = ["| SDK Release | API Release | Date |", "| --- | --- | --- |"];

function parseTableRows(tableBlock) {
  const rows = [];

  for (const line of tableBlock.split("\n")) {
    const match = /^\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|$/.exec(line.trim());

    if (match && !TABLE_HEADER.includes(line.trim())) {
      rows.push({ sdkVersion: match[1], sourceApiVersion: match[2], date: match[3] });
    }
  }

  return rows;
}

function renderTable(rows) {
  const lines = rows.map((row) => `| ${row.sdkVersion} | ${row.sourceApiVersion} | ${row.date} |`);
  return [TABLE_START, ...TABLE_HEADER, ...lines, TABLE_END].join("\n");
}

function upsertCompatibilityTable(changelogContent, { sdkVersion, sourceApiVersion, date }) {
  const startIndex = changelogContent.indexOf(TABLE_START);
  const endIndex = changelogContent.indexOf(TABLE_END);
  const hasExistingTable = startIndex !== -1 && endIndex !== -1 && endIndex > startIndex;

  const existingRows = hasExistingTable
    ? parseTableRows(changelogContent.slice(startIndex, endIndex))
    : [];

  const nextRows = [
    { sdkVersion, sourceApiVersion, date },
    ...existingRows.filter((row) => row.sdkVersion !== sdkVersion)
  ];

  const table = renderTable(nextRows);

  if (hasExistingTable) {
    return (
      changelogContent.slice(0, startIndex) + table + changelogContent.slice(endIndex + TABLE_END.length)
    );
  }

  const separator = changelogContent.endsWith("\n") ? "\n" : "\n\n";
  return `${changelogContent}${separator}${table}\n`;
}

export { upsertCompatibilityTable };

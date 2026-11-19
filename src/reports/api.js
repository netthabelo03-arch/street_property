// For admins: reported conversations.

import { getClient } from '../auth/client.js';

function check({ data, error }) {
  if (error) throw error;
  return data;
}

export async function openReports() {
  const client = await getClient();
  return check(await client.rpc('report_list'));
}

export async function reportMessages(reportId) {
  const client = await getClient();
  return check(await client.rpc('report_messages', { p_report: reportId }));
}

export async function resolveReport(reportId, outcome, takeDown) {
  const client = await getClient();
  check(await client.rpc('resolve_report', { p_report: reportId, p_outcome: outcome, p_take_down: Boolean(takeDown) }));
}

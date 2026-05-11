interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * NSF Awards MCP — National Science Foundation award database (free, no auth)
 *
 * Sister pack to nih-reporter. Covers ~$10B/yr of NSF-funded research across
 * physical sciences, engineering, CS, math, education, social sciences.
 *
 * API: https://www.research.gov/common/webapi/awardapisearch-v1.htm
 * Tools:
 * - search_awards: filter by keyword, PI name, awardee, agency code, date range, state
 * - get_award:     single full record by award ID (includes abstract + project outcomes)
 */


const BASE_URL = 'https://api.nsf.gov/services/v1/awards';

const SUMMARY_FIELDS = [
  'id',
  'title',
  'awardeeName',
  'awardeeCity',
  'awardeeStateCode',
  'awardeeCountryCode',
  'piFirstName',
  'piLastName',
  'pdPIName',
  'fundsObligatedAmt',
  'estimatedTotalAmt',
  'startDate',
  'expDate',
  'date',
  'agency',
  'fundProgramName',
  'cfdaNumber',
  'transType',
];

const FULL_FIELDS = [
  ...SUMMARY_FIELDS,
  'abstract',
  'projectOutComesReport',
  'piEmail',
  'coPDPI',
  'perfLocation',
  'perfCity',
  'perfStateCode',
  'perfZipCode',
  'awardeeAddress',
  'publicationResearch',
  'publicationConference',
];

const tools: McpToolExport['tools'] = [
  {
    name: 'search_awards',
    description:
      'Search NSF awards. Filter by keyword (matches title/abstract), PI name, awardee institution, NSF program, date range, US state, or country. Returns title, PI, awardee, amount, dates, program. Use get_award for full abstract + outcomes report.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Search term (title + abstract)' },
        pi_name: { type: 'string', description: 'PI full or last name' },
        awardee: { type: 'string', description: 'Awardee institution name' },
        program: { type: 'string', description: 'NSF program name (e.g., "Algorithms in the Field")' },
        state: { type: 'string', description: 'Awardee US state code (e.g., "CA")' },
        country: { type: 'string', description: 'Awardee country code (e.g., "US")' },
        date_start: { type: 'string', description: 'Award start date >= MM/DD/YYYY' },
        date_end: { type: 'string', description: 'Award start date <= MM/DD/YYYY' },
        limit: { type: 'number', description: 'Results per page (1-25, default 25 — NSF max)' },
        offset: { type: 'number', description: 'Pagination offset (default 1)' },
      },
      required: [],
    },
  },
  {
    name: 'get_award',
    description:
      'Fetch a single NSF award by ID. Returns full abstract, project outcomes report (if completed), and detailed PI/awardee info.',
    inputSchema: {
      type: 'object',
      properties: {
        award_id: { type: 'string', description: 'NSF award ID (numeric string)' },
      },
      required: ['award_id'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_awards':
      return searchAwards(args);
    case 'get_award':
      return getAward(args.award_id as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function searchAwards(args: Record<string, unknown>) {
  const params = new URLSearchParams({
    printFields: SUMMARY_FIELDS.join(','),
    rpp: String(Math.min(25, Math.max(1, (args.limit as number) ?? 25))),
    offset: String((args.offset as number) ?? 1),
  });

  if (args.keyword) params.set('keyword', String(args.keyword));
  if (args.pi_name) params.set('pdPIName', String(args.pi_name));
  if (args.awardee) params.set('awardeeName', String(args.awardee));
  if (args.program) params.set('fundProgramName', String(args.program));
  if (args.state) params.set('awardeeStateCode', String(args.state).toUpperCase());
  if (args.country) params.set('awardeeCountryCode', String(args.country).toUpperCase());
  if (args.date_start) params.set('dateStart', String(args.date_start));
  if (args.date_end) params.set('dateEnd', String(args.date_end));

  const res = await fetch(`${BASE_URL}.json?${params}`);
  if (!res.ok) throw new Error(`NSF API error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as { response?: { award?: AwardRecord[]; serviceNotification?: unknown[] } };
  const awards = data.response?.award ?? [];

  return {
    returned: awards.length,
    note: 'NSF API caps rpp at 25; use offset to paginate.',
    awards: awards.map((a) => normalizeAward(a, false)),
  };
}

async function getAward(awardId: string) {
  const params = new URLSearchParams({
    id: awardId,
    printFields: FULL_FIELDS.join(','),
  });

  const res = await fetch(`${BASE_URL}.json?${params}`);
  if (!res.ok) throw new Error(`NSF API error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as { response?: { award?: AwardRecord[] } };
  const a = data.response?.award?.[0];
  if (!a) throw new Error(`No NSF award found for id ${awardId}`);
  return normalizeAward(a, true);
}

interface AwardRecord {
  id?: string;
  title?: string;
  awardeeName?: string;
  awardeeCity?: string;
  awardeeStateCode?: string;
  awardeeCountryCode?: string;
  awardeeAddress?: string;
  pdPIName?: string;
  piFirstName?: string;
  piLastName?: string;
  piEmail?: string;
  coPDPI?: string[];
  fundsObligatedAmt?: string;
  estimatedTotalAmt?: string;
  startDate?: string;
  expDate?: string;
  date?: string;
  agency?: string;
  fundProgramName?: string;
  cfdaNumber?: string;
  transType?: string;
  abstract?: string;
  projectOutComesReport?: string;
  perfLocation?: string;
  perfCity?: string;
  perfStateCode?: string;
  perfZipCode?: string;
  publicationResearch?: string[];
  publicationConference?: string[];
}

function normalizeAward(a: AwardRecord, full: boolean) {
  const out: Record<string, unknown> = {
    award_id: a.id ?? null,
    title: a.title ?? null,
    pi: a.pdPIName ?? ([a.piFirstName, a.piLastName].filter(Boolean).join(' ') || null),
    awardee: a.awardeeName ?? null,
    awardee_city: a.awardeeCity ?? null,
    awardee_state: a.awardeeStateCode ?? null,
    awardee_country: a.awardeeCountryCode ?? null,
    funds_obligated: a.fundsObligatedAmt ? Number(a.fundsObligatedAmt) : null,
    estimated_total: a.estimatedTotalAmt ? Number(a.estimatedTotalAmt) : null,
    start_date: a.startDate ?? null,
    expiration_date: a.expDate ?? null,
    award_date: a.date ?? null,
    agency: a.agency ?? null,
    program: a.fundProgramName ?? null,
    cfda_number: a.cfdaNumber ?? null,
    transaction_type: a.transType ?? null,
    nsf_url: a.id ? `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${a.id}` : null,
  };

  if (full) {
    out.pi_email = a.piEmail ?? null;
    out.co_pi = a.coPDPI ?? [];
    out.performance_location = a.perfLocation ?? null;
    out.performance_city = a.perfCity ?? null;
    out.performance_state = a.perfStateCode ?? null;
    out.performance_zip = a.perfZipCode ?? null;
    out.awardee_address = a.awardeeAddress ?? null;
    out.abstract = a.abstract ?? null;
    out.outcomes_report = a.projectOutComesReport ?? null;
    out.publications = [...(a.publicationResearch ?? []), ...(a.publicationConference ?? [])];
  }
  return out;
}

export default { tools, callTool, meter: { credits: 2 } } satisfies McpToolExport;

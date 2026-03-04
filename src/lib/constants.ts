export const ORIGIN_LOCATIONS = [
  'BS West 48',
  'BS Middle 48',
  'BS 72',
  'BS Hopper',
  'BS 42',
  'BS East 48',
  'BS East 60',
  'BS West 60',
  'CG West',
  'CG East',
  'LP West',
  'LP East',
  'Campbell West',
  'Campbell East',
  'Home MFS',
  'Home TC',
  'LR Tight',
  "Jimmy's",
  'RG Bin',
  'RG Small N',
  'RG Small S',
  'BS Old Wet Bin',
  'Saratoga A',
  'Saratoga B',
  'TK Behlen',
  'Beaver',
  'Blaisedell',
  'Broadmoore',
  "Calder's",
  'Camelot',
  'Campbell',
  'Cappys',
  'Castleton',
  'CG',
  'CG 120',
  'CG Lake',
  "Chapin's",
  "Chapman's",
  "Ernie's",
  "Gray's",
  'Grubb 40',
  "Hancher's East",
  "Hancher's West",
  'Home North',
  'Home South',
  "Jimmy's 40",
  'Home West',
  "Howard's",
  'Ioder',
  "Kate's",
  'Kiser',
  'Lawn Ridge North',
  'Lawn Ridge South',
  "LeRoy's",
  'LP 39',
  'LP W 75',
  "Lynch's",
  "Mangold's",
  'Mannix North',
  'Mannix South',
  "Marshall's",
  'McKinsey',
  'McNutt',
  'Milo',
  "Neil's",
  "Norm's",
  "Orlyn's",
  'Palace',
  'RG Arrow',
  'RG Centerville',
  'RG Hazel',
  'RG Hensel',
  'RG House',
  'RG Loren',
  'RG NWRR',
  'RG Santa Fe',
  'RG Shop',
  'RG SWRR',
  "Ruby's",
  'Saratoga',
  'Shallowbrook',
  "Stanley's",
  "Steve's",
  'Stone',
  'The Ridge',
  'Western',
  'Yordy',
] as const;

export const PERSON_OPTIONS = [
  'Karl',
  'Anthony',
  'Ethan',
  'Bob',
  'Connie',
  'Bonnie',
  'Roger',
  'PHF',
  'Mannix',
  'Routh',
] as const;

export const CROP_YEARS = ['2024', '2025', '2026', '2027', '2028'] as const;

export const THROUGH_OPTIONS = ['Akron', 'RVC', 'Cargill', 'ADM'] as const;

export const CROP_OPTIONS = ['Corn', 'Soybeans'] as const;

// Title case a string: "soybeans" -> "Soybeans", "ADM" stays "ADM"
function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Match a value to a known list (case-insensitive), return the canonical version
function matchToList(value: string, list: readonly string[]): string {
  if (!value) return value;
  const lower = value.trim().toLowerCase();
  const match = list.find(item => item.toLowerCase() === lower);
  return match || value.trim();
}

// Normalize all ticket fields to canonical casing so matching always works
export function normalizeTicketFields(data: {
  person?: string;
  crop?: string;
  through?: string;
  [key: string]: any;
}): typeof data {
  const result = { ...data };
  if (result.person) result.person = matchToList(result.person, PERSON_OPTIONS);
  if (result.crop) result.crop = matchToList(result.crop, CROP_OPTIONS);
  if (result.through) result.through = matchToList(result.through, THROUGH_OPTIONS);
  return result;
}

// Normalize contract fields (owner/crop/through/destination) to canonical casing
export function normalizeContractFields(data: {
  owner?: string | null;
  crop?: string;
  through?: string | null;
  destination?: string;
  [key: string]: any;
}): typeof data {
  const result = { ...data };
  if (result.owner) result.owner = matchToList(result.owner, PERSON_OPTIONS);
  if (result.crop) result.crop = matchToList(result.crop, CROP_OPTIONS);
  if (result.through) result.through = matchToList(result.through, THROUGH_OPTIONS);
  if (result.destination) result.destination = result.destination.trim();
  return result;
}

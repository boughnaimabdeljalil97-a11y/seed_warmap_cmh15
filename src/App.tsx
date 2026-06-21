import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ClipboardCopy, 
  Trash2, 
  Play, 
  Layers, 
  Clock, 
  ChevronRight, 
  ChevronDown, 
  Terminal,
  Activity,
  FileJson,
  ArrowRight,
  Columns,
  Ban,
  Search,
  Download
} from 'lucide-react';

// --- Types ---

type ProcessingMode = 'distribution' | 'flatten' | 'reorganize' | 'divide';

interface DivideProfileEntry {
  tagName: string;
  profileNumber: number;
  id: string;
}

interface DivideResultData {
  [tagName: string]: DivideProfileEntry[];
}

interface ReorganizedEntry {
  number: string;
  name: string;
  id: string;
  proxy?: string;
}

interface ReorganizedData {
  [sessionName: string]: ReorganizedEntry[];
}

interface RawDataEntry {
  dropName: string;
  sessionName: string;
  profileNumber: string;
}

interface GroupedData {
  [dropName: string]: {
    [sessionName: string]: string[];
  };
}

interface DistributedData {
  [dropName: string]: {
    [sessionName: string]: {
      [hour: number]: string[];
    };
  };
}

// --- Logic Functions (Required Names) ---

/**
 * Detects if the input contains "Drops" based on keywords.
 */
function detect_format(input: string): 'multi-drop' | 'single-list' {
  const hasDropKeyword = /drop/i.test(input);
  return hasDropKeyword ? 'multi-drop' : 'single-list';
}

/**
 * Extracts ONLY the ID inside brackets [] sequentially from all lines.
 * Each line may contain multiple groups.
 */
function extract_ids(input: string): string[] {
  const ids: string[] = [];
  const seenIds = new Set<string>();
  const lines = input.split(/\r?\n/);
  // Match content inside brackets: [ID]
  const bracketRegex = /\[([^\]]+)\]/g;
  
  lines.forEach(line => {
    let match;
    while ((match = bracketRegex.exec(line)) !== null) {
      const id = `[${match[1]}]`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        ids.push(id);
      }
    }
  });
  return ids;
}

/**
 * Reorganizes horizontal multi-session rows into vertical grouped records.
 * Optionally assigns proxies if provided.
 */
function parse_reorganize(input: string, proxyList: string[] = []): ReorganizedData {
  const result: ReorganizedData = {};
  const seenIds = new Set<string>();
  const lines = input.split(/\r?\n/);
  // regex: session_name whitespace number whitespace [ID]
  const groupRegex = /(\S+)\s+(\d+)\s+(\[[^\]]+\])/g;

  const entries: { name: string; number: string; id: string }[] = [];

  lines.forEach(line => {
    let match;
    while ((match = groupRegex.exec(line)) !== null) {
      const [_, name, number, id] = match;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        entries.push({ name, number, id });
      }
    }
  });

  // Proxy Assignment Logic
  let assignedProxies: string[] = [];
  if (proxyList.length > 0) {
    if (proxyList.length >= entries.length) {
      // Case 1: More or equal proxies -> shuffle and pick unique
      const shuffled = [...proxyList].sort(() => Math.random() - 0.5);
      assignedProxies = shuffled.slice(0, entries.length);
    } else {
      // Case 2: Fewer proxies -> reuse cyclically
      assignedProxies = entries.map((_, i) => proxyList[i % proxyList.length]);
    }
  }

  entries.forEach((entry, i) => {
    if (!result[entry.name]) {
      result[entry.name] = [];
    }
    const reorganizedEntry: ReorganizedEntry = { 
      number: entry.number, 
      name: entry.name, 
      id: entry.id 
    };
    if (assignedProxies[i]) {
      reorganizedEntry.proxy = assignedProxies[i];
    }
    result[entry.name].push(reorganizedEntry);
  });

  return result;
}

/**
 * Extracts set of unique IP:PORT proxies from input text.
 * Prevents crashes and filters out random text.
 */
function extract_excluded_proxies(input: string): Set<string> {
  const excluded = new Set<string>();
  if (!input.trim()) return excluded;

  const ipPortRegex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+\b/g;
  const matches = input.match(ipPortRegex);
  if (matches) {
    matches.forEach(m => {
      excluded.add(m.trim());
    });
  }
  return excluded;
}

/**
 * Robust parsing logic for identifying SessionNames & ProfileNumbers.
 * 1. Remove anything inside brackets [].
 * 2. Split each line using ANY whitespace (spaces or tabs).
 * 3. Process sequentially in pairs (session, profile).
 */
function parse_input(input: string): RawDataEntry[] {
  // 1. Remove bracketed content
  const cleanInput = input.replace(/\[[^\]]*\]/g, ' ');
  const lines = cleanInput.split(/\r?\n/);
  const results: RawDataEntry[] = [];
  
  let currentDrop = 'Drop 1';

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Check for "Drop X" markers to switch drop context
    // Handles formatted blocks where drops are listed sequentially
    const dropMarkerMatch = trimmed.match(/^Drop\s*(\d+)$/i);
    if (dropMarkerMatch) {
      currentDrop = `Drop ${dropMarkerMatch[1]}`;
      return;
    }

    // Split line using ANY whitespace (spaces OR tabs)
    const parts = trimmed.split(/\s+/).filter(p => p.length > 0);
    
    // Each line can contain multiple groups -> process in pairs
    for (let i = 0; i < parts.length; i += 2) {
      const session = parts[i];
      const profile = parts[i + 1];
      
      // If we see "Drop" word as a session, it's likely a header, skip it
      if (session.toLowerCase() === 'drop' && !isNaN(Number(profile))) {
        // If it's just "Drop 1", it was caught above, but if it's on a line with others
        // we could potentially update context, but generally just skip headers
        continue;
      }

      // Basic validation: profile should be numeric
      if (session && profile && !isNaN(Number(profile))) {
        results.push({
          dropName: currentDrop,
          sessionName: session,
          profileNumber: profile
        });
      }
    }
  });

  return results;
}

/**
 * Groups raw extracted entries by drop and session.
 * Deduplicates profiles PER SESSION, keeping only the first occurrence and preserving order.
 */
function group_sessions(data: RawDataEntry[]): GroupedData {
  const grouped: GroupedData = {};
  const seenPerSession: { [key: string]: Set<string> } = {};

  data.forEach(entry => {
    if (!grouped[entry.dropName]) grouped[entry.dropName] = {};
    if (!grouped[entry.dropName][entry.sessionName]) {
      grouped[entry.dropName][entry.sessionName] = [];
    }

    const key = `${entry.dropName}|${entry.sessionName}`;
    if (!seenPerSession[key]) {
      seenPerSession[key] = new Set();
    }

    if (!seenPerSession[key].has(entry.profileNumber)) {
      seenPerSession[key].add(entry.profileNumber);
      grouped[entry.dropName][entry.sessionName].push(entry.profileNumber);
    }
  });
  return grouped;
}

/**
 * Distributes profiles into a 23-hour schedule for each session.
 * Revised: Groups by Session -> Hours with sequential slicing.
 */
function split_into_23_hours(grouped: GroupedData): DistributedData {
  const distributed: DistributedData = {};

  Object.entries(grouped).forEach(([dropName, sessions]) => {
    distributed[dropName] = {};

    Object.entries(sessions).forEach(([sessionName, profiles]) => {
      distributed[dropName][sessionName] = {};
      
      const total = profiles.length;
      // Algorithm: Split sequentially into 23 hours, handling remainder properly for balance.
      const baseCount = Math.floor(total / 23);
      const remainder = total % 23;

      let currentIndex = 0;
      for (let h = 1; h <= 23; h++) {
        const countForThisHour = baseCount + (h <= remainder ? 1 : 0);
        const chunk = profiles.slice(currentIndex, currentIndex + countForThisHour);
        
        distributed[dropName][sessionName][h] = chunk;
        currentIndex += countForThisHour;
      }
    });
  });

  return distributed;
}

/**
 * Cleanup output for consumption.
 */
function format_output(result: DistributedData): DistributedData {
  return result;
}

/**
 * Utility to parse intervals mapping horizontally.
 */
function parse_intervals(intervalsInput: string): { [tagName: string]: { min: number; max: number } } {
  const lines = intervalsInput.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const mapping: { [tagName: string]: { min: number; max: number } } = {};
  if (lines.length < 2) return mapping;

  const splitTags = lines[0].includes('\t') ? lines[0].split('\t') : lines[0].split(/\s+/);
  const splitIntervals = lines[1].includes('\t') ? lines[1].split('\t') : lines[1].split(/\s+/);

  const tags = splitTags.map(t => t.trim()).filter(t => t.length > 0);
  const intervals = splitIntervals.map(i => i.trim()).filter(i => i.length > 0);

  for (let idx = 0; idx < Math.min(tags.length, intervals.length); idx++) {
    const tagName = tags[idx];
    const intervalStr = intervals[idx];
    const match = intervalStr.match(/^(\d+)-(\d+)$/);
    if (match) {
      const min = parseInt(match[1], 10);
      const max = parseInt(match[2], 10);
      mapping[tagName] = { min, max };
    }
  }
  return mapping;
}

/**
 * Main logical processing function for Divide Tags feature.
 */
function process_divide_tags(sessionData: string, intervalsData: string): DivideResultData {
  const result: DivideResultData = {};
  const intervalMapping = parse_intervals(intervalsData);
  
  const lines = sessionData.split(/\r?\n/);
  const lineRegex = /(\S+)\s+(\d+)\s+(\[[^\]]+\])/;
  
  const entriesByTag: { [tag: string]: { tagName: string; profileNumber: number; id: string }[] } = {};
  
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const match = trimmed.match(lineRegex);
    if (match) {
      const [_, tagName, numStr, id] = match;
      const profileNumber = parseInt(numStr, 10);
      if (!entriesByTag[tagName]) {
        entriesByTag[tagName] = [];
      }
      entriesByTag[tagName].push({ tagName, profileNumber, id });
    }
  });

  Object.keys(entriesByTag).forEach(tagName => {
    const profiles = entriesByTag[tagName];
    profiles.sort((a, b) => a.profileNumber - b.profileNumber);
    
    const interval = intervalMapping[tagName];
    if (interval) {
      const filtered = profiles.filter(p => p.profileNumber >= interval.min && p.profileNumber <= interval.max);
      if (filtered.length > 0) {
        result[tagName] = filtered;
      }
    } else {
      result[tagName] = profiles;
    }
  });

  return result;
}

/**
 * String formatter for results to be copied.
 */
function format_divide_output(data: DivideResultData): string {
  const parts: string[] = [];
  const tagNames = Object.keys(data);
  
  tagNames.forEach(tagName => {
    const profiles = data[tagName];
    const sortedProfiles = [...profiles].sort((a, b) => a.profileNumber - b.profileNumber);
    const profileLines = sortedProfiles.map(p => `${p.tagName}\t${p.profileNumber}\t${p.id}`).join('\n');
    if (profileLines) {
      parts.push(profileLines);
    }
  });
  
  return parts.join('\n');
}

/**
 * Formats divided data horizontally specifically for pasting into Google Sheets or Excel.
 * Each tag occupies exactly 3 columns: Tag Name | Profile Number | Profile ID
 * Sorted in the strict ordered sequence of 8 predefined tags.
 * Outputs ONLY raw data rows without any headers, column labels, empty separators, or totals.
 */
function format_divide_sheets_output(data: DivideResultData): string {
  const FIXED_TAGS_ORDER = [
    'CMH15_SNDS',
    'CMH15_Connect_fresh',
    'CMH15_CONNECT_hotmail',
    'CMH15_hotmail_2',
    'CMH15_hotmail_3',
    'CMH15_hotmail_4',
    'CMH15_warmup_1',
    'CMH15_warmup_2'
  ];

  const sortedData: { [tagName: string]: DivideProfileEntry[] } = {};
  FIXED_TAGS_ORDER.forEach(tagName => {
    const list = data[tagName] || [];
    sortedData[tagName] = [...list].sort((a, b) => a.profileNumber - b.profileNumber);
  });

  const lines: string[] = [];

  // Aligned rows based on index
  const maxProfilesCount = Math.max(...FIXED_TAGS_ORDER.map(tagName => sortedData[tagName].length), 0);
  if (maxProfilesCount === 0) return "";

  for (let v = 0; v < maxProfilesCount; v++) {
    const rowCells: string[] = [];
    FIXED_TAGS_ORDER.forEach(tagName => {
      const profile = sortedData[tagName][v];
      if (profile) {
        rowCells.push(profile.tagName, String(profile.profileNumber), profile.id);
      } else {
        rowCells.push("", "", "");
      }
    });
    lines.push(rowCells.join('\t'));
  }

  return lines.join('\n');
}

const getSessionCategory = (name: string) => {
  const lower = name.toLowerCase();
  if (lower.includes('yahoo')) {
    return { label: 'Yahoo', colorClass: 'bg-purple-500', textClass: 'text-purple-400', borderClass: 'border-purple-500/20 bg-purple-500/5' };
  }
  if (lower.includes('hotmail')) {
    return { label: 'Hotmail', colorClass: 'bg-blue-500', textClass: 'text-blue-400', borderClass: 'border-blue-500/20 bg-blue-500/5' };
  }
  if (lower.includes('warmup')) {
    return { label: 'Warmup', colorClass: 'bg-orange-500', textClass: 'text-orange-400', borderClass: 'border-orange-500/20 bg-orange-500/5' };
  }
  if (lower.includes('snds')) {
    return { label: 'SNDS', colorClass: 'bg-emerald-500', textClass: 'text-emerald-400', borderClass: 'border-emerald-500/20 bg-emerald-500/5' };
  }
  if (lower.includes('connect')) {
    return { label: 'Connect', colorClass: 'bg-cyan-500', textClass: 'text-cyan-400', borderClass: 'border-cyan-500/25 bg-cyan-500/5' };
  }
  return { label: 'Default', colorClass: 'bg-zinc-500', textClass: 'text-zinc-500', borderClass: 'border-zinc-800 bg-zinc-950/20' };
};

const DivideResultDisplay: React.FC<{ 
  data: DivideResultData;
  searchQuery?: string;
  onShowToast?: (msg: string, type?: 'success' | 'info' | 'error') => void;
}> = ({ data, searchQuery, onShowToast }) => {
  const filteredData = Object.entries(data).filter(([tagName]) => {
    if (!searchQuery) return true;
    return tagName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {filteredData.map(([tagName, profilesVal]) => {
        const profiles = profilesVal as DivideProfileEntry[];
        const sortedProfiles = [...profiles].sort((a, b) => a.profileNumber - b.profileNumber);
        const category = getSessionCategory(tagName);
        
        return (
          <div key={tagName} className="relative bg-zinc-900/40 border border-zinc-800 rounded-xl overflow-hidden backdrop-blur-sm group/card">
            <div className={`absolute left-0 top-1/4 bottom-1/4 w-1 rounded-r-md ${category.colorClass} opacity-80`} />
            <div className="p-4 border-b border-zinc-800 bg-zinc-800/30 flex items-center justify-between pl-5">
              <div className="flex items-center gap-2">
                <span className="font-display font-semibold text-zinc-200 tracking-tight">{tagName}</span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${category.borderClass} ${category.textClass} uppercase font-bold`}>
                  {category.label}
                </span>
                <span className="text-[10px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded font-mono">
                  {profiles.length} Profiles
                </span>
              </div>
              <DivideGroupCopyBtn tagName={tagName} profiles={profiles} onShowToast={onShowToast} />
            </div>
            
            <div className="p-4 max-h-72 overflow-y-auto custom-scrollbar font-mono text-[11px] space-y-1 pl-5">
              {sortedProfiles.map((p, i) => (
                <div key={i} className="flex gap-4 py-1.5 border-b border-zinc-800/50 last:border-0 group">
                  <span className="text-zinc-600 w-8 text-right flex-shrink-0">{p.profileNumber}</span>
                  <span className="text-zinc-350 truncate flex-1 font-semibold">{p.tagName}</span>
                  <span className="text-blue-400 font-medium flex-shrink-0 group-hover:text-blue-300 transition-colors uppercase tracking-tight font-mono">{p.id}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const DivideGroupCopyBtn: React.FC<{ 
  tagName: string; 
  profiles: DivideProfileEntry[];
  onShowToast?: (msg: string, type?: 'success' | 'info' | 'error') => void;
}> = ({ tagName, profiles, onShowToast }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const sortedProfiles = [...profiles].sort((a, b) => a.profileNumber - b.profileNumber);
    const profileLines = sortedProfiles.map(p => `${p.tagName}\t${p.profileNumber}\t${p.id}`).join('\n');
    navigator.clipboard.writeText(profileLines);
    setCopied(true);
    if (onShowToast) {
      onShowToast(`Group "${tagName}" successfully copied!`, 'success');
    }
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button 
      onClick={handleCopy} 
      title="Copy this group"
      className={`p-1.5 rounded transition-colors ${copied ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-500 hover:text-blue-400 hover:bg-zinc-800'}`}
    >
      <ClipboardCopy className="w-4 h-4" />
    </button>
  );
};

// --- UI Components ---

const DropResult: React.FC<{ 
  name: string; 
  sessions: { [sessionName: string]: { [hour: number]: string[] } };
  forceState?: 'expand' | 'collapse' | null;
  searchQuery?: string;
  onShowToast?: (msg: string, type?: 'success' | 'info' | 'error') => void;
}> = ({ name, sessions, forceState, searchQuery, onShowToast }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [copiedDrop, setCopiedDrop] = useState(false);

  React.useEffect(() => {
    if (forceState === 'expand') {
      setIsOpen(true);
    } else if (forceState === 'collapse') {
      setIsOpen(false);
    }
  }, [forceState]);

  // Filter sessions inside the drop visually by search query
  const filteredSessions = Object.entries(sessions).filter(([sessionName]) => {
    if (!searchQuery) return true;
    const lowerQuery = searchQuery.toLowerCase();
    const category = getSessionCategory(sessionName);
    return sessionName.toLowerCase().includes(lowerQuery) || category.label.toLowerCase().includes(lowerQuery);
  });

  const handleCopyDrop = (e: React.MouseEvent) => {
    e.stopPropagation();
    const profiles: string[] = [];
    Object.values(sessions).forEach(hours => {
      Object.values(hours).forEach(plist => {
        profiles.push(...plist);
      });
    });
    if (profiles.length === 0) return;
    navigator.clipboard.writeText(profiles.join('\n'));
    setCopiedDrop(true);
    if (onShowToast) {
      onShowToast(`Drop "${name}" successfully copied to clipboard!`, 'success');
    }
    setTimeout(() => setCopiedDrop(false), 2000);
  };

  if (filteredSessions.length === 0 && searchQuery) {
    return null; // hide drop if no matching sessions
  }

  const sessionCount = filteredSessions.length;
  let gridClasses = "p-6 grid gap-6 bg-zinc-900/5";
  if (sessionCount === 1) {
    gridClasses += " grid-cols-1 max-w-2xl mx-auto";
  } else if (sessionCount === 2) {
    gridClasses += " grid-cols-1 sm:grid-cols-2 max-w-5xl mx-auto";
  } else {
    gridClasses += " grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  }

  const displayName = name.toUpperCase().replace(/\bDROP\b/g, "BATCH");

  return (
    <div className="border border-zinc-900 rounded-2xl mb-8 overflow-hidden bg-zinc-950/20 backdrop-blur-sm shadow-sm transition-all">
      <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between p-4.5 bg-zinc-900/30 border-b border-zinc-900/60 gap-3">
        <button 
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-3.5 text-left group/btn"
        >
          <div className="p-1.5 bg-blue-550/10 border border-blue-550/20 text-blue-400 rounded-lg group-hover/btn:border-blue-500/40 transition-colors">
            <Layers className="w-4 h-4 text-blue-500" />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="font-display font-bold text-zinc-100 tracking-tight text-[17px] leading-tight group-hover/btn:text-blue-450 transition-colors uppercase">{displayName}</span>
            <span className="text-[10px] bg-zinc-900/80 border border-zinc-800/60 text-zinc-450 px-2.5 py-0.5 rounded-full font-semibold font-mono self-start sm:self-auto leading-none">
              {Object.keys(sessions).length} Sessions
            </span>
          </div>
        </button>

        <div className="flex items-center gap-2.5 self-end sm:self-auto">
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className="p-1.5 rounded-lg bg-zinc-905/60 hover:bg-zinc-855 border border-zinc-800 hover:border-zinc-700 text-zinc-450 hover:text-zinc-200 transition-colors"
            aria-label="Toggle Details"
          >
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className={gridClasses}
          >
            {filteredSessions.map(([sessionName, hourlyData]) => (
              <SessionCard key={sessionName} name={sessionName} hours={hourlyData} onShowToast={onShowToast} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const SessionCard: React.FC<{ 
  name: string; 
  hours: { [hour: number]: string[] };
  onShowToast?: (msg: string, type?: 'success' | 'info' | 'error') => void;
}> = ({ name, hours, onShowToast }) => {
  const [copiedAll, setCopiedAll] = useState(false);

  // Flattened profiles to get min/max for the range display
  const allProfiles = (Object.values(hours) as string[][]).flat();
  const numericProfiles = allProfiles.map(p => parseInt(p, 10)).filter(n => !isNaN(n));
  const minProfile = numericProfiles.length > 0 ? Math.min(...numericProfiles) : (allProfiles[0] || '0');
  const maxProfile = numericProfiles.length > 0 ? Math.max(...numericProfiles) : (allProfiles[allProfiles.length - 1] || '0');
  
  const handleCopyAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (allProfiles.length === 0) return;
    navigator.clipboard.writeText(allProfiles.join('\n'));
    setCopiedAll(true);
    if (onShowToast) {
      onShowToast(`Session "${name}" copied to clipboard!`, 'success');
    }
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const category = getSessionCategory(name);

  return (
    <div className="relative bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700/80 rounded-xl p-4.5 shadow-md hover:shadow-lg hover:bg-zinc-900/95 transition-all flex flex-col justify-between gap-4 h-full group/card overflow-visible">
      {/* Category accent line on top */}
      <div className={`absolute top-0 left-0 right-0 h-[3px] ${category.colorClass} opacity-60 rounded-t-xl`} />

      {/* Row 1: Session title & Category Tag on the left, Profiles & count info on the right */}
      <div className="flex items-center justify-between gap-3 mt-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-sans font-semibold text-zinc-100 tracking-tight truncate" title={name}>
            {name}
          </h3>
          <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${category.borderClass} ${category.textClass} font-bold tracking-wider shrink-0`}>
            {category.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-xs shrink-0 select-none">
          <span className="text-[9px] text-zinc-500 font-medium uppercase tracking-wider">Profiles</span>
          <span className="font-bold text-zinc-200 tabular-nums">{allProfiles.length}</span>
        </div>
      </div>

      {/* Row 2: Directional range display */}
      <div className="w-full bg-zinc-950/40 border border-zinc-850/50 rounded-lg p-3">
        <div className="flex items-center justify-between">
          {/* From Column */}
          <div className="flex flex-col">
            <span className="text-[8.5px] font-mono font-semibold tracking-wider text-zinc-500 uppercase select-none">From</span>
            <span className="text-sm font-bold text-zinc-100 mt-0.5 tabular-nums">{minProfile}</span>
          </div>

          {/* Directional Range Flow */}
          <div className="flex-1 flex items-center justify-center px-4 select-none">
            <span className="text-zinc-600 font-mono text-xs font-bold tracking-widest">───▶</span>
          </div>

          {/* To Column */}
          <div className="flex flex-col text-right">
            <span className="text-[8.5px] font-mono font-semibold tracking-wider text-zinc-500 uppercase select-none">To</span>
            <span className="text-sm font-bold text-zinc-100 mt-0.5 tabular-nums">{maxProfile}</span>
          </div>
        </div>
      </div>

      {/* Row 3: Full-width Copy Button */}
      <div>
        <button
          onClick={handleCopyAll}
          className={`
            w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-all border
            ${copiedAll 
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25 shadow-sm' 
              : 'bg-zinc-800/60 text-zinc-300 hover:text-blue-400 hover:bg-blue-500/10 border-zinc-750 hover:border-blue-500/20'}
          `}
        >
          <ClipboardCopy className="w-3.5 h-3.5" />
          {copiedAll ? 'Copied' : 'Copy Session'}
        </button>
      </div>
    </div>
  );
};

const FlattenedResult: React.FC<{ 
  ids: string[];
  searchQuery?: string;
  onShowToast?: (msg: string, type?: 'success' | 'info' | 'error') => void;
}> = ({ ids, searchQuery, onShowToast }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (ids.length === 0) return;
    navigator.clipboard.writeText(ids.join('\n'));
    setCopied(true);
    if (onShowToast) {
       onShowToast("All tag IDs successfully copied!", "success");
    }
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredIds = ids.filter(id => {
    if (!searchQuery) return true;
    return id.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-800/20">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-blue-400" />
          <span className="font-display font-semibold text-lg uppercase tracking-tight">Tags List</span>
          <span className="text-xs bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded-full font-mono">
            {filteredIds.length} IDs {searchQuery ? '(Filtered)' : ''}
          </span>
        </div>
        <button
          onClick={handleCopy}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold uppercase transition-all
            ${copied ? 'bg-emerald-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white'}
          `}
        >
          <ClipboardCopy className="w-4 h-4" />
          {copied ? 'Copied Everything' : 'Copy All'}
        </button>
      </div>

      <div 
        onClick={handleCopy}
        className="p-6 cursor-pointer group relative"
      >
        <div className="max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
          {filteredIds.length === 0 ? (
            <div className="text-zinc-650 italic text-center py-6">No matching IDs found</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1 font-semibold">
              {filteredIds.map((id, index) => (
                <div key={index} className="text-xs font-mono text-zinc-400 flex items-center gap-3 group/item py-0.5">
                  <span className="text-zinc-700 w-6 text-right select-none">{index + 1}.</span>
                  <span className="text-zinc-300 group-hover/item:text-blue-400 transition-colors uppercase">{id}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {filteredIds.length > 0 && (
          <div className="absolute inset-0 bg-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
            <div className="bg-zinc-950 px-4 py-2 rounded-full border border-blue-500/30 text-blue-400 text-xs font-bold uppercase tracking-widest shadow-2xl">
              Click anywhere to copy all
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ReorganizedResult: React.FC<{ 
  data: ReorganizedData;
  searchQuery?: string;
  onShowToast?: (msg: string, type?: 'success' | 'info' | 'error') => void;
}> = ({ data, searchQuery, onShowToast }) => {
  const [copiedAll, setCopiedAll] = useState(false);

  const handleCopyAll = () => {
    const all = (Object.values(data) as ReorganizedEntry[][]).flat();
    if (all.length === 0) return;
    const text = all.map(e => e.proxy ? `${e.number}#${e.name}#${e.proxy}` : `${e.number}#${e.name}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    if (onShowToast) {
      onShowToast("All reorganized records successfully copied!", "success");
    }
    setTimeout(() => setCopiedAll(false), 2000);
  };

  // Filter keys (sessionNames) visually by search query
  const filteredData = Object.entries(data).filter(([sessionName]) => {
    if (!searchQuery) return true;
    const lowerQuery = searchQuery.toLowerCase();
    const category = getSessionCategory(sessionName);
    return sessionName.toLowerCase().includes(lowerQuery) || category.label.toLowerCase().includes(lowerQuery);
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={handleCopyAll}
          className={`
            flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold uppercase tracking-wider transition-all
            ${copiedAll ? 'bg-emerald-600 shadow-emerald-600/20' : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/20'} 
            text-white shadow-lg
          `}
        >
          <ClipboardCopy className="w-4 h-4" />
          {copiedAll ? 'Copied All Records' : 'Copy All Reorganized'}
        </button>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {filteredData.map(([sessionName, entriesVal]) => {
          const entries = entriesVal as ReorganizedEntry[];
          const category = getSessionCategory(sessionName);
          return (
            <div key={sessionName} className="relative bg-zinc-900/40 border border-zinc-800 rounded-xl overflow-hidden backdrop-blur-sm group/card">
              {/* Subtle top indicator category line */}
              <div className={`absolute top-0 left-0 right-0 h-1 ${category.colorClass} opacity-70`} />
              
              <div className="p-4 border-b border-zinc-800 bg-zinc-800/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-display font-semibold text-zinc-200 tracking-tight">{sessionName}</span>
                  <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${category.borderClass} ${category.textClass} uppercase font-bold`}>
                    {category.label}
                  </span>
                  <span className="text-[10px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded font-mono">
                    {entries.length}
                  </span>
                </div>
                <SessionCopyIcon entries={entries} sessionName={sessionName} onShowToast={onShowToast} />
              </div>
              
              <div className="p-4 max-h-72 overflow-y-auto custom-scrollbar font-mono text-[11px] space-y-1 font-semibold">
                {entries.map((e, i) => (
                  <div key={i} className="flex gap-4 py-1.5 border-b border-zinc-800/50 last:border-0 group">
                    <span className="text-zinc-600 w-4 text-right flex-shrink-0">{e.number}</span>
                    <span className="text-zinc-500 truncate flex-1 group-hover:text-zinc-300 transition-colors">{e.name}</span>
                    {e.proxy && (
                      <span className="text-emerald-500 font-mono text-[10px] flex-shrink-0 bg-emerald-500/5 px-1.5 rounded border border-emerald-500/10">
                        {e.proxy}
                      </span>
                    )}
                    <span className="text-blue-400 font-medium flex-shrink-0 group-hover:text-blue-300 transition-colors uppercase tracking-tight">{e.id}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SessionCopyIcon: React.FC<{ 
  entries: ReorganizedEntry[];
  sessionName: string;
  onShowToast?: (msg: string, type?: 'success' | 'info' | 'error') => void;
}> = ({ entries, sessionName, onShowToast }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = entries.map(e => e.proxy ? `${e.number}#${e.name}#${e.proxy}` : `${e.number}#${e.name}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (onShowToast) {
       onShowToast(`Reorganized session "${sessionName}" copied!`, 'success');
    }
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button 
      onClick={handleCopy} 
      title="Copy this session"
      className={`p-1.5 rounded transition-colors ${copied ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-500 hover:text-blue-400 hover:bg-zinc-800'}`}
    >
      <ClipboardCopy className="w-4 h-4" />
    </button>
  );
};

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'error';
}

export default function App() {
  const [mode, setMode] = useState<ProcessingMode>('distribution');

  // Global Input & Processing State
  const [globalInput, setGlobalInput] = useState('');
  const [proxyInput, setProxyInput] = useState('');
  const [excludedProxyInput, setExcludedProxyInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Results State (stored independently)
  const [distResult, setDistResult] = useState<DistributedData | null>(null);
  const [flatResult, setFlatResult] = useState<string[] | null>(null);
  const [reorgResult, setReorgResult] = useState<ReorganizedData | null>(null);

  // Divide State
  const [divideInput, setDivideInput] = useState('');
  const [divideIntervals, setDivideIntervals] = useState('');
  const [divideResult, setDivideResult] = useState<DivideResultData | null>(null);
  const [isDivideProcessing, setIsDivideProcessing] = useState(false);

  // Enhanced UI/UX State
  const [searchQuery, setSearchQuery] = useState('');
  const [forceDropsState, setForceDropsState] = useState<'expand' | 'collapse' | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const handleGenerateDivide = () => {
    if (!divideInput.trim() || !divideIntervals.trim()) return;
    setIsDivideProcessing(true);
    setTimeout(() => {
      try {
        const result = process_divide_tags(divideInput, divideIntervals);
        setDivideResult(result);
        showToast("Divider calculations loaded!", "success");
      } catch (error) {
        console.error("Divide error:", error);
        showToast("Failed to divide tags. Check console for details.", "error");
      } finally {
        setIsDivideProcessing(false);
      }
    }, 400);
  };

  const handleCopyDivideOutput = () => {
    if (!divideResult) return;
    const text = format_divide_output(divideResult);
    navigator.clipboard.writeText(text);
    showToast("Divided output text copied successfully!", "success");
  };

  const [copiedSheets, setCopiedSheets] = useState(false);

  const handleCopyDivideSheets = () => {
    if (!divideResult) return;
    const text = format_divide_sheets_output(divideResult);
    navigator.clipboard.writeText(text);
    setCopiedSheets(true);
    showToast("Copied to clipboard for Google Sheets!", "success");
    setTimeout(() => setCopiedSheets(false), 2000);
  };

  const handleGenerateAll = () => {
    if (!globalInput.trim()) return;
    
    setIsProcessing(true);
    
    const proxies = proxyInput
      .split(/\r?\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);
    
    // Process everything sequentially with a slight delay for better UX "feel"
    setTimeout(() => {
      try {
        // 1. Process Distribution
        const rawData = parse_input(globalInput);
        const grouped = group_sessions(rawData);
        const distributed = split_into_23_hours(grouped);
        const final = format_output(distributed);
        setDistResult(final);

        // 2. Process Flatten (Tags)
        const ids = extract_ids(globalInput);
        setFlatResult(ids);

        // 3. Process Reorganize
        const excludedProxies = extract_excluded_proxies(excludedProxyInput);
        let filteredProxies = proxies;
        if (excludedProxies.size > 0) {
          filteredProxies = proxies.filter(p => !excludedProxies.has(p));
          setProxyInput(filteredProxies.join('\n'));
        }

        const reorgData = parse_reorganize(globalInput, filteredProxies);
        setReorgResult(reorgData);
        showToast("All sessions generated successfully!", "success");

      } catch (error) {
        console.error("Processing error:", error);
        showToast("Failed to process data. Check console for details.", "error");
      } finally {
        setIsProcessing(false);
      }
    }, 600);
  };

  const handleExportJSON = () => {
    let resultToExport: any = null;
    if (mode === 'distribution' && distResult) {
      resultToExport = distResult;
    } else if (mode === 'flatten' && flatResult) {
      resultToExport = flatResult;
    } else if (mode === 'reorganize' && reorgResult) {
      resultToExport = reorgResult;
    } else if (mode === 'divide' && divideResult) {
      resultToExport = divideResult;
    }

    if (!resultToExport) {
      showToast("No data available to export!", "error");
      return;
    }

    const blob = new Blob([JSON.stringify(resultToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sessionflow_export_${mode}_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("JSON file exported successfully!", "success");
  };

  const handleExportTXT = () => {
    let text = "";
    if (mode === 'distribution' && distResult) {
      text = JSON.stringify(distResult, null, 2);
    } else if (mode === 'flatten' && flatResult) {
      text = flatResult.join('\n');
    } else if (mode === 'reorganize' && reorgResult) {
      const all = (Object.values(reorgResult) as ReorganizedEntry[][]).flat();
      text = all.map(e => e.proxy ? `${e.number}#${e.name}#${e.proxy}` : `${e.number}#${e.name}`).join('\n');
    } else if (mode === 'divide' && divideResult) {
      text = format_divide_output(divideResult);
    }

    if (!text) {
      showToast("No data available to export!", "error");
      return;
    }

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sessionflow_export_${mode}_${new Date().toISOString().split('T')[0]}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("TXT file exported successfully!", "success");
  };

  const handleExportCSV = () => {
    let text = "";
    if (mode === 'distribution' && distResult) {
      const rows: string[] = ["Drop,SessionName,Hour,ProfileNumber"];
      Object.entries(distResult).forEach(([dropName, sessionsObj]) => {
        Object.entries(sessionsObj).forEach(([sessionName, hoursMap]) => {
          Object.entries(hoursMap).forEach(([hourStr, profilesVal]) => {
            const profiles = profilesVal as string[];
            profiles.forEach(p => {
              rows.push(`"${dropName}","${sessionName}","Hour ${hourStr}","${p}"`);
            });
          });
        });
      });
      text = rows.join('\n');
    } else if (mode === 'flatten' && flatResult) {
      text = "Tag ID\n" + flatResult.join('\n');
    } else if (mode === 'reorganize' && reorgResult) {
      const rows = ["Number,SessionName,ProxyIP,ProfileID"];
      (Object.values(reorgResult) as ReorganizedEntry[][]).flat().forEach(e => {
        rows.push(`"${e.number}","${e.name}","${e.proxy || ''}","${e.id}"`);
      });
      text = rows.join('\n');
    } else if (mode === 'divide' && divideResult) {
      text = format_divide_sheets_output(divideResult).replace(/\t/g, ',');
    }

    if (!text) {
      showToast("No data available to export!", "error");
      return;
    }

    const blob = new Blob([text], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sessionflow_export_${mode}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("CSV file exported successfully!", "success");
  };

  const handleClear = () => {
    setGlobalInput('');
    setExcludedProxyInput('');
    setDistResult(null);
    setFlatResult(null);
    setReorgResult(null);
    setDivideInput('');
    setDivideIntervals('');
    setDivideResult(null);
    setSearchQuery('');
    showToast("All fields and results cleared!", "info");
  };

  const handleCopyResult = () => {
    let copiedText = "";
    if (mode === 'distribution' && distResult) {
      copiedText = JSON.stringify(distResult, null, 2);
    } else if (mode === 'flatten' && flatResult) {
      copiedText = flatResult.join('\n');
    } else if (mode === 'reorganize' && reorgResult) {
      const all = (Object.values(reorgResult) as ReorganizedEntry[][]).flat();
      copiedText = all.map(e => e.proxy ? `${e.number}#${e.name}#${e.proxy}` : `${e.number}#${e.name}`).join('\n');
    } else if (mode === 'divide' && divideResult) {
      copiedText = format_divide_output(divideResult);
    }

    if (copiedText) {
      navigator.clipboard.writeText(copiedText);
      showToast("All results copied to clipboard!", "success");
    } else {
      showToast("No results to copy!", "error");
    }
  };

  const getSummaryStats = () => {
    let totalSessions = 0;
    let totalProfiles = 0;
    let totalDrops = 0;
    
    if (mode === 'distribution' && distResult) {
      totalDrops = Object.keys(distResult).length;
      const sessionNames = new Set<string>();
      Object.values(distResult).forEach(sessionsObj => {
        Object.entries(sessionsObj).forEach(([sName, hrMap]) => {
          sessionNames.add(sName);
          totalProfiles += Object.values(hrMap).flat().length;
        });
      });
      totalSessions = sessionNames.size;
    } else if (mode === 'flatten' && flatResult) {
      totalProfiles = flatResult.length;
      const parsed = parse_input(globalInput);
      totalSessions = new Set(parsed.map(p => p.sessionName)).size;
      totalDrops = new Set(parsed.map(p => p.dropName)).size;
    } else if (mode === 'reorganize' && reorgResult) {
      totalSessions = Object.keys(reorgResult).length;
      totalProfiles = Object.values(reorgResult).flat().length;
      const parsed = parse_input(globalInput);
      totalDrops = new Set(parsed.map(p => p.dropName)).size;
    } else if (mode === 'divide' && divideResult) {
      totalSessions = Object.keys(divideResult).length;
      totalProfiles = Object.values(divideResult).flat().length;
    }

    const totalProxies = proxyInput.split('\n').filter(p => p.trim()).length;
    
    const excludedSet = new Set();
    const matches = excludedProxyInput.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+\b/g);
    if (matches) {
      matches.forEach(m => excludedSet.add(m.trim()));
    }
    const excludedProxies = excludedSet.size;

    let usedProxies = 0;
    if (reorgResult) {
      const allEntries = (Object.values(reorgResult) as ReorganizedEntry[][]).flat();
      const usedSet = new Set<string>();
      allEntries.forEach(entry => {
        if (entry.proxy) usedSet.add(entry.proxy);
      });
      usedProxies = usedSet.size;
    }

    return { 
      totalSessions, 
      totalProfiles, 
      totalDrops, 
      totalProxies, 
      excludedProxies,
      usedProxies,
      remainingProxies: Math.max(0, totalProxies - excludedProxies)
    };
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto pb-24">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-blue-600 rounded-lg shadow-[0_0_15px_rgba(37,99,235,0.4)]">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-3xl font-display font-bold tracking-tight">
              Session<span className="text-blue-500">Flow</span>
            </h1>
          </div>
          <p className="text-zinc-500 text-sm md:ml-12 font-medium">
            Organizational Processor for Any Session String & Format
          </p>
        </div>

        <div className="flex gap-2">
          {((mode === 'distribution' && distResult) || (mode === 'flatten' && flatResult) || (mode === 'reorganize' && reorgResult) || (mode === 'divide' && divideResult)) && (
            <>
              <button 
                onClick={handleExportJSON}
                className="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-blue-500/50 rounded-md text-sm font-medium transition-all flex items-center gap-2 group text-zinc-355 select-none"
              >
                <FileJson className="w-4 h-4 text-blue-400" />
                Export JSON
              </button>
              <button 
                onClick={handleCopyResult}
                className="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-350 rounded-md text-sm font-medium transition-all flex items-center gap-2 group text-zinc-300 select-none"
              >
                <ClipboardCopy className="w-4 h-4 text-zinc-450" />
                Copy All Results
              </button>
            </>
          )}
          <button 
            onClick={handleClear}
            className="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-red-900/50 hover:bg-red-950/20 text-zinc-400 hover:text-red-400 rounded-md text-sm font-medium transition-all flex items-center gap-2 select-none"
          >
            <Trash2 className="w-4 h-4" />
            Clear Input & Output
          </button>
        </div>
      </header>

      {/* Global Input Section */}
      {mode !== 'divide' && (
        <section className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-6 relative overflow-hidden backdrop-blur-sm mb-8">
          <div className="absolute top-0 right-0 p-4 pointer-events-none">
            <Play className="w-32 h-32 text-zinc-800/10" />
          </div>
          
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
            <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400">Global Session Input</h2>
          </div>

          <textarea
            value={globalInput}
            onChange={(e) => setGlobalInput(e.target.value)}
            placeholder="Paste all your session data here... (session_name number [ID])" 
            className="w-full h-48 bg-zinc-950 border border-zinc-800 rounded-lg p-4 font-mono text-sm text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all resize-none shadow-inner"
          />

          <div className="mt-4 flex justify-end">
            <button
              onClick={handleGenerateAll}
              disabled={!globalInput.trim() || isProcessing}
              className={`
                px-12 py-4 rounded-xl flex items-center gap-3 font-display font-bold text-xl transition-all select-none
                ${!globalInput.trim() || isProcessing 
                  ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-50' 
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-xl shadow-blue-600/30 active:scale-[0.98] animate-in'}
              `}
            >
              {isProcessing ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <Activity className="w-6 h-6" />
                </motion.div>
              ) : <Play className="w-6 h-6 fill-current" />}
              {isProcessing ? 'PROCESSING ALL...' : 'GENERATE OUTPUTS'}
            </button>
          </div>
        </section>
      )}

      {/* SaaS Dashboard Summary Bar (Requirement 1 & 10) */}
      {(() => {
        const stats = getSummaryStats();
        const hasResult = !!(distResult || flatResult || reorgResult || divideResult);
        if (!hasResult) return null;
        return (
          <section className="bg-zinc-950/25 border border-zinc-900/80 rounded-2xl p-6 mb-8 backdrop-blur-sm shadow-sm transition-all">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest leading-none">Workspace Statistics & System health</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {/* Card 1: Total Sessions */}
              <div className="bg-zinc-900/15 border border-zinc-900/60 p-4 rounded-xl hover:border-zinc-800/85 hover:bg-zinc-900/20 transition-all">
                <div className="text-[10px] font-mono font-medium text-zinc-500 uppercase tracking-wider">Total Sessions</div>
                <div className="text-2xl font-display font-light text-zinc-200 tracking-tight mt-1.5">{stats.totalSessions}</div>
              </div>
              {/* Card 2: Total Profiles */}
              <div className="bg-zinc-900/15 border border-zinc-900/60 p-4 rounded-xl hover:border-zinc-800/85 hover:bg-zinc-900/20 transition-all">
                <div className="text-[10px] font-mono font-medium text-zinc-500 uppercase tracking-wider">Total Profiles</div>
                <div className="text-2xl font-display font-light text-zinc-200 tracking-tight mt-1.5">{stats.totalProfiles}</div>
              </div>
              {/* Card 3: Total Batches */}
              <div className="bg-zinc-900/15 border border-zinc-900/60 p-4 rounded-xl hover:border-zinc-800/85 hover:bg-zinc-900/20 transition-all">
                <div className="text-[10px] font-mono font-medium text-zinc-500 uppercase tracking-wider">Total Batches</div>
                <div className="text-2xl font-display font-light text-zinc-200 tracking-tight mt-1.5">{stats.totalDrops || "—"}</div>
              </div>
              {/* Card 4: Proxy Status: Total */}
              <div className="bg-zinc-900/15 border border-zinc-900/60 p-4 rounded-xl hover:border-zinc-800/85 hover:bg-zinc-900/20 transition-all">
                <div className="text-[10px] font-mono font-medium text-zinc-500 uppercase tracking-wider">Total Proxies</div>
                <div className="text-2xl font-display font-light text-zinc-200 tracking-tight mt-1.5">{stats.totalProxies}</div>
              </div>
              {/* Card 5: Proxy Status: Excluded */}
              <div className="bg-zinc-900/15 border border-zinc-900/60 p-4 rounded-xl hover:border-zinc-800/85 hover:bg-zinc-900/20 transition-all">
                <div className="text-[10px] font-mono font-medium text-rose-500/70 uppercase tracking-wider">Excluded Proxies</div>
                <div className="text-2xl font-display font-light text-rose-400 tracking-tight mt-1.5">{stats.excludedProxies}</div>
              </div>
              {/* Card 6: Proxy Status: Used */}
              <div className="bg-zinc-900/15 border border-zinc-900/60 p-4 rounded-xl hover:border-zinc-800/85 hover:bg-zinc-900/20 transition-all col-span-2 md:col-span-1">
                <div className="text-[10px] font-mono font-medium text-emerald-500/70 uppercase tracking-wider">Available Proxies</div>
                <div className="text-2xl font-display font-light text-emerald-400 tracking-tight mt-1.5">{stats.remainingProxies}</div>
              </div>
            </div>
          </section>
        );
      })()}

      {/* Sticky Action Bar & Control Centre (Requirement 3 & 4 & 6) */}
      <div className="sticky top-0 z-40 bg-zinc-950/85 backdrop-blur-md border border-zinc-900 py-3.5 mb-8 -mx-4 px-4 md:-mx-8 md:px-8 shadow-xl rounded-xl">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
          
          {/* Workgroup Tabs */}
          <div className="flex flex-wrap bg-zinc-900/40 p-1 rounded-xl border border-zinc-900/85 w-full lg:w-fit gap-1 select-none">
            <button
              onClick={() => { setMode('distribution'); setSearchQuery(''); }}
              className={`flex items-center justify-center gap-2 px-4.5 py-2 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-all flex-1 lg:flex-none ${mode === 'distribution' ? 'bg-blue-600 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/60'}`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              Distribute
            </button>
            <button
              onClick={() => { setMode('flatten'); setSearchQuery(''); }}
              className={`flex items-center justify-center gap-2 px-4.5 py-2 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-all flex-1 lg:flex-none ${mode === 'flatten' ? 'bg-blue-600 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/60'}`}
            >
              <Terminal className="w-3.5 h-3.5 shrink-0" />
              Get Tags
            </button>
            <button
              onClick={() => { setMode('reorganize'); setSearchQuery(''); }}
              className={`flex items-center justify-center gap-2 px-4.5 py-2 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-all flex-1 lg:flex-none ${mode === 'reorganize' ? 'bg-blue-600 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/60'}`}
            >
              <Activity className="w-3.5 h-3.5 shrink-0" />
              Reorganize
            </button>
            <button
              onClick={() => { setMode('divide'); setSearchQuery(''); }}
              className={`flex items-center justify-center gap-2 px-4.5 py-2 rounded-lg text-xs font-mono font-bold uppercase tracking-wider transition-all flex-1 lg:flex-none ${mode === 'divide' ? 'bg-blue-600 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/60'}`}
            >
              <Columns className="w-3.5 h-3.5 shrink-0" />
              Divide
            </button>
          </div>

          {/* Search tool (Requirement 2) & Actions */}
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:max-w-2xl justify-end">
            
            {/* Visual Search Box */}
            <div className="relative w-full sm:max-w-xs group">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-blue-500 transition-colors" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search sessions/tags..."
                className="w-full pl-10 pr-4 py-2 bg-zinc-900/70 border border-zinc-850 rounded-xl text-xs font-bold uppercase tracking-wide text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 transition-all font-mono"
              />
            </div>

            {/* Expand / Collapse All controller (Requirement 3) */}
            {mode === 'distribution' && distResult && (
              <div className="flex bg-zinc-900/60 border border-zinc-850 rounded-xl p-1 gap-1 w-full sm:w-auto select-none">
                <button
                  onClick={() => {
                    setForceDropsState('expand');
                    showToast("Expanded all drop sections!", "info");
                  }}
                  className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-[10px] font-mono font-black uppercase tracking-wider text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all whitespace-nowrap"
                >
                  Expand All
                </button>
                <div className="w-px bg-zinc-800" />
                <button
                  onClick={() => {
                    setForceDropsState('collapse');
                    showToast("Collapsed all drop sections!", "info");
                  }}
                  className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-[10px] font-mono font-black uppercase tracking-wider text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all whitespace-nowrap"
                >
                  Collapse All
                </button>
              </div>
            )}

            {/* Export Section Buttons (Requirement 5 & 8: CSV/TXT/JSON formats) */}
            {((mode === 'distribution' && distResult) || (mode === 'flatten' && flatResult) || (mode === 'reorganize' && reorgResult) || (mode === 'divide' && divideResult)) && (
              <div className="flex bg-zinc-900/60 border border-zinc-850 rounded-xl p-1 gap-1 w-full sm:w-auto shrink-0 justify-center select-none font-semibold">
                <button
                  onClick={handleExportTXT}
                  title="Export to Text (.txt)"
                  className="p-1 px-3 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-all flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-zinc-500" />
                  TXT
                </button>
                <button
                  onClick={handleExportCSV}
                  title="Export to Spreadsheet (.csv)"
                  className="p-1 px-3 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 hover:bg-emerald-500/10 hover:text-emerald-400 transition-all flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-500/70" />
                  CSV
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      <div className="grid grid-cols-1 gap-12">
        {mode === 'distribution' ? (
          <motion.div
            key="dist-view"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-12"
          >
            {/* Results Section */}
            <AnimatePresence mode="wait">
              {distResult ? (
                <motion.section
                  key="dist-result"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-6"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                    <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400">Distribution Results</h2>
                  </div>

                  <div className="space-y-4">
                    {Object.keys(distResult).length === 0 ? (
                      <div className="p-12 border border-dashed border-zinc-800 rounded-xl text-center text-zinc-650">
                        No data identified. Ensure session names are followed by profile numbers.
                      </div>
                    ) : (
                      (Object.entries(distResult) as [string, { [sessionName: string]: { [hour: number]: string[] } }][]).map(([dropName, dropData]) => (
                        <DropResult 
                          key={dropName} 
                          name={dropName} 
                          sessions={dropData} 
                          searchQuery={searchQuery}
                          forceState={forceDropsState}
                          onShowToast={showToast}
                        />
                      ))
                    )}
                  </div>
                </motion.section>
              ) : (
                <div className="p-12 border-2 border-dashed border-zinc-900 rounded-xl text-center bg-zinc-950/20">
                  <Layers className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
                  <p className="text-zinc-600 font-medium max-w-sm mx-auto">
                    Click Generate above to process your input and see the 23-hour schedule distribution.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : mode === 'flatten' ? (
          <motion.div
            key="flat-view"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-12"
          >
            {/* Results Section */}
            <AnimatePresence mode="wait">
              {flatResult ? (
                <motion.section
                  key="flat-result"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-6"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                    <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400">Tags List</h2>
                  </div>

                  <FlattenedResult 
                    ids={flatResult} 
                    searchQuery={searchQuery}
                    onShowToast={showToast}
                  />
                </motion.section>
              ) : (
                <div className="p-12 border-2 border-dashed border-zinc-905 rounded-xl text-center bg-zinc-905/10">
                  <Terminal className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
                  <p className="text-zinc-650 font-medium max-w-sm mx-auto">
                    Click Generate above to extract all bracketed [IDs] into a clean tag list.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : mode === 'reorganize' ? (
          <motion.div
            key="reorg-view"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-12"
          >
            {/* Reorganize Special Input Section */}
            <section className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-8 backdrop-blur-sm shadow-xl">
              <div className="flex flex-col gap-8">
                {/* Main Input Reminder/Access */}
                <div className="space-y-3">
                   <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-zinc-550" />
                    <label className="text-[10px] font-mono font-black text-zinc-500 uppercase tracking-[0.2em]">Main Session Input</label>
                  </div>
                  <div className="p-4 bg-zinc-950/50 border border-zinc-800/50 rounded-lg text-xs text-zinc-500 italic font-semibold">
                    Using global input from above. 
                    {globalInput ? ` (${globalInput.split('\n').filter(l => l.trim()).length} lines detected)` : ' (No input detected)'}
                  </div>
                </div>

                 {/* Proxy Input */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-blue-500" />
                      <label className="text-[10px] font-mono font-black text-zinc-400 uppercase tracking-[0.2em]">Proxy Input (Optional)</label>
                    </div>
                    {proxyInput && (
                      <span className="text-[10px] font-mono text-zinc-600">
                        {proxyInput.split('\n').filter(p => p.trim()).length} PROXIES
                      </span>
                    )}
                  </div>
                  <textarea
                    value={proxyInput}
                    onChange={(e) => setProxyInput(e.target.value)}
                    placeholder="50.3.117.98:92&#10;185.40.18.76:92&#10;Paste proxy list IP:PORT format..."
                    className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-lg p-4 font-mono text-sm text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all resize-none shadow-inner"
                  />
                </div>

                {/* Excluded / Overused Proxies */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Ban className="w-4 h-4 text-rose-500" />
                      <label className="text-[10px] font-mono font-black text-zinc-400 uppercase tracking-[0.2em]">Excluded / Overused Proxies (Optional)</label>
                    </div>
                    {excludedProxyInput && (
                      <span className="text-[10px] font-mono text-rose-500">
                        {(() => {
                          const count = new Set();
                          const matches = excludedProxyInput.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+\b/g);
                          if (matches) {
                            matches.forEach(m => count.add(m.trim()));
                          }
                          return count.size;
                        })()} EXCLUDED
                      </span>
                    )}
                  </div>
                  <textarea
                    value={excludedProxyInput}
                    onChange={(e) => setExcludedProxyInput(e.target.value)}
                    placeholder="• Proxy IP: 15.235.17.147:92 exceeds limit: 60...&#10;Paste any text or reports containing proxies to exclude..."
                    className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-lg p-4 font-mono text-sm text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:border-rose-500/50 focus:ring-1 focus:ring-rose-500/20 transition-all resize-none shadow-inner"
                  />
                </div>

                <div className="flex justify-center pt-2">
                  <button
                    onClick={handleGenerateAll}
                    disabled={!globalInput.trim() || isProcessing}
                    className={`
                      px-16 py-4 rounded-xl flex items-center gap-3 font-display font-bold text-xl transition-all select-none
                      ${!globalInput.trim() || isProcessing 
                        ? 'bg-zinc-800 text-zinc-655 cursor-not-allowed' 
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl shadow-indigo-600/30 active:scale-[0.98]'}
                    `}
                  >
                    {isProcessing ? <Activity className="w-6 h-6 animate-spin" /> : <Play className="w-6 h-6 fill-current" />}
                    {isProcessing ? 'PROCESSING...' : 'GENERATE REORGANIZED'}
                  </button>
                </div>
              </div>
            </section>

            {/* Results Section */}
            <AnimatePresence mode="wait">
              {reorgResult ? (
                <motion.section
                  key="reorg-result"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                   <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
                    <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400">Reorganized Records</h2>
                  </div>
                  <ReorganizedResult 
                    data={reorgResult} 
                    searchQuery={searchQuery}
                    onShowToast={showToast}
                  />
                </motion.section>
              ) : (
                <div className="p-12 border-2 border-dashed border-zinc-800 rounded-xl text-center bg-zinc-900/10">
                  <Activity className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
                  <p className="text-zinc-650 font-medium max-w-sm mx-auto">
                    Click Generate reorganized above to transform horizontal rows into vertical grouped records with proxies.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div
            key="divide-view"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-12"
          >
            {/* Input Section */}
            <section className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-8 backdrop-blur-sm shadow-xl">
              <div className="flex flex-col gap-8">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                  <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400">Divide Tags Configuration</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Session Input */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-zinc-500" />
                        <label className="text-[10px] font-mono font-black text-zinc-400 uppercase tracking-[0.2em]">Session Data</label>
                      </div>
                      <div className="flex items-center gap-2">
                        {globalInput && !divideInput && (
                          <button
                            type="button"
                            onClick={() => {
                              setDivideInput(globalInput);
                              showToast("Loaded global session input!", "info");
                            }}
                            className="text-[9px] font-mono font-bold text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 px-1.5 py-0.5 rounded transition-all"
                          >
                            Load Global Session Input
                          </button>
                        )}
                        {divideInput && (
                          <span className="text-[10px] font-mono text-zinc-600">
                            {divideInput.split('\n').filter(l => l.trim()).length} RECORDS
                          </span>
                        )}
                      </div>
                    </div>
                    <textarea
                      value={divideInput}
                      onChange={(e) => setDivideInput(e.target.value)}
                      placeholder="CMH15_SNDS	2208	[B4DB7B48FF10353B]&#10;Paste TAG_NAME	PROFILE_NAME	[ID]..."
                      className="w-full h-48 bg-zinc-950 border border-zinc-800 rounded-lg p-4 font-mono text-sm text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all resize-none shadow-inner"
                    />
                  </div>

                  {/* Intervals Input */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-zinc-500" />
                        <label className="text-[10px] font-mono font-black text-zinc-400 uppercase tracking-[0.2em]">Interval Mapping</label>
                      </div>
                      {divideIntervals && (
                        <span className="text-[10px] font-mono text-zinc-600">
                          {parse_intervals(divideIntervals) ? Object.keys(parse_intervals(divideIntervals)).length : 0} MAPS
                        </span>
                      )}
                    </div>
                    <textarea
                      value={divideIntervals}
                      onChange={(e) => setDivideIntervals(e.target.value)}
                      placeholder="CMH15_SNDS	CMH15_Connect_fresh&#10;1-234	1-235&#10;Paste intervals horizontally..."
                      className="w-full h-48 bg-zinc-950 border border-zinc-800 rounded-lg p-4 font-mono text-sm text-zinc-300 placeholder:text-zinc-700 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all resize-none shadow-inner"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap justify-center gap-4 pt-2 select-none">
                  <button
                    onClick={handleGenerateDivide}
                    disabled={!divideInput.trim() || !divideIntervals.trim() || isDivideProcessing}
                    className={`
                      px-12 py-4 rounded-xl flex items-center gap-3 font-display font-bold text-lg transition-all
                      ${!divideInput.trim() || !divideIntervals.trim() || isDivideProcessing 
                        ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' 
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl shadow-indigo-600/30 active:scale-[0.98]'}
                    `}
                  >
                    {isDivideProcessing ? <Activity className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                    {isDivideProcessing ? 'PROCESSING...' : 'GENERATE DIVIDED'}
                  </button>

                  <button
                    onClick={() => {
                      setDivideInput('');
                      setDivideIntervals('');
                      setDivideResult(null);
                      showToast("Division layout cleared!", "info");
                    }}
                    className="px-6 py-4 bg-zinc-900 border border-zinc-800 hover:border-red-900/50 hover:bg-red-950/20 text-zinc-400 hover:text-red-400 rounded-xl text-sm font-semibold transition-all flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear Inputs
                  </button>
                </div>
              </div>
            </section>

            {/* Results Section */}
            <AnimatePresence mode="wait">
              {divideResult ? (
                <motion.section
                  key="divide-result"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                      <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400">Divided Results</h2>
                    </div>

                    <div className="flex gap-2 select-none">
                      <button
                        onClick={handleCopyDivideSheets}
                        className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-bold uppercase tracking-wider transition-all text-white shadow-md active:scale-[0.98] flex items-center gap-2"
                      >
                        <ClipboardCopy className="w-4 h-4 text-emerald-100" />
                        {copiedSheets ? 'COPIED!' : 'Copy for Sheets'}
                      </button>
                      <button
                        onClick={handleCopyDivideOutput}
                        className="px-6 py-2.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-300 rounded-lg text-sm font-bold uppercase tracking-wider transition-all text-white shadow-lg flex items-center gap-2"
                      >
                        <ClipboardCopy className="w-4 h-4 text-zinc-400" />
                        Copy Raw output
                      </button>
                    </div>
                  </div>

                  <DivideResultDisplay 
                    data={divideResult} 
                    searchQuery={searchQuery}
                    onShowToast={showToast}
                  />
                </motion.section>
              ) : (
                <div className="p-12 border-2 border-dashed border-zinc-800 rounded-xl text-center bg-zinc-950/20">
                  <Columns className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
                  <p className="text-zinc-650 font-medium max-w-sm mx-auto">
                    Configure Session Data and Interval Mapping above, then click Generate to divide tags.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      <footer className="mt-16 pt-8 border-t border-zinc-900 flex justify-between items-center text-[10px] font-mono text-zinc-700 uppercase tracking-widest">
        <div className="flex items-center gap-4">
          <span>Engine: Any-String v1.1 Professional Edition</span>
          <span className="w-1 h-1 rounded-full bg-zinc-800" />
          <span>Status: Multi-View Enabled</span>
        </div>
        <div>
          Universal Table & List Parsing Enabled
        </div>
      </footer>

      {/* Lightweight Toast Popups (Requirement 9) */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-sm pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              className="pointer-events-auto bg-zinc-950/95 border border-zinc-800/80 text-white shadow-2xl p-4 rounded-xl flex items-center gap-3 backdrop-blur-md"
            >
              <div className={`w-2 h-2 rounded-full ${toast.type === 'success' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : toast.type === 'error' ? 'bg-rose-500' : 'bg-blue-500'}`} />
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-300">{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

    </div>
  );
}



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
  ArrowRight
} from 'lucide-react';

// --- Types ---

type ProcessingMode = 'distribution' | 'flatten' | 'reorganize';

interface ReorganizedEntry {
  number: string;
  name: string;
  id: string;
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
 */
function parse_reorganize(input: string): ReorganizedData {
  const result: ReorganizedData = {};
  const seenIds = new Set<string>();
  const lines = input.split(/\r?\n/);
  // regex: session_name whitespace number whitespace [ID]
  const groupRegex = /(\S+)\s+(\d+)\s+(\[[^\]]+\])/g;

  lines.forEach(line => {
    let match;
    while ((match = groupRegex.exec(line)) !== null) {
      const [_, name, number, id] = match;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        if (!result[name]) {
          result[name] = [];
        }
        result[name].push({ number, name, id });
      }
    }
  });

  return result;
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

// --- UI Components ---

const DropResult: React.FC<{ name: string; sessions: { [sessionName: string]: { [hour: number]: string[] } } }> = ({ name, sessions }) => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="border border-zinc-800 rounded-xl mb-6 overflow-hidden bg-zinc-900/50">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors border-b border-zinc-800"
      >
        <div className="flex items-center gap-3">
          <Layers className="w-5 h-5 text-blue-500" />
          <span className="font-display font-semibold text-xl tracking-tight uppercase">{name}</span>
          <span className="text-xs bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded-full font-mono">
            {Object.keys(sessions).length} Sessions
          </span>
        </div>
        {isOpen ? <ChevronDown className="w-5 h-5 text-zinc-500" /> : <ChevronRight className="w-5 h-5 text-zinc-500" />}
      </button>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="p-6 space-y-8"
          >
            {(Object.entries(sessions) as [string, { [hour: number]: string[] }][])
              .map(([sessionName, hourlyData]) => (
                <SessionCard key={sessionName} name={sessionName} hours={hourlyData} />
              ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const SessionCard: React.FC<{ name: string; hours: { [hour: number]: string[] } }> = ({ name, hours }) => {
  const [isExpanded, setIsExpanded] = useState(false);
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
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div className="bg-zinc-950/30 border border-zinc-800/80 rounded-xl overflow-hidden shadow-sm group/card">
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-zinc-800/40 transition-colors text-left relative"
      >
        {/* Left: Session Info */}
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className={`w-1.5 h-10 rounded-full transition-colors flex-shrink-0 ${isExpanded ? 'bg-blue-600' : 'bg-zinc-700'}`} />
          <div className="min-w-0">
            <h3 className="text-lg font-display font-medium text-zinc-200 tracking-tight truncate leading-tight mb-1" title={name}>
              {name}
            </h3>
            <span className="text-[10px] font-mono text-zinc-600 bg-zinc-900/50 px-2 py-0.5 rounded uppercase font-bold tracking-wider">
              {allProfiles.length} Total Profiles
            </span>
          </div>
        </div>

        {/* Center: Range Info (Large & Centered) */}
        <div className="hidden lg:flex flex-[2] items-center justify-center px-4">
          <div className="flex items-center gap-6 px-8 py-2.5 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] group-hover/card:bg-zinc-800/80 transition-all duration-300">
            <div className="flex flex-col items-center">
              <span className="text-[9px] font-mono font-black text-zinc-600 uppercase tracking-[0.25em] mb-1">From</span>
              <span className="text-xl font-display font-bold text-white tabular-nums tracking-tight">{minProfile}</span>
            </div>
            
            <div className="flex items-center text-zinc-800">
               <div className="w-8 h-[1px] bg-zinc-800" />
               <ArrowRight className="w-5 h-5 text-blue-500/40 mx-2" />
               <div className="w-8 h-[1px] bg-zinc-800" />
            </div>
            
            <div className="flex flex-col items-center">
              <span className="text-[9px] font-mono font-black text-zinc-600 uppercase tracking-[0.25em] mb-1">To</span>
              <span className="text-xl font-display font-bold text-white tabular-nums tracking-tight">{maxProfile}</span>
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3 flex-shrink-0 flex-1 justify-end">
          <button
            onClick={handleCopyAll}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all
              ${copiedAll 
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                : 'bg-zinc-900 text-zinc-500 hover:text-blue-400 hover:bg-blue-500/10 border border-zinc-800 hover:border-blue-500/30'}
            `}
          >
            <ClipboardCopy className="w-3.5 h-3.5" />
            {copiedAll ? 'Copied' : 'Copy All'}
          </button>
          <div className={`p-1 rounded-full transition-colors ${isExpanded ? 'bg-blue-500/10 text-blue-400' : 'text-zinc-600'}`}>
            {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
          </div>
        </div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-zinc-800/50"
          >
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {(Object.entries(hours) as [string, string[]][]).sort((a,b) => parseInt(a[0]) - parseInt(b[0])).map(([hour, profiles]) => (
                <HourBox key={hour} hour={parseInt(hour)} profiles={profiles} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const HourBox: React.FC<{ hour: number; profiles: string[] }> = ({ hour, profiles }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (profiles.length === 0) return;
    const text = profiles.join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div 
      onClick={handleCopy}
      className={`
        group relative cursor-pointer p-3 rounded-lg border transition-all duration-200
        ${profiles.length > 0 
          ? 'bg-zinc-900 border-zinc-800 hover:border-blue-500/50 hover:bg-zinc-800/80' 
          : 'bg-zinc-950 border-zinc-900 opacity-40 cursor-not-allowed'}
      `}
    >
      <div className="flex justify-between items-center mb-2">
        <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-tighter">Hour {hour}</span>
        <span className={`text-[10px] font-mono px-1 rounded ${profiles.length > 0 ? 'bg-zinc-800 text-zinc-400' : 'text-zinc-700'}`}>
          {profiles.length}
        </span>
      </div>
      
      <div className="text-[11px] font-mono text-zinc-400 line-clamp-2 break-all leading-tight">
        {profiles.length > 0 ? `[${profiles.join(', ')}]` : '[empty]'}
      </div>

      {/* Hover/Copy Tooltip */}
      {profiles.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-blue-600/10 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest bg-zinc-950 px-2 py-1 rounded border border-blue-500/30 shadow-xl">
            {copied ? 'Copied!' : 'Click to Copy'}
          </span>
        </div>
      )}
    </div>
  );
};

const FlattenedResult: React.FC<{ ids: string[] }> = ({ ids }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (ids.length === 0) return;
    navigator.clipboard.writeText(ids.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-800/20">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-blue-400" />
          <span className="font-display font-semibold text-lg uppercase tracking-tight">Tags List</span>
          <span className="text-xs bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded-full font-mono">
            {ids.length} IDs
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
          {ids.length === 0 ? (
            <div className="text-zinc-600 italic">No IDs found in brackets [ ]</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1">
              {ids.map((id, index) => (
                <div key={index} className="text-xs font-mono text-zinc-400 flex items-center gap-3 group/item py-0.5">
                  <span className="text-zinc-700 w-6 text-right select-none">{index + 1}.</span>
                  <span className="text-zinc-300 group-hover/item:text-blue-400 transition-colors uppercase">{id}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {ids.length > 0 && (
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

const ReorganizedResult: React.FC<{ data: ReorganizedData }> = ({ data }) => {
  const [copiedAll, setCopiedAll] = useState(false);

  const handleCopyAll = () => {
    const all = (Object.values(data) as ReorganizedEntry[][]).flat();
    if (all.length === 0) return;
    const text = all.map(e => `${e.number}#${e.name}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

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
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {(Object.entries(data) as [string, ReorganizedEntry[]][]).map(([sessionName, entries]) => (
          <div key={sessionName} className="bg-zinc-900/40 border border-zinc-800 rounded-xl overflow-hidden backdrop-blur-sm">
            <div className="p-4 border-b border-zinc-800 bg-zinc-800/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-4 bg-blue-500 rounded-full" />
                <span className="font-display font-semibold text-zinc-200 tracking-tight">{sessionName}</span>
                <span className="text-[10px] bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded font-mono">
                  {entries.length}
                </span>
              </div>
              <SessionCopyIcon entries={entries} />
            </div>
            <div className="p-4 max-h-72 overflow-y-auto custom-scrollbar font-mono text-[11px] space-y-1">
              {entries.map((e, i) => (
                <div key={i} className="flex gap-4 py-1.5 border-b border-zinc-800/50 last:border-0 group">
                  <span className="text-zinc-600 w-4 text-right flex-shrink-0">{e.number}</span>
                  <span className="text-zinc-500 truncate flex-1 group-hover:text-zinc-300 transition-colors">{e.name}</span>
                  <span className="text-blue-400 font-medium flex-shrink-0 group-hover:text-blue-300 transition-colors">{e.id}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const SessionCopyIcon: React.FC<{ entries: ReorganizedEntry[] }> = ({ entries }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = entries.map(e => `${e.number}#${e.name}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
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

export default function App() {
  const [mode, setMode] = useState<ProcessingMode>('distribution');

  // Global Input & Processing State
  const [globalInput, setGlobalInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Results State (stored independently)
  const [distResult, setDistResult] = useState<DistributedData | null>(null);
  const [flatResult, setFlatResult] = useState<string[] | null>(null);
  const [reorgResult, setReorgResult] = useState<ReorganizedData | null>(null);

  const handleGenerateAll = () => {
    if (!globalInput.trim()) return;
    
    setIsProcessing(true);
    
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
        const reorgData = parse_reorganize(globalInput);
        setReorgResult(reorgData);

      } catch (error) {
        console.error("Processing error:", error);
        alert("Failed to process data. Check console for details.");
      } finally {
        setIsProcessing(false);
      }
    }, 600);
  };

  const handleExportJSON = () => {
    if (!distResult) return;
    const blob = new Blob([JSON.stringify(distResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `session_flow_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    setGlobalInput('');
    setDistResult(null);
    setFlatResult(null);
    setReorgResult(null);
  };

  const handleCopyResult = () => {
    if (mode === 'distribution' && distResult) {
      navigator.clipboard.writeText(JSON.stringify(distResult, null, 2));
    } else if (mode === 'flatten' && flatResult) {
      navigator.clipboard.writeText(flatResult.join('\n'));
    } else if (mode === 'reorganize' && reorgResult) {
      const all = (Object.values(reorgResult) as ReorganizedEntry[][]).flat();
      const text = all.map(e => `${e.number}#${e.name}`).join('\n');
      navigator.clipboard.writeText(text);
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto">
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
          {((mode === 'distribution' && distResult) || (mode === 'flatten' && flatResult) || (mode === 'reorganize' && reorgResult)) && (
            <>
              {mode === 'distribution' && distResult && (
                <button 
                  onClick={handleExportJSON}
                  className="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-blue-500/50 rounded-md text-sm font-medium transition-all flex items-center gap-2 group text-zinc-300"
                >
                  <FileJson className="w-4 h-4 text-blue-400" />
                  Export JSON
                </button>
              )}
              <button 
                onClick={handleCopyResult}
                className="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-300 rounded-md text-sm font-medium transition-all flex items-center gap-2 group text-zinc-300"
              >
                <ClipboardCopy className="w-4 h-4 text-zinc-400" />
                {mode === 'distribution' ? 'Copy JSON' : mode === 'flatten' ? 'Copy All Tags' : 'Copy All Reordered'}
              </button>
            </>
          )}
          <button 
            onClick={handleClear}
            className="px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-red-900/50 hover:bg-red-950/20 text-zinc-400 hover:text-red-400 rounded-md text-sm font-medium transition-all flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
        </div>
      </header>

      {/* Global Input Section */}
      <section className="bg-zinc-900/30 border border-zinc-800 rounded-xl p-6 relative overflow-hidden backdrop-blur-sm mb-12">
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
              px-12 py-4 rounded-xl flex items-center gap-3 font-display font-bold text-xl transition-all
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
            {isProcessing ? 'PROCESSING ALL...' : 'GENERATE'}
          </button>
        </div>
      </section>

      {/* Mode Selector (Tabs) */}
      <div className="flex bg-zinc-900/50 p-1.5 rounded-xl border border-zinc-800 mb-8 w-fit">
        <button
          onClick={() => setMode('distribution')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold tracking-wide transition-all ${mode === 'distribution' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
        >
          <Layers className="w-4 h-4" />
          Distribute Sessions
        </button>
        <button
          onClick={() => setMode('flatten')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold tracking-wide transition-all ${mode === 'flatten' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
        >
          <Terminal className="w-4 h-4" />
          Get Tags
        </button>
        <button
          onClick={() => setMode('reorganize')}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold tracking-wide transition-all ${mode === 'reorganize' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
        >
          <Activity className="w-4 h-4" />
          Reorganize Sessions
        </button>
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
                    <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400">Distribution Result</h2>
                  </div>

                  <div className="space-y-4">
                    {Object.keys(distResult).length === 0 ? (
                      <div className="p-12 border border-dashed border-zinc-800 rounded-xl text-center text-zinc-600">
                        No data identified. Ensure session names are followed by profile numbers.
                      </div>
                    ) : (
                      (Object.entries(distResult) as [string, { [sessionName: string]: { [hour: number]: string[] } }][]).map(([dropName, dropData]) => (
                        <DropResult key={dropName} name={dropName} sessions={dropData} />
                      ))
                    )}
                  </div>
                </motion.section>
              ) : (
                <div className="p-12 border-2 border-dashed border-zinc-800 rounded-xl text-center">
                  <Layers className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
                  <p className="text-zinc-600 font-medium max-w-sm mx-auto">
                    Click Generate to process the input and see the 23-hour schedule distribution.
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

                  <FlattenedResult ids={flatResult} />
                </motion.section>
              ) : (
                <div className="p-12 border-2 border-dashed border-zinc-800 rounded-xl text-center">
                  <Terminal className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
                  <p className="text-zinc-600 font-medium max-w-sm mx-auto">
                    Click Generate to extract all bracketed [IDs] into a clean tag list.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div
            key="reorg-view"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-12"
          >
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
                  <ReorganizedResult data={reorgResult} />
                </motion.section>
              ) : (
                <div className="p-12 border-2 border-dashed border-zinc-800 rounded-xl text-center">
                  <Activity className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
                  <p className="text-zinc-600 font-medium max-w-sm mx-auto">
                    Click Generate to transform horizontal rows into vertical grouped records.
                  </p>
                </div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      <footer className="mt-16 pt-8 border-t border-zinc-900 flex justify-between items-center text-[10px] font-mono text-zinc-700 uppercase tracking-widest">
        <div className="flex items-center gap-4">
          <span>Engine: Any-String v1.1 Professional</span>
          <span className="w-1 h-1 rounded-full bg-zinc-800" />
          <span>Status: Multi-View Enabled</span>
        </div>
        <div>
          Universal Table & List Parsing Enabled
        </div>
      </footer>
    </div>
  );
}



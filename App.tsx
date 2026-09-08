import React, { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import { motion, AnimatePresence } from "motion/react";
import { 
  FileText, 
  Upload, 
  ChevronRight, 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  RefreshCcw,
  BarChart3,
  Search,
  Settings,
  ShieldCheck,
  Zap,
  ArrowLeft,
  Eye,
  X
} from "lucide-react";
import { cn } from "./lib/utils";
import { AssessmentAnalysis, AssessmentQuestion } from "./types";
import { analyzeAssessment } from "./lib/analyzer";
import { 
  generateInternalReport, 
  generateClientReport, 
  getInternalReportPreviewData, 
  getClientReportPreviewData,
  calculateOverallScore
} from "./lib/pdfGenerator";

export default function App() {
  const [testName, setTestName] = useState("");
  const [experienceRange, setExperienceRange] = useState("");
  const [assessmentDump, setAssessmentDump] = useState("");
  const [context, setContext] = useState("");
  const [contextImage, setContextImage] = useState<{ data: string; mimeType: string } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AssessmentAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Preview States
  const [previewData, setPreviewData] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const handleContextPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const result = event.target?.result as string;
            setContextImage({
              data: result.split(",")[1],
              mimeType: file.type,
            });
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleContextFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setContextImage({
          data: result.split(",")[1],
          mimeType: file.type,
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      Papa.parse(file, {
        complete: (results) => {
          setAssessmentDump(JSON.stringify(results.data, null, 2));
        },
        header: true,
        skipEmptyLines: true,
      });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/json": [".json"],
    },
    multiple: false,
  } as any);

  const handleAnalyze = async () => {
    if (!testName.trim()) {
      setError("Please enter a Test Name");
      return;
    }
    if (!assessmentDump.trim()) {
      setError("Please provide an assessment dump");
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      let questions: AssessmentQuestion[] = [];
      
      // Helper function to extract fields flexibly by keys or loose casing
      const SECTION_CANDIDATE_KEYS = [
        "Section Name", "SectionName", "Section", "Section Title", "SectionTitle", 
        "Category", "Category Name", "Topic", "Topic Name", "Subject", "Module", 
        "Skill", "Skill Name", "Domain", "Group"
      ];

      const findValueByKeys = (row: any, candidates: string[]) => {
        if (!row || typeof row !== "object") return undefined;
        // 1. Direct exact key lookup
        for (const candidate of candidates) {
          if (row[candidate] !== undefined && row[candidate] !== null && String(row[candidate]).trim() !== "") {
            return String(row[candidate]).trim();
          }
        }
        // 2. Loose key lookup (ignore case, spaces, underscores, hyphens)
        const rowKeys = Object.keys(row);
        for (const candidate of candidates) {
          const normCand = candidate.toLowerCase().replace(/[\s_\-]+/g, "");
          const matchedKey = rowKeys.find(k => k.toLowerCase().replace(/[\s_\-]+/g, "") === normCand);
          if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null && String(row[matchedKey]).trim() !== "") {
            return String(row[matchedKey]).trim();
          }
        }
        return undefined;
      };

      const parseQuestionRow = (row: any, idx: number): AssessmentQuestion => {
        let rawSec = findValueByKeys(row, SECTION_CANDIDATE_KEYS);
        
        const qName = findValueByKeys(row, ["Question Name", "Question Title", "Question Text", "Question", "Title", "Name", "Problem"]) || `Question ${idx + 1}`;
        const desc = findValueByKeys(row, ["Description", "Question Text", "Question", "Problem Statement", "Details", "Text"]) || qName;
        
        if (!rawSec || rawSec.toLowerCase() === "unknown") {
          // Attempt prefix extraction from qName or desc if formatted as [Section Name] or Section: Name
          const textToScan = `${qName} ${desc}`.trim();
          const bracketMatch = textToScan.match(/^\[([^\]]{2,30})\]/);
          const colonMatch = textToScan.match(/^([A-Za-z0-9\s&]{2,25})[:\-]\s+/);
          
          if (bracketMatch && bracketMatch[1]) {
            rawSec = bracketMatch[1].trim();
          } else if (colonMatch && colonMatch[1] && !["http", "https", "note", "question", "q"].includes(colonMatch[1].toLowerCase().trim())) {
            rawSec = colonMatch[1].trim();
          }
        }

        const secName = (rawSec && rawSec.toLowerCase() !== "unknown") ? rawSec : "General";
        
        return {
          sectionName: secName,
          questionName: qName,
          description: desc,
          level: findValueByKeys(row, ["Level", "Difficulty", "Difficulty Level", "Complexity"]) || "Medium",
          options: [
            row["Option 1"], row["Option 2"], row["Option 3"], row["Option 4"], row["Option 5"]
          ].filter(Boolean) as string[],
        };
      };

      // Try parsing the dump
      try {
        const parsed = JSON.parse(assessmentDump);
        if (Array.isArray(parsed)) {
          questions = parsed.map((row: any, idx: number) => parseQuestionRow(row, idx));
        } else {
          throw new Error("Invalid format. Please provide a JSON array of questions.");
        }
      } catch (e) {
        // Fallback to CSV parsing of the string if it wasn't JSON
        const csvParsed = Papa.parse(assessmentDump, { header: true, skipEmptyLines: true });
        if (csvParsed.data.length > 0) {
          questions = csvParsed.data.map((row: any, idx: number) => parseQuestionRow(row, idx));
        } else {
          throw new Error("Could not parse data. Please check the format.");
        }
      }

      if (questions.length === 0) {
        throw new Error("No questions found in the data.");
      }

      const result = await analyzeAssessment(testName, questions, context, experienceRange, contextImage || undefined);
      
      // Normalize scores to 0-10 if they appear to be on a 0-100 scale
      if (result.scores) {
        Object.keys(result.scores).forEach((key) => {
          const k = key as keyof typeof result.scores;
          if (typeof result.scores[k] === 'number' && result.scores[k] > 10) {
            result.scores[k] = result.scores[k] / 10;
          }
        });
      }
      
      setAnalysis(result);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred during analysis.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handlePreviewInternal = () => {
    if (!analysis) return;
    setPreviewData(getInternalReportPreviewData(analysis));
    setPreviewTitle("Internal Audit Report Preview");
    setIsPreviewOpen(true);
  };

  const handlePreviewClient = () => {
    if (!analysis) return;
    setPreviewData(getClientReportPreviewData(analysis));
    setPreviewTitle("Client Evaluation Report Preview");
    setIsPreviewOpen(true);
  };

  const closePreview = () => {
    setIsPreviewOpen(false);
    setPreviewData(null);
  };

  const handleReset = () => {
    setAnalysis(null);
    setTestName("");
    setExperienceRange("");
    setAssessmentDump("");
    setContext("");
    setContextImage(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-bg text-text-main font-sans selection:bg-client-accent selection:text-white flex flex-col">
      {/* Header */}
      <header className="bg-white px-5 py-3 border-b border-border flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex flex-col">
          <h1 className="text-base font-bold tracking-tight text-[#3c4043] leading-none uppercase">Doselect Agent / Assessment Reviewer</h1>
          {analysis && (
            <div className="flex gap-4 mt-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">
              <span>Test: {analysis.testSnapshot.testName}</span>
              <span className="opacity-30">|</span>
              <span>Type: {analysis.testSnapshot.testType}</span>
              <span className="opacity-30">|</span>
              <span>EXP: {analysis.testSnapshot.experienceRange || "N/A"}</span>
              <span className="opacity-30">|</span>
              <span className="text-success font-bold">Analysis Complete</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-success rounded-full shadow-[0_0_8px_rgba(30,142,62,0.5)]"></span>
            <span className="text-[10px] uppercase font-bold tracking-widest text-text-muted">System Active</span>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-5">
        <AnimatePresence mode="wait">
          {!analysis && !isAnalyzing ? (
            <motion.div
              key="input"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 py-10"
            >
              {/* Left Column - Instructions & Header */}
              <div className="lg:col-span-5 flex flex-col justify-center space-y-6">
                <div className="space-y-4">
                  <h2 className="text-4xl font-bold tracking-tight leading-tight">
                    Assessment <br />
                    Review Dashboard
                  </h2>
                  <p className="text-sm text-text-muted leading-relaxed max-w-sm">
                    High-density diagnostics for MCQ test design. Extract candid internal reports and shared client-safe assessments.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div className="bg-white p-4 border border-border rounded flex gap-4">
                    <BarChart3 className="w-5 h-5 text-client-accent" />
                    <p className="text-[11px] font-medium leading-tight">Automated cognitive mix and differentiation analysis.</p>
                  </div>
                  <div className="bg-white p-4 border border-border rounded flex gap-4">
                    <Zap className="w-5 h-5 text-warning" />
                    <p className="text-[11px] font-medium leading-tight">Instant PDF report generation for internal use.</p>
                  </div>
                </div>
              </div>

              {/* Right Column - Inputs */}
              <div className="lg:col-span-7">
                <div className="bg-white border border-border rounded shadow-xl overflow-hidden">
                  <div className="p-8 space-y-6">
                    {/* Test Name & Experience */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Assessment Title</label>
                        <input
                          type="text"
                          value={testName}
                          onChange={(e) => setTestName(e.target.value)}
                          placeholder="e.g. Python SDE 3 v2"
                          className="w-full bg-bg border border-border p-2.5 text-xs focus:ring-1 focus:ring-client-accent outline-none rounded"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Target Exp (Optional)</label>
                        <input
                          type="text"
                          value={experienceRange}
                          onChange={(e) => setExperienceRange(e.target.value)}
                          placeholder="e.g. 3-5 years"
                          className="w-full bg-bg border border-border p-2.5 text-xs focus:ring-1 focus:ring-client-accent outline-none rounded"
                        />
                      </div>
                    </div>

                    {/* Assessment Dump */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Assessment Data</label>
                      <div
                        {...getRootProps()}
                        className={cn(
                          "border-2 border-dashed rounded p-6 text-center transition-all bg-bg",
                          isDragActive ? "border-client-accent bg-client-accent/5" : "border-border hover:border-text-muted/30"
                        )}
                      >
                        <input {...getInputProps()} />
                        <Upload className="w-6 h-6 mx-auto mb-2 opacity-30 text-text-main" />
                        <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Drag CSV / JSON</p>
                      </div>
                      <textarea
                        value={assessmentDump}
                        onChange={(e) => setAssessmentDump(e.target.value)}
                        placeholder="...or dump CSV content here"
                        className="w-full h-24 bg-bg border border-border p-2.5 text-[10px] font-mono outline-none rounded mt-2"
                      />
                    </div>

                    {/* Context (Optional) */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">JD / Blueprint (Optional)</label>
                        <div className="flex gap-2">
                          <label className="cursor-pointer group flex items-center gap-1">
                            <Upload className="w-2.5 h-2.5 text-text-muted group-hover:text-client-accent" />
                            <span className="text-[9px] font-bold uppercase text-text-muted group-hover:text-client-accent tracking-tighter">OCR / Image</span>
                            <input type="file" className="hidden" accept="image/*" onChange={handleContextFileSelect} title="Upload JD Image" />
                          </label>
                          {contextImage && (
                            <button 
                              onClick={() => setContextImage(null)} 
                              className="text-[9px] font-bold uppercase text-internal-accent hover:underline tracking-tighter flex items-center gap-1"
                            >
                              <X className="w-2.5 h-2.5" /> Clear
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="relative">
                        <textarea
                          value={context}
                          onChange={(e) => setContext(e.target.value)}
                          onPaste={handleContextPaste}
                          placeholder="Paste text or screenshot for alignment review..."
                          className={cn(
                            "w-full h-20 bg-bg border border-border p-2.5 text-xs outline-none rounded transition-all",
                            contextImage ? "pr-24 lg:pr-28" : ""
                          )}
                        />
                        {contextImage && (
                          <div className="absolute right-1 top-1 bottom-1 w-20 lg:w-24 bg-white border border-border rounded overflow-hidden shadow-sm group">
                            <img 
                              src={`data:${contextImage.mimeType};base64,${contextImage.data}`} 
                              className="w-full h-full object-cover" 
                              alt="JD Preview"
                            />
                            <div className="absolute inset-0 bg-text-main/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity pointer-events-none">
                               <Eye className="w-4 h-4 text-white" />
                            </div>
                          </div>
                        )}
                      </div>
                      <p className="text-[8px] text-text-muted italic">Supporting plain text or visual screenshots (OCR enabled).</p>
                    </div>

                    {error && (
                      <div className="bg-internal-accent/5 border border-internal-accent/20 p-3 flex gap-2 items-center rounded">
                        <AlertCircle className="w-4 h-4 text-internal-accent" />
                        <p className="text-[10px] text-internal-accent font-bold uppercase">{error}</p>
                      </div>
                    )}

                    <button
                      onClick={handleAnalyze}
                      className="w-full bg-client-accent text-white py-3 font-bold uppercase tracking-[0.2em] text-[11px] rounded hover:shadow-lg transition-all"
                    >
                      Process Assessment Review
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : isAnalyzing ? (
            <motion.div
              key="loading"
              className="flex flex-col items-center justify-center min-h-[50vh] space-y-4"
            >
              <div className="w-12 h-12 border-2 border-client-accent border-t-transparent rounded-full animate-spin" />
              <div className="text-center">
                <h3 className="text-xs font-bold uppercase tracking-widest font-mono">Running Content Audit</h3>
                <p className="text-[10px] text-text-muted uppercase tracking-tighter">Evaluating cognitive mix and differentiator signals...</p>
              </div>
            </motion.div>
          ) : analysis && (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col space-y-5 h-full"
            >
              {/* Overall Score Header */}
              <div className="flex justify-between items-center bg-paper p-4 border border-border rounded shadow-sm">
                <div>
                  <h3 className="text-[10px] font-bold uppercase text-text-muted tracking-widest mb-1">Assessment Quality Index</h3>
                  <p className="text-[9px] opacity-60 italic">Weighted aggregate of depth, competency coverage, and differentiation efficacy.</p>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <span className="block text-[8px] font-bold uppercase opacity-40 leading-none mb-1 text-right">Composite Score</span>
                    <span className="text-3xl font-bold text-client-accent leading-none">
                      {calculateOverallScore(analysis.scores).toFixed(1)}
                      <span className="text-xs font-normal opacity-30 italic">/10</span>
                    </span>
                  </div>
                  <div className="h-10 w-px bg-border/40" />
                  <button onClick={handleReset} className="text-[10px] font-bold uppercase text-internal-accent hover:underline flex items-center gap-1">
                    <ArrowLeft className="w-3 h-3" /> New Audit
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 flex-1">
                {/* Internal Evaluation Report */}
                <div className="bg-paper border border-border rounded shadow-md flex flex-col overflow-hidden">
                <div className="p-4 border-b-2 border-internal-accent">
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-internal-accent/10 text-internal-accent uppercase mb-1 inline-block tracking-tighter">
                    Internal Evaluation Report
                  </span>
                  <div className="flex justify-between items-start">
                    <h2 className="text-sm font-bold leading-tight">{analysis.testSnapshot.testName}</h2>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={handlePreviewInternal}
                        className="text-[9px] font-bold uppercase underline text-client-accent hover:opacity-80 flex items-center gap-1"
                      >
                        <Eye className="w-3 h-3" /> Preview
                      </button>
                      <button onClick={handleReset} className="text-[9px] font-bold uppercase underline text-text-muted hover:text-text-main">New Review</button>
                    </div>
                  </div>
                </div>

                <div className="p-4 flex-1 overflow-auto space-y-6">
                  {/* Snapshot Section */}
                  <section>
                    <h3 className="text-[9px] font-bold uppercase text-text-muted border-b border-bg pb-1 mb-2 tracking-widest">1. Assessment Snapshot</h3>
                    <div className="grid grid-cols-3 gap-2">
                    <div className="bg-bg p-2 rounded">
                        <span className="block text-[8px] text-text-muted uppercase font-bold">Sections</span>
                        <span className="block text-[12px] font-bold">{analysis.testSnapshot.totalSections.toString().padStart(2, '0')}</span>
                      </div>
                      <div className="bg-bg p-2 rounded">
                        <span className="block text-[8px] text-text-muted uppercase font-bold">Questions</span>
                        <span className="block text-[12px] font-bold">{analysis.testSnapshot.totalQuestions}</span>
                      </div>
                      <div className="bg-bg p-2 rounded">
                        <span className="block text-[8px] text-text-muted uppercase font-bold">Score</span>
                        <span className="block text-[12px] font-bold text-client-accent">
                          {analysis.scores.quality.toFixed(1)}/10
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* Skill Metrics Section */}
                  {analysis.skillMetrics && analysis.skillMetrics.length > 0 && (
                    <section>
                      <h3 className="text-[9px] font-bold uppercase text-text-muted border-b border-bg pb-1 mb-2 tracking-widest">2. Skill Coverage Metrics</h3>
                      <div className="overflow-hidden border border-border/40 rounded">
                        <table className="w-full text-[10px]">
                          <thead className="bg-bg">
                            <tr className="border-b border-border/40 text-left">
                              <th className="p-2 opacity-60 uppercase tracking-tighter">Skill/Competency</th>
                              <th className="p-2 opacity-60 uppercase tracking-tighter">Coverage</th>
                              <th className="p-2 opacity-60 uppercase tracking-tighter text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/20">
                            {analysis.skillMetrics.map((sm, i) => (
                              <tr key={i}>
                                <td className="p-2 font-medium">{sm.skill}</td>
                                <td className="p-2">{sm.coverage}%</td>
                                <td className="p-2 text-right">
                                  <span className={cn(
                                    "text-[8px] font-bold uppercase px-1 py-0.5 rounded",
                                    sm.coverage > 70 ? "bg-success/10 text-success" : 
                                    sm.coverage > 40 ? "bg-warning/10 text-[#af5200]" : "bg-internal-accent/10 text-internal-accent"
                                  )}>
                                    {sm.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  {/* Executive Summary Section */}
                  <section>
                    <h3 className="text-[9px] font-bold uppercase text-text-muted border-b border-bg pb-1 mb-2 tracking-widest">3. Executive Summary</h3>
                    <div className="bg-internal-accent/5 border-l-2 border-internal-accent p-3 text-[11px] italic leading-relaxed text-[#5e1c18]">
                      {analysis.executiveSummary}
                    </div>
                  </section>

                  {/* Risk Section */}
                  <section>
                    <h3 className="text-[9px] font-bold uppercase text-text-muted border-b border-bg pb-1 mb-2 tracking-widest">4. Risk Summary</h3>
                    <ul className="space-y-1.5 list-disc pl-4 text-[11px] leading-snug">
                      {analysis.riskSummary.map((risk, i) => (
                        <li key={i}>{risk}</li>
                      ))}
                    </ul>
                  </section>

                  {/* Flagged Section */}
                  <section>
                    <h3 className="text-[9px] font-bold uppercase text-text-muted border-b border-bg pb-1 mb-2 tracking-widest">5. Flagged Items</h3>
                    <div className="space-y-2">
                      {analysis.flaggedQuestions.slice(0, 3).map((flag, i) => {
                        const displayName = flag.questionName && flag.questionName !== "Unknown" 
                          ? flag.questionName 
                          : (flag.sectionName && flag.sectionName !== "Unknown" ? flag.sectionName : `Question ${i + 1}`);
                        const showSection = flag.sectionName && flag.sectionName !== "Unknown" && flag.sectionName !== displayName;
                        
                        return (
                          <div key={i} className="bg-bg border border-border/50 p-2 rounded">
                            <strong className="text-[10px] text-internal-accent block leading-tight mb-1">
                              {displayName}{showSection ? <span className="text-text-muted font-normal"> ({flag.sectionName})</span> : ''}: {flag.issueLabel}
                            </strong>
                            <p className="text-[9px] opacity-70 leading-tight">{flag.reason}</p>
                            {flag.suggestedImprovement && (
                              <p className="text-[9px] text-client-accent leading-tight mt-1 font-medium">
                                <span className="font-bold">Fix:</span> {flag.suggestedImprovement}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Action Section */}
                  <section>
                    <h3 className="text-[9px] font-bold uppercase text-text-muted border-b border-bg pb-1 mb-2 tracking-widest">6. Action Priorities</h3>
                    <ol className="list-decimal pl-4 text-[10px] space-y-1 font-medium italic">
                      {analysis.actionPriorities.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ol>
                  </section>
                </div>

                <div 
                  onClick={() => generateInternalReport(analysis)}
                  className={cn(
                    "p-3 text-center font-bold tracking-[0.1em] text-[10px] cursor-pointer border-t border-border",
                    analysis.finalRecommendation === "Ready to Ship" ? "bg-success/5 text-success" :
                    analysis.finalRecommendation === "Ready with Minor Revisions" ? "bg-warning/5 text-[#af5200]" : "bg-internal-accent/5 text-internal-accent"
                  )}
                >
                  <div className="flex items-center justify-center gap-2 uppercase">
                    <Download className="w-3 h-3" />
                    {analysis.finalRecommendation.toUpperCase()} — EXPORT INTERNAL
                  </div>
                </div>
              </div>

              {/* Client Evaluation Report */}
              <div className="bg-paper border border-border rounded shadow-md flex flex-col overflow-hidden text-[#3c4043]">
                <div className="p-4 border-b-2 border-client-accent">
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-client-accent/10 text-client-accent uppercase mb-1 inline-block tracking-tighter">
                    Client Shipping Evaluation Report
                  </span>
                  <div className="flex justify-between items-start">
                    <h2 className="text-sm font-bold leading-tight">{analysis.testSnapshot.testName}</h2>
                    <p className="text-[9px] uppercase font-bold opacity-40">Doselect Accredited Review</p>
                  </div>
                </div>

                <div className="p-4 flex-1 overflow-auto space-y-6">
                  {/* Cognitive Mix Section */}
                  {analysis.cognitiveDistribution && analysis.cognitiveDistribution.length > 0 && (
                    <section>
                      <h3 className="text-[9px] font-bold uppercase text-text-muted border-b border-bg pb-1 mb-2 tracking-widest">1. Cognitive Mix (%)</h3>
                      <div className="grid grid-cols-5 gap-1 pt-1">
                        {analysis.cognitiveDistribution.map((cd, i) => (
                          <div key={i} className="bg-bg/50 p-2 rounded text-center border border-border/20">
                            <span className="block text-[8px] uppercase tracking-tighter opacity-60 font-medium truncate">{cd.level}</span>
                            <span className="block text-xs font-bold text-client-accent">{cd.percentage}%</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Skill Metrics Section */}
                  {analysis.skillMetrics && analysis.skillMetrics.length > 0 && (
                    <section>
                      <h3 className="text-[9px] font-bold uppercase text-text-muted border-b border-bg pb-1 mb-2 tracking-widest">2. Skill Coverage Metrics</h3>
                      <div className="overflow-hidden border border-border/40 rounded bg-white">
                        <table className="w-full text-[10px]">
                          <thead className="bg-[#f8f9fa] border-b border-border/40 text-left">
                            <tr>
                              <th className="p-2 opacity-60 uppercase tracking-tighter">Skill/Competency</th>
                              <th className="p-2 opacity-60 uppercase tracking-tighter text-right">Coverage %</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/20">
                            {analysis.skillMetrics.map((sm, i) => (
                              <tr key={i}>
                                <td className="p-2 font-medium">{sm.skill}</td>
                                <td className="p-2 text-right font-bold text-client-accent">{sm.coverage}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  {/* Executive Summary Section */}
                  <section>
                    <h3 className="text-[9px] font-bold uppercase text-text-muted border-b border-bg pb-1 mb-2 tracking-widest">3. Executive Summary</h3>
                    <div className="bg-client-accent/5 border-l-2 border-client-accent p-3 text-[11px] leading-relaxed text-[#1a5da8]">
                      {analysis.executiveSummary}
                    </div>
                  </section>

                  {/* Alignment & Suitability Section */}
                  {analysis.alignmentReview && (
                    <section>
                      <h3 className="text-[9px] font-bold uppercase text-text-muted border-b border-bg pb-1 mb-2 tracking-widest">3. Alignment & Suitability</h3>
                      <div className="p-3 bg-bg rounded text-[11px] opacity-80 leading-snug">
                        {analysis.alignmentReview}
                      </div>
                    </section>
                  )}

                  {/* Differentiation Section */}
                  <section>
                    <h3 className="text-[9px] font-bold uppercase text-text-muted border-b border-bg pb-1 mb-2 tracking-widest">4. Candidate Differentiation</h3>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-bg p-2 rounded border border-border/40">
                        <span className="block text-[8px] text-text-muted uppercase font-bold">Fail Filter</span>
                        <span className="block text-[11px] font-bold uppercase truncate">{analysis.scores.quality > 5 ? "Robust" : "Baseline"}</span>
                      </div>
                      <div className="bg-bg p-2 rounded border border-border/40">
                        <span className="block text-[8px] text-text-muted uppercase font-bold">Ranking Strength</span>
                        <span className="block text-[11px] font-bold uppercase truncate">{analysis.scores.differentiation > 7 ? "High" : "Capable"}</span>
                      </div>
                      <div className="bg-bg p-2 rounded border border-border/40">
                        <span className="block text-[8px] text-text-muted uppercase font-bold">Top Tier Differentiation</span>
                        <span className="block text-[11px] font-bold uppercase truncate">{analysis.scores.readiness > 8 ? "Precise" : "Moderate"}</span>
                      </div>
                    </div>
                  </section>

                  {/* Strengths Section */}
                  <section>
                    <h3 className="text-[9px] font-bold uppercase text-text-muted border-b border-bg pb-1 mb-2 tracking-widest">4. Assessment Strengths</h3>
                    <ul className="space-y-1.5 list-disc pl-4 text-[11px] leading-snug">
                      {analysis.strengths.slice(0, 3).map((strength, i) => (
                        <li key={i}>{strength}</li>
                      ))}
                    </ul>
                  </section>

                  {/* Enhancement Section */}
                  <section>
                    <h3 className="text-[9px] font-bold uppercase text-text-muted border-b border-bg pb-1 mb-2 tracking-widest">5. Enhancement Opportunities</h3>
                    <ul className="space-y-1.5 list-disc pl-4 text-[11px] leading-snug italic opacity-70">
                      {analysis.enhancementOpportunities.slice(0, 2).map((op, i) => (
                        <li key={i}>{op}</li>
                      ))}
                    </ul>
                  </section>
                </div>

                <div className="pt-4 flex gap-4 p-3 bg-bg/50">
                  <button 
                    onClick={handlePreviewClient}
                    className="flex-1 p-2.5 text-center border-2 border-client-accent font-bold tracking-[0.12em] text-[10px] text-client-accent hover:bg-client-accent/5 transition-all uppercase flex items-center justify-center gap-2"
                  >
                    <Eye className="w-3 h-3" />
                    Preview Report
                  </button>
                  <button 
                    onClick={() => generateClientReport(analysis)}
                    className="flex-1 p-2.5 text-center bg-success font-bold tracking-[0.12em] text-[10px] text-white cursor-pointer hover:bg-success/90 transition-all uppercase flex items-center justify-center gap-2"
                  >
                    <Download className="w-3 h-3" />
                    Export Client PDF
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>

      {/* PDF Preview Modal */}
      <AnimatePresence>
        {isPreviewOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closePreview}
              className="absolute inset-0 bg-text-main/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-white w-full max-w-5xl h-[90vh] rounded shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="p-4 border-b border-border flex justify-between items-center bg-paper">
                <div className="flex items-center gap-3">
                  <div className="bg-client-accent/10 p-2 rounded">
                    <FileText className="w-5 h-5 text-client-accent" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold uppercase tracking-widest">{previewTitle}</h2>
                    <p className="text-[10px] text-text-muted italic">Review layout and single-page fitment</p>
                  </div>
                </div>
                <button 
                  onClick={closePreview}
                  className="p-2 hover:bg-bg rounded-full transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 bg-bg p-6 overflow-hidden flex justify-center">
                {previewData ? (
                  <iframe 
                    src={previewData}
                    className="w-full h-full border-0 bg-white shadow-lg rounded"
                    title="PDF Preview"
                  />
                ) : (
                  <div className="flex items-center justify-center w-full h-full">
                    <p className="text-xs font-mono animate-pulse">Generating Report Instance...</p>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-border bg-paper flex justify-end gap-4">
                <button 
                  onClick={closePreview}
                  className="px-6 py-2 border border-border text-[10px] font-bold uppercase tracking-widest rounded hover:bg-bg"
                >
                  Back to Dashboard
                </button>
                <button 
                  onClick={() => {
                    const isInternal = previewTitle.includes("Internal");
                    if (analysis) {
                      if (isInternal) generateInternalReport(analysis);
                      else generateClientReport(analysis);
                      closePreview();
                    }
                  }}
                  className="px-6 py-2 bg-client-accent text-white text-[10px] font-bold uppercase tracking-widest rounded hover:shadow-lg"
                >
                  Confirm & Download PDF
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer Utility Bar */}
      <footer className="bg-white border-t border-border px-5 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 opacity-30 font-mono text-[9px] uppercase tracking-tighter">
          <Settings className="w-2.5 h-2.5" />
          <span>DOSELECT AGENT ENGINE 1.0.4</span>
        </div>
        <div className="text-[9px] text-text-muted uppercase font-bold leading-none tracking-tight">
          Strictly Confidential Content Review
        </div>
      </footer>
    </div>
  );

}


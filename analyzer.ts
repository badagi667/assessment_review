import { GoogleGenAI, Type } from "@google/genai";
import { ai } from "./gemini";
import { AssessmentQuestion, AssessmentAnalysis } from "../types";

const ANALYSIS_PROMPT = `
You are an expert pre-shipping reviewer for MCQ-based assessments at DoSelect. 
Your goal is to evaluate the provided assessment and generate two distinct reports (Internal and Client).

Evaluation Objectives:
1. Skill Alignment: Match skill coverage from the provided JD/TOC with the questions added. Identify gaps or over-representation. Provide structured skill metrics (skill name, coverage percentage, and status).
2. Taxonomy Diversification: Ensure a healthy mix of cognitive levels (Recall, Understand, Apply, Analyze, Evaluate/Decide) appropriate for the test type. Provide a percentage breakdown of these levels.
3. Experience Suitability: Evaluate if the question depth and complexity are suitable for the target experience range: {experienceRange}.
4. Targeted Quality Audit: Flag ONLY high-impact "wrong" or "weak" questions that MUST be replaced. Avoid minor issues unless it's a critical flaw. Identify specific section/question context.
5. Concise Reporting: Avoid filler data. Focus on diagnostic, action-oriented insights for internal use and professional, separation-focused insights for clients.

Input Summary:
- Test Name: {testName}
- Target Experience: {experienceRange}
- Assessment Dump: {assessmentData}
- JD/TOC Alignment Context: {optionalContext}

Output JSON Schema expectations:
- testSnapshot: Include test type (Tech/Non-Tech/Mixed) and experience suitability notes.
- executiveSummary: One-page style summary, distinct for internal vs client context if possible, but providing a unified diagnosis here.
- cognitiveDistribution: Array of objects with 'level' (e.g., Recall, Apply) and 'percentage' (number 0-100). Total must be 100.
- skillMetrics: Array of objects with 'skill', 'coverage' (number 0-100), and 'status' (e.g., Comprehensive, Needs Depth).
- flaggedQuestions: Only critical items needing replacement. Include specific 'questionName' (the question title/name or brief snippet/identifier), 'sectionName', 'issueLabel', 'reason', and 'suggestedImprovement'. Never output 'Unknown' for questionName or sectionName.
- alignmentReview: Deep dive into JD/TOC vs Assessment coverage.
- scores: Individual scoring components (quality, coverage, etc.) MUST be provided on a scale of 0 to 10 (where 10 is highest).
`;

export async function analyzeAssessment(
  testName: string,
  questions: AssessmentQuestion[],
  optionalContext?: string,
  experienceRange?: string,
  contextImage?: { data: string; mimeType: string }
): Promise<AssessmentAnalysis> {
  const normalizedSectionMap = new Map<string, string>();
  questions.forEach(q => {
    const raw = (q.sectionName || "").trim();
    if (raw && raw.toLowerCase() !== "unknown") {
      const key = raw.toLowerCase();
      if (!normalizedSectionMap.has(key)) {
        normalizedSectionMap.set(key, raw);
      }
    }
  });
  const actualTotalSections = normalizedSectionMap.size > 0 ? normalizedSectionMap.size : 1;
  const actualTotalQuestions = questions.length;

  const assessmentData = questions.map((q, idx) => 
    `Question ${idx + 1}: ${q.questionName ? `[${q.questionName}] ` : ''}Section: ${q.sectionName || 'General'} | Level: ${q.level} | Desc: ${q.description} | Options: ${q.options.join(', ')}`
  ).join('\n');

  const prompt = ANALYSIS_PROMPT
    .replace('{testName}', testName)
    .replace('{experienceRange}', experienceRange || "Not specified")
    .replace('{assessmentData}', assessmentData + `\n\nNote: Ground Truth Sections Detected = ${actualTotalSections} (${Array.from(normalizedSectionMap.values()).join(', ')}), Total Questions = ${actualTotalQuestions}`)
    .replace('{optionalContext}', optionalContext || (contextImage ? "Provided as an image." : "None provided"));

  const parts: any[] = [{ text: prompt }];

  if (contextImage) {
    parts.push({
      inlineData: {
        data: contextImage.data,
        mimeType: contextImage.mimeType
      }
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          testSnapshot: {
            type: Type.OBJECT,
            properties: {
              testName: { type: Type.STRING },
              testType: { type: Type.STRING },
              totalSections: { type: Type.NUMBER },
              totalQuestions: { type: Type.NUMBER },
              evaluationMode: { type: Type.STRING },
              experienceRange: { type: Type.STRING },
            },
            required: ["testName", "testType", "totalSections", "totalQuestions", "evaluationMode"]
          },
          executiveSummary: { type: Type.STRING },
          cognitiveDistribution: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                level: { type: Type.STRING },
                percentage: { type: Type.NUMBER },
              },
              required: ["level", "percentage"]
            }
          },
          skillMetrics: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                skill: { type: Type.STRING },
                coverage: { type: Type.NUMBER },
                status: { type: Type.STRING },
              },
              required: ["skill", "coverage", "status"]
            }
          },
          compositionSummary: {
            type: Type.OBJECT,
            properties: {
              cognitiveMix: { type: Type.STRING },
              competencyCoverage: { type: Type.STRING },
              sectionBalance: { type: Type.STRING },
              difficultyBalance: { type: Type.STRING },
            },
            required: ["cognitiveMix", "competencyCoverage", "sectionBalance", "difficultyBalance"]
          },
          candidateDifferentiation: {
            type: Type.OBJECT,
            properties: {
              failFilter: { type: Type.STRING },
              passFilter: { type: Type.STRING },
              averageDifferentiator: { type: Type.STRING },
              topCandidateDifferentiator: { type: Type.STRING },
              overallSeparation: { type: Type.STRING },
            },
            required: ["failFilter", "passFilter", "averageDifferentiator", "topCandidateDifferentiator", "overallSeparation"]
          },
          qualityDiagnostics: { type: Type.STRING },
          riskSummary: { type: Type.ARRAY, items: { type: Type.STRING } },
          flaggedQuestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                questionName: { type: Type.STRING },
                sectionName: { type: Type.STRING },
                issueLabel: { type: Type.STRING },
                reason: { type: Type.STRING },
                suggestedImprovement: { type: Type.STRING },
              },
              required: ["questionName", "sectionName", "issueLabel", "reason", "suggestedImprovement"]
            }
          },
          alignmentReview: { type: Type.STRING },
          actionPriorities: { type: Type.ARRAY, items: { type: Type.STRING } },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          enhancementOpportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
          scores: {
            type: Type.OBJECT,
            properties: {
              diversification: { type: Type.NUMBER },
              competencyCoverage: { type: Type.NUMBER },
              differentiation: { type: Type.NUMBER },
              quality: { type: Type.NUMBER },
              sectionBalance: { type: Type.NUMBER },
              readiness: { type: Type.NUMBER },
            },
            required: ["diversification", "competencyCoverage", "differentiation", "quality", "sectionBalance", "readiness"]
          },
          finalRecommendation: { type: Type.STRING },
        },
        required: [
          "testSnapshot", "executiveSummary", "cognitiveDistribution", "skillMetrics", "compositionSummary", 
          "candidateDifferentiation", "qualityDiagnostics", "riskSummary", 
          "flaggedQuestions", "actionPriorities", "strengths", 
          "enhancementOpportunities", "scores", "finalRecommendation"
        ]
      }
    }
  });

  const parsed = JSON.parse(response.text || "{}") as AssessmentAnalysis;

  if (!parsed.testSnapshot) {
    parsed.testSnapshot = {
      testName: testName || "Assessment",
      testType: "Tech",
      totalSections: actualTotalSections,
      totalQuestions: actualTotalQuestions,
      evaluationMode: "Automated",
      experienceRange: experienceRange || "Not Specified"
    };
  } else {
    parsed.testSnapshot.totalSections = actualTotalSections;
    parsed.testSnapshot.totalQuestions = actualTotalQuestions;
  }

  if (parsed.flaggedQuestions && Array.isArray(parsed.flaggedQuestions)) {
    parsed.flaggedQuestions = parsed.flaggedQuestions.map((f, i) => {
      let qName = f.questionName && f.questionName !== "Unknown" ? f.questionName : "";
      if (!qName) {
        if (f.sectionName && f.sectionName !== "Unknown") {
          qName = f.sectionName;
        } else {
          qName = `Question ${i + 1}`;
        }
      }
      const secName = f.sectionName && f.sectionName !== "Unknown" ? f.sectionName : "General";
      return {
        ...f,
        questionName: qName,
        sectionName: secName
      };
    });
  }

  return parsed;
}

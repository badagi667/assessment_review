export type TestType = 'Tech' | 'Non-Tech' | 'Mixed / Hybrid';

export interface AssessmentQuestion {
  sectionName: string;
  questionName?: string;
  description: string;
  level: string;
  options: string[];
}

export interface FlaggedQuestion {
  questionName?: string;
  sectionName: string;
  issueLabel: string;
  reason: string;
  suggestedImprovement: string;
}

export interface SkillMetric {
  skill: string;
  coverage: number; // 0-100
  status: string;
}

export interface CognitiveLevelDistribution {
  level: string;
  percentage: number;
}

export interface AssessmentAnalysis {
  testSnapshot: {
    testName: string;
    testType: TestType;
    totalSections: number;
    totalQuestions: number;
    evaluationMode: string;
    experienceRange?: string;
  };
  executiveSummary: string;
  cognitiveDistribution: CognitiveLevelDistribution[];
  skillMetrics: SkillMetric[];
  compositionSummary: {
    cognitiveMix: string;
    competencyCoverage: string;
    sectionBalance: string;
    difficultyBalance: string;
  };
  candidateDifferentiation: {
    failFilter: string;
    passFilter: string;
    averageDifferentiator: string;
    topCandidateDifferentiator: string;
    overallSeparation: string;
  };
  qualityDiagnostics: string;
  riskSummary: string[];
  flaggedQuestions: FlaggedQuestion[];
  alignmentReview?: string;
  actionPriorities: string[];
  strengths: string[];
  enhancementOpportunities: string[];
  scores: {
    diversification: number;
    competencyCoverage: number;
    differentiation: number;
    quality: number;
    sectionBalance: number;
    readiness: number;
    combined?: number;
  };
  finalRecommendation: 'Ready to Ship' | 'Ready with Minor Revisions' | 'Needs Revision Before Shipping';
}

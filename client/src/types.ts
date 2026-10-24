// Shapes of the JSON returned by the Express API

export type Role = 'student' | 'mentor' | 'faculty_admin';
export type MatchStatus = 'pending' | 'active' | 'completed';
export type RiskLevel = 'low' | 'medium' | 'high';
export type ResolutionStatus = 'unresolved' | 'in_review' | 'resolved';
export type QuestionType = 'multiple_choice' | 'true_false';

export interface User {
  userId: number;
  fullName: string;
  email: string;
  role: Role;
}

export interface Material {
  materialId: number;
  title: string;
  moduleCode: string;
  fileType: string;
  uploadedById: number;
  uploadedBy: string;
  progress: {
    completionPercentage: number;
    scoreAchieved: number | null;
    lastUpdated: string;
  } | null;
  conceptCheck: { checkId: number; questionCount: number } | null;
}

export interface Question {
  questionId: number;
  questionType: QuestionType;
  prompt: string;
  options: string[];
}

export interface ConceptCheck {
  checkId: number;
  title: string;
  questions: Question[];
}

export interface MatchOutcome {
  status: 'created' | 'already_matched' | 'no_helper_available';
  matchId?: number;
  helperSummary?: string;
}

export interface GradeResult {
  score: number;
  correctCount: number;
  totalQuestions: number;
  threshold: number;
  moduleCode: string;
  results: {
    questionId: number;
    chosenIndex: number;
    correctIndex: number;
    isCorrect: boolean;
    explanation: string | null;
  }[];
  match: MatchOutcome | null;
}

interface Person {
  userId: number;
  fullName: string;
  email: string;
}

/** A peer-help match as one of its two participants sees it. */
export interface PeerMatch {
  matchId: number;
  moduleCode: string;
  status: MatchStatus;
  myRole: 'student' | 'helper';   // 'student' = I'm getting help; 'helper' = I'm giving it
  iAccepted: boolean;
  theyAccepted: boolean;
  summary: string;                // what I know about the other person before we both accept
  contact: { fullName: string; email: string; phoneNumber: string | null } | null; // only once both accept
  createdAt: string | null;
}

export interface Profile {
  phoneNumber: string | null;
  availableToHelp: boolean;
}

export interface AppNotification {
  notificationId: number;
  title: string;
  body: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface MentorModule {
  moduleCode: string;
  maxActiveMatches: number;
}

export interface StudentRisk {
  studentId: number;
  fullName: string;
  email: string;
  riskIndex: number;
  riskLevel: RiskLevel;
  factors: { conceptScore: number; completion: number; logins: number; inactivity: number };
  metrics: {
    averageScore: number | null;
    averageCompletion: number | null;
    loginsLast14Days: number;
    daysSinceActivity: number | null;
    modulesStarted: string[];
  };
  reasons: string[];
}

export interface RiskAlert {
  alertId: number;
  student: Person;
  riskLevel: RiskLevel;
  triggerReason: string;
  resolutionStatus: ResolutionStatus;
}

export interface CohortOverview {
  loginsByDay: { date: string; logins: number }[];
  modules: {
    moduleCode: string;
    chapters: number;
    students: number;
    averageCompletion: number | null;
    averageScore: number | null;
  }[];
  matches: { pending: number; active: number };
}

export interface StudentTimeline {
  student: Person;
  progress: {
    materialId: number;
    title: string;
    moduleCode: string;
    completionPercentage: number;
    scoreAchieved: number | null;
    lastUpdated: string;
  }[];
  loginsLast30Days: string[];
}

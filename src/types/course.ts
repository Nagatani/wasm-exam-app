export interface CourseSummary {
  id: string;
  name: string;
  term: string | null;
  createdAt: string;
  enrollmentCount: number;
  examCount: number;
}

export interface CourseStudent {
  userId: string;
  studentNumber: string;
  displayName: string;
  enrolledAt: string;
  // Present only until the student changes their password.
  initialPassword: string | null;
  mustChangePassword: boolean;
}

export interface BulkCreateResult {
  created: { studentNumber: string; displayName: string; initialPassword: string }[];
  skipped: string[];
  enrolled: number;
}

export interface CourseDetail {
  id: string;
  name: string;
  term: string | null;
  createdAt: string;
  students: CourseStudent[];
  exams: { id: string; title: string; status: 'DRAFT' | 'PUBLISHED' }[];
}

export interface EnrollResult {
  added: number;
  alreadyEnrolled: string[];
  notFound: string[];
}

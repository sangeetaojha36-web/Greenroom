import { pgTable, serial, text, timestamp, integer, doublePrecision, jsonb, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID or system candidate ID
  email: text('email').notNull(),
  displayName: text('display_name'),
  avatar: text('avatar'),
  targetRole: text('target_role'),
  targetCompany: text('target_company'),
  targetLevel: text('target_level'),
  preferredLanguage: text('preferred_language').default('english'),
  totalInterviews: integer('total_interviews').default(0),
  avgScore: doublePrecision('avg_score').default(0),
  achievements: jsonb('achievements'),
  weakSpots: jsonb('weak_spots'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const interviews = pgTable('interviews', {
  id: serial('id').primaryKey(),
  interviewId: text('interview_id').notNull().unique(),
  userId: text('user_id').notNull(),
  companyId: text('company_id'),
  companyName: text('company_name'),
  role: text('role'),
  level: text('level'),
  persona: text('persona'),
  format: text('format'),
  language: text('language'),
  overallScore: doublePrecision('overall_score'),
  breakdown: jsonb('breakdown'),
  proctoringSummary: jsonb('proctoring_summary'),
  qaHistory: jsonb('qa_history'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const questions = pgTable('questions', {
  id: serial('id').primaryKey(),
  questionId: text('question_id').notNull().unique(),
  companyId: text('company_id').notNull(),
  companyName: text('company_name'),
  role: text('role').notNull(),
  level: text('level').default('mid'),
  type: text('type').default('technical'),
  q: text('q').notNull(),
  keywords: jsonb('keywords'),
  expectedAnswer: text('expected_answer'),
  keyPoints: jsonb('key_points'),
  genuine: boolean('genuine').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});
